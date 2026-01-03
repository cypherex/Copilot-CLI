// Task Management Tools - explicit task tracking and planning tools

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
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
  status: z.enum(['active', 'blocked', 'waiting', 'completed', 'abandoned']).describe('New status'),
  notes: z.string().optional().describe('Optional notes about the status change'),
});

// Schema for set_current_task
const SetCurrentTaskSchema = z.object({
  task_id: z.string().describe('The ID of the task to set as current'),
});

// Schema for list_tasks
const ListTasksSchema = z.object({
  status: z.enum(['all', 'active', 'waiting', 'completed', 'blocked', 'abandoned']).optional().default('all').describe('Filter by status'),
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
  })).min(2).max(15).describe('Array of subtasks to create (2-15 subtasks recommended)'),
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

  protected async executeInternal(args: z.infer<typeof CreateTaskSchema>): Promise<string> {
    const { description, priority, related_to_goal, parent_id } = args;

    // Validate parent exists if parent_id provided
    if (parent_id) {
      const parent = this.memoryStore.getTasks().find(t => t.id === parent_id);
      if (!parent) {
        throw new Error(`Parent task not found: ${parent_id}`);
      }
    }

    // Validate task complexity (same as spawn validation)
    if (this.spawnValidator) {
      const validationResult = await this.spawnValidator.validateSpawn({
        task: description,
        parent_task_id: parent_id,
        memoryStore: this.memoryStore,
      });

      // If task is too complex, reject and force breakdown
      if (!validationResult.allowed && validationResult.requiresBreakdown) {
        throw new Error(
          validationResult.suggestedMessage ||
          validationResult.reason ||
          'Task is too complex - use break_down_task to decompose it first'
        );
      }

      // Display complexity warning if task is complex but allowed
      if (validationResult.complexity && validationResult.complexity.rating === 'complex') {
        uiState.addMessage({
          role: 'system',
          content: `⚠️  Complex task created (${validationResult.complexity.rating}): ${validationResult.complexity.reasoning}`,
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
          enum: ['active', 'blocked', 'waiting', 'completed', 'abandoned'],
          description: 'New status',
        },
        notes: {
          type: 'string',
          description: 'Optional notes about the status change',
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

  protected async executeInternal(args: z.infer<typeof UpdateTaskStatusSchema>): Promise<string> {
    const { task_id, status, notes } = args;

    const task = this.memoryStore.getTasks().find((t: any) => t.id === task_id);
    if (!task) {
      throw new Error(`Task not found: ${task_id}`);
    }

    // VALIDATION: Check if completion should be allowed
    if (status === 'completed' && this.completionValidator) {
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
        filesModified: completedTaskFiles.length > 0 ? completedTaskFiles : undefined,
      });

      // Build enhanced completion response
      let message = `✓ Completed task: "${task.description}"`;
      if (notes) {
        message += `\n  Notes: ${notes}`;
      }

      if (completedTaskFiles.length > 0) {
        message += `\n  Files modified: ${completedTaskFiles.join(', ')}`;
      }

      return message;
    }

    // Non-completion status update (no validation needed)
    const updates: Partial<Task> = { status, updatedAt: new Date() };

    // For completion without validator, still populate filesModified
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
    }

    this.memoryStore.updateTask(task_id, updates);

    let message = `Updated task "${task.description}": ${task.status} → ${status}`;
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
          enum: ['all', 'active', 'waiting', 'completed', 'blocked', 'abandoned'],
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
                         task.status === 'blocked' ? '⚠' : '○';
      const priority = task.priority === 'high' ? ' [HIGH]' :
                      task.priority === 'medium' ? ' [MED]' :
                      task.priority === 'low' ? ' [LOW]' : '';

      lines.push(`${indent}${statusIcon} ${task.description}${priority}`);
      lines.push(`${indent}  ID: ${task.id} | Status: ${task.status}`);

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
                         task.status === 'blocked' ? '⚠' : '○';
      const priority = task.priority === 'high' ? ' [HIGH]' : task.priority === 'medium' ? ' [MED]' : '';

      lines.push(`${indent}${statusIcon} ${task.description}${priority}`);
      lines.push(`${indent}  ID: ${task.id} | Status: ${task.status}`);

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

    // Check if task already has subtasks
    const existingSubtasks = this.memoryStore.getTasks().filter(t => t.parentId === task_id);
    if (existingSubtasks.length > 0) {
      throw new Error(`Task already has ${existingSubtasks.length} subtasks. Use list_subtasks to view them.`);
    }

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

    const lines = [
      `Broke down task into ${createdTasks.length} subtasks:`,
      `Parent: ${parent.description}`,
      ``,
      `Subtasks created:`,
    ];

    for (let i = 0; i < createdTasks.length; i++) {
      const task = createdTasks[i];
      lines.push(`  ${i + 1}. ${task.description}`);
      lines.push(`     ID: ${task.id} | Priority: ${task.priority}`);
    }

    lines.push(``);
    lines.push(`Next steps:`);
    lines.push(`  - Use set_current_task to start working on a subtask`);
    lines.push(`  - Use list_subtasks to view the breakdown`);
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
