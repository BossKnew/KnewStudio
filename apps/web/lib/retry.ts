type Wait = (delayMs: number) => Promise<void>;

const wait: Wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function retryAsync<T>(
  operation: () => Promise<T>,
  attempts = 3,
  delayMs = 1000,
  waitForDelay: Wait = wait,
): Promise<T> {
  if (attempts < 1) throw new RangeError('attempts must be at least 1');

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await waitForDelay(delayMs * attempt);
    }
  }

  throw lastError;
}
