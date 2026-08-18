import assert from 'node:assert/strict';
import test from 'node:test';
import { isTerminalGenerationStatus, parseGenerationEvent } from './generation-events.ts';

test('accepts valid terminal generation events', () => {
  const job = parseGenerationEvent(JSON.stringify({ id: 'job-1', status: 'SUCCEEDED', assets: [] }));
  assert.equal(job?.id, 'job-1');
  assert.equal(job && isTerminalGenerationStatus(job.status), true);
});

test('rejects malformed SSE payloads before updating UI state', () => {
  assert.equal(parseGenerationEvent('not json'), null);
  assert.equal(parseGenerationEvent(JSON.stringify({ id: 'job-1', status: 'UNKNOWN', assets: [] })), null);
});
