export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const THUMBNAIL_MAX_EDGE = 512;
export const THUMBNAIL_QUALITY = 82;
export const MASK_CANVAS_MAX_EDGE = 2048;

export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'] as const;
export const TERMINAL_JOB_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const;

export const GENERATION_QUEUE_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 100,
};

export const SESSION_PREFIX = 'session:v2:';
export const USER_SESSIONS_PREFIX = 'user_sessions:v2:';
