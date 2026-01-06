/**
 * ParallelExecutionRenderer - renders parallel tool execution status as message content
 * Used by OutputRegion/AskRenderer to render live-updating parallel-status messages
 */

import chalk from 'chalk';
import type { ParallelExecutionState, ParallelToolState } from '../ui-state.js';

export class ParallelExecutionRenderer {
  static render(execution: ParallelExecutionState | null, executionId: string): string[] {
    if (!execution || execution.id !== executionId) {
      return [chalk.dim(`[Parallel execution ${executionId} completed]`)];
    }

    const lines: string[] = [];
    const now = Date.now();

    if (execution.isActive) {
      const counts = this.countTools(execution.tools);
      const headerLeft = execution.description
        ? `⎇ Parallel: ${execution.description}`
        : `⎇ Parallel: ${execution.tools.length} operations`;
      const headerRight = chalk.dim(
        `${counts.running} running · ${counts.success} ok · ${counts.error} err · ${this.formatMs(now - execution.startTime)}`
      );
      lines.push(chalk.cyan(headerLeft) + chalk.dim(' · ') + headerRight);

      for (const tool of execution.tools) {
        const icon = this.getStatusIcon(tool.status);
        const argsStr = this.formatArgs(tool.args);
        const timeStr =
          tool.executionTime !== undefined
            ? chalk.dim(` (${this.formatMs(tool.executionTime)})`)
            : tool.status === 'running'
              ? chalk.dim(` (${this.formatMs(now - tool.startTime)})`)
              : '';
        const errorStr = tool.error ? chalk.red(` - ${tool.error}`) : '';

        let line = `  ${icon} ${tool.tool}${argsStr}${timeStr}${errorStr}`;
        if (tool.status === 'success') line = chalk.green(line);
        else if (tool.status === 'error') line = chalk.red(line);
        else if (tool.status === 'running') line = chalk.yellow(line);
        else line = chalk.dim(line);

        lines.push(line);

        if ((tool.status === 'success' || tool.status === 'error') && tool.output) {
          const preview = this.previewText(tool.output, 140);
          if (preview) lines.push(chalk.dim(`     ↳ ${preview}`));
        }
      }

      return lines;
    }

    if (execution.endTime) {
      const totalTime = execution.endTime - execution.startTime;
      const successCount = execution.tools.filter(t => t.status === 'success').length;
      const errorCount = execution.tools.filter(t => t.status === 'error').length;

      const summary = `✓ Parallel completed: ${successCount} succeeded, ${errorCount} failed (${this.formatMs(totalTime)})`;
      lines.push(errorCount > 0 ? chalk.yellow(summary) : chalk.green(summary));

      if (errorCount > 0) {
        for (const tool of execution.tools) {
          if (tool.status !== 'error') continue;
          const argsStr = this.formatArgs(tool.args);
          lines.push(chalk.red(`  ✗ ${tool.tool}${argsStr}: ${tool.error}`));
        }
      }
    }

    return lines;
  }

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

  private static countTools(tools: ParallelToolState[]): { pending: number; running: number; success: number; error: number } {
    const counts = { pending: 0, running: 0, success: 0, error: 0 };
    for (const tool of tools) counts[tool.status] += 1;
    return counts;
  }

  private static formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s - m * 60);
    return `${m}m${String(rem).padStart(2, '0')}s`;
  }

  private static formatArgs(args?: Record<string, any>): string {
    if (!args || Object.keys(args).length === 0) return '';

    const keyOrder = ['path', 'command', 'pattern', 'file', 'directory', 'id', 'name'];
    const keys = [
      ...keyOrder.filter(k => k in args),
      ...Object.keys(args).filter(k => !keyOrder.includes(k)).sort(),
    ].slice(0, 2);

    const parts: string[] = [];
    for (const key of keys) {
      const value = (args as any)[key];
      const rendered =
        typeof value === 'string'
          ? JSON.stringify(value.length > 60 ? value.slice(0, 57) + '...' : value)
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : Array.isArray(value)
              ? `[${value.length}]`
              : value && typeof value === 'object'
                ? '{…}'
                : String(value);
      parts.push(`${key}=${rendered}`);
    }

    return parts.length > 0 ? chalk.dim(` (${parts.join(', ')})`) : '';
  }

  private static previewText(text: string, maxChars: number): string {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) return '';
    const firstLine = normalized.split('\n')[0];
    if (firstLine.length <= maxChars) return firstLine;
    return firstLine.slice(0, Math.max(0, maxChars - 1)) + '…';
  }
}

