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
interface LiveMessagePosition {
  startLine: number;  // Start position in output buffer
  lineCount: number;  // Number of lines occupied
}

export class OutputRegion {
  private renderManager: RenderManager | null = null;
  private unsubscribe?: () => void;
  private lastStreamContent = '';
  private liveMessagePositions: Map<string, LiveMessagePosition> = new Map(); // Track spatial position for each live message

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

      // Handle live message updates
      if (changedKeys.includes('liveMessages')) {
        // Clean up finalized messages (removed from live)
        const currentLiveIds = new Set(state.liveMessages.keys());
        for (const trackedId of this.liveMessagePositions.keys()) {
          if (!currentLiveIds.has(trackedId)) {
            // Message was finalized - remove from tracking
            this.liveMessagePositions.delete(trackedId);
          }
        }

        // Update all active live messages
        for (const [id, msg] of state.liveMessages) {
          this.updateLiveMessage(id, msg);
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
   * Update a live message - replaces content in buffer at tracked position
   */
  private updateLiveMessage(id: string, msg: MessageState): void {
    if (!this.renderManager) return;

    // Render the message to lines
    const lines = this.renderMessageToLines(msg);

    const existingPosition = this.liveMessagePositions.get(id);

    if (existingPosition) {
      // Replace existing lines in buffer
      this.renderManager.replaceOutputLines(
        existingPosition.startLine,
        existingPosition.lineCount,
        lines
      );

      // Update position with new line count (start stays the same)
      this.liveMessagePositions.set(id, {
        startLine: existingPosition.startLine,
        lineCount: lines.length,
      });
    } else {
      // First time rendering - append to buffer and track position
      const startLine = this.renderManager.getOutputBufferLength();

      for (const line of lines) {
        this.writeLine(line);
      }

      // Track the position
      this.liveMessagePositions.set(id, {
        startLine,
        lineCount: lines.length,
      });
    }
  }

  /**
   * Render a message to lines (without writing)
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
          lines.push(...rendered);
        }
        break;
      case 'subagent-status':
        if (msg.subagentId) {
          const state = uiState.getState();
          const rendered = SubagentRenderer.render(state.subagents, msg.subagentId);
          lines.push(...rendered);
        }
        break;
      default:
        // For other message types, just return the content as single line
        if (msg.content) {
          lines.push(msg.content);
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
        // Critical system messages (scaffolding audit, incomplete work) should be visible
        if (msg.content.includes('Tracking:') ||
            msg.content.includes('Resolved:') ||
            msg.content.includes('incomplete work') ||
            msg.content.includes('Scaffolding audit')) {
          this.writeLine(chalk.yellow(msg.content));
        } else {
          this.writeLine(chalk.dim(msg.content));
        }
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
