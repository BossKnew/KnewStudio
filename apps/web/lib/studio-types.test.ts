import assert from 'node:assert/strict';
import test from 'node:test';
import { getActiveGenerationJobs, type ConversationDetail, type GenerationStatus } from './studio-types.ts';

function job(id: string, status: GenerationStatus): ConversationDetail['jobs'][number] {
  return {
    id,
    status,
    mode: 'TEXT_TO_IMAGE',
    prompt: '',
    errorMessage: null,
    parameters: {},
    modelSnapshot: { displayName: 'Test' },
    assets: [],
  };
}

test('selects queued and running jobs for watcher recovery', () => {
  const conversation: ConversationDetail = {
    id: 'conversation-1',
    title: 'Test',
    jobs: [
      job('queued', 'QUEUED'),
      job('running', 'RUNNING'),
      job('succeeded', 'SUCCEEDED'),
      job('failed', 'FAILED'),
      job('cancelled', 'CANCELLED'),
    ],
  };

  assert.deepEqual(getActiveGenerationJobs(conversation).map(({ id }) => id), ['queued', 'running']);
});
