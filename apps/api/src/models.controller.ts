import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { parseBody, safeText, uuidSchema } from './validation';
import { z } from 'zod';
import { accessibleModelWhere } from './model-access';
import { ACTIVE_JOB_STATUSES, mediaKindForAdapter } from './domain-constants';

const defaults = { size: 'auto', quality: 'standard', count: 1 };
const sizes = ['auto'];
const qualities = ['standard'];
const optionValueSchema = z.string().trim().min(1).max(64);
const sizeOptionSchema = z.array(optionValueSchema).max(20);
const optionSchema = z.array(optionValueSchema).max(20);
const durationsSchema = z.array(z.number().int().min(1).max(60)).max(20);
const groupIdsSchema = z.array(uuidSchema).max(100);
const modelSchema = z.object({
  providerId: uuidSchema, displayName: safeText(128), upstreamModelId: safeText(256),
  allowedSizes: sizeOptionSchema.optional(), allowedQualities: optionSchema.optional(), allowedDurations: durationsSchema.optional(),
  supportsGeneration: z.boolean().optional(), supportsEdit: z.boolean().optional(), supportsInpaint: z.boolean().optional(),
  maxImages: z.number().int().min(1).max(4).optional(), maxInputImages: z.number().int().min(1).max(8).optional(),
  defaults: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional(), sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
  allowedGroupIds: groupIdsSchema.optional(),
}).strict();

@Controller()
export class ModelsController {
  constructor(private prisma: PrismaService) {}

  @Get('models')
  async publicModels(@CurrentUser() user: AuthUser) {
    return this.prisma.model.findMany({
      where: { enabled: true, provider: { enabled: true, archivedAt: null }, ...accessibleModelWhere(user) },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      select: { id: true, displayName: true, mediaKind: true, supportsGeneration: true, supportsEdit: true, supportsInpaint: true, allowedSizes: true, allowedQualities: true, allowedDurations: true, maxImages: true, maxInputImages: true, defaults: true },
    });
  }

  @Roles('ADMIN') @Get('admin/models')
  adminModels() {
    return this.prisma.model.findMany({ where: { provider: { archivedAt: null } }, orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }], include: { provider: { select: { id: true, name: true, adapterKind: true } }, allowedGroups: { select: { groupId: true, group: { select: { id: true, name: true } } } } } });
  }

  @Roles('ADMIN') @Post('admin/models')
  async create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const body = parseBody(modelSchema, raw);
    await this.assertGroupsExist(body.allowedGroupIds ?? []);
    const model = await this.prisma.model.create({ data: { ...await this.data(body), allowedGroups: { create: (body.allowedGroupIds ?? []).map((groupId) => ({ groupId })) } } });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'model.created', targetType: 'model', targetId: model.id } });
    return model;
  }

  @Roles('ADMIN') @Patch('admin/models/:id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(modelSchema.partial().strict(), raw);
    const current = await this.prisma.model.findUniqueOrThrow({ where: { id } });
    const merged = { ...current, ...body };
    this.validate(merged);
    if (body.allowedGroupIds) await this.assertGroupsExist(body.allowedGroupIds);
    const model = await this.prisma.model.update({ where: { id }, data: {
      ...await this.data(merged),
      ...(body.allowedGroupIds ? { allowedGroups: { deleteMany: {}, create: body.allowedGroupIds.map((groupId) => ({ groupId })) } } : {}),
    } });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'model.updated', targetType: 'model', targetId: id } });
    return model;
  }

  @Roles('ADMIN') @Delete('admin/models/:id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.prisma.$transaction(async (tx) => {
      const activeJobs = await tx.generationJob.count({ where: { modelId: id, status: { in: [...ACTIVE_JOB_STATUSES] } } });
      if (activeJobs) throw new ConflictException('该模型仍有正在排队或运行的任务，请等待任务完成后再删除');
      await tx.model.delete({ where: { id } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'model.deleted', targetType: 'model', targetId: id } });
      return { ok: true };
    });
  }

  private validate(body: any) {
    if (!body.providerId || !String(body.displayName ?? '').trim() || !String(body.upstreamModelId ?? '').trim()) throw new BadRequestException('供应商、显示名称和模型 ID 必填');
    if (!Array.isArray(body.allowedSizes ?? sizes) || !Array.isArray(body.allowedQualities ?? qualities)) throw new BadRequestException('尺寸和质量必须为数组');
  }

  private async data(body: any) {
    const provider = await this.prisma.provider.findUnique({ where: { id: body.providerId }, select: { adapterKind: true } });
    if (!provider) throw new BadRequestException('供应商不存在');
    const mediaKind = mediaKindForAdapter(provider.adapterKind);
    const requestedSizes = body.allowedSizes ?? (mediaKind === 'VIDEO' ? ['16:9', '9:16', '1:1'] : sizes);
    const allowedSizes = requestedSizes.length ? requestedSizes : (mediaKind === 'VIDEO' ? ['16:9'] : sizes);
    const allowedQualities = Array.isArray(body.allowedQualities) ? body.allowedQualities : (mediaKind === 'VIDEO' ? [] : qualities);
    if (mediaKind === 'IMAGE' && !allowedQualities.length) throw new BadRequestException('质量必须为数组');
    const allowedDurations = mediaKind === 'VIDEO' ? uniqueDurations(body.allowedDurations) : [];
    if (mediaKind === 'VIDEO' && !allowedDurations.length) throw new BadRequestException('视频模型必须配置至少一种时长');
    const requestedDefaults = body.defaults && typeof body.defaults === 'object' ? body.defaults : defaults;
    const defaultSize = typeof requestedDefaults.size === 'string' && allowedSizes.includes(requestedDefaults.size) ? requestedDefaults.size : allowedSizes[0];
    const defaultQuality = allowedQualities.length
      ? (typeof requestedDefaults.quality === 'string' && allowedQualities.includes(requestedDefaults.quality) ? requestedDefaults.quality : allowedQualities[0])
      : undefined;
    const maxImages = mediaKind === 'VIDEO' ? 1 : Math.min(4, Math.max(1, Number(body.maxImages) || 1));
    const defaultCount = mediaKind === 'VIDEO' ? 1 : Math.min(maxImages, Math.max(1, Number(requestedDefaults.count) || 1));
    const defaultDuration = mediaKind === 'VIDEO'
      ? (Number.isInteger(requestedDefaults.durationSeconds) && allowedDurations.includes(requestedDefaults.durationSeconds) ? requestedDefaults.durationSeconds : allowedDurations[0])
      : undefined;
    return {
      providerId: body.providerId, displayName: String(body.displayName).trim(), upstreamModelId: String(body.upstreamModelId).trim(), mediaKind,
      supportsGeneration: body.supportsGeneration !== false, supportsEdit: Boolean(body.supportsEdit), supportsInpaint: mediaKind === 'VIDEO' ? false : Boolean(body.supportsInpaint),
      allowedSizes, allowedQualities, allowedDurations,
      maxImages, maxInputImages: Math.min(8, Math.max(1, Number(body.maxInputImages) || 1)),
      defaults: { ...requestedDefaults, size: defaultSize, ...(defaultQuality !== undefined ? { quality: defaultQuality } : { quality: undefined }), count: defaultCount, ...(defaultDuration !== undefined ? { durationSeconds: defaultDuration } : {}) },
      enabled: body.enabled !== false, sortOrder: Number(body.sortOrder) || 0,
    };
  }

  private async assertGroupsExist(groupIds: string[]) {
    const uniqueIds = [...new Set(groupIds)];
    if (uniqueIds.length !== groupIds.length) throw new BadRequestException('用户组不能重复');
    if (!uniqueIds.length) return;
    const count = await this.prisma.userGroup.count({ where: { id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new BadRequestException('包含不存在的用户组');
  }
}

function uniqueDurations(value: unknown) {
  const source = Array.isArray(value) && value.length ? value : [5, 10];
  const durations = [...new Set(source.filter((item) => Number.isInteger(item) && item >= 1 && item <= 60))];
  return durations;
}
