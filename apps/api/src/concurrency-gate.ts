export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Concurrency limit must be a positive integer');
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await operation(); }
    finally { this.release(); }
  }

  private acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}
