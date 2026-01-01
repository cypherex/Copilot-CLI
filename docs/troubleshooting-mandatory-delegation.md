# Troubleshooting Mandatory Delegation

Comprehensive troubleshooting guide for the mandatory delegation system.

## Table of Contents

- [Common Issues](#common-issues)
- [Debugging Steps](#debugging-steps)
- [Diagnostic Commands](#diagnostic-commands)
- [Testing Patterns](#testing-patterns)
- [Advanced Debugging](#advanced-debugging)

---

## Common Issues

### Issue 1: Agent Not Delegating When Mandatory

**Symptoms:**
- Warning banner appears, but agent does work directly
- No `spawn_agent` tool call is made
- Agent ignores the mandatory delegation instruction

**Possible Causes:**
1. System instruction not injected into conversation
2. Agent chooses to ignore system instruction
3. Pattern detection failed (false negative)
4. Priority or mandatory flag misconfigured

**Solutions:**

#### Check 1: Verify Pattern Detection

Create a test script `test-detection.js`:

```javascript
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const testMessage = 'For each module, add unit tests';
const result = detectSubagentOpportunity(testMessage);

console.log('Pattern Matched:', !!result);
console.log('Mandatory:', result?.mandatory);
console.log('Priority:', result?.priority);
console.log('Reason:', result?.reason);
console.log('Role:', result?.roleId);

// Expected output:
// Pattern Matched: true
// Mandatory: true
// Priority: high
// Reason: Multiple files/modules need processing - MUST spawn parallel subagents
// Role: undefined
```

Run with: `node test-detection.js`

#### Check 2: Verify System Injection

In `src/agent/loop.ts`, add temporary logging around line 140-150:

```typescript
if (this.currentSubagentOpportunity && iteration === 1) {
  const hint = buildSubagentHint(this.currentSubagentOpportunity);
  console.log('[DEBUG] Injecting hint:', hint);
  
  messages = [
    ...messages.slice(0, -1),
    { role: 'system' as const, content: hint },
    messages[messages.length - 1],
  ];
}
```

#### Check 3: Review System Prompt

Ensure `src/agent/system-prompt.ts` includes the mandatory delegation section:

```typescript
// Should contain:
# Mandatory vs Suggested Delegation

⚠️ **IMPORTANT**: Subagent delegation operates in two modes:

### Mandatory Delegation (REQUIREMENT)
When the system detects a MANDATORY delegation opportunity (marked with ⚠️ [WARNING]):
- **YOU MUST** delegate the task to a subagent
- **DO NOT** attempt to complete the task directly
```

---

### Issue 2: False Positives - Delegating When Not Expected

**Symptoms:**
- Agent spawns subagent for simple tasks
- Warning appears for unrelated messages
- Delegation triggered by common words

**Possible Causes:**
1. Pattern regex too broad
2. Pattern matches partial words
3. Low-priority patterns overriding expectations

**Solutions:**

#### Identify Which Pattern Matched

```javascript
import { PATTERNS } from './src/agent/subagent-detector.js';

const message = 'Your test message here';
const messageLower = message.toLowerCase();

console.log('Matching patterns for:', message);
for (const { pattern, opportunity } of PATTERNS) {
  if (pattern.test(messageLower)) {
    console.log(`✓ Pattern: ${pattern}`);
    console.log(`  Priority: ${opportunity.priority}`);
    console.log(`  Mandatory: ${opportunity.mandatory}`);
    console.log(`  Reason: ${opportunity.reason}`);
    console.log('');
  }
}
```

#### Test Pattern Specificity

```javascript
const testCases = [
  { msg: 'Is all good to go?', shouldMatch: false },
  { msg: 'The file is all correct', shouldMatch: false },
  { msg: 'Update all modules', shouldMatch: true },
];

testCases.forEach(({ msg, shouldMatch }) => {
  const result = detectSubagentOpportunity(msg);
  const matched = !!result;
  const pass = matched === shouldMatch;
  const status = pass ? '✅' : '❌';
  console.log(`${status} "${msg}" → ${matched ? 'MATCH' : 'no match'} (expected ${shouldMatch ? 'match' : 'no match'})`);
});
```

#### Fix: Narrow the Regex

```typescript
// Too broad - matches "Is all good to go?"
pattern: /\ball\s+(files?|services?|modules?|components?)\b/i,

// Better - requires action verb before "all"
pattern: /\b(add|update|fix|remove|modify|change|apply)\s+all\s+(files?|services?|modules?|components?)\b/i,

// Or use negative lookahead
pattern: /\ball\s+(files?|services?|modules?|components?)\b/i,
// Then add: !/\b(good|right|correct|well|ok|okay)\b/i.test(message)
```

---

### Issue 3: Multiple Patterns Match - Wrong One Selected

**Symptoms:**
- Multiple patterns could match
- Lower-priority pattern selected
- Unexpected role assigned

**Debug Script:**

```javascript
import { detectSubagentOpportunity, PATTERNS } from './src/agent/subagent-detector.js';

const message = 'Investigate and fix the bug';
const messageLower = message.toLowerCase();

console.log('All matching patterns for:', message);
console.log('');

const matches = [];

for (const { pattern, opportunity } of PATTERNS) {
  if (pattern.test(messageLower)) {
    matches.push({
      pattern: pattern.toString(),
      priority: opportunity.priority,
      mandatory: opportunity.mandatory,
      roleId: opportunity.roleId,
      reason: opportunity.reason,
    });
    console.log(`Pattern: ${pattern}`);
    console.log(`  Priority: ${opportunity.priority}`);
    console.log(`  Mandatory: ${opportunity.mandatory}`);
    console.log(`  Role: ${opportunity.roleId}`);
    console.log('');
  }
}

// Show which pattern was actually selected
const selected = detectSubagentOpportunity(message);
console.log('SELECTED:');
console.log(`  Priority: ${selected?.priority}`);
console.log(`  Mandatory: ${selected?.mandatory}`);
console.log(`  Role: ${selected?.roleId}`);
```

**Expected Behavior:**
- High priority patterns override medium and low
- Among same priority, first match in array wins

**Fix:**

```typescript
// Adjust priorities if wrong pattern is selected
{
  pattern: /\binvestigate\b/i,
  opportunity: {
    priority: 'high',    // Higher priority
    mandatory: true,
  },
},
{
  pattern: /\band\s+also\b/i,
  opportunity: {
    priority: 'low',     // Lower priority
    mandatory: false,
  },
},
```

---

### Issue 4: Warning Banner Not Displaying

**Symptoms:**
- Agent delegates correctly
- But user doesn't see warning banner
- Gray suggestion instead of yellow warning

**Check Colors:**

```javascript
import chalk from 'chalk';

console.log(chalk.yellow.bold('\n⚠️ [WARNING] MANDATORY DELEGATION'));
console.log(chalk.gray('\n💡 Suggestion'));
```

If colors don't display, chalk may be disabled. Force enable:

```javascript
import chalk from 'chalk';
chalk.level = 1; // Force basic color support
```

---

### Issue 5: Task Count Not Detected

**Symptoms:**
- Multiple tasks in message but task count not shown
- Parallel subagents not spawned for each task

**Debug:**

```javascript
import { separateTasks, countTasks } from './src/agent/subagent-detector.js';

const message = 'Update file1.ts and also update file2.ts and also update file3.ts';

const tasks = separateTasks(message);
const taskCount = countTasks(message);

console.log('Original message:', message);
console.log('Separated tasks:', tasks);
console.log('Task count:', taskCount);
```

**Expected Output:**
```
Separated tasks: [
  'Update file1.ts',
  'update file2.ts',
  'update file3.ts'
]
Task count: 3
```

---

## Debugging Steps

### Step-by-Step Diagnostic Process

#### Step 1: Pattern Detection

```javascript
// test-step1-detection.js
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const testCases = [
  'For each file, add tests',
  'Investigate the bug',
  'Write tests for utils.ts',
  'Fix the error in all services',
];

testCases.forEach(msg => {
  const result = detectSubagentOpportunity(msg);
  console.log(`\nMessage: "${msg}"`);
  console.log(`  Detected: ${!!result}`);
  console.log(`  Mandatory: ${result?.mandatory}`);
  console.log(`  Priority: ${result?.priority}`);
  console.log(`  Role: ${result?.roleId || 'general'}`);
});
```

#### Step 2: Hint Generation

```javascript
// test-step2-hint.js
import { detectSubagentOpportunity, buildSubagentHint } from './src/agent/subagent-detector.js';

const message = 'For each module, add unit tests';
const opportunity = detectSubagentOpportunity(message);

if (opportunity) {
  console.log('Opportunity:', opportunity);
  console.log('\nGenerated Hint:');
  console.log(buildSubagentHint(opportunity));
}
```

#### Step 3: Check Conversation Messages

Add temporary logging in `src/agent/loop.ts`:

```typescript
// Around line 140
if (this.currentSubagentOpportunity && iteration === 1) {
  const hint = buildSubagentHint(this.currentSubagentOpportunity);
  
  console.log('\n[DEBUG] === Message Injection ===');
  console.log('[DEBUG] Messages before injection:', messages.length);
  
  messages = [
    ...messages.slice(0, -1),
    { role: 'system' as const, content: hint },
    messages[messages.length - 1],
  ];
  
  console.log('[DEBUG] Messages after injection:', messages.length);
  console.log('[DEBUG] Injected hint length:', hint.length);
  console.log('[DEBUG] Hint preview:', hint.substring(0, 100) + '...');
  console.log('[DEBUG] =========================\n');
}
```

#### Step 4: Verify Tool Calls

```javascript
// In your agent loop, after executing tools
const toolCalls = this.toolRegistry.getCalls();
const spawnAgentCalls = toolCalls.filter(call => call.toolName === 'spawn_agent');

console.log('[DEBUG] Total tool calls:', toolCalls.length);
console.log('[DEBUG] Spawn agent calls:', spawnAgentCalls.length);

if (spawnAgentCalls.length > 0) {
  console.log('[DEBUG] Spawn agent details:');
  spawnAgentCalls.forEach((call, i) => {
    console.log(`  ${i + 1}. Role: ${call.args.role}, Task: ${call.args.task}`);
  });
}
```

---

## Diagnostic Commands

### Test All Mandatory Patterns

```javascript
// test-all-mandatory.js
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const mandatoryTestCases = [
  { msg: 'For each file, add tests', mandatory: true },
  { msg: 'Across all modules, update imports', mandatory: true },
  { msg: 'Investigate why the API fails', mandatory: true },
  { msg: 'Debug the memory leak', mandatory: true },
  { msg: 'Fix the bug in the login', mandatory: true },
  { msg: 'Update all services', mandatory: true },
];

console.log('Mandatory Pattern Tests:\n');
let passed = 0;
let failed = 0;

mandatoryTestCases.forEach(({ msg, mandatory }) => {
  const result = detectSubagentOpportunity(msg);
  const isMandatory = result?.mandatory === true;
  const pass = isMandatory === mandatory;
  
  if (pass) {
    console.log(`✅ PASS: "${msg}"`);
    passed++;
  } else {
    console.log(`❌ FAIL: "${msg}"`);
    console.log(`   Expected mandatory: ${mandatory}, Got: ${isMandatory}`);
    failed++;
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
```

### Compare Mandatory vs Suggested

```javascript
// test-mandatory-vs-suggested.js
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const testCases = [
  { msg: 'For each file, add tests', expected: 'mandatory' },
  { msg: 'Investigate the bug', expected: 'mandatory' },
  { msg: 'Write tests for utils.ts', expected: 'suggested' },
  { msg: 'Refactor the code', expected: 'suggested' },
  { msg: 'Update documentation', expected: 'suggested' },
  { msg: 'Fix the bug', expected: 'mandatory' },
];

console.log('Mandatory vs Suggested Tests:\n');

testCases.forEach(({ msg, expected }) => {
  const result = detectSubagentOpportunity(msg);
  const actual = result?.mandatory ? 'mandatory' : (result ? 'suggested' : 'none');
  const pass = actual === expected;
  
  const status = pass ? '✅' : '❌';
  console.log(`${status} "${msg}"`);
  console.log(`   Expected: ${expected}, Got: ${actual}`);
});
```

### Pattern Matching Analysis

```javascript
// analyze-patterns.js
import { PATTERNS, detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const message = 'Investigate and fix the bug in all modules';
const messageLower = message.toLowerCase();

console.log('Analyzing message:', message);
console.log('');

// Find all matching patterns
const matches = [];
for (const { pattern, opportunity } of PATTERNS) {
  if (pattern.test(messageLower)) {
    matches.push({
      pattern: pattern.toString(),
      priority: opportunity.priority,
      mandatory: opportunity.mandatory,
      role: opportunity.roleId,
    });
  }
}

console.log(`Found ${matches.length} matching patterns:\n`);
matches.forEach((m, i) => {
  console.log(`${i + 1}. ${m.pattern}`);
  console.log(`   Priority: ${m.priority}, Mandatory: ${m.mandatory}, Role: ${m.role}`);
});

// Show which was selected
const selected = detectSubagentOpportunity(message);
console.log('\n=== Selected Pattern ===');
console.log(`Priority: ${selected?.priority}`);
console.log(`Mandatory: ${selected?.mandatory}`);
console.log(`Role: ${selected?.roleId}`);
console.log(`Reason: ${selected?.reason}`);
```

---

## Testing Patterns

### Quick Pattern Test

```javascript
// quick-test.js
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

// Usage: node quick-test.js "your message here"
const message = process.argv[2];

if (!message) {
  console.log('Usage: node quick-test.js "your message"');
  process.exit(1);
}

const result = detectSubagentOpportunity(message);

console.log('Message:', message);
console.log('');
console.log('Result:', result ? 'DETECTED' : 'NO MATCH');

if (result) {
  console.log('');
  console.log('Details:');
  console.log(`  Mandatory: ${result.mandatory}`);
  console.log(`  Priority: ${result.priority}`);
  console.log(`  Role: ${result.roleId || 'general'}`);
  console.log(`  Reason: ${result.reason}`);
  console.log(`  Task Count: ${result.taskCount || 'not detected'}`);
}
```

Run with: `node quick-test.js "For each file, add tests"`

---

### Comprehensive Pattern Test Suite

```javascript
// comprehensive-test.js
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const testSuite = {
  mandatory: {
    'For each file, add tests': { mandatory: true, priority: 'high' },
    'Across all modules, update imports': { mandatory: true, priority: 'high' },
    'Investigate why the API fails': { mandatory: true, priority: 'high', role: 'investigator' },
    'Debug the memory leak': { mandatory: true, priority: 'high', role: 'investigator' },
    'Fix the bug in login': { mandatory: true, priority: 'high', role: 'fixer' },
    'Update all services': { mandatory: true, priority: 'high' },
  },
  
  suggested: {
    'Write tests for utils.ts': { mandatory: false, priority: 'medium', role: 'test-writer' },
    'Refactor the code structure': { mandatory: false, priority: 'medium', role: 'refactorer' },
    'Update the documentation': { mandatory: false, priority: 'low', role: 'documenter' },
    'Add comments to the code': { mandatory: false, priority: 'low', role: 'documenter' },
  },
  
  noMatch: {
    'Create a new file': null,
    'What color is this variable?': null,
    'The function is simple': null,
  },
};

console.log('Comprehensive Pattern Test Suite\n');
console.log('='.repeat(60));

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Test mandatory patterns
console.log('\n📋 Mandatory Patterns:\n');
for (const [msg, expected] of Object.entries(testSuite.mandatory)) {
  totalTests++;
  const result = detectSubagentOpportunity(msg);
  
  if (!result) {
    console.log(`❌ FAIL: "${msg}" - No pattern detected`);
    failedTests++;
    continue;
  }
  
  const pass = result.mandatory === expected.mandatory &&
               result.priority === expected.priority &&
               (!expected.role || result.roleId === expected.role);
  
  if (pass) {
    console.log(`✅ PASS: "${msg}"`);
    passedTests++;
  } else {
    console.log(`❌ FAIL: "${msg}"`);
    console.log(`   Expected: mandatory=${expected.mandatory}, priority=${expected.priority}`);
    console.log(`   Got: mandatory=${result.mandatory}, priority=${result.priority}`);
    failedTests++;
  }
}

// Test non-matching messages
console.log('\n🚫 Non-Matching Messages:\n');
for (const [msg, expected] of Object.entries(testSuite.noMatch)) {
  totalTests++;
  const result = detectSubagentOpportunity(msg);
  const pass = result === null;
  
  if (pass) {
    console.log(`✅ PASS: "${msg}" - No match as expected`);
    passedTests++;
  } else {
    console.log(`❌ FAIL: "${msg}" - Unexpected match`);
    console.log(`   Got: mandatory=${result.mandatory}, priority=${result.priority}`);
    failedTests++;
  }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results:`);
console.log(`   Total: ${totalTests}`);
console.log(`   Passed: ${passedTests} ✅`);
console.log(`   Failed: ${failedTests} ❌`);
console.log(`   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

process.exit(failedTests > 0 ? 1 : 0);
pass) {
    console.log(`✅ PASS: "${msg}"`);
    passedTests++;
  } else {
    console.log(`❌ FAIL: "${msg}"`);
    console.log(`   Expected: mandatory=${expected.mandatory}, priority=${expected.priority}`);
    console.log(`   Got: mandatory=${result.mandatory}, priority=${result.priority}`);
    failedTests++;
  }
}

// Test suggested patterns
console.log('\n💡 Suggested Patterns:\n');
for (const [msg, expected] of Object.entries(testSuite.suggested)) {
  totalTests++;
  const result = detectSubagentOpportunity(msg);
  
  if (!result) {
    console.log(`❌ FAIL: "${msg}" - No pattern detected`);
    failedTests++;
    continue;
  }
  
  const pass = result.mandatory === expected.mandatory &&
               result.priority === expected.priority &&
               (!expected.role || result.roleId === expected.role);
  
  if (pass) {
    console.log(`✅ PASS: "${msg}"`);
    passedTests++;
  } else {
    console.log(`❌ FAIL: "${msg}"`);
    console.log(`   Expected: mandatory=${expected.mandatory}, priority=${expected.priority}`);
    console.log(`   Got: mandatory=${result.mandatory}, priority=${result.priority}`);
    failedTests++;
  }
}

// Test non-matching messages
console.log('\n🚫 Non-Matching Messages:\n');
for (const [msg, expected] of Object.entries(testSuite.noMatch)) {
  totalTests++;
  const result = detectSubagentOpportunity(msg);
  const pass = result === null;
  
  if (pass) {
    console.log(`✅ PASS: "${msg}" - No match as expected`);
    passedTests++;
  } else {
    console.log(`❌ FAIL: "${msg}" - Unexpected match`);
    console.log(`   Got: mandatory=${result.mandatory}, priority=${result.priority}`);
    failedTests++;
  }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results:`);
console.log(`   Total: ${totalTests}`);
console.log(`   Passed: ${passedTests} ✅`);
console.log(`   Failed: ${failedTests} ❌`);
console.log(`   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

process.exit(failedTests > 0 ? 1 : 0);
