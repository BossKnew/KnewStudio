export type UserRole = 'USER' | 'ADMIN';

export type StudioUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  mustChangePwd: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
};

export type SecurityUser = Pick<StudioUser, 'role' | 'mfaEnabled' | 'mfaRequired'>;

export type UsagePolicy = {
  groupId: string;
  groupName: string;
  window: string;
  images: number;
  used: number;
  remaining: number;
  resetAt: string | null;
  retryAfterSeconds: number;
};

export type VideoUsagePolicy = {
  groupId: string;
  groupName: string;
  window: string;
  seconds: number;
  used: number;
  remaining: number;
  resetAt: string | null;
  retryAfterSeconds: number;
};

export type UsageSnapshot = {
  storageBytes: string;
  storageQuotaBytes: string;
  policies: UsagePolicy[];
  videoPolicies?: VideoUsagePolicy[];
};
export type CursorPage<T> = { items: T[]; nextCursor: string | null; total?: number };

export type MediaKind = 'IMAGE' | 'VIDEO';
export type GenerationMode = 'TEXT_TO_IMAGE' | 'IMAGE_EDIT' | 'INPAINT' | 'TEXT_TO_VIDEO' | 'IMAGE_TO_VIDEO';
export type GenerationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type StudioModel = {
  id: string;
  displayName: string;
  mediaKind?: MediaKind;
  supportsGeneration: boolean;
  supportsEdit: boolean;
  supportsInpaint: boolean;
  allowedSizes: string[];
  allowedQualities: string[];
  allowedDurations?: number[];
  maxImages: number;
  maxInputImages: number;
  defaults: { size?: string; quality?: string; count?: number; durationSeconds?: number };
};

export type ConversationSummary = { id: string; title: string; _count: { jobs: number } };

export type StudioGroup = { id: string; name: string };

export type Asset = {
  id: string;
  role: 'UPLOAD' | 'OUTPUT' | 'MASK';
  mediaKind?: MediaKind;
  durationMs?: number | null;
  contentUrl: string;
  thumbnailUrl?: string | null;
  width: number | null;
  height: number | null;
  mimeType?: string;
  originalName?: string | null;
  sizeBytes?: string;
  note: string | null;
  generationPrompt?: string | null;
  visibility?: 'owned' | 'shared';
  sharedGroupIds?: string[];
  shareId?: string;
  sharedAt?: string;
  group?: StudioGroup;
  sharedBy?: { displayName: string };
  canUnshare?: boolean;
};

export type JobAsset = Omit<Asset, 'contentUrl'> & { contentUrl: string | null; deleted?: boolean };

export type GenerationJob = {
  id: string;
  conversationId?: string;
  status: GenerationStatus;
  mode: GenerationMode;
  mediaKind?: MediaKind;
  prompt: string;
  errorMessage: string | null;
  parameters: { count?: number; durationSeconds?: number; size?: string; quality?: string };
  modelSnapshot: { displayName: string };
  assets: JobAsset[];
};

export type ConversationDetail = { id: string; title: string; jobs: GenerationJob[]; nextJobCursor?: string | null };
export type GenerationCreated = { id: string; conversationId: string; status: GenerationStatus };

export type ReferenceSelection =
  | { key: string; kind: 'asset'; asset: Asset }
  | { key: string; kind: 'file'; file: File };

export type GenerationReuse = {
  prompt: string;
  mode: GenerationMode;
  modelId: string | null;
  modelDisplayName: string;
  size: string | null;
  quality: string | null;
  count: number;
  durationSeconds?: number | null;
  sourceAssets: Asset[];
  requiresMaskRedraw: boolean;
};

export type PromptEntry = {
  id: string;
  prompt: string;
  isFavorite: boolean;
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
};

export type DownloadAsset = {
  id: string;
  mimeType?: string;
  downloadName: string;
  contentUrl: string;
  thumbnailUrl?: string | null;
};

export function getActiveGenerationJobs(conversation: ConversationDetail): GenerationJob[] {
  return conversation.jobs.filter((job) => job.status === 'QUEUED' || job.status === 'RUNNING');
}
