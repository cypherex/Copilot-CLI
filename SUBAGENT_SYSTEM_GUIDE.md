# Subagent System Guide

## Philosophy

**LLMs work best on FOCUSED, SPECIFIC tasks.** They also work better when context is not overloaded close to their limits. Using subagents is an incredible way to focus task execution and avoid context bloat both for the subagent and the orchestrator.

## Key Principles

1. **Context Isolation** - Subagents receive minimal, focused context
2. **Task Specificity** - Each subagent has a single, well-defined purpose
3. **Parallel Execution** - Independent tasks run simultaneously
4. **Sequential Focus** - Even sequential tasks benefit from isolation
5. **Structured Communication** - Standardized patterns for passing context

## Available Roles

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

### 1. Parallel Dispatch

Use when you have **multiple independent tasks** that can run simultaneously.

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

### 2. Sequential Focus

Use when you have a **single focused task** that benefits from isolation, even if executed sequentially.

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

### 3. Investigate-Diagnose

Use for **root cause analysis** of complex issues.

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

### 4. Test-Generate

Use for **creating comprehensive tests** with focused context.

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

### 5. Refactor-Structure

Use for **improving code organization** with minimal context.

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

## Context Management Tools

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
  action_items: ["Run tests to verify coverage", "Review edge cases"]
})
```

---

## Best Practices

### When to Use Subagents

✅ **DO use subagents for:**
- Focused, specific tasks
- Any work that benefits from isolation
- Multiple independent tasks (parallel)
- Deep investigation or analysis
- Writing tests, docs, or refactoring
- When context is getting large

❌ **DON'T use subagents for:**
- Simple one-file changes
- Quick questions or clarifications
- Tasks requiring orchestrator context
- Very small, trivial work
- When minimal context is already available

### Context Management

✅ **DO:**
- Provide minimal, focused context to subagents
- Use `extract_focus` to create bounded context
- Use `summarize_context` before spawning when conversation is long
- Merge results back with `merge_context`
- Let subagents work independently

❌ **DON'T:**
- Pass entire conversation history to subagents
- Overload subagent context with irrelevant information
- Forget to merge results back
- Mix orchestrator and subagent contexts

### Parallel Execution

✅ **DO:**
- Set `background: true` for parallel tasks
- Wait on all background agents together
- Group related work into batches
- Use appropriate roles for each task

```javascript
// Good: Parallel execution
spawn_agent(task="Write tests for A", background=true)
spawn_agent(task="Write tests for B", background=true)
spawn_agent(task="Write tests for C", background=true)

wait_agent("agent_1")
wait_agent("agent_2")
wait_agent("agent_3")
```

❌ **DON'T:**
- Set `wait: true` when you want parallel execution
- Wait for agents one-by-one (defeats parallelism)
- Spawn too many agents simultaneously (resource limits)

### Sequential Focus

✅ **DO:**
- Use subagents for sequential focused work
- Benefits: isolation, reduced bloat, focused context
- Each subagent can dive deep into its task

```javascript
// Good: Sequential focused work
spawn_agent(task="Investigate bug in auth")
// Get results
spawn_agent(task="Fix the bug based on investigation")
// Get results
spawn_agent(task="Write tests for the fix")
```

❌ **DON'T:**
- Think parallel is the only benefit
- Avoid subagents for sequential work
- Keep all work in orchestrator when it could be isolated

---

## Example Workflows

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

## Subagent Reminder System

The orchestrator receives periodic reminders to use subagents:

### Every 3 Iterations

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
investigator, test-writer, refactorer, fixer, documenter

💡 Context Management Tools:
• summarize_context - Reduce bloat before spawning subagents
• extract_focus - Provide focused context for subagent
• merge_context - Integrate subagent results back

[End Subagent Reminder]
```

---

## Why This Works

### 1. Focused Context

**Problem:** LLMs perform worse when context is cluttered with irrelevant information.

**Solution:** Subagents receive only what they need:
- Relevant files only
- Error context if investigating
- Task-specific instructions
- Minimal history

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

## Summary

The subagent system leverages the core strength of LLMs: **focused execution**. By providing minimal, specific context and well-defined tasks, subagents can work more effectively than a single monolithic agent trying to handle everything.

**Key takeaway:** Use subagents frequently - not just for parallel work, but for any task that benefits from focused, isolated context.
