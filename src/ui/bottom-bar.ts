// Persistent bottom bar combining status, taskbar, and input
// Always visible at bottom of terminal while output scrolls above

import chalk from 'chalk';
import type { Task } from '../memory/types.js';
import type { StatusInfo } from './status-bar.js';

export interface BottomBarConfig {
  height: number; // Total height in lines
  showSeparator: boolean;
  separatorChar: string;
  updateInterval: number; // ms between status updates
  enableTaskBar: boolean;
  enableInput: boolean;
}

export const DEFAULT_BOTTOM_BAR_CONFIG: BottomBarConfig = {
  height: 3, // Separator + status line + input line
  showSeparator: true,
  separatorChar: '─',
  updateInterval: 5000,
  enableTaskBar: true,
  enableInput: true,
};

export interface BottomBarState {
  statusInfo: StatusInfo | null;
  currentTask: Task | null;
  allTasks: Task[];
  inputPrompt: string;
  currentInput: string;
  cursorPosition: number;
}

/**
 * Persistent bottom bar that stays visible at terminal bottom
 * Uses ANSI escape codes for cursor control to prevent flicker
 */
export class BottomBar {
  private config: BottomBarConfig;
  private state: BottomBarState;
  private lastRenderTime = 0;
  private isVisible = false;
  private cursorSaved = false;

  // Terminal dimensions
  private terminalHeight = 0;
  private terminalWidth = 0;
  private separatorRow = 0;
  private statusRow = 0;
  private inputRow = 0;

  constructor(config: Partial<BottomBarConfig> = {}) {
    this.config = { ...DEFAULT_BOTTOM_BAR_CONFIG, ...config };

    this.state = {
      statusInfo: null,
      currentTask: null,
      allTasks: [],
      inputPrompt: chalk.green('You: '),
      currentInput: '',
      cursorPosition: 0,
    };

    this.updateDimensions();
  }

  /**
   * Update terminal dimensions
   */
  private updateDimensions(): void {
    this.terminalHeight = process.stdout.rows || 24;
    this.terminalWidth = process.stdout.columns || 80;

    // Calculate row positions from bottom
    // Row 0 is top, Row terminalHeight-1 is bottom
    const lastRow = this.terminalHeight - 1;

    this.inputRow = lastRow; // Last line - input prompt
    this.statusRow = lastRow - 1; // Second-to-last - status bar

    if (this.config.showSeparator) {
      this.separatorRow = lastRow - 2; // Third-to-last - separator
    } else {
      this.separatorRow = -1; // No separator
    }
  }

  /**
   * Initialize the bottom bar
   */
  initialize(): void {
    this.updateDimensions();

    // Draw initial state
    this.render(true);

    this.isVisible = true;
  }

  /**
   * Update status info
   */
  updateStatusInfo(statusInfo: StatusInfo): void {
    this.state.statusInfo = statusInfo;

    // Check if we should update (throttling)
    const now = Date.now();
    if (now - this.lastRenderTime >= this.config.updateInterval) {
      this.renderStatusLine();
      this.lastRenderTime = now;
    }
  }

  /**
   * Update task information
   */
  updateTasks(currentTask: Task | null, allTasks: Task[]): void {
    this.state.currentTask = currentTask;
    this.state.allTasks = allTasks;

    this.renderStatusLine();
    this.lastRenderTime = Date.now();
  }

  /**
   * Update input state
   */
  updateInput(input: string, cursorPosition: number = 0): void {
    this.state.currentInput = input;
    this.state.cursorPosition = cursorPosition;

    this.renderInputLine();
  }

  /**
   * Update prompt string
   */
  updatePrompt(prompt: string): void {
    this.state.inputPrompt = prompt;
    this.renderInputLine();
  }

  /**
   * Render entire bottom bar (or specific sections)
   */
  private render(force: boolean = false): void {
    this.saveCursor();

    // Draw separator
    if (this.config.showSeparator) {
      this.renderSeparator();
    }

    // Draw status line
    this.renderStatusLine();

    // Draw input line
    this.renderInputLine();

    this.restoreCursor();
  }

  /**
   * Render separator line
   */
  private renderSeparator(): void {
    if (this.separatorRow < 0) return;

    this.moveCursor(this.separatorRow, 0);
    process.stdout.write('\x1b[2K'); // Clear line

    const separator = chalk.dim(
      this.config.separatorChar.repeat(this.terminalWidth)
    );
    process.stdout.write(separator);
  }

  /**
   * Render status line (taskbar + status info)
   */
  private renderStatusLine(): void {
    if (!this.config.enableTaskBar) return;

    this.moveCursor(this.statusRow, 0);
    process.stdout.write('\x1b[2K'); // Clear line

    const statusParts: string[] = [];

    // Task status
    if (this.state.currentTask || this.state.allTasks.length > 0) {
      const completed = this.state.allTasks.filter(t => t.status === 'completed').length;
      const total = this.state.allTasks.length;
      statusParts.push(chalk.gray(`[${completed}/${total} tasks]`));
    }

    // Current task
    if (this.state.currentTask) {
      const taskDesc = this.state.currentTask.description.slice(0, 40);
      const truncated = this.state.currentTask.description.length > 40;
      const description = truncated ? taskDesc + '...' : taskDesc;
      statusParts.push(chalk.blue(`🎯 ${description}`));
    } else {
      statusParts.push(chalk.gray('🎯 No task set'));
    }

    // Status info (tokens, etc.)
    if (this.state.statusInfo) {
      const info = this.state.statusInfo;
      if (info.tokensLimit > 0) {
        const percentage = Math.round((info.tokensUsed / info.tokensLimit) * 100);
        const color = percentage > 80 ? chalk.red : percentage > 60 ? chalk.yellow : chalk.green;
        statusParts.push(color(`${percentage}%`));
      }

      if (info.activeTasks > 0) {
        statusParts.push(chalk.yellow(`●${info.activeTasks}`));
      }

      if (info.runningSubagents && info.runningSubagents > 0) {
        statusParts.push(chalk.yellow(`🤖 ${info.runningSubagents}`));
      }
    }

    // Render status line
    const statusLine = statusParts.join(' ' + chalk.dim('•') + ' ');
    process.stdout.write(statusLine);
  }

  /**
   * Render input line with prompt and cursor
   */
  private renderInputLine(): void {
    if (!this.config.enableInput) return;

    this.moveCursor(this.inputRow, 0);
    process.stdout.write('\x1b[2K'); // Clear line

    // Render prompt and input
    const promptLength = this.stripAnsi(this.state.inputPrompt).length;
    process.stdout.write(this.state.inputPrompt + this.state.currentInput);

    // Move cursor to correct position
    const targetColumn = promptLength + this.state.cursorPosition;
    this.moveCursorWithinLine(targetColumn);
  }

  /**
   * Move cursor to specific row/column
   */
  private moveCursor(row: number, col: number): void {
    // Use 1-based indexing for ANSI escape codes
    process.stdout.write(`\x1b[${row + 1};${col + 1}H`);
  }

  /**
   * Move cursor within current line (horizontal only)
   */
  private moveCursorWithinLine(col: number): void {
    process.stdout.write(`\r\x1b[${col}C`);
  }

  /**
   * Save current cursor position
   */
  private saveCursor(): void {
    if (!this.cursorSaved) {
      process.stdout.write('\x1b7');
      this.cursorSaved = true;
    }
  }

  /**
   * Restore saved cursor position
   */
  private restoreCursor(): void {
    if (this.cursorSaved) {
      process.stdout.write('\x1b8');
      this.cursorSaved = false;
    }
  }

  /**
   * Clear bottom bar (restore to normal output)
   */
  clear(): void {
    this.saveCursor();

    // Clear each line of the bottom bar
    const startRow = this.config.showSeparator ? this.separatorRow : this.statusRow;

    for (let row = this.inputRow; row >= startRow; row--) {
      this.moveCursor(row, 0);
      process.stdout.write('\x1b[2K');
    }

    this.restoreCursor();
    this.isVisible = false;
  }

  /**
   * Handle terminal resize
   */
  handleResize(): void {
    this.clear();
    this.updateDimensions();
    if (this.isVisible) {
      this.render(true);
    }
  }

  /**
   * Strip ANSI codes to get real text length
   */
  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Get current state
   */
  getState(): BottomBarState {
    return { ...this.state };
  }

  /**
   * Get bottom bar height
   */
  getHeight(): number {
    return this.config.height;
  }

  /**
   * Get output area height (terminal height minus bottom bar)
   */
  getOutputHeight(): number {
    return this.terminalHeight - this.config.height;
  }

  /**
   * Check if visible
   */
  isShowing(): boolean {
    return this.isVisible;
  }
}
