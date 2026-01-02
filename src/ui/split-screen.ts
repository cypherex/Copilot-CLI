// Split-screen terminal layout manager
// Divides terminal into output area (top) and input area (bottom)

import { EventEmitter } from 'events';
import chalk from 'chalk';
import { PersistentInput } from './persistent-input.js';
import { MessageQueue } from './message-queue.js';

export interface SplitScreenConfig {
  inputHeight: number; // Number of lines for input area
  showSeparator: boolean;
  separatorChar: string;
  reserveStatusBar: boolean; // Reserve line for status bar
}

const DEFAULT_CONFIG: SplitScreenConfig = {
  inputHeight: 3, // Separator + prompt + space
  showSeparator: true,
  separatorChar: '─',
  reserveStatusBar: false,
};

/**
 * Split-screen layout manager for terminal
 * Maintains separate output and input areas
 */
export class SplitScreen extends EventEmitter {
  private config: SplitScreenConfig;
  private persistentInput: PersistentInput;
  private messageQueue: MessageQueue;

  private outputLines: string[] = [];
  private outputHeight: number = 0;
  private inputHeight: number = 0;
  private terminalHeight: number = 0;
  private terminalWidth: number = 0;

  private scrollOffset: number = 0; // For scrolling output
  private maxOutputLines: number = 10000; // Limit stored lines

  private isInitialized = false;
  private resizeHandler?: () => void;

  constructor(
    messageQueue: MessageQueue,
    persistentInput: PersistentInput,
    config: Partial<SplitScreenConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.messageQueue = messageQueue;
    this.persistentInput = persistentInput;

    this.updateDimensions();
  }

  /**
   * Initialize split-screen layout
   */
  initialize(): void {
    if (this.isInitialized) return;

    this.updateDimensions();

    // Clear screen
    this.clearScreen();

    // Draw separator
    if (this.config.showSeparator) {
      this.drawSeparator();
    }

    // Start persistent input in bottom area
    this.persistentInput.start();

    // Listen for window resize
    this.resizeHandler = this.handleResize.bind(this);
    process.stdout.on('resize', this.resizeHandler);

    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown split-screen layout
   */
  shutdown(): void {
    if (!this.isInitialized) return;

    // Stop persistent input
    this.persistentInput.stop();

    // Remove resize handler
    if (this.resizeHandler) {
      process.stdout.removeListener('resize', this.resizeHandler);
    }

    // Restore normal terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    this.isInitialized = false;
    this.emit('shutdown');
  }

  /**
   * Write output to the output area
   */
  writeOutput(content: string): void {
    const lines = content.split('\n');

    // Add lines to buffer
    for (const line of lines) {
      this.outputLines.push(line);
    }

    // Limit buffer size
    if (this.outputLines.length > this.maxOutputLines) {
      const excess = this.outputLines.length - this.maxOutputLines;
      this.outputLines.splice(0, excess);
    }

    // Auto-scroll to bottom
    this.scrollOffset = Math.max(0, this.outputLines.length - this.outputHeight);

    // Render output area
    this.renderOutput();
  }

  /**
   * Write to output without adding newlines
   */
  writeOutputInline(content: string): void {
    if (this.outputLines.length === 0) {
      this.outputLines.push('');
    }

    // Append to last line
    this.outputLines[this.outputLines.length - 1] += content;

    // Render output area
    this.renderOutput();
  }

  /**
   * Clear output area
   */
  clearOutput(): void {
    this.outputLines = [];
    this.scrollOffset = 0;
    this.renderOutput();
  }

  /**
   * Scroll output up (show older content)
   */
  scrollUp(lines: number = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
    this.renderOutput();
  }

  /**
   * Scroll output down (show newer content)
   */
  scrollDown(lines: number = 1): void {
    const maxScroll = Math.max(0, this.outputLines.length - this.outputHeight);
    this.scrollOffset = Math.min(maxScroll, this.scrollOffset + lines);
    this.renderOutput();
  }

  /**
   * Scroll to bottom of output
   */
  scrollToBottom(): void {
    this.scrollOffset = Math.max(0, this.outputLines.length - this.outputHeight);
    this.renderOutput();
  }

  /**
   * Render output area
   */
  private renderOutput(): void {
    // Save cursor position
    this.saveCursor();

    // Calculate which lines to show
    const startLine = this.scrollOffset;
    const endLine = Math.min(
      this.outputLines.length,
      startLine + this.outputHeight
    );

    // Move to top of output area
    process.stdout.write('\x1b[H');

    // Render visible lines
    for (let i = startLine; i < endLine; i++) {
      const line = this.outputLines[i];

      // Clear line and write content
      process.stdout.write('\x1b[2K' + line + '\n');
    }

    // Fill remaining lines with empty space
    for (let i = endLine - startLine; i < this.outputHeight; i++) {
      process.stdout.write('\x1b[2K\n');
    }

    // Restore cursor position (back to input area)
    this.restoreCursor();
  }

  /**
   * Draw separator line
   */
  private drawSeparator(): void {
    // Save cursor position
    this.saveCursor();

    // Move to separator line
    const separatorRow = this.outputHeight + 1;
    process.stdout.write(`\x1b[${separatorRow};0H`);

    // Draw separator
    const separator = chalk.dim(this.config.separatorChar.repeat(this.terminalWidth));
    process.stdout.write(separator);

    // Restore cursor position
    this.restoreCursor();
  }

  /**
   * Update terminal dimensions
   */
  private updateDimensions(): void {
    this.terminalHeight = process.stdout.rows || 24;
    this.terminalWidth = process.stdout.columns || 80;

    // Calculate heights
    this.inputHeight = this.config.inputHeight;
    this.outputHeight = this.terminalHeight - this.inputHeight;

    if (this.config.reserveStatusBar) {
      this.outputHeight -= 1;
    }

    this.emit('dimensions_updated', {
      terminalHeight: this.terminalHeight,
      terminalWidth: this.terminalWidth,
      outputHeight: this.outputHeight,
      inputHeight: this.inputHeight,
    });
  }

  /**
   * Handle terminal resize
   */
  private handleResize(): void {
    this.updateDimensions();

    // Redraw everything
    if (this.config.showSeparator) {
      this.drawSeparator();
    }

    this.renderOutput();

    this.emit('resized');
  }

  /**
   * Clear entire screen
   */
  private clearScreen(): void {
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[H');
  }

  /**
   * Save cursor position
   */
  private saveCursor(): void {
    process.stdout.write('\x1b7');
  }

  /**
   * Restore cursor position
   */
  private restoreCursor(): void {
    process.stdout.write('\x1b8');
  }

  /**
   * Move cursor to input area
   */
  moveCursorToInput(): void {
    const inputRow = this.outputHeight + (this.config.showSeparator ? 2 : 1);
    process.stdout.write(`\x1b[${inputRow};0H`);
  }

  /**
   * Get current dimensions
   */
  getDimensions(): {
    terminalHeight: number;
    terminalWidth: number;
    outputHeight: number;
    inputHeight: number;
  } {
    return {
      terminalHeight: this.terminalHeight,
      terminalWidth: this.terminalWidth,
      outputHeight: this.outputHeight,
      inputHeight: this.inputHeight,
    };
  }

  /**
   * Get scroll position
   */
  getScrollInfo(): {
    offset: number;
    totalLines: number;
    visibleLines: number;
    canScrollUp: boolean;
    canScrollDown: boolean;
  } {
    return {
      offset: this.scrollOffset,
      totalLines: this.outputLines.length,
      visibleLines: this.outputHeight,
      canScrollUp: this.scrollOffset > 0,
      canScrollDown: this.scrollOffset < this.outputLines.length - this.outputHeight,
    };
  }

  /**
   * Check if at bottom of output
   */
  isAtBottom(): boolean {
    return this.scrollOffset >= this.outputLines.length - this.outputHeight;
  }

  /**
   * Get output buffer (for debugging/testing)
   */
  getOutputBuffer(): string[] {
    return [...this.outputLines];
  }
}
