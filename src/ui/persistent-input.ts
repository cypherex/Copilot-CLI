// Persistent input handler that listens continuously
// Allows typing at any time, even while agent is working

import { EventEmitter } from 'events';
import chalk from 'chalk';
import { MessageQueue } from './message-queue.js';

export interface PersistentInputConfig {
  prompt: string;
  maxLength: number;
  historySize: number;
  multilineEnabled: boolean;
}

const DEFAULT_CONFIG: PersistentInputConfig = {
  prompt: chalk.green('You: '),
  maxLength: 10000,
  historySize: 100,
  multilineEnabled: true,
};

/**
 * Persistent input handler that's always listening
 * Users can type at any time, messages are queued
 */
export class PersistentInput extends EventEmitter {
  private config: PersistentInputConfig;
  private messageQueue: MessageQueue;
  private currentInput = '';
  private cursorPosition = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private isListening = false;
  private isPaused = false;

  // Autocomplete
  private availableCommands: string[] = [];

  constructor(messageQueue: MessageQueue, config: Partial<PersistentInputConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.messageQueue = messageQueue;
  }

  /**
   * Set available commands for autocomplete
   */
  setCommands(commands: string[]): void {
    this.availableCommands = commands.map(c => `/${c}`);
  }

  /**
   * Start listening to stdin
   */
  start(): void {
    if (this.isListening) return;

    this.isListening = true;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.setEncoding('utf8');
    process.stdin.resume(); // CRITICAL: Resume stdin to start receiving input
    process.stdin.on('data', this.handleKeypress.bind(this));

    // Initial prompt
    this.renderPrompt();

    this.emit('started');
  }

  /**
   * Stop listening to stdin
   */
  stop(): void {
    if (!this.isListening) return;

    this.isListening = false;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    process.stdin.removeAllListeners('data');

    this.emit('stopped');
  }

  /**
   * Pause input (hide prompt, stop processing)
   */
  pause(): void {
    this.isPaused = true;
    this.clearPrompt();
    this.emit('paused');
  }

  /**
   * Resume input (show prompt, start processing)
   */
  resume(): void {
    this.isPaused = false;
    this.renderPrompt();
    this.emit('resumed');
  }

  /**
   * Handle keypress events
   */
  private handleKeypress(chunk: string): void {
    if (this.isPaused) return;

    for (const char of chunk) {
      const code = char.charCodeAt(0);

      // Ctrl+C - Interrupt
      if (code === 3) {
        this.emit('interrupt');
        continue;
      }

      // Ctrl+D - EOF (submit if not empty, otherwise exit)
      if (code === 4) {
        if (this.currentInput.trim()) {
          this.submitCurrentInput();
        } else {
          this.emit('exit');
        }
        continue;
      }

      // Enter/Return - Submit
      if (char === '\r' || char === '\n') {
        if (this.currentInput.trim()) {
          this.submitCurrentInput();
        } else {
          // Empty line - just redraw
          this.renderPrompt();
        }
        continue;
      }

      // Backspace
      if (code === 127 || code === 8) {
        if (this.cursorPosition > 0) {
          this.currentInput =
            this.currentInput.slice(0, this.cursorPosition - 1) +
            this.currentInput.slice(this.cursorPosition);
          this.cursorPosition--;
          this.renderPrompt();
        }
        continue;
      }

      // Delete key (ESC[3~)
      if (char === '\x1b') {
        // Start of escape sequence - need to handle next chars
        // For now, skip
        continue;
      }

      // Ctrl+A - Move to start
      if (code === 1) {
        this.cursorPosition = 0;
        this.renderPrompt();
        continue;
      }

      // Ctrl+E - Move to end
      if (code === 5) {
        this.cursorPosition = this.currentInput.length;
        this.renderPrompt();
        continue;
      }

      // Ctrl+U - Clear line
      if (code === 21) {
        this.currentInput = '';
        this.cursorPosition = 0;
        this.renderPrompt();
        continue;
      }

      // Ctrl+K - Delete to end
      if (code === 11) {
        this.currentInput = this.currentInput.slice(0, this.cursorPosition);
        this.renderPrompt();
        continue;
      }

      // Ctrl+W - Delete word backward
      if (code === 23) {
        const beforeCursor = this.currentInput.slice(0, this.cursorPosition);
        const match = beforeCursor.match(/\s*\S+\s*$/);
        if (match) {
          const deleteCount = match[0].length;
          this.currentInput =
            this.currentInput.slice(0, this.cursorPosition - deleteCount) +
            this.currentInput.slice(this.cursorPosition);
          this.cursorPosition -= deleteCount;
          this.renderPrompt();
        }
        continue;
      }

      // Tab - Autocomplete
      if (code === 9) {
        this.handleAutocomplete();
        continue;
      }

      // Arrow keys and other escape sequences (simplified handling)
      // Up arrow: \x1b[A, Down: \x1b[B, Right: \x1b[C, Left: \x1b[D
      // For now, we'll handle these in a basic way

      // Regular printable character
      if (code >= 32 && code < 127) {
        if (this.currentInput.length < this.config.maxLength) {
          this.currentInput =
            this.currentInput.slice(0, this.cursorPosition) +
            char +
            this.currentInput.slice(this.cursorPosition);
          this.cursorPosition++;
          this.renderPrompt();
        }
        continue;
      }
    }
  }

  /**
   * Submit current input to message queue
   */
  private submitCurrentInput(): void {
    const message = this.currentInput.trim();

    if (!message) {
      this.renderPrompt();
      return;
    }

    // Add to history
    this.history.push(message);
    if (this.history.length > this.config.historySize) {
      this.history.shift();
    }
    this.historyIndex = -1;

    // Add to message queue
    const messageId = this.messageQueue.enqueue(message);

    // Emit event
    this.emit('message_submitted', { message, messageId });

    // Clear input
    this.currentInput = '';
    this.cursorPosition = 0;

    // Redraw prompt
    this.renderPrompt();
  }

  /**
   * Handle tab autocomplete
   */
  private handleAutocomplete(): void {
    if (!this.currentInput.startsWith('/')) {
      return;
    }

    const matches = this.availableCommands.filter(cmd =>
      cmd.startsWith(this.currentInput)
    );

    if (matches.length === 1) {
      // Single match - complete it
      this.currentInput = matches[0];
      this.cursorPosition = this.currentInput.length;
      this.renderPrompt();
    } else if (matches.length > 1) {
      // Multiple matches - show them
      // For now, just render current prompt
      // In future, could show suggestions above prompt
      this.renderPrompt();
    }
  }

  /**
   * Render the input prompt
   */
  private renderPrompt(): void {
    // Clear current line
    process.stdout.write('\r\x1b[K');

    // Render prompt and input
    process.stdout.write(this.config.prompt + this.currentInput);

    // Move cursor to correct position using absolute positioning
    // This is more reliable than relative movement (\x1b[${col}C)
    const promptLength = this.stripAnsi(this.config.prompt).length;
    const targetColumn = promptLength + this.cursorPosition;
    // Use \r to return to column 0, then move to target column
    process.stdout.write('\r');
    if (targetColumn > 0) {
      process.stdout.write('\x1b[' + targetColumn + 'C');
    }
  }

  /**
   * Clear the prompt from display
   */
  private clearPrompt(): void {
    process.stdout.write('\r\x1b[K');
  }

  /**
   * Strip ANSI codes to get real length
   */
  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Get current input (for display purposes)
   */
  getCurrentInput(): string {
    return this.currentInput;
  }

  /**
   * Get input history
   */
  getHistory(): string[] {
    return [...this.history];
  }

  /**
   * Clear input history
   */
  clearHistory(): void {
    this.history = [];
    this.historyIndex = -1;
  }

  /**
   * Check if currently listening
   */
  isActive(): boolean {
    return this.isListening && !this.isPaused;
  }
}
