#!/usr/bin/env node

/**
 * Demonstration script for mandatory delegation implementation
 * This script simulates the key functionality without running the full system
 */

console.log('='.repeat(70));
console.log('MANDATORY DELEGATION SYSTEM - DEMONSTRATION');
console.log('='.repeat(70));

// Test cases demonstrating mandatory vs suggested delegation
const testCases = [
  {
    type: 'MANDATORY',
    message: 'For each file in src/, add unit tests',
    expected: {
      mandatory: true,
      priority: 'high',
      roleId: undefined,
      reason: 'Multiple files/modules need processing - MUST spawn parallel subagents'
    }
  },
  {
    type: 'MANDATORY',
    message: 'Investigate why the auth service is returning 401',
    expected: {
      mandatory: true,
      priority: 'high',
      roleId: 'investigator',
      reason: 'Investigation task detected'
    }
  },
  {
    type: 'MANDATORY',
    message: 'Debug the issue causing the payment module to crash',
    expected: {
      mandatory: true,
      priority: 'high',
      roleId: 'investigator',
      reason: 'Debugging/diagnosis task'
    }
  },
  {
    type: 'MANDATORY',
    message: 'Fix the bug that prevents users from logging in',
    expected: {
      mandatory: true,
      priority: 'high',
      roleId: 'fixer',
      reason: 'Bug fix task detected'
    }
  },
  {
    type: 'SUGGESTION',
    message: 'Write tests for the utility functions',
    expected: {
      mandatory: false,
      priority: 'medium',
      roleId: 'test-writer',
      reason: 'Test writing task detected'
    }
  },
  {
    type: 'SUGGESTION',
    message: 'Refactor the controller code to use dependency injection',
    expected: {
      mandatory: false,
      priority: 'medium',
      roleId: 'refactorer',
      reason: 'Refactoring task detected'
    }
  },
  {
    type: 'SUGGESTION',
    message: 'Update the README with new instructions',
    expected: {
      mandatory: false,
      priority: 'low',
      roleId: 'documenter',
      reason: 'Documentation task detected'
    }
  }
];

let passCount = 0;
let failCount = 0;

testCases.forEach((test, index) => {
  console.log(`\nTest ${index + 1}: ${test.type} DELEGATION`);
  console.log('-'.repeat(70));
  console.log(`User Message: "${test.message}"`);
  
  const result = simulateDetection(test.message);
  const passed = 
    result.mandatory === test.expected.mandatory &&
    result.priority === test.expected.priority &&
    result.roleId === test.expected.roleId;
  
  if (passed) {
    console.log(`\n✓ PASS`);
    console.log(`  Mode: ${result.mandatory ? 'MANDATORY' : 'SUGGESTION'}`);
    console.log(`  Priority: ${result.priority}`);
    console.log(`  Role: ${result.roleId || 'General'}`);
    console.log(`  Reason: ${result.reason}`);
    
    // Show hint format
    console.log(`\nHint Format:`);
    console.log('  ' + getHintPreview(result));
    passCount++;
  } else {
    console.log(`\n✗ FAIL`);
    console.log(`  Expected: mandatory=${test.expected.mandatory}, priority=${test.expected.priority}`);
    console.log(`  Got: mandatory=${result.mandatory}, priority=${result.priority}`);
    failCount++;
  }
});

console.log('\n' + '='.repeat(70));
console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(70));

function simulateDetection(message) {
  const msg = message.toLowerCase();
  
  // Mandatory patterns (high priority)
  if (/\bfor each (file|module|service|component)\b/i.test(msg)) {
    return {
      mandatory: true,
      priority: 'high',
      roleId: undefined,
      reason: 'Multiple files/modules need processing - MUST spawn parallel subagents'
    };
  }
  
  if (/\binvestigate\b/i.test(msg)) {
    return {
      mandatory: true,
      priority: 'high',
      roleId: 'investigator',
      reason: 'Investigation task detected'
    };
  }
  
  if (/\b(debug|debugging|diagnos)\b/i.test(msg)) {
    return {
      mandatory: true,
      priority: 'high',
      roleId: 'investigator',
      reason: 'Debugging/diagnosis task'
    };
  }
  
  if (/\b(fix|resolve|solves?)(\s+(a|the|this)?\s+)(bug|error|issue|problem)\b/i.test(msg)) {
    return {
      mandatory: true,
      priority: 'high',
      roleId: 'fixer',
      reason: 'Bug fix task detected'
    };
  }
  
  // Non-mandatory patterns (medium/low priority)
  if (/\b(write|create|add)\s+tests?\b/i.test(msg)) {
    return {
      mandatory: false,
      priority: 'medium',
      roleId: 'test-writer',
      reason: 'Test writing task detected'
    };
  }
  
  if (/\brefactor\b/i.test(msg)) {
    return {
      mandatory: false,
      priority: 'medium',
      roleId: 'refactorer',
      reason: 'Refactoring task detected'
    };
  }
  
  if (/\b(update|write|add)\s+(readme|docs?|documentation?)\b/i.test(msg)) {
    return {
      mandatory: false,
      priority: 'low',
      roleId: 'documenter',
      reason: 'Documentation task detected'
    };
  }
  
  return {
    mandatory: false,
    priority: 'low',
    roleId: undefined,
    reason: 'No pattern detected'
  };
}

function getHintPreview(opportunity) {
  if (opportunity.mandatory) {
    return `⚠️ [WARNING] MANDATORY DELEGATION\n   [REQUIREMENT]\n   YOU MUST delegate this task to a subagent`;
  } else {
    return `[SUBAGENT SUGGESTION]\n   ${opportunity.reason}\n   Consider spawning a subagent if this task is large or complex.`;
  }
}
