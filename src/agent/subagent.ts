// SubAgent - autonomous agent that can be spawned to handle specific tasks

import type { LLMClient, LLMConfig, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';
import ora from 'ora';
import chalk from 'chalk';

export interface SubAgentConfig {
  name: string;
  task: string;
  systemPrompt?: string;
  maxIterations?: number;
  workingDirectory?: string;
}

export interface SubAgentResult {
  success: boolean;
  output: string;
  error?: string;
  iterations: number;
  toolsUsed: string[];
}

export class SubAgent {
  private conversation: ConversationManager;
  private maxIterations: number;
  private toolsUsed: Set<string> = new Set();

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    private config: SubAgentConfig
  ) {
    this.config = config;
    const systemPrompt = config.systemPrompt || this.buildDefaultSystemPrompt();
    this.conversation = new ConversationManager(systemPrompt, {
      maxHistoryLength: 30,
      contextConfig: {
        verbose: false,
      },
    });
    this.conversation.setLLMClient(llmClient);
    this.maxIterations = config.maxIterations || 10;
  }

  private buildDefaultSystemPrompt(): string {
    return `You are a focused subagent tasked with completing a specific objective.

Your task: ${this.config.task}

Guidelines:
- Focus exclusively on completing your assigned task
- Use available tools as needed
- Be concise and efficient
- Once the task is complete, provide a clear summary of what was accomplished
- If you cannot complete the task, explain why

Working directory: ${this.config.workingDirectory || process.cwd()}
`;
  }

  async execute(): Promise<SubAgentResult> {
    // Add the task as the initial user message
    this.conversation.addUserMessage(this.config.task);

    let iteration = 0;
    let finalOutput = '';
    let continueLoop = true;

    // Create spinner for progress tracking
    const spinner = ora({
      text: `${this.config.name} working...`,
      color: 'cyan',
    }).start();

    try {
      while (continueLoop && iteration < this.maxIterations) {
        iteration++;
        
        // Update spinner with iteration progress
        spinner.text = `${this.config.name} (iteration ${iteration}/${this.maxIterations})`;

        const tools = this.toolRegistry.getDefinitions();
        const accumulator = new StreamAccumulator();

        for await (const chunk of this.llmClient.chatStream(
          this.conversation.getMessages(),
          tools
        )) {
          accumulator.addChunk(chunk);
        }

        const response = accumulator.getResponse();

        if (response.content) {
          finalOutput = response.content;
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          this.conversation.addAssistantMessage(response.content || '', response.toolCalls);
          await this.executeTools(response.toolCalls);
          continueLoop = true;
        } else {
          this.conversation.addAssistantMessage(response.content || '');
          continueLoop = false;
        }
      }

      const toolsUsed = Array.from(this.toolsUsed);
      const successMessage = toolsUsed.length > 0 
        ? `${this.config.name} completed (used: ${toolsUsed.join(', ')})`
        : `${this.config.name} completed`;

      spinner.succeed(chalk.green(successMessage));

      return {
        success: true,
        output: finalOutput,
        iterations: iteration,
        toolsUsed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      spinner.fail(chalk.red(`${this.config.name} failed: ${errorMessage}`));
      
      return {
        success: false,
        output: finalOutput,
        error: errorMessage,
        iterations: iteration,
        toolsUsed: Array.from(this.toolsUsed),
      };
    }
  }

  private async executeTools(toolCalls: ToolCall[]): Promise<void> {
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      this.toolsUsed.add(toolName);

      let toolArgs: Record<string, any>;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        toolArgs = {};
      }

      try {
        const result = await this.toolRegistry.execute(toolName, toolArgs);

        if (result.success) {
          this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');
        } else {
          this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.conversation.addToolResult(toolCall.id, toolName, `Error: ${errorMessage}`);
      }
    }
  }
}

// SubAgent Manager for tracking and managing multiple subagents
export class SubAgentManager {
  private activeAgents: Map<string, Promise<SubAgentResult>> = new Map();
  private completedAgents: Map<string, SubAgentResult> = new Map();
  private agentCounter = 0;

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry
  ) {}

  spawn(config: SubAgentConfig): string {
    const agentId = `agent_${++this.agentCounter}_${Date.now()}`;

    const agent = new SubAgent(this.llmClient, this.toolRegistry, {
      ...config,
      name: config.name || agentId,
    });

    const promise = agent.execute().then((result) => {
      this.activeAgents.delete(agentId);
      this.completedAgents.set(agentId, result);
      return result;
    });

    this.activeAgents.set(agentId, promise);

    return agentId;
  }

  async wait(agentId: string): Promise<SubAgentResult> {
    // Check if already completed
    const completed = this.completedAgents.get(agentId);
    if (completed) {
      return completed;
    }

    // Wait for active agent
    const promise = this.activeAgents.get(agentId);
    if (promise) {
      return promise;
    }

    throw new Error(`Agent not found: ${agentId}`);
  }

  async waitAll(agentIds: string[]): Promise<Map<string, SubAgentResult>> {
    const results = new Map<string, SubAgentResult>();

    await Promise.all(
      agentIds.map(async (id) => {
        const result = await this.wait(id);
        results.set(id, result);
      })
    );

    return results;
  }

  getStatus(agentId: string): 'running' | 'completed' | 'not_found' {
    if (this.completedAgents.has(agentId)) return 'completed';
    if (this.activeAgents.has(agentId)) return 'running';
    return 'not_found';
  }

  getResult(agentId: string): SubAgentResult | undefined {
    return this.completedAgents.get(agentId);
  }

  listActive(): string[] {
    return Array.from(this.activeAgents.keys());
  }

  listCompleted(): string[] {
    return Array.from(this.completedAgents.keys());
  }
}
