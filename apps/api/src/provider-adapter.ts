/**
 * Stable boundary for remote media providers. Image generation still uses the
 * dedicated Images worker. Video providers are selected by Provider.adapterKind.
 */
import { IMAGE_ADAPTER_KIND, isVideoAdapterKind, type VideoAdapterKind } from './domain-constants';
import type { SafeHttpService } from './safe-http.service';

export type AdapterMediaKind = 'IMAGE' | 'VIDEO';
export type AdapterOperation = 'TEXT_TO_IMAGE' | 'IMAGE_EDIT' | 'INPAINT' | 'TEXT_TO_VIDEO' | 'IMAGE_TO_VIDEO';

export interface MediaGenerationRequest {
  mediaKind: AdapterMediaKind;
  operation: AdapterOperation;
  upstreamModelId: string;
  prompt: string;
  parameters: Record<string, unknown>;
  inputAssets: Array<{ mimeType: string; bytes: Uint8Array; role: 'SOURCE' | 'MASK' }>;
}

export interface GeneratedMedia {
  mimeType: string;
  bytes?: Uint8Array;
  path?: string;
}

export interface VideoAdapterDeps {
  http: SafeHttpService;
  headers: Record<string, string>;
  baseUrl: string;
  timeoutSeconds: number;
  pollTimeoutSeconds: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  createStagingPath?: (extension?: string) => Promise<string>;
}

export interface MediaGenerationAdapter {
  readonly kind: string;
  readonly mediaKind: AdapterMediaKind;
  createTask(request: MediaGenerationRequest): Promise<string>;
  collect(taskId: string, request: MediaGenerationRequest): Promise<GeneratedMedia[]>;
  testConnection(): Promise<{ ok: boolean; status?: number; message?: string }>;
}

export const RESERVED_VIDEO_ADAPTERS = ['openai-videos', 'seedance', 'wan'] as const;

export function normalizeAdapterKind(value: unknown): string {
  const kind = typeof value === 'string' ? value.trim() : '';
  return kind || IMAGE_ADAPTER_KIND;
}

export function assertVideoAdapterKind(kind: string): asserts kind is VideoAdapterKind {
  if (!isVideoAdapterKind(kind)) throw new Error(`未知视频适配器：${kind}`);
}

export function videoHttpFailure(status: number, providerCode?: string) {
  if (providerCode === 'moderation_blocked') return { code: 'PROVIDER_MODERATION', message: '请求或生成结果被供应商安全检查拒绝，请调整提示词或参考图后重试' };
  if (status === 400 || status === 422) {
    const detail = providerCode ? `（错误代码：${providerCode}）` : '';
    return { code: 'PROVIDER_PARAMETERS', message: `供应商拒绝了视频或模型参数${detail}，请管理员检查模型 ID、比例、时长、分辨率和参考图` };
  }
  if (status === 401 || status === 403) return { code: 'PROVIDER_AUTH', message: '供应商认证失败，请管理员检查 API Key 和请求头' };
  if (status === 404) return { code: 'PROVIDER_NOT_FOUND', message: '供应商接口或模型不存在，请管理员检查 Base URL 和模型 ID' };
  if (status === 429) return { code: 'PROVIDER_LIMIT', message: '供应商限流或账户额度不足，请稍后重试' };
  return { code: 'PROVIDER_UNAVAILABLE', message: '供应商服务暂时不可用，请稍后重试' };
}

export function providerProtocolError(message: string, failure?: { code: string; message: string }) {
  const error: any = new Error(message);
  error.noRetry = true;
  error.providerFailure = failure ?? { code: 'PROVIDER_RESPONSE', message: '供应商响应格式无效，请管理员检查 Base URL 和适配器类型' };
  return error;
}

export function providerTimeoutError() {
  const error: any = new Error('视频任务等待超时');
  error.noRetry = true;
  error.providerFailure = { code: 'PROVIDER_TIMEOUT', message: '视频生成等待超时，请稍后重试或让管理员提高任务等待超时' };
  return error;
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function aspectRatioOf(parameters: Record<string, unknown>) {
  return stringParam(parameters, 'aspectRatio') ?? stringParam(parameters, 'size') ?? '';
}

export function durationSecondsOf(parameters: Record<string, unknown>) {
  const value = parameters.durationSeconds;
  return typeof value === 'number' && Number.isInteger(value) ? value : Number(stringParam(parameters, 'duration') ?? 0);
}

export function resolutionOf(parameters: Record<string, unknown>) {
  return stringParam(parameters, 'resolution') ?? stringParam(parameters, 'quality') ?? '';
}

function stringParam(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
