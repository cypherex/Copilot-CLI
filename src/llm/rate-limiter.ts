/**
 * Rate Limiter for LLM API calls
 *
 * Provides thread-safe rate limiting with randomized delays.
 * Uses async locks (mutex pattern) to ensure concurrent requests
 * properly wait for each other.
 */

export class RateLimiter {
  private lastRequestTime: number = 0;
  private lock: Promise<void> = Promise.resolve();
  private minIntervalMs: number;

  /**
   * Create a new RateLimiter
   * @param minIntervalMs Minimum time between requests (default: 100ms)
   */
  constructor(minIntervalMs: number = 100) {
    this.minIntervalMs = minIntervalMs;
  }

  /**
   * Acquire the rate limiter lock and wait until it's safe to proceed
   * @returns Promise that resolves when it's safe to make a request
   */
  async acquire(): Promise<void> {
    // Acquire the lock (mutex pattern)
    const release = await this.acquireLock();

    try {
      // Calculate time since last request
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      // If we need to wait, calculate random delay
      if (timeSinceLastRequest < this.minIntervalMs) {
        const baseDelay = this.minIntervalMs - timeSinceLastRequest;
        // Add randomization: baseDelay + random(0, baseDelay * 0.5)
        const randomExtra = Math.random() * (baseDelay * 0.5);
        const totalDelay = Math.ceil(baseDelay + randomExtra);

        // Sleep for the calculated delay
        await this.sleep(totalDelay);
      }

      // Update last request time
      this.lastRequestTime = Date.now();
    } finally {
      // Release the lock
      release();
    }
  }

  /**
   * Acquire an async lock using the promise chain pattern
   * @returns A function to release the lock
   */
  private async acquireLock(): Promise<() => void> {
    let releaseLock: () => void;

    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const oldLock = this.lock;
    this.lock = oldLock.then(() => newLock);

    // Wait for the previous lock to release
    await oldLock;
    return releaseLock!;
  }

  /**
   * Sleep for a specified number of milliseconds
   * @param ms Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset the rate limiter (e.g., after a long idle period)
   */
  reset(): void {
    this.lastRequestTime = 0;
  }

  /**
   * Get the time since the last request
   * @returns Time in milliseconds since last request
   */
  getTimeSinceLastRequest(): number {
    return Date.now() - this.lastRequestTime;
  }
}
