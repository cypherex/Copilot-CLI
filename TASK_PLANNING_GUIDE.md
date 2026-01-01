# Task Management and Planning System

This document describes the task management and planning system that ensures the agent has a clear plan and tracks work before proceeding.

## Overview

The agent now enforces structured planning before starting work:

1. **Must have a goal** - A clear objective must be established
2. **Must have tasks** - Work must be broken down into tasks
3. **Must have a current task** - Focus on one task at a time
4. **Must maintain task status** - Update tasks as work progresses
5. **Periodic reminders** - Subagent usage suggestions

## Available Tools

### create_task

Create a new task in the task list.

```json
{
  "description": "Task description - be specific and actionable",
  "priority": "high" | "medium" | "low",
  "related_to_goal": true
}
```

**Example:**
```
User: "I need to build a REST API for a todo app"
Agent: Uses create_task to break down:
  - "Design API endpoints" (high)
  - "Implement CRUD operations" (high)
  - "Add authentication" (medium)
  - "Write unit tests" (medium)
```

### update_task_status

Update the status of an existing task.

**Status values:**
- `active` - Currently working on this task
- `blocked` - Cannot proceed due to issues
- `waiting` - Waiting for user input or external dependency
- `completed` - Task is finished
- `abandoned` - Task is no longer needed

```json
{
  "task_id": "task_123",
  "status": "completed",
  "notes": "Optional notes about the status change"
}
```

### set_current_task

Set a task as the current active task.

```json
{
  "task_id": "task_123"
}
```

**Best Practices:**
- Always set a current task before starting work
- Use `update_task_status` to mark it `active` first
- Switch tasks when moving to different work

### list_tasks

List all tasks, optionally filtered by status.

```json
{
  "status": "all" | "active" | "waiting" | "completed" | "blocked" | "abandoned"
}
```

**Best Practices:**
- Review task list before starting work
- Check for blocked tasks regularly
- Review completed tasks before closing session

## Validation Flow

Before processing any user message, the agent validates its planning state:

### Check 1: Has Goal?

**Fails if:** No goal is set

**Reason:** The agent doesn't know what it's trying to accomplish.

**Suggestion:** Ask user for goal, then use `create_task` to break it down.

### Check 2: Has Tasks?

**Fails if:** Zero tasks defined

**Reason:** No plan for how to accomplish the goal.

**Suggestion:** Use `create_task` to create specific, actionable tasks.

### Check 3: Has Current Task?

**Fails if:** No task is set as current

**Reason:** Agent doesn't know what to work on.

**Suggestion:** Use `list_tasks`, then `set_current_task`.

### Check 4: Current Task Active?

**Fails if:** Current task is not `active`

**Reason:** Task status doesn't match work being done.

**Suggestion:** Use `update_task_status` to mark it `active`.

### Check 5: Blocked Tasks?

**Warning if:** Any tasks are blocked

**Suggestion:** Review blocked tasks with `list_tasks status=blocked`.

## System Prompt Injections

The agent receives periodic reminders via system messages:

### Planning Reminders (Every User Message)

```
[Planning Reminders]

Current Task: Implement user authentication
Status: active | Priority: high

Waiting Tasks: 3
⚠️ Blocked Tasks: 1 - Review with list_tasks status=blocked

Reminders:
• Keep your current task updated with update_task_status
• Create new tasks with create_task when identifying new work
• Review task list regularly with list_tasks
• Set current task with set_current_task before working

[End Planning Reminders]
```

### Subagent Reminders (Every 4 Iterations)

```
[Subagent Reminder]

Consider using spawn_agent if:
• You have multiple independent tasks that could run in parallel
• You need to investigate or debug a complex issue (investigator role)
• You want to write tests for multiple files (test-writer role)
• You need to refactor multiple modules (refactorer role)
• You need to create documentation (documenter role)
• You have a specific bug to fix (fixer role)

Use list_agents to check running subagents.
Use wait_agent to get results from background subagents.

[End Subagent Reminder]
```

## Task Status Workflow

### Typical Workflow

1. **Planning Phase**
   ```
   User: "Build a REST API"
   → Agent creates tasks:
     - "Design API endpoints" (waiting)
     - "Implement CRUD operations" (waiting)
     - "Add authentication" (waiting)
   ```

2. **Starting Work**
   ```
   Agent: set_current_task("task_1")
   → Agent: update_task_status("task_1", "active")
   ```

3. **Working**
   ```
   Agent: [does work]
   Agent: update_task_status("task_1", "completed")
   ```

4. **Next Task**
   ```
   Agent: set_current_task("task_2")
   → Agent: update_task_status("task_2", "active")
   ```

5. **Blocked Task**
   ```
   Agent: update_task_status("task_3", "blocked")
   → Notes: "Missing database schema"
   ```

6. **Unblocking**
   ```
   User: Provides schema
   → Agent: update_task_status("task_3", "active")
   ```

## Best Practices for Agents

### 1. Always Create a Plan

❌ **Bad:**
```
User: "Add user authentication"
Agent: [Starts coding immediately without plan]
```

✅ **Good:**
```
User: "Add user authentication"
Agent: Let me create a plan:
  - create_task("Design authentication flow", "high")
  - create_task("Implement login endpoint", "high")
  - create_task("Implement token generation", "medium")
  - create_task("Add password hashing", "high")
  - create_task("Write auth tests", "medium")
```

### 2. Always Update Task Status

❌ **Bad:**
```
Agent: [Completes task]
[No status update]
```

✅ **Good:**
```
Agent: [Completes task]
→ update_task_status("task_1", "completed")
Notes: "Implemented login endpoint with JWT tokens"
```

### 3. Always Set Current Task

❌ **Bad:**
```
Agent: [Starts working on different task]
[No current task set]
```

✅ **Good:**
```
Agent: set_current_task("task_2")
→ update_task_status("task_2", "active")
```

### 4. Use Subagents for Parallel Work

❌ **Bad:**
```
Agent: [Writes tests for 10 files sequentially]
```

✅ **Good:**
```
Agent: spawn_agent(
  task="Write unit tests for auth module",
  role="test-writer",
  files=["auth.ts", "auth.test.ts"],
  background=true
)
→ spawn_agent(
  task="Write unit tests for api module",
  role="test-writer",
  files=["api.ts", "api.test.ts"],
  background=true
)
→ wait_agent("agent_1")
→ wait_agent("agent_2")
```

### 5. Handle Blocked Tasks

❌ **Bad:**
```
Agent: Encounters error
[Ignores it and continues]
```

✅ **Good:**
```
Agent: Encounters error
→ update_task_status("task_3", "blocked")
Notes: "Missing environment variable for API key"

→ [Later, when unblocked]
→ update_task_status("task_3", "active")
```

## Example Session

```
User: I need to build a REST API for a todo application

Agent: [Planning Validation Failed]

Reason: No goal defined. You must establish a clear goal before starting work.

Suggestions:
• Ask user: "What would you like me to help you accomplish?"
• Once you understand's goal, use create_task to break it down into actionable tasks

Agent: Let me clarify the goal and create a plan.

Agent: I'll help you build a REST API for a todo application. Let me break this down into tasks:

→ create_task("Design API endpoints and data models", "high")
→ create_task("Implement GET /todos endpoint", "high")
→ create_task("Implement POST /todos endpoint", "high")
→ create_task("Implement PUT /todos/:id endpoint", "high")
→ create_task("Implement DELETE /todos/:id endpoint", "high")
→ create_task("Add input validation", "medium")
→ create_task("Write unit tests for endpoints", "medium")

Agent: Now let me set the current task and start:

→ set_current_task("task_1")
→ update_task_status("task_1", "active")

Agent: I'm starting to design the API endpoints and data models...
```

## Configuration

### Planning Validation

The `PlanningValidator` class handles validation:

```typescript
const validator = new PlanningValidator(memoryStore);

// Validate before proceeding
const result = validator.validate();
if (!result.canProceed) {
  validator.displayValidation(result);
}

// Get current state
const state = validator.getState();

// Build system prompt injection
const reminders = validator.buildPlanningReminders();
```

### Subagent Reminders

The `buildSubagentReminder` function generates periodic reminders:

```typescript
// Called every 4 iterations
const reminder = buildSubagentReminder(iteration);
if (reminder) {
  // Inject into system message
}
```

## Integration

The planning system is integrated into the `AgenticLoop`:

1. **Before Processing Message:** Validates planning state
2. **On First Iteration:** Injects planning reminders
3. **Every 4 Iterations:** Injects subagent usage reminders
4. **During Work:** Agent uses task tools to track progress

## Benefits

### 1. Structured Work
- Goals are clearly defined
- Work is broken down into tasks
- Progress is tracked

### 2. Visibility
- Task list shows what's pending, active, blocked, completed
- Users can see what the agent is working on
- Blockages are identified early

### 3. Accountability
- Agent must plan before working
- Agent must update task status
- Agent must maintain current task

### 4. Efficiency
- Subagents used for parallel work
- Blockages identified and reported
- Reminders keep agent on track

## Future Enhancements

Potential improvements:

1. **Task Dependencies:** Express that task B depends on task A
2. **Estimated Time:** Track and compare estimated vs actual time
3. **Task Templates:** Common task templates (e.g., "add authentication")
4. **Automatic Task Generation:** Generate tasks from goal descriptions
5. **Task History:** Track how long tasks take
6. **Productivity Metrics:** Velocity, throughput, cycle time
