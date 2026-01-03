/**
 * Output region - scrollable content area for messages
 * Subscribes to UIState for new messages
 */

import chalk from 'chalk';
import type { RenderManager } from '../render-manager.js';
import { uiState, type MessageState } from '../ui-state.js';
import { ParallelExecutionRenderer } from './parallel-execution-region.js';
import { SubagentRenderer } from './subagent-region.js';

/**
 * Output region handles the scrollable main content area
 * Subscribes to UIState for new messages and streaming content
 */
export class OutputRegion {
  private renderManager: RenderManager | null = null;
  private unsubscribe?: () => void;
  private lastStreamContent = '';

  constructor() {}

  /**
   * Attach to render manager
   */
  attach(renderManager: RenderManager): void {
    this.renderManager = renderManager;
  }

  /**
   * Detach from render manager
   */
  detach(): void {
    this.renderManager = null;
  }

  /**
   * Start listening to state changes
   */
  startListening(): void {
    this.unsubscribe = uiState.subscribe((state, changedKeys) => {
      // Handle new messages
      if (changedKeys.includes('pendingMessages') && state.pendingMessages.length > 0) {
        const messages = uiState.clearPendingMessages();
        for (const msg of messages) {
          this.renderMessage(msg);
        }
      }

      // Re-render active parallel execution status when it changes
      if (changedKeys.includes('parallelExecution') && state.parallelExecution?.isActive) {
        // Re-render the parallel status
        const lines = ParallelExecutionRenderer.render(
          state.parallelExecution,
          state.parallelExecution.id
        );
        // Write as update (this will show progress)
        for (const line of lines) {
          this.writeLine(line);
        }
      }

      // Re-render active subagents when they change
      if (changedKeys.includes('subagents') && state.subagents) {
        const activeAgents = state.subagents.active;
        if (activeAgents.length > 0) {
          // Re-render each active subagent
          for (const agent of activeAgents) {
            const lines = SubagentRenderer.render(state.subagents, agent.id);
            for (const line of lines) {
              this.writeLine(line);
            }
          }
        }
      }

      // Handle streaming
      if (changedKeys.includes('isStreaming') && state.isStreaming) {
        this.writeLine(chalk.cyan('Assistant:'));
        this.lastStreamContent = '';
      }

      if (changedKeys.includes('streamContent') && state.isStreaming) {
        const newContent = state.streamContent.slice(this.lastStreamContent.length);
        if (newContent) {
          this.writeInline(newContent);
          this.lastStreamContent = state.streamContent;
        }
      }

      if (changedKeys.includes('isStreaming') && !state.isStreaming && this.lastStreamContent) {
        this.writeLine('');
        this.lastStreamContent = '';
      }
    });
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
   * Render a message based on its role
   */
  private renderMessage(msg: MessageState): void {
    switch (msg.role) {
      case 'user':
        this.writeLine(chalk.green('You: ') + msg.content);
        this.writeLine('');
        break;
      case 'assistant':
        this.writeLine(chalk.cyan('Assistant:'));
        this.writeLine(msg.content);
        this.writeLine('');
        break;
      case 'tool':
        // Tool messages are typically handled differently
        this.writeLine(chalk.blue('→ ') + msg.content);
        break;
      case 'system':
        this.writeLine(chalk.dim(msg.content));
        break;
      case 'parallel-status':
        // Render live parallel execution status
        if (msg.parallelExecutionId) {
          const state = uiState.getState();
          const lines = ParallelExecutionRenderer.render(
            state.parallelExecution,
            msg.parallelExecutionId
          );
          for (const line of lines) {
            this.writeLine(line);
          }
          this.writeLine('');
        }
        break;
      case 'subagent-status':
        // Render live subagent status
        if (msg.subagentId) {
          const state = uiState.getState();
          const lines = SubagentRenderer.render(
            state.subagents,
            msg.subagentId
          );
          for (const line of lines) {
            this.writeLine(line);
          }
          this.writeLine('');
        }
        break;
    }
  }

  // ============================================
  // Direct write methods (for manual control)
  // ============================================

  /**
   * Write a complete line to output
   */
  writeLine(content: string): void {
    if (!this.renderManager) return;
    this.renderManager.writeOutput(content);
  }

  /**
   * Write multiple lines
   */
  writeLines(lines: string[]): void {
    if (!this.renderManager) return;
    for (const line of lines) {
      this.renderManager.writeOutput(line);
    }
  }

  /**
   * Write inline (for streaming)
   */
  writeInline(content: string): void {
    if (!this.renderManager) return;
    this.renderManager.writeOutputInline(content);
  }

  /**
   * Clear all output
   */
  clear(): void {
    if (!this.renderManager) return;
    this.renderManager.clearOutput();
  }

  /**
   * Write a separator line
   */
  writeSeparator(char = '─'): void {
    if (!this.renderManager) return;
    const width = this.renderManager.getTerminalWidth();
    this.writeLine(chalk.dim(char.repeat(width)));
  }

  /**
   * Write a header
   */
  writeHeader(title: string): void {
    this.writeLine('');
    this.writeLine(chalk.bold.blue(title));
    this.writeSeparator();
  }

  /**
   * Write error message
   */
  writeError(message: string, hint?: string): void {
    this.writeLine(chalk.red('✗ Error: ') + message);
    if (hint) {
      this.writeLine(chalk.dim(hint));
    }
    this.writeLine('');
  }

  /**
   * Write success message
   */
  writeSuccess(message: string): void {
    this.writeLine(chalk.green('✓ ') + message);
    this.writeLine('');
  }

  /**
   * Write warning message
   */
  writeWarning(message: string): void {
    this.writeLine(chalk.yellow('⚠ ') + message);
    this.writeLine('');
  }

  /**
   * Write info message
   */
  writeInfo(message: string): void {
    this.writeLine(chalk.blue('ℹ ') + message);
    this.writeLine('');
  }

  /**
   * Write user message
   */
  writeUserMessage(message: string): void {
    this.writeLine(chalk.green('You: ') + message);
    this.writeLine('');
  }

  /**
   * Write assistant message
   */
  writeAssistantMessage(message: string): void {
    this.writeLine(chalk.cyan('Assistant:'));
    this.writeLine(message);
    this.writeLine('');
  }

  /**
   * Write tool execution
   */
  writeToolExecution(toolName: string, params?: string): void {
    const paramsStr = params ? ` ${chalk.dim(params)}` : '';
    this.writeLine(chalk.blue(`→ ${toolName}`) + paramsStr);
  }

  // ============================================
  // Streaming methods
  // ============================================

  private streamPrefix = '';
  private streamStarted = false;

  /**
   * Start a streaming response
   */
  startStream(prefix?: string): void {
    this.streamPrefix = prefix || chalk.cyan('Assistant:');
    this.streamStarted = true;
    this.writeLine(this.streamPrefix);
  }

  /**
   * Stream content
   */
  streamContent(content: string): void {
    if (!this.streamStarted) {
      this.startStream();
    }
    this.writeInline(content);
  }

  /**
   * End streaming
   */
  endStream(): void {
    if (this.streamStarted) {
      this.writeLine('');
      this.writeLine('');
      this.streamStarted = false;
    }
  }

  /**
   * Scroll control
   */
  scrollUp(lines = 1): void {
    this.renderManager?.scrollOutput(-lines);
  }

  scrollDown(lines = 1): void {
    this.renderManager?.scrollOutput(lines);
  }

  scrollToTop(): void {
    this.renderManager?.scrollToTop();
  }

  scrollToBottom(): void {
    this.renderManager?.scrollToBottom();
  }
}
