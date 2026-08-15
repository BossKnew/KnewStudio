import { Body, ConflictException, Controller, Delete, Get, HttpException, HttpStatus, Logger, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles, safeErrorMessage, type AuthUser } from './common';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { MAX_ERROR_BYTES, SafeHttpService } from './safe-http.service';
import { parseBody, safeText } from './validation';
import { z } from 'zod';
import { normalizeProviderHeaders } from './provider-headers';

const headersSchema = z.record(z.string().max(128), z.string().max(4096));
const providerCreateSchema = z.object({ name: safeText(64), baseUrl: z.string().max(2048), apiKey: z.string().min(1).max(16_384), headers: headersSchema.optional(), timeoutSeconds: z.number().int().min(10).max(600).optional(), enabled: z.boolean().optional() }).strict();
const providerUpdateSchema = providerCreateSchema.partial().strict();

function providerTestError(status: number) {
  if (status === 401 || status === 403) return '供应商认证失败，请检查 API Key、令牌分组及访问权限';
  if (status === 404) return '模型列表接口不存在，请检查 Base URL 是否包含正确的 /v1';
  if (status === 429) return '供应商限流或账户额度不足';
  if (status >= 500) return '供应商服务暂时不可用';
  return '模型列表接口测试失败';
}

@Roles('ADMIN')
@Controller('admin/providers')
export class ProvidersController {
  private readonly logger = new Logger(ProvidersController.name);
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private http: SafeHttpService = {
      validateBaseUrl: (value: unknown) => String(value).replace(/\/$/, ''),
      request: async (url: string, init: any) => {
        const response = await fetch(url, init);
        const body = typeof (response as any).arrayBuffer === 'function' ? Buffer.from(await response.arrayBuffer()) : Buffer.from('{"data":[]}');
        return { ok: response.ok, status: response.status, headers: response.headers ?? new Headers({ 'content-type': 'application/json' }), body, url };
      },
    } as any,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.provider.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { models: true } } } });
    return rows.map(({ encryptedApiKey, encryptedHeaders, ...row }) => ({ ...row, apiKeyMasked: encryptedApiKey ? '••••••••' : '', hasCustomHeaders: Boolean(encryptedHeaders) }));
  }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = parseBody(providerCreateSchema, raw);
    const provider = await this.prisma.provider.create({ data: {
      name: body.name.trim(), baseUrl: this.http.validateBaseUrl(body.baseUrl), adapterKind: 'openai-images', encryptedApiKey: this.crypto.encrypt(body.apiKey),
      encryptedHeaders: body.headers ? this.crypto.encrypt(JSON.stringify(normalizeProviderHeaders(body.headers))) : null,
      timeoutSeconds: Math.min(600, Math.max(10, Number(body.timeoutSeconds) || 180)), enabled: body.enabled !== false,
    }});
    await this.audit(actor.id, 'provider.created', provider.id);
    return { id: provider.id };
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(providerUpdateSchema, raw);
    await this.prisma.provider.update({ where: { id }, data: {
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      ...(body.baseUrl !== undefined ? { baseUrl: this.http.validateBaseUrl(body.baseUrl) } : {}),
      ...(body.apiKey ? { encryptedApiKey: this.crypto.encrypt(body.apiKey) } : {}),
      ...(body.headers !== undefined ? { encryptedHeaders: body.headers ? this.crypto.encrypt(JSON.stringify(normalizeProviderHeaders(body.headers))) : null } : {}),
      ...(body.timeoutSeconds !== undefined ? { timeoutSeconds: body.timeoutSeconds } : {}),
      ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
    }});
    await this.audit(actor.id, 'provider.updated', id);
    return { ok: true };
  }

  @Post(':id/test')
  async test(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentUser() actor?: AuthUser) {
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + 120_000);
    const claimed = await this.prisma.provider.updateMany({
      where: { id, archivedAt: null, OR: [{ testCooldownUntil: null }, { testCooldownUntil: { lte: now } }] },
      data: { testCooldownUntil: cooldownUntil, lastTestOk: null },
    });
    if (!claimed.count) {
      const current = await this.prisma.provider.findUniqueOrThrow({ where: { id }, select: { testCooldownUntil: true } });
      const retryAfterSeconds = Math.max(1, Math.ceil(((current.testCooldownUntil?.getTime() ?? now.getTime()) - now.getTime()) / 1000));
      throw new HttpException({ message: `请等待 ${retryAfterSeconds} 秒后再次测试`, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const provider = await this.prisma.provider.findUniqueOrThrow({ where: { id } });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.crypto.decrypt(provider.encryptedApiKey)}` };
    if (provider.encryptedHeaders) Object.assign(headers, normalizeProviderHeaders(JSON.parse(this.crypto.decrypt(provider.encryptedHeaders))) ?? {});
    try {
      const response = await this.http.request(`${provider.baseUrl}/models`, { method: 'GET', headers, redirectPolicy: 'same-origin', signal: AbortSignal.timeout(Math.min(provider.timeoutSeconds, 30) * 1000) }, MAX_ERROR_BYTES);
      const contentType = response.headers.get('content-type') ?? '';
      let modelsPayload = false;
      if (response.ok && contentType.includes('application/json')) {
        try { modelsPayload = Array.isArray(JSON.parse(response.body.toString('utf8'))?.data); } catch { /* invalid JSON */ }
      }
      const ok = response.ok && modelsPayload;
      const error = response.ok && !modelsPayload ? '接口返回的不是模型列表，请检查 Base URL 是否包含正确的 /v1' : providerTestError(response.status);
      const result = { ok, status: response.status, ...(ok ? {} : { error }), cooldownUntil };
      if (!ok) this.logger.warn(`供应商 ${id} 的 /models 测试失败：HTTP ${response.status}，content-type=${contentType || 'missing'}`);
      await this.prisma.provider.update({ where: { id }, data: { lastTestOk: ok } });
      if (actor) await this.audit(actor.id, 'provider.tested', id);
      return result;
    } catch (error) {
      const result = { ok: false, error: '供应商连接失败', cooldownUntil };
      this.logger.warn(`供应商 ${id} 连接测试失败：${safeErrorMessage(error)}`);
      await this.prisma.provider.update({ where: { id }, data: { lastTestOk: false } });
      if (actor) await this.audit(actor.id, 'provider.tested', id);
      return result;
    }
  }

  @Delete(':id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const activeJobs = await transaction.generationJob.count({ where: { model: { providerId: id }, status: { in: ['QUEUED', 'RUNNING'] } } });
      if (activeJobs) throw new ConflictException('该供应商仍有正在排队或运行的任务，请等待任务完成后再删除');
      await transaction.model.deleteMany({ where: { providerId: id } });
      await transaction.provider.delete({ where: { id } });
      await transaction.auditLog.create({ data: { actorId: actor.id, action: 'provider.deleted', targetType: 'provider', targetId: id } });
      return { ok: true };
    });
  }

  private audit(actorId: string, action: string, targetId: string) {
    return this.prisma.auditLog.create({ data: { actorId, action, targetType: 'provider', targetId } });
  }
}
