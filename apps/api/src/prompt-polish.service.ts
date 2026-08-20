import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { MAX_ERROR_BYTES, SafeHttpService } from './safe-http.service';
import { providerRequestHeaders } from './provider-credentials';
import { safeErrorMessage } from './common';
import {
  DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT,
  MAX_PROMPT_POLISH_RESPONSE_BYTES,
  PROMPT_POLISH_SETTING_ID,
  PROMPT_POLISH_TEST_COOLDOWN_MS,
  PROMPT_POLISH_TEST_PROMPT,
} from './prompt-polish.constants';

const MAX_SYSTEM_PROMPT_LENGTH = 16_000;

type PromptPolishConfigInput = {
  providerName: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  timeoutSeconds?: number;
  enabled?: boolean;
  systemPrompt?: string | null;
};

type PromptPolishSettingRow = {
  id: string;
  providerName: string;
  baseUrl: string;
  encryptedApiKey: string;
  modelId: string;
  timeoutSeconds: number;
  enabled: boolean;
  systemPrompt: string | null;
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
  ) {}

  async adminSettings() {
    const setting = await this.prisma.promptPolishSetting.findUnique({ where: { id: PROMPT_POLISH_SETTING_ID } });
    if (!setting) {
      return {
        configured: false,
        providerName: '',
        baseUrl: '',
        modelId: '',
        timeoutSeconds: 60,
        enabled: false,
        systemPrompt: '',
        usingDefaultSystemPrompt: true,
        apiKeyMasked: '',
        hasApiKey: false,
        testCooldownUntil: null,
        lastTestOk: null,
      };
    }
    return {
      configured: Boolean(setting.encryptedApiKey),
      providerName: setting.providerName,
      baseUrl: setting.baseUrl,
      modelId: setting.modelId,
      timeoutSeconds: setting.timeoutSeconds,
      enabled: setting.enabled,
      systemPrompt: setting.systemPrompt ?? '',
      usingDefaultSystemPrompt: !setting.systemPrompt?.trim(),
      apiKeyMasked: setting.encryptedApiKey ? '••••••••' : '',
      hasApiKey: Boolean(setting.encryptedApiKey),
      testCooldownUntil: setting.testCooldownUntil,
      lastTestOk: setting.lastTestOk,
    };
  }

  async save(input: PromptPolishConfigInput) {
    const existing = await this.prisma.promptPolishSetting.findUnique({ where: { id: PROMPT_POLISH_SETTING_ID } });
    const suppliedApiKey = input.apiKey?.trim();
    const encryptedApiKey = suppliedApiKey ? this.crypto.encrypt(suppliedApiKey) : existing?.encryptedApiKey;
    if (!encryptedApiKey) throw new BadRequestException('提示词润色 API Key 必填');
    const providerName = input.providerName.trim();
    const modelId = input.modelId.trim();
    const baseUrl = this.http.validateBaseUrl(input.baseUrl);
    const timeoutSeconds = Math.min(600, Math.max(10, Number(input.timeoutSeconds) || 60));
    const systemPrompt = input.systemPrompt === undefined
      ? existing?.systemPrompt ?? null
      : typeof input.systemPrompt === 'string' && input.systemPrompt.trim()
        ? input.systemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH)
        : null;
    await this.prisma.promptPolishSetting.upsert({
      where: { id: PROMPT_POLISH_SETTING_ID },
      create: {
        id: PROMPT_POLISH_SETTING_ID,
        providerName,
        baseUrl,
        encryptedApiKey,
        modelId,
        timeoutSeconds,
        enabled: input.enabled !== false,
        systemPrompt,
      },
      update: {
        providerName,
        baseUrl,
        encryptedApiKey,
        modelId,
        timeoutSeconds,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        systemPrompt,
        testCooldownUntil: null,
        lastTestOk: null,
      },
    });
    return this.adminSettings();
  }

  async polish(prompt: string) {
    const setting = await this.usableSetting();
    return { polishedPrompt: await this.complete(setting, prompt) };
  }

  async test() {
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + PROMPT_POLISH_TEST_COOLDOWN_MS);
    const claimed = await this.prisma.promptPolishSetting.updateMany({
      where: { id: PROMPT_POLISH_SETTING_ID, OR: [{ testCooldownUntil: null }, { testCooldownUntil: { lte: now } }] },
      data: { testCooldownUntil: cooldownUntil, lastTestOk: null },
    });
    if (!claimed.count) {
      const current = await this.prisma.promptPolishSetting.findUnique({ where: { id: PROMPT_POLISH_SETTING_ID }, select: { testCooldownUntil: true } });
      if (!current) throw new BadRequestException('请先保存提示词润色配置');
      const retryAfterSeconds = Math.max(1, Math.ceil(((current.testCooldownUntil?.getTime() ?? now.getTime()) - now.getTime()) / 1000));
      throw new HttpException({ message: `请等待 ${retryAfterSeconds} 秒后再次测试`, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const setting = await this.prisma.promptPolishSetting.findUnique({ where: { id: PROMPT_POLISH_SETTING_ID } });
    if (!setting) throw new BadRequestException('请先保存提示词润色配置');
    try {
      await this.complete(setting, PROMPT_POLISH_TEST_PROMPT);
      await this.prisma.promptPolishSetting.update({ where: { id: PROMPT_POLISH_SETTING_ID }, data: { lastTestOk: true } });
      return { ok: true, cooldownUntil };
    } catch (error) {
      this.logger.warn(`提示词润色供应商测试失败：${safeErrorMessage(error)}`);
      await this.prisma.promptPolishSetting.update({ where: { id: PROMPT_POLISH_SETTING_ID }, data: { lastTestOk: false } });
      return { ok: false, error: error instanceof Error ? error.message : '提示词润色供应商测试失败', cooldownUntil };
    }
  }

  audit(actorId: string, action: string, metadata?: any) {
    return this.prisma.auditLog.create({ data: { actorId, action, targetType: 'prompt-polish', targetId: PROMPT_POLISH_SETTING_ID, ...(metadata ? { metadata } : {}) } });
  }

  private async usableSetting(): Promise<PromptPolishSettingRow> {
    const setting = await this.prisma.promptPolishSetting.findUnique({ where: { id: PROMPT_POLISH_SETTING_ID } });
    if (!setting || !setting.encryptedApiKey) throw new ServiceUnavailableException('提示词润色尚未配置');
    if (!setting.enabled) throw new ServiceUnavailableException('提示词润色未启用');
    return setting;
  }

  private async complete(setting: PromptPolishSettingRow, prompt: string) {
    const headers = providerRequestHeaders(this.crypto, setting);
    headers['Content-Type'] = 'application/json';
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
              { role: 'system', content: setting.systemPrompt?.trim() || DEFAULT_PROMPT_POLISH_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
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
