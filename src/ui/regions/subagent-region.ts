/**
 * SubagentRenderer - renders subagent execution status as message content
 * Used by OutputRegion to render live-updating subagent-status messages
 */

import chalk from 'chalk';
import type { SubagentState, SubagentTrackingState } from '../ui-state.js';

/**
 * Renders subagent state as formatted lines for display in conversation
 */
export class SubagentRenderer {
  /**
   * Render subagent status as an array of lines
   */
  static render(tracking: SubagentTrackingState | null, subagentId: string): string[] {
    if (!tracking) {
      return [chalk.dim(`[Subagent ${subagentId} tracking unavailable]`)];
    }

    // Find the subagent in active or completed
    const agent = tracking.active.find(a => a.id === subagentId) ||
                  tracking.completed.find(a => a.id === subagentId);

    if (!agent) {
      return [chalk.dim(`[Subagent ${subagentId} not found]`)];
    }

    const lines: string[] = [];

    // Status header
    const icon = this.getStatusIcon(agent.status);
    const roleStr = agent.role ? ` [${agent.role}]` : '';
    const bgStr = agent.background ? ' (background)' : '';

    if (agent.status === 'spawning' || agent.status === 'running') {
      // Active subagent
      const iterStr = agent.iterations ? ` - ${agent.iterations} iterations` : '';
      const header = `${icon} Subagent${roleStr}${bgStr}: ${agent.task}${iterStr}`;
      lines.push(chalk.yellow(header));
    } else {
      // Completed subagent
      const duration = agent.endTime && agent.startTime
        ? ` (${agent.endTime - agent.startTime}ms)`
        : '';
      const iterStr = agent.iterations ? ` - ${agent.iterations} iterations` : '';

      if (agent.status === 'completed') {
        const header = `${icon} Subagent completed${roleStr}${duration}${iterStr}`;
        lines.push(chalk.green(header));

        // Show brief result if available
        if (agent.result) {
          const preview = agent.result.slice(0, 150);
          lines.push(chalk.dim(`  Result: ${preview}${agent.result.length > 150 ? '...' : ''}`));
        }
      } else {
        // Failed
        const header = `${icon} Subagent failed${roleStr}${duration}`;
        lines.push(chalk.red(header));

        if (agent.error) {
          lines.push(chalk.red(`  Error: ${agent.error}`));
        }
      }
    }

    return lines;
  }

  /**
   * Get status icon
   */
  private static getStatusIcon(status: SubagentState['status']): string {
    switch (status) {
      case 'spawning':
        return '○';
      case 'running':
        return '◐';
      case 'completed':
        return '✓';
      case 'failed':
        return '✗';
      default:
        return '○';
    }
  }
}
