#!/usr/bin/env node

// Integration test for ProactiveContextMonitor with different usage levels

import { ProactiveContextMonitor } from '../src/agent/proactive-context-monitor.js';

async function testDifferentUsageLevels() {
  console.log('Testing ProactiveContextMonitor Integration\n');
  console.log('='.repeat(60));

  // Test with different usage levels
  const testCases = [
    { percent: 50, name: 'Normal usage (50%)', expectWarn: false },
    { percent: 70, name: 'Warning threshold (70%)', expectWarn: true },
    { percent: 85, name: 'Critical threshold (85%)', expectWarn: true },
    { percent: 95, name: 'Severe (95%)', expectWarn: true },
  ];

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('-'.repeat(60));

    const mockConversation = {
      getContextManager: () => {
        const totalTokens = Math.floor(8000 * (testCase.percent / 100));
        return {
          getUsage: () => ({
            totalTokens,
            systemTokens: Math.floor(totalTokens * 0.15),
            conversationTokens: Math.floor(totalTokens * 0.7),
            toolsTokens: Math.floor(totalTokens * 0.15),
            percentUsed: testCase.percent,
            remainingTokens: 8000 - totalTokens,
          }),
        };
      },
      getMessages: () => {
        const msgCount = Math.floor(testCase.percent / 10) + 5;
        return Array.from({ length: msgCount }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1} - Lorem ipsum dolor sit amet`,
        }));
      },
    } as any;

    const monitor = new ProactiveContextMonitor(mockConversation, {
      warningThreshold: 70,
      criticalThreshold: 85,
      cooldownPeriod: 0, // No cooldown for testing
    });

    const warned = monitor.checkAndWarn({ force: true });

    console.log(`\nWarning shown: ${warned} (expected: ${testCase.expectWarn})`);

    if (warned !== testCase.expectWarn) {
      console.error(`❌ Test failed for ${testCase.name}!`);
      process.exit(1);
    } else {
      console.log('✓ Test passed');
    }

    // Small delay for readability
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log('✓ All integration tests passed!\n');
}

testDifferentUsageLevels().catch(console.error);
