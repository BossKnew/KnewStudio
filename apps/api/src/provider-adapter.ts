/**
 * Stable boundary for remote media providers. V1 ships only the OpenAI Images
 * behavior in the worker. This file is intentionally not registered in V1:
 * future Seedance/Wan implementations plug into this contract and are selected
 * by Provider.adapterKind once video generation ships.
 */
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
  bytes: Uint8Array;
}

export interface MediaGenerationAdapter {
  readonly kind: string;
  readonly mediaKind: AdapterMediaKind;
  generate(request: MediaGenerationRequest): Promise<GeneratedMedia[]>;
  testConnection(): Promise<{ ok: boolean; status?: number; message?: string }>;
}

export const RESERVED_VIDEO_ADAPTERS = ['seedance', 'wan'] as const;
