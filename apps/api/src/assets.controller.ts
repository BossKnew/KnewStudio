import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';
import { QuotaService } from './quota.service';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';
import { parseBody } from './validation';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { diskStorage } from 'multer';

const noteSchema = z.object({ note: z.string().max(1000).nullable() }).strict();

@Controller()
export class AssetsController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private quota: QuotaService,
  ) {}

  @Post('uploads')
  @UseInterceptors(UploadAdmissionInterceptor, FileInterceptor('file', {
    limits: { fileSize: 20 * 1024 * 1024 },
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
    try { await this.quota.reserveStorage(user.id, image.sizeBytes); }
    catch (error) { await this.storage.deleteStaged(image.path); throw error; }
    let stored;
    try { stored = await this.storage.saveStaged(user.id, image.path, image.mimeType); }
    catch (error) { await this.storage.deleteStaged(image.path); await this.quota.releaseStorage(user.id, image.sizeBytes); throw error; }
    const role = isMaskUpload(body) ? 'MASK' : 'UPLOAD';
    let asset;
    try {
      asset = await this.prisma.asset.create({ data: {
        userId: user.id, role, objectKey: stored.objectKey, mimeType: image.mimeType, sizeBytes: stored.sizeBytes,
        width: image.width, height: image.height, originalName: file.originalname.replace(/[\r\n]/g, '').slice(0, 255),
      }});
    } catch (error) {
      await this.storage.delete(stored.objectKey);
      await this.quota.releaseStorage(user.id, stored.sizeBytes);
      throw error;
    }
    return this.serialize(asset);
  }

  @Get('assets')
  async list(@CurrentUser() user: AuthUser) {
    const assets = await this.prisma.asset.findMany({
      where: { userId: user.id, role: { in: ['UPLOAD', 'OUTPUT'] }, deletedAt: null },
      include: { job: { select: { prompt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return assets.map((asset) => this.serialize(asset));
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
  async content(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() response: Response) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      select: { objectKey: true, mimeType: true, sizeBytes: true },
    });
    if (!asset) throw new NotFoundException();
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (process.env.MEDIA_X_ACCEL_REDIRECT === 'true') {
      const safeObjectKey = asset.objectKey.split('/').map(encodeURIComponent).join('/');
      response.setHeader('X-Accel-Redirect', `/_protected_media/${safeObjectKey}`);
      response.end();
      return;
    }
    response.setHeader('Content-Length', asset.sizeBytes.toString());
    const stream = this.storage.createReadStream(asset.objectKey);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  @Delete('assets/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      select: { id: true, objectKey: true, sizeBytes: true },
    });
    if (!asset) throw new NotFoundException();
    await this.storage.delete(asset.objectKey);
    await this.prisma.asset.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.quota.releaseStorage(user.id, asset.sizeBytes);
    return { ok: true };
  }

  private serialize<T extends { id: string; objectKey: string; sizeBytes: bigint; deletedAt: Date | null; note: string | null; job?: { prompt: string } | null }>(asset: T): Record<string, unknown> {
    const { job, ...storedAsset } = asset;
    return {
      ...storedAsset,
      note: storedAsset.note ?? null,
      generationPrompt: job?.prompt ?? null,
      sizeBytes: asset.sizeBytes.toString(),
      deleted: Boolean(storedAsset.deletedAt),
      contentUrl: storedAsset.deletedAt ? null : `/api/v1/assets/${asset.id}/content`,
      objectKey: undefined,
    };
  }
}

function isMaskUpload(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).role === 'MASK');
}
