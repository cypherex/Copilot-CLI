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

  constructor() {
    super({
      id: 'task-bar',
      height: 1,
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
    const parts: string[] = [];

    // Task progress
    if (state.allTasks.length > 0) {
      const completed = state.allTasks.filter(t => t.status === 'completed').length;
      const total = state.allTasks.length;
      parts.push(chalk.gray(`[${completed}/${total}]`));
      parts.push(this.renderProgressBar(completed, total, terminalWidth));
    }

    // Current task
    if (state.currentTask) {
      const icon = this.getTaskIcon(state.currentTask.status);
      const maxDescLen = Math.max(10, terminalWidth - 36);
      let desc = state.currentTask.description;
      if (desc.length > maxDescLen) {
        desc = desc.slice(0, maxDescLen - 3) + '...';
      }
      const prio =
        state.currentTask.priority === 'high' ? chalk.red('!') :
        state.currentTask.priority === 'medium' ? chalk.yellow('!') :
        '';
      parts.push(chalk.blue(`${icon} ${desc}`) + (prio ? chalk.dim(' ') + prio : ''));
    } else {
      parts.push(chalk.dim('No active task'));
    }

    const taskLine = parts.join(chalk.dim(' · '));
    this.update([taskLine]);
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
