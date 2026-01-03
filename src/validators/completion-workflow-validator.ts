// Completion Workflow Validator - validates task completion workflow and suggests next steps

import type { LLMClient, ChatMessage } from '../llm/types.js';
import type { Task } from '../memory/types.js';

// Input context for completion validation
export interface CompletionValidationContext {
  completedTask: Task;
  allTasks: Task[];
  completedTaskFiles: string[];
}

// Result of completion validation
export interface CompletionValidationResult {
  allowed: boolean;
  blockReason?: string;
  warnings?: string[];
  suggestions?: string[];
}

// Analysis of next task in workflow
export interface NextTaskAnalysis {
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

// Full workflow analysis
export interface WorkflowAnalysis {
  nextTask?: NextTaskAnalysis;
  workflowContinuity: {
    hasLogicalNext: boolean;
    reason: string;
  };
}

const WORKFLOW_ANALYSIS_SYSTEM_PROMPT = `You are a workflow analysis expert. Your job is to analyze a completed task and determine the logical next task in the workflow.

Analyze the workflow state and return ONLY valid JSON in this exact format:
{
  "nextTask": {
    "nextTaskId": "task_id or null",
    "nextTaskDescription": "description or null",
    "needsBreakdown": true/false,
    "breakdownReason": "why it needs breakdown (if needsBreakdown is true)",
    "hasIntegrationDependencies": true/false,
    "integrationFiles": ["file1.ts", "file2.ts"],
    "reviewTasks": [
      {
        "taskId": "task_id",
        "description": "task description",
        "reason": "why this should be reviewed"
      }
    ]
  },
  "workflowContinuity": {
    "hasLogicalNext": true/false,
    "reason": "explanation"
  }
}

Rules for analysis:
1. Consider task dependencies (some tasks must come before others)
2. Consider workflow order (e.g., design → implementation → testing)
3. Identify if next task is complex and needs breakdown into subtasks
4. Detect integration dependencies (next task modifying files from completed tasks)
5. Suggest which completed tasks should be reviewed before starting next task
6. If no remaining tasks but work seems incomplete, indicate this in workflowContinuity

Return only the JSON object, nothing else.`;

export class CompletionWorkflowValidator {
  constructor(private llmClient: LLMClient) {}

  /**
   * Validate that completing a task makes sense in the workflow
   */
  async validateCompletion(
    context: CompletionValidationContext
  ): Promise<CompletionValidationResult> {
    const { completedTask, allTasks, completedTaskFiles } = context;

    // Get workflow analysis
    const analysis = await this.analyzeWorkflowState(
      completedTask,
      allTasks,
      completedTaskFiles
    );

    const result: CompletionValidationResult = {
      allowed: true,
      warnings: [],
      suggestions: [],
    };

    // Check if there are remaining tasks
    const remainingTasks = allTasks.filter(
      t => t.status !== 'completed' && t.status !== 'abandoned'
    );

    // If no next task suggested but remaining tasks exist, BLOCK
    if (!analysis.nextTask && remainingTasks.length > 0) {
      return {
        allowed: false,
        blockReason: this.buildNextTaskRequiredMessage(
          completedTask,
          remainingTasks,
          analysis.workflowContinuity
        ),
      };
    }

    // If next task suggested, validate and provide guidance
    if (analysis.nextTask && analysis.nextTask.nextTaskId) {
      const nextTask = allTasks.find(t => t.id === analysis.nextTask!.nextTaskId);

      if (!nextTask) {
        result.warnings!.push(
          `Suggested next task "${analysis.nextTask.nextTaskId}" not found in task list`
        );
      } else {
        // Check if next task needs breakdown
        if (analysis.nextTask.needsBreakdown) {
          result.warnings!.push(
            `Next task "${nextTask.description}" is complex and should be broken down`
          );
          if (analysis.nextTask.breakdownReason) {
            result.suggestions!.push(
              `Breakdown suggestion: ${analysis.nextTask.breakdownReason}`
            );
          }
          result.suggestions!.push(
            `Consider using break_down_task tool to decompose into 3-7 focused subtasks`
          );
        }

        // Check for integration dependencies
        if (analysis.nextTask.hasIntegrationDependencies) {
          const files = analysis.nextTask.integrationFiles || [];
          if (files.length > 0) {
            result.warnings!.push(
              `Next task has integration dependencies with completed task files: ${files.join(', ')}`
            );
            result.suggestions!.push(
              `Review these files before starting: ${files.join(', ')}`
            );
          }
        }

        // Suggest reviewing related completed tasks
        if (analysis.nextTask.reviewTasks && analysis.nextTask.reviewTasks.length > 0) {
          result.suggestions!.push(
            `Review these completed tasks before starting next task:`
          );
          for (const reviewTask of analysis.nextTask.reviewTasks) {
            result.suggestions!.push(
              `  - "${reviewTask.description}": ${reviewTask.reason}`
            );
          }
        }

        // Add general next steps
        result.suggestions!.push(
          `Next recommended task: "${nextTask.description}" (ID: ${nextTask.id})`
        );
      }
    }

    // Clean up empty arrays
    if (result.warnings?.length === 0) delete result.warnings;
    if (result.suggestions?.length === 0) delete result.suggestions;

    return result;
  }

  /**
   * Analyze the workflow state to determine next task
   * Makes a SEPARATE LLM call for workflow analysis
   */
  async analyzeWorkflowState(
    completedTask: Task,
    allTasks: Task[],
    completedTaskFiles: string[]
  ): Promise<WorkflowAnalysis> {
    // Build comprehensive task context
    const taskContext = this.buildTaskContext(completedTask, allTasks, completedTaskFiles);

    const userPrompt = `Analyze the workflow state and determine the next logical task.

${taskContext}

Provide workflow analysis as JSON.`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: WORKFLOW_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);

      const content = response.choices[0]?.message.content || '';

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as WorkflowAnalysis;
          return this.validateAndNormalizeAnalysis(parsed);
        } catch (parseError) {
          console.warn('[WorkflowValidator] Failed to parse LLM response:', parseError);
          return this.createFallbackAnalysis(allTasks);
        }
      }

      return this.createFallbackAnalysis(allTasks);
    } catch (error) {
      console.error('[WorkflowValidator] LLM call failed:', error);
      return this.createFallbackAnalysis(allTasks);
    }
  }

  /**
   * Build full task context for LLM analysis
   */
  private buildTaskContext(
    completedTask: Task,
    allTasks: Task[],
    completedTaskFiles: string[]
  ): string {
    const parts: string[] = [];

    // Completed task info
    parts.push('## Just Completed Task');
    parts.push(`ID: ${completedTask.id}`);
    parts.push(`Description: ${completedTask.description}`);
    parts.push(`Priority: ${completedTask.priority}`);
    if (completedTaskFiles.length > 0) {
      parts.push(`Modified Files: ${completedTaskFiles.join(', ')}`);
    }
    parts.push('');

    // All completed tasks with their files
    const completedTasks = allTasks.filter(t => t.status === 'completed');
    if (completedTasks.length > 1) {
      parts.push('## Previously Completed Tasks');
      for (const task of completedTasks) {
        if (task.id === completedTask.id) continue;
        parts.push(`- [${task.id}] ${task.description}`);
        if (task.relatedFiles && task.relatedFiles.length > 0) {
          parts.push(`  Files: ${task.relatedFiles.join(', ')}`);
        }
      }
      parts.push('');
    }

    // Remaining tasks
    const remainingTasks = allTasks.filter(
      t => t.status !== 'completed' && t.status !== 'abandoned'
    );
    if (remainingTasks.length > 0) {
      parts.push('## Remaining Tasks');
      for (const task of remainingTasks) {
        parts.push(`- [${task.id}] ${task.description}`);
        parts.push(`  Status: ${task.status}`);
        parts.push(`  Priority: ${task.priority}`);
        if (task.parentId) {
          parts.push(`  Parent: ${task.parentId}`);
        }
        if (task.blockedBy) {
          parts.push(`  Blocked by: ${task.blockedBy}`);
        }
        if (task.relatedFiles && task.relatedFiles.length > 0) {
          parts.push(`  Related files: ${task.relatedFiles.join(', ')}`);
        }
      }
      parts.push('');
    }

    // Task hierarchy (show parent-child relationships)
    const taskHierarchy = this.buildTaskHierarchy(allTasks);
    if (taskHierarchy) {
      parts.push('## Task Hierarchy');
      parts.push(taskHierarchy);
      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Build task hierarchy visualization
   */
  private buildTaskHierarchy(allTasks: Task[]): string | null {
    const rootTasks = allTasks.filter(t => !t.parentId);
    if (rootTasks.length === 0) return null;

    const lines: string[] = [];

    const addTaskWithChildren = (task: Task, indent: string = '') => {
      const status = task.status === 'completed' ? '✓' :
                     task.status === 'active' ? '●' :
                     task.status === 'blocked' ? '⛔' : '○';
      lines.push(`${indent}${status} ${task.description} [${task.id}]`);

      const children = allTasks.filter(t => t.parentId === task.id);
      for (const child of children) {
        addTaskWithChildren(child, indent + '  ');
      }
    };

    for (const rootTask of rootTasks) {
      addTaskWithChildren(rootTask);
    }

    return lines.join('\n');
  }

  /**
   * Build message when next task is required but not identified
   */
  private buildNextTaskRequiredMessage(
    completedTask: Task,
    remainingTasks: Task[],
    workflowContinuity: WorkflowAnalysis['workflowContinuity']
  ): string {
    const parts: string[] = [];

    parts.push(`Cannot complete workflow: "${completedTask.description}" is done, but workflow analysis could not determine the next logical task.`);
    parts.push('');
    parts.push(`Remaining tasks: ${remainingTasks.length}`);

    if (workflowContinuity.reason) {
      parts.push('');
      parts.push(`Analysis: ${workflowContinuity.reason}`);
    }

    parts.push('');
    parts.push('Suggestions:');
    parts.push('1. Review remaining tasks and identify dependencies');
    parts.push('2. Update task descriptions to clarify workflow order');
    parts.push('3. Set blockedBy/waitingFor fields to establish dependencies');
    parts.push('4. Use list_tasks to see all remaining work');

    return parts.join('\n');
  }

  /**
   * Validate and normalize LLM analysis response
   */
  private validateAndNormalizeAnalysis(analysis: any): WorkflowAnalysis {
    const normalized: WorkflowAnalysis = {
      nextTask: analysis.nextTask ? {
        nextTaskId: analysis.nextTask.nextTaskId || undefined,
        nextTaskDescription: analysis.nextTask.nextTaskDescription || undefined,
        needsBreakdown: Boolean(analysis.nextTask.needsBreakdown),
        breakdownReason: analysis.nextTask.breakdownReason || undefined,
        hasIntegrationDependencies: Boolean(analysis.nextTask.hasIntegrationDependencies),
        integrationFiles: Array.isArray(analysis.nextTask.integrationFiles)
          ? analysis.nextTask.integrationFiles
          : undefined,
        reviewTasks: Array.isArray(analysis.nextTask.reviewTasks)
          ? analysis.nextTask.reviewTasks
          : undefined,
      } : undefined,
      workflowContinuity: {
        hasLogicalNext: Boolean(analysis.workflowContinuity?.hasLogicalNext),
        reason: analysis.workflowContinuity?.reason || 'No analysis provided',
      },
    };

    return normalized;
  }

  /**
   * Create fallback analysis when LLM fails
   */
  private createFallbackAnalysis(allTasks: Task[]): WorkflowAnalysis {
    const remainingTasks = allTasks.filter(
      t => t.status !== 'completed' && t.status !== 'abandoned'
    );

    // Try to find next task by priority
    const sortedTasks = remainingTasks.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] || 0;
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] || 0;
      return bPriority - aPriority;
    });

    const nextTask = sortedTasks[0];

    return {
      nextTask: nextTask ? {
        nextTaskId: nextTask.id,
        nextTaskDescription: nextTask.description,
        needsBreakdown: false,
        hasIntegrationDependencies: false,
      } : undefined,
      workflowContinuity: {
        hasLogicalNext: !!nextTask,
        reason: nextTask
          ? 'Selected next task by priority (fallback analysis)'
          : 'No remaining tasks found',
      },
    };
  }
}
