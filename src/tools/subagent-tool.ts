// SubAgent Tool - spawn autonomous subagents to handle complex tasks

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { SubAgentManager } from '../agent/subagent.js';
import type { MemoryStore } from '../memory/types.js';
import { listRoles, getRole } from '../agent/subagent-roles.js';
import { buildSubagentBrief, briefToSystemPrompt } from '../agent/subagent-brief.js';
import {
  buildSubagentTask,
  getRecommendedPattern,
  buildOrchestratorDispatchMessage,
  buildOrchestratorMergeMessage,
  parseSubagentResult,
} from '../agent/subagent-communication-patterns.js';
import chalk from 'chalk';
import { uiState } from '../ui/ui-state.js';
import type { SpawnValidator } from '../validators/spawn-validator.js';
import { buildAutoToTInstruction, decideAutoToT, recordAutoToT } from '../agent/auto-tot.js';
import { attachSubagentUI, markSubagentCompletedInUi, backgroundAgentCleanupFunctions } from './subagent-ui-utils.js';

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
- explorer: Read-only codebase exploration with structured summaries
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

    // AUTOMATIC CONTEXT MANAGEMENT: Summarize context if conversation is getting long
    if (this.memoryStore) {
      const workingState = this.memoryStore.getWorkingState();
      const tasks = this.memoryStore.getTasks();
      
      const needsSummary = tasks.length > 10 || workingState.editHistory.length > 10;
      
      if (needsSummary) {
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
        
        const contextSummary = lines.join('\n');
        
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

    // Validate task scope
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
    let allowedTools: string[] | undefined;

    // Enrich task with hierarchical context
    if (this.memoryStore) {
      const currentTask = this.memoryStore.getActiveTask();
      const goal = this.memoryStore.getGoal();
      const allTasks = this.memoryStore.getTasks();

      const contextParts: string[] = [];

      if (goal) {
        contextParts.push(`Overall Goal: ${goal.description}`);
      }

      if (currentTask) {
        contextParts.push(`Parent Task: ${currentTask.description}`);

        const subtasks = allTasks.filter(t => t.parentId === currentTask.id);
        if (subtasks.length > 0) {
          const completedSubtasks = subtasks.filter(t => t.status === 'completed');
          contextParts.push(`Task Progress: ${completedSubtasks.length}/${subtasks.length} subtasks completed`);
        }

        if (currentTask.relatedFiles && currentTask.relatedFiles.length > 0 && !files) {
          contextParts.push(`Related Files: ${currentTask.relatedFiles.join(', ')}`);
        }
      }

      if (contextParts.length > 0) {
        focusedTask = `# Task Context\n\n${contextParts.join('\n')}\n\n# Your Specific Task\n\n${task}`;
      }
    }

    // Role-based configuration
    if (role && this.memoryStore) {
      const roleConfig = getRole(role);
      if (roleConfig) {
        maxIterations = roleConfig.defaultMaxIterations;

        if (roleConfig.id === 'explorer') {
          allowedTools = ['read_file', 'grep_repo', 'list_files'];
        }

        const pattern = getRecommendedPattern(task, files);
        focusedTask = buildSubagentTask(role, focusedTask, files, pattern);

        const dispatchMessage = buildOrchestratorDispatchMessage(pattern, [{
          task,
          roleId: role,
          files,
        }]);

        uiState.addMessage({
          role: 'system',
          content: dispatchMessage,
          timestamp: Date.now(),
        });

        let contextTaskId = task_id;
        if (!contextTaskId && this.memoryStore) {
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

    // Auto-ToT logic
    if (this.memoryStore) {
      const decision = decideAutoToT(this.memoryStore, { kind: 'subagent_spawn' });
      if (decision.shouldTrigger && decision.toolArgs) {
        decision.toolArgs.branches = 2;
        decision.toolArgs.max_iterations = Math.min(decision.toolArgs.max_iterations, 400);
        recordAutoToT(this.memoryStore, decision);
        const instruction = buildAutoToTInstruction(decision);
        if (instruction) {
          focusedTask = `${instruction}\n\n${focusedTask}`;
        }
      }
    }

    const agentId = this.subAgentManager.spawn({
      name: name || `SubAgent for: ${task.slice(0, 30)}...`,
      task: focusedTask,
      systemPrompt,
      maxIterations,
      allowedTools,
      outputJsonFromReasoning: role === 'explorer' ? true : undefined,
    });

    // Attach UI listeners using centralized utility
    const cleanup = attachSubagentUI(
      this.subAgentManager,
      agentId,
      task,
      role,
      background
    );

    if (background) {
      backgroundAgentCleanupFunctions.set(agentId, cleanup);

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

    // Wait for completion
    try {
      const result = await this.subAgentManager.wait(agentId);
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

      markSubagentCompletedInUi(agent_id, result);

      const cleanup = backgroundAgentCleanupFunctions.get(agent_id);
      if (cleanup) {
        cleanup();
        backgroundAgentCleanupFunctions.delete(agent_id);
      }

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

    const result = await this.subAgentManager.wait(agent_id);
    markSubagentCompletedInUi(agent_id, result);

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
    const queueStatus = this.subAgentManager.getQueueStatus();
    return JSON.stringify(queueStatus, null, 2);
  }
}