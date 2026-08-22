import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { MAX_ERROR_BYTES, SafeHttpService } from './safe-http.service';
import { providerRequestHeaders } from './provider-credentials';
import { safeErrorMessage, type AuthUser } from './common';
import { accessibleSourceWhere } from './asset-access';
import { fileToDataUrl } from './image-data-url';
import {
  DEFAULT_PROMPT_POLISH_IMAGE_EDIT_SYSTEM_PROMPT,
  DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT,
  DEFAULT_PROMPT_POLISH_VIDEO_SYSTEM_PROMPT,
  MAX_PROMPT_POLISH_RESPONSE_BYTES,
  PROMPT_POLISH_TEST_COOLDOWN_MS,
  PROMPT_POLISH_TEST_PROMPT,
} from './prompt-polish.constants';

const MAX_SYSTEM_PROMPT_LENGTH = 16_000;

type PromptPolishConfigInput = {
  name?: string;
  providerName: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  timeoutSeconds?: number;
  enabled?: boolean;
  systemPrompt?: string | null;
  supportsImageEdit?: boolean;
};

type PromptPolishSettingRow = {
  id: string;
  name: string;
  providerName: string;
  baseUrl: string;
  encryptedApiKey: string;
  modelId: string;
  timeoutSeconds: number;
  enabled: boolean;
  systemPrompt: string | null;
  supportsImageEdit: boolean;
  testCooldownUntil: Date | null;
  lastTestOk: boolean | null;
};

export type PromptPolishAdminItem = {
  id: string;
  name: string;
  providerName: string;
  baseUrl: string;
  modelId: string;
  timeoutSeconds: number;
  enabled: boolean;
  systemPrompt: string;
  supportsImageEdit: boolean;
  usingDefaultSystemPrompt: boolean;
  hasApiKey: boolean;
  testCooldownUntil: Date | null;
  lastTestOk: boolean | null;
};

@Injectable()
export class PromptPolishService {
  private readonly logger = new Logger(PromptPolishService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private http: SafeHttpService,
    private storage: StorageService,
  ) {}

  async list() {
    const rows = await this.prisma.promptPolishSetting.findMany({ orderBy: { createdAt: 'asc' } });
    return { items: rows.map((row) => this.toAdminItem(row)) };
  }

  async save(input: PromptPolishConfigInput, id?: string) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('供应商名称必填');
    const suppliedApiKey = input.apiKey?.trim();
    const providerName = input.providerName.trim();
    const modelId = input.modelId.trim();
    const baseUrl = this.http.validateBaseUrl(input.baseUrl);
    const timeoutSeconds = Math.min(600, Math.max(10, Number(input.timeoutSeconds) || 60));
    const systemPrompt = typeof input.systemPrompt === 'string' && input.systemPrompt.trim()
      ? input.systemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH)
      : null;

    if (id) {
      const existing = await this.prisma.promptPolishSetting.findUnique({ where: { id } });
      if (!existing) throw new BadRequestException('配置不存在');
      const encryptedApiKey = suppliedApiKey ? this.crypto.encrypt(suppliedApiKey) : existing.encryptedApiKey;
      if (!encryptedApiKey) throw new BadRequestException('提示词润色 API Key 必填');
      const updateData = {
        name,
        providerName,
        baseUrl,
        encryptedApiKey,
        modelId,
        timeoutSeconds,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.supportsImageEdit !== undefined ? { supportsImageEdit: input.supportsImageEdit } : {}),
        systemPrompt: input.systemPrompt === undefined ? existing.systemPrompt : systemPrompt,
        testCooldownUntil: null,
        lastTestOk: null,
      };
      const updated = await this.prisma.$transaction(async (tx) => {
        if (input.enabled === true) {
          await tx.promptPolishSetting.updateMany({ where: { id: { not: id }, enabled: true }, data: { enabled: false } });
        }
        return tx.promptPolishSetting.update({ where: { id }, data: updateData });
      });
      return this.toAdminItem(updated);
    }

    const encryptedApiKey = suppliedApiKey ? this.crypto.encrypt(suppliedApiKey) : undefined;
    if (!encryptedApiKey) throw new BadRequestException('提示词润色 API Key 必填');
    const enabled = input.enabled !== false;
    const createData = {
      id: randomUUID(),
      name,
      providerName,
      baseUrl,
      encryptedApiKey,
      modelId,
      timeoutSeconds,
      enabled,
      systemPrompt,
      supportsImageEdit: input.supportsImageEdit === true,
    };
    const created = await this.prisma.$transaction(async (tx) => {
      if (enabled) {
        await tx.promptPolishSetting.updateMany({ where: { enabled: true }, data: { enabled: false } });
      }
      return tx.promptPolishSetting.create({ data: createData });
    });
    return this.toAdminItem(created);
  }

  async remove(id: string) {
    const result = await this.prisma.promptPolishSetting.deleteMany({ where: { id } });
    if (!result.count) throw new BadRequestException('配置不存在');
    return { ok: true };
  }

  async polish(user: AuthUser, prompt: string, mode: 'TEXT_TO_IMAGE' | 'IMAGE_EDIT' | 'TEXT_TO_VIDEO' = 'TEXT_TO_IMAGE', sourceAssetId?: string) {
    const setting = await this.usableSetting();
    let imageDataUrl: string | undefined;
    if (mode === 'IMAGE_EDIT') {
      if (!setting.supportsImageEdit) throw new BadRequestException('该模型未启用图片编辑提示词润色，请联系管理员');
      if (!sourceAssetId) throw new BadRequestException('图片编辑提示词润色需要参考图');
      const asset = await this.prisma.asset.findFirst({
        where: { id: sourceAssetId, ...accessibleSourceWhere(user) },
        select: { objectKey: true, mimeType: true },
      });
      if (!asset) throw new BadRequestException('引用图片不存在');
      imageDataUrl = await fileToDataUrl(this.storage.filePath(asset.objectKey), asset.mimeType);
    } else if (sourceAssetId) {
      throw new BadRequestException('参考图仅用于图片编辑提示词润色');
    }
    return { polishedPrompt: await this.complete(setting, prompt, mode, imageDataUrl) };
  }

  async test(id: string) {
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + PROMPT_POLISH_TEST_COOLDOWN_MS);
    const claimed = await this.prisma.promptPolishSetting.updateMany({
      where: { id, OR: [{ testCooldownUntil: null }, { testCooldownUntil: { lte: now } }] },
      data: { testCooldownUntil: cooldownUntil, lastTestOk: null },
    });
    if (!claimed.count) {
      const current = await this.prisma.promptPolishSetting.findUnique({ where: { id }, select: { testCooldownUntil: true } });
      if (!current) throw new BadRequestException('配置不存在');
      const retryAfterSeconds = Math.max(1, Math.ceil(((current.testCooldownUntil?.getTime() ?? now.getTime()) - now.getTime()) / 1000));
      throw new HttpException({ message: `请等待 ${retryAfterSeconds} 秒后再次测试`, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const setting = await this.prisma.promptPolishSetting.findUnique({ where: { id } });
    if (!setting) throw new BadRequestException('配置不存在');
    try {
      await this.complete(setting, PROMPT_POLISH_TEST_PROMPT);
      await this.prisma.promptPolishSetting.update({ where: { id }, data: { lastTestOk: true } });
      return { ok: true, cooldownUntil };
    } catch (error) {
      this.logger.warn(`提示词润色供应商测试失败：${safeErrorMessage(error)}`);
      await this.prisma.promptPolishSetting.update({ where: { id }, data: { lastTestOk: false } });
      return { ok: false, error: error instanceof Error ? error.message : '提示词润色供应商测试失败', cooldownUntil };
    }
  }

  audit(actorId: string, action: string, targetId: string, metadata?: any) {
    return this.prisma.auditLog.create({ data: { actorId, action, targetType: 'prompt-polish', targetId, ...(metadata ? { metadata } : {}) } });
  }

  private async usableSetting(): Promise<PromptPolishSettingRow> {
    const setting = await this.prisma.promptPolishSetting.findFirst({ where: { enabled: true } });
    if (!setting) throw new ServiceUnavailableException('提示词润色未启用');
    return setting;
  }

  private toAdminItem(setting: PromptPolishSettingRow): PromptPolishAdminItem {
    return {
      id: setting.id,
      name: setting.name,
      providerName: setting.providerName,
      baseUrl: setting.baseUrl,
      modelId: setting.modelId,
      timeoutSeconds: setting.timeoutSeconds,
      enabled: setting.enabled,
      systemPrompt: setting.systemPrompt ?? '',
      supportsImageEdit: setting.supportsImageEdit,
      usingDefaultSystemPrompt: !setting.systemPrompt?.trim(),
      hasApiKey: Boolean(setting.encryptedApiKey),
      testCooldownUntil: setting.testCooldownUntil,
      lastTestOk: setting.lastTestOk,
    };
  }

  private async complete(setting: PromptPolishSettingRow, prompt: string, mode: 'TEXT_TO_IMAGE' | 'IMAGE_EDIT' | 'TEXT_TO_VIDEO' = 'TEXT_TO_IMAGE', imageDataUrl?: string) {
    const headers = providerRequestHeaders(this.crypto, setting);
    headers['Content-Type'] = 'application/json';
    const systemPrompt = mode === 'TEXT_TO_VIDEO'
      ? DEFAULT_PROMPT_POLISH_VIDEO_SYSTEM_PROMPT
      : mode === 'IMAGE_EDIT'
        ? DEFAULT_PROMPT_POLISH_IMAGE_EDIT_SYSTEM_PROMPT
        : (setting.systemPrompt?.trim() || DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT);
    let response;
    try {
      response = await this.http.request(
        `${setting.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: setting.modelId,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: imageDataUrl ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } }] : prompt },
            ],
          }),
          redirectPolicy: 'same-origin',
          signal: AbortSignal.timeout(setting.timeoutSeconds * 1000),
        },
        MAX_PROMPT_POLISH_RESPONSE_BYTES,
        MAX_ERROR_BYTES,
      );
    } catch (cause) {
      const error: any = new Error('供应商连接失败、响应过大或请求超时', { cause });
      error.promptPolishFailure = true;
      throw error;
    }

    if (!response.ok) {
      const error: any = new Error(this.httpFailureMessage(response.status));
      error.noRetry = true;
      throw error;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) throw new Error('供应商响应格式无效');
    let payload: any;
    try { payload = JSON.parse(response.body.toString('utf8')); }
    catch { throw new Error('供应商响应格式无效'); }
    const content = payload?.choices?.[0]?.message?.content;
    const result = typeof content === 'string'
      ? content.trim()
      : Array.isArray(content)
        ? content.filter((item: any) => item && item.type === 'text' && typeof item.text === 'string').map((item: any) => item.text).join('').trim()
        : '';
    if (!result) throw new Error('供应商未返回有效的润色提示词');
    if (result.length > 8000) throw new Error('供应商返回的润色提示词超过 8000 个字符');
    return result;
  }

  private httpFailureMessage(status: number) {
    if (status === 400 || status === 422) return '供应商拒绝了提示词润色请求，请检查模型 ID 和请求格式';
    if (status === 401 || status === 403) return '大语言模型供应商认证失败，请检查 API Key';
    if (status === 404) return '大语言模型接口或模型不存在，请检查 Base URL 和模型 ID';
    if (status === 429) return '大语言模型供应商限流或账户额度不足';
    if (status >= 500) return '大语言模型供应商服务暂时不可用';
    return '大语言模型供应商请求失败';
  }
}
