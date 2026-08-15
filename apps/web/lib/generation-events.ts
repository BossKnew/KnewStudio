import type { GenerationJob, GenerationStatus } from './studio-types';

const terminalStatuses = new Set<GenerationStatus>(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export function isTerminalGenerationStatus(status: GenerationStatus) {
  return terminalStatuses.has(status);
}

export function parseGenerationEvent(value: string): GenerationJob | null {
  try {
    const payload: unknown = JSON.parse(value);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const job = payload as Partial<GenerationJob>;
    if (typeof job.id !== 'string' || !isGenerationStatus(job.status) || !Array.isArray(job.assets)) return null;
    return job as GenerationJob;
  } catch {
    return null;
  }
}

function isGenerationStatus(value: unknown): value is GenerationStatus {
  return typeof value === 'string' && ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value);
}
