/**
 * AskRenderer - Simple text-only renderer for headless ask command
 *
 * Subscribes to UIState and renders output as plain text for scriptable/headless usage.
 * Works in both normal and JSON capture modes.
 */

import chalk from 'chalk';
import type { WriteStream } from 'fs';
import { uiState, type MessageState } from './ui-state.js';
import { ParallelExecutionRenderer } from './regions/parallel-execution-renderer.js';
import { SubagentStatusRenderer } from './regions/subagent-status-renderer.js';
import type { LogManager } from './log-manager.js';
import type { SubAgentManager } from '../agent/subagent.js';

export interface AskRendererOptions {
  captureMode?: boolean;      // If true, don't use colors and capture output
  verbose?: boolean;          // Show all details
  outputFile?: WriteStream;   // Optional file stream to write output to (in addition to stdout) - DEPRECATED, use logManager
  logManager?: LogManager;    // Optional log manager for structured logging with subagent separation
  subAgentManager?: SubAgentManager; // Optional subagent manager to listen for detailed events
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

  // Subagent event listeners for cleanup
  private subagentMessageListener?: (data: any) => void;
  private subagentToolCallListener?: (data: any) => void;
  private subagentToolResultListener?: (data: any) => void;

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
    // Subscribe to subagent events for detailed logging if LogManager is available
    if (this.options.logManager && this.options.subAgentManager) {
      this.setupSubagentListeners();
    }

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

    // Clean up subagent listeners
    if (this.options.subAgentManager) {
      if (this.subagentMessageListener) {
        this.options.subAgentManager.off('message', this.subagentMessageListener);
      }
      if (this.subagentToolCallListener) {
        this.options.subAgentManager.off('tool_call', this.subagentToolCallListener);
      }
      if (this.subagentToolResultListener) {
        this.options.subAgentManager.off('tool_result', this.subagentToolResultListener);
      }
    }
  }

  /**
   * Setup listeners for detailed subagent events (for log file capture)
   */
  private setupSubagentListeners(): void {
    if (!this.options.subAgentManager || !this.options.logManager) return;

    // Listen for subagent messages (thinking, responses, system messages)
    this.subagentMessageListener = (data: any) => {
      if (data.agentId && data.content) {
        const state = uiState.getState();
        const subagent = state.subagents?.active.find(s => s.id === data.agentId) ||
                        state.subagents?.completed.find(s => s.id === data.agentId);

        let logContent = '';

        // Format based on message type
        if (data.type === 'thinking') {
          // Thinking/reasoning content (before tool calls)
          logContent = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          logContent += `Iteration ${data.iteration || '?'} - Assistant Thinking:\n`;
          logContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          logContent += `${data.content}\n\n`;
        } else if (data.type === 'final_response') {
          // Final response (no more tool calls)
          logContent = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          logContent += `Iteration ${data.iteration || '?'} - Final Response:\n`;
          logContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          logContent += `${data.content}\n\n`;
        } else if (data.type === 'system') {
          // System messages (audit results, etc.)
          logContent = `\n[System] ${data.content}\n`;
        } else {
          // Other message types
          logContent = `\n[${data.type || 'message'}] ${data.content}\n`;
        }

        this.options.logManager!.writeToSubagent(data.agentId, logContent, subagent?.role).catch(() => {});
      }
    };

    // Listen for tool calls
    this.subagentToolCallListener = (data: any) => {
      if (data.agentId && data.toolName) {
        const state = uiState.getState();
        const subagent = state.subagents?.active.find(s => s.id === data.agentId) ||
                        state.subagents?.completed.find(s => s.id === data.agentId);

        const argsStr = data.args ? JSON.stringify(data.args, null, 2) : '{}';
        let logContent = `\n⚙️  Executing: ${data.toolName}\n`;
        logContent += `Arguments:\n${this.indentLines(argsStr, 2)}\n\n`;

        this.options.logManager!.writeToSubagent(data.agentId, logContent, subagent?.role).catch(() => {});
      }
    };

    // Listen for tool results
    this.subagentToolResultListener = (data: any) => {
      if (data.agentId && data.toolName) {
        const state = uiState.getState();
        const subagent = state.subagents?.active.find(s => s.id === data.agentId) ||
                        state.subagents?.completed.find(s => s.id === data.agentId);

        const statusSymbol = data.success ? '✓' : '✗';
        let logContent = `${statusSymbol} Tool Result: ${data.toolName} ${data.success ? 'succeeded' : 'failed'}\n`;

        if (data.output && data.output.trim()) {
          logContent += `Output:\n${this.indentLines(data.output, 2)}\n`;
        }
        if (data.error) {
          logContent += `Error:\n${this.indentLines(data.error, 2)}\n`;
        }
        logContent += '\n';

        this.options.logManager!.writeToSubagent(data.agentId, logContent, subagent?.role).catch(() => {});
      }
    };

    // Attach listeners
    this.options.subAgentManager.on('message', this.subagentMessageListener);
    this.options.subAgentManager.on('tool_call', this.subagentToolCallListener);
    this.options.subAgentManager.on('tool_result', this.subagentToolResultListener);
  }

  /**
   * Indent all lines in a string
   */
  private indentLines(text: string, spaces: number): string {
    const indent = ' '.repeat(spaces);
    return text.split('\n').map(line => indent + line).join('\n');
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

    // Special handling for parallel messages
    if (msg.role === 'parallel-status' && msg.parallelExecutionId) {
      this.renderParallelMessage(msg.parallelExecutionId);
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
        if (msg.content) {
          lines.push(...msg.content.split('\n').map(line => this.stripAnsiIfNeeded(line)));
          break;
        }
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
        if (msg.content) {
          lines.push(...msg.content.split('\n').map(line => this.stripAnsiIfNeeded(line)));
          break;
        }
        if (msg.subagentId) {
          const state = uiState.getState();
          const rendered = SubagentStatusRenderer.render(state.subagents, msg.subagentId);
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
        // Make audit messages more verbose in ask mode for detailed logging
        if (this.options.logManager &&
            (msg.content.includes('Tracking:') ||
             msg.content.includes('Resolved:') ||
             msg.content.includes('Scaffolding audit'))) {
          // Audit message - add prominent header and formatting
          this.writeLine('');
          this.writeLine('═══════════════════════════════════════════════════════════');
          this.writeLine('📋 SCAFFOLDING AUDIT RESULTS');
          this.writeLine('═══════════════════════════════════════════════════════════');
          this.writeLine(this.stripAnsiIfNeeded(msg.content));
          this.writeLine('═══════════════════════════════════════════════════════════');
          this.writeLine('');
        } else {
          this.writeLine(this.stripAnsiIfNeeded(msg.content));
        }
        break;
      case 'parallel-status':
        // Live parallel execution status
        if (msg.parallelExecutionId) {
          this.renderParallelMessage(msg.parallelExecutionId);
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
   * Render parallel execution - show detailed info for log files
   */
  private renderParallelMessage(executionId: string): void {
    const state = uiState.getState();
    const execution = state.parallelExecution;

    if (!execution || execution.id !== executionId) {
      return;
    }

    // If using LogManager (file output), show detailed info
    if (this.options.logManager) {
      if (execution.isActive) {
        // Show header
        const header = execution.description
          ? `🔄 Parallel: ${execution.description}`
          : `🔄 Parallel: ${execution.tools.length} operations`;
        this.writeLine(header);

        // Show each tool with args and status
        for (const tool of execution.tools) {
          const icon = this.getParallelStatusIcon(tool.status);
          const timeStr = tool.executionTime ? ` (${tool.executionTime}ms)` : '';

          this.writeLine(`  ${icon} ${tool.tool}${timeStr}`);

          if (tool.args) {
            const argsStr = JSON.stringify(tool.args, null, 2);
            this.writeLine(`    Args: ${argsStr}`);
          }

          if (tool.output && tool.status === 'success') {
            const preview = tool.output.substring(0, 200);
            this.writeLine(`    Output: ${preview}${tool.output.length > 200 ? '...' : ''}`);
          }

          if (tool.error) {
            this.writeLine(`    Error: ${tool.error}`);
          }
        }
        this.writeLine('');
      } else if (execution.endTime) {
        // Completed - show final summary with full results
        const totalTime = execution.endTime - execution.startTime;
        const successCount = execution.tools.filter(t => t.status === 'success').length;
        const errorCount = execution.tools.filter(t => t.status === 'error').length;

        this.writeLine(`✓ Parallel completed: ${successCount} succeeded, ${errorCount} failed (${totalTime}ms)`);

        // Show all tool results
        for (const tool of execution.tools) {
          const icon = tool.status === 'success' ? '✓' : '✗';
          const timeStr = tool.executionTime ? ` (${tool.executionTime}ms)` : '';
          this.writeLine(`  ${icon} ${tool.tool}${timeStr}`);

          if (tool.args) {
            const argsStr = JSON.stringify(tool.args, null, 2);
            this.writeLine(`    Args: ${argsStr}`);
          }

          if (tool.output) {
            this.writeLine(`    Output:`);
            this.writeLine(this.indentLines(tool.output, 6));
          }

          if (tool.error) {
            this.writeLine(`    Error: ${tool.error}`);
          }
        }
        this.writeLine('');
      }
    } else {
      // No log manager - use standard renderer (terminal display)
      const lines = ParallelExecutionRenderer.render(execution, executionId);
      for (const line of lines) {
        this.writeLine(this.stripAnsiIfNeeded(line));
      }
      this.writeLine('');
    }
  }

  /**
   * Get status icon for parallel tools
   */
  private getParallelStatusIcon(status: string): string {
    switch (status) {
      case 'pending': return '○';
      case 'running': return '◐';
      case 'success': return '✓';
      case 'error': return '✗';
      default: return '○';
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
      const lines = SubagentStatusRenderer.render(state.subagents, subagentId);
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
      const lines = SubagentStatusRenderer.render(state.subagents, subagentId);
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
