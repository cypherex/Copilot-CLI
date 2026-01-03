# Validators

This directory contains validators for the copilot-cli agent system.

## CompletionWorkflowValidator

Validates task completion workflow and provides guidance for next steps.

### Features

- **Workflow Analysis**: Uses LLM to analyze task dependencies and determine logical next task
- **Integration Detection**: Identifies when next task has dependencies on completed task files
- **Complexity Detection**: Warns when next task is complex and should be broken down
- **Fallback Strategy**: Gracefully handles LLM failures with priority-based task selection
- **Task Hierarchy Visualization**: Includes parent-child task relationships in analysis

### Usage

```typescript
import { CompletionWorkflowValidator } from './validators';
import type { LLMClient } from './llm/types';
import type { Task } from './memory/types';

const validator = new CompletionWorkflowValidator(llmClient);

const result = await validator.validateCompletion({
  completedTask: task,
  allTasks: tasks,
  completedTaskFiles: ['src/auth/login.ts', 'src/auth/session.ts']
});

if (!result.allowed) {
  console.error('Completion blocked:', result.blockReason);
} else {
  if (result.warnings) {
    result.warnings.forEach(w => console.warn(w));
  }
  if (result.suggestions) {
    result.suggestions.forEach(s => console.log(s));
  }
}
```

### Validation Logic

1. **Workflow Analysis**: Makes separate LLM call to analyze:
   - Just completed task and its files
   - Previously completed tasks
   - Remaining tasks with their status and dependencies
   - Task hierarchy (parent-child relationships)

2. **Next Task Validation**:
   - If no next task identified but tasks remain → BLOCK
   - If next task needs breakdown → WARN with breakdown suggestion
   - If next task has integration dependencies → WARN with files to review
   - Suggests which completed tasks to review before starting

3. **Fallback**: On LLM failure, selects next task by priority

### Interfaces

```typescript
interface CompletionValidationContext {
  completedTask: Task;
  allTasks: Task[];
  completedTaskFiles: string[];
}

interface CompletionValidationResult {
  allowed: boolean;
  blockReason?: string;
  warnings?: string[];
  suggestions?: string[];
}

interface WorkflowAnalysis {
  nextTask?: NextTaskAnalysis;
  workflowContinuity: {
    hasLogicalNext: boolean;
    reason: string;
  };
}

interface NextTaskAnalysis {
  nextTaskId?: string;
  nextTaskDescription?: string;
  needsBreakdown: boolean;
  breakdownReason?: string;
  hasIntegrationDependencies: boolean;
  integrationFiles?: string[];
  reviewTasks?: Array<{
    taskId: string;
    description: string;
    reason: string;
  }>;
}
```

### Testing

Run tests with:

```bash
npm test src/validators/completion-workflow-validator.test.ts
```

The test suite covers:
- Successful next task identification
- Blocking when workflow unclear
- Breakdown warnings for complex tasks
- Integration dependency detection
- Graceful LLM failure handling
- Task hierarchy context inclusion

## SpawnValidator

Validates subagent spawn requests and enforces task breakdown for complex tasks.

### Purpose

Prevents spawning subagents for overly complex tasks that should be broken down first. This ensures:
- Better task management and tracking
- Clearer delegation boundaries
- More focused subagent execution
- Improved overall system organization

### Key Features

1. **Complexity Assessment**: Uses LLM to analyze task complexity based on:
   - Number of files involved
   - Estimated functions/methods
   - Lines of code
   - Integration points
   - Sequential steps required
   - Coordination needs

2. **Breakdown Decision**: Uses LLM with full task context to determine if breakdown is required

3. **Parent Task Bypass**: Subtasks (with `parent_task_id`) skip complexity validation

4. **Structured Output**: Returns clear validation results with:
   - Allowed/blocked status
   - Complexity assessment
   - Breakdown decision
   - Suggested subtasks
   - Integration considerations
   - User-facing error messages

### Usage

```typescript
import { SpawnValidator } from './validators';
import type { LLMClient } from './llm/types';
import type { MemoryStore } from './memory/types';

// Create validator
const validator = new SpawnValidator(llmClient);

// Validate spawn request
const result = await validator.validateSpawn({
  task: 'Implement authentication system',
  parent_task_id: undefined, // Optional - bypasses validation if provided
  memoryStore,
});

if (!result.allowed) {
  if (result.requiresBreakdown) {
    // Show breakdown message to user
    console.log(result.suggestedMessage);
  } else {
    // Other validation failure
    console.log(result.reason);
  }
} else {
  // Proceed with spawn
  console.log('Validation passed');
}
```

### Complexity Ratings

- **Simple**: Single file, 1-2 functions, <50 lines, no integration, 1-2 steps
- **Moderate**: 2-3 files, 2-5 functions, 50-200 lines, minimal integration, 3-5 steps
- **Complex**: 4+ files, 6+ functions, 200+ lines, multiple integrations, 6+ steps

### Breakdown Guidelines

Breakdown is **required** when:
- Task involves 4+ files
- Task has 6+ distinct steps
- Task requires coordination between multiple components
- Task description uses macro-level language ("implement system", "build feature")

Breakdown is **not required** when:
- Task is well-scoped despite complexity
- Task is a single cohesive unit of work
- Breaking down would create artificial boundaries
- Task already has a parent_task_id (is a subtask)

### Testing

Run tests with:

```bash
npm test src/validators/spawn-validator.test.ts
```

See `spawn-validator.example.ts` for more usage examples.

### Interfaces

```typescript
interface SpawnValidationContext {
  task: string;
  name?: string;
  role?: string;
  files?: string[];
  success_criteria?: string;
  parent_task_id?: string;
  memoryStore: MemoryStore;
}

interface SpawnValidationResult {
  allowed: boolean;
  reason?: string;
  requiresBreakdown: boolean;
  complexity?: ComplexityAssessment;
  breakdownDecision?: BreakdownDecision;
  suggestedMessage?: string;
}

interface ComplexityAssessment {
  rating: 'simple' | 'moderate' | 'complex';
  evidence: {
    filesCount?: number;
    functionsEstimate?: number;
    linesEstimate?: number;
    integrationPoints?: string[];
    hasMultipleSteps: boolean;
    requiresCoordination: boolean;
  };
  reasoning: string;
}

interface BreakdownDecision {
  required: boolean;
  reasoning: string;
  suggestedSubtasks: string[];
  integrationConsiderations: string[];
}
```
