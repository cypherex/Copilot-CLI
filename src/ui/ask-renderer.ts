/**
 * AskRenderer - Simple text-only renderer for headless ask command
 *
 * Subscribes to UIState and renders output as plain text for scriptable/headless usage.
 * Works in both normal and JSON capture modes.
 */

import chalk from 'chalk';
import { uiState, type MessageState } from './ui-state.js';
import { ParallelExecutionRenderer } from './regions/parallel-execution-region.js';
import { SubagentRenderer } from './regions/subagent-region.js';

export interface AskRendererOptions {
  captureMode?: boolean; // If true, don't use colors and capture output
  verbose?: boolean;     // Show all details
}

/**
 * Simple text-only renderer for ask command
 */
export class AskRenderer {
  private unsubscribe?: () => void;
  private options: AskRendererOptions;
  private output: string[] = [];
  private lastStreamContent = '';
  private liveMessageContent: Map<string, string> = new Map(); // Track last rendered content for live messages

  constructor(options: AskRendererOptions = {}) {
    this.options = {
      captureMode: false,
      verbose: false,
      ...options,
    };
  }

  /**
   * Start listening to UIState and rendering output
   */
  start(): void {
    this.unsubscribe = uiState.subscribe((state, changedKeys) => {
      // Handle new messages
      if (changedKeys.includes('pendingMessages') && state.pendingMessages.length > 0) {
        const messages = uiState.clearPendingMessages();
        for (const msg of messages) {
          this.renderMessage(msg);
        }
      }

      // Handle live message updates
      if (changedKeys.includes('liveMessages')) {
        for (const [id, msg] of state.liveMessages) {
          this.renderLiveMessage(id, msg);
        }
      }

      // Handle streaming
      if (changedKeys.includes('isStreaming') && state.isStreaming) {
        this.writeLine(this.colorize('Assistant:', 'cyan'));
        this.lastStreamContent = '';
      }

      if (changedKeys.includes('streamContent') && state.isStreaming) {
        const newContent = state.streamContent.slice(this.lastStreamContent.length);
        if (newContent) {
          this.write(newContent);
          this.lastStreamContent = state.streamContent;
        }
      }

      if (changedKeys.includes('isStreaming') && !state.isStreaming && this.lastStreamContent) {
        this.writeLine('');
        this.writeLine('');
        this.lastStreamContent = '';
      }
    });
  }

  /**
   * Stop listening and cleanup
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Get captured output (for JSON mode)
   */
  getCapturedOutput(): string {
    return this.output.join('\n');
  }

  /**
   * Clear captured output
   */
  clearCapturedOutput(): void {
    this.output = [];
  }

  /**
   * Render a live-updating message (updates in place conceptually, but we just re-render)
   */
  private renderLiveMessage(id: string, msg: MessageState): void {
    const lines = this.renderMessageToLines(msg);
    const newContent = lines.join('\n');

    // Only render if content changed (avoid duplicate renders)
    const lastContent = this.liveMessageContent.get(id);
    if (lastContent === newContent) {
      return;
    }

    this.liveMessageContent.set(id, newContent);

    // For text-only mode, we can't update in place, so we just render once
    // If it's the first time, render it
    if (!lastContent) {
      for (const line of lines) {
        this.writeLine(line);
      }
    }
    // For subsequent updates in text-only mode, we skip re-rendering to avoid spam
    // The final state will be captured when the message is finalized
  }

  /**
   * Render a message to lines
   */
  private renderMessageToLines(msg: MessageState): string[] {
    const lines: string[] = [];

    switch (msg.role) {
      case 'parallel-status':
        if (msg.parallelExecutionId) {
          const state = uiState.getState();
          const rendered = ParallelExecutionRenderer.render(
            state.parallelExecution,
            msg.parallelExecutionId
          );
          // Strip ANSI codes if in capture mode
          lines.push(...rendered.map(line => this.stripAnsiIfNeeded(line)));
        }
        break;
      case 'subagent-status':
        if (msg.subagentId) {
          const state = uiState.getState();
          const rendered = SubagentRenderer.render(state.subagents, msg.subagentId);
          lines.push(...rendered.map(line => this.stripAnsiIfNeeded(line)));
        }
        break;
      default:
        if (msg.content) {
          lines.push(this.stripAnsiIfNeeded(msg.content));
        }
    }

    return lines;
  }

  /**
   * Render a message based on its role
   */
  private renderMessage(msg: MessageState): void {
    switch (msg.role) {
      case 'user':
        this.writeLine(this.colorize('You: ', 'green') + msg.content);
        this.writeLine('');
        break;
      case 'assistant':
        this.writeLine(this.colorize('Assistant:', 'cyan'));
        this.writeLine(msg.content);
        this.writeLine('');
        break;
      case 'tool':
        // Tool output
        this.writeLine(this.colorize('→ ', 'blue') + msg.content);
        break;
      case 'system':
        // System messages (agent status, etc.)
        this.writeLine(this.stripAnsiIfNeeded(msg.content));
        break;
      case 'parallel-status':
        // Live parallel execution status
        if (msg.parallelExecutionId) {
          const state = uiState.getState();
          const lines = ParallelExecutionRenderer.render(
            state.parallelExecution,
            msg.parallelExecutionId
          );
          for (const line of lines) {
            this.writeLine(this.stripAnsiIfNeeded(line));
          }
          this.writeLine('');
        }
        break;
      case 'subagent-status':
        // Live subagent status
        if (msg.subagentId) {
          const state = uiState.getState();
          const lines = SubagentRenderer.render(
            state.subagents,
            msg.subagentId
          );
          for (const line of lines) {
            this.writeLine(this.stripAnsiIfNeeded(line));
          }
          this.writeLine('');
        }
        break;
    }
  }

  /**
   * Write a line to output
   */
  private writeLine(content: string): void {
    if (this.options.captureMode) {
      this.output.push(content);
    } else {
      console.log(content);
    }
  }

  /**
   * Write inline (no newline)
   */
  private write(content: string): void {
    if (this.options.captureMode) {
      if (this.output.length === 0) {
        this.output.push('');
      }
      this.output[this.output.length - 1] += content;
    } else {
      process.stdout.write(content);
    }
  }

  /**
   * Colorize text (only if not in capture mode)
   */
  private colorize(text: string, color: 'green' | 'cyan' | 'blue' | 'dim'): string {
    if (this.options.captureMode) {
      return text;
    }
    switch (color) {
      case 'green': return chalk.green(text);
      case 'cyan': return chalk.cyan(text);
      case 'blue': return chalk.blue(text);
      case 'dim': return chalk.dim(text);
      default: return text;
    }
  }

  /**
   * Strip ANSI codes if in capture mode
   */
  private stripAnsiIfNeeded(text: string): string {
    if (this.options.captureMode) {
      return text.replace(/\x1b\[[0-9;]*m/g, '');
    }
    return text;
  }
}
