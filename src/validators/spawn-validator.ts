// SpawnValidator - validates subagent spawn requests and enforces task breakdown

import type { LLMClient, ChatMessage } from '../llm/types.js';
import type { Task, MemoryStore } from '../memory/types.js';

// ============================================
// Type Definitions
// ============================================

export interface SpawnValidationContext {
  task: string;
  name?: string;
  role?: string;
  files?: string[];
  success_criteria?: string;
  parent_task_id?: string;
  memoryStore: MemoryStore;
}

export interface SpawnValidationResult {
  allowed: boolean;
  reason?: string;
  requiresBreakdown: boolean;
  complexity?: ComplexityAssessment;
  breakdownDecision?: BreakdownDecision;
  suggestedMessage?: string;
  autoCreatedTask?: {
    taskId: string;
    subtaskIds: string[];
  };
}

export interface ComplexityAssessment {
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

export interface BreakdownDecision {
  required: boolean;
  reasoning: string;
  suggestedSubtasks: string[];
  integrationConsiderations: string[];
}

// ============================================
// SpawnValidator Class
// ============================================

export class SpawnValidator {
  constructor(private llmClient: LLMClient) {}

  /**
   * Main validation entry point
   */
  async validateSpawn(context: SpawnValidationContext): Promise<SpawnValidationResult> {
    // If this is a subtask (has parent_task_id), verify parent exists
    if (context.parent_task_id) {
      const parentTask = context.memoryStore.getTasks().find(t => t.id === context.parent_task_id);
      if (!parentTask) {
        return {
          allowed: false,
          requiresBreakdown: false,
          reason: `Parent task not found: ${context.parent_task_id}`,
        };
      }
      // IMPORTANT: Still check complexity even for subtasks!
      // Just because a task was broken down doesn't mean the subtasks are appropriately scoped.
      // Subtasks can still be MACRO-level complex and need further breakdown.
    }

    // Assess task complexity (for both top-level tasks AND subtasks)
    const complexity = await this.assessTaskComplexity(context.task);

    // If task is simple or moderate, allow spawn
    if (complexity.rating === 'simple' || complexity.rating === 'moderate') {
      return {
        allowed: true,
        requiresBreakdown: false,
        complexity,
        reason: `Task complexity is ${complexity.rating} - spawn allowed`,
      };
    }

    // Task is complex - check if breakdown is required
    const taskContext = this.buildTaskContext(context.memoryStore);
    const breakdownDecision = await this.shouldRequireBreakdown(
      context.task,
      complexity,
      taskContext
    );

    if (breakdownDecision.required) {
      // Auto-create the task and subtasks to save a round trip
      const parentTask = context.memoryStore.addTask({
        description: context.task,
        status: 'active',
        priority: 'high',
        relatedFiles: context.files || [],
      });

      const subtaskIds: string[] = [];
      for (const subtaskDesc of breakdownDecision.suggestedSubtasks) {
        const subtask = context.memoryStore.addTask({
          description: subtaskDesc,
          status: 'waiting',
          priority: 'medium',
          parentId: parentTask.id,
          relatedFiles: [],
        });
        subtaskIds.push(subtask.id);
      }

      return {
        allowed: false,
        requiresBreakdown: true,
        complexity,
        breakdownDecision,
        reason: 'Task is too complex - auto-created task with subtasks',
        autoCreatedTask: {
          taskId: parentTask.id,
          subtaskIds,
        },
        suggestedMessage: this.buildBreakdownCompletedMessage(
          context.task,
          parentTask.id,
          subtaskIds,
          breakdownDecision.suggestedSubtasks,
          complexity,
          breakdownDecision
        ),
      };
    }

    // Complex but breakdown not required (edge case - LLM determined it's fine)
    return {
      allowed: true,
      requiresBreakdown: false,
      complexity,
      breakdownDecision,
      reason: `Task is complex but LLM determined breakdown not needed: ${breakdownDecision.reasoning}`,
    };
  }

  /**
   * Assess task complexity using LLM
   */
  async assessTaskComplexity(task: string): Promise<ComplexityAssessment> {
    const systemPrompt = `You are a task complexity analyzer. Your job is to assess the complexity of a task that is about to be delegated to a subagent.

Analyze the task and return ONLY valid JSON in this exact format:
{
  "rating": "simple" | "moderate" | "complex",
  "evidence": {
    "filesCount": <number or null>,
    "functionsEstimate": <number or null>,
    "linesEstimate": <number or null>,
    "integrationPoints": [<array of strings or empty>],
    "hasMultipleSteps": <boolean>,
    "requiresCoordination": <boolean>
  },
  "reasoning": "<explanation of why this rating was chosen>"
}

Complexity Guidelines:
- SIMPLE: Single file, single function/class, < 50 lines, no integration, 1-2 steps
- MODERATE: 2-3 files, 2-5 functions, 50-200 lines, minimal integration, 3-5 steps
- COMPLEX: 4+ files, 6+ functions, 200+ lines, multiple integrations, 6+ steps

Focus on:
1. Number of files that need modification
2. Number of functions/methods involved
3. Estimated lines of code
4. Integration points (APIs, databases, external services)
5. Multiple sequential steps required
6. Need for coordination between components`;

    const userPrompt = `Analyze this task for complexity:

Task: "${task}"

Return JSON with complexity assessment.`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const content = response.choices[0]?.message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ComplexityAssessment;

        // Validate required fields
        if (parsed.rating && parsed.evidence && parsed.reasoning) {
          return parsed;
        }
      }
    } catch (error) {
      console.error('[SpawnValidator] Failed to assess complexity:', error);
    }

    // Fallback: default to moderate complexity
    return {
      rating: 'moderate',
      evidence: {
        hasMultipleSteps: true,
        requiresCoordination: false,
      },
      reasoning: 'Failed to parse LLM response - defaulting to moderate complexity',
    };
  }

  /**
   * Determine if breakdown is required using LLM
   */
  async shouldRequireBreakdown(
    task: string,
    complexity: ComplexityAssessment,
    taskContext: string
  ): Promise<BreakdownDecision> {
    const systemPrompt = `You are a task breakdown advisor. Your job is to determine if a complex task should be broken down into subtasks before delegating to a subagent.

Analyze the task and context, then return ONLY valid JSON in this exact format:
{
  "required": <boolean>,
  "reasoning": "<explanation of why breakdown is or isn't required>",
  "suggestedSubtasks": [<array of 3-7 suggested subtask descriptions>],
  "integrationConsiderations": [<array of integration points to consider>]
}

Breakdown Guidelines:
- REQUIRE breakdown if:
  - Task involves 4+ files
  - Task has 6+ distinct steps
  - Task requires coordination between multiple components
  - Task description uses words like "implement system", "build feature", "create module"
  - Existing tasks show a pattern of breaking down similar work

- ALLOW without breakdown if:
  - Task is well-scoped despite being complex
  - Task is a single cohesive unit of work
  - Breaking down would create artificial boundaries
  - Context shows this is already a subtask of a larger breakdown`;

    const userPrompt = `Analyze if this task requires breakdown:

Task: "${task}"

Complexity Assessment:
- Rating: ${complexity.rating}
- Evidence: ${JSON.stringify(complexity.evidence, null, 2)}
- Reasoning: ${complexity.reasoning}

Current Task Context:
${taskContext}

Should this task be broken down before spawning a subagent? Return JSON.`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const content = response.choices[0]?.message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as BreakdownDecision;

        // Validate required fields
        if (
          typeof parsed.required === 'boolean' &&
          parsed.reasoning &&
          Array.isArray(parsed.suggestedSubtasks) &&
          Array.isArray(parsed.integrationConsiderations)
        ) {
          return parsed;
        }
      }
    } catch (error) {
      console.error('[SpawnValidator] Failed to determine breakdown requirement:', error);
    }

    // Fallback: require breakdown for complex tasks
    return {
      required: true,
      reasoning: 'Failed to parse LLM response - defaulting to require breakdown for safety',
      suggestedSubtasks: [
        'Break this task into smaller, focused subtasks',
        'Create a task breakdown plan',
        'Identify integration points',
      ],
      integrationConsiderations: ['Consider how subtasks will integrate'],
    };
  }

  /**
   * Build task context for breakdown decision
   */
  private buildTaskContext(memoryStore: MemoryStore): string {
    const tasks = memoryStore.getTasks();
    const goal = memoryStore.getGoal();

    const lines: string[] = [];

    if (goal) {
      lines.push(`Goal: ${goal.description}`);
      lines.push('');
    }

    if (tasks.length === 0) {
      lines.push('No existing tasks.');
      return lines.join('\n');
    }

    // Group tasks by status
    const completedTasks = tasks.filter(t => t.status === 'completed');
    const activeTasks = tasks.filter(t => t.status === 'active');
    const pendingTasks = tasks.filter(t => t.status === 'waiting');
    const blockedTasks = tasks.filter(t => t.status === 'blocked');

    if (completedTasks.length > 0) {
      lines.push(`Completed Tasks (${completedTasks.length}):`);
      for (const task of completedTasks.slice(-5)) {
        lines.push(`  - ${task.description}`);
        if (task.filesModified && task.filesModified.length > 0) {
          lines.push(`    Files: ${task.filesModified.join(', ')}`);
        }
      }
      if (completedTasks.length > 5) {
        lines.push(`  ... and ${completedTasks.length - 5} more`);
      }
      lines.push('');
    }

    if (activeTasks.length > 0) {
      lines.push(`Active Tasks (${activeTasks.length}):`);
      for (const task of activeTasks) {
        lines.push(`  - ${task.description}`);
        if (task.relatedFiles.length > 0) {
          lines.push(`    Files: ${task.relatedFiles.join(', ')}`);
        }
      }
      lines.push('');
    }

    if (pendingTasks.length > 0) {
      lines.push(`Pending Tasks (${pendingTasks.length}):`);
      for (const task of pendingTasks.slice(0, 10)) {
        lines.push(`  - ${task.description}`);
        if (task.parentId) {
          const parent = tasks.find(t => t.id === task.parentId);
          if (parent) {
            lines.push(`    Parent: ${parent.description}`);
          }
        }
      }
      if (pendingTasks.length > 10) {
        lines.push(`  ... and ${pendingTasks.length - 10} more`);
      }
      lines.push('');
    }

    if (blockedTasks.length > 0) {
      lines.push(`Blocked Tasks (${blockedTasks.length}):`);
      for (const task of blockedTasks) {
        lines.push(`  - ${task.description}`);
        if (task.blockedBy) {
          lines.push(`    Blocked by: ${task.blockedBy}`);
        }
      }
      lines.push('');
    }

    // Add hierarchical summary
    const topLevelTasks = tasks.filter(t => !t.parentId);
    const subtasks = tasks.filter(t => t.parentId);

    if (subtasks.length > 0) {
      lines.push(`Task Structure: ${topLevelTasks.length} top-level tasks, ${subtasks.length} subtasks`);
    }

    return lines.join('\n');
  }

  /**
   * Build error message when breakdown is required
   */
  private buildBreakdownCompletedMessage(
    task: string,
    taskId: string,
    subtaskIds: string[],
    subtaskDescriptions: string[],
    complexity: ComplexityAssessment,
    breakdownDecision: BreakdownDecision
  ): string {
    const lines: string[] = [
      'Task Automatically Broken Down',
      '',
      `The task "${task}" was too complex to execute directly.`,
      '',
      '✓ AUTOMATICALLY CREATED:',
      `  - Parent Task ID: ${taskId}`,
      `  - Created ${subtaskIds.length} subtasks`,
      '',
      'Complexity Assessment:',
      `  Rating: ${complexity.rating}`,
      `  Reasoning: ${complexity.reasoning}`,
      '',
    ];

    if (complexity.evidence.filesCount) {
      lines.push(`  Files involved: ~${complexity.evidence.filesCount}`);
    }
    if (complexity.evidence.functionsEstimate) {
      lines.push(`  Functions estimated: ~${complexity.evidence.functionsEstimate}`);
    }
    if (complexity.evidence.linesEstimate) {
      lines.push(`  Lines of code: ~${complexity.evidence.linesEstimate}`);
    }
    if (complexity.evidence.integrationPoints && complexity.evidence.integrationPoints.length > 0) {
      lines.push(`  Integration points: ${complexity.evidence.integrationPoints.join(', ')}`);
    }
    if (complexity.evidence.hasMultipleSteps) {
      lines.push(`  Multiple steps required: Yes`);
    }
    if (complexity.evidence.requiresCoordination) {
      lines.push(`  Requires coordination: Yes`);
    }

    lines.push('');
    lines.push('Breakdown Reasoning:');
    lines.push(`  ${breakdownDecision.reasoning}`);
    lines.push('');

    lines.push('Created Subtasks:');
    for (let i = 0; i < subtaskDescriptions.length; i++) {
      lines.push(`  ${i + 1}. [${subtaskIds[i]}] ${subtaskDescriptions[i]}`);
    }
    lines.push('');

    if (breakdownDecision.integrationConsiderations.length > 0) {
      lines.push('Integration Considerations:');
      for (const consideration of breakdownDecision.integrationConsiderations) {
        lines.push(`  - ${consideration}`);
      }
      lines.push('');
    }

    lines.push('NEXT STEPS:');
    lines.push('  1. Review the created subtasks above');
    lines.push('  2. If more tasks are required any subtask is still too complex or more subtasks are required in order to adequately cover the entire scope of the task/subtask, use break_down_task to further break it down');
    lines.push('  3. Once tasks and subtasks are appropriately scoped, spawn subagents for each or work on them directly');
    lines.push('  4. Consider adding tasks for the integration items if still required. ')
    lines.push('');
    lines.push('To further break down a complex subtask, use:');
    lines.push('  break_down_task({');
    lines.push('    "task_id": "<subtask_id>",');
    lines.push('    "subtasks": [');
    lines.push('      { "description": "..." },');
    lines.push('      { "description": "..." }');
    lines.push('    ]');
    lines.push('  })');
    lines.push('');
    lines.push('You can also use list_tasks to see all tasks and their hierarchy.');

    return lines.join('\n');
  }
}
