// Subagent output renderer with hierarchical nesting

import chalk from 'chalk';
import { simpleIndent, separator, statusBadge, BOX_CHARS } from './box-drawer.js';
import { ToolCallRenderer } from './tool-call-renderer.js';

export interface SubagentStartEvent {
  agentId: string;
  role: string;
  task: string;
}

export interface SubagentMessageEvent {
  content: string;
  type: 'thinking' | 'output' | 'status';
}

export interface SubagentToolCallEvent {
  toolName: string;
  args: Record<string, any>;
  toolCallId: string;
}

export interface SubagentToolResultEvent {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface SubagentEndEvent {
  duration: number;
  summary?: string;
}

/**
 * Renderer for nested subagent output
 * Displays subagent activity with indentation and real-time updates
 */
export class SubagentRenderer {
  private indentLevel: number;
  private indentSize = 2; // Spaces per indent level
  private toolCallRenderer: ToolCallRenderer;
  private startTime?: number;

  constructor(indentLevel: number = 1) {
    this.indentLevel = indentLevel;
    this.toolCallRenderer = new ToolCallRenderer();
  }

  /**
   * Render the start of a subagent execution
   */
  renderStart(event: SubagentStartEvent): void {
    this.startTime = Date.now();

    const header = chalk.cyan.bold('Launching subagent: ') + chalk.white(event.role);
    console.log(this.indent(header));
    console.log();

    const agentBox = chalk.blue(BOX_CHARS.topLeft + BOX_CHARS.horizontal + ' ') +
      chalk.bold(`Agent: ${event.role}`) +
      chalk.dim(` (${event.agentId.slice(0, 8)}...)`) +
      chalk.blue(' ' + BOX_CHARS.horizontal.repeat(20));
    console.log(this.indent(agentBox));

    const taskLine = chalk.blue(BOX_CHARS.vertical) + ' ' + chalk.gray('Task: ') + chalk.white(event.task);
    console.log(this.indent(taskLine));

    console.log(this.indent(chalk.blue(BOX_CHARS.vertical)));
  }

  /**
   * Render a message from the subagent
   */
  renderMessage(event: SubagentMessageEvent): void {
    const prefix = chalk.blue(BOX_CHARS.vertical) + '  ';

    let formatted: string;
    switch (event.type) {
      case 'thinking':
        formatted = chalk.dim(event.content);
        break;
      case 'status':
        formatted = chalk.cyan(event.content);
        break;
      case 'output':
      default:
        formatted = event.content;
        break;
    }

    // Handle multi-line content
    const lines = formatted.split('\n');
    for (const line of lines) {
      console.log(this.indent(prefix + line));
    }
  }

  /**
   * Render a tool call from the subagent
   */
  renderToolCall(event: SubagentToolCallEvent): void {
    const prefix = chalk.blue(BOX_CHARS.vertical) + '  ';

    // Create tool call display
    const toolCallDisplay = {
      id: event.toolCallId,
      name: event.toolName,
      args: event.args,
      startTime: Date.now(),
    };

    // Render using ToolCallRenderer
    const rendered = this.toolCallRenderer.renderToolCall(toolCallDisplay);

    // Indent each line
    const lines = rendered.split('\n');
    for (const line of lines) {
      console.log(this.indent(prefix + line));
    }

    console.log(this.indent(chalk.blue(BOX_CHARS.vertical)));
  }

  /**
   * Render a tool result from the subagent
   */
  renderToolResult(event: SubagentToolResultEvent): void {
    const prefix = chalk.blue(BOX_CHARS.vertical) + '  ';

    // Create tool result display
    const toolResultDisplay = {
      id: event.toolCallId,
      name: event.toolName,
      success: event.success,
      output: event.output,
      error: event.error,
    };

    // Render using ToolCallRenderer
    const rendered = this.toolCallRenderer.renderToolResult(toolResultDisplay);

    // Indent each line
    const lines = rendered.split('\n');
    for (const line of lines) {
      console.log(this.indent(prefix + line));
    }

    console.log(this.indent(chalk.blue(BOX_CHARS.vertical)));
  }

  /**
   * Render the end of a subagent execution
   */
  renderEnd(event: SubagentEndEvent): void {
    const prefix = chalk.blue(BOX_CHARS.vertical) + '  ';

    console.log(this.indent(chalk.blue(BOX_CHARS.vertical)));

    const durationStr = (event.duration / 1000).toFixed(2) + 's';
    const completionLine = chalk.green('✓ Agent completed') + ' ' + chalk.dim(`in ${durationStr}`);
    console.log(this.indent(prefix + completionLine));

    if (event.summary) {
      const summaryLine = chalk.gray('Summary: ') + event.summary;
      console.log(this.indent(prefix + summaryLine));
    }

    const bottomBorder = chalk.blue(BOX_CHARS.bottomLeft + BOX_CHARS.horizontal.repeat(50));
    console.log(this.indent(bottomBorder));
    console.log();
  }

  /**
   * Render an error during subagent execution
   */
  renderError(error: string): void {
    const prefix = chalk.blue(BOX_CHARS.vertical) + '  ';
    console.log(this.indent(prefix + chalk.red('✗ Error: ') + error));
    console.log(this.indent(chalk.blue(BOX_CHARS.bottomLeft + BOX_CHARS.horizontal.repeat(50))));
    console.log();
  }

  /**
   * Apply indentation to a line
   */
  private indent(line: string): string {
    return ' '.repeat(this.indentLevel * this.indentSize) + line;
  }

  /**
   * Increase indent level (for nested subagents)
   */
  increaseIndent(): void {
    this.indentLevel++;
  }

  /**
   * Decrease indent level
   */
  decreaseIndent(): void {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
  }
}

/**
 * Global subagent renderer registry
 * Tracks active subagent renderers for nested execution
 */
class SubagentRendererRegistry {
  private renderers = new Map<string, SubagentRenderer>();
  private indentStack: number[] = [1]; // Start with indent level 1

  /**
   * Create a renderer for a new subagent
   */
  create(agentId: string): SubagentRenderer {
    const currentIndent = this.indentStack[this.indentStack.length - 1];
    const renderer = new SubagentRenderer(currentIndent);
    this.renderers.set(agentId, renderer);
    this.indentStack.push(currentIndent + 1);
    return renderer;
  }

  /**
   * Get renderer for an agent
   */
  get(agentId: string): SubagentRenderer | undefined {
    return this.renderers.get(agentId);
  }

  /**
   * Remove renderer when agent completes
   */
  remove(agentId: string): void {
    this.renderers.delete(agentId);
    if (this.indentStack.length > 1) {
      this.indentStack.pop();
    }
  }

  /**
   * Clear all renderers
   */
  clear(): void {
    this.renderers.clear();
    this.indentStack = [1];
  }
}

// Export singleton instance
export const subagentRendererRegistry = new SubagentRendererRegistry();
