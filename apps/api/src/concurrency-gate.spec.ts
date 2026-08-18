import { ConcurrencyGate } from './concurrency-gate';

describe('ConcurrencyGate', () => {
  it('serializes expensive work at the configured limit', async () => {
    const gate = new ConcurrencyGate(1);
    let active = 0;
    let peak = 0;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await firstBlocked;
      active -= 1;
    });
    const second = gate.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      active -= 1;
    });

    await Promise.resolve();
    expect(active).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(peak).toBe(1);
  });
});
