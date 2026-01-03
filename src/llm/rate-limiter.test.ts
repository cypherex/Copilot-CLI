/**
 * Rate Limiter Tests
 * 
 * Tests for thread-safe rate limiting behavior with concurrent requests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter(100); // 100ms minimum interval
  });

  describe('Basic Rate Limiting', () => {
    it('should allow first request immediately', async () => {
      const startTime = Date.now();
      await rateLimiter.acquire();
      const elapsed = Date.now() - startTime;

      // First request should be nearly instant (less than 20ms for overhead)
      expect(elapsed).toBeLessThan(20);
    });

    it('should delay subsequent requests', async () => {
      const startTime = Date.now();

      // First request
      await rateLimiter.acquire();

      // Second request should be delayed
      await rateLimiter.acquire();

      const elapsed = Date.now() - startTime;

      // Should take at least 100ms + some overhead
      expect(elapsed).toBeGreaterThanOrEqual(95);
    });

    it('should use random delay variations', async () => {
      const delays: number[] = [];

      // Make 5 pairs of requests
      for (let i = 0; i < 5; i++) {
        rateLimiter.reset();
        const start = Date.now();
        await rateLimiter.acquire();
        await rateLimiter.acquire();
        delays.push(Date.now() - start);
      }

      // Check that delays vary (not all exactly the same)
      // Due to randomization, delays should differ by at least a few ms
      const minDelay = Math.min(...delays);
      const maxDelay = Math.max(...delays);
      expect(maxDelay - minDelay).toBeGreaterThan(5);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle concurrent requests correctly', async () => {
      const timestamps: number[] = [];

      // Launch 5 concurrent requests
      const promises = Array(5).fill(null).map(async () => {
        const before = Date.now();
        await rateLimiter.acquire();
        const after = Date.now();
        timestamps.push(after - before);
      });

      await Promise.all(promises);

      // All requests should have completed
      expect(timestamps).toHaveLength(5);

      // First request should be quick
      expect(timestamps[0]).toBeLessThan(20);

      // Last request should have waited for all previous ones
      expect(timestamps[4]).toBeGreaterThanOrEqual(400); // 4 * 100ms
    });

    it('should serialize concurrent requests', async () => {
      const results: number[] = [];
      let counter = 0;

      // Launch 10 concurrent requests
      const promises = Array(10).fill(null).map(async () => {
        await rateLimiter.acquire();
        results.push(++counter);
      });

      await Promise.all(promises);

      // Requests should be serialized (in order 1, 2, 3, ..., 10)
      expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('should handle rapid concurrent bursts', async () => {
      const startTime = Date.now();

      // Launch 20 concurrent requests all at once
      const promises = Array(20).fill(null).map(async () => {
        await rateLimiter.acquire();
      });

      await Promise.all(promises);

      const elapsed = Date.now() - startTime;

      // Should take approximately 2 seconds (20 requests * 100ms)
      // Allow for some randomness and overhead
      expect(elapsed).toBeGreaterThan(1900);
      expect(elapsed).toBeLessThan(3000);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset last request time', async () => {
      await rateLimiter.acquire();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Reset
      rateLimiter.reset();

      const start = Date.now();
      await rateLimiter.acquire();
      const elapsed = Date.now() - start;

      // Should be fast again (no waiting)
      expect(elapsed).toBeLessThan(20);
    });
  });

  describe('Configurable Interval', () => {
    it('should use custom interval', async () => {
      const customLimiter = new RateLimiter(200); // 200ms interval

      const start = Date.now();
      await customLimiter.acquire();
      await customLimiter.acquire();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(195);
    });

    it('should default to 100ms if not specified', async () => {
      const defaultLimiter = new RateLimiter();

      const start = Date.now();
      await defaultLimiter.acquire();
      await defaultLimiter.acquire();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(95);
    });

    it('should allow zero interval for no rate limiting', async () => {
      const noLimitLimiter = new RateLimiter(0);

      const start = Date.now();
      await noLimitLimiter.acquire();
      await noLimitLimiter.acquire();
      await noLimitLimiter.acquire();
      const elapsed = Date.now() - start;

      // Should complete very quickly with no artificial delays
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Utility Methods', () => {
    it('should track time since last request', async () => {
      // Before any request, time since last request is undefined/infinite
      // We just verify it returns a number
      const initialTime = rateLimiter.getTimeSinceLastRequest();
      expect(typeof initialTime).toBe('number');

      await rateLimiter.acquire();

      // Immediately after, should be very small
      const timeAfter = rateLimiter.getTimeSinceLastRequest();
      expect(timeAfter).toBeGreaterThanOrEqual(0);
      expect(timeAfter).toBeLessThan(50);

      // Wait 50ms
      await new Promise(resolve => setTimeout(resolve, 50));

      const timeAfterDelay = rateLimiter.getTimeSinceLastRequest();
      expect(timeAfterDelay).toBeGreaterThanOrEqual(45);
    });
  });

  describe('Stress Test', () => {
    it('should handle 100 requests without errors', async () => {
      // Increase timeout for this long-running test (100 * 100ms = 10s)

      const promises = Array(100).fill(null).map(async () => {
        await rateLimiter.acquire();
      });

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should maintain timing consistency with high concurrency', async () => {
      // Increase timeout for this long-running test (50 * 100ms = 5s)
      jest.setTimeout(10000);

      const startTime = Date.now();

      // Launch 50 concurrent requests
      const promises = Array(50).fill(null).map(async () => {
        await rateLimiter.acquire();
      });

      await Promise.all(promises);

      const elapsed = Date.now() - startTime;

      // Should be approximately 50 * 100ms = 5 seconds
      // Allow for randomness (+/- 20%)
      expect(elapsed).toBeGreaterThan(4000);
      expect(elapsed).toBeLessThan(7000);
    });
  });
});
