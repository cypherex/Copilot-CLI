// Output manager that writes above persistent bottom bar
// Maintains output buffer and handles scrolling

import chalk from 'chalk';
import type { BottomBar } from './bottom-bar.js';

export interface OutputManagerConfig {
  maxLines: number; // Maximum lines to keep in buffer
  scrollOffset: number; // Initial scroll position
  enableScrolling: boolean;
  enableScrollbars: boolean;
}

export const DEFAULT_OUTPUT_MANAGER_CONFIG: OutputManagerConfig = {
  maxLines: 10000,
  scrollOffset: 0,
  enableScrolling: true,
  enableScrollbars: true,
};

/**
 * Output manager that writes above the persistent bottom bar
 * Preserves output history and handles scrolling
 */
export class OutputManager {
  private config: OutputManagerConfig;
  private bottomBar: BottomBar;
  private lines: string[] = [];
  private scrollOffset: number = 0;
  private cursorSaved = false;

  // Terminal dimensions
  private terminalHeight = 0;
  private terminalWidth = 0;
  private outputHeight = 0;

  constructor(
    bottomBar: BottomBar,
    config: Partial<OutputManagerConfig> = {}
  ) {
    this.bottomBar = bottomBar;
    this.config = { ...DEFAULT_OUTPUT_MANAGER_CONFIG, ...config };
    this.scrollOffset = this.config.scrollOffset;

    this.updateDimensions();
  }

  /**
   * Update terminal dimensions
   */
  private updateDimensions(): void {
    this.terminalHeight = process.stdout.rows || 24;
    this.terminalWidth = process.stdout.columns || 80;
    this.outputHeight = this.bottomBar.getOutputHeight();
  }

  /**
   * Write content to output area
   */
  write(content: string): void {
    const lines = content.split('\n');

    // Add lines to buffer
    for (const line of lines) {
      this.lines.push(line);
    }

    // Limit buffer size
    if (this.lines.length > this.config.maxLines) {
      const excess = this.lines.length - this.config.maxLines;
      this.lines.splice(0, excess);
      this.scrollOffset = Math.max(0, this.scrollOffset - excess);
    }

    // Auto-scroll to bottom
    this.scrollToBottom();
  }

  /**
   * Write content without adding newlines
   */
  writeInline(content: string): void {
    if (this.lines.length === 0) {
      this.lines.push('');
    }

    // Append to last line
    this.lines[this.lines.length - 1] += content;

    // Re-render if near bottom
    if (this.isAtBottom()) {
      this.render();
    }
  }

  /**
   * Clear output buffer
   */
  clear(): void {
    this.lines = [];
    this.scrollOffset = 0;
    this.render();
  }

  /**
   * Clear last N lines
   */
  clearLastLines(count: number): void {
    const removeCount = Math.min(count, this.lines.length);
    this.lines.splice(-removeCount);
    this.render();
  }

  /**
   * Scroll output up (show older content)
   */
  scrollUp(lines: number = 1): void {
    if (!this.config.enableScrolling) return;

    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
    this.render();
  }

  /**
   * Scroll output down (show newer content)
   */
  scrollDown(lines: number = 1): void {
    if (!this.config.enableScrolling) return;

    const maxScroll = Math.max(0, this.lines.length - this.outputHeight);
    this.scrollOffset = Math.min(maxScroll, this.scrollOffset + lines);
    this.render();
  }

  /**
   * Scroll to top of output
   */
  scrollToTop(): void {
    if (!this.config.enableScrolling) return;

    this.scrollOffset = 0;
    this.render();
  }

  /**
   * Scroll to bottom of output
   */
  scrollToBottom(): void {
    const maxScroll = Math.max(0, this.lines.length - this.outputHeight);
    this.scrollOffset = maxScroll;
    this.render();
  }

  /**
   * Check if at bottom of output
   */
  isAtBottom(): boolean {
    const maxScroll = Math.max(0, this.lines.length - this.outputHeight);
    return this.scrollOffset >= maxScroll;
  }

  /**
   * Render output area
   */
  render(): void {
    this.saveCursor();

    // Move to top of output area
    process.stdout.write('\x1b[H');

    // Calculate which lines to show
    const startLine = this.scrollOffset;
    const endLine = Math.min(
      this.lines.length,
      startLine + this.outputHeight
    );

    // Render visible lines
    for (let i = startLine; i < endLine; i++) {
      const line = this.lines[i];

      // Clear line and write content
      process.stdout.write('\x1b[2K');
      process.stdout.write(line + '\n');
    }

    // Fill remaining lines with empty space
    const visibleLines = endLine - startLine;
    for (let i = visibleLines; i < this.outputHeight; i++) {
      process.stdout.write('\x1b[2K\n');
    }

    // Restore cursor position (back to bottom bar input area)
    this.restoreCursor();
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
   * Handle terminal resize
   */
  handleResize(): void {
    this.updateDimensions();

    // Adjust scroll offset if needed
    const maxScroll = Math.max(0, this.lines.length - this.outputHeight);
    this.scrollOffset = Math.min(this.scrollOffset, maxScroll);

    this.render();
  }

  /**
   * Get scroll info
   */
  getScrollInfo(): {
    offset: number;
    totalLines: number;
    visibleLines: number;
    canScrollUp: boolean;
    canScrollDown: boolean;
    isAtBottom: boolean;
  } {
    const maxScroll = Math.max(0, this.lines.length - this.outputHeight);

    return {
      offset: this.scrollOffset,
      totalLines: this.lines.length,
      visibleLines: this.outputHeight,
      canScrollUp: this.scrollOffset > 0,
      canScrollDown: this.scrollOffset < maxScroll,
      isAtBottom: this.scrollOffset >= maxScroll,
    };
  }

  /**
   * Get output buffer
   */
  getBuffer(): string[] {
    return [...this.lines];
  }

  /**
   * Get last N lines
   */
  getLastLines(count: number): string[] {
    return this.lines.slice(-count);
  }

  /**
   * Search for a pattern in output
   */
  search(pattern: RegExp | string): number[] {
    const lines: number[] = [];
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'gi');

    for (let i = 0; i < this.lines.length; i++) {
      if (regex.test(this.lines[i])) {
        lines.push(i);
      }
    }

    return lines;
  }

  /**
   * Jump to a specific line
   */
  jumpToLine(lineNumber: number): void {
    // Center the line in view
    const halfHeight = Math.floor(this.outputHeight / 2);
    this.scrollOffset = Math.max(0, lineNumber - halfHeight);

    this.render();
  }
}
