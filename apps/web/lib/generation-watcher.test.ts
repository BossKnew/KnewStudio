import assert from 'node:assert/strict';
import test from 'node:test';
import { watchGeneration, type GenerationEventSource } from './generation-watcher.ts';
import type { GenerationJob } from './studio-types.ts';

const succeededJob: GenerationJob = { id: 'job-1', status: 'SUCCEEDED', mode: 'TEXT_TO_IMAGE', prompt: 'test', errorMessage: null, parameters: {}, modelSnapshot: { displayName: 'Test' }, assets: [] };

test('falls back to a single-job poll after an SSE connection fails', async () => {
  let source: GenerationEventSource | undefined;
  let closeCount = 0;
  let fetched = 0;
  let terminal = 0;
  const timers = new Map<number, () => void>();
  let timerId = 0;

  watchGeneration({
    jobId: 'job-1', timeoutMs: 900_000, fallbackPollMs: 10_000,
    createEventSource: () => {
      source = { onmessage: null, onerror: null, close: () => { closeCount += 1; } };
      return source;
    },
    fetchJob: async () => { fetched += 1; return succeededJob; },
    onJob: () => undefined,
    onTerminal: () => { terminal += 1; },
    onTimeout: () => undefined,
    now: () => 0,
    schedule: (callback) => { timerId += 1; timers.set(timerId, callback); return timerId; },
    cancel: (id) => { timers.delete(id); },
  });

  source?.onerror?.(new Event('error'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fetched, 1);
  assert.equal(terminal, 1);
  assert.equal(closeCount, 1);
  assert.equal(timers.size, 0);
});
