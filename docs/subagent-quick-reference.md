# Subagent Quick Reference

## TL;DR

**Use subagents for focused, specific tasks** - not just parallel work. They reduce context bloat and improve quality.

## 5 Roles

| Role | Purpose | Max Iter | Tokens | Best For |
|------|---------|-----------|--------|----------|
| **test-writer** | Write tests | 3 | 8K | Test coverage, edge cases |
| **investigator** | Diagnose bugs | 3 | 12K | Root cause analysis |
| **refactorer** | Improve code | 2 | 10K | Code structure, patterns |
| **fixer** | Fix bugs | 2 | 10K | Specific bug fixes |
| **documenter** | Write docs | 2 | 8K | API docs, README |

## 3 Context Tools

| Tool | When to Use |
|------|-------------|
| **summarize_context** | Conversation is getting long (> 10 messages) |
| **extract_focus** | Spawning a subagent, need minimal context |
| **merge_context** | Subagent completed, need to integrate results |

## When to Use Subagents

### ✅ Parallel (Multiple Subagents)

```javascript
spawn_agent(task="Write tests for A", background=true)
spawn_agent(task="Write tests for B", background=true)
spawn_agent(task="Write tests for C", background=true)

wait_agent("agent_1")
wait_agent("agent_2")
wait_agent("agent_3")
```

### ✅ Sequential (Single Subagent)

```javascript
// Even sequential work benefits from isolation!
spawn_agent(task="Investigate bug in auth")
spawn_agent(task="Fix the bug")
spawn_agent(task="Write tests for the fix")
```

## Quick Examples

### Test Writing
```javascript
spawn_agent(
  task="Write comprehensive tests for auth.ts",
  role="test-writer",
  files=["src/auth.ts", "src/auth.test.ts"]
)
```

### Bug Investigation
```javascript
extract_focus({
  focus_area: "Login returning 500 error",
  files: ["src/auth/login.ts"]
})

spawn_agent(
  task="Investigate why login returns 500",
  role="investigator"
)
```

### Refactoring
```javascript
spawn_agent(
  task="Refactor user service to use DI",
  role="refactorer",
  files=["src/services/user.ts"]
)
```

### Bug Fixing
```javascript
spawn_agent(
  task="Fix authentication bug",
  role="fixer",
  files=["src/auth/login.ts"]
)
```

### Documentation
```javascript
spawn_agent(
  task="Document user API endpoints",
  role="documenter",
  files=["src/api/user.ts", "README.md"]
)
```

## Best Practices

### ✅ DO

- Use `summarize_context` when conversation is long
- Use `extract_focus` before spawning subagents
- Use `merge_context` after subagent completes
- Set `background=true` for parallel work
- Wait for all background agents together

### ❌ DON'T

- Pass entire conversation to subagents
- Overload subagent context
- Forget to merge results
- Wait one-by-one for parallel agents

## Periodic Reminders

Every 3 iterations, you'll see:

```
[Subagent Reminder]

🎯 LLMs work best on FOCUSED, SPECIFIC tasks

Use spawn_agent when:
📊 Context is getting long
🔄 Multiple independent tasks (parallel)
🎯 Any focused task (sequential)

Use tools:
• summarize_context - Reduce bloat
• extract_focus - Focused context
• merge_context - Integrate results

[End Subagent Reminder]
```

## Complete Workflow

```javascript
// 1. Summarize if conversation is long
summarize_context({ scope: "recent_messages" })

// 2. Extract focus for subagent
extract_focus({
  focus_area: "What you're working on",
  files: ["relevant/files.ts"]
})

// 3. Spawn subagent (parallel or sequential)
spawn_agent(
  task="Specific, focused task",
  role="test-writer", // or investigator, refactorer, fixer, documenter
  files: ["relevant/files.ts"]
)

// 4. Merge results (happens automatically)
merge_context({
  subagent_output: "...",
  summary: "What was done",
  files_affected: ["file.ts"],
  action_items: ["Next steps"]
})
```

## Remember

> **LLMs work best on focused, specific tasks**
>
> Use subagents frequently - not just for parallel work, but for **any task that benefits from focused, isolated context**.

---

## Detailed Role Reference

### test-writer

**Max Iterations:** 3
**Token Budget:** 8,000

**When to use:**
- Writing tests for multiple files in parallel
- Adding test coverage for new features
- Writing edge case tests for complex logic
- Creating integration tests
- Writing tests for a complex module file-by-file (sequential)

**Context Boundary:**
- Files to be tested
- Existing test patterns and conventions
- Relevant function signatures and interfaces

**Output Scope:** Test file(s) with complete test coverage

---

### investigator

**Max Iterations:** 3
**Token Budget:** 12,000

**When to use:**
- Investigating complex bugs in parallel across modules
- Diagnosing and analyzing code issues
- Root cause analysis for system-level issues
- Investigating a bug by examining file-by-file (sequential)
- Tracing execution through multiple components (sequential)

**Context Boundary:**
- Error and relevant execution context
- Files involved in the error path
- Recent error messages and stack traces
- Working state and recent errors

**Output Scope:** Detailed analysis with root cause and recommendations

---

### refactorer

**Max Iterations:** 2
**Token Budget:** 10,000

**When to use:**
- Refactoring multiple modules in parallel
- Applying consistent patterns across codebase
- Restructuring large code sections
- Extracting common utilities
- Refactoring a large module section-by-section (sequential)

**Context Boundary:**
- Code being refactored and direct dependencies
- Project context and conventions
- User preferences

**Output Scope:** Refactored code with improved structure

---

### documenter

**Max Iterations:** 2
**Token Budget:** 8,000

**When to use:**
- Writing documentation for multiple components in parallel
- Creating API documentation for different modules
- Writing different types of docs simultaneously
- Documenting a large module section-by-section (sequential)
- Writing documentation iteratively while understanding code (sequential)

**Context Boundary:**
- Code being documented
- Project context and conventions
- API surfaces and public interfaces

**Output Scope:** Documentation files (README, API docs, inline comments)

---

### fixer

**Max Iterations:** 2
**Token Budget:** 10,000

**When to use:**
- Fixing multiple bugs in parallel across modules
- Addressing different types of issues simultaneously
- Implementing fixes while maintaining focus
- Fixing related bugs in sequence (sequential)

**Context Boundary:**
- Bug and relevant code
- Error messages and reproduction steps
- Directly affected code sections

**Output Scope:** Fixed code with minimal changes

---

## Communication Patterns

### Parallel Dispatch

Multiple subagents working independently on different tasks.

**When to use:** You have multiple independent tasks that can run simultaneously.

**Example:**
```javascript
// Write tests for multiple files in parallel
spawn_agent(
  task="Write comprehensive tests for auth.ts",
  role="test-writer",
  files=["src/auth.ts", "src/auth.test.ts"],
  background=true
)

spawn_agent(
  task="Write comprehensive tests for api.ts",
  role="test-writer",
  files=["src/api.ts", "src/api.test.ts"],
  background=true
)

spawn_agent(
  task="Write comprehensive tests for db.ts",
  role="test-writer",
  files=["src/db.ts", "src/db.test.ts"],
  background=true
)

// Wait for all to complete
wait_agent("agent_1")
wait_agent("agent_2")
wait_agent("agent_3")
```

**Benefits:**
- Parallel execution saves time
- Each subagent has focused context
- No context bloat from concatenating all files
- Independent failures don't block others

---

### Sequential Focus

Single subagent with isolated context, even when executed sequentially.

**When to use:** You have a single focused task that benefits from isolation.

**Example:**
```javascript
// Investigate a complex bug with isolated context
spawn_agent(
  task="Investigate the authentication failure in login function",
  role="investigator",
  files=["src/auth/login.ts", "src/auth/middleware.ts"]
)
```

**Benefits:**
- Focused context prevents distractions
- Subagent can dive deep without broader conversation noise
- Orchestrator maintains high-level view
- Easier to reason about specific problem

---

### Investigate-Diagnose

Root cause analysis of complex issues.

**When to use:** Deep investigation of a specific issue.

**Example:**
```javascript
// Deep investigation of a specific issue
spawn_agent(
  task="Investigate why the API returns 500 error when user has no permissions",
  role="investigator",
  files=["src/api/handlers.ts", "src/auth/permissions.ts", "src/errors.ts"]
)
```

**Benefits:**
- Systematic debugging approach
- Context limited to error path
- Clear diagnosis and recommendations
- Minimal noise in orchestrator context

---

### Test-Generate

Creating comprehensive tests with focused context.

**When to use:** Generate tests for a complex module.

**Example:**
```javascript
// Generate tests for a complex module
spawn_agent(
  task="Write comprehensive tests for the user authentication module",
  role="test-writer",
  files=["src/auth/index.ts", "src/auth/login.ts", "src/auth/logout.ts"]
)
```

**Benefits:**
- Tests focus on relevant code only
- No need to load entire project context
- Clear edge case coverage
- Follows existing patterns

---

### Refactor-Structure

Improving code organization with minimal context.

**When to use:** Refactor a large module.

**Example:**
```javascript
// Refactor a large module
spawn_agent(
  task="Refactor the user service to use dependency injection pattern",
  role="refactorer",
  files=["src/services/user.ts", "src/services/user.test.ts"]
)
```

**Benefits:**
- Focused on structure, not implementation
- Minimal context reduces confusion
- Incremental, testable changes
- Clear before/after state

---

## Context Management Tools Details

### summarize_context

Reduce context bloat before spawning subagents or when conversation is getting long.

**Parameters:**
- `scope` - What to summarize (`current_task`, `recent_messages`, `all_transcript`, `files`)
- `detail_level` - How much detail (`brief`, `normal`, `detailed`)
- `include_files` - Specific files to include

**When to use:**
- Conversation is getting long (> 10 messages)
- Before spawning parallel subagents
- Need to step back and see big picture
- Context is approaching token limits

**Example:**
```javascript
summarize_context({
  scope: "recent_messages",
  detail_level: "normal"
})
```

**Output:**
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

### extract_focus

Extract minimal, focused context for a subagent.

**Parameters:**
- `focus_area` - The specific area or problem (required)
- `files` - Specific files to include
- `max_token_budget` - Maximum tokens (default: 8000)
- `include_errors` - Include relevant errors (default: true)

**When to use:**
- Spawning a subagent for specific task
- Isolating a problem for deep analysis
- Reducing context bloat
- Creating bounded context

**Example:**
```javascript
extract_focus({
  focus_area: "Authentication bug in login function",
  files: ["src/auth/login.ts"],
  max_token_budget: 8000,
  include_errors: true
})
```

**Output:**
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

### merge_context

Merge subagent results back into orchestrator context.

**Parameters:**
- `subagent_output` - Output from subagent (required)
- `summary` - Summary of what was done
- `files_affected` - Files that were modified
- `action_items` - Action items identified

**When to use:**
- Subagent has completed
- Merging parallel results
- Updating orchestrator understanding
- Maintaining continuity

**Example:**
```javascript
merge_context({
  subagent_output: "...",
  summary: "Wrote comprehensive tests for auth module",
  files_affected: ["src/auth/auth.test.ts"],
  action_items: ["Run tests to verify coverage"]
})
```

**Output:**
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

## Complete Example Workflows

### Workflow 1: Parallel Test Generation

```javascript
// 1. Summarize context first
summarize_context({ scope: "recent_messages" })

// 2. Spawn parallel test writers
spawn_agent(
  task="Write comprehensive tests for auth module",
  role="test-writer",
  files=["src/auth/*"],
  background=true
)

spawn_agent(
  task="Write comprehensive tests for API module",
  role="test-writer",
  files=["src/api/*"],
  background=true
)

spawn_agent(
  task="Write comprehensive tests for database module",
  role="test-writer",
  files=["src/db/*"],
  background=true
)

// 3. Wait for all results
const result1 = wait_agent("agent_1")
const result2 = wait_agent("agent_2")
const result3 = wait_agent("agent_3")

// 4. Merge all results
merge_context({
  subagent_output: result1,
  summary: "Auth module tests written"
})
merge_context({
  subagent_output: result2,
  summary: "API module tests written"
})
merge_context({
  subagent_output: result3,
  summary: "Database module tests written"
})

// 5. Update task status
update_task_status({
  task_id: "task_test_coverage",
  status: "completed"
})
```

---

### Workflow 2: Sequential Bug Investigation

```javascript
// 1. Extract focus for investigation
extract_focus({
  focus_area: "Authentication failing with 500 error",
  files: ["src/auth/login.ts", "src/api/middleware.ts"]
})

// 2. Spawn investigator
const investigation = spawn_agent(
  task="Investigate why login returns 500 error for valid credentials",
  role="investigator"
)

// 3. Review investigation results
// (merge happens automatically)

// 4. Spawn fixer based on investigation
const fix = spawn_agent(
  task="Fix the authentication bug identified in investigation",
  role="fixer",
  files: investigation.files_affected
)

// 5. Spawn test writer
const tests = spawn_agent(
  task="Write tests to prevent regression of this bug",
  role="test-writer",
  files: [...fix.files_affected, "src/auth/auth.test.ts"]
)

// 6. Update task status
update_task_status({
  task_id: "task_fix_auth_bug",
  status: "completed"
})
```

---

### Workflow 3: Mixed Parallel + Sequential

```javascript
// 1. Summarize current state
summarize_context({ scope: "recent_messages" })

// 2. Spawn parallel refactorers
spawn_agent(
  task="Refactor user service to use dependency injection",
  role="refactorer",
  files=["src/services/user.ts"],
  background=true
)

spawn_agent(
  task="Refactor auth service to use dependency injection",
  role="refactorer",
  files=["src/services/auth.ts"],
  background=true
)

spawn_agent(
  task="Refactor database service to use dependency injection",
  role="refactorer",
  files=["src/services/db.ts"],
  background=true
)

// 3. Wait for all refactors to complete
wait_agent("agent_1")
wait_agent("agent_2")
wait_agent("agent_3")

// 4. Sequential integration test writing
spawn_agent(
  task="Write integration tests for refactored services",
  role="test-writer",
  files=["src/services/*", "src/integration/*"]
)

// 5. Update documentation
spawn_agent(
  task="Update service documentation with new DI pattern",
  role="documenter",
  files=["docs/services.md", "README.md"]
)

// 6. Complete task
update_task_status({
  task_id: "task_di_pattern",
  status: "completed"
})
```

---

## See Also

- [Subagent Development Guide](./subagent-development.md) - Implementation details and architecture
- [Developer Guide](./developer-guide.md) - System architecture and best practices
- [Context Budget System](./context-budget.md) - Token allocation for subagents