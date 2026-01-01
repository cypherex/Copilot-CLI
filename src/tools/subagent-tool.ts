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

// Schema for spawn_agent
const SpawnAgentSchema = z.object({
  task: z.string().describe('The task for the subagent to complete'),
  name: z.string().optional().describe('Optional name for the subagent'),
  role: z.string().optional().describe(`Subagent role: ${listRoles().map(r => r.id).join(', ')}`),
  files: z.array(z.string()).optional().describe('Files relevant to this subagent task'),
  success_criteria: z.string().optional().describe('Success criteria for the subagent'),
  wait: z.boolean().optional().default(true).describe('Whether to wait for the agent to complete (default: true)'),
  background: z.boolean().optional().default(false).describe('Run in background and return agent ID immediately'),
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
  readonly definition: ToolDefinition = {
    name: 'spawn_agent',
    description: `Spawn an autonomous subagent to handle a focused, specific task.

KEY PRINCIPLE: LLMs work best on FOCUSED, SPECIFIC tasks with bounded context. Use subagents to break complex work into manageable pieces.

WHEN TO USE (MANDATORY):
⚠️ You MUST use spawn_agent for these patterns:
- "for each file/module/service" - Multiple independent items require parallel subagents
- "across all files/modules" - Cross-module operations need parallel processing

WHEN TO USE (HIGHLY RECOMMENDED):
📊 Context Management:
- The conversation is getting long (> 10 messages)
- Context is becoming overloaded with irrelevant information
- You need to step back and see the big picture
- Complex problem with many moving parts

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

  protected async executeInternal(args: z.infer<typeof SpawnAgentSchema>): Promise<string> {
    const { task, name, role, files, success_criteria, background } = args;

    let systemPrompt: string | undefined;
    let maxIterations: number | undefined;
    let focusedTask = task;

    // If a role is provided and memoryStore is available, build a brief and convert to system prompt
    if (role && this.memoryStore) {
      const roleConfig = getRole(role);
      if (roleConfig) {
        maxIterations = roleConfig.defaultMaxIterations;

        // Build focused context with communication patterns
        const pattern = getRecommendedPattern(task, files);
        focusedTask = buildSubagentTask(role, task, files, pattern);

        // Build dispatch message for orchestrator
        const dispatchMessage = buildOrchestratorDispatchMessage(pattern, [{
          task,
          roleId: role,
          files,
        }]);

        // Show dispatch message
        console.log(chalk.cyan('\n' + dispatchMessage + '\n'));

        const brief = buildSubagentBrief(focusedTask, this.memoryStore, {
          role: roleConfig,
          files,
          successCriteria: success_criteria,
        });

        systemPrompt = briefToSystemPrompt(brief);
      }
    }

    const agentId = this.subAgentManager.spawn({
      name: name || `SubAgent for: ${task.slice(0, 30)}...`,
      task,
      systemPrompt,
      maxIterations,
    });

    if (background) {
      return JSON.stringify({
        status: 'spawned',
        agent_id: agentId,
        message: `Subagent spawned in background. Use wait_agent to get results.`,
      }, null, 2);
    }

    // Wait for completion
    const result = await this.subAgentManager.wait(agentId);

    return JSON.stringify({
      status: result.success ? 'completed' : 'failed',
      agent_id: agentId,
      output: result.output,
      error: result.error,
      iterations: result.iterations,
      tools_used: result.toolsUsed,
    }, null, 2);
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

      // Parse and show merge message
      const parsedResult = parseSubagentResult(result.output || '');
      const mergeMessage = buildOrchestratorMergeMessage('sequential-focus', [{
        taskId: agent_id,
        result: parsedResult,
      }]);

      console.log(chalk.cyan('\n' + mergeMessage + '\n'));

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

    // Parse and show merge message
    const parsedResult = parseSubagentResult(result.output || '');
    const mergeMessage = buildOrchestratorMergeMessage('sequential-focus', [{
      taskId: agent_id,
      result: parsedResult,
    }]);

    console.log(chalk.cyan('\n' + mergeMessage + '\n'));

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
