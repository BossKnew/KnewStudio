import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'knewstudio-')); process.env.MEDIA_ROOT = root; });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('validates, saves and reads a private image', async () => {
    const service = new StorageService();
    const buffer = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#fff' } }).png().toBuffer();
    const inputPath = await service.createStagingPath('.png');
    await writeFile(inputPath, buffer, { flag: 'wx' });
    const image = await service.inspectImageFile(inputPath, 'image/png');
    const stored = await service.saveStaged('user-1', inputPath, image.mimeType);
    expect(stored.objectKey.startsWith('user-1/')).toBe(true);
    expect(await readFile(service.filePath(stored.objectKey))).toEqual(buffer);
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
});
