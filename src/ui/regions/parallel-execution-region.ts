/**
 * ParallelExecutionRenderer - renders parallel tool execution status as message content
 * Used by OutputRegion to render live-updating parallel-status messages
 */

import chalk from 'chalk';
import type { ParallelExecutionState, ParallelToolState } from '../ui-state.js';

/**
 * Renders parallel execution state as formatted lines for display in conversation
 */
export class ParallelExecutionRenderer {
  /**
   * Render parallel execution status as an array of lines
   */
  static render(execution: ParallelExecutionState | null, executionId: string): string[] {
    if (!execution || execution.id !== executionId) {
      // Execution not found or completed - show static "not found" message
      return [chalk.dim(`[Parallel execution ${executionId} completed]`)];
    }

    const lines: string[] = [];

    if (execution.isActive) {
      // Active execution - show live status
      const header = execution.description
        ? `⎇ Parallel: ${execution.description}`
        : `⎇ Parallel: ${execution.tools.length} operations`;
      lines.push(chalk.cyan(header));

      // Tool status list
      for (const tool of execution.tools) {
        const icon = this.getStatusIcon(tool.status);
        const timeStr = tool.executionTime ? ` (${tool.executionTime}ms)` : '';
        const errorStr = tool.error ? ` - ${tool.error}` : '';

        let line = `  ${icon} ${tool.tool}${timeStr}${errorStr}`;

        // Color based on status
        if (tool.status === 'success') {
          line = chalk.green(line);
        } else if (tool.status === 'error') {
          line = chalk.red(line);
        } else if (tool.status === 'running') {
          line = chalk.yellow(line);
        } else {
          line = chalk.dim(line);
        }

        lines.push(line);
      }
    } else if (execution.endTime) {
      // Completed execution - show final summary
      const totalTime = execution.endTime - execution.startTime;
      const successCount = execution.tools.filter(t => t.status === 'success').length;
      const errorCount = execution.tools.filter(t => t.status === 'error').length;

      const summary = `✓ Parallel completed: ${successCount} succeeded, ${errorCount} failed (${totalTime}ms)`;
      lines.push(errorCount > 0 ? chalk.yellow(summary) : chalk.green(summary));

      // Show individual results for failed tools
      if (errorCount > 0) {
        for (const tool of execution.tools) {
          if (tool.status === 'error') {
            lines.push(chalk.red(`  ✗ ${tool.tool}: ${tool.error}`));
          }
        }
      }
    }

    return lines;
  }

  /**
   * Get status icon
   */
  private static getStatusIcon(status: ParallelToolState['status']): string {
    switch (status) {
      case 'pending':
        return '○';
      case 'running':
        return '▶';
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      default:
        return '○';
    }
  }
}
