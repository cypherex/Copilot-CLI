# Mandatory Delegation System

Comprehensive guide to the mandatory delegation system in Copilot CLI Agent.

## Table of Contents

- [Overview](#overview)
- [What is Mandatory Delegation?](#what-is-mandatory-delegation)
- [When Does It Trigger?](#when-does-it-trigger)
- [Expected Behavior](#expected-behavior)
- [Customization](#customization)
- [Pattern Reference](#pattern-reference)
- [Troubleshooting](#troubleshooting)
- [Migration Guide](#migration-guide)

---

## Overview

The mandatory delegation system is an automated pattern detection mechanism that identifies when tasks **must** be delegated to subagents rather than handled directly by the main agent. This ensures:

- **Parallelizable work** is properly distributed across multiple agents
- **Specialized tasks** are handled by agents with appropriate roles
- **Complex investigations** receive focused attention
- **Large-scale operations** are performed efficiently

### Key Concepts

1. **Mandatory Delegation**: High-priority patterns where the agent **MUST** spawn subagents
2. **Suggested Delegation**: Lower-priority patterns where delegation is recommended but optional
3. **Priority Levels**: `high`, `medium`, `low` - determines if delegation is mandatory
4. **Role-Based Routing**: Patterns can specify specialized subagent roles

---

## What is Mandatory Delegation?

Mandatory delegation is a system rule that forces the agent to spawn subagents for specific types of tasks. When a mandatory pattern is detected in the user's message:

- ⚠️ A warning banner is displayed
- The agent receives an imperative system instruction
- The agent **MUST** use `spawn_agent` tool
- The agent **CANNOT** attempt the task directly

### Why Mandatory?

Some tasks inherently require delegation for optimal results:

| Task Type | Why Mandatory |
|-----------|---------------|
| **Parallel Processing** | "For each file" requires spawning multiple parallel agents |
| **Investigation** | Debugging needs focused, iterative analysis |
| **Bug Fixing** | Complex bugs require diagnosis before fixing |
| **Cross-Module Operations** | Spanning multiple modules benefits from parallel agents |

### Mandatory vs Suggested

| Feature | Mandatory | Suggested |
|---------|-----------|-----------|
| Trigger | High-priority patterns | Medium/low priority patterns |
| Language | Imperative ("YOU MUST") | Polite ("Consider") |
| Display | ⚠️ Yellow warning banner | 💡 Gray suggestion |
| Agent Behavior | Must delegate | May choose to delegate |
| Example | "for each file" | "write tests" |

---

## When Does It Trigger?

Mandatory delegation triggers when:

1. A user message contains a **mandatory pattern**
2. The pattern is marked with `mandatory: true`
3. The pattern has `priority: 'high'`

### Detection Process

```
User Message → Pattern Matching → Priority Check → Mandatory Flag → Display Warning → Inject System Instruction
```

### High-Level Flow

1. **User submits message**: e.g., "For each module, add unit tests"
2. **Pattern detector analyzes**: Matches `/for each (file|module|service|component)/i`
3. **Priority evaluated**: Pattern has `priority: 'high'` and `mandatory: true`
4. **Warning displayed**: ⚠️ Yellow banner shows to user
5. **System instruction injected**: Imperative message added to conversation
6. **Agent responds**: Must spawn subagent(s)

---

## Expected Behavior

### When Mandatory Delegation Triggers

#### User Sees:
```
⚠️ [WARNING] MANDATORY DELEGATION
   General Subagent
   Multiple files/modules need processing - MUST spawn parallel subagents
   Priority: high
   Detected Tasks: 1
   ⚠️ YOU MUST delegate this task to a subagent
```

#### Agent Receives (System Message):
```
⚠️ [WARNING] MANDATORY DELEGATION

[REQUIREMENT]
YOU MUST delegate this task to a subagent. DO NOT attempt it directly.

Multiple files/modules need processing - MUST spawn parallel subagents

Priority: high

ACTION STEPS:
1. Use spawn_agent tool with the appropriate role
2. If task involves multiple items, spawn parallel subagents (background: true)
3. Wait for subagent completion before proceeding
4. Review subagent results and integrate as needed

⚠️ DO NOT PROCEED WITHOUT DELEGATING THIS TASK
```

#### Agent Action:
```typescript
// MUST spawn subagent - CANNOT do work directly
await spawn_agent({
  task: "Add unit tests to all modules",
  role: "test-writer",
  background: false,
});
```

### When Suggested Delegation Triggers

#### User Sees:
```
💡 Suggestion: Test Writer
   Test writing task detected
   Priority: medium
```

#### Agent Receives (System Message):
```
[SUBAGENT SUGGESTION]

Test writing task detected

Priority: medium
Suggested Role: test-writer

Consider spawning a subagent if this task is large or complex.
You may also spawn multiple parallel subagents for independent work items.
```

#### Agent Action:
```typescript
// MAY delegate or do directly
// Agent chooses based on task complexity
if (taskIsComplex) {
  await spawn_agent({ task, role: "test-writer" });
} else {
  // Do work directly
  create_file({ path, content });
}
```

---

## Customization

### Changing Mandatory Flags

To modify which patterns are mandatory, edit `src/agent/subagent-detector.ts`:

```typescript
const PATTERNS: PatternMatch[] = [
  {
    pattern: /\bfor each (file|module|service|component)\b/i,
    opportunity: {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'Multiple files/modules need processing - MUST spawn parallel subagents',
      priority: 'high',
      mandatory: true,  // ← Set to false to make it suggested
    },
  },
  // ... more patterns
];
```

### Making a Pattern Mandatory

Set both `priority: 'high'` and `mandatory: true`:

```typescript
{
  pattern: /\bmy pattern\b/i,
  opportunity: {
    priority: 'high',      // Required for mandatory
    mandatory: true,       // Makes it mandatory
    reason: 'Must delegate',
    shouldSpawn: true,
  },
}
```

### Making a Pattern Optional

Set `mandatory: false` or omit it (defaults to false):

```typescript
{
  pattern: /\bmy pattern\b/i,
  opportunity: {
    priority: 'medium',    // Any priority
    mandatory: false,      // Optional delegation
    reason: 'Consider delegating',
    shouldSpawn: true,
  },
}
```

### Adjusting Priority Levels

Priority determines both delegation style and pattern selection:

```typescript
// High priority - Mandatory (with mandatory: true)
priority: 'high'

// Medium priority - Suggested
priority: 'medium'

// Low priority - Suggested
priority: 'low'
```

When multiple patterns match, the highest priority pattern is selected.

---

## Pattern Reference

Complete list of all mandatory patterns in the codebase.

### Mandatory Patterns (`priority: 'high'`, `mandatory: true`)

#### 1. For Each Pattern
**Regex**: `/\bfor each (file|module|service|component)\b/i`

**Why Mandatory**: Indicates parallelizable work that requires multiple subagents to process each item independently.

**Examples**:
- "For each file, add unit tests"
- "Update logging for each service"
- "Add error handling for each component"

**Role**: General (auto-detected)

---

#### 2. Across All Pattern
**Regex**: `/\bacross all (files|modules|services)\b/i`

**Why Mandatory**: Cross-module operations requiring parallel processing across all items.

**Examples**:
- "Apply this change across all modules"
- "Update imports across all services"
- "Add copyright headers across all files"

**Role**: General (auto-detected)

---

#### 3. Investigate Pattern
**Regex**: `/\binvestigate\b/i`

**Why Mandatory**: Investigation requires focused, iterative analysis using the investigator role.

**Examples**:
- "Investigate why the API returns 500 errors"
- "Investigate the memory leak issue"
- "Investigate the authentication flow"

**Role**: `investigator`

---

#### 4. Debug Pattern
**Regex**: `/\b(debug|debugging|diagnos)\b/i`

**Why Mandatory**: Debugging tasks require systematic diagnosis using the investigator role.

**Examples**:
- "Debug the connection timeout"
- "Debug why tests are failing"
- "Diagnose the performance issue"

**Role**: `investigator`

---

#### 5. Fix Bug Pattern
**Regex**: `/\b(fix|resolve|solves?)(\s+(a|the|this)?\s+)(bug|error|issue|problem)\b/i`

**Why Mandatory**: Bug fixes require proper diagnosis before fixing, using the fixer role.

**Examples**:
- "Fix the bug in the login module"
- "Resolve the error in the API"
- "Solve this database problem"

**Role**: `fixer`

---

#### 6. All Files/Modules Pattern
**Regex**: `/\ball\s+(files?|services?|modules?|components?)\b/i`

**Why Mandatory**: Operating on all items requires parallel processing.

**Examples**:
- "Add comments to all files"
- "Update type definitions in all modules"
- "Fix the bug in all services"

**Role**: General (auto-detected)

---

### Suggested Patterns (`mandatory: false`)

These patterns suggest delegation but don't require it.

#### Test Writing (`priority: 'medium'`)
- `/\b(add |write |create )tests?\b/i` → `test-writer`
- `/\b(testing|test cases?|unit tests?|coverage)\b/i` → `test-writer`
- `/\bspec(s?|ification)\b/i` → `test-writer`

#### Refactoring (`priority: 'medium'`)
- `/\brefactor\b/i` → `refactorer`
- `/\b(cleanup|clean up|reorganize|restructure)\b/i` → `refactorer`
- `/\b(improve|optimize|simplify|consolidate)\s+(the )?\s+(code|structure)\b/i` → `refactorer`
- `/\bextract\b.*\b(into|from)\b/i` → `refactorer`

#### Documentation (`priority: 'low'`)
- `/\b(document|doc)\b/i` → `documenter`
- `/\b(readme|docs?|api docs?|comments?)\b/i` → `documenter`
- `/\b(add|update|improve)\s+(comments?|documentation?)\b/i` → `documenter`

#### Multiple Items (`priority: 'low'` to `'medium'`)
- `/(\w+\.?\w+\.\w+).*?,.*(\w+\.?\w+\.\w+)/i` - Multiple files
- `/\b(several|multiple|various)\s+(files?|services?|modules?|components?)\b/i`
- `/\b(each|every)\s+(file|service|module|component)\b/i`
- `/\b(each of the|every one of the|each of|every one of)\s+(files?|services?|modules?|components?)\b/i`
- `/\b(two|three|four|five|six|seven|eight|nine|ten)\s+(files?|services?|modules?|components?)\b/i`

#### Multiple Tasks (`priority: 'low'` to `'medium'`)
- `/\band\s+also\b/i`
- `/\band\s+additionally\b/i`
- `/\bas\s+well\s+as\b/i`
- `/\balong\s+with\b/i`
- `/\bin\s+addition\b/i`
- `/\bfurthermore\b/i`
- `/\bplus\b/i`
- `/\balso\s+(refactor|update|add|write|create|fix|investigate|test|document|improve|optimize|cleanup)\b/i`

---

## Troubleshooting

### Agent Not Delegating When Mandatory

#### Symptom
User message contains a mandatory pattern, but agent attempts the task directly instead of spawning subagents.

#### Debug Steps

1. **Check Pattern Matching**
   ```typescript
   // In subagent-detector.ts, add temporary logging
   console.log('Pattern matched:', pattern.test(userMessage));
   console.log('Result:', detectSubagentOpportunity(userMessage));
   ```

2. **Verify Mandatory Flag**
   ```typescript
   const opportunity = detectSubagentOpportunity(message);
   console.log('Mandatory:', opportunity?.mandatory);
   console.log('Priority:', opportunity?.priority);
   ```

3. **Check System Injection**
   ```typescript
   // In loop.ts, verify hint is injected
   console.log('Hint:', buildSubagentHint(opportunity));
   ```

4. **Review Conversation Context**
   - System message must be injected before the user message
   - Check for conflicting instructions

#### Common Causes

| Issue | Solution |
|-------|----------|
| Pattern doesn't match | Test regex with your exact message |
| `mandatory` flag is `false` | Set `mandatory: true` in pattern config |
| System instruction not injected | Check `loop.ts` injection logic (lines ~140-150) |
| Agent ignores instruction | System prompt may need stronger language |

#### Verification

```bash
# Test pattern matching
node -e "
const { detectSubagentOpportunity } = require('./src/agent/subagent-detector.ts');
const result = detectSubagentOpportunity('For each module, add tests');
console.log(JSON.stringify(result, null, 2));
"
```

---

### Agent Delegating When Not Expected

#### Symptom
Agent spawns subagents for simple tasks that should be handled directly.

#### Debug Steps

1. **Identify Which Pattern Matched**
   ```typescript
   const messages = conversation.getMessages();
   const lastUserMsg = messages[messages.length - 2]?.content;
   const opportunity = detectSubagentOpportunity(lastUserMsg);
   console.log('Matched pattern:', opportunity);
   ```

2. **Check Priority of Matched Pattern**
   - If `priority: 'medium'` or `'low'`, delegation is suggested, not mandatory
   - Agent can choose to handle directly

3. **Review Pattern Specificity**
   - Broad patterns may match unintended messages
   - Consider making patterns more specific

#### Solutions

| Issue | Solution |
|-------|----------|
| Pattern too broad | Narrow regex to reduce false positives |
| Priority too high | Lower to `'medium'` or `'low'` |
| No exception logic | Add task size/complexity check in agent |

#### Adjusting Pattern Specificity

```typescript
// Too broad - matches many messages
/\bupdate\b/i

// More specific - targets only file updates
/\bupdate\s+the?\s+file\b/i

// Very specific - requires explicit file context
/\bupdate\s+(this|the)\s+file:\s*\w+\.\w+\b/i
```

---

### Debugging Mandatory Triggers

#### Step 1: Check Pattern Match

```typescript
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const testMessages = [
  "For each module, add unit tests",
  "Investigate the memory leak",
  "Write tests for utils.ts",
];

for (const msg of testMessages) {
  const result = detectSubagentOpportunity(msg);
  console.log(`Message: "${msg}"`);
  console.log(`Mandatory: ${result?.mandatory}`);
  console.log(`Priority: ${result?.priority}`);
  console.log(`Reason: ${result?.reason}`);
  console.log('---');
}
```

#### Step 2: Verify Priority Selection

When multiple patterns match, the highest priority wins:

```typescript
// If both patterns match:
// Pattern A: priority: 'high'
// Pattern B: priority: 'medium'
// Result: Pattern A is selected (high > medium > low)
```

#### Step 3: Check Hint Injection

```typescript
import { buildSubagentHint } from './src/agent/subagent-detector.js';

const opportunity = {
  mandatory: true,
  priority: 'high',
  reason: 'Test message',
  shouldSpawn: true,
};

const hint = buildSubagentHint(opportunity);
console.log(hint);

// Should show:
// ⚠️ [WARNING] MANDATORY DELEGATION
// [REQUIREMENT]
// YOU MUST delegate this task...
```

---

### Common Issues and Solutions

#### Issue 1: "For Each" Not Triggering

**Symptom**: Message contains "for each file" but no warning appears.

**Root Cause**: Regex is case-sensitive or pattern is too strict.

**Solution**:
```typescript
// Check regex is case-insensitive (has /i flag)
pattern: /\bfor each (file|module|service|component)\b/i  // ✅ Correct

pattern: /\bFor Each (File|Module|Service|Component)\b/   // ❌ Wrong - case-sensitive
```

---

#### Issue 2: Investigate Pattern Not Mandatory

**Symptom**: "Investigate" triggers suggestion instead of mandatory.

**Root Cause**: `mandatory: false` or `priority` not `'high'`.

**Solution**:
```typescript
{
  pattern: /\binvestigate\b/i,
  opportunity: {
    roleId: 'investigator',
    shouldSpawn: true,
    reason: 'Investigation task detected',
    priority: 'high',     // ✅ Must be 'high'
    mandatory: true,      // ✅ Must be true
  },
}
```

---

#### Issue 3: Agent Ignores Mandatory Warning

**Symptom**: Warning displayed, but agent still does work directly.

**Root Cause**: System instruction not injected or agent override.

**Solution**:
1. Verify hint injection in `loop.ts`:
   ```typescript
   // Line ~140-150
   if (this.currentSubagentOpportunity && iteration === 1) {
     const hint = buildSubagentHint(this.currentSubagentOpportunity);
     messages = [
       ...messages.slice(0, -1),
       { role: 'system' as const, content: hint },
       messages[messages.length - 1],
     ];
   }
   ```

2. Check system prompt includes delegation guidance:
   ```typescript
   // In system-prompt.ts, verify mandatory section exists:
   // ⚠️ **IMPORTANT**: Subagent delegation operates in two modes:
   // ### Mandatory Delegation (REQUIREMENT)
   // When the system detects a MANDATORY delegation opportunity...
   ```

---

#### Issue 4: False Positives on "All" Pattern

**Symptom**: "All good to go" triggers mandatory delegation.

**Root Cause**: `\ball\s+(files?|services?|modules?|components?)\b/i` is too broad.

**Solution**:
- Current pattern accepts any word after "all"
- Need to ensure it's followed by file-related terms
- Already implemented with current regex, but verify test cases:

```typescript
// Should NOT match
detectSubagentOpportunity("Is all good to go?"); // → undefined

// Should match
detectSubagentOpportunity("Update all modules"); // → mandatory
```

---

## Migration Guide

### How Behavior Changes from Suggestion to Mandatory

#### Before (Suggestion Only)
```
User: "For each module, add unit tests"

Agent response:
"I'll add unit tests to each module..."
[Agent does work directly - potentially slow]
```

#### After (Mandatory Delegation)
```
User: "For each module, add unit tests"

⚠️ [WARNING] MANDATORY DELEGATION
   Multiple files/modules need processing - MUST spawn parallel subagents

Agent response:
"I'll spawn parallel subagents to add unit tests to each module..."
[Agent spawns multiple test-writer subagents in parallel]
```

### Key Differences

| Aspect | Before | After |
|--------|--------|-------|
| Detection | Basic patterns | Pattern + priority + mandatory flag |
| Display | 💡 Suggestion (gray) | ⚠️ Warning (yellow) |
| Language | Polite ("Consider") | Imperative ("YOU MUST") |
| Agent Behavior | May delegate | Must delegate |
| System Message | Optional hint | Requirement + action steps |

---

### What to Expect from Agents

#### Response Pattern Changes

**Old Behavior (Optional Delegation)**:
```
User: "Investigate why tests fail"

Agent: "Let me check the test files..."
[Agent reads files, analyzes, investigates directly]
```

**New Behavior (Mandatory Delegation)**:
```
User: "Investigate why tests fail"

⚠️ [WARNING] MANDATORY DELEGATION
   Investigator
   Investigation task detected

Agent: "I'll spawn an investigator agent to diagnose why the tests are failing..."
[Agent spawns investigator subagent]
```

#### Parallel Processing Improvements

**Old Behavior**:
```
User: "For each service, add logging"
Agent: [Processes services sequentially, one by one]
```

**New Behavior**:
```
User: "For each service, add logging"
⚠️ [WARNING] MANDATORY DELEGATION
   Multiple services need processing

Agent: "I'll spawn parallel subagents to add logging to each service..."
[Spawns 3-5 agents simultaneously, processes all in parallel]
```

---

### Adjusting User Prompts

#### Best Practices

**Do's** ✅
- Use clear, explicit language: "For each module, add tests"
- Specify parallelization: "Add logging to all services in parallel"
- Use standard patterns: "Investigate why", "Debug the issue", "Fix the bug"

**Don'ts** ❌
- Ambiguous phrasing: "Maybe add tests if you think it's needed"
- Mixed directives: "Check this file and also maybe add tests to others"
- Contradictory instructions: "Don't delegate but also process all files"

#### Prompt Examples

**Good Prompt (Triggers Mandatory)**
```
For each module in the src directory, add comprehensive unit tests.
```

**Alternative Good Prompt**
```
Add unit tests to all modules using parallel subagents.
```

**Less Effective Prompt**
```
Add tests to the modules you think need them.
```

---

### Backward Compatibility Notes

#### Breaking Changes

1. **Previously Optional Now Mandatory**
   - "for each file/module/service/component"
   - "across all files/modules/services"
   - "investigate"
   - "debug/debugging/diagnose"
   - "fix/resolve/solve bug/error/issue/problem"
   - "all files/modules/services/components"

2. **Agent Behavior Change**
   - Agent will now delegate instead of doing work directly
   - Results may differ (subagents have different approaches)
   - Execution time may improve (parallel processing)

#### Non-Breaking Changes

1. **Suggestions Still Work**
   - Test writing, refactoring, documentation remain suggestions
   - Agent can still choose to delegate or handle directly

2. **Existing Workflows**
   - Simple, direct tasks unchanged
   - One-shot operations unchanged
   - Single-file operations unchanged

#### Migration Strategies

**For Users**

1. **Accept New Behavior**
   - Most users will benefit from improved parallelization
   - No action needed

2. **Opt Out If Needed**
   - Rephrase prompts to avoid mandatory patterns
   - Example: Instead of "For each file", use "Update the files"

**For Developers**

1. **Test Pattern Matching**
   ```typescript
   const result = detectSubagentOpportunity(yourMessage);
   if (result?.mandatory) {
     console.log('This will trigger mandatory delegation');
   }
   ```

2. **Adjust Patterns If Needed**
   - Modify `src/agent/subagent-detector.ts`
   - Change `mandatory: true` to `false` for patterns you want optional

3. **Add Custom Patterns**
   ```typescript
   {
     pattern: /\byour custom pattern\b/i,
     opportunity: {
       priority: 'high',
       mandatory: true,
       reason: 'Your custom reason',
       shouldSpawn: true,
       roleId: 'your-role-id',
     },
   }
   ```

---

## Testing

### Unit Testing Pattern Detection

```typescript
import { detectSubagentOpportunity } from './subagent-detector.js';

describe('Mandatory Delegation', () => {
  test('for each should be mandatory', () => {
    const result = detectSubagentOpportunity('For each file, add tests');
    expect(result?.mandatory).toBe(true);
    expect(result?.priority).toBe('high');
  });

  test('investigate should be mandatory', () => {
    const result = detectSubagentOpportunity('Investigate the bug');
    expect(result?.mandatory).toBe(true);
    expect(result?.roleId).toBe('investigator');
  });

  test('write tests should be suggestion', () => {
    const result = detectSubagentOpportunity('Write tests for utils.ts');
    expect(result?.mandatory).toBe(false);
    expect(result?.priority).toBe('medium');
  });
});
```

### Integration Testing

```typescript
import { AgenticLoop } from './loop.js';

test('mandatory delegation spawns subagent', async () => {
  const loop = new AgenticLoop(llmClient, tools, conversation);
  
  await loop.processUserMessage('For each module, add tests');
  
  // Verify agent called spawn_agent
  const calls = toolRegistry.getCalls();
  expect(calls.some(c => c.toolName === 'spawn_agent')).toBe(true);
});
```

### Manual Testing Checklist

- [ ] Mandatory pattern shows ⚠️ warning
- [ ] Suggested pattern shows 💡 suggestion
- [ ] Agent spawns subagent for mandatory patterns
- [ ] Agent can choose for suggested patterns
- [ ] Parallel tasks spawn multiple agents
- [ ] Warning displays correctly with role name
- [ ] System hint contains imperative language for mandatory
- [ ] System hint contains polite language for suggested

---

## Appendix

### Complete Pattern List

See [Pattern Reference](#pattern-reference) above for complete list.

### Subagent Roles

| Role ID | Name | Max Iterations | Purpose |
|---------|------|----------------|---------|
| `test-writer` | Test Writer | 3 | Write comprehensive tests |
| `investigator` | Investigator | 3 | Diagnose bugs and trace execution |
| `refactorer` | Refactorer | 2 | Improve code quality |
| `documenter` | Documenter | 2 | Create documentation |
| `fixer` | Fixer | 2 | Resolve specific bugs |
| `general` | General Subagent | 10 | General-purpose tasks |

### Priority Levels

| Priority | Mandatory? | Examples |
|----------|------------|----------|
| `high` | Can be mandatory | for each, investigate, debug |
| `medium` | Always suggestion | write tests, refactor |
| `low` | Always suggestion | documentation, plus |

### System Message Format

#### Mandatory Format
```
⚠️ [WARNING] MANDATORY DELEGATION

[REQUIREMENT]
YOU MUST delegate this task to a subagent. DO NOT attempt it directly.

{reason}

Priority: {priority}
{Required Role: {roleId}}
{Detected Tasks: {taskCount}}

ACTION STEPS:
1. Use spawn_agent tool with the appropriate role
2. If task involves multiple items, spawn parallel subagents (background: true)
3. Wait for subagent completion before proceeding
4. Review subagent results and integrate as needed

⚠️ DO NOT PROCEED WITHOUT DELEGATING THIS TASK
```

#### Suggested Format
```
[SUBAGENT SUGGESTION]

{reason}

Priority: {priority}
{Suggested Role: {roleId}}
{Detected Tasks: {taskCount}}

Consider spawning a subagent if this task is large or complex.
You may also spawn multiple parallel subagents for independent work items.
```

---

## Related Documentation

- [Subagent Roles Documentation](./subagent-roles.md)
- [Agent Loop Documentation](./agent-loop.md)
- [Tool Registry Documentation](./tool-registry.md)
- [System Prompt Reference](./system-prompt.md)

---

## Changelog

### Version 2.0.0 - Mandatory Delegation System
- Added mandatory delegation feature
- Distinguished between mandatory and suggested delegation
- Added priority-based pattern selection
- Enhanced user feedback with warning banners
- Updated system prompt with delegation guidance

### Version 1.0.0 - Initial Subagent System
- Basic subagent spawning
- Simple pattern detection
- Suggested delegation only
