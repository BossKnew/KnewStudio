import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { StorageService, videoInfoFromFfprobe } from './storage.service';

describe('StorageService', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'knewstudio-')); process.env.MEDIA_ROOT = root; });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('validates, saves and reads a private image', async () => {
    const service = new StorageService();
    const buffer = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#fff' } }).png().toBuffer();
    const inputPath = await service.createStagingPath('.png');
    await writeFile(inputPath, buffer, { flag: 'wx' });
    const expectedHash = createHash('sha256').update(buffer).digest('hex');
    await expect(service.hashStaged(inputPath)).resolves.toBe(expectedHash);
    const image = await service.inspectImageFile(inputPath, 'image/png');
    const stored = await service.saveStaged('user-1', inputPath, image.mimeType);
    expect(stored.objectKey.startsWith('user-1/')).toBe(true);
    expect(await readFile(service.filePath(stored.objectKey))).toEqual(buffer);
    await expect(service.hashObject(stored.objectKey)).resolves.toBe(expectedHash);
  });

  it('rejects object keys that escape the media root', async () => {
    const service = new StorageService();
    expect(() => service.filePath('../secret.png')).toThrow('非法对象键');
  });

  it('normalizes and atomically promotes a staged image without whole-file buffers', async () => {
    const service = new StorageService();
    const inputPath = await service.createStagingPath('.upload');
    const buffer = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#123456' } }).png().toBuffer();
    await writeFile(inputPath, buffer, { flag: 'wx' });
    const image = await service.normalizeImageFile(inputPath, 'image/png');
    expect(image).toMatchObject({ mimeType: 'image/png', width: 32, height: 24 });
    const stored = await service.saveStaged('user-1', image.path, image.mimeType);
    expect((await readFile(service.filePath(stored.objectKey))).length).toBe(Number(stored.sizeBytes));
    await service.deleteStaged(inputPath);
  });

  it('rejects staged paths outside the isolated staging directory', async () => {
    const service = new StorageService();
    await expect(service.deleteStaged(join(root, 'user-file.png'))).rejects.toThrow('非法临时文件路径');
  });

  it('creates bounded WebP thumbnails and exact-size provider masks', async () => {
    const service = new StorageService();
    const inputPath = await service.createStagingPath('.png');
    await writeFile(inputPath, await sharp({ create: { width: 1024, height: 512, channels: 4, background: '#fff' } }).png().toBuffer(), { flag: 'wx' });
    const thumbnail = await service.createThumbnailFile(inputPath);
    expect(thumbnail).toMatchObject({ mimeType: 'image/webp', width: 512, height: 256 });

    const stored = await service.saveStaged('user-1', inputPath, 'image/png');
    const resizedMask = await service.resizeMaskFile(stored.objectKey, 800, 400);
    const metadata = await sharp(resizedMask).metadata();
    expect(metadata).toMatchObject({ width: 800, height: 400, format: 'png', hasAlpha: true });
  });

  it('reads video dimensions from ffprobe JSON', () => {
    expect(videoInfoFromFfprobe({
      streams: [{ codec_type: 'audio' }, { codec_type: 'video', width: 1280, height: 720, duration: '5.0' }],
      format: { duration: '5.04' },
    })).toEqual({ width: 1280, height: 720, durationMs: 5040 });
  });
});
