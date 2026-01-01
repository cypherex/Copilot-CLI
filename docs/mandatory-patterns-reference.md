# Mandatory Pattern Quick Reference

A quick lookup table for all mandatory delegation patterns in the system.

## Summary

| Pattern | Category | Mandatory | Priority | Role |
|---------|----------|-----------|----------|------|
| `for each (file\|module\|service\|component)` | Parallel Processing | ✅ Yes | High | General |
| `across all (files\|modules\|services)` | Parallel Processing | ✅ Yes | High | General |
| `investigate` | Investigation | ✅ Yes | High | Investigator |
| `(debug\|debugging\|diagnos)` | Investigation | ✅ Yes | High | Investigator |
| `(fix\|resolve\|solve) (bug\|error\|issue\|problem)` | Bug Fix | ✅ Yes | High | Fixer |
| `all (files\|services\|modules\|components)` | Parallel Processing | ✅ Yes | High | General |

---

## Detailed Pattern List

### Parallel Processing Patterns

#### Pattern 1: For Each
**Regex**: `/\bfor each (file|module|service|component)\b/i`

| Property | Value |
|----------|-------|
| Mandatory | ✅ Yes |
| Priority | High |
| Role | General (auto-detected) |
| Category | Parallel Processing |

**Triggers on**:
- "For each file, add unit tests"
- "Update logging for each service"
- "Add error handling for each component"

**Why mandatory**: Explicitly indicates parallelizable work requiring multiple subagents.

---

#### Pattern 2: Across All
**Regex**: `/\bacross all (files|modules|services)\b/i`

| Property | Value |
|----------|-------|
| Mandatory | ✅ Yes |
| Priority | High |
| Role | General (auto-detected) |
| Category | Parallel Processing |

**Triggers on**:
- "Apply this change across all modules"
- "Update imports across all services"
- "Add copyright headers across all files"

**Why mandatory**: Cross-module operations require parallel processing for efficiency.

---

#### Pattern 3: All Files/Modules/Services/Components
**Regex**: `/\ball\s+(files?|services?|modules?|components?)\b/i`

| Property | Value |
|----------|-------|
| Mandatory | ✅ Yes |
| Priority | High |
| Role | General (auto-detected) |
| Category | Parallel Processing |

**Triggers on**:
- "Add comments to all files"
- "Update type definitions in all modules"
- "Fix the bug in all services"

**Why mandatory**: Operating on all items requires parallel processing.

---

### Investigation Patterns

#### Pattern 4: Investigate
**Regex**: `/\binvestigate\b/i`

| Property | Value |
|----------|-------|
| Mandatory | ✅ Yes |
| Priority | High |
| Role | Investigator |
| Category | Investigation |

**Triggers on**:
- "Investigate why the API returns 500 errors"
- "Investigate the memory leak issue"
- "Investigate the authentication flow"

**Why mandatory**: Investigation requires focused, iterative analysis using specialized investigator role.

---

#### Pattern 5: Debug/Diagnose
**Regex**: `/\b(debug|debugging|diagnos)\b/i`

| Property | Value |
|----------|-------|
| Mandatory | ✅ Yes |
| Priority | High |
| Role | Investigator |
| Category | Investigation |

**Triggers on**:
- "Debug the connection timeout"
- "Debug why tests are failing"
- "Diagnose the performance issue"

**Why mandatory**: Debugging tasks require systematic diagnosis using investigator role.

---

### Bug Fix Patterns

#### Pattern 6: Fix/Resolve/Solve Bug/Error/Issue/Problem
**Regex**: `/\b(fix|resolve|solves?)(\s+(a|the|this)?\s+)(bug|error|issue|problem)\b/i`

| Property | Value |
|----------|-------|
| Mandatory | ✅ Yes |
| Priority | High |
| Role | Fixer |
| Category | Bug Fix |

**Triggers on**:
- "Fix the bug in the login module"
- "Resolve the error in the API"
- "Solve this database problem"

**Why mandatory**: Bug fixes require proper diagnosis before fixing, using the fixer role.

---

## Suggested Patterns (Non-Mandatory)

These patterns suggest delegation but don't require it.

### Test Writing Patterns (`priority: 'medium'`)

| Pattern | Role | Triggers |
|---------|------|----------|
| `/\b(add \|write \|create )tests?\b/i` | test-writer | "Add tests", "Write tests", "Create tests" |
| `/\b(testing\|test cases?\|unit tests?\|coverage)\b/i` | test-writer | "Testing", "Test cases", "Unit tests", "Coverage" |
| `/\bspec(s?\|ification)\b/i` | test-writer | "Spec", "Specs", "Specification" |

---

### Refactoring Patterns (`priority: 'medium'`)

| Pattern | Role | Triggers |
|---------|------|----------|
| `/\brefactor\b/i` | refactorer | "Refactor the code" |
| `/\b(cleanup\|clean up\|reorganize\|restructure)\b/i` | refactorer | "Clean up", "Reorganize", "Restructure" |
| `/\b(improve\|optimize\|simplify\|consolidate)\s+(the )?\s+(code\|structure)\b/i` | refactorer | "Improve code", "Optimize structure" |
| `/\bextract\b.*\b(into\|from)\b/i` | refactorer | "Extract into", "Extract from" |

---

### Documentation Patterns (`priority: 'low'`)

| Pattern | Role | Triggers |
|---------|------|----------|
| `/\b(document\|doc)\b/i` | documenter | "Document the code", "Add doc" |
| `/\b(readme\|docs?\|api docs?\|comments?)\b/i` | documenter | "Update README", "Add docs", "API docs" |
| `/\b(add\|update\|improve)\s+(comments?\|documentation?)\b/i` | documenter | "Add comments", "Update documentation" |

---

### Multiple Items Patterns (Variable Priority)

| Pattern | Priority | Role | Triggers |
|---------|----------|------|----------|
| `/(\w+\.?\w+\.\w+).*?,.*(\w+\.?\w+\.\w+)/i` | Medium | General | Multiple files listed: "file1.ts, file2.ts" |
| `/\b(several\|multiple\|various)\s+(files?\|services?\|modules?\|components?)\b/i` | Medium | General | "Several files", "Multiple modules" |
| `/\b(each\|every)\s+(file\|service\|module\|component)\b/i` | Medium | General | "Each file", "Every service" |
| `/\b(each of the\|every one of the)\s+(files?\|services?\|modules?\|components?)\b/i` | Medium | General | "Each of the files" |
| `/\b(two\|three\|four\|five\|six\|seven\|eight\|nine\|ten)\s+(files?\|services?\|modules?\|components?)\b/i` | Low | General | "Three files", "Five modules" |

---

### Multiple Tasks Patterns (Variable Priority)

| Pattern | Priority | Role | Triggers |
|---------|----------|------|----------|
| `/\band\s+also\b/i` | Low | General | "Do this and also that" |
| `/\band\s+additionally\b/i` | Low | General | "Do this and additionally that" |
| `/\bas\s+well\s+as\b/i` | Low | General | "Do this as well as that" |
| `/\balong\s+with\b/i` | Medium | General | "Do this along with that" |
| `/\bin\s+addition\b/i` | Medium | General | "Do this in addition to that" |
| `/\bfurthermore\b/i` | Medium | General | "Do this, furthermore, do that" |
| `/\bplus\b/i` | Low | General | "Do this plus that" |
| `/\balso\s+(refactor\|update\|add\|write\|create\|fix\|investigate\|test\|document\|improve\|optimize\|cleanup)\b/i` | Medium | General | "Check this, also fix that" |

---

## Pattern Decision Matrix

Use this matrix to determine if a pattern should be mandatory:

| Task Type | Parallelizable? | Requires Specialist? | Complexity | Recommended | Priority | Mandatory |
|-----------|----------------|---------------------|------------|-------------|----------|-----------|
| "For each file" | ✅ Yes | ❌ No | High | Mandatory | High | ✅ |
| "Investigate" | ❌ No | ✅ Yes | High | Mandatory | High | ✅ |
| "Debug" | ❌ No | ✅ Yes | High | Mandatory | High | ✅ |
| "Fix bug" | ❌ No | ✅ Yes | High | Mandatory | High | ✅ |
| "Write tests" | ⚠️ Maybe | ⚠️ Maybe | Medium | Suggested | Medium | ❌ |
| "Refactor" | ⚠️ Maybe | ❌ No | Medium | Suggested | Medium | ❌ |
| "Update docs" | ❌ No | ⚠️ Maybe | Low | Suggested | Low | ❌ |

**Legend:**
- ✅ = Recommended
- ❌ = Not recommended
- ⚠️ = Depends on context

---

## Testing Your Patterns

### Test Pattern Matching

```typescript
import { detectSubagentOpportunity } from './src/agent/subagent-detector.js';

// Test a message
const result = detectSubagentOpportunity('For each module, add tests');
console.log(result);
```

### Expected Output for Mandatory Patterns

```typescript
{
  roleId: undefined,  // or specific role like 'investigator'
  shouldSpawn: true,
  reason: 'Multiple files/modules need processing - MUST spawn parallel subagents',
  priority: 'high',
  mandatory: true,
  taskCount: 1,  // optional
}
```

### Expected Output for Suggested Patterns

```typescript
{
  roleId: 'test-writer',
  shouldSpawn: true,
  reason: 'Test writing task detected',
  priority: 'medium',
  mandatory: false,
  taskCount: undefined,
}
```

---

## Quick Reference Card

### When to Use Mandatory

Use `mandatory: true` when:
- ✅ Task is parallelizable across multiple items
- ✅ Task requires specialized investigation or debugging
- ✅ Task is complex and benefits from dedicated agent
- ✅ Pattern language explicitly indicates delegation needed

### When to Use Suggested

Use `mandatory: false` (or omit) when:
- ✅ Task could be done directly or delegated
- ✅ Task complexity varies
- ✅ Agent should use judgment
- ✅ Pattern is hint, not requirement

### Priority Guidelines

| Priority | Use When | Examples |
|----------|----------|----------|
| **High** | Mandatory delegation, investigation, debugging | Investigate, debug, for each, all files |
| **Medium** | Strong suggestion, common tasks | Write tests, refactor, multiple items |
| **Low** | Weak suggestion, optional tasks | Documentation, simple additions |

---

## Related Documentation

- [Full Mandatory Delegation Documentation](docs/mandatory-delegation.md)
- [Adding New Mandatory Patterns](docs/adding-mandatory-patterns.md)
- [Troubleshooting Guide](docs/mandatory-delegation.md#troubleshooting)
- [Subagent Roles](./subagent-roles.md)

---

## Pattern Format Reference

```typescript
interface PatternMatch {
  pattern: RegExp;
  opportunity: {
    roleId?: string;           // Optional: 'test-writer', 'investigator', etc.
    shouldSpawn: boolean;       // Always true for delegation patterns
    reason: string;            // Human-readable explanation
    priority: 'high' | 'medium' | 'low';
    mandatory?: boolean;       // true = mandatory, false/undefined = suggested
  };
}
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2024 | Added mandatory delegation system |
| 1.0.0 | 2024 | Initial subagent suggestion system |
