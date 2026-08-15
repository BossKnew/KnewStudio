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
  defaults: { size?: string; quality?: string; count?: number };
};

export type ConversationSummary = { id: string; title: string; _count: { jobs: number } };

export type Asset = {
  id: string;
  role: 'UPLOAD' | 'OUTPUT' | 'MASK';
  contentUrl: string;
  width: number | null;
  height: number | null;
  note: string | null;
  generationPrompt?: string | null;
};

export type JobAsset = Omit<Asset, 'contentUrl'> & { contentUrl: string | null; deleted?: boolean };

export type GenerationJob = {
  id: string;
  status: GenerationStatus;
  mode: GenerationMode;
  prompt: string;
  errorMessage: string | null;
  parameters: { count?: number };
  modelSnapshot: { displayName: string };
  assets: JobAsset[];
};

export type ConversationDetail = { id: string; title: string; jobs: GenerationJob[] };
export type GenerationCreated = { id: string; conversationId: string; status: GenerationStatus };

export function getActiveGenerationJobs(conversation: ConversationDetail): GenerationJob[] {
  return conversation.jobs.filter((job) => job.status === 'QUEUED' || job.status === 'RUNNING');
}
