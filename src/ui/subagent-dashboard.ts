// ParallelAgentDashboard - Compact display for running subagents
// Shows up to 3 lines per subagent with compressed command history

import chalk from 'chalk';
import type { SubAgentManager } from '../agent/subagent.js';

export interface AgentProgress {
  agentId: string;
  name: string;
  iteration: number;
  maxIterations: number;
  status: 'running' | 'queued' | 'completed' | 'failed';
  currentTool?: string;
  stage?: string; // Current stage within the iteration
  stageLastUpdated?: number; // Timestamp when stage last updated
  recentTools: string[]; // Compressed command history (max 3)
}

export interface DashboardStats {
  running: number;
  queued: number;
  completed: number;
  failed: number;
}

export class SubAgentDashboard {
  private agents: Map<string, AgentProgress> = new Map();
  private lastRender: string = '';
  private visible: boolean = false;
  private renderHeight: number = 0;

  constructor(private manager: SubAgentManager) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to subagent manager events
    this.manager.on('agent_queued', (data: any) => {
      this.handleAgentQueued(data);
    });

    this.manager.on('agent_started', (data: any) => {
      this.handleAgentStarted(data);
    });

    this.manager.on('progress', (data: any) => {
      this.handleProgressUpdate(data);
    });

    this.manager.on('tool_call', (data: any) => {
      this.handleToolCall(data);
    });

    this.manager.on('agent_completed', (data: any) => {
      this.handleAgentCompleted(data);
    });

    this.manager.on('agent_failed', (data: any) => {
      this.handleAgentFailed(data);
    });
  }

  private handleAgentQueued(data: any): void {
    const agentId = data.agentId || data.name || `agent_${Date.now()}`;
    this.agents.set(agentId, {
      agentId,
      name: data.name || agentId,
      iteration: 0,
      maxIterations: data.maxIterations || 1000,
      status: 'queued',
      recentTools: [],
    });
    this.render();
  }

  private handleAgentStarted(data: any): void {
    const agentId = data.agentId || data.name;
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'running';
      this.render();
    }
  }

  private handleProgressUpdate(data: any): void {
    const agentId = data.agentId;
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.iteration = data.iteration;
      agent.maxIterations = data.maxIterations;
      if (data.currentTool) {
        agent.currentTool = data.currentTool;
      }
      agent.status = data.status || 'running';
      this.render();
    }
  }

  private handleToolCall(data: any): void {
    const agentId = data.agentId;
    const agent = this.agents.get(agentId);
    if (agent && data.toolName) {
      // Add tool to recent tools (keep max 3)
      agent.recentTools = [data.toolName, ...agent.recentTools].slice(0, 3);
      agent.currentTool = data.toolName;
      this.render();
    }
  }

  private handleAgentCompleted(data: any): void {
    const agentId = data.agentId || data.name;
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'completed';
      // Remove completed agent after short delay for visibility
      setTimeout(() => {
        this.agents.delete(agentId);
        this.render();
      }, 1000);
    }
  }

  private handleAgentFailed(data: any): void {
    const agentId = data.agentId || data.name;
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'failed';
      setTimeout(() => {
        this.agents.delete(agentId);
        this.render();
      }, 2000); // Keep failed agents visible longer
    }
  }

  /**
   * Get current statistics
   */
  getStats(): DashboardStats {
    const stats: DashboardStats = {
      running: 0,
      queued: 0,
      completed: 0,
      failed: 0,
    };

    for (const agent of this.agents.values()) {
      stats[agent.status]++;
    }

    return stats;
  }

  /**
   * Get compact representation for status bar
   */
  getCompactStats(): string {
    const stats = this.getStats();
    const parts: string[] = [];

    if (stats.running > 0) {
      parts.push(chalk.yellow(`●${stats.running}`));
    }
    if (stats.queued > 0) {
      parts.push(chalk.gray(`○${stats.queued}`));
    }

    if (parts.length === 0) {
      return '';
    }

    return chalk.gray('agents:') + ' ' + parts.join(' ');
  }

  /**
   * Render the dashboard
   */
  render(): void {
    if (!this.visible) {
      return;
    }

    const lines: string[] = [];
    const width = process.stdout.columns || 80;
    const stats = this.getStats();

    // Only show if there are running or queued agents
    if (stats.running === 0 && stats.queued === 0) {
      if (this.lastRender) {
        this.clear();
      }
      this.lastRender = '';
      this.renderHeight = 0;
      return;
    }

    // Header
    const headerStats = stats.queued > 0
      ? `${stats.running} running, ${stats.queued} queued`
      : `${stats.running} running`;
    const header = chalk.cyan.bold('┌─ Parallel Agents (' + headerStats + ') ') +
                   chalk.cyan('─'.repeat(Math.max(0, width - headerStats.length - 22)));
    lines.push(header);

    // Agent lines (up to 3 lines per agent, total max ~10 lines to avoid screen clutter)
    let lineCount = 0;
    const maxLines = 10;

    // Running agents first
    const runningAgents = Array.from(this.agents.values())
      .filter(a => a.status === 'running')
      .slice(0, 3); // Show max 3 running agents

    for (const agent of runningAgents) {
      const agentLines = this.formatAgentLines(agent, width);
      for (const line of agentLines) {
        if (lineCount >= maxLines - 1) break; // Reserve space for footer
        lines.push(line);
        lineCount++;
      }
    }

    // Queued agents (compact)
    const queuedAgents = Array.from(this.agents.values())
      .filter(a => a.status === 'queued')
      .slice(0, 2);

    if (queuedAgents.length > 0 && lineCount < maxLines - 1) {
      const queuedList = queuedAgents.map(a => a.name.slice(0, 20)).join(', ');
      const queuedLine = chalk.gray('│ ○ ') + chalk.dim(queuedList + (queuedAgents.length < this.getStats().queued ? '...' : ''));
      lines.push(this.padLine(queuedLine, width));
      lineCount++;
    }

    // Footer
    const footer = chalk.cyan('└' + '─'.repeat(width - 2) + '┘');
    lines.push(footer);

    // Render in-place
    const rendered = lines.join('\n');
    if (this.lastRender) {
      // Clear previous render
      this.clear();
      process.stdout.write(rendered + '\n');
    } else {
      process.stdout.write(rendered + '\n');
    }

    this.lastRender = rendered;
    this.renderHeight = lines.length;
  }

  /**
   * Format agent lines (up to 3 lines per agent)
   */
  private formatAgentLines(agent: AgentProgress, width: number): string[] {
    const lines: string[] = [];

    // Line 1: Agent name and iteration progress
    const icon = chalk.yellow('●');
    const shortName = agent.name.length > 20 ? agent.name.slice(0, 17) + '...' : agent.name;
    const progress = chalk.cyan(`${agent.iteration}/${agent.maxIterations}`);

    // Add stage if available
    let stageInfo = '';
    if (agent.stage) {
      const timeSinceUpdate = agent.stageLastUpdated
        ? Math.floor((Date.now() - agent.stageLastUpdated) / 1000)
        : 0;

      const timeString = timeSinceUpdate < 60
        ? `${timeSinceUpdate}s ago`
        : timeSinceUpdate < 3600
          ? `${Math.floor(timeSinceUpdate / 60)}m ago`
          : `${Math.floor(timeSinceUpdate / 3600)}h ago`;

      stageInfo = ` ${chalk.magenta('[' + agent.stage + ']')} ${chalk.dim(timeString)}`;
    }

    const line1 = `│ ${icon} ${shortName}: ${progress}${stageInfo}`;
    lines.push(this.padLine(line1, width));

    // Line 2: Compressed tool history if available
    if (agent.recentTools.length > 0) {
      const toolHistory = agent.recentTools.join('→');
      const line2 = `│    ${chalk.dim(toolHistory)}`;
      lines.push(this.padLine(line2, width));

      // Line 3: Current tool status (if not already shown in stage)
      if (agent.currentTool && !agent.stage?.includes(agent.currentTool)) {
        const line3 = `│    ${chalk.blue('→')} ${chalk.cyan(agent.currentTool)}`;
        lines.push(this.padLine(line3, width));
      }
    }

    return lines.slice(0, 3); // Max 3 lines per agent
  }

  /**
   * Pad a line to the specified width
   */
  private padLine(line: string, width: number): string {
    // Remove ANSI codes for length calculation
    const plainText = line.replace(/\x1b\[[0-9;]*m/g, '');
    const currentWidth = plainText.length;

    if (currentWidth < width - 1) {
      const padding = ' '.repeat(width - currentWidth - 1);
      return line + padding + chalk.cyan('│');
    }

    // Truncate if too long (accounting for box border)
    if (currentWidth > width - 2) {
      const truncated = plainText.slice(0, width - 5) + '...';
      return line.slice(0, line.length - currentWidth + width - 5) + '...' + chalk.cyan('│');
    }

    return line + chalk.cyan('│');
  }

  /**
   * Clear the dashboard from the screen
   */
  private clear(): void {
    if (this.renderHeight > 0) {
      // Move cursor up and clear lines
      for (let i = 0; i < this.renderHeight; i++) {
        process.stdout.write('\x1b[1A'); // Move up one line
        process.stdout.write('\x1b[2K'); // Clear line
      }
    }
  }

  /**
   * Show the dashboard
   */
  show(): void {
    if (!this.visible) {
      this.visible = true;
      this.render();
    }
  }

  /**
   * Hide the dashboard
   */
  hide(): void {
    if (this.visible) {
      this.visible = false;
      this.clear();
      this.lastRender = '';
      this.renderHeight = 0;
    }
  }

  /**
   * Check if dashboard is visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Force a re-render
   */
  update(): void {
    this.render();
  }
}
