import { serializeAssetLinks } from './asset-response';

type StoredAsset = {
  id: string;
  role?: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  sizeBytes: bigint;
  note?: string | null;
  deletedAt?: Date | null;
  thumbnail?: { id: string; deletedAt: Date | null } | null;
};

type StoredJob = {
  id: string;
  conversationId: string;
  status: string;
  mode: string;
  prompt: string;
  errorMessage: string | null;
  parameters: unknown;
  modelSnapshot: unknown;
  assets: StoredAsset[];
};

export const generationJobSelect = {
  id: true,
  conversationId: true,
  status: true,
  mode: true,
  prompt: true,
  errorMessage: true,
  parameters: true,
  modelSnapshot: true,
  assets: {
    where: { role: 'OUTPUT' as const },
    select: {
      id: true,
      width: true,
      height: true,
      mimeType: true,
      sizeBytes: true,
      note: true,
      deletedAt: true,
      thumbnail: { select: { id: true, deletedAt: true } },
    },
  },
} as const;

function countParameter(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const count = (value as Record<string, unknown>).count;
  return Number.isInteger(count) ? { count: Number(count) } : {};
}

function displayName(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Unknown model';
  const name = (value as Record<string, unknown>).displayName;
  return typeof name === 'string' && name.trim() ? name : 'Unknown model';
}

export function serializeGenerationJob(job: StoredJob) {
  return {
    id: job.id,
    conversationId: job.conversationId,
    status: job.status,
    mode: job.mode,
    prompt: job.prompt,
    errorMessage: job.errorMessage,
    parameters: countParameter(job.parameters),
    modelSnapshot: { displayName: displayName(job.modelSnapshot) },
    assets: job.assets.map((asset) => ({
      id: asset.id,
      role: 'OUTPUT' as const,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes.toString(),
      note: asset.note ?? null,
      ...serializeAssetLinks(asset),
    })),
  };
}
