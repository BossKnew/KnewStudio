import { BadRequestException, Body, ConflictException, Controller, Get, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Post, Query, Sse } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Observable } from 'rxjs';
import { CurrentUser, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { RateLimitService } from './rate-limit.service';
import { QuotaService } from './quota.service';
import { securityConfig } from './security-config';
import { parseBody, safeText, uuidSchema } from './validation';
import { z } from 'zod';
import { accessibleModelWhere, canAccessModel } from './model-access';
import { generationJobSelect, serializeGenerationJob } from './generation-response';
import { AssetLifecycleService } from './asset-lifecycle.service';
import { GENERATION_QUEUE_OPTIONS, isVideoGenerationMode } from './domain-constants';
import { GenerationEventsService } from './generation-events.service';
import { GenerationLifecycleService } from './generation-lifecycle.service';
import { serializeAssetLinks } from './asset-response';
import { accessibleReferencedAssetWhere, accessibleSourceWhere } from './asset-access';

const generationSchema = z.object({
  prompt: safeText(8000), modelId: uuidSchema, mode: z.enum(['TEXT_TO_IMAGE', 'IMAGE_EDIT', 'INPAINT', 'TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO']).optional(),
  size: z.string().max(64).optional(), quality: z.string().max(64).optional(), count: z.number().int().min(1).max(4).optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
  sourceAssetIds: z.array(uuidSchema).max(8).optional(), maskAssetId: uuidSchema.nullish(), conversationId: uuidSchema.nullish(),
}).strict();

type GenerationParameters = {
  size?: string;
  quality?: string;
  count?: number;
  durationSeconds?: number;
  sourceAssetIds?: string[];
  maskAssetId?: string | null;
};

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

export function conversationTitleFromPrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (CJK.test(trimmed)) return Array.from(trimmed).slice(0, 10).join('');
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 4).join(' ');
  return Array.from(trimmed).slice(0, 10).join('');
}

function readGenerationParameters(value: unknown): GenerationParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  return {
    size: typeof candidate.size === 'string' ? candidate.size : undefined,
    quality: typeof candidate.quality === 'string' ? candidate.quality : undefined,
    count: typeof candidate.count === 'number' ? candidate.count : undefined,
    durationSeconds: typeof candidate.durationSeconds === 'number' ? candidate.durationSeconds : undefined,
    sourceAssetIds: Array.isArray(candidate.sourceAssetIds) && candidate.sourceAssetIds.every((id) => typeof id === 'string') ? candidate.sourceAssetIds : undefined,
    maskAssetId: typeof candidate.maskAssetId === 'string' || candidate.maskAssetId === null ? candidate.maskAssetId : undefined,
  };
}

@Controller('generations')
export class GenerationsController {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('image-generation') private queue: Queue,
    @InjectQueue('video-generation') private videoQueue: Queue,
    private limits: RateLimitService,
    private quota: QuotaService,
    private assets: AssetLifecycleService,
    private lifecycle: GenerationLifecycleService,
    private generationEvents: GenerationEventsService,
  ) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const body = parseBody(generationSchema, raw);
    await this.limits.consume('generation-user', user.id, securityConfig.generationLimit(), 600);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 8000) throw new BadRequestException('提示词长度必须为 1-8000 字符');
    const model = await this.prisma.model.findFirst({ where: { id: body.modelId, enabled: true, provider: { enabled: true, archivedAt: null }, ...accessibleModelWhere(user) }, include: { provider: { select: { name: true } } } });
    if (!model) throw new BadRequestException('模型不可用');
    const videoModel = model.mediaKind === 'VIDEO';
    const mode = body.mode ?? (videoModel ? 'TEXT_TO_VIDEO' : 'TEXT_TO_IMAGE');
    if (videoModel !== isVideoGenerationMode(mode)) throw new BadRequestException('生成模式与模型类型不匹配');
    if (!videoModel && !['TEXT_TO_IMAGE', 'IMAGE_EDIT', 'INPAINT'].includes(mode)) throw new BadRequestException('生成模式无效');
    if (mode === 'TEXT_TO_IMAGE' && !model.supportsGeneration) throw new BadRequestException('模型不支持文生图');
    if (mode === 'IMAGE_EDIT' && !model.supportsEdit) throw new BadRequestException('模型不支持图片编辑');
    if (mode === 'INPAINT' && !model.supportsInpaint) throw new BadRequestException('模型不支持局部重绘');
    if (mode === 'TEXT_TO_VIDEO' && !model.supportsGeneration) throw new BadRequestException('模型不支持文生视频');
    if (mode === 'IMAGE_TO_VIDEO' && !model.supportsEdit) throw new BadRequestException('模型不支持图生视频');
    const allowedSizes = model.allowedSizes as string[];
    const allowedQualities = (model.allowedQualities as string[]) ?? [];
    const allowedDurations = Array.isArray(model.allowedDurations) ? (model.allowedDurations as number[]) : [];
    const defaults = readGenerationParameters(model.defaults);
    const size = body.size ?? defaults.size ?? allowedSizes[0];
    const quality = body.quality ?? defaults.quality ?? allowedQualities[0];
    const count = videoModel ? 1 : Math.min(model.maxImages, Math.max(1, Number(body.count) || 1));
    const durationSeconds = videoModel ? (body.durationSeconds ?? defaults.durationSeconds ?? allowedDurations[0]) : undefined;
    if (!allowedSizes.includes(size)) throw new BadRequestException(videoModel ? '比例不受该模型支持' : '尺寸或质量不受该模型支持');
    if (allowedQualities.length ? !allowedQualities.includes(quality) : Boolean(body.quality)) throw new BadRequestException(videoModel ? '分辨率不受该模型支持' : '尺寸或质量不受该模型支持');
    if (videoModel && (typeof durationSeconds !== 'number' || !allowedDurations.includes(durationSeconds))) throw new BadRequestException('时长不受该模型支持');
    const sourceIds = Array.isArray(body.sourceAssetIds) ? [...new Set(body.sourceAssetIds)] : [];
    if (sourceIds.length > 8) throw new BadRequestException('参考图最多支持 8 张');
    if (sourceIds.length > model.maxInputImages) throw new BadRequestException(`该模型最多支持 ${model.maxInputImages} 张参考图`);
    if ((mode === 'TEXT_TO_IMAGE' || mode === 'TEXT_TO_VIDEO') && sourceIds.length) throw new BadRequestException(mode === 'TEXT_TO_VIDEO' ? '文生视频不支持参考图' : '文生图不支持参考图');
    const assetIds = [...sourceIds, ...(body.maskAssetId ? [body.maskAssetId] : [])];
    const assets = assetIds.length ? await this.prisma.asset.findMany({ where: { id: { in: assetIds }, ...accessibleReferencedAssetWhere(user) } }) : [];
    if (assets.length !== new Set(assetIds).size) throw new BadRequestException('引用图片不存在');
    if (assets.some((asset) => asset.mediaKind === 'VIDEO')) throw new BadRequestException('视频不能作为参考图');
    if (mode !== 'TEXT_TO_IMAGE' && mode !== 'TEXT_TO_VIDEO' && !sourceIds.length) throw new BadRequestException(mode === 'IMAGE_TO_VIDEO' ? '图生视频必须提供参考图' : '编辑模式必须提供原图');
    if (mode === 'INPAINT' && !body.maskAssetId) throw new BadRequestException('局部重绘必须提供遮罩');
    if (videoModel && body.maskAssetId) throw new BadRequestException('视频生成不支持遮罩');
    let conversationId = body.conversationId;
    if (conversationId) {
      if (!await this.prisma.conversation.findFirst({ where: { id: conversationId, userId: user.id } })) throw new NotFoundException('会话不存在');
    }
    const parameters = { size, quality, count, ...(durationSeconds !== undefined ? { durationSeconds } : {}), sourceAssetIds: sourceIds, maskAssetId: body.maskAssetId ?? null };
    let job;
    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const targetConversationId = conversationId ?? (await transaction.conversation.create({ data: { userId: user.id, title: conversationTitleFromPrompt(prompt) } })).id;
        const promptUsedAt = new Date();
        await transaction.promptEntry.upsert({
          where: { userId_prompt: { userId: user.id, prompt } },
          create: { userId: user.id, prompt, usageCount: 1, lastUsedAt: promptUsedAt },
          update: { usageCount: { increment: 1 }, lastUsedAt: promptUsedAt },
        });
        const created = await transaction.generationJob.create({ data: {
          userId: user.id, conversationId: targetConversationId, modelId: model.id, mediaKind: videoModel ? 'VIDEO' : 'IMAGE', mode, prompt, parameters, imageCount: count,
          modelSnapshot: { displayName: model.displayName, upstreamModelId: model.upstreamModelId, providerName: model.provider.name },
        }});
        await this.quota.reserveJobInTransaction(transaction, user, videoModel ? 0 : count, { jobId: created.id, modelId: model.id, kind: 'SUBMIT', videoSeconds: videoModel ? durationSeconds : 0 });
        if (body.maskAssetId) await transaction.asset.updateMany({ where: { id: body.maskAssetId, userId: user.id }, data: { jobId: created.id, role: 'MASK' } });
        return { created, targetConversationId };
      });
      job = result.created;
      conversationId = result.targetConversationId;
    } catch (error) { throw error; }
    try {
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      await (videoModel ? this.videoQueue : this.queue).add('generate', { jobId: job.id }, { jobId: job.id, ...GENERATION_QUEUE_OPTIONS });
      await this.lifecycle.publish(user.id, job.id);
    }
    catch (error) {
      await this.lifecycle.finish(user.id, job.id, 'FAILED', { code: 'QUEUE_FAILED', message: '任务提交失败' });
      throw error;
    }
    return { id: job.id, conversationId, status: job.status };
  }

  @Get(':id/reuse')
  async reuse(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const job = await this.prisma.generationJob.findFirst({
      where: { id, userId: user.id },
      select: { modelId: true, mode: true, prompt: true, parameters: true, modelSnapshot: true },
    });
    if (!job) throw new NotFoundException();
    const parameters = readGenerationParameters(job.parameters);
    const sourceAssetIds = [...new Set(parameters.sourceAssetIds ?? [])];
    const sourceRows = sourceAssetIds.length ? await this.prisma.asset.findMany({
      where: { id: { in: sourceAssetIds }, ...accessibleSourceWhere(user) },
      select: {
        id: true, userId: true, role: true, width: true, height: true, mimeType: true, sizeBytes: true, note: true, deletedAt: true,
        thumbnail: { select: { id: true, deletedAt: true } },
        job: { select: { prompt: true } },
      },
    }) : [];
    if (sourceRows.length !== sourceAssetIds.length) throw new BadRequestException('历史参考图已不存在，无法恢复');
    const sourceById = new Map(sourceRows.map((asset) => [asset.id, asset]));
    const snapshot = job.modelSnapshot && typeof job.modelSnapshot === 'object' && !Array.isArray(job.modelSnapshot) ? job.modelSnapshot as Record<string, unknown> : {};
    const modelDisplayName = typeof snapshot.displayName === 'string' && snapshot.displayName.trim() ? snapshot.displayName : 'Unknown model';
    return {
      prompt: job.prompt,
      mode: job.mode,
      modelId: job.modelId,
      modelDisplayName,
      size: parameters.size ?? null,
      quality: parameters.quality ?? null,
      count: Math.max(1, Number(parameters.count) || 1),
      durationSeconds: parameters.durationSeconds ?? null,
      sourceAssets: sourceAssetIds.map((assetId) => {
        const asset = sourceById.get(assetId)!;
        const owned = asset.userId === user.id;
        return {
          id: asset.id,
          role: asset.role,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes.toString(),
          visibility: owned ? 'owned' : 'shared',
          note: owned ? asset.note ?? null : null,
          generationPrompt: owned ? asset.job?.prompt ?? null : null,
          ...serializeAssetLinks(asset),
        };
      }),
      requiresMaskRedraw: job.mode === 'INPAINT',
    };
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
    const retryAssets = requiredAssetIds.length ? await this.prisma.asset.findMany({ where: { id: { in: requiredAssetIds }, ...accessibleReferencedAssetWhere(user) } }) : [];
    if (retryAssets.length !== new Set(requiredAssetIds).size) throw new BadRequestException(job.mode === 'INPAINT' ? '原任务的参考图或遮罩已不存在，无法重试' : '原任务的参考图已不存在，无法重试');

    const retryVideo = isVideoGenerationMode(job.mode);
    await this.quota.reacquireJob(user, job.id, retryVideo ? 0 : (job.imageCount || Math.max(1, Number(parameters.count) || 1)), job.modelId, retryVideo ? (parameters.durationSeconds ?? 0) : 0);
    try {
      await this.assets.removeJobOutputs(user.id, job.id);
    } catch (error) {
      await this.lifecycle.finish(user.id, job.id, 'FAILED', { code: 'RETRY_PREPARE_FAILED', message: '重试准备失败' });
      throw error;
    }

    try {
      await (retryVideo ? this.videoQueue : this.queue).add('generate', { jobId: job.id }, { jobId: `retry-${job.id}-${Date.now()}`, ...GENERATION_QUEUE_OPTIONS });
      await this.lifecycle.publish(user.id, job.id);
    } catch (error) {
      await this.lifecycle.finish(user.id, job.id, 'FAILED', { code: 'RETRY_QUEUE_FAILED', message: '重试任务提交失败' });
      throw error;
    }
    await this.prisma.conversation.update({ where: { id: job.conversationId }, data: { updatedAt: new Date() } });
    return { id: job.id, conversationId: job.conversationId, status: 'QUEUED' };
  }

  @Get('status')
  async statuses(@CurrentUser() user: AuthUser, @Query('ids') rawIds?: string) {
    const ids = [...new Set((rawIds ?? '').split(',').filter(Boolean))];
    if (!ids.length || ids.length > 3 || ids.some((id) => !uuidSchema.safeParse(id).success)) throw new BadRequestException('ids 必须包含 1-3 个任务 ID');
    const jobs = await this.prisma.generationJob.findMany({ where: { id: { in: ids }, userId: user.id }, select: generationJobSelect });
    const byId = new Map(jobs.map((job) => [job.id, job]));
    return ids.flatMap((id) => { const job = byId.get(id); return job ? [serializeGenerationJob(job)] : []; });
  }

  @Sse('events')
  events(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let releaseQuota: (() => Promise<void>) | undefined;
      let unsubscribe: (() => Promise<void>) | undefined;
      let closed = false;
      const heartbeat = setInterval(() => { if (!subscriber.closed) subscriber.next({ type: 'heartbeat', data: '' }); }, 15_000);
      heartbeat.unref?.();

      void (async () => {
        releaseQuota = await this.quota.acquireSse(user.id);
        if (closed) { await releaseQuota(); return; }
        unsubscribe = await this.generationEvents.subscribe(user.id, (job) => { if (!subscriber.closed) subscriber.next({ data: job }); });
        if (closed) await unsubscribe();
      })().catch((error: unknown) => { if (!subscriber.closed) subscriber.error(error); });

      return () => {
        closed = true;
        clearInterval(heartbeat);
        void unsubscribe?.().catch(() => undefined);
        void releaseQuota?.().catch(() => undefined);
      };
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const job = await this.prisma.generationJob.findFirst({ where: { id, userId: user.id }, select: generationJobSelect });
    if (!job) throw new NotFoundException();
    return serializeGenerationJob(job);
  }

}
