/**
 * RenderManager - Centralized terminal rendering coordinator
 *
 * All UI components register regions and update through this manager.
 * No direct stdout writes - everything goes through the render loop.
 */

import chalk from 'chalk';

export interface ScreenRegion {
  id: string;
  startRow: number;      // -1 means "from bottom", positive means "from top"
  height: number;        // Number of rows this region occupies
  zIndex: number;        // Higher z-index renders on top
  visible: boolean;
  content: string[];     // Lines of content for this region
  dirty: boolean;        // Needs re-render
}

export interface RenderManagerConfig {
  maxFps: number;              // Maximum frames per second (default: 30)
  enableDoubleBuffering: boolean;
  debugMode: boolean;
}

const DEFAULT_CONFIG: RenderManagerConfig = {
  maxFps: 30,
  enableDoubleBuffering: true,
  debugMode: false,
};

/**
 * Centralized render manager that coordinates all terminal output
 */
export class RenderManager {
  private config: RenderManagerConfig;
  private regions: Map<string, ScreenRegion> = new Map();
  private renderTimer: NodeJS.Timeout | null = null;
  private lastRenderTime = 0;
  private minFrameInterval: number;
  private pendingRender = false;
  private isRendering = false;
  private terminalWidth = 80;
  private terminalHeight = 24;
  private cursorVisible = true;
  private currentBuffer: string[] = [];
  private previousBuffer: string[] = [];

  // Input cursor tracking
  private inputRegionId: string | null = null;
  private inputCursorColumn = 0;

  // Scrollable output region
  private outputBuffer: string[] = [];
  private outputScrollOffset = 0;
  private maxOutputLines = 10000;

  constructor(config: Partial<RenderManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.minFrameInterval = 1000 / this.config.maxFps;
    this.updateTerminalSize();

    // Listen for terminal resize
    process.stdout.on('resize', () => this.handleResize());
  }

  /**
   * Initialize the render manager and start the render loop
   */
  initialize(): void {
    this.updateTerminalSize();
    this.clearScreen();
    this.startRenderLoop();
    // Show cursor - we want input to be visible
    this.showCursor();
  }

  /**
   * Shutdown the render manager
   */
  shutdown(): void {
    this.stopRenderLoop();
    this.showCursor();
    this.clearScreen();
    this.moveCursor(0, 0);
  }

  /**
   * Register a screen region
   */
  registerRegion(region: Omit<ScreenRegion, 'dirty' | 'content'>): void {
    this.regions.set(region.id, {
      ...region,
      content: [],
      dirty: true,
    });
    this.scheduleRender();
  }

  /**
   * Unregister a screen region
   */
  unregisterRegion(id: string): void {
    this.regions.delete(id);
    this.scheduleRender();
  }

  /**
   * Update a region's content - does NOT write to stdout directly
   */
  updateRegion(id: string, content: string | string[]): void {
    const region = this.regions.get(id);
    if (!region) return;

    const lines = Array.isArray(content) ? content : content.split('\n');

    // Only mark dirty if content actually changed
    const contentChanged = !this.arraysEqual(region.content, lines);
    if (contentChanged) {
      region.content = lines;
      region.dirty = true;
      this.scheduleRender();
    }
  }

  /**
   * Update region visibility
   */
  setRegionVisible(id: string, visible: boolean): void {
    const region = this.regions.get(id);
    if (region && region.visible !== visible) {
      region.visible = visible;
      region.dirty = true;
      this.scheduleRender();
    }
  }

  /**
   * Write to the scrollable output buffer (main content area)
   * Automatically wraps long lines
   */
  writeOutput(content: string): void {
    const lines = content.split('\n');
    const wrappedLines: string[] = [];

    // Wrap each line that's too long
    for (const line of lines) {
      if (this.stripAnsi(line).length <= this.terminalWidth) {
        wrappedLines.push(line);
      } else {
        // Split long line into multiple lines
        wrappedLines.push(...this.wrapLine(line));
      }
    }

    this.outputBuffer.push(...wrappedLines);

    // Trim if exceeding max
    if (this.outputBuffer.length > this.maxOutputLines) {
      const excess = this.outputBuffer.length - this.maxOutputLines;
      this.outputBuffer.splice(0, excess);
      this.outputScrollOffset = Math.max(0, this.outputScrollOffset - excess);
    }

    // Auto-scroll to bottom
    this.scrollToBottom();
    this.scheduleRender();
  }

  /**
   * Write inline (append to last line)
   */
  writeOutputInline(content: string): void {
    if (this.outputBuffer.length === 0) {
      this.outputBuffer.push('');
    }
    this.outputBuffer[this.outputBuffer.length - 1] += content;
    this.scheduleRender();
  }

  /**
   * Clear output buffer
   */
  clearOutput(): void {
    this.outputBuffer = [];
    this.outputScrollOffset = 0;
    this.scheduleRender();
  }

  /**
   * Scroll output
   */
  scrollOutput(lines: number): void {
    const maxScroll = Math.max(0, this.outputBuffer.length - this.getOutputHeight());
    this.outputScrollOffset = Math.max(0, Math.min(maxScroll, this.outputScrollOffset + lines));
    this.scheduleRender();
  }

  scrollToBottom(): void {
    this.outputScrollOffset = Math.max(0, this.outputBuffer.length - this.getOutputHeight());
  }

  scrollToTop(): void {
    this.outputScrollOffset = 0;
  }

  // ============================================
  // Render Loop
  // ============================================

  private startRenderLoop(): void {
    if (this.renderTimer) return;

    const loop = () => {
      if (this.pendingRender) {
        this.render();
        this.pendingRender = false;
      }
      this.renderTimer = setTimeout(loop, this.minFrameInterval);
    };

    loop();
  }

  private stopRenderLoop(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
  }

  /**
   * Schedule a render on the next frame
   */
  private scheduleRender(): void {
    this.pendingRender = true;
  }

  /**
   * Force immediate render (use sparingly)
   */
  forceRender(): void {
    this.render();
  }

  /**
   * Main render function - composes all regions and writes to stdout
   */
  private render(): void {
    if (this.isRendering) return;
    this.isRendering = true;

    try {
      // Build new frame buffer
      this.currentBuffer = new Array(this.terminalHeight).fill('');

      // Calculate region positions and render each
      const sortedRegions = this.getSortedRegions();

      for (const region of sortedRegions) {
        if (!region.visible) continue;
        this.renderRegionToBuffer(region);
      }

      // Render output buffer to remaining space
      this.renderOutputToBuffer();

      // Write differences to terminal (or full buffer if not double-buffering)
      this.flushBuffer();

      // Update previous buffer
      this.previousBuffer = [...this.currentBuffer];

      // Clear dirty flags
      for (const region of this.regions.values()) {
        region.dirty = false;
      }

      // Position cursor back to input region
      this.positionCursorToInput();
    } finally {
      this.isRendering = false;
      this.lastRenderTime = Date.now();
    }
  }

  /**
   * Render a region into the buffer
   */
  private renderRegionToBuffer(region: ScreenRegion): void {
    const startRow = this.resolveRow(region.startRow, region.height);

    for (let i = 0; i < region.height && i < region.content.length; i++) {
      const row = startRow + i;
      if (row >= 0 && row < this.terminalHeight) {
        this.currentBuffer[row] = this.truncateLine(region.content[i]);
      }
    }
  }

  /**
   * Render scrollable output to the buffer (fills remaining space)
   */
  private renderOutputToBuffer(): void {
    const outputHeight = this.getOutputHeight();
    const outputStartRow = this.getOutputStartRow();

    const startLine = this.outputScrollOffset;
    const endLine = Math.min(this.outputBuffer.length, startLine + outputHeight);

    for (let i = 0; i < outputHeight; i++) {
      const bufferLine = startLine + i;
      const screenRow = outputStartRow + i;

      if (screenRow >= 0 && screenRow < this.terminalHeight) {
        if (bufferLine < this.outputBuffer.length) {
          this.currentBuffer[screenRow] = this.truncateLine(this.outputBuffer[bufferLine]);
        } else {
          this.currentBuffer[screenRow] = '';
        }
      }
    }
  }

  /**
   * Write buffer to stdout, using differential update if double-buffering
   */
  private flushBuffer(): void {
    if (this.config.enableDoubleBuffering && this.previousBuffer.length === this.currentBuffer.length) {
      // Differential update - only write changed lines
      for (let row = 0; row < this.currentBuffer.length; row++) {
        if (this.currentBuffer[row] !== this.previousBuffer[row]) {
          this.writeLineAt(row, this.currentBuffer[row]);
        }
      }
    } else {
      // Full redraw
      this.moveCursor(0, 0);
      for (let row = 0; row < this.currentBuffer.length; row++) {
        this.writeLineAt(row, this.currentBuffer[row]);
      }
    }
  }

  // ============================================
  // Terminal Helpers
  // ============================================

  private writeLineAt(row: number, content: string): void {
    // Move to row, clear line, write content
    process.stdout.write(`\x1b[${row + 1};1H\x1b[2K${content}`);
  }

  private moveCursor(row: number, col: number): void {
    process.stdout.write(`\x1b[${row + 1};${col + 1}H`);
  }

  private clearScreen(): void {
    process.stdout.write('\x1b[2J');
  }

  private hideCursor(): void {
    if (this.cursorVisible) {
      process.stdout.write('\x1b[?25l');
      this.cursorVisible = false;
    }
  }

  private showCursor(): void {
    if (!this.cursorVisible) {
      process.stdout.write('\x1b[?25h');
      this.cursorVisible = true;
    }
  }

  private updateTerminalSize(): void {
    this.terminalWidth = process.stdout.columns || 80;
    this.terminalHeight = process.stdout.rows || 24;
  }

  private handleResize(): void {
    this.updateTerminalSize();
    this.previousBuffer = []; // Force full redraw
    this.scheduleRender();
  }

  // ============================================
  // Layout Helpers
  // ============================================

  /**
   * Resolve row position (handles negative = from bottom)
   */
  private resolveRow(startRow: number, height: number): number {
    if (startRow >= 0) {
      return startRow;
    } else {
      // Negative means from bottom
      return this.terminalHeight + startRow - height + 1;
    }
  }

  /**
   * Get regions sorted by z-index (lowest first)
   */
  private getSortedRegions(): ScreenRegion[] {
    return Array.from(this.regions.values()).sort((a, b) => a.zIndex - b.zIndex);
  }

  /**
   * Calculate output area height (terminal minus fixed regions)
   */
  private getOutputHeight(): number {
    let usedRows = 0;
    for (const region of this.regions.values()) {
      if (region.visible) {
        usedRows += region.height;
      }
    }
    return Math.max(1, this.terminalHeight - usedRows);
  }

  /**
   * Get the starting row for output content
   */
  private getOutputStartRow(): number {
    // Find the bottom of top-aligned regions
    let topRegionEnd = 0;
    for (const region of this.regions.values()) {
      if (region.visible && region.startRow >= 0) {
        topRegionEnd = Math.max(topRegionEnd, region.startRow + region.height);
      }
    }
    return topRegionEnd;
  }

  /**
   * Wrap a long line into multiple lines at word boundaries
   */
  private wrapLine(line: string): string[] {
    const result: string[] = [];
    const plainText = this.stripAnsi(line);

    if (plainText.length <= this.terminalWidth) {
      return [line];
    }

    // For now, use simple word-boundary wrapping
    // A full implementation would preserve ANSI codes across wraps
    const words = line.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const testPlain = this.stripAnsi(testLine);

      if (testPlain.length <= this.terminalWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          result.push(currentLine);
        }
        currentLine = word;
      }
    }

    if (currentLine) {
      result.push(currentLine);
    }

    return result.length > 0 ? result : [line];
  }

  /**
   * Truncate line to terminal width (for regions that shouldn't wrap)
   */
  private truncateLine(line: string): string {
    const plainText = this.stripAnsi(line);
    if (plainText.length <= this.terminalWidth) {
      return line;
    }

    // Find last space before width limit
    const truncateAt = plainText.lastIndexOf(' ', this.terminalWidth);
    if (truncateAt > this.terminalWidth * 0.7) {
      // Good break point found
      return line.slice(0, truncateAt) + '…';
    }

    // No good break point, hard truncate with ellipsis
    return line.slice(0, this.terminalWidth - 1) + '…';
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ============================================
  // Input Cursor Management
  // ============================================

  /**
   * Set the active input region (cursor will be positioned here after each render)
   */
  setInputRegion(regionId: string): void {
    this.inputRegionId = regionId;
  }

  /**
   * Update the cursor column position within the input region
   */
  setInputCursorColumn(column: number): void {
    this.inputCursorColumn = column;
    this.positionCursorToInput();
  }

  /**
   * Position cursor to the input region
   */
  private positionCursorToInput(): void {
    if (!this.inputRegionId) return;

    const inputRegion = this.regions.get(this.inputRegionId);
    if (!inputRegion || !inputRegion.visible) return;

    // Calculate the row of the input region
    const row = this.resolveRow(inputRegion.startRow, inputRegion.height);
    const col = this.inputCursorColumn;

    // Move cursor and show it
    this.moveCursor(row, col);
    this.showCursor();
  }

  // ============================================
  // Public Getters
  // ============================================

  getTerminalWidth(): number {
    return this.terminalWidth;
  }

  getTerminalHeight(): number {
    return this.terminalHeight;
  }

  getOutputBufferLength(): number {
    return this.outputBuffer.length;
  }

  isAtBottom(): boolean {
    const maxScroll = Math.max(0, this.outputBuffer.length - this.getOutputHeight());
    return this.outputScrollOffset >= maxScroll;
  }
}

// Singleton instance for global access
let globalRenderManager: RenderManager | null = null;

export function getRenderManager(): RenderManager | null {
  return globalRenderManager;
}

export function setRenderManager(manager: RenderManager | null): void {
  globalRenderManager = manager;
}

export function createRenderManager(config?: Partial<RenderManagerConfig>): RenderManager {
  const manager = new RenderManager(config);
  setRenderManager(manager);
  return manager;
}
