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
export type CursorPage<T> = { items: T[]; nextCursor: string | null; total?: number };

export type GenerationMode = 'TEXT_TO_IMAGE' | 'IMAGE_EDIT' | 'INPAINT';
export type GenerationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type StudioModel = {
  id: string;
  displayName: string;
  supportsGeneration: boolean;
  supportsEdit: boolean;
  supportsInpaint: boolean;
  allowedSizes: string[];
  allowedQualities: string[];
  maxImages: number;
  maxInputImages: number;
  defaults: { size?: string; quality?: string; count?: number };
};

export type ConversationSummary = { id: string; title: string; _count: { jobs: number } };

export type Asset = {
  id: string;
  role: 'UPLOAD' | 'OUTPUT' | 'MASK';
  contentUrl: string;
  thumbnailUrl?: string | null;
  width: number | null;
  height: number | null;
  mimeType?: string;
  originalName?: string | null;
  sizeBytes?: string;
  note: string | null;
  generationPrompt?: string | null;
};

export type JobAsset = Omit<Asset, 'contentUrl'> & { contentUrl: string | null; deleted?: boolean };

export type GenerationJob = {
  id: string;
  conversationId?: string;
  status: GenerationStatus;
  mode: GenerationMode;
  prompt: string;
  errorMessage: string | null;
  parameters: { count?: number };
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
