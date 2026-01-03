/**
 * Simple test runner for rate limiting behavior
 * This tests concurrent requests and verifies rate limiting works correctly
 */

import { RateLimiter } from './rate-limiter.js';

async function testBasicRateLimiting() {
  console.log('\n=== Test: Basic Rate Limiting ===');
  const rateLimiter = new RateLimiter(100);

  const start = Date.now();
  await rateLimiter.acquire();
  const firstRequestTime = Date.now() - start;

  await rateLimiter.acquire();
  const secondRequestTime = Date.now() - start;

  console.log(`First request took: ${firstRequestTime}ms`);
  console.log(`Second request took: ${secondRequestTime}ms`);

  if (firstRequestTime < 50) {
    console.log('✓ First request was immediate');
  } else {
    console.log('✗ First request was delayed (should be immediate)');
  }

  if (secondRequestTime >= 95) {
    console.log('✓ Second request was rate-limited correctly');
  } else {
    console.log('✗ Second request was not delayed enough');
  }
}

async function testConcurrentRequests() {
  console.log('\n=== Test: Concurrent Requests ===');
  const rateLimiter = new RateLimiter(100);

  const timestamps: any[] = [];
  const promises = Array(5).fill(null).map(async (index) => {
    const before = Date.now();
    await rateLimiter.acquire();
    const after = Date.now();
    timestamps.push({ index, time: after - before });
    console.log(`Request ${index} completed at ${after - before}ms`);
  });

  const start = Date.now();
  await Promise.all(promises);
  const totalTime = Date.now() - start;

  console.log(`Total time for 5 concurrent requests: ${totalTime}ms`);

  // Check that requests were serialized
  const times = timestamps.map(t => t.time).sort((a, b) => a - b);
  if (times[4] >= 400) { // 4 * 100ms
    console.log('✓ Requests were properly serialized');
  } else {
    console.log('✗ Requests were not properly serialized');
  }
}

async function testConcurrentBurst() {
  console.log('\n=== Test: Concurrent Burst (20 requests) ===');
  const rateLimiter = new RateLimiter(100);

  const start = Date.now();

  // Launch 20 concurrent requests
  const promises = Array(20).fill(null).map(async () => {
    await rateLimiter.acquire();
  });

  await Promise.all(promises);
  const elapsed = Date.now() - start;

  console.log(`Total time for 20 concurrent requests: ${elapsed}ms`);

  // Should be approximately 2 seconds (20 * 100ms)
  if (elapsed >= 1900 && elapsed < 3000) {
    console.log('✓ Rate limiting maintained timing consistency');
  } else {
    console.log(`✗ Timing was off. Expected ~2000ms, got ${elapsed}ms`);
  }
}

async function testNoRateLimit() {
  console.log('\n=== Test: No Rate Limiting (0ms interval) ===');
  const rateLimiter = new RateLimiter(0);

  const start = Date.now();

  // Make 5 requests
  const promises = Array(5).fill(null).map(async () => {
    await rateLimiter.acquire();
  });

  await Promise.all(promises);
  const elapsed = Date.now() - start;

  console.log(`Total time for 5 requests with no rate limit: ${elapsed}ms`);

  if (elapsed < 100) {
    console.log('✓ No artificial delays with 0ms interval');
  } else {
    console.log('✗ Unexpected delays even with 0ms interval');
  }
}

async function testRandomDelays() {
  console.log('\n=== Test: Random Delay Variations ===');
  const rateLimiter = new RateLimiter(100);

  const delays: number[] = [];

  // Make 5 pairs of requests
  for (let i = 0; i < 5; i++) {
    rateLimiter.reset();
    const start = Date.now();
    await rateLimiter.acquire();
    await rateLimiter.acquire();
    delays.push(Date.now() - start);
  }

  console.log('Delays for 5 pairs:', delays.map(d => `${d}ms`).join(', '));

  const minDelay = Math.min(...delays);
  const maxDelay = Math.max(...delays);
  const variation = maxDelay - minDelay;

  console.log(`Min delay: ${minDelay}ms, Max delay: ${maxDelay}ms, Variation: ${variation}ms`);

  if (variation > 5) {
    console.log('✓ Random delay variations present');
  } else {
    console.log('✗ No significant random variation');
  }
}

async function runAllTests() {
  console.log('=== Rate Limiter Test Suite ===');
  console.log('Testing thread-safe rate limiting behavior...\n');

  try {
    await testBasicRateLimiting();
    await testConcurrentRequests();
    await testConcurrentBurst();
    await testNoRateLimit();
    await testRandomDelays();

    console.log('\n=== All Tests Complete ===');
  } catch (error) {
    console.error('\n✗ Test failed with error:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(console.error);
