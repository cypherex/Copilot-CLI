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
