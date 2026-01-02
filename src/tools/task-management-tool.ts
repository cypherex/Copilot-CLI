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
  })).min(2).max(10).describe('Array of subtasks to create (2-10 subtasks recommended)'),
});

export class CreateTaskTool extends BaseTool {
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
- Aim for 3-7 subtasks per parent for manageable scope`,
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

  protected async executeInternal(args: z.infer<typeof CreateTaskSchema>): Promise<string> {
    const { description, priority, related_to_goal, parent_id } = args;

    // Validate parent exists if parent_id provided
    if (parent_id) {
      const parent = this.memoryStore.getTasks().find(t => t.id === parent_id);
      if (!parent) {
        throw new Error(`Parent task not found: ${parent_id}`);
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
Break them down into 2-10 focused subtasks that can be worked on independently.

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
          description: 'Array of subtasks to create (2-10 recommended)',
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
