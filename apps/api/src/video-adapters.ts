import { FormData as UndiciFormData } from 'undici';
import { VIDEO_POLL_INTERVAL_MS, MAX_VIDEO_BYTES, isVideoAdapterKind } from './domain-constants';
import { MAX_ERROR_BYTES } from './safe-http.service';
import {
  aspectRatioOf,
  durationSecondsOf,
  providerProtocolError,
  providerTimeoutError,
  resolutionOf,
  sleep as defaultSleep,
  videoHttpFailure,
  type MediaGenerationAdapter,
  type MediaGenerationRequest,
  type VideoAdapterDeps,
} from './provider-adapter';
function providerErrorCode(body?: Buffer) {
  if (!body?.length) return undefined;
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    const code = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error && typeof parsed.error === 'object'
      ? (parsed.error as { code?: unknown }).code
      : undefined;
    return typeof code === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(code) ? code : undefined;
  } catch { return undefined; }
}

type Json = Record<string, unknown>;

function jsonObject(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function dataUrl(asset: { mimeType: string; bytes: Uint8Array }) {
  const mime = asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/webp' ? asset.mimeType : 'image/png';
  return `data:${mime};base64,${Buffer.from(asset.bytes).toString('base64')}`;
}

function firstSource(request: MediaGenerationRequest) {
  return request.inputAssets.find((asset) => asset.role === 'SOURCE');
}

function dashscopeError(body?: Buffer) {
  const object = jsonObject(parseJsonBody(body));
  const output = jsonObject(object?.output);
  return {
    code: text(object?.code) ?? text(output?.code) ?? providerErrorCode(body),
    message: text(object?.message) ?? text(output?.message),
  };
}

function throwIfDashScopeFailed(payload: unknown) {
  const object = jsonObject(payload);
  const output = jsonObject(object?.output);
  const code = text(object?.code) ?? text(output?.code);
  const message = text(object?.message) ?? text(output?.message);
  if (!code || /^(null|ok|success)$/i.test(code)) return;
  if (wanTaskId(payload)) return;
  const error: any = new Error(message || code);
  error.noRetry = true;
  error.providerFailure = {
    code: 'PROVIDER_PARAMETERS',
    message: message ? `供应商拒绝了视频或模型参数：${message}` : `供应商拒绝了视频或模型参数（${code}）`,
  };
  throw error;
}

function throwHttp(status: number, body?: Buffer) {
  const dash = dashscopeError(body);
  const error: any = new Error(`供应商返回 ${status}`);
  error.noRetry = status >= 400 && status < 500;
  const failure = videoHttpFailure(status, dash.code);
  if (status === 404) {
    failure.message = dash.message
      ? `供应商接口返回 404：${dash.message}`
      : '供应商接口或模型不存在。Wan 的 Base URL 优先填 https://dashscope.aliyuncs.com/api/v1，不要带 video-synthesis，也不要使用 compatible-mode。文生视频模型 ID 应为 wan2.7-t2v 或 wan2.7-t2v-2026-06-12。';
  } else if (dash.message && (status === 400 || status === 422)) {
    failure.message = `供应商拒绝了视频或模型参数：${dash.message}`;
  }
  error.providerFailure = failure;
  throw error;
}

function parseJsonBody(body?: Buffer) {
  if (!body?.length) return undefined;
  try { return JSON.parse(body.toString('utf8')); }
  catch { return undefined; }
}

export function videoHttpTimeoutMs(deps: Pick<VideoAdapterDeps, 'timeoutSeconds'>) {
  return Math.min(Math.max(Number(deps.timeoutSeconds) || 180, 10), 3600) * 1000;
}

export function videoPollTimeoutMs(deps: Pick<VideoAdapterDeps, 'pollTimeoutSeconds'>) {
  return Math.min(Math.max(Number(deps.pollTimeoutSeconds) || 900, 10), 3600) * 1000;
}

export function videoLongTimeoutMs(deps: Pick<VideoAdapterDeps, 'timeoutSeconds' | 'pollTimeoutSeconds'>) {
  return Math.max(videoHttpTimeoutMs(deps), videoPollTimeoutMs(deps), 120_000);
}

function requestHeaders(deps: VideoAdapterDeps, extra?: Record<string, string>) {
  return { ...deps.headers, ...extra };
}

function pickString(source: unknown, keys: string[]): string | undefined {
  const visit = (value: unknown, depth: number): string | undefined => {
    if (depth > 6) return undefined;
    const object = jsonObject(value);
    if (!object) return undefined;
    for (const key of keys) {
      const candidate = text(object[key]);
      if (candidate) return candidate;
    }
    for (const nested of Object.values(object)) {
      if (Array.isArray(nested)) {
        for (const item of nested) {
          const found = visit(item, depth + 1);
          if (found) return found;
        }
      } else {
        const found = visit(nested, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(source, 0);
}

export function openaiVideoTaskId(payload: unknown) {
  return text(jsonObject(payload)?.id);
}

export function openaiVideoStatus(payload: unknown) {
  return text(jsonObject(payload)?.status)?.toLowerCase();
}

export function seedanceTaskId(payload: unknown) {
  const object = jsonObject(payload);
  return text(object?.id) ?? text(jsonObject(object?.data)?.id);
}

export function seedanceStatus(payload: unknown) {
  return text(jsonObject(payload)?.status)?.toLowerCase();
}

export function seedanceVideoUrl(payload: unknown) {
  return pickString(payload, ['video_url', 'url']);
}

export function wanTaskId(payload: unknown) {
  const object = jsonObject(payload);
  const output = jsonObject(object?.output);
  return text(output?.task_id) ?? text(object?.task_id) ?? text(object?.id);
}

export function wanStatus(payload: unknown) {
  const object = jsonObject(payload);
  const output = jsonObject(object?.output);
  return (text(output?.task_status) ?? text(object?.task_status) ?? text(object?.status))?.toUpperCase();
}

export function wanVideoUrl(payload: unknown) {
  return pickString(payload, ['video_url', 'url']);
}

const WAN_SYNTHESIS_PATH = '/services/aigc/video-generation/video-synthesis';

export function wanApiRoot(baseUrl: string) {
  let url = baseUrl.trim().replace(/\/+$/, '');
  url = url.replace(/\/services\/aigc\/video-generation\/video-synthesis$/i, '');
  url = url.replace(/\/compatible-mode\/v1$/i, '/api/v1');
  if (/^https:\/\/dashscope(?:-intl)?\.aliyuncs\.com$/i.test(url)) url += '/api/v1';
  if (/^https:\/\/[^/]+\.maas\.aliyuncs\.com$/i.test(url)) url += '/api/v1';
  return url.replace(/\/+$/, '');
}

export function wanResolution(value: string) {
  const match = /^(480|720|1080)p$/i.exec(value.trim());
  return match ? `${match[1]}P` : value.trim();
}

export function wanParameters(parameters: Record<string, unknown>) {
  const aspect = aspectRatioOf(parameters);
  const quality = resolutionOf(parameters);
  const result: Json = {
    duration: durationSecondsOf(parameters),
    prompt_extend: false,
    watermark: false,
  };
  if (aspect && /^\d+:\d+$/.test(aspect)) result.ratio = aspect;
  else if (aspect && /\d+[x*×]\d+/i.test(aspect)) result.size = aspect.replace(/[x×]/gi, '*');
  if (quality) {
    const normalized = wanResolution(quality);
    if (/^(480|720|1080)P$/.test(normalized)) result.resolution = normalized;
    else if (/\d+[x*×]\d+/i.test(quality)) result.size = quality.replace(/[x×]/gi, '*');
    else result.resolution = normalized;
  }
  return result;
}

export function wanInput(request: MediaGenerationRequest) {
  const source = firstSource(request);
  const input: Json = { prompt: request.prompt };
  if (!source) return input;
  const url = dataUrl(source);
  if (/wan2\.7/i.test(request.upstreamModelId)) input.media = [{ type: 'first_frame', url }];
  else input.img_url = url;
  return input;
}

abstract class BaseVideoAdapter implements MediaGenerationAdapter {
  abstract readonly kind: string;
  readonly mediaKind = 'VIDEO' as const;
  private pollDeadlineAt?: number;
  constructor(protected readonly deps: VideoAdapterDeps) {}

  abstract createTask(request: MediaGenerationRequest): Promise<string>;
  abstract collect(taskId: string, request: MediaGenerationRequest): Promise<import('./provider-adapter').GeneratedMedia[]>;
  abstract testConnection(): Promise<{ ok: boolean; status?: number; message?: string }>;

  protected deadline() {
    this.pollDeadlineAt ??= (this.deps.now ?? Date.now)() + videoPollTimeoutMs(this.deps);
    return this.pollDeadlineAt;
  }

  protected abort(kind: 'short' | 'long' = 'short') {
    const timeoutMs = kind === 'long' ? videoLongTimeoutMs(this.deps) : videoHttpTimeoutMs(this.deps);
    return { signal: this.deps.signal ?? AbortSignal.timeout(timeoutMs), timeoutMs };
  }

  protected async wait(signal?: AbortSignal) {
    await (this.deps.sleep ?? defaultSleep)(VIDEO_POLL_INTERVAL_MS, signal ?? this.deps.signal);
  }

  protected timedOut() {
    return (this.deps.now ?? Date.now)() >= this.deadline();
  }

  protected async getJson(url: string) {
    const response = await this.deps.http.request(url, {
      method: 'GET',
      headers: requestHeaders(this.deps),
      redirectPolicy: 'same-origin',
      ...this.abort('short'),
    }, MAX_ERROR_BYTES);
    if (!response.ok) throwHttp(response.status, response.body);
    const payload = parseJsonBody(response.body);
    if (payload === undefined) throw providerProtocolError('供应商返回的 JSON 无法解析');
    return payload;
  }

  protected async postJson(url: string, body: unknown, extraHeaders?: Record<string, string>) {
    const response = await this.deps.http.request(url, {
      method: 'POST',
      headers: requestHeaders(this.deps, { 'Content-Type': 'application/json', ...extraHeaders }),
      body: JSON.stringify(body),
      redirectPolicy: 'same-origin',
      ...this.abort('long'),
    }, MAX_ERROR_BYTES);
    if (!response.ok) throwHttp(response.status, response.body);
    const payload = parseJsonBody(response.body);
    if (payload === undefined) throw providerProtocolError('供应商返回的 JSON 无法解析');
    return payload;
  }

  protected async downloadVideo(url: string, credentialed = false) {
    const destination = this.deps.createStagingPath
      ? await this.deps.createStagingPath('.mp4')
      : undefined;
    const init = {
      method: 'GET' as const,
      headers: credentialed ? requestHeaders(this.deps) : undefined,
      redirectPolicy: credentialed ? 'same-origin' as const : 'any' as const,
      ...this.abort('long'),
    };
    if (!destination) {
      const response = await this.deps.http.request(url, init, MAX_VIDEO_BYTES);
      if (!response.ok) throwHttp(response.status, response.body);
      const type = response.headers.get('content-type') ?? '';
      if (type && !/video\/mp4|application\/octet-stream/i.test(type)) throw providerProtocolError('供应商视频类型无效');
      return { mimeType: 'video/mp4' as const, bytes: new Uint8Array(response.body) };
    }
    const response = await this.deps.http.requestToFile(url, init, destination, MAX_VIDEO_BYTES, MAX_ERROR_BYTES);
    if (!response.ok) throwHttp(response.status, response.body);
    const type = response.headers.get('content-type') ?? '';
    if (type && !/video\/mp4|application\/octet-stream/i.test(type)) throw providerProtocolError('供应商视频类型无效');
    return { mimeType: 'video/mp4' as const, path: destination };
  }
}

class OpenAIVideosAdapter extends BaseVideoAdapter {
  readonly kind = 'openai-videos';

  async createTask(request: MediaGenerationRequest) {
    const source = firstSource(request);
    const seconds = durationSecondsOf(request.parameters);
    const size = aspectRatioOf(request.parameters);
    const quality = resolutionOf(request.parameters);
    const payload: Json = {
      model: request.upstreamModelId,
      prompt: request.prompt,
      seconds: String(seconds),
      ...(size ? { size } : {}),
      ...(quality ? { quality } : {}),
    };
    let body: unknown = JSON.stringify(payload);
    const extra: Record<string, string> = {};
    if (source) {
      const form = new UndiciFormData();
      for (const [key, value] of Object.entries(payload)) form.set(key, String(value));
      form.set('input_reference', new Blob([Buffer.from(source.bytes)], { type: source.mimeType }), 'reference.png');
      body = form;
    } else extra['Content-Type'] = 'application/json';
    const response = await this.deps.http.request(`${this.deps.baseUrl}/videos`, {
      method: 'POST',
      headers: requestHeaders(this.deps, extra),
      body: body as any,
      redirectPolicy: 'same-origin',
      ...this.abort('long'),
    }, MAX_ERROR_BYTES);
    if (!response.ok) throwHttp(response.status, response.body);
    const id = openaiVideoTaskId(parseJsonBody(response.body));
    if (!id) throw providerProtocolError('供应商未返回视频任务 ID');
    return id;
  }

  async collect(taskId: string, _request?: MediaGenerationRequest) {
    while (true) {
      if (this.timedOut()) throw providerTimeoutError();
      const payload = await this.getJson(`${this.deps.baseUrl}/videos/${taskId}`);
      const status = openaiVideoStatus(payload);
      if (status === 'completed') return [await this.downloadVideo(`${this.deps.baseUrl}/videos/${taskId}/content`, true)];
      if (status === 'failed' || status === 'cancelled') {
        const error: any = new Error('供应商视频任务失败');
        error.noRetry = true;
        error.providerFailure = { code: 'PROVIDER_PARAMETERS', message: '供应商视频任务失败，请调整提示词或参数后重试' };
        throw error;
      }
      await this.wait();
    }
  }

  async testConnection() {
    return testModelsList(this.deps);
  }
}

class SeedanceAdapter extends BaseVideoAdapter {
  readonly kind = 'seedance';

  async createTask(request: MediaGenerationRequest) {
    const source = firstSource(request);
    const content: Json[] = [{ type: 'text', text: request.prompt }];
    if (source) content.push({ type: 'image_url', image_url: { url: dataUrl(source) }, role: 'first_frame' });
    const ratio = aspectRatioOf(request.parameters);
    const resolution = resolutionOf(request.parameters);
    const payload = await this.postJson(`${this.deps.baseUrl}/contents/generations/tasks`, {
      model: request.upstreamModelId,
      content,
      duration: durationSecondsOf(request.parameters),
      watermark: false,
      ...(ratio ? { ratio } : {}),
      ...(resolution ? { resolution } : {}),
    });
    const id = seedanceTaskId(payload);
    if (!id) throw providerProtocolError('供应商未返回视频任务 ID');
    return id;
  }

  async collect(taskId: string, _request?: MediaGenerationRequest) {
    while (true) {
      if (this.timedOut()) throw providerTimeoutError();
      const payload = await this.getJson(`${this.deps.baseUrl}/contents/generations/tasks/${taskId}`);
      const status = seedanceStatus(payload);
      if (status === 'succeeded' || status === 'success' || status === 'completed') {
        const url = seedanceVideoUrl(payload);
        if (!url) throw providerProtocolError('供应商未返回视频地址');
        return [await this.downloadVideo(url)];
      }
      if (status === 'failed' || status === 'cancelled' || status === 'expired') {
        const error: any = new Error('供应商视频任务失败');
        error.noRetry = true;
        error.providerFailure = { code: 'PROVIDER_PARAMETERS', message: '供应商视频任务失败，请调整提示词或参数后重试' };
        throw error;
      }
      await this.wait();
    }
  }

  async testConnection() {
    const models = await testModelsList(this.deps);
    if (models.ok) return models;
    try {
      const response = await this.deps.http.request(`${this.deps.baseUrl}/contents/generations/tasks`, {
        method: 'GET',
        headers: requestHeaders(this.deps),
        redirectPolicy: 'same-origin',
        ...this.abort('short'),
      }, MAX_ERROR_BYTES);
      if (response.status === 401 || response.status === 403) return { ok: false, status: response.status, message: '供应商认证失败，请检查 API Key、令牌分组及访问权限' };
      return { ok: true, status: response.status };
    } catch {
      return { ...models, ok: false, message: models.message ?? '供应商连接失败' };
    }
  }
}

class WanAdapter extends BaseVideoAdapter {
  readonly kind = 'wan';

  async createTask(request: MediaGenerationRequest) {
    const root = wanApiRoot(this.deps.baseUrl);
    const payload = await this.postJson(`${root}${WAN_SYNTHESIS_PATH}`, {
      model: request.upstreamModelId,
      input: wanInput(request),
      parameters: wanParameters(request.parameters),
    }, { 'X-DashScope-Async': 'enable' });
    throwIfDashScopeFailed(payload);
    const id = wanTaskId(payload);
    if (!id) throw providerProtocolError('供应商未返回视频任务 ID');
    return id;
  }

  async collect(taskId: string, _request?: MediaGenerationRequest) {
    const root = wanApiRoot(this.deps.baseUrl);
    while (true) {
      if (this.timedOut()) throw providerTimeoutError();
      const payload = await this.getJson(`${root}/tasks/${taskId}`);
      const status = wanStatus(payload);
      if (status === 'SUCCEEDED') {
        const url = wanVideoUrl(payload);
        if (!url) throw providerProtocolError('供应商未返回视频地址');
        return [await this.downloadVideo(url)];
      }
      if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
        const object = jsonObject(payload);
        const output = jsonObject(object?.output);
        const detail = text(output?.message) ?? text(object?.message) ?? text(output?.code);
        const error: any = new Error(detail || '供应商视频任务失败');
        error.noRetry = true;
        error.providerFailure = { code: 'PROVIDER_PARAMETERS', message: detail ? `供应商视频任务失败：${detail}` : '供应商视频任务失败，请调整提示词或参数后重试' };
        throw error;
      }
      await this.wait();
    }
  }

  async testConnection() {
    try {
      const response = await this.deps.http.request(`${wanApiRoot(this.deps.baseUrl)}/tasks/0`, {
        method: 'GET',
        headers: requestHeaders(this.deps),
        redirectPolicy: 'same-origin',
        ...this.abort('short'),
      }, MAX_ERROR_BYTES);
      if (response.status === 401 || response.status === 403) return { ok: false, status: response.status, message: '供应商认证失败，请检查 API Key、令牌分组及访问权限' };
      return { ok: true, status: response.status };
    } catch {
      return { ok: false, message: '供应商连接失败' };
    }
  }
}

export async function testModelsList(deps: Pick<VideoAdapterDeps, 'http' | 'headers' | 'baseUrl' | 'timeoutSeconds'>) {
  try {
    const response = await deps.http.request(`${deps.baseUrl}/models`, {
      method: 'GET',
      headers: deps.headers,
      redirectPolicy: 'same-origin',
      signal: AbortSignal.timeout(Math.min(Math.max(deps.timeoutSeconds, 10), 30) * 1000),
    }, MAX_ERROR_BYTES);
    const contentType = response.headers.get('content-type') ?? '';
    let modelsPayload = false;
    if (response.ok && contentType.includes('application/json')) {
      try { modelsPayload = Array.isArray(JSON.parse(response.body.toString('utf8'))?.data); } catch { /* invalid JSON */ }
    }
    if (response.ok && modelsPayload) return { ok: true, status: response.status };
    if (response.status === 401 || response.status === 403) return { ok: false, status: response.status, message: '供应商认证失败，请检查 API Key、令牌分组及访问权限' };
    if (response.status === 404) return { ok: false, status: response.status, message: '模型列表接口不存在，请检查 Base URL 是否包含正确的 /v1' };
    if (response.ok && !modelsPayload) return { ok: false, status: response.status, message: '接口返回的不是模型列表，请检查 Base URL 是否包含正确的 /v1' };
    if (response.status === 429) return { ok: false, status: response.status, message: '供应商限流或账户额度不足' };
    if (response.status >= 500) return { ok: false, status: response.status, message: '供应商服务暂时不可用' };
    return { ok: false, status: response.status, message: '模型列表接口测试失败' };
  } catch {
    return { ok: false, message: '供应商连接失败' };
  }
}

export function createVideoAdapter(kind: string, deps: VideoAdapterDeps): MediaGenerationAdapter {
  if (kind === 'openai-videos') return new OpenAIVideosAdapter(deps);
  if (kind === 'seedance') return new SeedanceAdapter(deps);
  if (kind === 'wan') return new WanAdapter(deps);
  throw new Error(`未知视频适配器：${kind}`);
}

export function canCreateVideoAdapter(kind: string) {
  return isVideoAdapterKind(kind);
}
