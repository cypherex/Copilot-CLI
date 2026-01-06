/**
 * Status bar region - subscribes to UIState for status info
 */

import chalk from 'chalk';
import { BaseRegion } from './base-region.js';
import { uiState, type UIStateData } from '../ui-state.js';
import { getRenderManager } from '../render-manager.js';

/**
 * Status info for manual updates
 */
export interface StatusInfo {
  status?: string;
  message?: string;
  tokensUsed?: number;
  tokensLimit?: number;
  modelName?: string;
  providerName?: string;
}

/**
 * Status bar that displays at bottom of screen
 * Subscribes to UIState and renders automatically
 */
export class StatusRegion extends BaseRegion {
  private unsubscribe?: () => void;

  constructor() {
    super({
      id: 'status-bar',
      height: 1,
      position: 'bottom',
      zIndex: 100,
    });
  }

  /**
   * Start listening to state changes
   */
  startListening(): void {
    this.unsubscribe = uiState.subscribe((state, changedKeys) => {
      // Only re-render if relevant state changed
      const relevantKeys: (keyof UIStateData)[] = [
        'agentStatus', 'statusMessage', 'tokensUsed', 'tokensLimit',
        'allTasks', 'modelName', 'currentToolExecution'
      ];
      if (changedKeys.some(k => relevantKeys.includes(k))) {
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
   * Render the status bar from current state
   */
  render(): void {
    const state = uiState.getState();
    const terminalWidth = getRenderManager()?.getTerminalWidth() ?? process.stdout.columns ?? 80;
    const parts: string[] = [];

    // Status indicator
    const statusColors: Record<string, (s: string) => string> = {
      idle: chalk.gray,
      thinking: chalk.yellow,
      executing: chalk.blue,
      waiting: chalk.cyan,
      error: chalk.red,
    };
    const statusIcons: Record<string, string> = {
      idle: '○',
      thinking: '…',
      executing: '▶',
      waiting: '⏳',
      error: '✗',
    };
    const colorFn = statusColors[state.agentStatus] || chalk.white;
    const icon = statusIcons[state.agentStatus] || '○';

    if (state.statusMessage) {
      parts.push(colorFn(`${icon} ${state.statusMessage}`));
    } else {
      parts.push(colorFn(`${icon} ${state.agentStatus}`));
    }

    // Token usage
    if (state.tokensLimit > 0) {
      const percentage = Math.round((state.tokensUsed / state.tokensLimit) * 100);
      const tokenColor = percentage > 80 ? chalk.red : percentage > 60 ? chalk.yellow : chalk.green;
      parts.push(tokenColor(`${percentage}% tokens`));
    }

    // Active tasks count
    const activeTasks = state.allTasks.filter(t => t.status === 'in_progress' || t.status === 'verifying').length;
    if (activeTasks > 0) {
      parts.push(chalk.yellow(`${activeTasks} tasks`));
    }

    // Current tool
    if (state.currentToolExecution) {
      const tool = state.currentToolExecution;
      if (tool.status === 'running') {
        parts.push(chalk.blue(`↪ ${tool.name}`));
      }
    }

    // Parallel execution progress
    if (state.parallelExecution?.isActive) {
      const completed = state.parallelExecution.tools.filter(t => t.status === 'success' || t.status === 'error').length;
      const total = state.parallelExecution.tools.length;
      parts.push(chalk.cyan(`⎇ ${completed}/${total}`));
    }

    // Active subagents
    if (state.subagents?.active && state.subagents.active.length > 0) {
      const count = state.subagents.active.length;
      parts.push(chalk.magenta(`⧉ ${count}`));
    }

    // Model name
    if (state.modelName) {
      parts.push(chalk.dim(state.modelName));
    }

    let statusLine = parts.join(chalk.dim(' · '));
    statusLine = this.truncateAnsi(statusLine, terminalWidth);
    this.update([statusLine]);
  }

  private truncateAnsi(text: string, width: number): string {
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    if (plain.length <= width) return text;
    // crude truncate: cut the raw string by overflow amount
    const overflow = plain.length - width;
    return text.slice(0, Math.max(0, text.length - overflow - 1)) + '…';
  }

  /**
   * Manual status update (updates UIState which triggers render)
   */
  updateStatus(info: Partial<StatusInfo>): void {
    const updates: Partial<UIStateData> = {};

    if (info.status) {
      updates.agentStatus = info.status as UIStateData['agentStatus'];
    }
    if (info.message !== undefined) {
      updates.statusMessage = info.message;
    }
    if (info.tokensUsed !== undefined && info.tokensLimit !== undefined) {
      updates.tokensUsed = info.tokensUsed;
      updates.tokensLimit = info.tokensLimit;
    }
    if (info.modelName !== undefined) {
      updates.modelName = info.modelName;
    }
    if (info.providerName !== undefined) {
      updates.providerName = info.providerName;
    }

    uiState.update(updates);
  }
}
