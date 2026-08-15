import assert from 'node:assert/strict';
import test from 'node:test';
import { retryAsync } from './retry.ts';

test('retries transient failures with bounded incremental delays', async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryAsync(async () => {
    calls += 1;
    if (calls < 3) throw new Error('transient');
    return 'ok';
  }, 3, 25, async (delay) => { delays.push(delay); });

  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [25, 50]);
});

test('stops after the configured number of attempts', async () => {
  let calls = 0;
  await assert.rejects(
    retryAsync(async () => {
      calls += 1;
      throw new Error('still unavailable');
    }, 2, 1, async () => undefined),
    /still unavailable/,
  );
  assert.equal(calls, 2);
});
