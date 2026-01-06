/**
 * Task bar region - subscribes to UIState for task info
 */

import chalk from 'chalk';
import { BaseRegion } from './base-region.js';
import { uiState, type UIStateData, type TaskState } from '../ui-state.js';
import { getRenderManager } from '../render-manager.js';

/**
 * Task bar that displays above the input line
 * Subscribes to UIState and renders automatically
 */
export class TaskRegion extends BaseRegion {
  private unsubscribe?: () => void;

  private static readonly TASK_LIST_LINES = 3;

  constructor() {
    super({
      id: 'task-bar',
      height: 1 + TaskRegion.TASK_LIST_LINES,
      position: 'bottom',
      zIndex: 90,
    });
  }

  /**
   * Start listening to state changes
   */
  startListening(): void {
    this.unsubscribe = uiState.subscribe((state, changedKeys) => {
      if (changedKeys.includes('currentTask') || changedKeys.includes('allTasks')) {
        this.render();
      }
    });
    this.render();
  }

  /**
   * Stop listening to state changes
   */
  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Render the task bar from current state
   */
  render(): void {
    const state = uiState.getState();
    const terminalWidth = getRenderManager()?.getTerminalWidth() ?? process.stdout.columns ?? 80;
    const lines: string[] = [];
    const summaryParts: string[] = [];

    // Task progress
    if (state.allTasks.length > 0) {
      const completed = state.allTasks.filter(t => t.status === 'completed').length;
      const total = state.allTasks.length;
      summaryParts.push(chalk.gray(`[${completed}/${total}]`));
      summaryParts.push(this.renderProgressBar(completed, total, terminalWidth));
    }

    // Current task
    if (state.currentTask) {
      const icon = this.getTaskIcon(state.currentTask.status);
      const maxDescLen = Math.max(10, terminalWidth - 36);
      let desc = state.currentTask.description;
      if (desc.length > maxDescLen) {
        desc = desc.slice(0, maxDescLen - 1) + '…';
      }
      const prio =
        state.currentTask.priority === 'high' ? chalk.red('!') :
        state.currentTask.priority === 'medium' ? chalk.yellow('!') :
        '';
      summaryParts.push(chalk.cyan(`${icon} ${desc}`) + (prio ? chalk.dim(' ') + prio : ''));
    } else {
      summaryParts.push(chalk.dim('No active task'));
    }

    const taskLine =
      (state.allTasks.length > 0 ? chalk.dim('Tasks ') : chalk.dim('Tasks')) +
      summaryParts.join(chalk.dim(' · '));
    lines.push(taskLine);

    const taskLines = this.renderTaskListLines(state, terminalWidth, TaskRegion.TASK_LIST_LINES);
    for (const line of taskLines) lines.push(line);

    this.update(lines);
  }

  private getTaskIcon(status: TaskState['status']): string {
    switch (status) {
      case 'pending': return '○';
      case 'in_progress': return '▶';
      case 'verifying': return '⧗';
      case 'completed': return '✓';
      case 'blocked': return '✗';
      default: return '○';
    }
  }

  private renderTaskListLines(state: Readonly<UIStateData>, terminalWidth: number, maxLines: number): string[] {
    if (maxLines <= 0) return [];

    const tasks = state.allTasks.slice();
    const currentTaskId = state.currentTask?.id;

    const statusRank: Record<TaskState['status'], number> = {
      in_progress: 0,
      verifying: 1,
      pending: 2,
      blocked: 3,
      completed: 4,
    };

    tasks.sort((a, b) => {
      const ra = statusRank[a.status] ?? 99;
      const rb = statusRank[b.status] ?? 99;
      if (ra !== rb) return ra - rb;
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      if (a.priority === 'medium' && b.priority === 'low') return -1;
      if (b.priority === 'medium' && a.priority === 'low') return 1;
      return 0;
    });

    const visible = tasks.filter(t => t.status !== 'completed');
    if (visible.length === 0) {
      return [chalk.dim('  (no pending tasks)')].concat(new Array(Math.max(0, maxLines - 1)).fill(''));
    }

    const shown = visible.slice(0, maxLines);
    const remaining = visible.length - shown.length;

    const maxDescLen = Math.max(12, terminalWidth - 12);

    const lines: string[] = [];
    for (let i = 0; i < shown.length; i++) {
      const task = shown[i];
      const icon = this.getTaskIcon(task.status);
      const prio =
        task.priority === 'high' ? chalk.red('!') :
        task.priority === 'medium' ? chalk.yellow('!') :
        '';

      const color =
        task.status === 'in_progress' ? chalk.cyan :
        task.status === 'verifying' ? chalk.yellow :
        task.status === 'blocked' ? chalk.red :
        chalk.gray;

      let desc = task.description;
      if (desc.length > maxDescLen) desc = desc.slice(0, maxDescLen - 1) + '…';

      const isCurrent = Boolean(currentTaskId && task.id === currentTaskId);
      const left = `${String(i + 1).padStart(2)} ${icon} ${desc}` + (prio ? chalk.dim(' ') + prio : '');

      lines.push(chalk.dim('  ') + (isCurrent ? chalk.bold(color(left)) : color(left)));
    }

    if (remaining > 0 && lines.length < maxLines) {
      lines.push(chalk.dim(`  … +${remaining} more`));
    }

    while (lines.length < maxLines) lines.push('');
    return lines;
  }

  private renderProgressBar(completed: number, total: number, terminalWidth: number): string {
    if (total <= 0) return '';
    const maxBar = Math.min(18, Math.max(10, Math.floor(terminalWidth / 8)));
    const ratio = Math.max(0, Math.min(1, completed / total));
    const filled = Math.round(ratio * maxBar);
    const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, maxBar - filled));
    const pct = Math.round(ratio * 100);
    const color = pct >= 80 ? chalk.green : pct >= 40 ? chalk.cyan : chalk.gray;
    return color(bar) + chalk.dim(` ${pct}%`);
  }

  /**
   * Manual task update (updates UIState which triggers render)
   */
  updateTasks(currentTask: TaskState | null, allTasks: TaskState[]): void {
    uiState.setTasks(currentTask, allTasks);
  }
}

// Re-export TaskInfo for compatibility
export type { TaskState as TaskInfo } from '../ui-state.js';
