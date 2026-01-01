# Adding New Mandatory Patterns

A quick reference guide for adding new mandatory delegation patterns.

## Quick Start

To add a new mandatory delegation pattern, edit `src/agent/subagent-detector.ts` and add a new entry to the `PATTERNS` array:

```typescript
const PATTERNS: PatternMatch[] = [
  // ... existing patterns ...

  {
    pattern: /\byour pattern here\b/i,
    opportunity: {
      roleId: 'optional-role-id',      // Optional: specific subagent role
      shouldSpawn: true,
      reason: 'Human-readable explanation',
      priority: 'high',                 // 'high' | 'medium' | 'low'
      mandatory: true,                  // true = mandatory, false = suggested
    },
  },
];
```

## Mandatory Pattern Template

```typescript
{
  pattern: /\bYOUR_REGEX_PATTERN\b/i,   // Case-insensitive regex
  opportunity: {
    roleId: 'role-id',                  // Optional: test-writer, investigator, etc.
    shouldSpawn: true,                  // Always true for delegation patterns
    reason: 'Why this pattern triggers delegation',
    priority: 'high',                   // Mandatory patterns should be 'high'
    mandatory: true,                    // REQUIRED for mandatory delegation
  },
}
```

## Step-by-Step Guide

### 1. Define Your Pattern

First, identify the user language that should trigger your pattern:

**Example**: Users say "analyze the performance of all services"

**Key phrases**: "analyze performance", "all services"

### 2. Create the Regex Pattern

```typescript
// Simple pattern
pattern: /\banalyze performance\b/i,

// More specific - requires "all services"
pattern: /\banalyze.*performance.*of all (services|modules)\b/i,

// Alternative with word boundaries
pattern: /\banalyze\s+(the\s+)?performance\s+(of\s+)?all\s+(services|modules|files)\b/i,
```

**Regex Tips:**
- Use `\b` for word boundaries to avoid partial matches
- Use `\s+` for flexible whitespace matching
- Use `(?:optional)?` for optional words
- Use `|` for alternatives: `(file|module|service)`
- Always use `/i` flag for case-insensitive matching

### 3. Choose the Role (Optional)

If you want to route to a specific subagent role:

```typescript
roleId: 'test-writer',    // For testing tasks
roleId: 'investigator',   // For investigation/debugging
roleId: 'refactorer',     // For refactoring/cleanup
roleId: 'documenter',     // For documentation
roleId: 'fixer',          // For bug fixes
roleId: undefined,        // General subagent (auto-detected)
```

### 4. Write a Clear Reason

The reason is shown to users and injected into the agent's system message:

```typescript
// Good - specific and informative
reason: 'Performance analysis requires parallel processing across all services',

// Bad - too vague
reason: 'Do this task',
```

### 5. Set Priority and Mandatory Flags

```typescript
// Mandatory delegation pattern
priority: 'high',
mandatory: true,

// Suggested delegation pattern
priority: 'medium',  // or 'low'
mandatory: false,
```

**Priority Guidelines:**
- `high` + `mandatory: true` = Mandatory delegation (investigation, debugging, parallel work)
- `medium` = Strong suggestion (testing, refactoring)
- `low` = Weak suggestion (documentation, simple tasks)

### 6. Test Your Pattern

Create a test file to verify your pattern works:

```typescript
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const testCases = [
  {
    message: 'Analyze the performance of all services',
    expected: {
      mandatory: true,
      priority: 'high',
    },
  },
  {
    message: 'Just check one service',
    expected: {
      shouldMatch: false,
    },
  },
];

for (const { message, expected } of testCases) {
  const result = detectSubagentOpportunity(message);
  
  if (expected.shouldMatch === false) {
    console.assert(!result, `❌ Should not match: "${message}"`);
  } else {
    console.assert(result, `❌ Should match: "${message}"`);
    console.assert(result?.mandatory === expected.mandatory, `❌ Mandatory flag incorrect`);
    console.assert(result?.priority === expected.priority, `❌ Priority incorrect`);
    console.log(`✅ Pass: "${message}"`);
  }
}
```

## Common Pattern Examples

### Parallel Processing Patterns

```typescript
// For each item
{
  pattern: /\bfor each (file|module|service|component)\b/i,
  opportunity: {
    priority: 'high',
    mandatory: true,
    reason: 'Multiple files/modules need processing - MUST spawn parallel subagents',
    shouldSpawn: true,
  },
}

// Across all items
{
  pattern: /\bacross all (files|modules|services)\b/i,
  opportunity: {
    priority: 'high',
    mandatory: true,
    reason: 'Cross-module operation - MUST spawn parallel subagents',
    shouldSpawn: true,
  },
}
```

### Investigation Patterns

```typescript
// General investigation
{
  pattern: /\binvestigate\b/i,
  opportunity: {
    roleId: 'investigator',
    priority: 'high',
    mandatory: true,
    reason: 'Investigation task detected',
    shouldSpawn: true,
  },
}

// Debugging
{
  pattern: /\b(debug|debugging|diagnos)\b/i,
  opportunity: {
    roleId: 'investigator',
    priority: 'high',
    mandatory: true,
    reason: 'Debugging/diagnosis task',
    shouldSpawn: true,
  },
}
```

### Bug Fix Patterns

```typescript
{
  pattern: /\b(fix|resolve|solves?)(\s+(a|the|this)?\s+)(bug|error|issue|problem)\b/i,
  opportunity: {
    roleId: 'fixer',
    priority: 'high',
    mandatory: true,
    reason: 'Bug fix task detected',
    shouldSpawn: true,
  },
}
```

### Quantifier Patterns

```typescript
// "all files"
{
  pattern: /\ball\s+(files?|services?|modules?|components?)\b/i,
  opportunity: {
    roleId: 'general',
    priority: 'high',
    mandatory: true,
    reason: 'All files/modules/services/components need processing - MUST spawn parallel subagents',
    shouldSpawn: true,
  },
}

// "multiple files"
{
  pattern: /\b(several|multiple|various)\s+(files?|services?|modules?|components?)\b/i,
  opportunity: {
    roleId: 'general',
    priority: 'medium',
    mandatory: false,
    reason: 'Multiple files/modules mentioned - consider spawning parallel subagents',
    shouldSpawn: true,
  },
}

// "three files"
{
  pattern: /\b(two|three|four|five|six|seven|eight|nine|ten)\s+(files?|services?|modules?|components?)\b/i,
  opportunity: {
    roleId: 'general',
    priority: 'low',
    mandatory: false,
    reason: 'Specific number of files/modules mentioned - consider spawning parallel subagents',
    shouldSpawn: true,
  },
}
```

## Advanced Topics

### Pattern Order Matters

The `PATTERNS` array is processed in order. However, the system selects the **highest priority** match, not the first match. So order doesn't affect which pattern is selected when multiple patterns match.

```typescript
// Both patterns match, but 'high' priority wins
{
  pattern: /\banalyze\b/i,           // Matches first
  opportunity: { priority: 'low', mandatory: false },
},
{
  pattern: /\banalyze.*performance\b/i,  // More specific
  opportunity: { priority: 'high', mandatory: true },
},

// Result: The second pattern wins (high priority)
```

### Complex Regex Patterns

For complex matching, use capture groups and lookahead:

```typescript
// "analyze X for Y"
pattern: /\banalyze\s+(.+?)\s+for\s+(.+?)\b/i,

// "for each" followed by specific action
pattern: /\bfor each\s+(file|module)\s*,\s*(add|remove|update)\s+(.+?)\b/i,

// Negative lookahead - match "analyze" but not "re-analyze"
pattern: /\b(?<!re-)analyze\b/i,

// Match only at beginning of message
pattern: /^for each\s+(file|module)/i,
```

### Conditional Mandatory Flags

You can make the `mandatory` flag dependent on context by checking the message in the `detectSubagentOpportunity` function:

```typescript
// In detectSubagentOpportunity function
if (pattern.test(message)) {
  const taskCount = countTasks(message);
  
  // Only mandatory if multiple tasks detected
  const isMandatory = taskCount > 1;
  
  return {
    ...opportunity,
    mandatory: isMandatory,
    taskCount,
  };
}
```

## Testing Checklist

Before adding your pattern, verify:

- [ ] Pattern matches intended messages
- [ ] Pattern does NOT match unintended messages (false positives)
- [ ] `mandatory` flag is set correctly
- [ ] `priority` is appropriate for the task type
- [ ] `roleId` is set correctly (or undefined for general)
- [ ] `reason` is clear and informative
- [ ] Tested with various wordings of the same intent
- [ ] Tested with case variations
- [ ] Tested with similar but different messages

## Debugging

### Check if Pattern Matches

```typescript
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

const message = "Your test message here";
const result = detectSubagentOpportunity(message);

console.log('Matches:', !!result);
console.log('Mandatory:', result?.mandatory);
console.log('Priority:', result?.priority);
console.log('Role:', result?.roleId);
console.log('Reason:', result?.reason);
```

### Test Multiple Patterns at Once

```typescript
const patterns = [
  "For each file, add tests",
  "Investigate the bug",
  "Analyze performance of all services",
  "Write tests for utils.ts",
];

patterns.forEach(msg => {
  const result = detectSubagentOpportunity(msg);
  console.log(`"${msg}" → ${result ? `mandatory:${result.mandatory}, priority:${result.priority}` : 'no match'}`);
});
```

### List All Patterns

```typescript
import { PATTERNS } from './src/agent/subagent-detector.js';

PATTERNS.forEach(({ pattern, opportunity }) => {
  console.log(`Pattern: ${pattern}`);
  console.log(`  Priority: ${opportunity.priority}`);
  console.log(`  Mandatory: ${opportunity.mandatory}`);
  console.log(`  Role: ${opportunity.roleId || 'general'}`);
  console.log(`  Reason: ${opportunity.reason}`);
  console.log('---');
});
```

## Common Mistakes

### ❌ Case-Sensitive Pattern

```typescript
// Wrong - will only match uppercase "FOR EACH"
pattern: /\bFOR EACH (FILE|MODULE)\b/

// Correct - case-insensitive
pattern: /\bfor each (file|module)\b/i
```

### ❌ Missing Word Boundaries

```typescript
// Wrong - matches "reforestation" when looking for "forest"
pattern: /\bforest\b/i

// Correct - explicit word boundaries
pattern: /\bforest\b/i  // Actually this is fine, but make sure you want the exact word
```

### ❌ Too Broad Pattern

```typescript
// Wrong - matches too many things
pattern: /\bupdate\b/i

// Better - more specific
pattern: /\bupdate\s+(the\s+)?(file|module|service)\b/i
```

### ❌ Forgetting Mandatory Flag

```typescript
// Wrong - high priority but not mandatory
{
  pattern: /\binvestigate\b/i,
  opportunity: {
    priority: 'high',
    mandatory: false,  // Should be true for investigation
  },
}

// Correct
{
  pattern: /\binvestigate\b/i,
  opportunity: {
    priority: 'high',
    mandatory: true,
  },
}
```

### ❌ Priority Mismatch

```typescript
// Wrong - low priority but mandatory (confusing)
{
  pattern: /\binvestigate\b/i,
  opportunity: {
    priority: 'low',
    mandatory: true,  // Doesn't make sense
  },
}

// Correct - mandatory patterns should be high priority
{
  pattern: /\binvestigate\b/i,
  opportunity: {
    priority: 'high',
    mandatory: true,
  },
}
```

## Contributing

When adding new patterns to the codebase:

1. Add the pattern to `src/agent/subagent-detector.ts`
2. Add test cases to verify the pattern works
3. Update [docs/mandatory-delegation.md](docs/mandatory-delegation.md) with the new pattern
4. Update the pattern reference table in the documentation
5. Submit a pull request with clear description of what the pattern does and why

## Resources

- [Main Documentation](docs/mandatory-delegation.md)
- [Pattern Reference](docs/mandatory-delegation.md#pattern-reference)
- [Troubleshooting Guide](docs/mandatory-delegation.md#troubleshooting)
- [Subagent Roles](./subagent-roles.md)
