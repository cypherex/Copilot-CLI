# Subagent Development Guide

This guide provides detailed technical documentation for developers working on the subagent system in Copilot CLI agent.

## Table of Contents

- [Overview](#overview)
- [Enhanced Subagent Roles](#enhanced-subagent-roles)
- [Context Management Tools](#context-management-tools)
- [Communication Patterns](#communication-patterns)
- [Enhanced Subagent Tool](#enhanced-subagent-tool)
- [Planning Validator Integration](#planning-validator-integration)
- [Key Principles](#key-principles)

---

## Overview

The subagent system leverages the fact that LLMs work best on **focused, specific tasks**. The implementation emphasizes:

1. **Context Isolation** - Subagents receive minimal, focused context
2. **Task Specificity** - Each subagent has a single, well-defined purpose
3. **Parallel Execution** - Independent tasks run simultaneously
4. **Sequential Focus** - Even sequential tasks benefit from isolation
5. **Structured Communication** - Standardized patterns for passing context

### Key Design Decisions

1. **Reduced Max Iterations:** All roles now have 2-3 iterations instead of 1000-10000
2. **Token Budgets:** Each role has an appropriate token budget (8K-12K)
3. **Context Boundaries:** Each role defines what context it needs
4. **Communication Patterns:** Standardized patterns for dispatch and merge
5. **Context Management Tools:** Three tools for managing context flow

---

## Enhanced Subagent Roles

### New Interface: ContextBoundary

```typescript
interface ContextBoundary {
  maxContextTokens?: number;      // Maximum context tokens to pass
  includedCategories: string[];  // What context categories to include
  excludedCategories: string[];  // What to explicitly exclude
  focusScope: string;            // What the subagent should focus on
  outputScope: string;           // What the subagent should output
}
```

### Role Definitions

Each role now includes enhanced configuration:

#### test-writer

```typescript
{
  id: 'test-writer',
  name: 'Test Writer',
  maxIterations: 3,           // Reduced from 100000
  tokenBudget: 8000,
  contextBoundary: {
    includedCategories: ['files', 'test-patterns', 'interfaces'],
    excludedCategories: ['conversation-history', 'errors'],
    focusScope: 'Writing tests for specified files',
    outputScope: 'Test files with complete coverage'
  },
  isSuitableForSequential: true  // Can be used for sequential work
}
```

**When to use:**
- Parallel test writing for multiple files
- Edge case coverage for complex logic
- Sequential: Writing tests file-by-file for complex modules

#### investigator

```typescript
{
  id: 'investigator',
  name: 'Investigator',
  maxIterations: 3,           // Reduced from 10000
  tokenBudget: 12000,         // Highest budget for deep analysis
  contextBoundary: {
    includedCategories: ['files', 'errors', 'execution-context'],
    excludedCategories: ['conversation-history'],
    focusScope: 'Diagnosing and analyzing a specified issue',
    outputScope: 'Detailed analysis with root cause and recommendations'
  },
  isSuitableForSequential: true
}
```

**When to use:**
- Complex bugs that need deep investigation
- Root cause analysis
- Sequential: Investigating file-by-file, hypothesis testing

#### refactorer

```typescript
{
  id: 'refactorer',
  name: 'Refactorer',
  maxIterations: 2,           // Reduced from 10000
  tokenBudget: 10000,
  contextBoundary: {
    includedCategories: ['files', 'project-context', 'conventions'],
    excludedCategories: ['conversation-history'],
    focusScope: 'Improving code structure and organization',
    outputScope: 'Refactored code with improved structure'
  },
  isSuitableForSequential: true
}
```

**When to use:**
- Parallel refactoring of multiple modules
- Pattern application across codebase
- Sequential: Refactoring section-by-section

#### documenter

```typescript
{
  id: 'documenter',
  name: 'Documenter',
  maxIterations: 2,           // Reduced from 10000
  tokenBudget: 8000,
  contextBoundary: {
    includedCategories: ['files', 'api-surfaces', 'conventions'],
    excludedCategories: ['conversation-history'],
    focusScope: 'Creating comprehensive documentation',
    outputScope: 'Documentation files (README, API docs, comments)'
  },
  isSuitableForSequential: true
}
```

**When to use:**
- Parallel documentation for different components
- API documentation for different modules
- Sequential: Documenting section-by-section

#### fixer

```typescript
{
  id: 'fixer',
  name: 'Fixer',
  maxIterations: 2,           // Reduced from 10000
  tokenBudget: 10000,
  contextBoundary: {
    includedCategories: ['files', 'errors', 'reproduction-steps'],
    excludedCategories: ['conversation-history'],
    focusScope: 'Fixing specified bug with minimal changes',
    outputScope: 'Fixed code with minimal changes'
  },
  isSuitableForSequential: true
}
```

**When to use:**
- Parallel bug fixing across modules
- Different types of issues simultaneously
- Sequential: Fixing related bugs in sequence

### Helper Functions

```typescript
// Recommend roles based on task description
recommendRoles(task: string): SubagentRole[]

// Check if role is suitable for sequential work
isSuitableForSequential(roleId: string): boolean

// Get context boundary for a role
getContextBoundary(roleId: string): ContextBoundary | null

// Build focused context message for subagent
buildFocusedContext(roleId: string, task: string, files?: string[]): string
```

---

## Context Management Tools

### Overview

Three new tools for managing context flow between orchestrator and subagents:

1. **summarize_context** - Reduce context bloat before spawning
2. **extract_focus** - Provide focused context for subagent
3. **merge_context** - Integrate subagent results back

**File:** `src/tools/context-management-tool.ts`

### summarize_context Tool

**Purpose:** Reduce context bloat before spawning subagents or when conversation is long.

**Parameters:**
```typescript
{
  scope?: 'current_task' | 'recent_messages' | 'all_transcript' | 'files';
  detail_level?: 'brief' | 'normal' | 'detailed';
  include_files?: string[];
}
```

**When to use:**
- Conversation is getting long (> 10 messages)
- Before spawning parallel subagents
- Need to step back and see big picture
- Context is approaching token limits

**Example Output:**
```
[Context Summary - RECENT_MESSAGES]

🎯 Goal: Build REST API for todo app

📋 Current Task: Implement GET /todos endpoint
   Status: active | Priority: high

📊 Task Progress:
   Total: 5
   ✅ Completed: 2
   🔄 Active: 1
   ⏳ Waiting: 2
   🚫 Blocked: 0

👤 Key User Facts:
   • prefers Vim
   • tooling/editor: Neovim

💡 Tip: Use this summary to create focused context for subagents.
```

---

### extract_focus Tool

**Purpose:** Extract minimal, focused context for a subagent.

**Parameters:**
```typescript
{
  focus_area: string;           // Required: Specific area or problem
  files?: string[];             // Files to include
  max_token_budget?: number;    // Max tokens (default: 8000)
  include_errors?: boolean;     // Include errors (default: true)
}
```

**When to use:**
- Spawning a subagent for specific task
- Isolating a problem for deep analysis
- Reducing context bloat
- Creating bounded context

**Example Output:**
```
[Focused Context]
Focus Area: Authentication bug in login function
Token Budget: 8000

🎯 Context: Build REST API for todo app

📋 Current Task: Implement authentication

👤 Relevant User Preferences:
   • prefers Vim

🐛 Relevant Errors:
   • TypeError: Cannot read property 'token' of undefined

📁 Files to Work With:
   • src/auth/login.ts

💡 You have focused context - only what's relevant to your task.
```

---

### merge_context Tool

**Purpose:** Merge subagent results back into orchestrator context.

**Parameters:**
```typescript
{
  subagent_output: string;      // Required: Output from subagent
  summary?: string;             // Summary of what was done
  files_affected?: string[];     // Files that were modified
  action_items?: string[];       // Action items identified
}
```

**When to use:**
- Subagent has completed
- Merging parallel results
- Updating orchestrator understanding
- Maintaining continuity

**Example Output:**
```
[Context Merged]
Summary: Wrote comprehensive tests for auth module
Files Affected:
  • src/auth/auth.test.ts
Action Items:
  • Run tests to verify coverage

💡 Consider updating the current task status if work is complete.
```

---

## Communication Patterns

### Overview

Standardized patterns for communication between orchestrator and subagents.

**File:** `src/agent/subagent-communication-patterns.ts`

### Pattern Types

1. **parallel-dispatch** - Multiple subagents working independently
2. **sequential-focus** - Single subagent with isolated context
3. **investigate-diagnose** - Root cause analysis
4. **test-generate** - Test generation with focused context
5. **refactor-structure** - Code structure improvements

### Key Interfaces

```typescript
interface SubagentContextPackage {
  taskId: string;
  roleId: string;
  task: string;
  files?: string[];
  context: string;
  tokenBudget: number;
  maxIterations: number;
  pattern: CommunicationPattern;
}

interface SubagentResultPackage {
  taskId: string;
  roleId: string;
  output: string;
  filesAffected: string[];
  actionItems: string[];
  summary?: string;
}
```

### Helper Functions

```typescript
// Build context package for spawning subagent
buildContextPackage(roleId, task, files?, memoryStore?): SubagentContextPackage

// Parse and validate subagent results
parseSubagentResult(rawOutput: string): SubagentResultPackage

// Build orchestrator message before spawning subagent
buildOrchestratorDispatchMessage(pattern, subagentTasks): string

// Build orchestrator message after subagent completion
buildOrchestratorMergeMessage(pattern, results): string

// Get recommended communication pattern for a task
getRecommendedPattern(task, files?): CommunicationPattern

// Estimate context token count
estimateTokenCount(text: string): number

// Check if context should be summarized
shouldSummarizeContext(messages: any[]): boolean

// Build subagent task with focused context
buildSubagentTask(roleId, task, files?, pattern?): string
```

---

## Enhanced Subagent Tool

### Overview

Enhanced `spawn_agent` and `wait_agent` tools with automatic pattern detection and focused context generation.

**File:** `src/tools/subagent-tool.ts`

### SpawnAgentTool Enhancements

**Features:**
- **Automatic pattern detection:** Chooses appropriate communication pattern based on task
- **Focused context generation:** Uses `buildSubagentTask` to create minimal context
- **Dispatch messages:** Shows structured message before spawning subagent
- **Role-based context boundaries:** Enforces context limits per role

**Example output:**
```
🎯 Focusing subagent on specific task...

Task will be handled with minimal context isolation.
Subagent will provide focused output for merging.

Tasks:
  1. [test-writer] Write comprehensive tests for auth.ts
     Files: src/auth.ts, src/auth.test.ts
```

### WaitAgentTool Enhancements

**Features:**
- **Automatic result parsing:** Parses subagent output into structured format
- **Merge messages:** Shows structured message after subagent completion
- **Action items:** Extracts and displays action items from results

**Example output:**
```
✅ Focused task completed.

Merging subagent output back into context.
Updating orchestrator understanding.

Results Summary:
  1. Wrote comprehensive tests for auth module
     Modified: src/auth/auth.test.ts

Action Items:
  • Run tests to verify coverage
  • Review edge cases
```

---

## Planning Validator Integration

### Updated Subagent Reminder

The planning validator now includes comprehensive subagent reminders every 3 iterations.

**File:** `src/agent/planning-validator.ts`

**Reminder Content:**

```
[Subagent Reminder]

🎯 LLMs work best on FOCUSED, SPECIFIC tasks

Use spawn_agent when:

📊 Context Management:
• The conversation is getting long (> 10 messages)
• You're working on a complex problem with many details
• Context is becoming overloaded with irrelevant information
• You need to step back and see the big picture

🔄 Parallel Execution (multiple subagents):
• Writing tests for multiple files or modules
• Refactoring or analyzing multiple components
• Investigating bugs in different parts of the codebase
• Creating documentation for different sections

🎯 Focused Sequential Tasks (single subagent):
• Writing tests for a complex module (file-by-file)
• Investigating a bug by tracing through components
• Refactoring a large module (section-by-section)
• Writing documentation while understanding code
• Any focused, bounded task that benefits from isolation

📋 Role-Based Delegation:

investigator (diagnose & debug):
  • Complex bugs that need deep investigation
  • Root cause analysis
  • Tracing execution paths

test-writer:
  • Writing tests for specific files/functions
  • Edge case coverage
  • Test refactoring

refactorer:
  • Code structure improvements
  • Pattern application
  • Code organization

fixer:
  • Bug fixes with minimal changes
  • Error handling improvements
  • Regression prevention

documenter:
  • API documentation
  • README and guides
  • Code comments

Each subagent can run for thousands of iterations (default: 1000)

💡 Context Management Tools:
• summarize_context - Reduce bloat before spawning subagents
• extract_focus - Provide focused context for subagent
• merge_context - Integrate subagent results back

💡 Best Practices:
• Provide minimal, focused context to subagents
• Use extract_focus to create bounded context
• Merge results back with merge_context
• Set background=true for parallel tasks
• Wait on all background agents together

[End Subagent Reminder]
```

---

## Key Principles

### 1. Context Isolation

**Problem:** LLMs perform worse when context is cluttered with irrelevant information.

**Solution:** Subagents receive only what they need:
- Only relevant files
- Task-specific instructions
- Error context if investigating
- No unnecessary conversation history

### 2. Task Specificity

**Problem:** Broad, vague tasks lead to unfocused work.

**Solution:** Each subagent has:
- Single, well-defined purpose
- Clear output expectations
- Specific file scope
- Role-specific system prompt

### 3. Parallel Execution

**Problem:** Sequential work on independent tasks is slow.

**Solution:** Run independent tasks simultaneously:
- Test multiple files in parallel
- Refactor multiple modules together
- Investigate different aspects separately
- Write different docs at once

### 4. Sequential Focus

**Problem:** Even sequential tasks can be distracted by context bloat.

**Solution:** Isolated subagents for focused work:
- Investigate bug with minimal context
- Write tests for one module at a time
- Refactor section-by-section
- Document while understanding code

### 5. Orchestrator Benefits

**Problem:** Orchestrator context grows unbounded.

**Solution:** Orchestrator maintains high-level view:
- Subagents handle details
- Orchestrator coordinates and merges
- Summarized context at key points
- Clear separation of concerns

---

## Files Created/Modified

### Created Files

1. `src/tools/context-management-tool.ts` - 3 context management tools
2. `src/agent/subagent-communication-patterns.ts` - Communication patterns

### Modified Files

1. `src/agent/subagent-roles.ts` - Enhanced roles with context boundaries
2. `src/tools/subagent-tool.ts` - Enhanced with communication patterns
3. `src/agent/planning-validator.ts` - Updated subagent reminder
4. `src/tools/index.ts` - Register context management tools
5. `src/agent/index.ts` - Register context management tools

---

## Build Status

```bash
npm run build
# Exit Code: 0
```

All TypeScript compilation passed successfully.

---

## Summary

The subagent system now emphasizes:

✅ **Focused, specific tasks** - Subagents get minimal, relevant context
✅ **Context isolation** - Reduces bloat for both subagent and orchestrator
✅ **Parallel execution** - Multiple independent subagents run simultaneously
✅ **Sequential focus** - Even sequential work benefits from isolation
✅ **Structured communication** - Standardized patterns for passing context
✅ **Periodic reminders** - Every 3 iterations, emphasizing all use cases

**Key insight:** Use subagents frequently - not just for parallel work, but for **any task that benefits from focused, isolated context**.

---

## See Also

- [Subagent Quick Reference](./subagent-quick-reference.md) - Quick usage guide
- [Developer Guide](./developer-guide.md) - System architecture
- [Context Budget System](./context-budget.md) - Token allocation details
- [SUBAGENT_SYSTEM_GUIDE.md](../SUBAGENT_SYSTEM_GUIDE.md) - Complete system guide
