// Task Context Builder - builds formatted task context for LLM consumption

import type { Task } from '../memory/types.js';

/**
 * Builds a formatted context string showing task hierarchy and status
 *
 * @param tasks - Array of tasks to format
 * @returns Formatted string showing:
 *   - Completed tasks with their filesModified
 *   - Active tasks
 *   - Pending tasks
 *   - Task hierarchy (parent-child relationships)
 */
export function buildTaskContext(tasks: Task[]): string {
  if (tasks.length === 0) {
    return 'No tasks found.';
  }

  const lines: string[] = ['Task Context:', ''];

  // Separate tasks by status
  const completed = tasks.filter(t => t.status === 'completed');
  const active = tasks.filter(t => t.status === 'active');
  const waiting = tasks.filter(t => t.status === 'waiting');
  const blocked = tasks.filter(t => t.status === 'blocked');
  const pendingVerification = tasks.filter(t => t.status === 'pending_verification');

  // Helper to render a task with indentation
  const renderTask = (task: Task, depth: number = 0): string[] => {
    const taskLines: string[] = [];
    const indent = '  '.repeat(depth);

    // Status icon
    const statusIcon = task.status === 'completed' ? '✓' :
                      task.status === 'active' ? '●' :
                      task.status === 'pending_verification' ? '⧗' :
                      task.status === 'blocked' ? '⚠' : '○';

    // Priority label
    const priority = task.priority === 'high' ? ' [HIGH]' :
                    task.priority === 'medium' ? ' [MED]' : '';

    // Task header
    taskLines.push(`${indent}${statusIcon} ${task.description}${priority}`);
    taskLines.push(`${indent}  ID: ${task.id} | Status: ${task.status}`);

    // Show files modified for completed tasks
    if (task.status === 'completed' && task.filesModified && task.filesModified.length > 0) {
      taskLines.push(`${indent}  Files modified: ${task.filesModified.join(', ')}`);
    }

    return taskLines;
  };

  // Helper to render task hierarchy
  const renderTaskHierarchy = (task: Task, depth: number = 0): string[] => {
    const result = renderTask(task, depth);

    // Find and render children
    const children = tasks.filter(t => t.parentId === task.id);
    if (children.length > 0) {
      // Sort children: active first, then pending_verification, then waiting, then blocked, then completed, then abandoned
      const statusOrder: Record<string, number> = {
        active: 0,
        pending_verification: 1,
        waiting: 2,
        blocked: 3,
        completed: 4,
        abandoned: 5,
      };
      const sortedChildren = children.sort((a, b) => {
        return (statusOrder[a.status] || 5) - (statusOrder[b.status] || 5);
      });

      for (const child of sortedChildren) {
        result.push(...renderTaskHierarchy(child, depth + 1));
      }
    }

    return result;
  };

  // Get top-level tasks (no parent)
  const topLevelTasks = tasks.filter(t => !t.parentId);

  // Render sections
  if (active.length > 0) {
    lines.push('ACTIVE TASKS:');
    const topLevelActive = active.filter(t => !t.parentId);
    for (const task of topLevelActive) {
      lines.push(...renderTaskHierarchy(task, 1));
    }
    lines.push('');
  }

  if (waiting.length > 0) {
    lines.push('PENDING TASKS:');
    const topLevelWaiting = waiting.filter(t => !t.parentId);
    for (const task of topLevelWaiting) {
      lines.push(...renderTaskHierarchy(task, 1));
    }
    lines.push('');
  }

  if (pendingVerification.length > 0) {
    lines.push('PENDING VERIFICATION TASKS:');
    const topLevelPendingVerification = pendingVerification.filter(t => !t.parentId);
    for (const task of topLevelPendingVerification) {
      lines.push(...renderTaskHierarchy(task, 1));
    }
    lines.push('');
  }

  if (blocked.length > 0) {
    lines.push('BLOCKED TASKS:');
    const topLevelBlocked = blocked.filter(t => !t.parentId);
    for (const task of topLevelBlocked) {
      lines.push(...renderTaskHierarchy(task, 1));
    }
    lines.push('');
  }

  if (completed.length > 0) {
    lines.push('COMPLETED TASKS:');
    const topLevelCompleted = completed.filter(t => !t.parentId);
    for (const task of topLevelCompleted) {
      lines.push(...renderTaskHierarchy(task, 1));
    }
    lines.push('');
  }

  // Summary
  const totalTasks = tasks.length;
  const topLevel = topLevelTasks.length;
  const subtasks = totalTasks - topLevel;

  lines.push('SUMMARY:');
  lines.push(`  Total: ${totalTasks} tasks (${topLevel} top-level, ${subtasks} subtasks)`);
  lines.push(`  Active: ${active.length} | Pending: ${waiting.length} | Pending Verification: ${pendingVerification.length} | Blocked: ${blocked.length} | Completed: ${completed.length}`);

  return lines.join('\n');
}

/**
 * Builds a compact task context showing only specific status
 *
 * @param tasks - Array of tasks to format
 * @param status - Status to filter by
 * @returns Formatted string showing only tasks with the given status
 */
export function buildTaskContextByStatus(tasks: Task[], status: 'active' | 'waiting' | 'pending_verification' | 'blocked' | 'completed'): string {
  const filtered = tasks.filter(t => t.status === status);

  if (filtered.length === 0) {
    return `No ${status} tasks found.`;
  }

  return buildTaskContext(filtered);
}

/**
 * Builds a summary of completed tasks with their filesModified
 * Useful for understanding what work has been done
 *
 * @param tasks - Array of tasks to format
 * @returns Formatted string showing completed tasks and files modified
 */
export function buildCompletedTasksSummary(tasks: Task[]): string {
  const completed = tasks.filter(t => t.status === 'completed');

  if (completed.length === 0) {
    return 'No completed tasks.';
  }

  const lines: string[] = ['Completed Tasks Summary:', ''];

  // Collect all files modified
  const allFiles = new Set<string>();

  for (const task of completed) {
    lines.push(`✓ ${task.description}`);
    lines.push(`  ID: ${task.id}`);

    if (task.filesModified && task.filesModified.length > 0) {
      lines.push(`  Files: ${task.filesModified.join(', ')}`);
      task.filesModified.forEach(file => allFiles.add(file));
    } else {
      lines.push(`  Files: (none tracked)`);
    }

    lines.push('');
  }

  // Summary
  lines.push(`SUMMARY: ${completed.length} tasks completed, ${allFiles.size} unique files modified`);

  return lines.join('\n');
}
