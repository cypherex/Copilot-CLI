/**
 * SubagentStatusRenderer - renders subagent execution status as message content
 * Used by OutputRegion/AskRenderer to render live-updating subagent-status messages
 */

import chalk from 'chalk';
import type { SubagentState, SubagentTrackingState } from '../ui-state.js';

export class SubagentStatusRenderer {
  static render(tracking: SubagentTrackingState | null, subagentId: string): string[] {
    if (!tracking) return [chalk.dim(`[Subagent ${subagentId} tracking unavailable]`)];

    const agent =
      tracking.active.find(a => a.id === subagentId) ||
      tracking.completed.find(a => a.id === subagentId);

    if (!agent) return [chalk.dim(`[Subagent ${subagentId} not found]`)];

    const lines: string[] = [];
    const shortId = subagentId.slice(0, 8);
    const roleStr = agent.role ? chalk.dim(` · ${agent.role}`) : '';
    const bgStr = agent.background ? chalk.dim(' · bg') : '';

    if (agent.status === 'spawning' || agent.status === 'running') {
      const header = `${this.getStatusIcon(agent.status)} Subagent ${shortId}${roleStr}${bgStr}`;
      lines.push(chalk.yellow(header));
      lines.push(chalk.dim(`  Task: ${agent.task}`));
      if (agent.iterations) lines.push(chalk.dim(`  Iter: ${agent.iterations}`));
      return lines;
    }

    const duration = agent.endTime && agent.startTime ? this.formatMs(agent.endTime - agent.startTime) : '';
    if (agent.status === 'completed') {
      const header = `${this.getStatusIcon(agent.status)} Subagent ${shortId}${roleStr}${bgStr}${duration ? chalk.dim(` · ${duration}`) : ''}`;
      lines.push(chalk.green(header));
      if (agent.result) {
        const preview = this.previewText(agent.result, 160);
        if (preview) lines.push(chalk.dim(`  Result: ${preview}`));
      }
      return lines;
    }

    const header = `${this.getStatusIcon(agent.status)} Subagent ${shortId}${roleStr}${bgStr}${duration ? chalk.dim(` · ${duration}`) : ''}`;
    lines.push(chalk.red(header));
    if (agent.error) lines.push(chalk.red(`  Error: ${agent.error}`));
    return lines;
  }

  private static getStatusIcon(status: SubagentState['status']): string {
    switch (status) {
      case 'spawning':
        return '○';
      case 'running':
        return '▶';
      case 'completed':
        return '✓';
      case 'failed':
        return '✗';
      default:
        return '○';
    }
  }

  private static formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s - m * 60);
    return `${m}m${String(rem).padStart(2, '0')}s`;
  }

  private static previewText(text: string, maxChars: number): string {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) return '';
    const firstLine = normalized.split('\n')[0];
    if (firstLine.length <= maxChars) return firstLine;
    return firstLine.slice(0, Math.max(0, maxChars - 1)) + '…';
  }
}

