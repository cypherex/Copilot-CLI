/**
 * Task bar region - subscribes to UIState for task info
 */

import chalk from 'chalk';
import { BaseRegion } from './base-region.js';
import { uiState, type UIStateData, type TaskState } from '../ui-state.js';

/**
 * Task bar that displays above the input line
 * Subscribes to UIState and renders automatically
 */
export class TaskRegion extends BaseRegion {
  private unsubscribe?: () => void;
  private terminalWidth = 80;

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
   * Set terminal width for truncation
   */
  setWidth(width: number): void {
    this.terminalWidth = width;
    this.render();
  }

  /**
   * Render the task bar from current state
   */
  render(): void {
    const state = uiState.getState();
    const parts: string[] = [];

    // Task progress
    if (state.allTasks.length > 0) {
      const completed = state.allTasks.filter(t => t.status === 'completed').length;
      const total = state.allTasks.length;
      parts.push(chalk.gray(`[${completed}/${total}]`));
    }

    // Current task
    if (state.currentTask) {
      const icon = this.getTaskIcon(state.currentTask.status);
      const maxDescLen = this.terminalWidth - 30;
      let desc = state.currentTask.description;
      if (desc.length > maxDescLen) {
        desc = desc.slice(0, maxDescLen - 3) + '...';
      }
      parts.push(chalk.blue(`${icon} ${desc}`));
    } else {
      parts.push(chalk.dim('○ No active task'));
    }

    const taskLine = parts.join(' ');
    this.update([taskLine]);
  }

  private getTaskIcon(status: TaskState['status']): string {
    switch (status) {
      case 'pending': return '○';
      case 'in_progress': return '◐';
      case 'completed': return '●';
      case 'blocked': return '✗';
      default: return '○';
    }
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
