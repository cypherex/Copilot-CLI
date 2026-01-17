// Task Management Tools - explicit task tracking and planning tools

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import { getNextTasks } from './get-next-tasks.js';
import type { ToolDefinition, ToolExecutionContext } from './types.js';
import type { MemoryStore, Task, TrackingItem } from '../memory/types.js';
import { uiState } from '../ui/ui-state.js';
import type { CompletionWorkflowValidator } from '../validators/completion-workflow-validator.js';
import type { SpawnValidator } from '../validators/spawn-validator.js';

// Schema for create_task
const CreateTaskSchema = z.object({
  description: z.string().describe('Task description'),
  priority: z.enum(['high', 'medium', 'low']).optional().describe('Task priority'),
  related_to_goal: z.boolean().optional().default(true).describe('Whether this task is related to the main goal'),
  parent_id: z.string().optional().describe('Parent task ID if this is a subtask'),
});

// Schema for update_task_status
const UpdateTaskStatusSchema = z.object({
  task_id: z.string().describe('The ID of the task to update'),
  status: z.enum(['active', 'blocked', 'waiting', 'pending_verification', 'completed', 'abandoned']).describe('New status'),
  notes: z.string().optional().describe('Optional notes about the status change'),
  completion_message: z.string().optional().describe('REQUIRED when status is "completed": Summary of what was accomplished (files created/modified, functions implemented, etc.)'),
});

// Schema for set_current_task
const SetCurrentTaskSchema = z.object({
  task_id: z.string().describe('The ID of the task to set as current'),
});

// Schema for list_tasks
const ListTasksSchema = z.object({
  status: z.enum(['all', 'active', 'waiting', 'pending_verification', 'completed', 'blocked', 'abandoned']).optional().default('all').describe('Filter by status'),
});

// Schema for get_next_tasks
const GetNextTasksSchema = z.object({
  max_tasks: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1)
    .describe('Maximum number of tasks to return (default: 1, max: 10)'),
  include_parallel: z
    .boolean()
    .optional()
    .default(false)
    .describe('Return multiple independent tasks for parallel execution'),
});

// Schema for list_subtasks
const ListSubtasksSchema = z.object({
  task_id: z.string().describe('Parent task ID to list subtasks for'),
  include_nested: z.boolean().optional().default(false).describe('Include nested subtasks (grandchildren, etc.)'),
});

// Schema for break_down_task
const BreakDownTaskSchema = z.object({
  task_id: z.string().describe('Task ID to break down into subtasks'),
  subtasks: z.array(z.object({
    description: z.string().describe('Subtask description'),
    priority: z.enum(['high', 'medium', 'low']).optional().describe('Subtask priority'),
  })).min(2).max(25).describe('Array of subtasks to create (2-25 subtasks recommended)'),
});

// Schema for debug_scaffold
const DebugScaffoldSchema = z.object({
  bug: z.string().describe('Bug report / debugging goal (what is wrong, where, and what expected behavior is)'),
  parent_task_id: z.string().optional().describe('Optional parent task ID to attach this debug workflow under'),
  priority: z.enum(['high', 'medium', 'low']).optional().default('high').describe('Priority for the root debug task'),
  related_files: z.array(z.string()).optional().describe('Optional relevant files'),
  experiments: z.number().int().min(1).max(5).optional().default(1).describe('How many hypothesis/experiment pairs to scaffold (default: 1)'),
  set_current_to_repro: z.boolean().optional().default(true).describe('Set the Repro task as current and active (default: true)'),
  include_regression_test_task: z.boolean().optional().default(true).describe('Include a task to add/adjust regression tests (default: true)'),
});

// Schema for record_experiment_result
const RecordExperimentResultSchema = z.object({
  task_id: z.string().optional().describe('Task ID to record against (defaults to current task)'),
  title: z.string().optional().describe('Short title for this experiment note'),
  hypothesis: z.string().optional().describe('Hypothesis being tested'),
  prediction: z.string().optional().describe('Predicted observation if hypothesis is true'),
  steps: z.array(z.string()).optional().describe('Exact steps/commands run'),
  observed: z.string().optional().describe('What actually happened (key output, behavior, stack trace summary)'),
  conclusion: z.enum(['supports', 'refutes', 'inconclusive']).describe('Whether the result supports the hypothesis'),
  next_step: z.string().optional().describe('What to do next based on the conclusion'),
  status: z.enum(['active', 'blocked', 'waiting', 'pending_verification', 'completed']).optional()
    .describe('Optional task status to set after recording'),
  blocked_by: z.string().optional().describe('If status=blocked, what is blocking'),
  waiting_for: z.string().optional().describe('If status=waiting, what is needed'),
  create_followup_task: z.boolean().optional().default(false).describe('Create a follow-up task (default: false)'),
  followup_description: z.string().optional().describe('Description for the follow-up task'),
  followup_priority: z.enum(['high', 'medium', 'low']).optional().default('medium').describe('Priority for follow-up task'),
  followup_parent_task_id: z.string().optional().describe('Parent task for follow-up (defaults to same parent as task_id, else root debug task)'),
});

export class CreateTaskTool extends BaseTool {
  private spawnValidator?: SpawnValidator;

  readonly definition: ToolDefinition = {
    name: 'create_task',
    description: `Create a new task in the task list.

Use this when:
- You're planning work and need to break down a goal into tasks
- You identify a new task that needs to be done
- You want to explicitly track a piece of work

Tasks should be specific, actionable, and measurable.

For hierarchical tasks:
- Use parent_id to create subtasks under a parent task
- Break complex tasks into smaller, focused subtasks
- Aim for 3-7 subtasks per parent for manageable scope

IMPORTANT: Tasks that are too complex will be rejected. Use break_down_task to decompose large tasks into smaller, focused subtasks before creating them.`,
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Task description - be specific and actionable',
        },
        priority: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Task priority',
        },
        related_to_goal: {
          type: 'boolean',
          description: 'Whether this task is related to the main goal',
        },
        parent_id: {
          type: 'string',
          description: 'Parent task ID if this is a subtask - creates hierarchical task breakdown',
        },
      },
      required: ['description'],
    },
  };

  protected readonly schema = CreateTaskSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  setValidator(validator: SpawnValidator): void {
    this.spawnValidator = validator;
  }

  protected async executeInternal(args: z.infer<typeof CreateTaskSchema>, context?: ToolExecutionContext): Promise<string> {
    const { description, priority, related_to_goal, parent_id } = args;

    // Validate parent exists if parent_id provided
    if (parent_id) {
      const parent = this.memoryStore.getTasks().find(t => t.id === parent_id);
      if (!parent) {
        throw new Error(`Parent task not found: ${parent_id}`);
      }
    }

    // Extract conversation context if available
    let additionalContext: string | undefined;
    if (context?.conversation) {
      const recentMessages = context.conversation.getMessages()
        .slice(-6) // Last few messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : '[Complex Content]'}`)
        .join('\n');
      
      if (recentMessages) {
        additionalContext = `Recent Conversation:\n${recentMessages}`;
      }
    }

    // Validate task complexity (same as spawn validation)
    // In eval/judge mode we avoid validator-driven failures (toolErrors) and extra LLM calls.
    const mode = context?.toolPolicy?.mode;
    const spawnValidator = this.spawnValidator;
    const shouldValidateComplexity = spawnValidator && mode !== 'eval' && mode !== 'judge';
    if (shouldValidateComplexity) {
      const validationResult = await spawnValidator.validateSpawn({
        task: description,
        parent_task_id: parent_id,
        memoryStore: this.memoryStore,
        additionalContext,
        // Keep task creation fast + reliable (no auto-breakdown side effects)
        useRecursiveBreakdown: false,
        maxBreakdownDepth: 2,
        verbose: false,
      });

      const needsBreakdown = !validationResult.allowed && validationResult.requiresBreakdown;

      // Display complexity warning if task is complex but allowed
      if (validationResult.complexity && validationResult.complexity.rating === 'complex') {
        uiState.addMessage({
          role: 'system',
          content: `⚠️  Complex task created (${validationResult.complexity.rating}): ${validationResult.complexity.reasoning}`,
          timestamp: Date.now(),
        });
      }

      if (needsBreakdown) {
        uiState.addMessage({
          role: 'system',
          content: validationResult.suggestedMessage || validationResult.reason ||
            'Task looks complex. Consider break_down_task() before delegating.',
          timestamp: Date.now(),
        });
      }
    }

    const task = this.memoryStore.addTask({
      description,
      status: 'waiting',
      priority: priority || 'medium',
      relatedToGoal: related_to_goal,
      relatedFiles: [], // Required by Task interface
      parentId: parent_id,
    });

    let message = `Created task: ${description}\n  Task ID: ${task.id}\n  Priority: ${task.priority}\n  Status: ${task.status}`;
    if (parent_id) {
      const parent = this.memoryStore.getTasks().find(t => t.id === parent_id);
      message += `\n  Parent: ${parent?.description || parent_id}`;
    }

    return message;
  }
}

export class UpdateTaskStatusTool extends BaseTool {
  private completionValidator?: CompletionWorkflowValidator;

  readonly definition: ToolDefinition = {
    name: 'update_task_status',
    description: `Update the status of a task.

Use this to:
- Mark a task as active when you start working on it
- Mark a task as completed when you finish it
- Mark a task as blocked if you encounter issues
- Mark a task as waiting if you need user input

Always update task status as you work to track progress.

Completion workflow:
- When you're done implementing, set status to "pending_verification"
- Run verification (build/test/lint), fix any failures, then set status to "completed"

IMPORTANT: When marking a task as "completed", you MUST provide a completion_message summarizing:
- What was accomplished
- Files created or modified (with specific filenames)
- Functions/classes implemented
- Any key decisions made

Note: Task completion is validated to ensure proper workflow and next step planning.`,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        status: {
          type: 'string',
          enum: ['active', 'blocked', 'waiting', 'pending_verification', 'completed', 'abandoned'],
          description: 'New status',
        },
        notes: {
          type: 'string',
          description: 'Optional notes about the status change',
        },
        completion_message: {
          type: 'string',
          description: 'REQUIRED when status is "completed": Summary of what was accomplished (files created/modified, functions implemented, etc.)',
        },
      },
      required: ['task_id', 'status'],
    },
  };

  protected readonly schema = UpdateTaskStatusSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  setValidator(validator: CompletionWorkflowValidator): void {
    this.completionValidator = validator;
  }

  protected async executeInternal(
    args: z.infer<typeof UpdateTaskStatusSchema>,
    context?: ToolExecutionContext
  ): Promise<string> {
    const { task_id, status, notes, completion_message } = args;

    const mode = context?.toolPolicy?.mode;
    const strictCompletionWorkflow =
      String(process.env.COPILOT_CLI_STRICT_COMPLETION ?? '').trim() === '1' ||
      String(process.env.COPILOT_CLI_STRICT_VERIFY ?? '').trim() === '1';
    const relaxCompletionWorkflow = (mode === 'eval' || mode === 'judge') && !strictCompletionWorkflow;
    const warnings: string[] = [];

    const hasBuildOrTestCommand = (commands: string[] | undefined): boolean => {
      const joined = (commands ?? []).join('\n').toLowerCase();
      return (
        joined.includes('npm test') ||
        joined.includes('npm run build') ||
        joined.includes('pnpm test') ||
        joined.includes('pnpm run build') ||
        joined.includes('yarn test') ||
        joined.includes('yarn build') ||
        joined.includes('tsc ') ||
        joined.includes('pytest')
      );
    };

    const task = this.memoryStore.getTasks().find((t: any) => t.id === task_id);
    if (!task) {
      throw new Error(`Task not found: ${task_id}`);
    }

    // Capture whether this task had file edits recorded in working state (used for verification gating)
    const workingStateForVerification = this.memoryStore.getWorkingState();
    const relatedEditsForVerification = workingStateForVerification.editHistory.filter(
      (edit: any) => edit.relatedTaskId === task_id
    );
    const hasRecordedEdits = relatedEditsForVerification.length > 0;

    // VALIDATION: Require completion_message when marking as completed
    if (status === 'completed' && !completion_message) {
      throw new Error('completion_message is required when marking a task as completed. Provide a summary of what was accomplished (files created/modified, functions implemented, etc.)');
    }

    // VALIDATION: Enforce pending_verification -> completed workflow
    if (status === 'completed' && task.status !== 'pending_verification') {
      if (relaxCompletionWorkflow) {
        warnings.push(
          `Completion workflow relaxed in ${mode} mode: allowing transition ${task.status} -> completed without pending_verification.`
        );
      } else {
        throw new Error(
          `To mark a task completed, it must transition from "pending_verification" -> "completed". ` +
            `Set status to "pending_verification", run verification (build/test/lint), fix any errors, then mark it "completed" with completion_message.`
        );
      }
    }

    // VALIDATION: Require a passing verification run after entering pending_verification (for tasks with recorded edits)
    // When strict completion is enabled, require verification even if edits were not recorded.
    const requireVerification = hasRecordedEdits || strictCompletionWorkflow;
    if (status === 'completed' && requireVerification) {
      const verification = workingStateForVerification.lastVerification;
      if (!verification) {
        if (relaxCompletionWorkflow) {
          warnings.push(
            `Verification gating relaxed in ${mode} mode: no verify_project run recorded for this session.`
          );
        } else {
          throw new Error(
            `Cannot mark task completed: no verification run recorded for this session. ` +
              `Run verify_project({ commands: [...] }) after setting status to "pending_verification".`
          );
        }
      }
      if (verification && !verification.passed) {
        if (relaxCompletionWorkflow) {
          warnings.push(`Verification gating relaxed in ${mode} mode: last verify_project failed.`);
        } else {
          throw new Error(
            `Cannot mark task completed: last verification failed. ` +
              `Fix failures and re-run verify_project({ commands: [...] }).`
          );
        }
      }

      if (verification && verification.passed && strictCompletionWorkflow && !hasBuildOrTestCommand(verification.commands)) {
        throw new Error(
          `Cannot mark task completed: strict verification is enabled but the last verify_project commands did not include a build/test command. ` +
            `Re-run verify_project({ commands: ["npm run build", "npm test"] }) (or equivalent) before completing.`
        );
      }

      if (verification) {
        const pendingAt = task.pendingVerificationAt ? new Date(task.pendingVerificationAt).getTime() : task.updatedAt.getTime();
        const verifiedAt = new Date(verification.finishedAt).getTime();
        if (verifiedAt < pendingAt) {
          if (relaxCompletionWorkflow) {
            warnings.push(
              `Verification gating relaxed in ${mode} mode: verification is older than pending_verification transition.`
            );
          } else {
            throw new Error(
              `Cannot mark task completed: verification is older than the task's pending_verification transition. ` +
                `Re-run verify_project({ commands: [...] }) after setting status to "pending_verification".`
            );
          }
        }
      }
    }

    // VALIDATION: Check if completion should be allowed
    if (status === 'completed' && this.completionValidator) {
      if (relaxCompletionWorkflow) {
        warnings.push(`Completion validator skipped in ${mode} mode.`);
      } else {
      const allTasks = this.memoryStore.getTasks();
      const workingState = this.memoryStore.getWorkingState();

      // Get files modified during this task
      const relatedEdits = workingState.editHistory.filter(
        edit => edit.relatedTaskId === task_id
      );
      const completedTaskFiles = Array.from(new Set(relatedEdits.map(edit => edit.file)));

      const validationResult = await this.completionValidator.validateCompletion({
        completedTask: task,
        allTasks,
        completedTaskFiles,
      });

      // If not allowed (blocked), throw error
      if (!validationResult.allowed) {
        throw new Error(validationResult.blockReason || 'Completion validation failed');
      }

      // Display warnings
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        const warningMessage = [
          '⚠️  Completion Warnings:',
          ...validationResult.warnings.map((w: string) => `  • ${w}`),
        ].join('\n');

        uiState.addMessage({
          role: 'system',
          content: warningMessage,
          timestamp: Date.now(),
        });
      }

      // Display suggestions
      if (validationResult.suggestions && validationResult.suggestions.length > 0) {
        const suggestionMessage = [
          '📋 Next Steps:',
          ...validationResult.suggestions.map((s: string) => `  • ${s}`),
        ].join('\n');

        uiState.addMessage({
          role: 'system',
          content: suggestionMessage,
          timestamp: Date.now(),
        });
      }

      // Update task with completion data
      this.memoryStore.updateTask(task_id, {
        status,
        updatedAt: new Date(),
        completedAt: new Date(),
        completionMessage: completion_message,
        filesModified: completedTaskFiles.length > 0 ? completedTaskFiles : undefined,
      });

      // Build enhanced completion response
      let message = `✓ Completed task: "${task.description}"`;
      if (completion_message) {
        message += `\n  Summary: ${completion_message}`;
      }
      if (notes) {
        message += `\n  Notes: ${notes}`;
      }

      if (completedTaskFiles.length > 0) {
        message += `\n  Files modified: ${completedTaskFiles.join(', ')}`;
      }

      return message;
      }
    }

    // Non-completion status update (no validation needed)
    const updates: Partial<Task> = { status, updatedAt: new Date() };

    if (status === 'pending_verification') {
      updates.pendingVerificationAt = new Date();
    }

    // For completion without validator, still populate filesModified and completionMessage
    if (status === 'completed') {
      const workingState = this.memoryStore.getWorkingState();
      const relatedEdits = workingState.editHistory.filter(
        edit => edit.relatedTaskId === task_id
      );

      if (relatedEdits.length > 0) {
        updates.filesModified = Array.from(
          new Set(relatedEdits.map(edit => edit.file))
        );
      }
      updates.completedAt = new Date();
      updates.completionMessage = completion_message;
    }

    this.memoryStore.updateTask(task_id, updates);

    let message = `Updated task "${task.description}": ${task.status} → ${status}`;
    if (warnings.length > 0) {
      message += `\n  Warnings:\n${warnings.map(w => `  - ${w}`).join('\n')}`;
    }
    if (completion_message) {
      message += `\n  Summary: ${completion_message}`;
    }
    if (notes) {
      message += `\n  Notes: ${notes}`;
    }

    // Show files modified when marking as completed
    if (status === 'completed' && updates.filesModified && updates.filesModified.length > 0) {
      message += `\n  Files modified: ${updates.filesModified.join(', ')}`;
    }

    return message;
  }
}

export class SetCurrentTaskTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'set_current_task',
    description: `Set a task as the current active task.

Use this to:
- Focus on a specific task
- Switch between tasks
- Maintain context about what you're currently working on

**IMPORTANT**: Prioritize LEAF tasks (tasks with no subtasks) first!
- Work on tasks that have no child tasks before working on parent tasks
- Parent/container tasks are organizational - work on the concrete leaf tasks
- Use list_subtasks to check if a task has children before selecting it
- If a task has subtasks, work on those subtasks first

You should always have a current task set when actively working.`,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The ID of the task to set as current',
        },
      },
      required: ['task_id'],
    },
  };

  protected readonly schema = SetCurrentTaskSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof SetCurrentTaskSchema>): Promise<string> {
    const { task_id } = args;

    const task = this.memoryStore.getTasks().find((t) => t.id === task_id);
    if (!task) {
      throw new Error(`Task not found: ${task_id}`);
    }

    // Update working state to set current task
    this.memoryStore.updateWorkingState({
      currentTask: task_id,
      lastUpdated: new Date(),
    });

    return `Current task set to: ${task.description}\n  Task ID: ${task.id}\n  Status: ${task.status}`;
  }
}

export class ListTasksTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'list_tasks',
    description: `List all tasks, optionally filtered by status.

Use this to:
- Review the current task list
- Check on waiting or blocked tasks
- See overall progress

Always review the task list before starting new work.`,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'active', 'waiting', 'pending_verification', 'completed', 'blocked', 'abandoned'],
          description: 'Filter by status (default: all)',
        },
      },
      required: [],
    },
  };

  protected readonly schema = ListTasksSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof ListTasksSchema>): Promise<string> {
    const { status } = args;

    let tasks = this.memoryStore.getTasks();

    if (status !== 'all') {
      tasks = tasks.filter(t => t.status === status);
    }

    if (tasks.length === 0) {
      return `No tasks found${status !== 'all' ? ` with status: ${status}` : ''}`;
    }

    // Separate top-level tasks (no parent) from subtasks
    const topLevelTasks = tasks.filter(t => !t.parentId);
    const allTasks = this.memoryStore.getTasks(); // Get all tasks for hierarchy lookup

    const lines = [`Tasks (${status}):\n`];

    // Helper to render a task and its children
    const renderTaskHierarchy = (task: Task, depth: number = 0) => {
      const indent = '  '.repeat(depth + 1);
      const statusIcon = task.status === 'completed' ? '✓' :
                         task.status === 'active' ? '●' :
                         task.status === 'pending_verification' ? '⧗' :
                         task.status === 'blocked' ? '⚠' : '○';
      const priority = task.priority === 'high' ? ' [HIGH]' :
                      task.priority === 'medium' ? ' [MED]' :
                      task.priority === 'low' ? ' [LOW]' : '';

      lines.push(`${indent}${statusIcon} ${task.description}${priority}`);
      lines.push(`${indent}  ID: ${task.id} | Status: ${task.status}`);

      // Show completion message for completed tasks
      if (task.status === 'completed' && task.completionMessage) {
        lines.push(`${indent}  ✓ ${task.completionMessage}`);
      }

      // Find and render children (if any)
      const children = allTasks.filter(t => t.parentId === task.id);
      if (children.length > 0) {
        const filteredChildren = status === 'all'
          ? children
          : children.filter(c => c.status === status);

        for (const child of filteredChildren) {
          renderTaskHierarchy(child, depth + 1);
        }
      }
    };

    // Group top-level tasks by status for better readability
    const waiting = topLevelTasks.filter(t => t.status === 'waiting');
    const active = topLevelTasks.filter(t => t.status === 'active');
    const pendingVerification = topLevelTasks.filter(t => t.status === 'pending_verification');
    const blocked = topLevelTasks.filter(t => t.status === 'blocked');
    const completed = topLevelTasks.filter(t => t.status === 'completed');

    if (waiting.length > 0) {
      lines.push('  Waiting:');
      for (const task of waiting) {
        renderTaskHierarchy(task, 1);
      }
    }

    if (active.length > 0) {
      lines.push('  Active:');
      for (const task of active) {
        renderTaskHierarchy(task, 1);
      }
    }

    if (pendingVerification.length > 0) {
      lines.push('  Pending verification:');
      for (const task of pendingVerification) {
        renderTaskHierarchy(task, 1);
      }
    }

    if (blocked.length > 0) {
      lines.push('  Blocked:');
      for (const task of blocked) {
        renderTaskHierarchy(task, 1);
      }
    }

    if (completed.length > 0 && status === 'all') {
      lines.push('  Completed:');
      for (const task of completed) {
        renderTaskHierarchy(task, 1);
      }
    }

    // Add hierarchical summary
    const totalTasks = tasks.length;
    const topLevel = topLevelTasks.length;
    const subtasks = totalTasks - topLevel;

    if (subtasks > 0) {
      lines.push(`\n  Summary: ${totalTasks} tasks (${topLevel} top-level, ${subtasks} subtasks)`);
    }

    return lines.join('\n');
  }
}

export class GetNextTasksTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'get_next_tasks',
    description: `Get the next optimal tasks to work on based on dependency graph analysis.

This tool analyzes the dependency graph and returns tasks that are ready to execute:
- All dependencies completed (dependency leaf nodes)
- Status is 'waiting' (not active or completed)
- Ordered by priority

Use this after recursive task breakdown to automatically determine execution order.
The system handles dependency resolution - you just execute the tasks returned.

Parameters:
- max_tasks: Maximum number of tasks to return (default: 1, max: 10)
- include_parallel: If true, returns multiple independent tasks that can run in parallel (default: false)

Returns (JSON):
{
  "ready_tasks": [
    {
      "id": "task_0042",
      "description": "Implement Lexer Tokenization",
      "complexity": "moderate",
      "depth": 2,
      "blocking_count": 3,
      "dependencies_completed": ["task_0040", "task_0041"]
    }
  ],
  "total_ready": 15,
  "total_remaining": 247,
  "execution_progress": "12.5%"
}`,
    parameters: {
      type: 'object',
      properties: {
        max_tasks: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 1)',
        },
        include_parallel: {
          type: 'boolean',
          description: 'Return multiple independent tasks for parallel execution',
        },
      },
      required: [],
    },
  };

  protected readonly schema = GetNextTasksSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof GetNextTasksSchema>): Promise<string> {
    const { max_tasks, include_parallel } = args;
    const result = getNextTasks(this.memoryStore.getTasks(), {
      maxTasks: max_tasks,
      includeParallel: include_parallel,
    });
    return JSON.stringify(result, null, 2);
  }
}

export class ListSubtasksTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'list_subtasks',
    description: `List all subtasks of a parent task.

Use this to:
- View the breakdown of a complex task
- Check progress on sub-tasks
- Navigate the task hierarchy

This helps understand the task structure and delegate focused work.`,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Parent task ID to list subtasks for',
        },
        include_nested: {
          type: 'boolean',
          description: 'Include nested subtasks (grandchildren, etc.) - default false',
        },
      },
      required: ['task_id'],
    },
  };

  protected readonly schema = ListSubtasksSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof ListSubtasksSchema>): Promise<string> {
    const { task_id, include_nested } = args;

    const parent = this.memoryStore.getTasks().find(t => t.id === task_id);
    if (!parent) {
      throw new Error(`Parent task not found: ${task_id}`);
    }

    const directChildren = this.memoryStore.getTasks().filter(t => t.parentId === task_id);

    if (directChildren.length === 0) {
      return `No subtasks found for: ${parent.description}\n  Task ID: ${task_id}\n\nConsider using break_down_task to decompose this task.`;
    }

    const lines = [`Subtasks of: ${parent.description}\n`];

    const renderTask = (task: Task, depth: number) => {
      const indent = '  '.repeat(depth);
      const statusIcon = task.status === 'completed' ? '✓' :
                         task.status === 'active' ? '●' :
                         task.status === 'pending_verification' ? '⧗' :
                         task.status === 'blocked' ? '⚠' : '○';
      const priority = task.priority === 'high' ? ' [HIGH]' : task.priority === 'medium' ? ' [MED]' : '';

      lines.push(`${indent}${statusIcon} ${task.description}${priority}`);
      lines.push(`${indent}  ID: ${task.id} | Status: ${task.status}`);

      // Show completion message for completed tasks
      if (task.status === 'completed' && task.completionMessage) {
        lines.push(`${indent}  ✓ ${task.completionMessage}`);
      }

      if (include_nested) {
        const children = this.memoryStore.getTasks().filter(t => t.parentId === task.id);
        for (const child of children) {
          renderTask(child, depth + 1);
        }
      }
    };

    for (const child of directChildren) {
      renderTask(child, 1);
    }

    const totalSubtasks = directChildren.length;
    const completedSubtasks = directChildren.filter(t => t.status === 'completed').length;
    lines.push(`\nProgress: ${completedSubtasks}/${totalSubtasks} subtasks completed`);

    return lines.join('\n');
  }
}

export class BreakDownTaskTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'break_down_task',
    description: `Break down a complex task into multiple subtasks.

Use this to:
- Decompose macro-level tasks into micro-level focused tasks
- Create a hierarchical task structure for better management
- Prepare tasks for delegation to subagents

IMPORTANT: This is the recommended way to handle complex tasks.
Break them down into 2-15 focused subtasks that can be worked on independently.

Example:
  Parent: "Implement user authentication"
  Subtasks:
    - "Design user schema and database tables"
    - "Create login endpoint with JWT"
    - "Add password hashing middleware"
    - "Implement logout and token refresh"
    - "Add authentication tests"`,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to break down into subtasks',
        },
        subtasks: {
          type: 'array',
          description: 'Array of subtasks to create (2-15 recommended)',
          items: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Subtask description - be specific and focused',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Subtask priority',
              },
            },
            required: ['description'],
          },
        },
      },
      required: ['task_id', 'subtasks'],
    },
  };

  protected readonly schema = BreakDownTaskSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof BreakDownTaskSchema>): Promise<string> {
    const { task_id, subtasks } = args;

    const parent = this.memoryStore.getTasks().find(t => t.id === task_id);
    if (!parent) {
      throw new Error(`Parent task not found: ${task_id}`);
    }

    // Allow adding more subtasks even if task already has some
    const existingSubtasks = this.memoryStore.getTasks().filter(t => t.parentId === task_id);

    const createdTasks: Task[] = [];

    for (const subtaskDef of subtasks) {
      const task = this.memoryStore.addTask({
        description: subtaskDef.description,
        status: 'waiting',
        priority: subtaskDef.priority || parent.priority, // Inherit parent priority if not specified
        relatedToGoal: parent.relatedToGoal,
        relatedFiles: [],
        parentId: task_id,
      });
      createdTasks.push(task);
    }

    const totalSubtasks = existingSubtasks.length + createdTasks.length;

    const lines = [
      existingSubtasks.length > 0
        ? `Added ${createdTasks.length} more subtasks (total: ${totalSubtasks}):`
        : `Broke down task into ${createdTasks.length} subtasks:`,
      `Parent: ${parent.description}`,
      ``,
    ];

    if (existingSubtasks.length > 0) {
      lines.push(`Existing subtasks: ${existingSubtasks.length}`);
      lines.push(``);
    }

    lines.push(`New subtasks created:`);

    for (let i = 0; i < createdTasks.length; i++) {
      const task = createdTasks[i];
      lines.push(`  ${i + 1}. ${task.description}`);
      lines.push(`     ID: ${task.id} | Priority: ${task.priority}`);
    }

    lines.push(``);
    lines.push(`Next steps:`);
    lines.push(`  - Use set_current_task to start working on a subtask`);
    lines.push(`  - Use list_subtasks to view all ${totalSubtasks} subtasks`);
    lines.push(`  - Delegate subtasks to subagents for parallel work`);

    return lines.join('\n');
  }
}

// ========== TRACKING ITEM TOOLS ==========

// Schema for review_tracking_item
const ReviewTrackingItemSchema = z.object({
  item_id: z.string().describe('The ID of the tracking item to review'),
  files_to_verify: z.array(z.string()).min(1).describe('File paths that will be read to verify if this item is complete. REQUIRED: You must read these files to verify completion, not just guess.'),
  initial_assessment: z.string().optional().describe('Your initial assessment after reading the files'),
});

// Schema for close_tracking_item
const CloseTrackingItemSchema = z.object({
  item_id: z.string().describe('The ID of the tracking item to close'),
  reason: z.enum(['completed', 'added-to-tasks', 'duplicate', 'not-needed', 'out-of-scope']).describe('Why this item is being closed'),
  details: z.string().describe('Explanation for closure. If completed, explain what files/evidence prove it. If duplicate, reference the original. If not-needed, explain why.'),
  task_id: z.string().optional().describe('If reason is "added-to-tasks", the task ID that was created'),
  verified_files: z.array(z.string()).optional().describe('Files that were read to verify completion (if applicable)'),
});

// Schema for list_tracking_items
const ListTrackingItemsSchema = z.object({
  status: z.enum(['all', 'open', 'under-review', 'closed']).optional().default('all').describe('Filter by status'),
});

export class ReviewTrackingItemTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'review_tracking_item',
    description: `Move a tracking item to 'under-review' status and specify which files will be read to verify completion.

CRITICAL: This tool REQUIRES you to:
1. Read the specified files BEFORE calling this tool (use read_file)
2. Provide file paths that contain evidence of completion or incompletion
3. Give an honest assessment based on actual file contents, not guesses

Use this when:
- You're about to verify if a tracking item is actually complete
- You need to examine files to determine item status

This enforces verification-by-reading to prevent lazy "guessing" about completion.`,
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The tracking item ID to review',
        },
        files_to_verify: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths you READ to verify completion (REQUIRED - must read files first!)',
        },
        initial_assessment: {
          type: 'string',
          description: 'Your assessment after reading the files',
        },
      },
      required: ['item_id', 'files_to_verify'],
    },
  };

  protected readonly schema = ReviewTrackingItemSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof ReviewTrackingItemSchema>): Promise<string> {
    const { item_id, files_to_verify, initial_assessment } = args;

    const item = this.memoryStore.getTrackingItems().find(i => i.id === item_id);
    if (!item) {
      throw new Error(`Tracking item not found: ${item_id}`);
    }

    if (item.status === 'closed') {
      throw new Error(`Item already closed: ${item.description}`);
    }

    // Warn if suspiciously few files specified
    if (files_to_verify.length === 0) {
      throw new Error(`You must specify at least one file in files_to_verify. Read the relevant files FIRST using read_file, then provide their paths here.`);
    }

    // Move to under-review
    this.memoryStore.updateTrackingItem(item_id, {
      status: 'under-review',
      relatedFiles: files_to_verify,
      verificationNotes: initial_assessment,
    });

    const lines = [
      `Moved tracking item to 'under-review':`,
      ``,
      `Item: ${item.description}`,
      `Priority: ${item.priority}`,
      ``,
      `Files verified: ${files_to_verify.join(', ')}`,
    ];

    if (initial_assessment) {
      lines.push(``);
      lines.push(`Assessment: ${initial_assessment}`);
    }

    lines.push(``);
    lines.push(`⚠️  REMINDER: You should have called read_file on these paths BEFORE this tool.`);
    lines.push(`   File verification is on the honor system - provide accurate evidence!`);
    lines.push(``);
    lines.push(`Next steps:`);
    lines.push(`  - If complete: call close_tracking_item with reason='completed' and cite specific file evidence`);
    lines.push(`  - If incomplete: call create_task to add to task list, then close_tracking_item with reason='added-to-tasks'`);
    lines.push(`  - If not needed: call close_tracking_item with appropriate reason`);

    return lines.join('\n');
  }
}

export class CloseTrackingItemTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'close_tracking_item',
    description: `Close a tracking item with a specific reason.

Use this when:
- Item is verified complete (with file evidence)
- Item was added to task list (provide task_id)
- Item is duplicate, not needed, or out of scope

IMPORTANT: Provide detailed explanation in 'details' field. For completed items, reference specific files/lines that prove completion.`,
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The tracking item ID to close',
        },
        reason: {
          type: 'string',
          enum: ['completed', 'added-to-tasks', 'duplicate', 'not-needed', 'out-of-scope'],
          description: 'Why this item is being closed',
        },
        details: {
          type: 'string',
          description: 'Detailed explanation with file evidence (for completed) or reasoning',
        },
        task_id: {
          type: 'string',
          description: 'Task ID if reason is "added-to-tasks"',
        },
        verified_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files read to verify completion',
        },
      },
      required: ['item_id', 'reason', 'details'],
    },
  };

  protected readonly schema = CloseTrackingItemSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof CloseTrackingItemSchema>): Promise<string> {
    const { item_id, reason, details, task_id, verified_files } = args;

    const item = this.memoryStore.getTrackingItems().find(i => i.id === item_id);
    if (!item) {
      throw new Error(`Tracking item not found: ${item_id}`);
    }

    if (item.status === 'closed') {
      return `Item already closed: ${item.description}`;
    }

    // Validate task_id if reason is added-to-tasks
    if (reason === 'added-to-tasks' && !task_id) {
      throw new Error(`Must provide task_id when reason is 'added-to-tasks'`);
    }

    if (reason === 'added-to-tasks' && task_id) {
      const task = this.memoryStore.getTasks().find(t => t.id === task_id);
      if (!task) {
        throw new Error(`Task not found: ${task_id}`);
      }
    }

    // Close the item
    this.memoryStore.updateTrackingItem(item_id, {
      status: 'closed',
      closureReason: reason,
      closureDetails: details,
      relatedTaskId: task_id,
      relatedFiles: verified_files || item.relatedFiles,
    });

    const lines = [
      `Closed tracking item:`,
      ``,
      `Item: ${item.description}`,
      `Reason: ${reason}`,
      `Details: ${details}`,
    ];

    if (task_id) {
      lines.push(`Related task: ${task_id}`);
    }

    if (verified_files && verified_files.length > 0) {
      lines.push(``);
      lines.push(`Evidence from files: ${verified_files.join(', ')}`);
    }

    return lines.join('\n');
  }
}

export class ListTrackingItemsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'list_tracking_items',
    description: `List tracking items by status.

Tracking items are incomplete work items detected in your responses:
- open: Detected but not yet reviewed
- under-review: Currently being verified for completion
- closed: Verified complete or resolved

Use this to:
- See what incomplete work is being tracked
- Review items that need attention
- Check progress on addressing detected issues`,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'open', 'under-review', 'closed'],
          description: 'Filter by status (default: all)',
        },
      },
    },
  };

  protected readonly schema = ListTrackingItemsSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof ListTrackingItemsSchema>): Promise<string> {
    const { status = 'all' } = args;

    const items = status === 'all'
      ? this.memoryStore.getTrackingItems()
      : this.memoryStore.getTrackingItems(status as any);

    if (items.length === 0) {
      return `No tracking items found${status !== 'all' ? ` with status '${status}'` : ''}.`;
    }

    const lines = [
      `Tracking Items${status !== 'all' ? ` (${status})` : ''}:`,
      ``,
    ];

    // Group by status
    const byStatus = {
      open: items.filter(i => i.status === 'open'),
      'under-review': items.filter(i => i.status === 'under-review'),
      closed: items.filter(i => i.status === 'closed'),
    };

    for (const [statusKey, statusItems] of Object.entries(byStatus)) {
      if (statusItems.length === 0) continue;

      lines.push(`${statusKey.toUpperCase()} (${statusItems.length}):`);

      for (const item of statusItems) {
        lines.push(`  ${item.id}: ${item.description}`);
        lines.push(`    Priority: ${item.priority} | Detected: ${item.detectedAt.toISOString()}`);

        if (item.status === 'under-review' && item.movedToReviewAt) {
          lines.push(`    Under review since: ${item.movedToReviewAt.toISOString()}`);
          if (item.relatedFiles && item.relatedFiles.length > 0) {
            lines.push(`    Files being verified: ${item.relatedFiles.join(', ')}`);
          }
        }

        if (item.status === 'closed') {
          lines.push(`    Closed: ${item.closureReason} - ${item.closureDetails}`);
          if (item.relatedTaskId) {
            lines.push(`    Related task: ${item.relatedTaskId}`);
          }
        }

        lines.push(``);
      }
    }

    return lines.join('\n');
  }
}

function formatIso(ts: Date): string {
  return ts.toISOString().replace('T', ' ').replace('Z', 'Z');
}

function buildExperimentLogEntry(args: z.infer<typeof RecordExperimentResultSchema>): string {
  const lines: string[] = [];
  lines.push(`[Experiment Log] ${formatIso(new Date())}`);
  if (args.title) lines.push(`Title: ${args.title}`);
  if (args.hypothesis) lines.push(`Hypothesis: ${args.hypothesis}`);
  if (args.prediction) lines.push(`Prediction: ${args.prediction}`);
  if (args.steps && args.steps.length > 0) {
    lines.push('Steps:');
    for (const step of args.steps.slice(0, 25)) lines.push(`- ${step}`);
  }
  if (args.observed) lines.push(`Observed: ${args.observed}`);
  lines.push(`Conclusion: ${args.conclusion}`);
  if (args.next_step) lines.push(`Next: ${args.next_step}`);
  return lines.join('\n');
}

export class DebugScaffoldTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'debug_scaffold',
    description: `Scaffold a hypothesis-driven debugging workflow using the task system.

Creates a small task tree that supports iterative theory testing:
- Repro: make it fail reliably and capture evidence
- Explore: locate code paths/entrypoints (often via explore_codebase)
- Hypothesis/Experiment pairs: state hypothesis, run a targeted test, record outcome
- Fix: implement the smallest change
- Verify: rerun repro + checks
- Regressions (optional): add/adjust tests

Use record_experiment_result to log experiment outcomes and keep a persistent trail of what was tried.`,
    parameters: {
      type: 'object',
      properties: {
        bug: { type: 'string' },
        parent_task_id: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], default: 'high' },
        related_files: { type: 'array', items: { type: 'string' } },
        experiments: { type: 'number', default: 1 },
        set_current_to_repro: { type: 'boolean', default: true },
        include_regression_test_task: { type: 'boolean', default: true },
      },
      required: ['bug'],
    },
  };

  protected readonly schema = DebugScaffoldSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof DebugScaffoldSchema>): Promise<string> {
    const existingParent = args.parent_task_id
      ? this.memoryStore.getTasks().find(t => t.id === args.parent_task_id)
      : undefined;

    if (args.parent_task_id && !existingParent) {
      throw new Error(`Parent task not found: ${args.parent_task_id}`);
    }

    const root = this.memoryStore.addTask({
      description: `Debug: ${args.bug}`.slice(0, 200),
      status: 'waiting',
      priority: args.priority,
      relatedToGoal: true,
      relatedFiles: args.related_files || [],
      parentId: args.parent_task_id,
    });

    const repro = this.memoryStore.addTask({
      description: 'Repro: reproduce issue and capture evidence',
      status: args.set_current_to_repro ? 'active' : 'waiting',
      priority: 'high',
      relatedToGoal: true,
      relatedFiles: args.related_files || [],
      parentId: root.id,
    });

    const explore = this.memoryStore.addTask({
      description: 'Explore: locate code path/entrypoints and ownership',
      status: 'waiting',
      priority: 'high',
      relatedToGoal: true,
      relatedFiles: args.related_files || [],
      parentId: root.id,
    });

    const hypothesisTasks: Task[] = [];
    const experimentTasks: Task[] = [];

    for (let i = 1; i <= args.experiments; i++) {
      hypothesisTasks.push(this.memoryStore.addTask({
        description: `Hypothesis ${i}: state a single suspected cause`,
        status: 'waiting',
        priority: 'high',
        relatedToGoal: true,
        relatedFiles: args.related_files || [],
        parentId: root.id,
      }));

      experimentTasks.push(this.memoryStore.addTask({
        description: `Experiment ${i}: run a targeted test (record outcome)`,
        status: 'waiting',
        priority: 'high',
        relatedToGoal: true,
        relatedFiles: args.related_files || [],
        parentId: root.id,
      }));
    }

    const fix = this.memoryStore.addTask({
      description: 'Fix: implement smallest change that addresses root cause',
      status: 'waiting',
      priority: 'high',
      relatedToGoal: true,
      relatedFiles: args.related_files || [],
      parentId: root.id,
    });

    const verify = this.memoryStore.addTask({
      description: 'Verify: rerun repro + checks, confirm requirements',
      status: 'waiting',
      priority: 'high',
      relatedToGoal: true,
      relatedFiles: args.related_files || [],
      parentId: root.id,
    });

    const regression = args.include_regression_test_task
      ? this.memoryStore.addTask({
          description: 'Regressions: add/adjust tests to prevent recurrence',
          status: 'waiting',
          priority: 'medium',
          relatedToGoal: true,
          relatedFiles: args.related_files || [],
          parentId: root.id,
        })
      : undefined;

    if (args.set_current_to_repro) {
      this.memoryStore.updateWorkingState({
        currentTask: repro.id,
        lastUpdated: new Date(),
      });
    }

    const lines: string[] = [];
    lines.push(`Created debug task tree under: ${root.id}`);
    if (existingParent) lines.push(`Parent: ${existingParent.description}`);
    lines.push('');
    lines.push(`Root: ${root.description}`);
    lines.push(`- ${repro.id} (active): ${repro.description}`);
    lines.push(`- ${explore.id}: ${explore.description}`);
    hypothesisTasks.forEach((t, idx) => lines.push(`- ${t.id}: Hypothesis ${idx + 1}`));
    experimentTasks.forEach((t, idx) => lines.push(`- ${t.id}: Experiment ${idx + 1}`));
    lines.push(`- ${fix.id}: ${fix.description}`);
    lines.push(`- ${verify.id}: ${verify.description}`);
    if (regression) lines.push(`- ${regression.id}: ${regression.description}`);
    lines.push('');
    lines.push('Tip: Use record_experiment_result to log each experiment outcome (commands + observed + conclusion + next step).');
    return lines.join('\n');
  }
}

export class RecordExperimentResultTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'record_experiment_result',
    description: `Record a hypothesis/experiment result against a task to keep a persistent debugging trail.

This appends a structured log entry to the task's completionMessage and can optionally update task status.

Recommended usage:
- Run an experiment (commands / repro steps)
- Call record_experiment_result with what you tried and what happened
- Move on to the next hypothesis/experiment with confidence and traceability`,
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        title: { type: 'string' },
        hypothesis: { type: 'string' },
        prediction: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' } },
        observed: { type: 'string' },
        conclusion: { type: 'string', enum: ['supports', 'refutes', 'inconclusive'] },
        next_step: { type: 'string' },
        status: { type: 'string', enum: ['active', 'blocked', 'waiting', 'pending_verification', 'completed'] },
        blocked_by: { type: 'string' },
        waiting_for: { type: 'string' },
        create_followup_task: { type: 'boolean', default: false },
        followup_description: { type: 'string' },
        followup_priority: { type: 'string', enum: ['high', 'medium', 'low'], default: 'medium' },
        followup_parent_task_id: { type: 'string' },
      },
      required: ['conclusion'],
    },
  };

  protected readonly schema = RecordExperimentResultSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof RecordExperimentResultSchema>): Promise<string> {
    const workingState = this.memoryStore.getWorkingState();
    const taskId = args.task_id || workingState.currentTask;
    if (!taskId) {
      throw new Error('No task_id provided and no current task is set. Use set_current_task or pass task_id.');
    }

    const task = this.memoryStore.getTasks().find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (args.status === 'blocked' && !args.blocked_by) {
      throw new Error('blocked_by is required when status is "blocked".');
    }
    if (args.status === 'waiting' && !args.waiting_for) {
      throw new Error('waiting_for is required when status is "waiting".');
    }
    if (args.create_followup_task && !args.followup_description) {
      throw new Error('followup_description is required when create_followup_task is true.');
    }

    const entry = buildExperimentLogEntry(args);
    const nextMessage = task.completionMessage ? `${task.completionMessage}\n\n${entry}` : entry;

    const updates: Partial<Task> = {
      completionMessage: nextMessage,
      updatedAt: new Date(),
    };

    if (args.status) {
      updates.status = args.status as any;
      if (args.status === 'completed') {
        updates.completedAt = new Date();
      }
      if (args.status === 'blocked') {
        updates.blockedBy = args.blocked_by;
      }
      if (args.status === 'waiting') {
        updates.waitingFor = args.waiting_for;
      }
    }

    this.memoryStore.updateTask(taskId, updates);

    let followupTaskId: string | undefined;
    if (args.create_followup_task && args.followup_description) {
      const followupParentId = args.followup_parent_task_id ?? task.parentId;
      if (followupParentId) {
        const parent = this.memoryStore.getTasks().find(t => t.id === followupParentId);
        if (!parent) throw new Error(`Follow-up parent task not found: ${followupParentId}`);
      }

      const followup = this.memoryStore.addTask({
        description: args.followup_description.slice(0, 200),
        status: 'waiting',
        priority: args.followup_priority,
        relatedToGoal: true,
        relatedFiles: task.relatedFiles || [],
        parentId: followupParentId,
      });
      followupTaskId = followup.id;
    }

    const lines: string[] = [];
    lines.push(`Recorded experiment result on task: ${task.id}`);
    lines.push(`Task: ${task.description}`);
    lines.push(`Conclusion: ${args.conclusion}`);
    if (args.status) lines.push(`Status: ${task.status} -> ${args.status}`);
    if (followupTaskId) lines.push(`Created follow-up task: ${followupTaskId}`);
    return lines.join('\n');
  }
}
