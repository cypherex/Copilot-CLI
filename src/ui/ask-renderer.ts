/**
 * AskRenderer - Simple text-only renderer for headless ask command
 *
 * Subscribes to UIState and renders output as plain text for scriptable/headless usage.
 * Works in both normal and JSON capture modes.
 */

import chalk from 'chalk';
import type { WriteStream } from 'fs';
import { uiState, type MessageState } from './ui-state.js';
import { ParallelExecutionRenderer } from './regions/parallel-execution-region.js';
import { SubagentRenderer } from './regions/subagent-region.js';
import type { LogManager } from './log-manager.js';

export interface AskRendererOptions {
  captureMode?: boolean;    // If true, don't use colors and capture output
  verbose?: boolean;        // Show all details
  outputFile?: WriteStream; // Optional file stream to write output to (in addition to stdout) - DEPRECATED, use logManager
  logManager?: LogManager;  // Optional log manager for structured logging with subagent separation
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
  private activeSubagents: Set<string> = new Set(); // Track active subagent IDs
  private lastRenderedSubagentStatus: Map<string, { status: string; result?: string }> = new Map(); // Track what we last rendered

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
        // Track which subagents are currently live
        const currentLiveSubagents = new Set<string>();

        for (const [id, msg] of state.liveMessages) {
          this.renderLiveMessage(id, msg);

          // Track subagent if it's a subagent message
          if (msg.role === 'subagent-status' && msg.subagentId) {
            currentLiveSubagents.add(msg.subagentId);
            this.activeSubagents.add(msg.subagentId);
          }
        }

        // Close streams for subagents that are no longer live
        for (const subagentId of this.activeSubagents) {
          if (!currentLiveSubagents.has(subagentId)) {
            // Subagent was finalized - close its stream
            if (this.options.logManager) {
              this.options.logManager.closeSubagentStream(subagentId).catch(err => {
                console.error('Failed to close subagent stream:', err);
              });
            }
            this.activeSubagents.delete(subagentId);
          }
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
    // Special handling for subagent messages
    if (msg.role === 'subagent-status' && msg.subagentId) {
      this.renderSubagentMessage(msg.subagentId);
      return;
    }

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
        // Live subagent status - render summary to main, full details to subagent log
        if (msg.subagentId) {
          this.renderSubagentMessage(msg.subagentId);
        }
        break;
    }
  }

  /**
   * Render subagent status - summary to main output, full details to subagent log
   */
  private renderSubagentMessage(subagentId: string): void {
    const state = uiState.getState();
    const subagentState = state.subagents?.active.find(s => s.id === subagentId) ||
                          state.subagents?.completed.find(s => s.id === subagentId);

    if (!subagentState) return;

    // Always write full details to subagent log if using LogManager
    if (this.options.logManager) {
      const lines = SubagentRenderer.render(state.subagents, subagentId);
      const content = lines.map(line => this.stripAnsi(line)).join('\n') + '\n\n';
      this.options.logManager.writeToSubagent(subagentId, content, subagentState.role).catch(err => {
        console.error('Failed to write to subagent log:', err);
      });
    }

    // Check if we need to render a summary to main output
    const lastRendered = this.lastRenderedSubagentStatus.get(subagentId);
    const currentStatus = {
      status: subagentState.status,
      result: subagentState.result,
    };

    // Only render summary if:
    // 1. First time seeing this subagent, OR
    // 2. Status changed (spawning -> running -> completed), OR
    // 3. Result appeared/changed
    const shouldRenderSummary = !lastRendered ||
      lastRendered.status !== currentStatus.status ||
      lastRendered.result !== currentStatus.result;

    if (!shouldRenderSummary) {
      return; // Skip duplicate render
    }

    // Update tracking
    this.lastRenderedSubagentStatus.set(subagentId, currentStatus);

    // Render summary to main output or full details if no log manager
    if (this.options.logManager) {
      // Only show key state transitions
      if (subagentState.status === 'spawning') {
        this.writeLine(this.colorize(`▶ Subagent: ${subagentState.role || 'agent'} started`, 'dim'));
        const taskPreview = subagentState.task.split('\n')[0]; // First line only
        this.writeLine(this.colorize(`  Task: ${taskPreview}${subagentState.task.includes('\n') ? '...' : ''}`, 'dim'));
        this.writeLine('');
      } else if (subagentState.status === 'completed' || subagentState.status === 'failed') {
        const duration = subagentState.endTime ? ((subagentState.endTime - subagentState.startTime) / 1000).toFixed(1) : '?';
        const statusSymbol = subagentState.status === 'completed' ? '✓' : '✗';
        this.writeLine(this.colorize(`${statusSymbol} Subagent: ${subagentState.role || 'agent'} ${subagentState.status} (${duration}s)`, 'dim'));
        if (subagentState.result) {
          this.writeLine(this.colorize(`  Result: ${subagentState.result.substring(0, 100)}${subagentState.result.length > 100 ? '...' : ''}`, 'dim'));
        }
        if (subagentState.error) {
          this.writeLine(this.colorize(`  Error: ${subagentState.error}`, 'dim'));
        }
        this.writeLine(this.colorize(`  → Full output: session.subagents/${subagentState.role || 'subagent'}-${subagentId.slice(0, 8)}.log`, 'dim'));
        this.writeLine('');
      }
      // Skip rendering for intermediate statuses like "running" to reduce noise
    } else {
      // No log manager - render full details to main output (backward compatibility)
      const lines = SubagentRenderer.render(state.subagents, subagentId);
      for (const line of lines) {
        this.writeLine(this.stripAnsiIfNeeded(line));
      }
      this.writeLine('');
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

    // Write to file (prefer logManager over direct outputFile)
    if (this.options.logManager) {
      const cleanContent = this.stripAnsi(content);
      this.options.logManager.writeToMain(cleanContent + '\n');
    } else if (this.options.outputFile) {
      const cleanContent = this.stripAnsi(content);
      this.options.outputFile.write(cleanContent + '\n');
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

    // Write to file (prefer logManager over direct outputFile)
    if (this.options.logManager) {
      const cleanContent = this.stripAnsi(content);
      this.options.logManager.writeToMain(cleanContent);
    } else if (this.options.outputFile) {
      const cleanContent = this.stripAnsi(content);
      this.options.outputFile.write(cleanContent);
    }
  }

  /**
   * Strip ANSI codes from text
   */
  private stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
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
      return this.stripAnsi(text);
    }
    return text;
  }
}
