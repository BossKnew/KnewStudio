import { BadRequestException, Body, ConflictException, Controller, Get, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Post, Sse } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Observable, exhaustMap, interval, map, startWith, takeWhile } from 'rxjs';
import { CurrentUser, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { RateLimitService } from './rate-limit.service';
import { QuotaService } from './quota.service';
import { securityConfig } from './security-config';
import { parseBody, safeText, uuidSchema } from './validation';
import { z } from 'zod';
import { accessibleModelWhere, canAccessModel } from './model-access';
import { generationJobSelect, serializeGenerationJob } from './generation-response';

const generationSchema = z.object({
  prompt: safeText(8000), modelId: uuidSchema, mode: z.enum(['TEXT_TO_IMAGE', 'IMAGE_EDIT', 'INPAINT']).optional(),
  size: z.string().max(64).optional(), quality: z.string().max(64).optional(), count: z.number().int().min(1).max(4).optional(),
  sourceAssetIds: z.array(uuidSchema).max(8).optional(), maskAssetId: uuidSchema.nullish(), conversationId: uuidSchema.nullish(),
}).strict();

type GenerationParameters = {
  size?: string;
  quality?: string;
  count?: number;
  sourceAssetIds?: string[];
  maskAssetId?: string | null;
};

function readGenerationParameters(value: unknown): GenerationParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  return {
    size: typeof candidate.size === 'string' ? candidate.size : undefined,
    quality: typeof candidate.quality === 'string' ? candidate.quality : undefined,
    count: typeof candidate.count === 'number' ? candidate.count : undefined,
    sourceAssetIds: Array.isArray(candidate.sourceAssetIds) && candidate.sourceAssetIds.every((id) => typeof id === 'string') ? candidate.sourceAssetIds : undefined,
    maskAssetId: typeof candidate.maskAssetId === 'string' || candidate.maskAssetId === null ? candidate.maskAssetId : undefined,
  };
}

@Controller('generations')
export class GenerationsController {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('image-generation') private queue: Queue,
    private storage: StorageService,
    private limits: RateLimitService,
    private quota: QuotaService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const body = parseBody(generationSchema, raw);
    await this.limits.consume('generation-user', user.id, securityConfig.generationLimit(), 600);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 8000) throw new BadRequestException('提示词长度必须为 1-8000 字符');
    const model = await this.prisma.model.findFirst({ where: { id: body.modelId, enabled: true, mediaKind: 'IMAGE', provider: { enabled: true, archivedAt: null }, ...accessibleModelWhere(user) }, include: { provider: { select: { name: true } } } });
    if (!model) throw new BadRequestException('模型不可用');
    const mode = body.mode ?? 'TEXT_TO_IMAGE';
    if (!['TEXT_TO_IMAGE', 'IMAGE_EDIT', 'INPAINT'].includes(mode)) throw new BadRequestException('生成模式无效');
    if (mode === 'TEXT_TO_IMAGE' && !model.supportsGeneration) throw new BadRequestException('模型不支持文生图');
    if (mode === 'IMAGE_EDIT' && !model.supportsEdit) throw new BadRequestException('模型不支持图片编辑');
    if (mode === 'INPAINT' && !model.supportsInpaint) throw new BadRequestException('模型不支持局部重绘');
    const allowedSizes = model.allowedSizes as string[];
    const allowedQualities = model.allowedQualities as string[];
    const defaults = readGenerationParameters(model.defaults);
    const size = body.size ?? defaults.size ?? allowedSizes[0];
    const quality = body.quality ?? defaults.quality ?? allowedQualities[0];
    const count = Math.min(model.maxImages, Math.max(1, Number(body.count) || 1));
    if (!allowedSizes.includes(size) || !allowedQualities.includes(quality)) throw new BadRequestException('尺寸或质量不受该模型支持');
    const sourceIds = Array.isArray(body.sourceAssetIds) ? body.sourceAssetIds.slice(0, Math.min(8, model.maxInputImages)) : [];
    const assetIds = [...sourceIds, ...(body.maskAssetId ? [body.maskAssetId] : [])];
    const assets = assetIds.length ? await this.prisma.asset.findMany({ where: { id: { in: assetIds }, userId: user.id, deletedAt: null } }) : [];
    if (assets.length !== new Set(assetIds).size) throw new BadRequestException('引用图片不存在');
    if (mode !== 'TEXT_TO_IMAGE' && !sourceIds.length) throw new BadRequestException('编辑模式必须提供原图');
    if (mode === 'INPAINT' && !body.maskAssetId) throw new BadRequestException('局部重绘必须提供遮罩');
    let conversationId = body.conversationId;
    if (conversationId) {
      if (!await this.prisma.conversation.findFirst({ where: { id: conversationId, userId: user.id } })) throw new NotFoundException('会话不存在');
    } else {
      const conversation = await this.prisma.conversation.create({ data: { userId: user.id, title: prompt.slice(0, 30) } });
      conversationId = conversation.id;
    }
    const parameters = { size, quality, count, sourceAssetIds: sourceIds, maskAssetId: body.maskAssetId ?? null };
    await this.quota.reserveJob(user.id);
    let job;
    try { job = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.generationJob.create({ data: {
        userId: user.id, conversationId, modelId: model.id, mode, prompt, parameters,
        modelSnapshot: { displayName: model.displayName, upstreamModelId: model.upstreamModelId, providerName: model.provider.name },
      }});
      if (body.maskAssetId) {
        await transaction.asset.updateMany({ where: { id: body.maskAssetId, userId: user.id }, data: { jobId: created.id, role: 'MASK' } });
      }
      return created;
    }); } catch (error) { await this.quota.releaseJobSlot(user.id); throw error; }
    try {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      await this.queue.add('generate', { jobId: job.id }, { jobId: job.id, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 100 });
    }
    catch (error) {
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'QUEUE_FAILED', errorMessage: '任务提交失败', finishedAt: new Date() } });
      await this.quota.releaseJob(user.id, job.id);
      throw error;
    }
    return { id: job.id, conversationId, status: job.status };
  }

  @Post(':id/retry')
  async retry(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const job = await this.prisma.generationJob.findFirst({
      where: { id, userId: user.id },
      include: { model: { include: { provider: true, allowedGroups: { select: { groupId: true } } } }, assets: { where: { role: 'OUTPUT' } } },
    });
    if (!job) throw new NotFoundException();
    if (job.status !== 'FAILED') throw new ConflictException('只有失败的任务可以重试');
    if (!job.model || !job.model.enabled || !job.model.provider.enabled || job.model.provider.archivedAt || !canAccessModel(user, job.model.allowedGroups)) throw new BadRequestException('原任务使用的模型或供应商已不可用');
    const parameters = readGenerationParameters(job.parameters);
    const sourceAssetIds = parameters.sourceAssetIds ?? [];
    const requiredAssetIds = [...sourceAssetIds, ...(parameters.maskAssetId ? [parameters.maskAssetId] : [])];
    const retryAssets = requiredAssetIds.length ? await this.prisma.asset.findMany({ where: { id: { in: requiredAssetIds }, userId: user.id, deletedAt: null } }) : [];
    if (retryAssets.length !== new Set(requiredAssetIds).size) throw new BadRequestException(job.mode === 'INPAINT' ? '原任务的参考图或遮罩已不存在，无法重试' : '原任务的参考图已不存在，无法重试');

    const claimed = await this.prisma.generationJob.updateMany({
      where: { id: job.id, userId: user.id, status: 'FAILED' },
      data: { status: 'QUEUED', errorCode: null, errorMessage: null, startedAt: null, finishedAt: null },
    });
    if (!claimed.count) throw new ConflictException('任务状态已变化，请刷新后重试');

    try {
      await this.quota.reacquireJob(user.id, job.id);
      const outputBytes = job.assets.reduce((sum, asset) => sum + BigInt(asset.sizeBytes ?? 0), 0n);
      for (const asset of job.assets) await this.storage.delete(asset.objectKey);
      await this.prisma.asset.deleteMany({ where: { jobId: job.id, role: 'OUTPUT' } });
      if (outputBytes) await this.quota.releaseStorage(user.id, outputBytes);
    } catch (error) {
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'RETRY_PREPARE_FAILED', errorMessage: '重试准备失败', finishedAt: new Date() } });
      await this.quota.releaseJob(user.id, job.id);
      throw error;
    }

    try {
      await this.queue.add('generate', { jobId: job.id }, { jobId: `retry-${job.id}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 100 });
    } catch (error) {
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'RETRY_QUEUE_FAILED', errorMessage: '重试任务提交失败', finishedAt: new Date() } });
      await this.quota.releaseJob(user.id, job.id);
      throw error;
    }
    await this.prisma.conversation.update({ where: { id: job.conversationId }, data: { updatedAt: new Date() } });
    return { id: job.id, conversationId: job.conversationId, status: 'QUEUED' };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const job = await this.prisma.generationJob.findFirst({ where: { id, userId: user.id }, select: generationJobSelect });
    if (!job) throw new NotFoundException();
    return serializeGenerationJob(job);
  }

  @Sse(':id/events')
  events(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let innerSubscription: { unsubscribe(): void } | undefined;
      let release: (() => Promise<void>) | undefined;
      let releaseRequested = false;
      let released = false;
      let previousVersion = '';

      const requestRelease = () => {
        releaseRequested = true;
        if (!release || released) return;
        released = true;
        void release().catch(() => undefined);
      };

      void this.quota.acquireSse(user.id).then((releaseFn) => {
        release = releaseFn;
        if (releaseRequested || subscriber.closed) {
          requestRelease();
          return;
        }

        innerSubscription = interval(securityConfig.ssePollIntervalMs()).pipe(
          startWith(0),
          exhaustMap(() => this.prisma.generationJob.findFirst({ where: { id, userId: user.id }, select: generationJobSelect })),
          takeWhile((job) => Boolean(job) && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job!.status), true),
          map((job) => {
            const version = job ? JSON.stringify([
              job.status,
              job.errorMessage,
              job.assets.map((asset) => [asset.id, asset.width, asset.height, asset.mimeType, asset.sizeBytes.toString(), asset.note, asset.deletedAt]),
            ]) : 'NOT_FOUND';
            if (version === previousVersion) return { type: 'heartbeat', data: '' };
            previousVersion = version;
            return { data: job ? serializeGenerationJob(job) : { error: 'NOT_FOUND' } };
          }),
        ).subscribe(subscriber);
      }).catch((error: unknown) => {
        if (!subscriber.closed) subscriber.error(error);
      });

      return () => {
        innerSubscription?.unsubscribe();
        requestRelease();
      };
    });
  }

}
