import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnrecoverableError } from 'bullmq';
import sharp from 'sharp';
import { Request } from 'undici';
import { GenerationProcessor, normalizeImageQuality, parseProviderImages, providerErrorCode, providerErrorFingerprint, providerHttpFailure, providerImageParameters } from './generation.processor';
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

  it('uses only a bounded provider error code for actionable diagnostics', () => {
    const invalidMask = Buffer.from(JSON.stringify({ error: { code: 'invalid_mask', message: 'sensitive upstream detail' } }));
    expect(providerErrorCode(invalidMask)).toBe('invalid_mask');
    expect(providerHttpFailure(400, invalidMask)).toEqual(expect.objectContaining({
      code: 'PROVIDER_PARAMETERS',
      message: expect.stringContaining('invalid_mask'),
    }));
    expect(providerHttpFailure(400, Buffer.from(JSON.stringify({ error: { code: 'moderation_blocked' } })))).toEqual(expect.objectContaining({ code: 'PROVIDER_MODERATION' }));
    expect(providerErrorCode(Buffer.from(JSON.stringify({ error: { code: 'unsafe code with spaces' } })))).toBeUndefined();
    expect(providerErrorCode(Buffer.from('not json'))).toBeUndefined();
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

  it('streams a large chunked string without buffering the decoded image in memory', async () => {
    const jsonPath = await storage.createStagingPath('.json');
    const image = Buffer.alloc(256 * 1024, 0x61);
    await writeFile(jsonPath, JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }), { flag: 'wx' });
    const parsed = await parseProviderImages(jsonPath, 1, storage);
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

  it('normalizes malformed JSON and source-file failures to provider response errors', async () => {
    const malformedPath = await storage.createStagingPath('.json');
    await writeFile(malformedPath, '{"data":[', { flag: 'wx' });
    await expect(parseProviderImages(malformedPath, 1, storage)).rejects.toMatchObject({ providerFailure: { code: 'PROVIDER_RESPONSE' } });
    await expect(parseProviderImages(join(root, 'missing.json'), 1, storage)).rejects.toMatchObject({ providerFailure: { code: 'PROVIDER_RESPONSE' } });
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
          .mockResolvedValueOnce({ id: 'mask-1', objectKey: maskStored.objectKey, mimeType: 'image/png', originalName: 'mask.png' }),
      },
    };
    const http: any = {
      requestToFile: jest.fn(async (_url: string, _init: unknown, destination: string) => {
        await writeFile(destination, JSON.stringify({ data: [{ b64_json: input.toString('base64') }] }), { flag: 'wx' });
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), filePath: destination, sizeBytes: input.length, url: 'https://api.example.com/v1/images/edits' };
      }),
    };
    const assets = { persistNormalized: jest.fn().mockResolvedValue({}), removeMask: jest.fn().mockResolvedValue(true), removeJobOutputs: jest.fn().mockResolvedValue(0n) };
    const lifecycle = { start: jest.fn().mockResolvedValue(true), finish: jest.fn().mockResolvedValue(true), releaseAndPublish: jest.fn().mockResolvedValue(undefined) };
    const processor = new GenerationProcessor(prisma, { decrypt: jest.fn(() => 'secret') } as any, storage, http, assets as any, lifecycle as any);

    await processor.process({ data: { jobId: 'job-1' }, attemptsMade: 0, opts: { attempts: 3 }, discard: jest.fn() } as any);

    expect(http.requestToFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirectPolicy: 'same-origin' }), expect.any(String), expect.any(Number), expect.any(Number));
    const requestBody = http.requestToFile.mock.calls[0][1].body as FormData;
    expect(requestBody.has('image[]')).toBe(true);
    expect(requestBody.has('image')).toBe(false);
    expect(requestBody.has('mask')).toBe(true);
    expect(requestBody.get('image[]')).toMatchObject({ name: 'source.png', type: 'image/png' });
    expect(requestBody.get('mask')).toMatchObject({ name: 'mask.png', type: 'image/png' });
    const serializedRequest = new Request('https://api.example.com/v1/images/edits', { method: 'POST', body: requestBody as any });
    expect(serializedRequest.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    const serializedBody = await serializedRequest.text();
    expect(serializedBody).toContain('name="image[]"');
    expect(serializedBody).toContain('name="mask"');
    expect(lifecycle.finish).toHaveBeenCalledWith('user-1', 'job-1', 'SUCCEEDED');
    expect(assets.removeMask).toHaveBeenCalledWith('user-1', 'mask-1');
  });

  it('marks a non-retryable provider failure once and raises BullMQ UnrecoverableError', async () => {
    const storage = new StorageService();
    const job = {
      id: 'job-4xx', userId: 'user-1', status: 'QUEUED', mode: 'TEXT_TO_IMAGE', user: { status: 'ACTIVE' },
      model: { upstreamModelId: 'image-model', provider: { baseUrl: 'https://api.example.com/v1', encryptedApiKey: 'encrypted', encryptedHeaders: null, timeoutSeconds: 30 } },
      parameters: { size: '1024x1024', quality: 'auto', count: 1 }, prompt: 'test prompt',
    };
    const prisma: any = {
      generationJob: {
        findUnique: jest.fn().mockResolvedValue(job),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const http: any = {
      requestToFile: jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: Buffer.from('{"error":"invalid parameters"}'),
      }),
    };
    const lifecycle = { start: jest.fn().mockResolvedValue(true), finish: jest.fn().mockResolvedValue(true), releaseAndPublish: jest.fn().mockResolvedValue(undefined) };
    const processor = new GenerationProcessor(prisma, { decrypt: jest.fn(() => 'secret') } as any, storage, http, { persistNormalized: jest.fn().mockResolvedValue({}) } as any, lifecycle as any);

    await expect(processor.process({ data: { jobId: job.id }, attemptsMade: 0, opts: { attempts: 3 } } as any)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(http.requestToFile).toHaveBeenCalledTimes(1);
    expect(lifecycle.finish).toHaveBeenCalledWith('user-1', job.id, 'FAILED', expect.objectContaining({ code: 'PROVIDER_PARAMETERS' }));
  });
});
