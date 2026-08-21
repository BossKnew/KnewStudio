import { createVideoAdapter, openaiVideoTaskId, seedanceTaskId, seedanceVideoUrl, wanApiRoot, wanParameters, wanStatus, wanTaskId, wanVideoUrl } from './video-adapters';
import { connectionFailureDetail, isAbortTimeoutError, isProviderConnectionError, mapAbortTimeoutError, mapProviderRequestError, type MediaGenerationRequest, type VideoAdapterDeps } from './provider-adapter';

function request(overrides: Partial<MediaGenerationRequest> = {}): MediaGenerationRequest {
  return {
    mediaKind: 'VIDEO',
    operation: 'TEXT_TO_VIDEO',
    upstreamModelId: 'sora-2',
    prompt: 'a cat on a skateboard',
    parameters: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
    inputAssets: [],
    ...overrides,
  };
}

function httpMock(sequence: Array<{ ok?: boolean; status?: number; json?: unknown; headers?: Record<string, string>; body?: Buffer }>) {
  const calls: Array<{ url: string; init: any }> = [];
  return {
    calls,
    http: {
      request: jest.fn(async (url: string, init: any) => {
        calls.push({ url, init });
        const next = sequence.shift() ?? { ok: true, status: 200, json: {} };
        const body = next.body ?? Buffer.from(JSON.stringify(next.json ?? {}));
        return {
          ok: next.ok ?? true,
          status: next.status ?? 200,
          headers: new Headers({ 'content-type': next.headers?.['content-type'] ?? 'application/json', ...next.headers }),
          body,
          url,
        };
      }),
      requestToFile: jest.fn(),
    },
  };
}

function deps(http: any, overrides: Partial<VideoAdapterDeps> = {}): VideoAdapterDeps {
  return {
    http,
    headers: { Authorization: 'Bearer secret' },
    baseUrl: 'https://api.example.com/v1',
    timeoutSeconds: 30,
    pollTimeoutSeconds: 60,
    sleep: jest.fn().mockResolvedValue(undefined),
    now: () => 0,
    ...overrides,
  };
}

describe('video adapter payload parsers', () => {
  it('reads OpenAI, Seedance and Wan identifiers from documented envelopes', () => {
    expect(openaiVideoTaskId({ id: 'video_123' })).toBe('video_123');
    expect(seedanceTaskId({ id: 'cgt-1' })).toBe('cgt-1');
    expect(seedanceVideoUrl({ content: { video_url: 'https://cdn.example/v.mp4' } })).toBe('https://cdn.example/v.mp4');
    expect(wanTaskId({ output: { task_id: 'task-9' } })).toBe('task-9');
    expect(wanStatus({ output: { task_status: 'SUCCEEDED' } })).toBe('SUCCEEDED');
    expect(wanVideoUrl({ output: { video_url: 'https://cdn.example/w.mp4' } })).toBe('https://cdn.example/w.mp4');
  });
});

describe('openai-videos adapter', () => {
  it('creates a JSON text-to-video job and downloads content after polling', async () => {
    const { http, calls } = httpMock([
      { json: { id: 'video_1', status: 'queued' } },
      { json: { id: 'video_1', status: 'in_progress' } },
      { json: { id: 'video_1', status: 'completed' } },
      { headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4data') },
    ]);
    const adapter = createVideoAdapter('openai-videos', deps(http));
    await expect(adapter.createTask(request())).resolves.toBe('video_1');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ model: 'sora-2', prompt: 'a cat on a skateboard', seconds: '5', size: '16:9', quality: '720p' });

    const media = await adapter.collect('video_1', request());
    expect(media[0]).toMatchObject({ mimeType: 'video/mp4' });
    expect(calls[3].url).toBe('https://api.example.com/v1/videos/video_1/content');
    expect(calls[3].init.headers.Authorization).toBe('Bearer secret');
    expect(calls[3].init.redirectPolicy).toBe('same-origin');
  });

  it('does not recreate a task when collect is resumed', async () => {
    const { http, calls } = httpMock([
      { json: { id: 'video_1', status: 'completed' } },
      { headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4data') },
    ]);
    const adapter = createVideoAdapter('openai-videos', deps(http));
    await adapter.collect('video_1', request());
    expect(calls.every((call) => !call.url.endsWith('/videos') || call.init.method !== 'POST')).toBe(true);
  });
});

describe('seedance adapter', () => {
  it('maps ratio, duration and first-frame data URLs', async () => {
    const { http, calls } = httpMock([
      { json: { id: 'cgt-9' } },
      { json: { status: 'succeeded', content: { video_url: 'https://cdn.example/out.mp4' } } },
      { headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4data') },
    ]);
    const adapter = createVideoAdapter('seedance', deps(http, { baseUrl: 'https://ark.example/api/v3' }));
    const png = { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]), role: 'SOURCE' as const };
    await expect(adapter.createTask(request({ operation: 'IMAGE_TO_VIDEO', inputAssets: [png] }))).resolves.toBe('cgt-9');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ model: 'sora-2', duration: 5, ratio: '16:9', resolution: '720p', watermark: false });
    expect(body.content[1].image_url.url).toMatch(/^data:image\/png;base64,/);

    const media = await adapter.collect('cgt-9', request());
    expect(media[0].mimeType).toBe('video/mp4');
    expect(calls[2].init.headers).toBeUndefined();
    expect(calls[2].init.redirectPolicy).toBe('any');
  });
});

describe('wan adapter', () => {
  it('normalizes Wan 2.7 base URLs and ratio/resolution parameters', () => {
    expect(wanApiRoot('https://dashscope.aliyuncs.com')).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(wanApiRoot('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis')).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(wanApiRoot('https://abc.cn-beijing.maas.aliyuncs.com')).toBe('https://abc.cn-beijing.maas.aliyuncs.com/api/v1');
    expect(wanApiRoot('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('https://dashscope.aliyuncs.com/api/v1');
    expect(wanParameters({ aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' })).toMatchObject({ duration: 5, ratio: '16:9', resolution: '720P' });
  });

  it('sends DashScope async header and polls task_status', async () => {
    const { http, calls } = httpMock([
      { json: { output: { task_id: 'task-1', task_status: 'PENDING' } } },
      { json: { output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example/wan.mp4' } } },
      { headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4data') },
    ]);
    const adapter = createVideoAdapter('wan', deps(http, { baseUrl: 'https://dashscope.example/api/v1' }));
    await expect(adapter.createTask(request({ upstreamModelId: 'wan2.7-t2v' }))).resolves.toBe('task-1');
    expect(calls[0].init.headers['X-DashScope-Async']).toBe('enable');
    expect(calls[0].url).toBe('https://dashscope.example/api/v1/services/aigc/video-generation/video-synthesis');
    expect(JSON.parse(calls[0].init.body).parameters).toMatchObject({ duration: 5, ratio: '16:9', resolution: '720P' });
    await adapter.collect('task-1', request());
    expect(calls[1].url).toBe('https://dashscope.example/api/v1/tasks/task-1');
  });

  it('surfaces DashScope error payloads that still use HTTP 200', async () => {
    const { http } = httpMock([{ json: { code: 'InvalidParameter', message: 'url error, please check url!' } }]);
    const adapter = createVideoAdapter('wan', deps(http, { baseUrl: 'https://dashscope.aliyuncs.com/api/v1' }));
    await expect(adapter.createTask(request({ upstreamModelId: 'wan2.7-t2v' }))).rejects.toMatchObject({
      providerFailure: { message: expect.stringContaining('url error, please check url!') },
    });
  });

  it('treats 401 on the probe task as an auth failure', async () => {
    const { http } = httpMock([{ ok: false, status: 401, json: { error: 'unauthorized' } }]);
    const adapter = createVideoAdapter('wan', deps(http, { baseUrl: 'https://dashscope.example/api/v1' }));
    await expect(adapter.testConnection()).resolves.toMatchObject({ ok: false, status: 401 });
  });
});

describe('video adapter timeouts', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the longer of generation and poll timeouts for create and download', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const { http, calls } = httpMock([
      { json: { id: 'video_1' } },
      { json: { id: 'video_1', status: 'completed' } },
      { headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4data') },
    ]);
    const adapter = createVideoAdapter('openai-videos', deps(http, { timeoutSeconds: 900, pollTimeoutSeconds: 1800 }));
    await adapter.createTask(request());
    await adapter.collect('video_1', request());
    expect(timeoutSpy.mock.calls.map((call) => call[0])).toEqual([1_800_000, 900_000, 1_800_000]);
    expect(calls[0].init.timeoutMs).toBe(1_800_000);
    expect(calls[1].init.timeoutMs).toBe(900_000);
    expect(calls[2].init.timeoutMs).toBe(1_800_000);
  });

  it('keeps a 120s floor for video downloads when generation timeout is lower', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const { http } = httpMock([
      { json: { id: 'video_1', status: 'completed' } },
      { headers: { 'content-type': 'video/mp4' }, body: Buffer.from('mp4data') },
    ]);
    const adapter = createVideoAdapter('openai-videos', deps(http, { timeoutSeconds: 30 }));
    await adapter.collect('video_1', request());
    expect(timeoutSpy.mock.calls.map((call) => call[0])).toEqual([30_000, 120_000]);
  });

  it('fails collect after pollTimeoutSeconds elapses', async () => {
    let now = 0;
    const { http } = httpMock([
      { json: { id: 'video_1', status: 'in_progress' } },
      { json: { id: 'video_1', status: 'in_progress' } },
    ]);
    const adapter = createVideoAdapter('openai-videos', deps(http, {
      pollTimeoutSeconds: 60,
      now: () => now,
      sleep: async () => { now = 60_000; },
    }));
    await expect(adapter.collect('video_1', request())).rejects.toMatchObject({
      noRetry: true,
      providerFailure: { code: 'PROVIDER_TIMEOUT', message: expect.stringContaining('任务等待超时') },
    });
  });

  it('maps AbortSignal timeout errors to a provider timeout failure', () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect(isAbortTimeoutError(timeout)).toBe(true);
    expect(isAbortTimeoutError(new Error('socket hang up'))).toBe(false);
    expect(mapAbortTimeoutError(timeout)).toMatchObject({
      noRetry: true,
      providerFailure: { code: 'PROVIDER_TIMEOUT', message: expect.stringContaining('提高生成超时') },
    });
  });

  it('does not treat a 10s TCP connect timeout as a generation timeout', () => {
    const connect = Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    const wrapped = new Error('fetch failed', { cause: connect });
    expect(isAbortTimeoutError(connect)).toBe(false);
    expect(isProviderConnectionError(wrapped)).toBe(true);
    expect(mapProviderRequestError(wrapped)).toMatchObject({
      providerFailure: { code: 'PROVIDER_CONNECTION', message: expect.stringContaining('连接超时') },
    });
  });

  it('labels a TLS handshake reset separately from a generation timeout', () => {
    const reset = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' });
    expect(connectionFailureDetail(reset)).toBe('TLS 握手被重置');
    expect(mapProviderRequestError(new Error('fetch failed', { cause: reset }))).toMatchObject({
      providerFailure: { code: 'PROVIDER_CONNECTION', message: expect.stringContaining('TLS 握手被重置') },
    });
  });
});
