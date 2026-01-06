/**
 * Input region - handles user input display
 */

import chalk from 'chalk';
import { BaseRegion } from './base-region.js';
import { getRenderManager } from '../render-manager.js';

/**
 * Input region that displays at the very bottom
 */
export class InputRegion extends BaseRegion {
  private prompt: string;
  private currentInput = '';
  private cursorPosition = 0;

  constructor(prompt: string = 'You: ') {
    super({
      id: 'input',
      height: 1,
      position: 'bottom',
      zIndex: 110,  // Highest z-index - always on top
    });
    this.prompt = chalk.green(prompt);
  }

  /**
   * Update the input text and cursor position
   */
  updateInput(text: string, cursorPosition: number): void {
    this.currentInput = text;
    this.cursorPosition = cursorPosition;
    this.render();
  }

  /**
   * Clear the input
   */
  clearInput(): void {
    this.currentInput = '';
    this.cursorPosition = 0;
    this.render();
  }

  /**
   * Update the prompt
   */
  setPrompt(prompt: string): void {
    this.prompt = chalk.green(prompt);
    this.render();
  }

  /**
   * Render the input line
   */
  render(): void {
    const terminalWidth = getRenderManager()?.getTerminalWidth() ?? process.stdout.columns ?? 80;

    // Build the input line with cursor indicator
    const promptLen = this.stripAnsi(this.prompt).length;
    const maxInputLen = terminalWidth - promptLen - 1;

    let displayInput = this.currentInput;
    let displayCursor = this.cursorPosition;

    // Handle scrolling if input is too long
    if (displayInput.length > maxInputLen) {
      const scrollOffset = Math.max(0, this.cursorPosition - maxInputLen + 10);
      displayInput = displayInput.slice(scrollOffset);
      displayCursor = this.cursorPosition - scrollOffset;

      if (displayInput.length > maxInputLen) {
        displayInput = displayInput.slice(0, maxInputLen);
      }
    }

    // Build the line - cursor position is managed by RenderManager
    const inputLine = this.prompt + displayInput;
    this.update([inputLine]);

    // Notify RenderManager of cursor position
    const renderManager = getRenderManager();
    if (renderManager) {
      renderManager.setInputCursorColumn(promptLen + displayCursor);
    }
  }

  /**
   * Get cursor column position for RenderManager
   */
  getCursorColumn(): number {
    const promptLen = this.stripAnsi(this.prompt).length;
    return promptLen + this.cursorPosition;
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }
}
