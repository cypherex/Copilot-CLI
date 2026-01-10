// Shared UI logic for subagents
import chalk from 'chalk';
import { uiState } from '../ui/ui-state.js';
import { getRenderManager } from '../ui/render-manager.js';
import { SubagentRenderer, subagentRendererRegistry } from '../ui/subagent-renderer.js';
import type { SubAgentManager } from '../agent/subagent.js';

// Internal buffer for interactive UI updates
interface SubagentUiBuffer {
  agentId: string;
  role?: string;
  task: string;
  background: boolean;
  startedAt: number;
  lastProgress?: {
    iteration?: number;
    maxIterations?: number;
    currentTool?: string;
    stage?: string;
    stageLastUpdated?: number;
  };
  recentLines: string[];
  toolStarts: Map<string, number>;
  lastFlushAt: number;
}

const subagentUiBuffers = new Map<string, SubagentUiBuffer>();

// Exported for cleanup if needed, though usually handled internally
export const backgroundAgentCleanupFunctions = new Map<string, () => void>();

function isInteractiveRenderManagerActive(): boolean {
  return Boolean(process.stdout.isTTY && getRenderManager());
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${String(rem).padStart(2, '0')}s`;
}

function formatArgsInline(args?: Record<string, any>): string {
  if (!args || Object.keys(args).length === 0) return '';

  const keyOrder = ['path', 'command', 'pattern', 'directory', 'name', 'id'];
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

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function previewText(text: string, maxChars: number): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return '';
  const firstLine = normalized.split('\n')[0];
  if (firstLine.length <= maxChars) return firstLine;
  return firstLine.slice(0, Math.max(0, maxChars - 1)) + '…';
}

function pushRecentLine(agentId: string, line: string): void {
  const buffer = subagentUiBuffers.get(agentId);
  if (!buffer) return;
  buffer.recentLines.push(line);
  if (buffer.recentLines.length > 10) {
    buffer.recentLines.splice(0, buffer.recentLines.length - 10);
  }
}

function updateSubagentLiveMessage(agentId: string, force = false): void {
  const buffer = subagentUiBuffers.get(agentId);
  if (!buffer) return;

  const now = Date.now();
  if (!force && now - buffer.lastFlushAt < 80) return;
  buffer.lastFlushAt = now;

  const shortId = buffer.agentId.slice(0, 8);
  const roleStr = buffer.role ? chalk.dim(` · ${buffer.role}`) : '';
  const bgStr = buffer.background ? chalk.dim(' · bg') : '';
  const elapsedStr = chalk.dim(` · ${formatDuration(now - buffer.startedAt)}`);

  const header = chalk.yellow(`⧉ Subagent ${shortId}`) + roleStr + bgStr + elapsedStr;
  const taskLine = chalk.dim(`  Task: ${buffer.task}`);

  const progressParts: string[] = [];
  if (buffer.lastProgress?.iteration !== undefined) {
    const max = buffer.lastProgress.maxIterations
      ? `/${Number.isFinite(buffer.lastProgress.maxIterations) ? buffer.lastProgress.maxIterations : '∞'}`
      : '';
    progressParts.push(`iter ${buffer.lastProgress.iteration}${max}`);
  }
  if (buffer.lastProgress?.currentTool) {
    progressParts.push(`tool ${buffer.lastProgress.currentTool}`);
  } else if (buffer.lastProgress?.stage) {
    progressParts.push(buffer.lastProgress.stage);
  }
  const progressLine = progressParts.length > 0 ? chalk.dim(`  ${progressParts.join(' · ')}`) : '';

  const bodyLines = buffer.recentLines.map(l => `  ${l}`);

  const lines = [header, taskLine];
  if (progressLine) lines.push(progressLine);
  if (bodyLines.length > 0) {
    lines.push(chalk.dim('  Recent:'));
    lines.push(...bodyLines);
  }

  uiState.updateLiveMessage(agentId, {
    content: lines.join('\n'),
    timestamp: Date.now(),
  });
}

export function markSubagentCompletedInUi(agentId: string, result: { success: boolean; output?: string; error?: string; iterations?: number; toolsUsed?: string[] }): void {
  try {
    const current = uiState.getState().subagents || { active: [], completed: [], showCompleted: false };

    const existingActive = current.active.find(a => a.id === agentId);
    const existingCompleted = current.completed.find(a => a.id === agentId);

    if (existingActive && !existingCompleted) {
      uiState.update({
        subagents: {
          ...current,
          active: current.active.filter(a => a.id !== agentId),
          completed: [
            ...current.completed,
            {
              ...existingActive,
              status: result.success ? 'completed' : 'failed',
              endTime: Date.now(),
              iterations: result.iterations,
              error: result.error,
              result: result.output,
            },
          ],
        },
      });
    }

    const buffer = subagentUiBuffers.get(agentId);
    if (buffer) {
      const summary = result.success ? chalk.green('✓ completed') : chalk.red('✗ failed');
      const iter = result.iterations !== undefined ? chalk.dim(` · ${result.iterations} iter`) : '';
      const tools = result.toolsUsed && result.toolsUsed.length > 0 ? chalk.dim(` · tools: ${result.toolsUsed.slice(0, 4).join(', ')}${result.toolsUsed.length > 4 ? ', …' : ''}`) : '';
      pushRecentLine(agentId, `${summary}${iter}${tools}`);
      if (!result.success && result.error) pushRecentLine(agentId, chalk.red(`error: ${result.error}`));
      if (result.success && result.output) {
        const preview = previewText(result.output, 120);
        if (preview) pushRecentLine(agentId, chalk.dim(`result: ${preview}`));
      }
      updateSubagentLiveMessage(agentId, true);
    }

    uiState.finalizeLiveMessage(agentId);
  } catch (err: any) {
    console.error(`[UI Error] markSubagentCompletedInUi crash: ${err.message}`);
  }
}

/**
 * Attaches UI listeners to a subagent to visualize its progress
 */
export function attachSubagentUI(
  subAgentManager: SubAgentManager,
  agentId: string,
  task: string,
  role?: string,
  background: boolean = false,
  options: { prefix?: string; verbose?: boolean } = {}
): () => void {
  const prefix = options.prefix ? `[${options.prefix}] ` : '';
  const verbose = options.verbose ?? false;

  // Add subagent to UIState tracking
  const currentSubagents = uiState.getState().subagents || { active: [], completed: [], showCompleted: false };
  uiState.update({
    subagents: {
      ...currentSubagents,
      active: [
        ...currentSubagents.active,
        {
          id: agentId,
          task,
          role,
          status: 'spawning',
          background,
          startTime: Date.now(),
        },
      ],
    },
  });

  // Add live-updating message
  uiState.addLiveMessage(agentId, {
    role: 'subagent-status',
    content: '', // Will be rendered from SubagentRenderer or live update
    timestamp: Date.now(),
    subagentId: agentId,
  });

  const interactiveUi = isInteractiveRenderManagerActive();

  // Create either a RenderManager-friendly live block (interactive) or the legacy nested log renderer (non-interactive)
  const renderer = interactiveUi ? undefined : subagentRendererRegistry.create(agentId);

  if (interactiveUi) {
    subagentUiBuffers.set(agentId, {
      agentId,
      role,
      task,
      background,
      startedAt: Date.now(),
      recentLines: [],
      toolStarts: new Map(),
      lastFlushAt: 0,
    });
    updateSubagentLiveMessage(agentId, true);
  } else {
    renderer!.renderStart({
      agentId,
      role: role || 'general',
      task,
    });
  }

  const messageListener = (data: any) => {
    try {
      if (data.agentId !== agentId) return;
      if (!interactiveUi) {
        renderer?.renderMessage(data);
        return;
      }

      const buffer = subagentUiBuffers.get(agentId);
      if (!buffer) return;

      if (data.type === 'status') {
        pushRecentLine(agentId, chalk.cyan(data.content));
      } else if (data.type === 'thinking' && data.content) {
        // Show thinking content preview in interactive mode!
        const preview = previewText(data.content, 100);
        pushRecentLine(agentId, chalk.dim(`💭 ${preview}`));
      }
      updateSubagentLiveMessage(agentId);
    } catch (err: any) {
      console.error(`[UI Error] subagent messageListener crash: ${err.message}`);
    }
  };

  const toolCallListener = (data: any) => {
    try {
      if (data.agentId !== agentId) return;
      if (!interactiveUi) {
        renderer?.renderToolCall(data);
        return;
      }

      const buffer = subagentUiBuffers.get(agentId);
      if (buffer) buffer.toolStarts.set(data.toolCallId, Date.now());
      pushRecentLine(agentId, chalk.blue(`→ ${data.toolName}${formatArgsInline(data.args)}`));
      updateSubagentLiveMessage(agentId, true);
    } catch (err: any) {
      console.error(`[UI Error] subagent toolCallListener crash: ${err.message}`);
    }
  };

  const toolResultListener = (data: any) => {
    try {
      if (data.agentId !== agentId) return;
      if (!interactiveUi) {
        renderer?.renderToolResult(data);
        return;
      }

      const buffer = subagentUiBuffers.get(agentId);
      const startedAt = buffer?.toolStarts.get(data.toolCallId);
      if (startedAt && buffer) buffer.toolStarts.delete(data.toolCallId);
      const duration = startedAt ? ` (${formatDuration(Date.now() - startedAt)})` : '';

      if (data.success) {
        pushRecentLine(agentId, chalk.green(`✓ ${data.toolName}${duration}`));
        const preview = data.output ? previewText(String(data.output), 120) : '';
        if (preview) pushRecentLine(agentId, chalk.dim(`↳ ${preview}`));
      } else {
        pushRecentLine(agentId, chalk.red(`✗ ${data.toolName}${duration}`));
        if (data.error) pushRecentLine(agentId, chalk.red(`↳ ${String(data.error)}`));
      }
      updateSubagentLiveMessage(agentId, true);
    } catch (err: any) {
      console.error(`[UI Error] subagent toolResultListener crash: ${err.message}`);
    }
  };

  const progressListener = (data: any) => {
    try {
      if (data.agentId !== agentId) return;
      if (!interactiveUi) return;

      const buffer = subagentUiBuffers.get(agentId);
      if (!buffer) return;
      buffer.lastProgress = {
        iteration: data.iteration,
        maxIterations: data.maxIterations,
        currentTool: data.currentTool,
        stage: data.stage,
        stageLastUpdated: data.stageLastUpdated,
      };

      // Upgrade spawning -> running as soon as we see progress
      const runningSubagents = uiState.getState().subagents;
      if (runningSubagents) {
        uiState.update({
          subagents: {
            ...runningSubagents,
            active: runningSubagents.active.map(a =>
              a.id === agentId && a.status === 'spawning' ? { ...a, status: 'running' } : a
            ),
          },
        });
      }

      updateSubagentLiveMessage(agentId);
    } catch (err: any) {
      console.error(`[UI Error] subagent progressListener crash: ${err.message}`);
    }
  };

  subAgentManager.on('message', messageListener);
  subAgentManager.on('tool_call', toolCallListener);
  subAgentManager.on('tool_result', toolResultListener);
  subAgentManager.on('progress', progressListener);

  const cleanup = () => {
    subAgentManager.off('message', messageListener);
    subAgentManager.off('tool_call', toolCallListener);
    subAgentManager.off('tool_result', toolResultListener);
    subAgentManager.off('progress', progressListener);
    if (!interactiveUi) {
      subagentRendererRegistry.remove(agentId);
    }
    subagentUiBuffers.delete(agentId);
  };

  return cleanup;
}