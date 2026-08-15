import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { GenerationProcessor, normalizeImageQuality, parseProviderImages, providerErrorFingerprint, providerHttpFailure, providerImageParameters } from './generation.processor';
import { StorageService } from './storage.service';

async function stageAndSave(storage: StorageService, userId: string, buffer: Buffer, mimeType: string) {
  const stagedPath = await storage.createStagingPath('.png');
  await writeFile(stagedPath, buffer, { flag: 'wx' });
  return storage.saveStaged(userId, stagedPath, mimeType);
}

describe('image request compatibility', () => {
  it('maps the legacy standard quality to auto for GPT Image models', () => {
    expect(normalizeImageQuality('gpt-image-2', 'standard')).toBe('auto');
    expect(normalizeImageQuality('gpt-image-1', 'standard')).toBe('auto');
  });

  it('does not alter quality values for other image models', () => {
    expect(normalizeImageQuality('dall-e-3', 'standard')).toBe('standard');
    expect(normalizeImageQuality('gpt-image-2', 'high')).toBe('high');
  });

  it('maps upstream status codes to stable, non-secret diagnostics', () => {
    expect(providerHttpFailure(401).code).toBe('PROVIDER_AUTH');
    expect(providerHttpFailure(400).code).toBe('PROVIDER_PARAMETERS');
    expect(providerHttpFailure(429).code).toBe('PROVIDER_LIMIT');
    expect(providerHttpFailure(503).code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not send the legacy response_format parameter to providers', () => {
    const parameters = providerImageParameters('gpt-image-1', 'test', { size: '1024x1024', quality: 'high', count: 1 });
    expect(parameters).toEqual({ model: 'gpt-image-1', prompt: 'test', size: '1024x1024', quality: 'high', n: 1 });
    expect(parameters).not.toHaveProperty('response_format');
  });

  it('reduces provider errors to an irreversible fixed-size fingerprint', () => {
    const fingerprint = providerErrorFingerprint(Buffer.from(JSON.stringify({ error: { message: 'leaked sk-secret-value' } })));
    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(fingerprint).not.toContain('secret');
    expect(providerErrorFingerprint()).toBe('empty');
  });
});

describe('streamed provider image parsing', () => {
  let root: string;
  let storage: StorageService;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knewstudio-provider-'));
    process.env.MEDIA_ROOT = root;
    storage = new StorageService();
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('decodes chunked base64 data to a bounded staging file', async () => {
    const jsonPath = await storage.createStagingPath('.json');
    const image = Buffer.from('streamed-image');
    await writeFile(jsonPath, JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }), { flag: 'wx' });
    const parsed = await parseProviderImages(jsonPath, 1, storage);
    expect(parsed).toHaveLength(1);
    await expect(storage.inspectImageFile(parsed[0].path!)).rejects.toThrow();
    await expect(readFile(parsed[0].path!)).resolves.toEqual(image);
    await storage.deleteStaged(parsed[0].path!);
  });

  it('rejects malformed base64 without retaining a staging image', async () => {
    const jsonPath = await storage.createStagingPath('.json');
    await writeFile(jsonPath, JSON.stringify({ data: [{ b64_json: 'not*base64' }] }), { flag: 'wx' });
    await expect(parseProviderImages(jsonPath, 1, storage)).rejects.toMatchObject({ providerFailure: { code: 'PROVIDER_RESPONSE' } });
  });

  it('accepts valid unpadded base64 from compatible providers', async () => {
    const jsonPath = await storage.createStagingPath('.json');
    await writeFile(jsonPath, JSON.stringify({ data: [{ b64_json: 'YWJjZA' }] }), { flag: 'wx' });
    const parsed = await parseProviderImages(jsonPath, 1, storage);
    await expect(readFile(parsed[0].path!)).resolves.toEqual(Buffer.from('abcd'));
    await storage.deleteStaged(parsed[0].path!);
  });

  it('supports URL image entries and limits results to the requested count', async () => {
    const jsonPath = await storage.createStagingPath('.json');
    await writeFile(jsonPath, JSON.stringify({ data: [{ url: 'https://cdn.example.com/one.png' }, { url: 'https://cdn.example.com/two.png' }] }), { flag: 'wx' });
    await expect(parseProviderImages(jsonPath, 1, storage)).resolves.toEqual([{ url: 'https://cdn.example.com/one.png' }]);
  });
});

describe('GenerationProcessor mask lifecycle', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'knewstudio-generation-')); process.env.MEDIA_ROOT = root; });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('deletes the retained mask only after an inpaint job succeeds', async () => {
    const storage = new StorageService();
    const input = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#fff' } }).png().toBuffer();
    const sourceStored = await stageAndSave(storage, 'user-1', input, 'image/png');
    const maskStored = await stageAndSave(storage, 'user-1', input, 'image/png');
    const deleteSpy = jest.spyOn(storage, 'delete');
    const job = {
      id: 'job-1', userId: 'user-1', status: 'QUEUED', mode: 'INPAINT', user: { status: 'ACTIVE' },
      model: { upstreamModelId: 'image-model', provider: { baseUrl: 'https://api.example.com/v1', encryptedApiKey: 'encrypted', encryptedHeaders: null, timeoutSeconds: 30 } },
      parameters: { sourceAssetIds: ['source-1'], maskAssetId: 'mask-1', size: '1024x1024', count: 1 }, prompt: 'replace the sky',
    };
    const prisma: any = {
      generationJob: { findUnique: jest.fn().mockResolvedValueOnce(job).mockResolvedValueOnce({ status: 'RUNNING' }), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      asset: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ id: 'source-1', objectKey: sourceStored.objectKey, mimeType: 'image/png', originalName: 'source.png' })
          .mockResolvedValueOnce({ id: 'mask-1', objectKey: maskStored.objectKey, mimeType: 'image/png', originalName: 'mask.png' })
          .mockResolvedValueOnce({ id: 'mask-1', objectKey: maskStored.objectKey, role: 'MASK', sizeBytes: maskStored.sizeBytes }),
        create: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}),
      },
    };
    const http: any = {
      requestToFile: jest.fn(async (_url: string, _init: unknown, destination: string) => {
        await writeFile(destination, JSON.stringify({ data: [{ b64_json: input.toString('base64') }] }), { flag: 'wx' });
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), filePath: destination, sizeBytes: input.length, url: 'https://api.example.com/v1/images/edits' };
      }),
    };
    const quota: any = { reserveStorage: jest.fn(), releaseStorage: jest.fn(), releaseJob: jest.fn() };
    const processor = new GenerationProcessor(prisma, { decrypt: jest.fn(() => 'secret') } as any, storage, http, quota);

    await processor.process({ data: { jobId: 'job-1' }, attemptsMade: 0, opts: { attempts: 3 }, discard: jest.fn() } as any);

    expect(http.requestToFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirectPolicy: 'same-origin' }), expect.any(String), expect.any(Number), expect.any(Number));
    expect(prisma.generationJob.update).toHaveBeenCalledWith({ where: { id: 'job-1' }, data: { status: 'SUCCEEDED', finishedAt: expect.any(Date) } });
    expect(deleteSpy).toHaveBeenCalledWith(maskStored.objectKey);
    expect(prisma.asset.delete).toHaveBeenCalledWith({ where: { id: 'mask-1' } });
  });
});
