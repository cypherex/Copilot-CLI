// Task Management Tools - explicit task tracking and planning tools

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { MemoryStore, Task } from '../memory/types.js';

// Schema for create_task
const CreateTaskSchema = z.object({
  description: z.string().describe('Task description'),
  priority: z.enum(['high', 'medium', 'low']).optional().describe('Task priority'),
  related_to_goal: z.boolean().optional().default(true).describe('Whether this task is related to the main goal'),
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

export class CreateTaskTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'create_task',
    description: `Create a new task in the task list.

Use this when:
- You're planning work and need to break down a goal into tasks
- You identify a new task that needs to be done
- You want to explicitly track a piece of work

Tasks should be specific, actionable, and measurable.`,
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

  protected async executeInternal(args: z.infer<typeof CreateTaskSchema>): Promise<string> {
    const { description, priority, related_to_goal } = args;

    const task = this.memoryStore.addTask({
      description,
      status: 'waiting',
      priority: priority || 'medium',
      relatedToGoal: related_to_goal,
      relatedFiles: [], // Required by Task interface
    });

    return `Created task: ${description}\n  Task ID: ${task.id}\n  Priority: ${task.priority}\n  Status: ${task.status}`;
  }
}

export class UpdateTaskStatusTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'update_task_status',
    description: `Update the status of a task.

Use this to:
- Mark a task as active when you start working on it
- Mark a task as completed when you finish it
- Mark a task as blocked if you encounter issues
- Mark a task as waiting if you need user input

Always update task status as you work to track progress.`,
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

  protected async executeInternal(args: z.infer<typeof UpdateTaskStatusSchema>): Promise<string> {
    const { task_id, status, notes } = args;

    const task = this.memoryStore.getTasks().find((t: any) => t.id === task_id);
    if (!task) {
      throw new Error(`Task not found: ${task_id}`);
    }

    this.memoryStore.updateTask(task_id, { status, updatedAt: new Date() });

    let message = `Updated task "${task.description}": ${task.status} → ${status}`;
    if (notes) {
      message += `\n  Notes: ${notes}`;
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

    const lines = [`Tasks (${status}):\n`];

    // Group by status for better readability
    const waiting = tasks.filter(t => t.status === 'waiting');
    const active = tasks.filter(t => t.status === 'active');
    const blocked = tasks.filter(t => t.status === 'blocked');
    const completed = tasks.filter(t => t.status === 'completed');

    if (waiting.length > 0) {
      lines.push('  Waiting:');
      for (const task of waiting) {
        const priority = task.priority === 'high' ? ' [HIGH]' : task.priority === 'medium' ? ' [MED]' : '';
        lines.push(`    ○ ${task.description}${priority}`);
        lines.push(`      ID: ${task.id}`);
      }
    }

    if (active.length > 0) {
      lines.push('  Active:');
      for (const task of active) {
        lines.push(`    ● ${task.description} [${task.priority.toUpperCase()}]`);
        lines.push(`      ID: ${task.id}`);
      }
    }

    if (blocked.length > 0) {
      lines.push('  Blocked:');
      for (const task of blocked) {
        lines.push(`    ⚠ ${task.description} [${task.priority.toUpperCase()}]`);
        lines.push(`      ID: ${task.id}`);
      }
    }

    if (completed.length > 0 && status === 'all') {
      lines.push('  Completed:');
      for (const task of completed) {
        lines.push(`    ✓ ${task.description}`);
        lines.push(`      ID: ${task.id}`);
      }
    }

    return lines.join('\n');
  }
}
