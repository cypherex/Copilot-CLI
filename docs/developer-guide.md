# Developer Guide

This guide provides comprehensive documentation for developers working on the Copilot CLI agent system. It covers implementation details, architectural patterns, and best practices.

## Table of Contents

- [Task Planning and Management](#task-planning-and-management)
- [User Interruptions and Session Management](#user-interruptions-and-session-management)
- [Task Display UI](#task-display-ui)
- [Memory Compression System](#memory-compression-system)
- [Agentic Loop](#agentic-loop)
- [Type System](#type-system)
- [Build and Testing](#build-and-testing)

---

## Task Planning and Management

### Overview

The task management system ensures the agent has a clear plan and tracks work before proceeding. It enforces structured planning through validation and reminders.

### Task Management Tools

Four tools provide explicit task tracking:

#### create_task

Create new tasks with description, priority, and goal relation.

```typescript
create_task({
  description: string,           // Required: What needs to be done
  priority?: 'high' | 'medium' | 'low',  // Optional: Task priority
  related_to_goal?: boolean      // Optional: Is this related to main goal?
})
```

- Returns task ID and confirmation
- Status defaults to `waiting` (new tasks start waiting to be started)
- Task ID format: `task_1`, `task_2`, etc.

#### update_task_status

Update task status with optional notes.

```typescript
update_task_status({
  task_id: string,                          // Required: Task ID
  status: 'active' | 'blocked' | 'waiting' | 'completed' | 'abandoned',
  notes?: string                           // Optional: Status change notes
})
```

- Auto-updates timestamp
- Changes are tracked in memory

#### set_current_task

Set task as current active focus.

```typescript
set_current_task({
  task_id: string    // Required: Task ID to focus on
})
```

- Updates working state with task ID
- Should be used before starting work on a task
- Only one task can be current at a time

#### list_tasks

List all tasks or filter by status.

```typescript
list_tasks({
  status?: 'active' | 'blocked' | 'waiting' | 'completed' | 'abandoned'  // Optional filter
})
```

- Groups by status for readability
- Shows task IDs for reference
- Displays priority and timestamps

### Planning Validator

The planning validator enforces that the agent has proper planning before executing work.

#### Validation Checks

The validator checks these conditions:

1. ✅ Has goal defined
2. ✅ Has at least one task
3. ✅ Has current task set
4. ✅ Current task is `active` status
5. ⚠️ Warns about blocked tasks

#### Validation Flow

```
User Message
  ↓
Validate Planning State
  ↓ (fails)
Display Validation Error with Suggestions
  ↓ (passes)
Inject Planning Reminders
  ↓
Process Message (with reminders in context)
```

#### Integration with Agentic Loop

The planning validator is integrated into the agentic loop:

```typescript
// In src/agent/loop.ts
// Validate before processing user message
const validation = this.planningValidator.validate();
if (!validation.canProceed) {
  this.planningValidator.displayValidation();
  return;
}

// Inject planning reminders on first iteration
if (iteration === 1) {
  const reminders = this.planningValidator.buildPlanningReminders();
  messages = [
    ...messages.slice(0, -1),
    { role: 'system', content: reminders },
    messages[messages.length - 1],
  ];
}
```

#### Validation Scenarios

**Scenario 1: No Goal**
```
⛔ Planning Validation Failed

Reason: No goal defined. You must establish a clear goal before starting work.

Suggestions:
• Ask user: "What would you like me to help you accomplish?"
• Once you understand's goal, use create_task to break it down into actionable tasks
```

**Scenario 2: No Tasks**
```
⛔ Planning Validation Failed

Reason: No tasks defined. You must create a task list before starting work.

Suggestions:
• Use create_task to break down goal into specific, actionable tasks
• Start with high-level tasks, then break them down further
```

**Scenario 3: No Current Task**
```
⛔ Planning Validation Failed

Reason: No current task set. You must set a current task before starting work.

Suggestions:
• Use list_tasks to see available tasks
• Use set_current_task to focus on a specific task
• Use update_task_status to mark the selected task as active
```

### Planning Reminders

On the first iteration, the agent receives planning reminders in the system prompt:

```
[Planning Reminders]

Current Task: Design API endpoints and data models
Status: active | Priority: high

Waiting Tasks: 3
Reminders:
• Keep your current task updated with update_task_status
• Create new tasks with create_task when identifying new work
• Review task list regularly with list_tasks
• Set current task with set_current_task before working
```

### Subagent Reminders

Every 4 iterations, the agent receives reminders about subagent usage:

```
[Subagent Reminder]

Consider using spawn_agent if:
• You have multiple independent tasks that could run in parallel
• You need to investigate or debug a complex issue (investigator role)
• You want to write tests for multiple files (test-writer role)
• You need to refactor multiple modules (refactorer role)
• You need to create documentation (documenter role)
• You have a specific bug to fix (fixer role)
```

See [Subagent Development Guide](./subagent-development.md) for more details on subagent usage.

### Task Auto-Tracking

The conversation manager can automatically detect and track tasks:

**Patterns Detected:**
- Task creation: "need to implement", "should create", "will build", "task:", "[task]"
- Completion: "done", "completed", "finished", "[x]", "[✓]"
- Blocking: "blocked", "stuck", "can't", "unable to", "error", "waiting for"
- Priority: "urgent", "critical", "important" (high); "maybe", "someday", "nice to have" (low)

**Example:**
```bash
You: I need to implement authentication and then create a user profile page
[Task] Auto-tracked: Implement authentication...
[Task] Auto-tracked: Create a user profile page

You: The authentication is done now
[Task] ✓ Completed: Implement authentication

You: I'm blocked on the profile page, need database access
[Task] ⚠ Blocked: Create a user profile page
```

### Files

- `src/tools/task-management-tool.ts` - Task management tools implementation
- `src/agent/planning-validator.ts` - Planning validation logic
- `src/agent/loop.ts` - Integration with agentic loop
- `src/agent/index.ts` - Agent integration
- `src/memory/types.ts` - Task type definitions

---

## User Interruptions and Session Management

### Pause and Resume

The agent can be paused during execution and resumed later.

**Implementation:** `src/cli/commands/chat.ts`

**Key Features:**
- SIGINT (Ctrl+C) handler to pause agent
- `agentPaused` flag to track pause state
- `/resume` command to resume a paused agent
- Shows pause indicator when agent is paused
- Double Ctrl+C to force exit

**Usage:**
```bash
$ copilot-cli chat
You: Implement a user authentication system
🤖 Assistant: I'll help you implement authentication...
[Ctrl+C pressed]
⏸️  Agent paused. Press Enter to continue or type a new message.

You: /resume
▶️  Agent resumed
```

**Technical Details:**
```typescript
// In src/cli/commands/chat.ts
rl.on('SIGINT', () => {
  if (this.agentPaused) {
    // Double Ctrl+C - force exit
    console.log('\n👋 Goodbye!');
    process.exit(0);
  } else {
    // Single Ctrl+C - pause
    this.agentPaused = true;
    console.log('\n⏸️  Agent paused. Press Enter to continue or type a new message.');
    rl.pause();
  }
});
```

### New Session Command

The `/new-session` command starts a fresh session.

**Implementation:** `src/cli/commands/chat.ts`

**Behavior:**
- Saves current session before clearing
- Clears agent conversation
- Resets session manager's current session

**Usage:**
```bash
You: /new-session
💾 Session saved as "session-2025-01-16-14-30.json"
✨ New session started
```

---

## Task Display UI

### Overview

The task display UI provides a visual representation of tasks at the bottom of the CLI interface.

**File:** `src/cli/ui/task-display.ts`

### Features

- **Tree Structure:** Hierarchical tasks with parent-child relationships
- **Focus on Current Branch:** Shows current task's branch in detail
- **Other Roots Collapsed:** Shows other task roots but not their children
- **Status Indicators:**
  - ✓ (completed)
  - ● (in progress)
  - ○ (pending)
  - ⚠ (blocked)
- **Progress Bars:** For tasks with percentage completion
- **Priority Colors:**
  - Red (high)
  - Yellow (medium)
  - Gray (low)
- **Configurable Max Height:** Prevents UI from taking too much space
- **Header with Stats:** Shows task counts and status breakdown

### Example Display

```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 Tracked Tasks                                                │
├─────────────────────────────────────────────────────────────────┤
│ ● In Progress:                                                  │
│   📍 Design API endpoints and data models (high)              │
│                                                                  │
│ ○ Pending:                                                      │
│   📍 Implement GET /todos endpoint (high)                     │
│   📍 Implement POST /todos endpoint (high)                    │
│   📍 Add authentication (medium)                              │
│                                                                  │
│ ✓ Completed (2):                                                │
│   ✅ Database schema                                            │
│   ✅ Auth middleware                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Details

```typescript
class TaskDisplay {
  constructor(
    private memoryStore: MemoryStore,
    private maxHeight?: number
  ) {}

  render(): string {
    // Get all tasks
    const tasks = this.memoryStore.getTasks();

    // Find current task root
    const currentTask = this.memoryStore.getCurrentTask();
    const currentRoot = this.findTaskRoot(currentTask?.id, tasks);

    // Group tasks by status
    const grouped = this.groupTasksByStatus(tasks);

    // Render header
    let output = this.renderHeader(grouped);

    // Render current root with children
    if (currentRoot) {
      output += this.renderCurrentBranch(currentRoot, tasks);
    }

    // Render other roots (collapsed)
    const otherRoots = grouped.roots.filter(r => r.id !== currentRoot?.id);
    output += this.renderOtherRoots(otherRoots);

    return output;
  }
}
```

### Commands

| Command | Description |
|----------|-------------|
| `/tasks` | Show task list with statuses |
| `/debt` | Show scaffolding debt |
| `/sessions` | Manage saved sessions |

---

## Memory Compression System

### Overview

The smart compressor intelligently reduces context size while preserving important information.

**File:** `src/memory/smart-compressor.ts`

### Compression Strategies

1. **Remove Low-Importance Messages**
   - Filters out noise and low-importance messages
   - Based on message metadata and content analysis

2. **Compress Code Blocks**
   - Extracts function signatures instead of full code
   - Preserves critical logic while reducing size

3. **Summarize Long Messages**
   - Uses LLM to summarize long messages (>500-1000 tokens)
   - Maintains semantic meaning while reducing size

4. **Merge Adjacent Tool Results**
   - Combines consecutive tool results
   - Reduces redundancy in tool output

5. **Archive Old Context**
   - Preserves important older messages in memory
   - Maintains continuity while reducing active context

### Configuration

```typescript
interface SmartCompressionConfig {
  targetTokens: number;          // Target token count after compression
  aggressiveMode: boolean;        // Enable aggressive compression
  semanticPreservation: boolean;  // Better semantic meaning preservation
}
```

### Result Information

```typescript
interface SmartCompressionResult {
  compressedMessages: ChatMessage[];
  compressionRatio: number;       // compressed / original
  strategiesUsed: string[];       // List of strategies applied
  archivedChunks: number;        // Number of chunks archived
}
```

### Usage Example

```typescript
const compressor = new SmartCompressor(memoryStore, {
  targetTokens: Math.floor(contextLimit * 0.5),
  aggressiveMode: true,
  semanticPreservation: true
});

const result = await compressor.compress(messages);

console.log(`Compressed: ${result.compressionRatio * 100}% of original`);
console.log(`Strategies used: ${result.strategiesUsed.join(', ')}`);
```

---

## Agentic Loop

### Overview

The agentic loop is the core execution engine that processes user messages and coordinates agent actions.

**File:** `src/agent/loop.ts`

### Loop Flow

```
User Message
  ↓
Validate Planning State
  ↓ (fails)
Display Validation Error
  ↓ (passes)
Inject Planning Reminders (first iteration)
  ↓
Inject Subagent Reminders (every 4 iterations)
  ↓
Process Message with Context
  ↓
Generate Response
  ↓
Update Budget Tracking
  ↓
Repeat
```

### Key Components

1. **Planning Validation**
   - Ensures agent has goal, tasks, and current task
   - Displays helpful error messages with suggestions
   - Prevents execution without proper planning

2. **Context Injection**
   - Injects planning reminders on first iteration
   - Injects subagent reminders periodically
   - Maintains relevant context throughout conversation

3. **Budget Tracking**
   - Tracks token usage after each response
   - Warns when approaching context limits
   - Triggers compression when needed

4. **Tool Execution**
   - Executes tools requested by LLM
   - Handles tool errors gracefully
   - Returns tool results to LLM

### Implementation Details

```typescript
async runIteration(iteration: number, userMessage: string): Promise<void> {
  // 1. Validate planning state
  const validation = this.planningValidator.validate();
  if (!validation.canProceed) {
    this.planningValidator.displayValidation();
    return;
  }

  // 2. Build messages with context
  let messages = this.buildMessages(userMessage);

  // 3. Inject reminders
  if (iteration === 1) {
    const planningReminders = this.planningValidator.buildPlanningReminders();
    messages = this.injectSystemMessage(messages, planningReminders);
  } else if (iteration % 4 === 0) {
    const subagentReminder = this.planningValidator.buildSubagentReminder(iteration);
    messages = this.injectSystemMessage(messages, subagentReminder);
  }

  // 4. Make LLM call
  const response = await this.llm.call(messages);

  // 5. Update budget tracking
  const usedTokens = response.usage.total_tokens;
  this.conversationManager.updateBudgetAfterResponse(usedTokens);

  // 6. Process any tool calls
  await this.processToolCalls(response.toolCalls);

  // 7. Display response
  this.displayResponse(response.content);
}
```

---

## Type System

### Task Types

```typescript
// Task status
type TaskStatus = 'active' | 'blocked' | 'waiting' | 'completed' | 'abandoned';

// Task priority
type TaskPriority = 'high' | 'medium' | 'low';

// Task interface
interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  updatedAt: Date;
  relatedToGoal: boolean;
  notes?: string;
  parentTaskId?: string;  // For hierarchical tasks
}
```

### Budget Types

```typescript
// Context budget allocation
interface ContextBudget {
  total: number;
  systemPrompt: number;
  goal: number;
  memory: number;
  workingState: number;
  conversationSummary: number;
  retrievedContext: number;
  recentMessages: number;
  scaffoldingReminder: number;
}
```

### Memory Types

```typescript
// Message types
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: Date;
  toolCallId?: string;
  metadata?: Record<string, any>;
}

// Working state
interface WorkingState {
  currentTask?: string;
  recentErrors?: Error[];
  activeFiles?: string[];
  inProgressOperations?: string[];
}

// Memory summary
interface MemorySummary {
  userPreferences?: Record<string, any>;
  projectContext?: string;
  decisions?: Decision[];
  activeFiles?: ActiveFile[];
}
```

### Subagent Types

```typescript
// Subagent role
type SubagentRole = 'investigator' | 'test-writer' | 'refactorer' | 'documenter' | 'fixer';

// Subagent configuration
interface SubagentConfig {
  task: string;
  role: SubagentRole;
  files?: string[];
  maxIterations?: number;
  tokenBudget?: number;
  background?: boolean;
  wait?: boolean;
}

// Subagent progress
interface SubagentProgress {
  agentId: string;
  name: string;
  iteration: number;
  maxIterations: number;
  status: 'running' | 'completed' | 'failed';
}
```

---

## Build and Testing

### Build

```bash
npm run build
```

The build process compiles TypeScript and checks for type errors. All changes should pass the build before being committed.

### Type Safety

- All budget-related functions return consistent `ContextBudget` type
- No `as any` assertions for budget-related code
- Proper type inference throughout
- Explicit type annotations for public interfaces

### Testing Strategy

1. **Unit Tests:** Test individual functions and classes
2. **Integration Tests:** Test component interactions
3. **E2E Tests:** Test full conversation flows
4. **Type Checking:** Use TypeScript compiler as test

### Test Coverage

Key areas to test:
- Task management tools
- Planning validator logic
- Budget calculations and adjustments
- Compression strategies
- Agentic loop flow
- Context injection

---

## Best Practices

### Task Management

1. **Always create a plan before working**
   - Use `create_task` to break down goals
   - Use `set_current_task` to focus on one task
   - Use `update_task_status` to track progress

2. **Keep tasks specific and actionable**
   - Bad: "Fix the code"
   - Good: "Fix the null pointer exception in the login function"

3. **Update task status regularly**
   - Mark tasks as `active` when starting work
   - Mark tasks as `completed` when done
   - Mark tasks as `blocked` when stuck

4. **Use appropriate priorities**
   - `high`: Blocking issues, critical bugs, user-facing features
   - `medium`: Improvements, non-critical bugs
   - `low`: Nice-to-haves, future enhancements

### Budget Management

1. **Always use a buffer**
   ```typescript
   const maxContext = getModelContextLimit(model);
   const budgetTotal = Math.floor(maxContext * 0.8); // 20% buffer
   ```

2. **Monitor usage proactively**
   ```typescript
   if (usage.remainingTokens < budget.total * 0.3) {
     await compress();
   }
   ```

3. **Adjust budgets when switching models**
   ```typescript
   this.currentBudget = adjustBudgetForTotal(
     this.currentBudget,
     Math.floor(newLimit * 0.8)
   );
   ```

### Subagent Usage

1. **Use for focused, specific tasks**
   - Writing tests for multiple files in parallel
   - Investigating bugs in specific components
   - Refactoring individual modules

2. **Provide minimal, focused context**
   - Use `extract_focus` to create bounded context
   - Don't pass entire conversation history

3. **Use background mode for parallel tasks**
   ```typescript
   spawn_agent(task="Write tests for A", background=true)
   spawn_agent(task="Write tests for B", background=true)
   wait_agent("agent_1")
   wait_agent("agent_2")
   ```

### Memory Management

1. **Compress before context gets too large**
   ```typescript
   if (contextSize > threshold) {
     await this.trimHistory();
   }
   ```

2. **Use appropriate compression strategies**
   - Aggressive mode for large contexts
   - Semantic preservation for complex tasks

3. **Balance memory vs. history**
   - More memory: Better persistence of facts
   - More summary: Better continuity of conversation

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Commands   │  │     UI       │  │  User Input  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      Agent Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │     Loop     │  │   Validator  │  │ Conversation │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Subagents   │  │    Tools     │  │   Manager    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Services Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Memory     │  │   Context    │  │   Budget     │      │
│  │    Store     │  │   Manager    │  │   System     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Compressor   │  │  Token Est.  │  │   Sessions   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    External Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │     LLM      │  │  File System │  │  Repository  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Input → CLI Layer**
   - Commands parsed and validated
   - UI components render output

2. **CLI → Agent Layer**
   - Agent loop processes requests
   - Planning validator ensures structure
   - Subagents handle focused tasks

3. **Agent → Services Layer**
   - Memory stores persistent context
   - Context manager tracks tokens
   - Budget system allocates resources

4. **Services → External Services**
   - LLM generates responses
   - File system reads/writes code
   - Repository manages sessions

---

## Performance Considerations

### Memory

- Validation checks are O(n) over tasks array
- Reminders injected only on first iteration or every 4th iteration
- Minimal memory overhead (~1KB for validator state)

### CPU

- Compression uses LLM for summarization (expensive)
- Token estimation uses approximation (fast)
- Budget calculations are simple arithmetic (very fast)

### I/O

- No additional file operations for planning system
- Subagents spawn new processes (isolated)
- Memory persistence on session save/load

---

## Security Considerations

### Input Validation

- All user input parsed through structured tools
- No arbitrary code execution
- File operations limited to workspace

### Subagent Isolation

- Subagents run in separate processes
- Context is explicitly bounded
- No shared memory between subagents

### Token Limits

- Budget system prevents context overflow
- 20% buffer for estimation errors
- Explicit limits on subagent budgets

---

## Debugging

### Enable Debug Logging

```bash
DEBUG_BUDGET=1 npm start
```

### Common Issues

**Problem:** Planning validation fails unexpectedly
- **Solution:** Check that goal is set and tasks are created

**Problem:** Context overflow errors
- **Solution:** Enable aggressive compression or increase buffer

**Problem:** Subagent not completing
- **Solution:** Check subagent max iterations and token budget

**Problem:** Task status not updating
- **Solution:** Verify task ID is correct and exists in memory

---

## See Also

- [Context Budget System](./context-budget.md) - Token allocation details
- [Subagent Quick Reference](./subagent-quick-reference.md) - Subagent usage patterns
- [Subagent Development Guide](./subagent-development.md) - Subagent implementation
- [Task Planning Guide](../TASK_PLANNING_GUIDE.md) - User-facing task guide
- [Mandatory Delegation](./mandatory-delegation.md) - Mandatory delegation patterns