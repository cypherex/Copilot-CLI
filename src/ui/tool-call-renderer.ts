// Tool call and result rendering in structured, hierarchical format

import chalk from 'chalk';
import { simpleIndent } from './box-drawer.js';

export interface ToolCallDisplay {
  id: string;
  name: string;
  args: Record<string, any>;
  startTime?: number;
}

export interface ToolResultDisplay {
  id: string;
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
}

/**
 * Renderer for tool calls and results in Claude Code style
 */
export class ToolCallRenderer {
  private maxParamLength = 50; // Show much more than the current 50 chars
  private maxOutputLength = 100; // Show much more than the current 500 chars

  /**
   * Render a tool call in XML-style block format
   */
  renderToolCall(toolCall: ToolCallDisplay): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push(chalk.blue.bold('<function_calls>'));
    lines.push(chalk.blue('  <invoke name="' + toolCall.name + '">'));

    // Parameters - each on its own line with proper formatting
    for (const [key, value] of Object.entries(toolCall.args)) {
      const formattedValue = this.formatParameterValue(value);
      lines.push(chalk.blue('    <parameter name="' + key + '">'));

      // If value is multi-line, indent it properly
      if (formattedValue.includes('\n')) {
        const indented = simpleIndent(formattedValue, 6);
        lines.push(indented);
      } else {
        lines.push('      ' + formattedValue);
      }

      lines.push(chalk.blue('    </parameter>'));
    }

    lines.push(chalk.blue('  </invoke>'));
    lines.push(chalk.blue('</function_calls>'));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Render a tool result in XML-style block format
   */
  renderToolResult(toolResult: ToolResultDisplay): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(chalk.gray.bold('<function_results>'));

    if (toolResult.success) {
      const output = toolResult.output || 'Success';
      const truncatedOutput = output.length > this.maxOutputLength
        ? output.slice(0, this.maxOutputLength) + '\n... (truncated)'
        : output;

      lines.push(simpleIndent(truncatedOutput, 2));

      if (toolResult.duration !== undefined) {
        lines.push('');
        lines.push(chalk.dim('  Completed in ' + toolResult.duration + 'ms'));
      }
    } else {
      lines.push(chalk.red('  <error>'));
      lines.push(chalk.red('    <tool_use_error>'));
      lines.push(simpleIndent(toolResult.error || 'Unknown error', 6));
      lines.push(chalk.red('    </tool_use_error>'));
      lines.push(chalk.red('  </error>'));
    }

    lines.push(chalk.gray.bold('</function_results>'));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format a parameter value for display
   */
  private formatParameterValue(value: any): string {
    if (typeof value === 'string') {
      // Truncate if too long
      if (value.length > this.maxParamLength) {
        return value.slice(0, this.maxParamLength) + '\n... (truncated)';
      }
      return value;
    }

    if (Array.isArray(value)) {
      return JSON.stringify(value, null, 2);
    }

    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }
}
