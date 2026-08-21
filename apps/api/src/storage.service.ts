import { Injectable, OnModuleInit } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { ConcurrencyGate } from './concurrency-gate';
import { securityConfig } from './security-config';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY } from './domain-constants';

const execFileAsync = promisify(execFile);

const MAX_IMAGE_PIXELS = 8192 * 8192;

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
};

sharp.cache(false);
sharp.concurrency(1);

@Injectable()
export class StorageService implements OnModuleInit {
  readonly root = resolve(process.env.MEDIA_ROOT ?? resolve(process.cwd(), 'media'));
  readonly stagingRoot = resolve(this.root, '.staging');
  private readonly imageProcessing = new ConcurrencyGate(securityConfig.imageProcessingConcurrency());

  async onModuleInit() {
    await rm(this.stagingRoot, { recursive: true, force: true });
    await mkdir(this.stagingRoot, { recursive: true });
  }

  async createStagingPath(extension = '.tmp') {
    await mkdir(this.stagingRoot, { recursive: true });
    const safeExtension = /^\.[a-z0-9]{1,12}$/i.test(extension) ? extension : '.tmp';
    return resolve(this.stagingRoot, `${randomUUID()}${safeExtension}`);
  }

  async inspectImageFile(path: string, claimedMime?: string) {
    this.assertStagingPath(path);
    return this.imageProcessing.run(() => this.inspectImageFileUnlocked(path, claimedMime));
  }

  async normalizeImageFile(inputPath: string, claimedMime?: string) {
    this.assertStagingPath(inputPath);
    return this.imageProcessing.run(async () => {
      const inspected = await this.inspectImageFileUnlocked(inputPath, claimedMime);
      const outputPath = await this.createStagingPath(MIME_EXT[inspected.mimeType]);
      let pipeline = sharp(inputPath, { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true }).rotate();
      if (inspected.mimeType === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
      else if (inspected.mimeType === 'image/png') pipeline = pipeline.png({ compressionLevel: 9 });
      else pipeline = pipeline.webp({ quality: 95 });
      try {
        const info = await pipeline.toFile(outputPath);
        const file = await stat(outputPath);
        if (file.size > MAX_IMAGE_BYTES) throw new Error('规范化后的图片不能超过 20 MiB');
        return { path: outputPath, sizeBytes: BigInt(file.size), mimeType: inspected.mimeType, width: info.width, height: info.height };
      } catch (error) {
        await this.deleteStaged(outputPath);
        throw error;
      }
    });
  }

  async createThumbnailFile(inputPath: string) {
    this.assertStagingPath(inputPath);
    return this.imageProcessing.run(() => this.createThumbnailUnlocked(inputPath));
  }

  async createThumbnailFromObject(objectKey: string) {
    return this.imageProcessing.run(() => this.createThumbnailUnlocked(this.resolveKey(objectKey)));
  }

  async inspectVideoFile(path: string) {
    this.assertStagingPath(path);
    const file = await stat(path);
    if (file.size > MAX_VIDEO_BYTES) throw new Error('视频不能超过 256 MiB');
    if (file.size < 32) throw new Error('供应商返回了空的视频文件');
    const mp4 = await isMp4File(path);
    let width: number | null = null;
    let height: number | null = null;
    let durationMs: number | null = null;
    try {
      const info = videoInfoFromFfprobe(await probeVideo(path));
      width = info.width;
      height = info.height;
      durationMs = info.durationMs;
    } catch {
      if (!mp4) throw new Error('供应商返回的文件不是有效 MP4 视频，或本机缺少 ffprobe 且无法校验文件头');
    }
    return { path, sizeBytes: BigInt(file.size), mimeType: 'video/mp4' as const, width, height, durationMs };
  }

  async createVideoThumbnailFile(inputPath: string) {
    this.assertStagingPath(inputPath);
    const framePath = await this.createStagingPath('.jpg');
    try {
      await execFileAsync('ffmpeg', ['-y', '-ss', '0', '-i', inputPath, '-frames:v', '1', '-q:v', '3', framePath], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      return await this.imageProcessing.run(() => this.createThumbnailUnlocked(framePath));
    } finally {
      await this.deleteStaged(framePath).catch(() => undefined);
    }
  }

  async resizeMaskFile(objectKey: string, width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('遮罩目标尺寸无效');
    return this.imageProcessing.run(async () => {
      const outputPath = await this.createStagingPath('.png');
      try {
        await sharp(this.resolveKey(objectKey), { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true })
          .resize(width, height, { fit: 'fill', kernel: 'nearest' })
          .png({ compressionLevel: 6 })
          .toFile(outputPath);
        return outputPath;
      } catch (error) {
        await this.deleteStaged(outputPath);
        throw error;
      }
    });
  }

  async saveStaged(userId: string, stagedPath: string, mimeType: string) {
    this.assertStagingPath(stagedPath);
    const ext = MIME_EXT[mimeType] ?? extname(mimeType);
    const objectKey = `${userId}/${randomUUID()}${ext}`;
    const fullPath = this.resolveKey(objectKey);
    await mkdir(dirname(fullPath), { recursive: true });
    await rename(stagedPath, fullPath);
    const file = await stat(fullPath);
    return { objectKey, sizeBytes: BigInt(file.size) };
  }

  filePath(objectKey: string) { return this.resolveKey(objectKey); }
  createReadStream(objectKey: string, range?: { start: number; end: number }) {
    return createReadStream(this.resolveKey(objectKey), range);
  }
  async hashStaged(path: string) { this.assertStagingPath(path); return this.hashFile(path); }
  async hashObject(objectKey: string) { return this.hashFile(this.resolveKey(objectKey)); }
  async delete(objectKey: string) { await rm(this.resolveKey(objectKey), { force: true }); }
  async deleteMany(objectKeys: string[], concurrency = 8) {
    let index = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), objectKeys.length) }, async () => {
      while (index < objectKeys.length) await this.delete(objectKeys[index++]);
    });
    await Promise.all(workers);
  }
  async deleteStaged(path: string) { this.assertStagingPath(path); await rm(path, { force: true }); }

  async deleteUser(userId: string) {
    const path = resolve(this.root, userId);
    if (!path.startsWith(`${this.root}${sep}`) || path === this.stagingRoot) throw new Error('非法存储路径');
    await rm(path, { recursive: true, force: true });
  }

  private async inspectSharp(image: ReturnType<typeof sharp>, claimedMime?: string) {
    const meta = await image.metadata();
    const mime = meta.format === 'jpeg' ? 'image/jpeg' : `image/${meta.format}`;
    if (!MIME_EXT[mime] || (claimedMime && claimedMime !== mime)) throw new Error('仅支持 PNG、JPEG 和 WebP 图片');
    if (!meta.width || !meta.height || meta.width > 8192 || meta.height > 8192) throw new Error('图片尺寸无效或超过 8192 像素');
    return { mimeType: mime, width: meta.width, height: meta.height };
  }

  private async inspectImageFileUnlocked(path: string, claimedMime?: string) {
    const file = await stat(path);
    if (file.size > MAX_IMAGE_BYTES) throw new Error('图片不能超过 20 MiB');
    return this.inspectSharp(sharp(path, { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true }), claimedMime);
  }

  private async createThumbnailUnlocked(inputPath: string) {
    const outputPath = await this.createStagingPath('.webp');
    try {
      const info = await sharp(inputPath, { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true })
        .rotate()
        .resize({ width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: THUMBNAIL_QUALITY, effort: 4 })
        .toFile(outputPath);
      const file = await stat(outputPath);
      return { path: outputPath, sizeBytes: BigInt(file.size), mimeType: 'image/webp', width: info.width, height: info.height };
    } catch (error) {
      await this.deleteStaged(outputPath);
      throw error;
    }
  }

  private assertStagingPath(path: string) {
    const absolute = resolve(path);
    if (!absolute.startsWith(`${this.stagingRoot}${sep}`)) throw new Error('非法临时文件路径');
  }

  private resolveKey(objectKey: string) {
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(`${this.root}${sep}`) || path.startsWith(`${this.stagingRoot}${sep}`)) throw new Error('非法对象键');
    return path;
  }

  private async hashFile(path: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
  }
}

export async function isMp4File(path: string) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    if (bytesRead < 8) return false;
    return buffer.toString('ascii', 4, 8) === 'ftyp';
  } finally {
    await handle.close();
  }
}

export function videoInfoFromFfprobe(payload: unknown) {
  const object = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined;
  const streams = Array.isArray(object?.streams) ? object.streams : [];
  const video = streams.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).codec_type === 'video') as Record<string, unknown> | undefined;
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error('视频尺寸无效或超过 8192 像素');
  }
  const format = object?.format && typeof object.format === 'object' && !Array.isArray(object.format) ? object.format as Record<string, unknown> : undefined;
  const duration = Number(format?.duration ?? video?.duration);
  const durationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null;
  return { width, height, durationMs };
}

async function probeVideo(path: string) {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    throw new Error('无法解析视频文件');
  }
}
