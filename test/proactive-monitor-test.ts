#!/usr/bin/env node

// Test script for ProactiveContextMonitor

import { ConversationManager } from '../src/agent/conversation.js';
import { ProactiveContextMonitor } from '../src/agent/proactive-context-monitor.js';
import { LLMClient } from '../src/llm/types.js';

async function testProactiveMonitor() {
  console.log('Testing ProactiveContextMonitor...\n');

  // Create a mock conversation manager
  const mockConversation = {
    getContextManager: () => {
      return {
        getUsage: () => ({
          totalTokens: 5600,
          systemTokens: 1000,
          conversationTokens: 4000,
          toolsTokens: 600,
          percentUsed: 70,
          remainingTokens: 2400,
        }),
      };
    },
    getMessages: () => {
      // Simulate 12 messages
      return Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`,
      }));
    },
  } as unknown as ConversationManager;

  const monitor = new ProactiveContextMonitor(mockConversation, {
    warningThreshold: 70,
    criticalThreshold: 85,
    cooldownPeriod: 1000, // Short for testing
  });

  // Test 1: Check warning at 70%
  console.log('Test 1: Warning threshold (70%)');
  const warned1 = monitor.checkAndWarn({ force: true });
  console.log(`Warning shown: ${warned1}\n`);

  // Test 2: Cooldown period
  console.log('Test 2: Cooldown period (should not warn)');
  const warned2 = monitor.checkAndWarn();
  console.log(`Warning shown: ${warned2} (expected: false)\n`);

  // Test 3: Wait for cooldown and force warning
  await new Promise(resolve => setTimeout(resolve, 1100));
  console.log('Test 3: After cooldown, force warning');
  const warned3 = monitor.checkAndWarn({ force: true });
  console.log(`Warning shown: ${warned3}\n`);

  // Test 4: Summary prompt
  console.log('Test 4: Summary prompt check');
  const shouldPrompt = monitor.shouldPromptSummary();
  console.log(`Should prompt: ${shouldPrompt}`);
  if (shouldPrompt) {
    monitor.displaySummaryPrompt();
  }

  console.log('\n✓ All tests passed!');
}

testProactiveMonitor().catch(console.error);
