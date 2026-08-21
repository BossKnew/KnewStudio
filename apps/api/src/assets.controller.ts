import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';
import { parseBody, uuidSchema } from './validation';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { diskStorage } from 'multer';
import { MAX_IMAGE_BYTES } from './domain-constants';
import { AssetLifecycleService } from './asset-lifecycle.service';
import { cursorWhere, decodeCursor, encodeCursor, pageLimit } from './pagination';
import { serializeAssetLinks } from './asset-response';
import { canReadAsset, canShareAsset, canUnshareAsset } from './asset-access';

const noteSchema = z.object({ note: z.string().max(1000).nullable() }).strict();
const shareSchema = z.object({ groupIds: z.array(uuidSchema).max(100) }).strict();
const shareSelect = { id: true, groupId: true, createdAt: true, group: { select: { id: true, name: true } } } as const;

@Controller()
export class AssetsController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private lifecycle: AssetLifecycleService,
  ) {}

  @Post('uploads')
  @UseInterceptors(UploadAdmissionInterceptor, FileInterceptor('file', {
    limits: { fileSize: MAX_IMAGE_BYTES },
    storage: diskStorage({
      destination: (_request, _file, callback) => {
        const directory = resolve(process.env.MEDIA_ROOT ?? resolve(process.cwd(), 'media'), '.staging');
        mkdirSync(directory, { recursive: true });
        callback(null, directory);
      },
      filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`),
    }),
  }))
  async upload(@CurrentUser() user: AuthUser, @Body() body: unknown, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('请选择图片');
    let image;
    try { image = await this.storage.normalizeImageFile(file.path, file.mimetype); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    finally { await this.storage.deleteStaged(file.path); }
    const role = isMaskUpload(body) ? 'MASK' : 'UPLOAD';
    const asset = await this.lifecycle.persistNormalized({
      userId: user.id, role, image,
      originalName: file.originalname.replace(/[\r\n]/g, '').slice(0, 255),
    });
    return this.serializeOwned(asset);
  }

  @Get('assets')
  async list(@CurrentUser() user: AuthUser, @Query('limit') rawLimit?: string, @Query('cursor') rawCursor?: string, @Query('mediaKind') rawKind?: string) {
    const limit = pageLimit(rawLimit, 40);
    const cursor = decodeCursor(rawCursor);
    const mediaKind = rawKind === 'IMAGE' || rawKind === 'VIDEO' ? rawKind as 'IMAGE' | 'VIDEO' : undefined;
    const where = { userId: user.id, role: { in: ['UPLOAD' as const, 'OUTPUT' as const] }, deletedAt: null, ...(mediaKind ? { mediaKind } : {}), ...cursorWhere('createdAt', cursor) };
    const [rows, total] = await Promise.all([this.prisma.asset.findMany({
      where,
      include: { job: { select: { prompt: true } }, thumbnail: { select: { id: true, deletedAt: true } }, shares: { select: { groupId: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }), this.prisma.asset.count({ where: { userId: user.id, role: { in: ['UPLOAD', 'OUTPUT'] }, deletedAt: null, ...(mediaKind ? { mediaKind } : {}) } })]);
    const hasMore = rows.length > limit;
    const assets = rows.slice(0, limit);
    const last = assets.at(-1);
    return { items: assets.map((asset) => this.serializeOwned(asset)), nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null, total };
  }

  @Get('assets/shared')
  async shared(@CurrentUser() user: AuthUser, @Query('limit') rawLimit?: string, @Query('cursor') rawCursor?: string, @Query('groupId') rawGroupId?: string) {
    const limit = pageLimit(rawLimit, 40);
    const cursor = decodeCursor(rawCursor);
    const groupId = rawGroupId ? parseGroupId(rawGroupId) : undefined;
    const visibleGroupIds = await this.visibleGroupIds(user, groupId);
    if (!visibleGroupIds.length) return { items: [], nextCursor: null, total: 0 };
    const where = {
      groupId: { in: visibleGroupIds },
      asset: { deletedAt: null, role: { in: ['UPLOAD' as const, 'OUTPUT' as const] } },
      ...cursorWhere('createdAt', cursor),
    };
    const [rows, total] = await Promise.all([
      this.prisma.assetShare.findMany({
        where,
        include: {
          group: { select: { id: true, name: true } },
          sharedBy: { select: { displayName: true, username: true } },
          asset: { include: { thumbnail: { select: { id: true, deletedAt: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      this.prisma.assetShare.count({ where }),
    ]);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map((row) => this.serializeShared(row, user)), nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null, total };
  }

  @Get('assets/:id/shares')
  async shares(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id, userId: user.id, deletedAt: null }, select: { id: true } });
    if (!asset) throw new NotFoundException();
    const items = await this.prisma.assetShare.findMany({
      where: { assetId: id },
      orderBy: { createdAt: 'asc' },
      select: shareSelect,
    });
    return { items: items.map((item) => ({ id: item.id, groupId: item.groupId, createdAt: item.createdAt, group: item.group })) };
  }

  @Put('assets/:id/shares')
  async replaceShares(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(shareSchema, raw);
    const groupIds = [...new Set(body.groupIds)];
    if (groupIds.length !== body.groupIds.length) throw new BadRequestException('用户组不能重复');
    const asset = await this.prisma.asset.findFirst({ where: { id, deletedAt: null }, select: { id: true, userId: true, role: true, deletedAt: true } });
    if (!canShareAsset(user, asset)) throw new NotFoundException();
    const allowedGroupIds = user.role === 'ADMIN' ? groupIds : groupIds.filter((groupId) => (user.groupIds ?? []).includes(groupId));
    if (allowedGroupIds.length !== groupIds.length) throw new BadRequestException('只能分享到你所属的用户组');
    if (groupIds.length && await this.prisma.userGroup.count({ where: { id: { in: groupIds } } }) !== groupIds.length) throw new BadRequestException('包含不存在的用户组');

    const current = await this.prisma.assetShare.findMany({ where: { assetId: id }, select: { groupId: true } });
    const currentIds = new Set(current.map(({ groupId }) => groupId));
    const nextIds = new Set(groupIds);
    const added = groupIds.filter((groupId) => !currentIds.has(groupId));
    const removed = current.map(({ groupId }) => groupId).filter((groupId) => !nextIds.has(groupId));

    await this.prisma.$transaction(async (tx) => {
      if (removed.length) await tx.assetShare.deleteMany({ where: { assetId: id, groupId: { in: removed } } });
      if (added.length) await tx.assetShare.createMany({ data: added.map((groupId) => ({ assetId: id, groupId, sharedById: user.id })) });
      if (added.length) await tx.auditLog.create({ data: { actorId: user.id, action: 'asset.shared', targetType: 'asset', targetId: id, metadata: { groupIds: added } } });
      if (removed.length) await tx.auditLog.create({ data: { actorId: user.id, action: 'asset.unshared', targetType: 'asset', targetId: id, metadata: { groupIds: removed } } });
    });

    const items = await this.prisma.assetShare.findMany({ where: { assetId: id }, orderBy: { createdAt: 'asc' }, select: shareSelect });
    return { items: items.map((item) => ({ id: item.id, groupId: item.groupId, createdAt: item.createdAt, group: item.group })) };
  }

  @Delete('assets/:id/shares/:groupId')
  async unshare(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('groupId', new ParseUUIDPipe({ version: '4' })) groupId: string,
  ) {
    const asset = await this.prisma.asset.findFirst({ where: { id, deletedAt: null }, select: { id: true, userId: true, deletedAt: true } });
    if (!canUnshareAsset(user, asset)) throw new NotFoundException();
    const result = await this.prisma.assetShare.deleteMany({ where: { assetId: id, groupId } });
    if (!result.count) throw new NotFoundException();
    await this.prisma.auditLog.create({ data: { actorId: user.id, action: 'asset.unshared', targetType: 'asset', targetId: id, metadata: { groupIds: [groupId] } } });
    return { ok: true };
  }

  @Patch('assets/:id')
  async updateNote(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() raw: unknown) {
    const body = parseBody(noteSchema, raw);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 1000) throw new BadRequestException('备注不能超过 1000 个字符');
    const asset = await this.prisma.asset.findFirst({ where: { id, userId: user.id, deletedAt: null }, select: { id: true } });
    if (!asset) throw new NotFoundException();
    const updated = await this.prisma.asset.update({ where: { id }, data: { note: note || null }, select: { id: true, note: true } });
    return updated;
  }

  @Get('assets/:id/content')
  async content(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() response: Response, @Req() request?: Request) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, deletedAt: null },
      select: {
        objectKey: true, mimeType: true, sizeBytes: true, userId: true, role: true, deletedAt: true,
        shares: { select: { groupId: true } },
        thumbnailFor: { select: { userId: true, role: true, deletedAt: true, shares: { select: { groupId: true } } } },
      },
    });
    if (!canReadAsset(user, asset)) throw new NotFoundException();
    response.setHeader('Content-Type', asset!.mimeType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Accept-Ranges', 'bytes');
    if (process.env.MEDIA_X_ACCEL_REDIRECT === 'true') {
      const safeObjectKey = asset!.objectKey.split('/').map(encodeURIComponent).join('/');
      response.setHeader('X-Accel-Redirect', `/_protected_media/${safeObjectKey}`);
      response.end();
      return;
    }
    const size = Number(asset!.sizeBytes);
    const range = parseByteRange(request?.headers?.range, size);
    if (range) {
      response.status(206);
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      response.setHeader('Content-Length', String(range.end - range.start + 1));
      const stream = this.storage.createReadStream(asset!.objectKey, range);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
      return;
    }
    response.setHeader('Content-Length', asset!.sizeBytes.toString());
    const stream = this.storage.createReadStream(asset!.objectKey);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  @Delete('assets/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    if (!await this.lifecycle.remove(user.id, id)) throw new NotFoundException();
    return { ok: true };
  }

  private async visibleGroupIds(user: AuthUser, groupId?: string) {
    if (user.role === 'ADMIN') {
      if (!groupId) return [];
      return [groupId];
    }
    const memberships = user.groupIds ?? [];
    if (groupId) {
      if (!memberships.includes(groupId)) throw new BadRequestException('无权访问该用户组');
      return [groupId];
    }
    return memberships;
  }

  private serializeOwned<T extends { id: string; objectKey: string; sizeBytes: bigint; deletedAt: Date | null; note: string | null; contentHash?: string | null; job?: { prompt: string } | null; thumbnail?: { id: string; deletedAt: Date | null } | null; shares?: Array<{ groupId: string }> }>(asset: T): Record<string, unknown> {
    const { job, thumbnail, contentHash: _contentHash, shares, ...storedAsset } = asset;
    return {
      ...storedAsset,
      note: storedAsset.note ?? null,
      generationPrompt: job?.prompt ?? null,
      visibility: 'owned',
      sharedGroupIds: shares?.map(({ groupId }) => groupId) ?? [],
      sizeBytes: asset.sizeBytes.toString(),
      ...serializeAssetLinks({ id: asset.id, deletedAt: storedAsset.deletedAt, thumbnail }),
      objectKey: undefined,
    };
  }

  private serializeShared(row: {
    id: string;
    createdAt: Date;
    group: { id: string; name: string };
    sharedBy: { displayName: string | null; username: string };
    asset: { id: string; userId: string; role: string; mimeType: string; mediaKind?: string; durationMs?: number | null; sizeBytes: bigint; width: number | null; height: number | null; deletedAt: Date | null; objectKey: string; note: string | null; thumbnail?: { id: string; deletedAt: Date | null } | null };
  }, user: AuthUser): Record<string, unknown> {
    return {
      id: row.asset.id,
      shareId: row.id,
      role: row.asset.role,
      mimeType: row.asset.mimeType,
      mediaKind: row.asset.mediaKind ?? 'IMAGE',
      durationMs: row.asset.durationMs ?? null,
      width: row.asset.width,
      height: row.asset.height,
      sizeBytes: row.asset.sizeBytes.toString(),
      visibility: 'shared',
      sharedAt: row.createdAt,
      group: row.group,
      sharedBy: { displayName: row.sharedBy.displayName || row.sharedBy.username },
      canUnshare: row.asset.userId === user.id || user.role === 'ADMIN',
      note: null,
      generationPrompt: null,
      ...serializeAssetLinks({ id: row.asset.id, deletedAt: row.asset.deletedAt, thumbnail: row.asset.thumbnail }),
    };
  }
}

function isMaskUpload(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).role === 'MASK');
}

export function parseByteRange(header: unknown, size: number) {
  if (typeof header !== 'string' || !header.startsWith('bytes=') || !Number.isInteger(size) || size <= 0) return null;
  const spec = header.slice(6).split(',')[0]?.trim();
  if (!spec) return null;
  const [startRaw, endRaw] = spec.split('-');
  let start: number;
  let end: number;
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' || endRaw === undefined ? size - 1 : Number(endRaw);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= size || start > end) return null;
  return { start, end };
}

function parseGroupId(raw: string) {
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('用户组无效');
  return parsed.data;
}
