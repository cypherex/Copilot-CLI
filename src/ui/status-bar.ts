// Persistent status bar showing useful information

import chalk from 'chalk';
import type { CopilotAgent } from '../agent/index.js';

export interface StatusBarConfig {
  showTokens: boolean;
  showTasks: boolean;
  showProvider: boolean;
  showMemory: boolean;
  height: number; // Number of lines
}

export const DEFAULT_STATUS_BAR_CONFIG: StatusBarConfig = {
  showTokens: true,
  showTasks: true,
  showProvider: true,
  showMemory: true,
  height: 3,
};

export interface StatusInfo {
  provider: string;
  model: string;
  tokensUsed: number;
  tokensLimit: number;
  activeTasks: number;
  completedTasks: number;
  totalTasks: number;
  memoryItems: number;
  sessionId?: string;
}

export class StatusBar {
  private config: StatusBarConfig;
  private lastRender: string = '';
  private isVisible: boolean = false;

  constructor(config: Partial<StatusBarConfig> = {}) {
    this.config = { ...DEFAULT_STATUS_BAR_CONFIG, ...config };
  }

  /**
   * Render the status bar
   */
  render(info: StatusInfo): string {
    const width = process.stdout.columns || 80;
    const lines: string[] = [];

    // Top separator
    lines.push(chalk.dim('┌' + '─'.repeat(width - 2) + '┐'));

    // Main status line
    const statusParts: string[] = [];

    // Provider info
    if (this.config.showProvider) {
      const providerText = info.model
        ? `${info.provider}/${info.model}`
        : info.provider;
      statusParts.push(chalk.blue('🤖 ') + chalk.white(providerText));
    }

    // Token usage
    if (this.config.showTokens) {
      const percentage = info.tokensLimit > 0
        ? Math.round((info.tokensUsed / info.tokensLimit) * 100)
        : 0;
      const tokenColor = percentage > 80 ? chalk.red : percentage > 60 ? chalk.yellow : chalk.green;
      statusParts.push(
        chalk.gray('tokens:') + ' ' +
        tokenColor(`${this.formatNumber(info.tokensUsed)}/${this.formatNumber(info.tokensLimit)}`) +
        chalk.gray(` (${percentage}%)`)
      );
    }

    // Task status
    if (this.config.showTasks && info.totalTasks > 0) {
      const taskParts: string[] = [];
      if (info.activeTasks > 0) {
        taskParts.push(chalk.yellow(`●${info.activeTasks}`));
      }
      if (info.completedTasks > 0) {
        taskParts.push(chalk.green(`✓${info.completedTasks}`));
      }
      const pending = info.totalTasks - info.activeTasks - info.completedTasks;
      if (pending > 0) {
        taskParts.push(chalk.gray(`○${pending}`));
      }

      if (taskParts.length > 0) {
        statusParts.push(chalk.gray('tasks:') + ' ' + taskParts.join(' '));
      }
    }

    // Memory items
    if (this.config.showMemory && info.memoryItems > 0) {
      statusParts.push(chalk.gray('memory:') + ' ' + chalk.cyan(info.memoryItems.toString()));
    }

    // Session ID (abbreviated)
    if (info.sessionId) {
      statusParts.push(chalk.gray('session:') + ' ' + chalk.dim(info.sessionId.slice(0, 8)));
    }

    const statusLine = chalk.dim('│ ') + statusParts.join(chalk.dim(' • ')) + chalk.dim(' │');
    lines.push(this.padLine(statusLine, width));

    // Bottom separator
    lines.push(chalk.dim('└' + '─'.repeat(width - 2) + '┘'));

    this.lastRender = lines.join('\n');
    return this.lastRender;
  }

  /**
   * Show the status bar
   */
  show(info: StatusInfo): void {
    if (!this.isVisible) {
      this.isVisible = true;
    }
    const rendered = this.render(info);
    process.stdout.write(rendered + '\n');
  }

  /**
   * Update the status bar (redraw in place)
   */
  update(info: StatusInfo): void {
    if (!this.isVisible) {
      this.show(info);
      return;
    }

    const rendered = this.render(info);

    // Move cursor up to redraw
    const lineCount = this.config.height;
    process.stdout.write(`\x1b[${lineCount + 1}A`); // Move up
    process.stdout.write('\r'); // Move to start of line
    process.stdout.write(rendered + '\n');
  }

  /**
   * Hide the status bar
   */
  hide(): void {
    if (this.isVisible) {
      const lineCount = this.config.height;
      // Clear lines
      for (let i = 0; i < lineCount + 1; i++) {
        process.stdout.write('\x1b[2K'); // Clear line
        if (i < lineCount) {
          process.stdout.write('\x1b[1A'); // Move up
        }
      }
      this.isVisible = false;
    }
  }

  /**
   * Create a compact single-line status
   */
  renderCompact(info: StatusInfo): string {
    const parts: string[] = [];

    if (info.activeTasks > 0) {
      parts.push(chalk.yellow(`●${info.activeTasks}`));
    }

    if (info.tokensLimit > 0) {
      const percentage = Math.round((info.tokensUsed / info.tokensLimit) * 100);
      const color = percentage > 80 ? chalk.red : percentage > 60 ? chalk.yellow : chalk.green;
      parts.push(color(`${percentage}%`));
    }

    if (parts.length === 0) {
      return chalk.dim('Ready');
    }

    return chalk.dim('[') + parts.join(chalk.dim(' • ')) + chalk.dim(']');
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  private padLine(line: string, width: number): string {
    // Remove ANSI codes for length calculation
    const plainText = line.replace(/\x1b\[[0-9;]*m/g, '');
    const currentWidth = plainText.length;

    if (currentWidth < width) {
      const padding = ' '.repeat(width - currentWidth - 1);
      // Insert padding before the closing │
      return line.replace(/│$/, padding + '│');
    }

    return line;
  }

  isShowing(): boolean {
    return this.isVisible;
  }

  getHeight(): number {
    return this.config.height + 1; // +1 for the separators
  }
}

/**
 * Extract status info from agent
 */
export function getStatusInfo(agent: CopilotAgent): StatusInfo {
  const memoryStore = agent.getMemoryStore();
  const tasks = memoryStore.getTasks();

  // Get context usage through the conversation's context manager
  const conversation = (agent as any).conversation;
  const contextManager = conversation.getContextManager();
  const contextUsage = contextManager.getUsage();

  // Count all memory items
  const memoryItemCount =
    memoryStore.getAllGoals().length +
    memoryStore.getAllUserFacts().length +
    memoryStore.getAllPreferences().length +
    memoryStore.getAllDecisions().length +
    memoryStore.getProjectContext().length;

  return {
    provider: agent.getProviderName(),
    model: agent.getModelName() || '',
    tokensUsed: contextUsage.totalTokens || 0,
    tokensLimit: (contextManager as any).config?.maxContextTokens || 128000,
    activeTasks: tasks.filter((t: any) => t.status === 'in_progress').length,
    completedTasks: tasks.filter((t: any) => t.status === 'completed').length,
    totalTasks: tasks.length,
    memoryItems: memoryItemCount,
    sessionId: memoryStore.getSessionId(),
  };
}
