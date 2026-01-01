// Task Bar - persistent display of task status at bottom of terminal

import chalk from 'chalk';
import type { Task } from '../memory/types.js';

export interface TaskBarConfig {
  enabled: boolean;
  refreshInterval: number; // milliseconds between updates
  showCompleted: boolean;
  showBlocked: boolean;
  maxTasks: number;
}

export const DEFAULT_TASK_BAR_CONFIG: TaskBarConfig = {
  enabled: true,
  refreshInterval: 5000,
  showCompleted: true,
  showBlocked: true,
  maxTasks: 5,
};

/**
 * Format a single task for display
 */
function formatTask(task: Task, width: number = 60): string {
  const statusIcon = getStatusIcon(task.status);
  const statusColor = getStatusColor(task.status);
  const priorityBadge = getPriorityBadge(task.priority);

  // Truncate description if too long
  let description = task.description;
  if (description.length > width - 10) {
    description = description.slice(0, width - 13) + '...';
  }

  return `${statusIcon} ${statusColor(description)} ${priorityBadge}`;
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'active':
      return '🔷';
    case 'waiting':
      return '⏳';
    case 'completed':
      return '✅';
    case 'blocked':
      return '🚫';
    case 'abandoned':
      return '🗑️';
    default:
      return '❓';
  }
}

function getStatusColor(status: string): (text: string) => string {
  switch (status) {
    case 'active':
      return chalk.blue;
    case 'waiting':
      return chalk.gray;
    case 'completed':
      return chalk.green;
    case 'blocked':
      return chalk.red;
    case 'abandoned':
      return chalk.dim;
    default:
      return chalk.white;
  }
}

function getPriorityBadge(priority: string): string {
  switch (priority) {
    case 'high':
      return chalk.bgRed('H');
    case 'medium':
      return chalk.bgYellow('M');
    case 'low':
      return chalk.bgBlue('L');
    default:
      return '';
  }
}

/**
 * Render the task bar display
 */
export function renderTaskBar(
  currentTask: Task | undefined,
  allTasks: Task[],
  config: TaskBarConfig = DEFAULT_TASK_BAR_CONFIG
): string {
  if (!config.enabled) {
    return '';
  }

  const lines: string[] = [];

  // Top border
  lines.push(chalk.gray('─'.repeat(80)));

  // Current task section
  if (currentTask) {
    lines.push(
      chalk.bold('🎯 Current: ') +
      chalk.blue(currentTask.description) +
      ' ' +
      chalk.gray(`[${currentTask.status}]`)
    );
  } else {
    lines.push(chalk.gray('🎯 Current: No task set'));
  }

  // Task summary
  const completed = allTasks.filter(t => t.status === 'completed').length;
  const active = allTasks.filter(t => t.status === 'active').length;
  const waiting = allTasks.filter(t => t.status === 'waiting').length;
  const blocked = allTasks.filter(t => t.status === 'blocked').length;

  const summary = chalk.gray(
    `Progress: ${chalk.green(completed)} done | ` +
    `${chalk.blue(active)} active | ` +
    `${chalk.yellow(waiting)} waiting` +
    (config.showBlocked ? ` | ${chalk.red(blocked)} blocked` : '')
  );
  lines.push(summary);

  // Show pending tasks
  const pendingTasks = allTasks
    .filter(t => t.status === 'waiting' || t.status === 'active')
    .slice(0, config.maxTasks);

  if (pendingTasks.length > 0) {
    lines.push(chalk.gray('Pending:'));
    for (const task of pendingTasks) {
      lines.push('  ' + formatTask(task));
    }

    // Count only waiting tasks that aren't shown
    const shownWaitingTasks = pendingTasks.filter(t => t.status === 'waiting').length;
    const totalWaitingTasks = allTasks.filter(t => t.status === 'waiting').length;
    const remainingCount = totalWaitingTasks - shownWaitingTasks;
    
    if (remainingCount > 0) {
      lines.push(chalk.gray(`  ... ${remainingCount} more task(s)`));
    }
  }

  // Bottom border
  lines.push(chalk.gray('─'.repeat(80)));

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Render a compact one-line task status
 */
export function renderTaskStatusLine(
  currentTask: Task | undefined,
  allTasks: Task[]
): string {
  const completed = allTasks.filter(t => t.status === 'completed').length;
  const total = allTasks.length;

  if (currentTask) {
    return chalk.gray(
      `[${completed}/${total} tasks] ` +
      `🎯 ${chalk.blue(currentTask.description.slice(0, 40))}${currentTask.description.length > 40 ? '...' : ''}`
    );
  } else {
    return chalk.gray(`[${completed}/${total} tasks] 🎯 No task set`);
  }
}

/**
 * Check if we should update the task bar (avoid excessive rendering)
 */
export class TaskBarRenderer {
  private lastRenderTime = 0;
  private renderCount = 0;

  constructor(private config: TaskBarConfig = DEFAULT_TASK_BAR_CONFIG) {}

  shouldRender(): boolean {
    const now = Date.now();
    return now - this.lastRenderTime >= this.config.refreshInterval;
  }

  render(
    currentTask: Task | undefined,
    allTasks: Task[],
    force: boolean = false
  ): string {
    if (!force && !this.shouldRender()) {
      return '';
    }

    this.lastRenderTime = Date.now();
    this.renderCount++;

    return renderTaskBar(currentTask, allTasks, this.config);
  }

  renderCompact(
    currentTask: Task | undefined,
    allTasks: Task[],
    force: boolean = false
  ): string {
    if (!force && !this.shouldRender()) {
      return '';
    }

    this.lastRenderTime = Date.now();
    this.renderCount++;
    return renderTaskStatusLine(currentTask, allTasks);
  }

  getStats(): { renderCount: number; lastRenderTime: number } {
    return {
      renderCount: this.renderCount,
      lastRenderTime: this.lastRenderTime,
    };
  }

  reset(): void {
    this.renderCount = 0;
    this.lastRenderTime = 0;
  }
}
