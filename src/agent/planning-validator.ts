// Planning Validator - ensures agent has a plan and tasks before working

import chalk from 'chalk';
import { log } from '../utils/index.js';
import { uiState } from '../ui/ui-state.js';
import type { MemoryStore, Task, SessionGoal } from '../memory/types.js';

export interface ValidationResult {
  canProceed: boolean;
  reason?: string;
  suggestions?: string[];
}

export interface PlanningState {
  hasGoal: boolean;
  hasActiveTask: boolean;
  hasPendingTasks: boolean;
  hasPlan: boolean;
  taskCount: number;
  currentTask?: Task;
}

export class PlanningValidator {
  private lastValidationTime = 0;
  private validationInterval = 5; // minutes between validations

  constructor(private memoryStore: MemoryStore) {}

  private isWriteToolName(toolName: string): boolean {
    // Tools that directly modify files/state.
    // Note: execute_bash is intentionally excluded because it is often used read-only; if needed, treat it separately.
    return toolName === 'create_file' || toolName === 'patch_file' || toolName === 'apply_unified_diff';
  }

  private parallelArgsContainWriteTools(args: unknown, depth: number = 0): boolean {
    if (depth > 2) return false;
    if (!args || typeof args !== 'object') return true; // conservative: can't inspect

    const tools = (args as any).tools;
    if (!Array.isArray(tools)) return true; // conservative: can't inspect

    for (const call of tools) {
      const name = call?.tool;
      const params = call?.parameters;
      if (typeof name !== 'string') return true; // conservative: can't inspect

      if (this.isWriteToolName(name)) return true;
      if (name === 'parallel' && this.parallelArgsContainWriteTools(params, depth + 1)) return true;
    }

    return false;
  }

  /**
   * Check if tool calls include write operations that require planning
   * Returns true if any tool call is a write operation
   */
  hasWriteOperationTools(toolCalls: Array<{ function: { name: string; arguments?: string } }>): boolean {
    if (!toolCalls || toolCalls.length === 0) {
      return false;
    }

    return toolCalls.some(tc => {
      const name = tc.function.name;

      if (this.isWriteToolName(name)) return true;

      // Prevent bypass: parallel can contain write tools even if the top-level tool call is "parallel"
      if (name === 'parallel') {
        try {
          const parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : null;
          return this.parallelArgsContainWriteTools(parsed);
        } catch {
          return true; // conservative: if we can't parse, assume it may contain writes
        }
      }

      return false;
    });
  }

  /**
   * Validate if agent can proceed with work
   * Called before each user message or autonomous iteration
   *
   * @param isWriteOperation - If true, requires goal and tasks. If false (read-only), allows proceeding without them.
   */
  validate(isWriteOperation: boolean = false): ValidationResult {
    const state = this.getState();
    const reasons: string[] = [];
    const suggestions: string[] = [];

    // Read-only operations (queries, explanations) don't require planning
    if (!isWriteOperation) {
      return {
        canProceed: true,
        reason: 'Read-only operation detected - no planning required.',
      };
    }

    // Check 1: For write operations, must have a goal
    // For read-only operations (queries, explanations), a goal is optional
    if (!state.hasGoal) {
      return {
        canProceed: false,
        reason: 'No goal defined. Write operations require a clear goal before starting work.',
        suggestions: [
          'Ask the user: "What would you like me to help you accomplish?"',
          'Once you understand the goal, use create_task to break it down into actionable tasks',
          'Example goal: "Build a REST API for a todo app"',
        ],
      };
    }

    // Check 2: For write operations, must have at least one task
    if (isWriteOperation && state.taskCount === 0) {
      return {
        canProceed: false,
        reason: 'No tasks defined. Write operations require a task list before starting work.',
        suggestions: [
          'Use create_task to break down the goal into specific, actionable tasks',
          'Start with high-level tasks, then break them down further',
          'Example tasks: "Design API endpoints", "Implement CRUD operations", "Add authentication"',
        ],
      };
    }

    // Check 3: For write operations, must have a current task
    if (isWriteOperation && !state.hasActiveTask) {
      return {
        canProceed: false,
        reason: 'No current task set. Write operations require a current task.',
        suggestions: [
          'Use list_tasks to see available tasks',
          '⚠️ IMPORTANT: Select a LEAF task (task with no subtasks) to work on',
          'Use list_subtasks to check if a task has children before selecting it',
          'If a task has subtasks, work on those subtasks first',
          'Use set_current_task to focus on a specific leaf task',
          'Use update_task_status to mark the selected task as active',
        ],
      };
    }

    // Check 4: For write operations, current task should be active
    if (isWriteOperation && state.currentTask && state.currentTask.status !== 'active') {
      reasons.push(`Current task "${state.currentTask.description}" is ${state.currentTask.status}, not active`);
      suggestions.push('Use update_task_status to set current task to active');
    }

    // Check 5: Detect complex tasks that should be broken down
    if (isWriteOperation && state.currentTask) {
      const task = state.currentTask;
      const subtasks = this.memoryStore.getTasks().filter(t => t.parentId === task.id);

      // Check if task description indicates complexity (uses words like "implement", "build", "create system", etc.)
      const complexityIndicators = [
        /implement (a |the )?[\w\s]+(system|feature|module|service)/i,
        /build (a |the )?[\w\s]+(system|feature|module|service|app)/i,
        /create (a |the )?[\w\s]+(system|feature|module|service)/i,
        /add (a |the )?[\w\s]+(system|authentication|authorization|integration)/i,
        /refactor (all|the) [\w\s]+/i,
      ];

      const isComplexTask = complexityIndicators.some(pattern => pattern.test(task.description));

      if (isComplexTask && subtasks.length === 0) {
        suggestions.push(
          `⚠️ Current task appears complex: "${task.description}"`,
          `Consider using break_down_task to decompose it into 3-7 focused subtasks`,
          `Example: break_down_task({ task_id: "${task.id}", subtasks: [...] })`,
          `This enables better subagent delegation and focused work`
        );
      }
    }

    // Check 6: Should have active tasks (unless all done)
    if (state.taskCount > 0 && !state.hasPendingTasks) {
      const completedCount = this.memoryStore.getTasks().filter(t => t.status === 'completed').length;
      if (completedCount < state.taskCount) {
        suggestions.push('Some tasks might be blocked. Review task list with list_tasks');
      }
    }

    // Check for blocked tasks
    const blockedTasks = this.memoryStore.getTasks().filter(t => t.status === 'blocked');
    if (blockedTasks.length > 0) {
      suggestions.push(`⚠️  ${blockedTasks.length} task(s) are blocked. Use list_tasks status=blocked to see them`);
    }

    return {
      canProceed: reasons.length === 0,
      reason: reasons.length > 0 ? reasons.join('\n') : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  /**
   * Get current planning state
   */
  getState(): PlanningState {
    const goal = this.memoryStore.getGoal();
    const tasks = this.memoryStore.getTasks();
    const activeTask = this.memoryStore.getActiveTask();

    return {
      hasGoal: !!goal,
      hasActiveTask: !!activeTask,
      hasPendingTasks: tasks.some((t: any) => t.status === 'waiting' || t.status === 'active' || t.status === 'pending_verification'),
      hasPlan: this.hasPlan(),
      taskCount: tasks.length,
      currentTask: activeTask || undefined,
    };
  }

  /**
   * Check if there's a reasonable plan
   * A plan exists if there are multiple tasks with different priorities
   */
  private hasPlan(): boolean {
    const tasks = this.memoryStore.getTasks();
    if (tasks.length < 2) return false;

    // Check for variety in priorities (indicates planning)
    const priorities = new Set(tasks.map(t => t.priority));
    if (priorities.size > 1) return true;

    // Check for reasonable number of tasks (2-10 suggests planning)
    return tasks.length >= 2 && tasks.length <= 10;
  }

  /**
   * Display validation result to user
   */
  displayValidation(result: ValidationResult): void {
    if (result.canProceed) {
      uiState.addMessage({
        role: 'system',
        content: '✓ Planning validated - ready to proceed',
        timestamp: Date.now(),
      });
      return;
    }

    let message = '⛔ Planning Validation Failed';
    if (result.reason) {
      message += `\n\nReason:\n  ${result.reason}`;
    }

    if (result.suggestions && result.suggestions.length > 0) {
      message += '\n\nSuggestions:';
      for (const suggestion of result.suggestions) {
        message += `\n  • ${suggestion}`;
      }
    }

    uiState.addMessage({
      role: 'system',
      content: message,
      timestamp: Date.now(),
    });
  }

  /**
   * Generate system prompt injection with planning reminders
   */
  buildPlanningReminders(): string {
    const state = this.getState();
    const parts: string[] = ['\n[Planning Reminders]'];

    if (state.currentTask) {
      parts.push(`\nCurrent Task: ${state.currentTask.description}`);
      parts.push(`Status: ${state.currentTask.status} | Priority: ${state.currentTask.priority}`);
    }

    const pendingCount = this.memoryStore.getTasks().filter((t: any) => t.status === 'waiting').length;
    if (pendingCount > 0) {
      parts.push(`\nWaiting Tasks: ${pendingCount}`);
    }

    const blockedCount = this.memoryStore.getTasks().filter(t => t.status === 'blocked').length;
    if (blockedCount > 0) {
      parts.push(`\n⚠️ Blocked Tasks: ${blockedCount} - Review with list_tasks status=blocked`);
    }

    parts.push('\nReminders:');
    parts.push('• ⚠️ CRITICAL: Work on LEAF tasks (tasks with no subtasks) first!');
    parts.push('• Use list_subtasks to check if a task has children before selecting it');
    parts.push('• Keep your current task updated with update_task_status');
    parts.push('• Create new tasks with create_task when identifying new work');
    parts.push('• Review task list regularly with list_tasks');
    parts.push('• Set current task with set_current_task before working');

    parts.push('\nHierarchical Task Management:');
    parts.push('• Break complex (MACRO) tasks into focused (MICRO) subtasks with break_down_task');
    parts.push('• Aim for 3-7 subtasks per parent for manageable scope');
    parts.push('• Use list_subtasks to view task hierarchy and progress');
    parts.push('• Delegate LEAF tasks (MICRO/MICRO-MICRO) to subagents, not MACRO tasks');
    parts.push('• Example: Instead of delegating "Implement auth", break it down and delegate "Create login endpoint"');

    parts.push('\n[End Planning Reminders]');
    return parts.join('\n');
  }

  /**
   * Check if it's time to validate (avoid excessive validation)
   */
  shouldValidate(): boolean {
    const now = Date.now();
    if (now - this.lastValidationTime > this.validationInterval * 60 * 1000) {
      this.lastValidationTime = now;
      return true;
    }
    return false;
  }
}

/**
 * Build parallel execution reminder
 * Injected more frequently to maximize parallel tool usage
 */
export function buildParallelExecutionReminder(iteration: number): string | null {
  // Remind every 2 iterations (very frequent to maximize adoption)
  if (iteration % 2 !== 0) return null;

  return `
[⚡ Parallel Execution Reminder]

Are you about to use multiple tools? Use parallel to run them simultaneously!

Common Parallel Patterns:
• Reading 2+ files → Use parallel tool
• Running multiple bash commands → Use parallel tool
• Spawning multiple subagents → Use parallel + background: true
• ANY independent operations → Use parallel tool

Example:
  parallel({ tools: [
    { tool: "read_file", parameters: { path: "src/a.ts" } },
    { tool: "read_file", parameters: { path: "src/b.ts" } },
    { tool: "execute_bash", parameters: { command: "npm test" } }
  ]})

This is 3-10x faster than sequential execution!

[End Reminder]
`;
}

/**
 * Build subagent usage reminder prompt
 * Injected occasionally to encourage subagent consideration
 */
export function buildSubagentReminder(iteration: number): string | null {
  // Only remind every 3-5 iterations
  if (iteration % 3 !== 0) return null;

  const parts: string[] = [
    `\n[Subagent Reminder]`,
    ``,
    `🎯 LLMs work best on FOCUSED, SPECIFIC tasks`,
    ``,
    `⚠️ CRITICAL: Delegate LEAF tasks, not MACRO tasks`,
    `• BAD: spawn_agent("Implement authentication system") - too broad`,
    `• GOOD: First use break_down_task to decompose, then delegate subtasks`,
    `• GOOD: spawn_agent("Create login endpoint with JWT") - focused and specific`,
    ``,
    `Hierarchical Delegation Pattern:`,
    `1. Create MACRO task with create_task`,
    `2. Break down with break_down_task into 3-7 MICRO tasks`,
    `3. Delegate MICRO/MICRO-MICRO tasks to subagents`,
    `4. Use list_subtasks to track progress`,
    ``,
    `Use spawn_agent when:`,
    ``,
    `📊 Context Management:`,
    `• The conversation is getting long (> 10 messages)`,
    `• You're working on a complex problem with many details`,
    `• Context is becoming overloaded with irrelevant information`,
    `• You need to step back and see the big picture`,
    ``,
    `🔄 Parallel Execution (multiple subagents):`,
    `• Writing tests for multiple files or modules`,
    `• Refactoring or analyzing multiple components`,
    `• Investigating bugs in different parts of the codebase`,
    `• Creating documentation for different sections`,
    ``,
    `🎯 Focused Sequential Tasks (single subagent):`,
    `• Writing tests for a complex module (file-by-file)`,
    `• Investigating a bug by tracing through components`,
    `• Refactoring a large module (section-by-section)`,
    `• Writing documentation while understanding code`,
    `• Any focused, bounded task that benefits from isolation`,
    ``,
    `📋 Role-Based Delegation:`,
    ``,
    `investigator (diagnose & debug):`,
    `  • Complex bugs that need deep investigation`,
    `  • Root cause analysis`,
    `  • Tracing execution paths`,
    ``,
    `test-writer:`,
    `  • Writing tests for specific files/functions`,
    `  • Edge case coverage`,
    `  • Test refactoring`,
    ``,
    `refactorer:`,
    `  • Code structure improvements`,
    `  • Pattern application`,
    `  • Code organization`,
    ``,
    `fixer:`,
    `  • Bug fixes with minimal changes`,
    `  • Error handling improvements`,
    `  • Regression prevention`,
    ``,
    `documenter:`,
    `  • API documentation`,
    `  • README and guides`,
    `  • Code comments`,
    ``,
    `Each subagent can run for thousands of iterations (default: 1000)`,
    ``,
    `💡 Context Management Tools:`,
    `• summarize_context - Reduce bloat before spawning subagents`,
    `• extract_focus - Provide focused context for subagent`,
    `• merge_context - Integrate subagent results back`,
    ``,
    `💡 Best Practices:`,
    `• Provide minimal, focused context to subagents`,
    `• Use extract_focus to create bounded context`,
    `• Merge results back with merge_context`,
    `• Set background=true for parallel tasks`,
    `• Wait on all background agents together`,
    ``,
    `Use list_agents to check running subagents.`,
    `Use wait_agent to get results from background subagents.`,
    ``,
    `[End Subagent Reminder]`,
  ];

  return parts.join('\n');
}
