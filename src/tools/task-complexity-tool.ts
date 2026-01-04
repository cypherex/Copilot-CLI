import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { MemoryStore, TaskComplexity, Task } from '../memory/types.js';

// Schema for set_task_complexity
const SetTaskComplexitySchema = z.object({
  task_id: z.string().optional().describe('Task ID (if not provided, uses current task)'),
  estimated_complexity: z.enum(['simple', 'moderate', 'complex']).optional().describe('Estimated complexity'),
});

// Schema for report_task_complexity
const ReportTaskComplexitySchema = z.object({
  task_id: z.string().describe('Task ID to report'),
  actual_complexity: z.enum(['simple', 'moderate', 'complex']).describe('Actual complexity experienced'),
  actual_iterations: z.number().optional().describe('Number of iterations/LLM calls to complete'),
  should_have_spawned_subagent: z.boolean().optional().describe('Whether this should have been delegated to a subagent'),
});

// Schema for get_complexity_insights
const GetComplexityInsightsSchema = z.object({});

export class SetTaskComplexityTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'set_task_complexity',
    description: `Set estimated complexity for a task.

Use this when:
- Creating a new task with known complexity
- Initial planning to estimate effort
- Setting expectations for task difficulty

This helps track complexity estimation accuracy over time.`,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID (if not provided, uses current task)',
        },
        estimated_complexity: {
          type: 'string',
          enum: ['simple', 'moderate', 'complex'],
          description: 'Estimated complexity',
        },
      },
      required: [],
    },
  };

  protected readonly schema = SetTaskComplexitySchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof SetTaskComplexitySchema>): Promise<string> {
    let task: Task | undefined;
    if (args.task_id) {
      task = this.memoryStore.getTasks().find(t => t.id === args.task_id);
    } else {
      task = this.memoryStore.getActiveTask();
    }

    if (!task) {
      return '❌ Error: No task found. Use current task or provide a task_id.';
    }

    if (!args.estimated_complexity) {
      return '❌ Error: estimated_complexity is required.';
    }

    this.memoryStore.updateTask(task.id, {
      estimatedComplexity: args.estimated_complexity,
    });

    return `✅ Task complexity set\n` +
           `   Task: ${task.description}\n` +
           `   Estimated: ${args.estimated_complexity}\n`;
  }
}

export class ReportTaskComplexityTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'report_task_complexity',
    description: `Report actual complexity experienced after completing a task.

Use this when:
- Completing a task
- Reviewing task completion
- Identifying tasks that should have used subagents

This helps improve complexity estimation and identifies patterns for subagent delegation.`,
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to report',
        },
        actual_complexity: {
          type: 'string',
          enum: ['simple', 'moderate', 'complex'],
          description: 'Actual complexity experienced',
        },
        actual_iterations: {
          type: 'number',
          description: 'Number of iterations/LLM calls to complete',
        },
        should_have_spawned_subagent: {
          type: 'boolean',
          description: 'Whether this should have been delegated to a subagent',
        },
      },
      required: ['task_id', 'actual_complexity'],
    },
  };

  protected readonly schema = ReportTaskComplexitySchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof ReportTaskComplexitySchema>): Promise<string> {
    const task = this.memoryStore.getTasks().find(t => t.id === args.task_id);

    if (!task) {
      return `❌ Error: Task "${args.task_id}" not found.`;
    }

    this.memoryStore.updateTask(task.id, {
      actualComplexity: args.actual_complexity,
      actualIterations: args.actual_iterations,
      shouldHaveSpawnedSubagent: args.should_have_spawned_subagent,
    });

    let result = `✅ Task complexity reported\n` +
                  `   Task: ${task.description}\n` +
                  `   Actual: ${args.actual_complexity}\n`;

    if (args.actual_iterations !== undefined) {
      result += `   Iterations: ${args.actual_iterations}\n`;
    }

    if (args.should_have_spawned_subagent !== undefined) {
      result += `   Should use subagent: ${args.should_have_spawned_subagent}\n`;
    }

    // Compare with estimate
    if (task.estimatedComplexity) {
      const complexityOrder: TaskComplexity[] = ['simple', 'moderate', 'complex'];
      const estimatedIdx = complexityOrder.indexOf(task.estimatedComplexity);
      const actualIdx = complexityOrder.indexOf(args.actual_complexity);

      if (actualIdx > estimatedIdx) {
        result += `\n⚠️  Warning: Task was more complex than estimated!\n`;
        result += `💡 Tip: Consider using a subagent for ${args.actual_complexity} tasks in the future.`;
      } else if (actualIdx < estimatedIdx) {
        result += `\n✓ Task was simpler than estimated. Good work!`;
      } else {
        result += `\n✓ Complexity estimate was accurate!`;
      }
    }

    return result;
  }
}

export class GetComplexityInsightsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'get_complexity_insights',
    description: `Get insights about task complexity patterns.

Use this when:
- Reviewing completed tasks
- Looking for patterns in complexity estimation
- Identifying when subagents should be used

This helps improve planning and delegation decisions.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  protected readonly schema = GetComplexityInsightsSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof GetComplexityInsightsSchema>): Promise<string> {
    const tasks = this.memoryStore.getTasks();
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.actualComplexity);

    if (completedTasks.length === 0) {
      return 'No completed tasks with complexity data available.';
    }

    const lines: string[] = [];

    // Complexity distribution
    const complexityCounts: Record<TaskComplexity, number> = {
      simple: 0,
      moderate: 0,
      complex: 0,
    };

    completedTasks.forEach(task => {
      if (task.actualComplexity) {
        complexityCounts[task.actualComplexity]++;
      }
    });

    lines.push('📊 Complexity Insights');
    lines.push('');
    lines.push('Complexity Distribution:');
    lines.push(`  Simple: ${complexityCounts.simple}`);
    lines.push(`  Moderate: ${complexityCounts.moderate}`);
    lines.push(`  Complex: ${complexityCounts.complex}`);
    lines.push('');

    // Estimation accuracy
    const estimatedTasks = completedTasks.filter(t => t.estimatedComplexity);
    if (estimatedTasks.length > 0) {
      const complexityOrder: TaskComplexity[] = ['simple', 'moderate', 'complex'];
      const accurateCount = estimatedTasks.filter(t => {
        const estimatedIdx = complexityOrder.indexOf(t.estimatedComplexity!);
        const actualIdx = complexityOrder.indexOf(t.actualComplexity!);
        return estimatedIdx === actualIdx;
      }).length;

      lines.push('Estimation Accuracy:');
      const accuracyPercent = Math.round((accurateCount / estimatedTasks.length) * 100);
      lines.push(`  Accurate: ${accuracyPercent}% (${accurateCount}/${estimatedTasks.length})`);
      lines.push('');
    }

    // Subagent patterns
    const subagentTasks = completedTasks.filter(t => t.shouldHaveSpawnedSubagent);
    if (subagentTasks.length > 0) {
      lines.push(`⚠️  Tasks that should have used subagents: ${subagentTasks.length}`);
      subagentTasks.forEach(task => {
        lines.push(`  - ${task.description}`);
        if (task.completionMessage) {
          lines.push(`    ✓ ${task.completionMessage}`);
        }
      });
      lines.push('');
    }

    // Average iterations by complexity
    const iterationsByComplexity: Record<string, number[]> = {
      simple: [],
      moderate: [],
      complex: [],
    };

    completedTasks.forEach(task => {
      if (task.actualIterations && task.actualComplexity) {
        iterationsByComplexity[task.actualComplexity].push(task.actualIterations);
      }
    });

    lines.push('Average Iterations by Complexity:');
    (Object.entries(iterationsByComplexity) as [string, number[]][]).forEach(([complexity, iterations]) => {
      if (iterations.length > 0) {
        const avg = Math.round(iterations.reduce((a, b) => a + b, 0) / iterations.length);
        lines.push(`  ${complexity}: ${avg} iterations (${iterations.length} tasks)`);
      }
    });

    return lines.join('\n');
  }
}
