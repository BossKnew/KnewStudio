import { isTerminalGenerationStatus, parseGenerationEvent } from './generation-events.ts';
import type { GenerationJob } from './studio-types.ts';

export type GenerationEventSource = {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: () => void;
};

type GenerationWatcherOptions = {
  jobId: string;
  timeoutMs: number;
  fallbackPollMs: number;
  createEventSource: (url: string) => GenerationEventSource;
  fetchJob: () => Promise<GenerationJob>;
  onJob: (job: GenerationJob) => void;
  onTerminal: (job: GenerationJob) => void;
  onTimeout: () => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => number;
  cancel?: (timerId: number) => void;
};

export function watchGeneration(options: GenerationWatcherOptions) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay));
  const cancel = options.cancel ?? ((timerId) => window.clearTimeout(timerId));
  const deadline = now() + options.timeoutMs;
  let source: GenerationEventSource | undefined;
  let fallbackTimer: number | undefined;
  let deadlineTimer: number | undefined;
  let usingFallback = false;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    source?.close();
    if (fallbackTimer !== undefined) cancel(fallbackTimer);
    if (deadlineTimer !== undefined) cancel(deadlineTimer);
  }

  function handleJob(job: GenerationJob) {
    if (closed) return;
    options.onJob(job);
    if (!isTerminalGenerationStatus(job.status)) return;
    close();
    options.onTerminal(job);
  }

  function beginFallback() {
    if (closed || usingFallback) return;
    usingFallback = true;
    source?.close();
    source = undefined;
    const poll = async () => {
      if (closed) return;
      if (now() >= deadline) {
        close();
        options.onTimeout();
        return;
      }
      try {
        handleJob(await options.fetchJob());
      } catch {
        // Retry at a bounded cadence until the deadline; the SSE connection has already failed.
      }
      if (!closed) fallbackTimer = schedule(() => { void poll(); }, options.fallbackPollMs);
    };
    void poll();
  }

  try {
    source = options.createEventSource(`/api/v1/generations/${options.jobId}/events`);
    source.onmessage = (event) => {
      const job = parseGenerationEvent(event.data);
      if (job) handleJob(job);
      else beginFallback();
    };
    source.onerror = beginFallback;
  } catch {
    beginFallback();
  }
  deadlineTimer = schedule(() => {
    if (!closed) {
      close();
      options.onTimeout();
    }
  }, options.timeoutMs);
  return close;
}
