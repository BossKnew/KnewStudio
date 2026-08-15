import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { parser } from 'stream-json';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { safeErrorMessage } from './common';
import { MAX_ERROR_BYTES, MAX_GENERATION_RESPONSE_BYTES, MAX_IMAGE_BYTES, SafeHttpService } from './safe-http.service';
import { QuotaService } from './quota.service';
import { securityConfig } from './security-config';
import { normalizeProviderHeaders } from './provider-headers';

type ProviderImageSource = { path?: string; url?: string };

export function normalizeImageQuality(modelId: string, quality: unknown) {
  const value = typeof quality === 'string' ? quality : 'auto';
  return /^gpt-image-/i.test(modelId) && value === 'standard' ? 'auto' : value;
}

export function providerImageParameters(modelId: string, prompt: string, parameters: { size: unknown; quality: unknown; count: unknown }) {
  return {
    model: modelId,
    prompt,
    size: parameters.size,
    quality: normalizeImageQuality(modelId, parameters.quality),
    n: parameters.count,
  };
}

export function providerErrorFingerprint(body?: Buffer) {
  return body?.length ? createHash('sha256').update(body).digest('base64url').slice(0, 16) : 'empty';
}

export function providerHttpFailure(status: number) {
  if (status === 400 || status === 422) return { code: 'PROVIDER_PARAMETERS', message: '供应商拒绝了模型参数，请管理员检查尺寸、质量和生成数量' };
  if (status === 401 || status === 403) return { code: 'PROVIDER_AUTH', message: '供应商认证失败，请管理员检查 API Key 和请求头' };
  if (status === 404) return { code: 'PROVIDER_NOT_FOUND', message: '供应商接口或模型不存在，请管理员检查 Base URL 和模型 ID' };
  if (status === 429) return { code: 'PROVIDER_LIMIT', message: '供应商限流或账户额度不足，请稍后重试' };
  return { code: 'PROVIDER_UNAVAILABLE', message: '供应商服务暂时不可用，请稍后重试' };
}

function providerProtocolError(message: string) {
  const error: any = new Error(message);
  error.noRetry = true;
  error.providerFailure = { code: 'PROVIDER_RESPONSE', message: '供应商响应格式无效，请管理员检查 Base URL 是否包含正确的 /v1' };
  return error;
}

export async function parseProviderImages(jsonPath: string, count: number, storage: StorageService): Promise<ProviderImageSource[]> {
  const tokens = parser({ packKeys: true, streamKeys: false, packStrings: false, streamStrings: true, packNumbers: true, streamNumbers: false });
  const input = createReadStream(jsonPath);
  input.on('error', (error) => tokens.destroy(error));
  input.pipe(tokens);
  const images: ProviderImageSource[] = [];
  const staged = new Set<string>();
  let depth = 0;
  let awaitingDataArray = false;
  let dataArrayDepth = 0;
  let itemDepth = 0;
  let itemIndex = 0;
  let currentKey = '';
  let current: (ProviderImageSource & { wanted: boolean }) | undefined;
  let stringKind: 'b64_json' | 'url' | undefined;
  let urlValue = '';
  let base64Path = '';
  let base64Carry = '';
  let decodedBytes = 0;
  let writer: ReturnType<typeof createWriteStream> | undefined;
  let writerDone: Promise<void> | undefined;
  let writerFailure: unknown;

  const writeBase64 = async (value: string, final = false) => {
    if (!/^[A-Za-z0-9+/=]*$/.test(value)) throw providerProtocolError('供应商返回了无效的 Base64 图片');
    const combined = base64Carry + value;
    const paddingAt = combined.indexOf('=');
    if (paddingAt !== -1 && /[^=]/.test(combined.slice(paddingAt))) throw providerProtocolError('供应商返回了无效的 Base64 填充');
    if (paddingAt !== -1 && combined.length - paddingAt > 2) throw providerProtocolError('供应商返回了无效的 Base64 填充');
    let length = final ? combined.length : Math.max(0, combined.length - 4);
    if (!final && paddingAt !== -1) length = Math.min(length, paddingAt - (paddingAt % 4));
    if (!final) length -= length % 4;
    if (final && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(combined)) throw providerProtocolError('供应商返回了无效的 Base64 图片');
    const encoded = combined.slice(0, length);
    base64Carry = combined.slice(length);
    if (!encoded) return;
    const decoded = Buffer.from(encoded, 'base64');
    decodedBytes += decoded.length;
    if (decodedBytes > MAX_IMAGE_BYTES) throw providerProtocolError('供应商图片超过大小限制');
    if (writer && !writer.write(decoded)) await once(writer, 'drain');
  };

  const closeWriter = async () => {
    if (!writer) return;
    if (!decodedBytes) throw providerProtocolError('供应商返回了空的 Base64 图片');
    writer.end();
    await writerDone;
    if (writerFailure) throw writerFailure;
    writer = undefined;
    writerDone = undefined;
  };

  try {
    for await (const rawToken of tokens as any) {
      const token = rawToken as { name: string; value?: string };
      if (awaitingDataArray && token.name !== 'startArray' && token.name !== 'keyValue') awaitingDataArray = false;
      if (token.name === 'keyValue') {
        if (depth === 1 && token.value === 'data') awaitingDataArray = true;
        else if (itemDepth && depth === itemDepth) currentKey = token.value ?? '';
        continue;
      }
      if (token.name === 'startArray') {
        depth += 1;
        if (awaitingDataArray && depth === 2) dataArrayDepth = depth;
        awaitingDataArray = false;
        continue;
      }
      if (token.name === 'endArray') {
        if (depth === dataArrayDepth) dataArrayDepth = 0;
        depth -= 1;
        currentKey = '';
        continue;
      }
      if (token.name === 'startObject') {
        depth += 1;
        if (dataArrayDepth && depth === dataArrayDepth + 1) {
          itemDepth = depth;
          itemIndex += 1;
          current = { wanted: itemIndex <= count };
        }
        awaitingDataArray = false;
        continue;
      }
      if (token.name === 'endObject') {
        if (itemDepth && depth === itemDepth) {
          if (current?.wanted) {
            if (!current.path && !current.url) throw providerProtocolError('供应商图片条目缺少 b64_json 或 url');
            images.push({ path: current.path, url: current.path ? undefined : current.url });
          }
          current = undefined;
          itemDepth = 0;
        }
        depth -= 1;
        currentKey = '';
        continue;
      }
      if (token.name === 'startString' && current && depth === itemDepth && (currentKey === 'b64_json' || currentKey === 'url')) {
        stringKind = currentKey;
        if (stringKind === 'url') urlValue = '';
        else if (current.wanted) {
          base64Path = await storage.createStagingPath('.image');
          staged.add(base64Path);
          base64Carry = '';
          decodedBytes = 0;
          writer = createWriteStream(base64Path, { flags: 'wx' });
          writerFailure = undefined;
          writerDone = finished(writer).catch((error) => { writerFailure = error; });
        }
        continue;
      }
      if (token.name === 'stringChunk' && stringKind && current) {
        if (stringKind === 'url') {
          if (current.wanted) {
            urlValue += token.value ?? '';
            if (urlValue.length > 2048) throw providerProtocolError('供应商图片地址过长');
          }
        } else if (current.wanted) await writeBase64(token.value ?? '');
        continue;
      }
      if (token.name === 'endString' && stringKind && current) {
        if (stringKind === 'url' && current.wanted) current.url = urlValue;
        else if (stringKind === 'b64_json' && current.wanted) {
          await writeBase64('', true);
          await closeWriter();
          current.path = base64Path;
        }
        stringKind = undefined;
        currentKey = '';
      }
    }
    if (!images.length) throw providerProtocolError('供应商未返回图片数据');
    for (const image of images) if (image.path) staged.delete(image.path);
    return images;
  } catch (error) {
    if (writer) { writer.destroy(); await writerDone; }
    throw error instanceof Error && (error as any).providerFailure ? error : providerProtocolError('供应商返回的 JSON 无法解析');
  } finally {
    await Promise.all([...staged].map((path) => storage.deleteStaged(path).catch(() => undefined)));
  }
}

@Processor('image-generation', { concurrency: securityConfig.workerConcurrency() })
export class GenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerationProcessor.name);
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private storage: StorageService,
    private http: SafeHttpService,
    private quota: QuotaService,
  ) { super(); }

  async process(queueJob: Job<{ jobId: string }>) {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: queueJob.data.jobId },
      select: {
        id: true,
        userId: true,
        mode: true,
        prompt: true,
        parameters: true,
        status: true,
        user: { select: { status: true } },
        model: {
          select: {
            upstreamModelId: true,
            provider: { select: { baseUrl: true, encryptedApiKey: true, encryptedHeaders: true, timeoutSeconds: true } },
          },
        },
      },
    });
    if (!job) return;
    if (job.status === 'CANCELLED' || job.user.status !== 'ACTIVE') { await this.quota.releaseJob(job.userId, job.id); return; }
    if (!job.model) {
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'MODEL_DELETED', errorMessage: '模型已被删除', finishedAt: new Date() } });
      await this.quota.releaseJob(job.userId, job.id);
      return;
    }
    await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date(), errorCode: null, errorMessage: null } });
    try {
      const params = job.parameters as any;
      const headers: Record<string, string> = { Authorization: `Bearer ${this.crypto.decrypt(job.model.provider.encryptedApiKey)}` };
      if (job.model.provider.encryptedHeaders) Object.assign(headers, normalizeProviderHeaders(JSON.parse(this.crypto.decrypt(job.model.provider.encryptedHeaders))) ?? {});
      const endpoint = job.mode === 'TEXT_TO_IMAGE' ? 'images/generations' : 'images/edits';
      const requestParameters = providerImageParameters(job.model.upstreamModelId, job.prompt, params);
      let body: BodyInit;
      if (job.mode === 'TEXT_TO_IMAGE') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(requestParameters);
      } else {
        const form = new FormData();
        for (const [key, value] of Object.entries(requestParameters)) form.set(key, String(value));
        for (const assetId of params.sourceAssetIds) {
          const asset = await this.ownedAsset(job.userId, assetId);
          form.append('image', await openAsBlob(this.storage.filePath(asset.objectKey), { type: asset.mimeType }), asset.originalName ?? 'image.png');
        }
        if (params.maskAssetId) {
          const mask = await this.ownedAsset(job.userId, params.maskAssetId);
          form.set('mask', await openAsBlob(this.storage.filePath(mask.objectKey), { type: mask.mimeType }), 'mask.png');
        }
        body = form;
      }

      const responsePath = await this.storage.createStagingPath('.json');
      let response;
      try {
        response = await this.http.requestToFile(`${job.model.provider.baseUrl}/${endpoint}`, { method: 'POST', headers, body: body as any, redirectPolicy: 'same-origin', signal: AbortSignal.timeout(job.model.provider.timeoutSeconds * 1000) }, responsePath, MAX_GENERATION_RESPONSE_BYTES, MAX_ERROR_BYTES);
      } catch (cause) {
        const error: any = new Error('供应商连接失败、响应过大或请求超时', { cause });
        error.providerConnection = true;
        throw error;
      }
      try {
        if (!response.ok) {
          const fingerprint = providerErrorFingerprint(response.body);
          this.logger.warn(`供应商拒绝任务 ${job.id}：HTTP ${response.status}，responseBytes=${response.body?.length ?? 0}，fingerprint=${fingerprint}`);
          const error: any = new Error(`供应商返回 ${response.status}`);
          error.noRetry = response.status >= 400 && response.status < 500;
          error.providerFailure = providerHttpFailure(response.status);
          throw error;
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json') || !response.filePath) throw providerProtocolError(`供应商返回类型无效：${contentType || 'missing'}`);
        const sources = await parseProviderImages(response.filePath, params.count, this.storage);
        try {
          const [freshUser, freshJob] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: job.userId }, select: { status: true } }),
            this.prisma.generationJob.findUnique({ where: { id: job.id }, select: { status: true } }),
          ]);
          if (!freshUser || freshUser.status !== 'ACTIVE' || !freshJob || freshJob.status === 'CANCELLED') {
            await this.prisma.generationJob.updateMany({ where: { id: job.id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
            await this.quota.releaseJob(job.userId, job.id);
            return;
          }
          for (const source of sources) await this.persistSource(job.userId, job.id, source);
        } finally {
          await Promise.all(sources.map((source) => source.path ? this.storage.deleteStaged(source.path).catch(() => undefined) : Promise.resolve()));
        }
      } finally {
        await this.storage.deleteStaged(responsePath).catch(() => undefined);
      }

      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
      await this.quota.releaseJob(job.userId, job.id);
      if (params.maskAssetId) {
        try { await this.deleteMask(job.userId, params.maskAssetId); }
        catch (error) { this.logger.warn(`任务 ${job.id} 已成功，但遮罩清理失败：${safeErrorMessage(error)}`); }
      }
    } catch (error: any) {
      const finalAttempt = error?.noRetry || queueJob.attemptsMade + 1 >= (queueJob.opts.attempts ?? 1);
      this.logger.warn(`任务 ${job.id} 失败：${safeErrorMessage(error)}`);
      if (finalAttempt) {
        const failure = error?.providerFailure ?? (error?.providerConnection ? { code: 'PROVIDER_CONNECTION', message: '无法连接供应商、响应过大或请求超时，请管理员检查网络、超时和响应限制' } : { code: 'GENERATION_FAILED', message: '图片生成失败' });
        await this.prisma.generationJob.updateMany({ where: { id: job.id }, data: { status: 'FAILED', errorCode: failure.code, errorMessage: failure.message, finishedAt: new Date() } });
        await this.quota.releaseJob(job.userId, job.id);
      }
      if (error?.noRetry) await queueJob.discard();
      throw error;
    }
  }

  private async persistSource(userId: string, jobId: string, source: ProviderImageSource) {
    const rawPath = source.path ?? await this.download(source.url);
    let image;
    try { image = await this.storage.normalizeImageFile(rawPath); }
    finally { await this.storage.deleteStaged(rawPath).catch(() => undefined); }
    try { await this.quota.reserveStorage(userId, image.sizeBytes); }
    catch (error) { await this.storage.deleteStaged(image.path); throw error; }
    let stored;
    try {
      stored = await this.storage.saveStaged(userId, image.path, image.mimeType);
      await this.prisma.asset.create({ data: { userId, jobId, role: 'OUTPUT', objectKey: stored.objectKey, mimeType: image.mimeType, sizeBytes: stored.sizeBytes, width: image.width, height: image.height } });
    } catch (error) {
      await this.storage.deleteStaged(image.path).catch(() => undefined);
      if (stored) await this.storage.delete(stored.objectKey);
      await this.quota.releaseStorage(userId, image.sizeBytes);
      throw error;
    }
  }

  private async ownedAsset(userId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, userId, deletedAt: null },
      select: { objectKey: true, mimeType: true, originalName: true },
    });
    if (!asset) throw new Error('引用图片不存在');
    return asset;
  }

  private async deleteMask(userId: string, id: string) {
    const mask = await this.prisma.asset.findFirst({
      where: { id, userId, role: 'MASK' },
      select: { id: true, objectKey: true, sizeBytes: true },
    });
    if (!mask) return;
    await this.storage.delete(mask.objectKey);
    await this.prisma.asset.delete({ where: { id: mask.id } });
    await this.quota.releaseStorage(userId, mask.sizeBytes);
  }

  private async download(url: unknown) {
    if (typeof url !== 'string') throw providerProtocolError('供应商图片地址无效');
    const destination = await this.storage.createStagingPath('.download');
    try {
      const response = await this.http.requestToFile(url, { method: 'GET', redirectPolicy: 'any', signal: AbortSignal.timeout(60_000) }, destination, MAX_IMAGE_BYTES, MAX_ERROR_BYTES);
      if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) throw providerProtocolError('供应商图片类型无效');
      return destination;
    } catch (error) {
      await this.storage.deleteStaged(destination).catch(() => undefined);
      throw error;
    }
  }
}
