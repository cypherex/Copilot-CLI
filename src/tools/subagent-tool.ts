// SubAgent Tool - spawn autonomous subagents to handle complex tasks

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { SubAgentManager } from '../agent/subagent.js';
import type { MemoryStore } from '../memory/types.js';
import { listRoles, getRole, buildFocusedContext } from '../agent/subagent-roles.js';
import { buildSubagentBrief, briefToSystemPrompt } from '../agent/subagent-brief.js';
import {
  buildSubagentTask,
  getRecommendedPattern,
  buildOrchestratorDispatchMessage,
  buildOrchestratorMergeMessage,
  parseSubagentResult,
} from '../agent/subagent-communication-patterns.js';
import ora from 'ora';
import chalk from 'chalk';
import { SubagentRenderer, subagentRendererRegistry } from '../ui/subagent-renderer.js';
import { uiState } from '../ui/ui-state.js';
import { getRenderManager } from '../ui/render-manager.js';
import type { SpawnValidator } from '../validators/spawn-validator.js';

// Schema for spawn_agent
const SpawnAgentSchema = z.object({
  task: z.string().describe('The task for the subagent to complete'),
  name: z.string().optional().describe('Optional name for the subagent'),
  role: z.string().optional().describe(`Subagent role: ${listRoles().map(r => r.id).join(', ')}`),
  files: z.array(z.string()).optional().describe('Files relevant to this subagent task'),
  success_criteria: z.string().optional().describe('Success criteria for the subagent'),
  wait: z.boolean().optional().default(true).describe('Whether to wait for the agent to complete (default: true)'),
  background: z.boolean().optional().default(false).describe('Run in background and return agent ID immediately'),
  task_id: z.string().optional().describe('The ID of the task this subagent is working on (provides full context of goal and task hierarchy)'),
});

// Schema for wait_agent
const WaitAgentSchema = z.object({
  agent_id: z.string().describe('The ID of the agent to wait for'),
});

// Schema for list_agents
const ListAgentsSchema = z.object({
  status: z.enum(['active', 'completed', 'all']).optional().default('all'),
});

// Schema for get_agent_queue_status
const GetAgentQueueStatusSchema = z.object({});

// Store cleanup functions for background agents to prevent memory leaks
// Shared across SpawnAgentTool and WaitAgentTool
const backgroundAgentCleanupFunctions = new Map<string, () => void>();

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
    const max = buffer.lastProgress.maxIterations ? `/${buffer.lastProgress.maxIterations}` : '';
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

function markSubagentCompletedInUi(agentId: string, result: { success: boolean; output?: string; error?: string; iterations?: number; toolsUsed?: string[] }): void {
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
}

export class SpawnAgentTool extends BaseTool {
  private spawnValidator?: SpawnValidator;

  readonly definition: ToolDefinition = {
    name: 'spawn_agent',
    description: `Spawn an autonomous subagent to handle a focused, specific task.

⭐ CRITICAL CONTEXT PRINCIPLE: Subagents are INCREDIBLE for containing context of a specific task and preventing context flooding in the main orchestrator. They keep your working memory clean and focused. USE THEM AGGRESSIVELY!

KEY BENEFITS:
🧠 Context Containment - Each subagent has isolated, focused context for its specific task
🚀 Performance - Main orchestrator stays lean and efficient without context bloat
🎯 Focus - Work on specific problems without distraction from unrelated details
♻️ Reusability - Subagents can iterate thousands of times without polluting main context

WHEN TO USE (MANDATORY):
⚠️ You MUST use spawn_agent for these patterns:
- "for each file/module/service" - Multiple independent items require parallel subagents
- "across all files/modules" - Cross-module operations need parallel processing

WHEN TO USE (STRONGLY RECOMMENDED - Use More Aggressively):
📊 Context Management (PRIMARY USE CASE):
- The conversation is getting long (> 10 messages) → SPAWN NOW
- Context is becoming overloaded with irrelevant information → SPAWN NOW
- You're tracking multiple concepts/files/changes → SPAWN NOW to isolate each concern
- Complex problem with many moving parts → DELEGATE to keep main orchestrator clean
- Working on a specific feature/bug → ISOLATE in subagent to prevent context pollution

🔄 Parallel Execution (spawn multiple subagents with background=true):
- Writing tests for multiple files or modules
- Refactoring or analyzing multiple components
- Investigating bugs in different parts of the codebase
- Creating documentation for different sections

🎯 Focused Sequential Tasks (single subagent):
- Writing tests for a complex module (file-by-file)
- Investigating a bug by tracing through components
- Refactoring a large module (section-by-section)
- Writing documentation while understanding code
- Any focused, bounded task that benefits from isolation

💡 AGGRESSIVE DELEGATION MINDSET: When in doubt, delegate! Subagents are cheap, context pollution is expensive.

Available Roles:
- investigator: Diagnose bugs and trace execution (deep analysis)
- test-writer: Write comprehensive tests with edge cases
- refactorer: Improve code quality and organization
- documenter: Create and maintain documentation
- fixer: Resolve specific bugs and issues

Each subagent can run for thousands of iterations (default: 1000) and is suitable for long-running tasks. Use background=true for parallel tasks.`,
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task for the subagent to complete',
        },
        name: {
          type: 'string',
          description: 'Optional descriptive name for the subagent',
        },
        role: {
          type: 'string',
          description: 'Subagent role for specialized behavior',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files relevant to this subagent task',
        },
        success_criteria: {
          type: 'string',
          description: 'Success criteria for the subagent',
        },
        wait: {
          type: 'boolean',
          description: 'Whether to wait for completion (default: true)',
        },
        background: {
          type: 'boolean',
          description: 'Run in background, return agent ID immediately (default: false)',
        },
        task_id: {
          type: 'string',
          description: 'The ID of the task this subagent is working on (provides full context of goal and task hierarchy)',
        },
      },
      required: ['task'],
    },
  };

  protected readonly schema = SpawnAgentSchema;
  private subAgentManager: SubAgentManager;
  private memoryStore?: MemoryStore;

  constructor(subAgentManager: SubAgentManager, memoryStore?: MemoryStore) {
    super();
    this.subAgentManager = subAgentManager;
    this.memoryStore = memoryStore;
  }

  setValidator(validator: SpawnValidator): void {
    this.spawnValidator = validator;
  }

  protected async executeInternal(args: z.infer<typeof SpawnAgentSchema>): Promise<string> {
    const { task, name, role, files, success_criteria, background, task_id } = args;

    const warnings: string[] = [];

    // VALIDATION: Disabled for spawn_agent - agents can work on any task
    // Validation only enabled for create_task to enforce upfront breakdown
    let contextSummary: string | undefined;

    // AUTOMATIC CONTEXT MANAGEMENT: Summarize context if conversation is getting long
    // This prevents context pollution in the main orchestrator when spawning subagents
    if (this.memoryStore) {
      const workingState = this.memoryStore.getWorkingState();
      const tasks = this.memoryStore.getTasks();
      
      // Determine if we need to summarize
      const needsSummary = tasks.length > 10 || workingState.editHistory.length > 10;
      
      if (needsSummary) {
        // Use the summarize_context tool logic directly
        const goal = this.memoryStore.getGoal();
        const currentTask = tasks.find((t) => t.status === 'active');
        const userFacts = this.memoryStore.getUserFacts();

        const lines: string[] = [];
        lines.push(`[Context Summary - PRE-SUBAGENT]`);
        lines.push('');
        
        if (goal) {
          lines.push(`🎯 Goal: ${goal.description}`);
          lines.push('');
        }
        
        if (currentTask) {
          lines.push(`📋 Current Task: ${currentTask.description}`);
          lines.push(`   Status: ${currentTask.status} | Priority: ${currentTask.priority}`);
          lines.push('');
        }
        
        const completed = tasks.filter((t: any) => t.status === 'completed').length;
        const active = tasks.filter((t: any) => t.status === 'active').length;
        if (tasks.length > 0) {
          lines.push(`📊 Task Progress: ${completed}/${tasks.length} completed, ${active} active`);
          lines.push('');
        }
        
        if (userFacts && userFacts.length > 0) {
          lines.push(`👤 Key Facts (${userFacts.length}):`);
          for (const fact of userFacts.slice(0, 3)) {
            lines.push(`   • ${fact.fact}`);
          }
          lines.push('');
        }
        
        contextSummary = lines.join('\n');
        
        // Store summary in working state for reference
        this.memoryStore.updateWorkingState({
          lastContextSummary: contextSummary,
          summaryScope: 'pre-subagent',
          summaryTimestamp: new Date(),
        });
        
        uiState.addMessage({
          role: 'system',
          content: '[Auto-Summary] Context summarized for subagent delegation',
          timestamp: Date.now(),
        });
      }
    }

    // Validate task scope - encourage hierarchical breakdown for complex tasks
    if (this.memoryStore) {
      const complexityIndicators = [
        /implement (a |the )?[\w\s]+(system|feature|module|service)/i,
        /build (a |the )?[\w\s]+(system|feature|module|service|app)/i,
        /create (a |the )?[\w\s]+(system|feature|module|service)/i,
        /add (a |the )?[\w\s]+(system|authentication|authorization|integration)/i,
        /refactor (all|the) [\w\s]+/i,
      ];

      const isComplexTask = complexityIndicators.some(pattern => pattern.test(task));

      if (isComplexTask) {
        const currentTask = this.memoryStore.getActiveTask();
        const allTasks = this.memoryStore.getTasks();

        // Check if current task has subtasks that could be delegated instead
        if (currentTask) {
          const subtasks = allTasks.filter(t => t.parentId === currentTask.id);

          if (subtasks.length === 0) {
            const warning = [
              '⚠️  WARNING: Delegating a complex task without breaking it down first',
              'Task appears complex: ' + task,
              'Consider:',
              '  1. Use break_down_task to decompose into 3-7 focused subtasks',
              '  2. Then delegate individual MICRO/MICRO-MICRO tasks to subagents',
              '  3. This enables better focus and higher quality results',
              'Proceeding with delegation anyway...',
            ].join('\n');
            warnings.push(warning);
            uiState.addMessage({
              role: 'system',
              content: warning,
              timestamp: Date.now(),
            });
          }
        } else {
          // No current task set - suggest creating and breaking down
          const warning = [
            '⚠️  WARNING: Delegating complex task without task hierarchy',
            'Recommended workflow:',
            '  1. create_task({ description: "' + task + '", priority: "high" })',
            '  2. break_down_task({ task_id: "<task_id>", subtasks: [...] })',
            '  3. Delegate individual subtasks to subagents',
            'Proceeding with delegation anyway...',
          ].join('\n');
          warnings.push(warning);
          uiState.addMessage({
            role: 'system',
            content: warning,
            timestamp: Date.now(),
          });
        }
      }
    }

    let systemPrompt: string | undefined;
    let maxIterations: number | undefined;
    let focusedTask = task;

    // Enrich task with hierarchical context
    if (this.memoryStore) {
      const currentTask = this.memoryStore.getActiveTask();
      const goal = this.memoryStore.getGoal();
      const allTasks = this.memoryStore.getTasks();

      let enrichedTask = task;
      const contextParts: string[] = [];

      // Add goal context
      if (goal) {
        contextParts.push(`Overall Goal: ${goal.description}`);
      }

      // Add parent task context if current task exists
      if (currentTask) {
        contextParts.push(`Parent Task: ${currentTask.description}`);

        // Check if current task has subtasks
        const subtasks = allTasks.filter(t => t.parentId === currentTask.id);
        if (subtasks.length > 0) {
          const completedSubtasks = subtasks.filter(t => t.status === 'completed');
          contextParts.push(`Task Progress: ${completedSubtasks.length}/${subtasks.length} subtasks completed`);
        }

        // Add related files from parent task
        if (currentTask.relatedFiles && currentTask.relatedFiles.length > 0 && !files) {
          contextParts.push(`Related Files: ${currentTask.relatedFiles.join(', ')}`);
        }
      }

      // Build enriched task description
      if (contextParts.length > 0) {
        enrichedTask = `# Task Context\n\n${contextParts.join('\n')}\n\n# Your Specific Task\n\n${task}`;
        focusedTask = enrichedTask;
      }
    }

    // If a role is provided and memoryStore is available, build a brief and convert to system prompt
    if (role && this.memoryStore) {
      const roleConfig = getRole(role);
      if (roleConfig) {
        maxIterations = roleConfig.defaultMaxIterations;

        // Build focused context with communication patterns
        const pattern = getRecommendedPattern(task, files);
        focusedTask = buildSubagentTask(role, focusedTask, files, pattern);

        // Build dispatch message for orchestrator
        const dispatchMessage = buildOrchestratorDispatchMessage(pattern, [{
          task,
          roleId: role,
          files,
        }]);

        // Show dispatch message
        uiState.addMessage({
          role: 'system',
          content: dispatchMessage,
          timestamp: Date.now(),
        });

        // Determine which task ID to use for context
        let contextTaskId = task_id;
        if (!contextTaskId && this.memoryStore) {
          // Fall back to active task if no task_id provided
          const activeTask = this.memoryStore.getActiveTask();
          if (activeTask) {
            contextTaskId = activeTask.id;
          }
        }

        const brief = buildSubagentBrief(focusedTask, this.memoryStore, {
          role: roleConfig,
          files,
          successCriteria: success_criteria,
          currentTaskId: contextTaskId,
          includeGoal: true,
          includeTaskHierarchy: true,
        });

        systemPrompt = briefToSystemPrompt(brief);
      }
    }

    const agentId = this.subAgentManager.spawn({
      name: name || `SubAgent for: ${task.slice(0, 30)}...`,
      task: focusedTask,
      systemPrompt,
      maxIterations,
    });

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
      content: '', // Will be rendered from SubagentRenderer
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
      if (data.agentId !== agentId) return;
      if (!interactiveUi) {
        renderer!.renderMessage(data);
        return;
      }

      if (data.type === 'status') {
        pushRecentLine(agentId, chalk.cyan(data.content));
      }
      updateSubagentLiveMessage(agentId);
    };

    const toolCallListener = (data: any) => {
      if (data.agentId !== agentId) return;
      if (!interactiveUi) {
        renderer!.renderToolCall(data);
        return;
      }

      const buffer = subagentUiBuffers.get(agentId);
      if (buffer) buffer.toolStarts.set(data.toolCallId, Date.now());
      pushRecentLine(agentId, chalk.blue(`→ ${data.toolName}${formatArgsInline(data.args)}`));
      updateSubagentLiveMessage(agentId, true);
    };

    const toolResultListener = (data: any) => {
      if (data.agentId !== agentId) return;
      if (!interactiveUi) {
        renderer!.renderToolResult(data);
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
    };

    const progressListener = (data: any) => {
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
    };

    this.subAgentManager.on('message', messageListener);
    this.subAgentManager.on('tool_call', toolCallListener);
    this.subAgentManager.on('tool_result', toolResultListener);
    this.subAgentManager.on('progress', progressListener);

    const cleanup = () => {
      this.subAgentManager.off('message', messageListener);
      this.subAgentManager.off('tool_call', toolCallListener);
      this.subAgentManager.off('tool_result', toolResultListener);
      this.subAgentManager.off('progress', progressListener);
      if (!interactiveUi) {
        subagentRendererRegistry.remove(agentId);
      }
      subagentUiBuffers.delete(agentId);
    };

    if (background) {
      // For background tasks, store cleanup function for later
      backgroundAgentCleanupFunctions.set(agentId, cleanup);

      // Auto-finalize UI tracking when the agent completes (so the live block settles without requiring wait_agent)
      this.subAgentManager.wait(agentId).then(result => {
        markSubagentCompletedInUi(agentId, result);
      }).catch(() => {}).finally(() => {
        const storedCleanup = backgroundAgentCleanupFunctions.get(agentId);
        if (storedCleanup) {
          storedCleanup();
          backgroundAgentCleanupFunctions.delete(agentId);
        }
      });

      const response: any = {
        status: 'spawned',
        agent_id: agentId,
        message: `Subagent spawned in background. Use wait_agent to get results.`,
      };

      if (warnings.length > 0) {
        response.warnings = warnings;
      }

      return JSON.stringify(response, null, 2);
    }

    // Update status to running
    const runningSubagents = uiState.getState().subagents;
    if (runningSubagents) {
      uiState.update({
        subagents: {
          ...runningSubagents,
          active: runningSubagents.active.map(a =>
            a.id === agentId ? { ...a, status: 'running' } : a
          ),
        },
      });
    }

    // Wait for completion with guaranteed cleanup
    try {
      const startTime = Date.now();
      const result = await this.subAgentManager.wait(agentId);
      const duration = Date.now() - startTime;

      // Render completion
      if (renderer) {
        if (result.success) {
          renderer.renderEnd({
            duration,
            summary: `Completed in ${result.iterations} iterations. Used tools: ${result.toolsUsed.join(', ')}`,
          });
        } else {
          renderer.renderError(result.error || 'Unknown error');
        }
      }

      markSubagentCompletedInUi(agentId, result);

      const response: any = {
        status: result.success ? 'completed' : 'failed',
        agent_id: agentId,
        output: result.output,
        error: result.error,
        iterations: result.iterations,
        tools_used: result.toolsUsed,
      };

      if (warnings.length > 0) {
        response.warnings = warnings;
      }

      return JSON.stringify(response, null, 2);
    } finally {
      // ALWAYS cleanup event listeners and renderer, even on error
      cleanup();
    }
  }
}

export class WaitAgentTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'wait_agent',
    description: `Wait for a background subagent to complete and get its results.

Use after spawning subagents with background=true. This retrieves the subagent's output, including:
- Final result or error message
- Number of iterations used
- Tools called during execution

The merge message will be displayed showing how the subagent's work integrates into the overall task.`,
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The ID of the agent to wait for',
        },
      },
      required: ['agent_id'],
    },
  };

  protected readonly schema = WaitAgentSchema;
  private subAgentManager: SubAgentManager;

  constructor(subAgentManager: SubAgentManager) {
    super();
    this.subAgentManager = subAgentManager;
  }

  protected async executeInternal(args: z.infer<typeof WaitAgentSchema>): Promise<string> {
    const { agent_id } = args;

    const status = this.subAgentManager.getStatus(agent_id);

    if (status === 'not_found') {
      throw new Error(`Agent not found: ${agent_id}`);
    }

    if (status === 'completed') {
      const result = this.subAgentManager.getResult(agent_id)!;

      // Ensure UI tracking is finalized (background runs may have already done this)
      markSubagentCompletedInUi(agent_id, result);

      // Cleanup event listeners if this was a background agent
      const cleanup = backgroundAgentCleanupFunctions.get(agent_id);
      if (cleanup) {
        cleanup();
        backgroundAgentCleanupFunctions.delete(agent_id);
      }

      // Parse and show merge message
      const parsedResult = parseSubagentResult(result.output || '');
      const mergeMessage = buildOrchestratorMergeMessage('sequential-focus', [{
        taskId: agent_id,
        result: parsedResult,
      }]);

      uiState.addMessage({
        role: 'system',
        content: mergeMessage,
        timestamp: Date.now(),
      });

      return JSON.stringify({
        status: result.success ? 'completed' : 'failed',
        output: result.output,
        error: result.error,
        iterations: result.iterations,
        tools_used: result.toolsUsed,
      }, null, 2);
    }

    // Wait for completion
    const result = await this.subAgentManager.wait(agent_id);

    markSubagentCompletedInUi(agent_id, result);

    // Parse and show merge message
    const parsedResult = parseSubagentResult(result.output || '');
    const mergeMessage = buildOrchestratorMergeMessage('sequential-focus', [{
      taskId: agent_id,
      result: parsedResult,
    }]);

    uiState.addMessage({
      role: 'system',
      content: mergeMessage,
      timestamp: Date.now(),
    });

    // Cleanup event listeners if this was a background agent
    const cleanup = backgroundAgentCleanupFunctions.get(agent_id);
    if (cleanup) {
      cleanup();
      backgroundAgentCleanupFunctions.delete(agent_id);
    }

    return JSON.stringify({
      status: result.success ? 'completed' : 'failed',
      output: result.output,
      error: result.error,
      iterations: result.iterations,
      tools_used: result.toolsUsed,
    }, null, 2);
  }
}

export class ListAgentsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'list_agents',
    description: `List all spawned subagents and their status.

Use to track:
- Active subagents currently running
- Completed subagents with their results
- Failed subagents with error messages

This is especially useful when working with multiple parallel subagents spawned with background=true.`,
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'completed', 'all'],
          description: 'Filter by status (default: all)',
        },
      },
      required: [],
    },
  };

  protected readonly schema = ListAgentsSchema;
  private subAgentManager: SubAgentManager;

  constructor(subAgentManager: SubAgentManager) {
    super();
    this.subAgentManager = subAgentManager;
  }

  protected async executeInternal(args: z.infer<typeof ListAgentsSchema>): Promise<string> {
    const { status } = args;

    const active = this.subAgentManager.listActive();
    const completed = this.subAgentManager.listCompleted();

    const result: any = {};

    if (status === 'active' || status === 'all') {
      result.active = active.map(id => ({
        id,
        status: 'running',
      }));
    }

    if (status === 'completed' || status === 'all') {
      result.completed = completed.map(id => {
        const agentResult = this.subAgentManager.getResult(id);
        return {
          id,
          status: agentResult?.success ? 'completed' : 'failed',
          output_preview: agentResult?.output?.slice(0, 100),
        };
      });
    }

    result.summary = {
      active_count: active.length,
      completed_count: completed.length,
    };

    return JSON.stringify(result, null, 2);
  }
}

export class GetAgentQueueStatusTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'get_agent_queue_status',
    description: `Get the current status of the agent queue, including running and queued agents.

Use to check:
- How many agents are currently running (max 5)
- How many agents are waiting in queue
- Total statistics (completed, failed)

This helps understand agent concurrency and queue state.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  protected readonly schema = GetAgentQueueStatusSchema;
  private subAgentManager: SubAgentManager;

  constructor(subAgentManager: SubAgentManager) {
    super();
    this.subAgentManager = subAgentManager;
  }

  protected async executeInternal(_args: z.infer<typeof GetAgentQueueStatusSchema>): Promise<string> {
    // Get queue status from manager
    const queueStatus = this.subAgentManager.getQueueStatus();

    return JSON.stringify(queueStatus, null, 2);
  }
}
