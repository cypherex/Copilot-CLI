// SpawnValidator - validates subagent spawn requests and enforces task breakdown

import type { LLMClient, ChatMessage } from '../llm/types.js';
import type { Task, MemoryStore } from '../memory/types.js';
import { uiState } from '../ui/ui-state.js';

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
  useRecursiveBreakdown?: boolean; // If true, perform full recursive breakdown
  maxBreakdownDepth?: number; // Max depth for recursive breakdown (default: 4)
  verbose?: boolean; // If true, enable verbose logging during breakdown
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
  recursiveBreakdownResult?: RecursiveBreakdownResult; // If recursive breakdown was used
  breakdownComplete?: boolean; // True if all tasks are ready to spawn
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

// Task tree node for recursive breakdown
export interface TaskNode {
  description: string;
  complexity: ComplexityAssessment;
  subtasks?: TaskNode[];
  integrationPoints?: {
    integrates_with: string; // Task description or component
    requirement: string;
    dataContract?: string;
  }[];
  produces?: string[];
  consumes?: string[];
  designDecisions?: {
    decision: string;
    reasoning: string;
    alternatives?: string[];
    affects: string[];
    scope: 'global' | 'module' | 'task';
  }[];
  readyToSpawn: boolean; // True if this task is simple/moderate enough to execute
  breakdownDepth: number;
}

// Result of recursive breakdown
export interface RecursiveBreakdownResult {
  taskTree: TaskNode;
  totalTasks: number;
  readyTasks: number; // Tasks that can be spawned immediately
  maxDepth: number;
  allIntegrationPoints: any[];
  allDesignDecisions: any[];
  breakdownComplete: boolean; // True if all leaf tasks are ready to spawn
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

    // If recursive breakdown is requested, perform it
    if (context.useRecursiveBreakdown) {
      return await this.validateSpawnWithRecursiveBreakdown(context);
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
   * Validate spawn with full recursive breakdown
   */
  private async validateSpawnWithRecursiveBreakdown(
    context: SpawnValidationContext
  ): Promise<SpawnValidationResult> {
    // Perform full recursive breakdown
    const breakdownResult = await this.recursiveBreakdownWithContext(
      context.task,
      context.memoryStore,
      {
        maxDepth: context.maxBreakdownDepth || 4,
        verbose: context.verbose ?? false,
      }
    );

    // Create task hierarchy in memory store
    const { rootTaskId, allTaskIds } = this.createTaskHierarchy(
      breakdownResult.taskTree,
      context.memoryStore
    );

    // Build comprehensive message
    const message = this.buildRecursiveBreakdownMessage(
      context.task,
      rootTaskId,
      breakdownResult
    );

    return {
      allowed: false, // Don't allow spawning the root task - use subtasks instead
      requiresBreakdown: true,
      complexity: breakdownResult.taskTree.complexity,
      recursiveBreakdownResult: breakdownResult,
      breakdownComplete: breakdownResult.breakdownComplete,
      reason: 'Task fully broken down with recursive analysis',
      autoCreatedTask: {
        taskId: rootTaskId,
        subtaskIds: allTaskIds.slice(1), // All except root
      },
      suggestedMessage: message,
    };
  }

  /**
   * Build message for recursive breakdown result
   */
  private buildRecursiveBreakdownMessage(
    task: string,
    rootTaskId: string,
    result: RecursiveBreakdownResult
  ): string {
    const lines: string[] = [
      '═══════════════════════════════════════════════════════════',
      'RECURSIVE TASK BREAKDOWN COMPLETE',
      '═══════════════════════════════════════════════════════════',
      '',
      `Original Task: "${task}"`,
      `Root Task ID: ${rootTaskId}`,
      '',
      'BREAKDOWN STATISTICS:',
      `  Total Tasks Created: ${result.totalTasks}`,
      `  Ready to Spawn: ${result.readyTasks}`,
      `  Max Breakdown Depth: ${result.maxDepth}`,
      `  Breakdown Complete: ${result.breakdownComplete ? '✓ YES' : '✗ NO - Some tasks need manual breakdown'}`,
      '',
    ];

    if (result.allDesignDecisions.length > 0) {
      lines.push('DESIGN DECISIONS IDENTIFIED:');
      for (const decision of result.allDesignDecisions) {
        lines.push(`  • ${decision.decision}`);
        lines.push(`    Reasoning: ${decision.reasoning}`);
        lines.push(`    Scope: ${decision.scope}`);
        lines.push(`    Affects: ${decision.affects.join(', ')}`);
        lines.push('');
      }
    }

    if (result.allIntegrationPoints.length > 0) {
      lines.push('INTEGRATION POINTS IDENTIFIED:');
      for (const point of result.allIntegrationPoints) {
        lines.push(`  • ${point.integrates_with}`);
        lines.push(`    Requirement: ${point.requirement}`);
        if (point.dataContract) {
          lines.push(`    Contract: ${point.dataContract}`);
        }
        lines.push('');
      }
    }

    lines.push('NEXT STEPS:');
    if (result.breakdownComplete) {
      lines.push('  ✓ All tasks are appropriately scoped!');
      lines.push('  1. Review the task hierarchy using list_tasks');
      lines.push('  2. Review integration points and design decisions');
      lines.push('  3. Spawn subagents for leaf tasks or work on them directly');
      lines.push('  4. Tasks are already ordered by dependency - start with tasks that have no "consumes"');
    } else {
      lines.push('  ⚠ Some tasks still need further breakdown:');
      lines.push('  1. Use list_tasks to see the full hierarchy');
      lines.push('  2. Identify tasks marked as complex but at max depth');
      lines.push('  3. Manually break down those tasks using break_down_task');
      lines.push('  4. Then proceed with spawning subagents');
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
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

  /**
   * Batched complexity analysis - analyze multiple tasks in a single LLM call
   */
  async batchAssessComplexity(tasks: string[]): Promise<Map<string, ComplexityAssessment>> {
    if (tasks.length === 0) {
      return new Map();
    }

    if (tasks.length === 1) {
      const assessment = await this.assessTaskComplexity(tasks[0]);
      return new Map([[tasks[0], assessment]]);
    }

    const systemPrompt = `You are a task complexity analyzer. Analyze multiple tasks in batch and return complexity assessments for each.

For each task, determine:
- Rating: simple | moderate | complex
- Evidence: files, functions, lines, integration points, steps, coordination needs
- Reasoning: Why this rating was chosen

Complexity Guidelines:
- SIMPLE: Single file, single function/class, < 50 lines, no integration, 1-2 steps
- MODERATE: 2-3 files, 2-5 functions, 50-200 lines, minimal integration, 3-5 steps
- COMPLEX: 4+ files, 6+ functions, 200+ lines, multiple integrations, 6+ steps

Return ONLY valid JSON array with one assessment per task IN THE SAME ORDER.`;

    const userPrompt = `Analyze these ${tasks.length} tasks for complexity:

${tasks.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Return JSON array: [
  {
    "rating": "simple" | "moderate" | "complex",
    "evidence": { "filesCount": <number>, "functionsEstimate": <number>, "linesEstimate": <number>, "integrationPoints": [<array>], "hasMultipleSteps": <boolean>, "requiresCoordination": <boolean> },
    "reasoning": "<explanation>"
  },
  ...
]`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const content = response.choices[0]?.message.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as ComplexityAssessment[];

        if (Array.isArray(parsed) && parsed.length === tasks.length) {
          const result = new Map<string, ComplexityAssessment>();
          for (let i = 0; i < tasks.length; i++) {
            result.set(tasks[i], parsed[i]);
          }
          return result;
        }
      }
    } catch (error) {
      console.error('[SpawnValidator] Batch complexity assessment failed:', error);
    }

    // Fallback: assess individually
    const result = new Map<string, ComplexityAssessment>();
    for (const task of tasks) {
      result.set(task, await this.assessTaskComplexity(task));
    }
    return result;
  }

  /**
   * Recursive task breakdown with full context preservation
   * This performs a complete breakdown until all leaf tasks are simple/moderate
   */
  async recursiveBreakdownWithContext(
    rootTask: string,
    memoryStore: MemoryStore,
    options: {
      maxDepth?: number;
      parentContext?: {
        projectGoal?: string;
        designDecisions?: any[];
        integrationPoints?: any[];
        siblingTasks?: string[];
      };
      verbose?: boolean;
    } = {}
  ): Promise<RecursiveBreakdownResult> {
    const maxDepth = options.maxDepth || 4;
    const verbose = options.verbose ?? false;
    const parentContext = options.parentContext || {
      projectGoal: memoryStore.getGoal()?.description || '',
      designDecisions: [],
      integrationPoints: [],
      siblingTasks: [],
    };

    if (verbose) {
      this.logVerbose('\n═══════════════════════════════════════════════════════════');
      this.logVerbose('STARTING RECURSIVE TASK BREAKDOWN');
      this.logVerbose('═══════════════════════════════════════════════════════════');
      this.logVerbose(`Root Task: "${rootTask}"`);
      this.logVerbose(`Max Depth: ${maxDepth}`);
      this.logVerbose(`Project Goal: ${parentContext.projectGoal || 'None'}`);
      this.logVerbose('');
    }

    const taskTree = await this.breakdownNode(
      rootTask,
      0,
      maxDepth,
      parentContext,
      memoryStore,
      verbose
    );

    // Small delay before collecting stats
    if (verbose) {
      await this.sleep(500);
    }

    // Collect statistics
    const stats = this.collectTreeStats(taskTree);

    if (verbose) {
      this.logVerbose('\n═══════════════════════════════════════════════════════════');
      this.logVerbose('BREAKDOWN COMPLETE');
      this.logVerbose('═══════════════════════════════════════════════════════════');
      this.logVerbose(`Total Tasks: ${stats.totalTasks}`);
      this.logVerbose(`Ready Tasks: ${stats.readyTasks}`);
      this.logVerbose(`Max Depth Reached: ${stats.maxDepth}`);
      this.logVerbose(`Integration Points: ${stats.allIntegrationPoints.length}`);
      this.logVerbose(`Design Decisions: ${stats.allDesignDecisions.length}`);
      this.logVerbose('');
    }

    return {
      taskTree,
      totalTasks: stats.totalTasks,
      readyTasks: stats.readyTasks,
      maxDepth: stats.maxDepth,
      allIntegrationPoints: stats.allIntegrationPoints,
      allDesignDecisions: stats.allDesignDecisions,
      // Breakdown is complete if all leaf tasks are ready (root doesn't count as it's not directly spawnable)
      breakdownComplete: stats.readyTasks === (stats.totalTasks - 1) || (stats.totalTasks === 1 && stats.readyTasks === 1),
    };
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log verbose message to UI state (for ask mode capture) and console (for demos)
   */
  private logVerbose(message: string): void {
    // Always log to console for demos and debugging
    console.log(message);

    // Also try to add to uiState for ask mode logging (won't throw if uiState not initialized)
    try {
      uiState.addMessage({
        role: 'system',
        content: message,
        timestamp: Date.now(),
      });
    } catch (error) {
      // Silently ignore - console.log above will handle output
    }
  }

  /**
   * Recursively break down a single task node
   */
  private async breakdownNode(
    taskDescription: string,
    currentDepth: number,
    maxDepth: number,
    parentContext: any,
    memoryStore: MemoryStore,
    verbose: boolean = false
  ): Promise<TaskNode> {
    const indent = '  '.repeat(currentDepth);

    if (verbose) {
      this.logVerbose(`${indent}[Depth ${currentDepth}] Analyzing: "${taskDescription}"`);
    }

    // Sleep before complexity assessment
    await this.sleep(300);

    // Assess complexity
    const complexity = await this.assessTaskComplexity(taskDescription);

    if (verbose) {
      this.logVerbose(`${indent}  → Complexity: ${complexity.rating.toUpperCase()}`);
    }

    // If simple or moderate, this is a leaf node - ready to spawn
    if (complexity.rating === 'simple' || complexity.rating === 'moderate') {
      if (verbose) {
        this.logVerbose(`${indent}  ✓ Ready to spawn (leaf task)`);
      }
      return {
        description: taskDescription,
        complexity,
        readyToSpawn: true,
        breakdownDepth: currentDepth,
      };
    }

    // Complex task - check if we should break it down
    if (currentDepth >= maxDepth) {
      if (verbose) {
        this.logVerbose(`${indent}  ⚠ Max depth reached - cannot break down further`);
      }
      // Hit max depth - mark as needing manual breakdown
      return {
        description: taskDescription,
        complexity,
        readyToSpawn: false, // NOT ready - too complex and at max depth
        breakdownDepth: currentDepth,
      };
    }

    if (verbose) {
      this.logVerbose(`${indent}  ⚙ Breaking down into subtasks...`);
    }

    // Sleep before breakdown analysis
    await this.sleep(500);

    // Perform breakdown with full context
    const breakdownResult = await this.analyzeTaskWithFullContext(
      taskDescription,
      complexity,
      parentContext,
      memoryStore
    );

    if (!breakdownResult.requiresBreakdown) {
      if (verbose) {
        this.logVerbose(`${indent}  → LLM decided breakdown not needed`);
        this.logVerbose(`${indent}  ✓ Ready to spawn`);
      }
      // LLM decided breakdown not needed despite complexity
      return {
        description: taskDescription,
        complexity,
        readyToSpawn: true,
        breakdownDepth: currentDepth,
        designDecisions: breakdownResult.designDecisions,
        integrationPoints: breakdownResult.integrationPoints,
      };
    }

    if (verbose) {
      this.logVerbose(`${indent}  → Created ${breakdownResult.subtasks.length} subtasks`);
      if (breakdownResult.designDecisions?.length) {
        this.logVerbose(`${indent}  → Captured ${breakdownResult.designDecisions.length} design decisions`);
      }
      if (breakdownResult.integrationPoints?.length) {
        this.logVerbose(`${indent}  → Identified ${breakdownResult.integrationPoints.length} integration points`);
      }
    }

    // Break down into subtasks and recursively analyze each
    const enrichedContext = {
      ...parentContext,
      designDecisions: [...parentContext.designDecisions, ...(breakdownResult.designDecisions || [])],
      integrationPoints: [...parentContext.integrationPoints, ...(breakdownResult.integrationPoints || [])],
    };

    // Process subtasks in batches to balance speed and rate limiting
    const subtaskDescriptions = breakdownResult.subtasks.map((st: any) => st.description);
    const batchSize = 5; // Process 5 tasks at a time

    if (verbose) {
      this.logVerbose(`${indent}  ⤷ Analyzing ${subtaskDescriptions.length} subtasks recursively (batches of ${batchSize})...`);
    }

    const subtaskNodes: TaskNode[] = [];
    for (let i = 0; i < subtaskDescriptions.length; i += batchSize) {
      const batch = subtaskDescriptions.slice(i, i + batchSize);

      if (verbose && subtaskDescriptions.length > batchSize) {
        this.logVerbose(`${indent}    [Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(subtaskDescriptions.length / batchSize)}] Processing ${batch.length} tasks...`);
      }

      // Process batch in parallel
      const batchNodes = await Promise.all(
        batch.map((desc: string) =>
          this.breakdownNode(
            desc,
            currentDepth + 1,
            maxDepth,
            enrichedContext,
            memoryStore,
            verbose
          )
        )
      );

      subtaskNodes.push(...batchNodes);

      // Delay between batches (but not after the last batch)
      if (i + batchSize < subtaskDescriptions.length) {
        await this.sleep(1000); // 1 second between batches
      }
    }

    if (verbose) {
      this.logVerbose(`${indent}  ✓ Completed breakdown`);
    }

    return {
      description: taskDescription,
      complexity,
      subtasks: subtaskNodes,
      integrationPoints: breakdownResult.integrationPoints,
      designDecisions: breakdownResult.designDecisions,
      readyToSpawn: false, // Parent node - not directly spawnable
      breakdownDepth: currentDepth,
    };
  }

  /**
   * Analyze task with full context including integration points and design decisions
   */
  private async analyzeTaskWithFullContext(
    task: string,
    complexity: ComplexityAssessment,
    parentContext: any,
    memoryStore: MemoryStore
  ): Promise<any> {
    const systemPrompt = `You are an expert task breakdown specialist with a focus on EXHAUSTIVE, PRODUCTION-READY planning.

CRITICAL COMPLETENESS REQUIREMENTS:

1. SPECIFICATION COVERAGE - If you see keywords that imply multiple items, create tasks for ALL:
   - "types" → separate tasks for EACH type (integer, float, string, char, boolean, etc.)
   - "operators" → separate tasks for EACH category (arithmetic, comparison, logical, bitwise, assignment)
   - "literals" → separate tasks for integers, floats, strings, chars, booleans
   - "comments" → separate tasks for single-line, multi-line, doc comments
   - "error handling" → separate tasks for detection, recovery, reporting, formatting

2. FEATURE COMPLETENESS - Don't generalize when specifics are implied:
   - "string literals" → Must include: single-line, multi-line, escape sequences, Unicode
   - "number parsing" → Must include: integers (decimal/hex/binary), floats, scientific notation
   - "tokenization" → Must include: keywords, identifiers, operators, delimiters, literals, whitespace
   - "testing" → Must include: unit tests, integration tests, edge cases, error cases

3. GRANULARITY - Create focused, single-purpose tasks:
   - DON'T: "Implement literal parsing" (too broad)
   - DO: Separate tasks for integer literals, float literals, string literals, character literals, boolean literals
   - DON'T: "Handle comments" (vague)
   - DO: Separate tasks for single-line comments, multi-line comments, doc comments

4. IMPLEMENTATION DETAILS - Don't forget the "boring" but necessary tasks:
   - Data structure definitions (enums, structs, traits)
   - Error types and error messages
   - Helper functions and utilities
   - Iterator/trait implementations
   - Output formatting
   - EOF and special token handling

5. MISSING TASKS DETECTION - In "missingTasks", flag ANY aspect not explicitly covered:
   - Look for implementation requirements (single-pass, no backtracking, etc.)
   - Look for output requirements (Vec<Token>, specific formats)
   - Look for edge cases (empty input, invalid UTF-8, etc.)
   - Look for integration requirements (API contracts, data structures)

Return ONLY valid JSON in this exact format:
{
  "requiresBreakdown": <boolean>,
  "reasoning": "<why breakdown is/isn't needed>",
  "coverageAnalysis": "<DETAILED analysis: list EVERY aspect of the task and confirm each is covered by a subtask>",
  "subtasks": [
    {
      "description": "<SPECIFIC, focused task description>",
      "produces": [<array of concrete outputs: enums, functions, data structures>],
      "consumes": [<array of specific inputs from other tasks>],
      "covers": "<EXACTLY which requirement/aspect this addresses>"
    },
    ...
  ],
  "integrationPoints": [
    {
      "integrates_with": "<specific component name>",
      "requirement": "<precise technical requirement>",
      "dataContract": "<exact interface/type signature expected>"
    },
    ...
  ],
  "designDecisions": [
    {
      "decision": "<what was decided>",
      "reasoning": "<technical justification>",
      "alternatives": [<other options with pros/cons>],
      "affects": [<specific task/component names>],
      "scope": "global" | "module" | "task"
    },
    ...
  ],
  "missingTasks": [
    "<List ANY aspect of the task not explicitly covered by a subtask>",
    ...
  ]
}`;

    const taskContext = this.buildTaskContext(memoryStore);
    const userPrompt = `EXHAUSTIVE TASK BREAKDOWN - Production-Ready Planning

Task to Break Down: "${task}"

Complexity Assessment:
- Rating: ${complexity.rating}
- Evidence: ${JSON.stringify(complexity.evidence, null, 2)}
- Reasoning: ${complexity.reasoning}

Project Context:
- Goal: ${parentContext.projectGoal}
- Existing Design Decisions: ${parentContext.designDecisions.length}
- Known Integration Points: ${parentContext.integrationPoints.length}

Current Task Context:
${taskContext}

MANDATORY COMPLETENESS CHECKLIST:

Step 1: ENUMERATE ALL ASPECTS
List EVERY component, feature, type, operation, edge case implied by the task.
Example: If task is "Implement lexer", list: token types, keywords, operators, delimiters, literals (integers, floats, strings, chars, booleans), comments (single, multi, doc), whitespace, indentation, position tracking, error recovery, EOF, output format, iterator implementation.

Step 2: CREATE GRANULAR SUBTASKS
For EACH aspect from Step 1, create a focused subtask.
- If an aspect has multiple variations (like "literals"), create separate subtasks for EACH variation.
- If an implementation requirement exists (like "single-pass"), create a task to ensure it.
- Don't combine unrelated aspects into one task.

Step 3: VERIFY COMPLETE COVERAGE
For each aspect identified in Step 1, confirm there's a corresponding subtask.
List any aspects WITHOUT a subtask in "missingTasks".

Step 4: DOCUMENT TECHNICAL DETAILS
For each subtask, specify:
- What it produces (concrete types, functions, data structures)
- What it consumes (specific dependencies)
- What requirement it satisfies

QUALITY STANDARDS:
- Aim for 15-30 subtasks for a complex system component (lexer, parser, etc.)
- Each subtask should be simple or moderate complexity
- Each subtask should be implementable in 1-3 files, 50-200 lines
- No subtask should require further breakdown

Return JSON with EXHAUSTIVE breakdown.`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const content = response.choices[0]?.message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed;
      }
    } catch (error) {
      console.error('[SpawnValidator] Context-aware breakdown failed:', error);
    }

    // Fallback
    return {
      requiresBreakdown: true,
      reasoning: 'Failed to parse LLM response - using fallback',
      subtasks: [
        { description: 'Break this task into smaller parts', produces: [], consumes: [] },
        { description: 'Identify integration requirements', produces: [], consumes: [] },
      ],
      integrationPoints: [],
      designDecisions: [],
    };
  }

  /**
   * Collect statistics from the task tree
   */
  private collectTreeStats(node: TaskNode): {
    totalTasks: number;
    readyTasks: number;
    maxDepth: number;
    allIntegrationPoints: any[];
    allDesignDecisions: any[];
  } {
    let totalTasks = 1;
    let readyTasks = node.readyToSpawn ? 1 : 0;
    let maxDepth = node.breakdownDepth;
    const allIntegrationPoints = [...(node.integrationPoints || [])];
    const allDesignDecisions = [...(node.designDecisions || [])];

    if (node.subtasks) {
      for (const subtask of node.subtasks) {
        const subtaskStats = this.collectTreeStats(subtask);
        totalTasks += subtaskStats.totalTasks;
        readyTasks += subtaskStats.readyTasks;
        maxDepth = Math.max(maxDepth, subtaskStats.maxDepth);
        allIntegrationPoints.push(...subtaskStats.allIntegrationPoints);
        allDesignDecisions.push(...subtaskStats.allDesignDecisions);
      }
    }

    return { totalTasks, readyTasks, maxDepth, allIntegrationPoints, allDesignDecisions };
  }

  /**
   * Create tasks in memory store from the task tree
   */
  createTaskHierarchy(
    taskTree: TaskNode,
    memoryStore: MemoryStore,
    parentTaskId?: string
  ): { rootTaskId: string; allTaskIds: string[] } {
    const allTaskIds: string[] = [];

    // Create the current task
    const task = memoryStore.addTask({
      description: taskTree.description,
      status: parentTaskId ? 'waiting' : 'active',
      priority: 'high',
      parentId: parentTaskId,
      relatedFiles: [],
      estimatedComplexity: taskTree.complexity.rating,
      breakdownDepth: taskTree.breakdownDepth,
      produces: taskTree.produces,
      consumes: taskTree.consumes,
      breakdownComplete: taskTree.readyToSpawn || (taskTree.subtasks?.every(st => st.readyToSpawn) ?? false),
    });

    allTaskIds.push(task.id);
    const rootTaskId = task.id;

    // Add integration points for this task
    if (taskTree.integrationPoints) {
      for (const point of taskTree.integrationPoints) {
        const integrationPoint = memoryStore.addIntegrationPoint({
          sourceTask: task.id,
          requirement: point.requirement,
          dataContract: point.dataContract,
          targetComponent: point.integrates_with,
        });
        // Link to task
        const integrationPointIds = task.integrationPointIds || [];
        integrationPointIds.push(integrationPoint.id);
        memoryStore.updateTask(task.id, { integrationPointIds });
      }
    }

    // Add design decisions for this task
    if (taskTree.designDecisions) {
      for (const decision of taskTree.designDecisions) {
        const designDecision = memoryStore.addDesignDecision({
          decision: decision.decision,
          reasoning: decision.reasoning,
          alternatives: decision.alternatives,
          affects: decision.affects,
          scope: decision.scope,
          createdDuringBreakdown: true,
          parentTaskId: task.id,
        });
        // Link to task
        const designDecisionIds = task.designDecisionIds || [];
        designDecisionIds.push(designDecision.id);
        memoryStore.updateTask(task.id, { designDecisionIds });
      }
    }

    // Recursively create subtasks
    if (taskTree.subtasks) {
      for (const subtaskNode of taskTree.subtasks) {
        const result = this.createTaskHierarchy(subtaskNode, memoryStore, task.id);
        allTaskIds.push(...result.allTaskIds);
      }
    }

    return { rootTaskId, allTaskIds };
  }
}
