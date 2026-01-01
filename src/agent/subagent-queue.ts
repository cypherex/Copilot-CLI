// SubAgentQueue - Manages a queue of subagents with a concurrency limit
import { EventEmitter } from 'events';
import ora from 'ora';
import chalk from 'chalk';
import type { LLMClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';

export interface QueuedAgent {
  config: {
    name: string;
    task: string;
    systemPrompt?: string;
    maxIterations?: number;
    workingDirectory?: string;
    allowUserInput?: boolean;
  };
  resolve: (result: SubAgentResult) => void;
  reject: (error: Error) => void;
}

export interface SubAgentResult {
  success: boolean;
  output: string;
  error?: string;
  iterations: number;
  toolsUsed: string[];
}

export interface QueueStats {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  maxConcurrency: number;
}

/**
 * Manages a queue of subagents with a configurable concurrency limit
 */
export class SubAgentQueue extends EventEmitter {
  private runningAgents: Map<string, Promise<SubAgentResult>> = new Map();
  private waitingQueue: QueuedAgent[] = [];
  private maxConcurrency: number;
  private processing: boolean = false;
  private completedCount: number = 0;
  private failedCount: number = 0;

  constructor(
    maxConcurrency: number = 5,
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry
  ) {
    super();
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Add an agent to the queue
   * Returns a promise that resolves when the agent completes
   */
  async addToQueue(
    config: QueuedAgent['config']
  ): Promise<SubAgentResult> {
    return new Promise((resolve, reject) => {
      const agentId = config.name || `queue_${Date.now()}_${Math.random().toString(36).slice(0, 9)}`;

      const queuedAgent: QueuedAgent = {
        config: { ...config, name: agentId },
        resolve,
        reject,
      };

      this.waitingQueue.push(queuedAgent);
      this.emit('agent_queued', { agentId, queuePosition: this.waitingQueue.length });

      // Try to process the queue
      this.processQueue().catch(err => {
        console.error(chalk.red('Error processing queue:', err));
      });
    });
  }

  /**
   * Process the waiting queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (
      this.runningAgents.size < this.maxConcurrency &&
      this.waitingQueue.length > 0
    ) {
      const queuedAgent = this.waitingQueue.shift();
      if (!queuedAgent) continue;

      const agentId = queuedAgent.config.name;

      console.log(chalk.cyan(`Starting agent ${agentId} (${this.runningAgents.size + 1}/${this.maxConcurrency} running)`));

      // Create and execute the subagent
      const agent = new SubAgent(
        this.llmClient,
        this.toolRegistry,
        queuedAgent.config
      );

      const promise = agent.execute()
        .then(result => {
          this.completedCount++;
          this.emit('agent_completed', { agentId, result });
          queuedAgent.resolve(result);
          return result;
        })
        .catch(error => {
          this.failedCount++;
          const errorResult: SubAgentResult = {
            success: false,
            output: '',
            error: error instanceof Error ? error.message : String(error),
            iterations: 0,
            toolsUsed: [],
          };
          this.emit('agent_failed', { agentId, error: errorResult.error });
          queuedAgent.resolve(errorResult);
          return errorResult;
        })
        .finally(() => {
          this.runningAgents.delete(agentId);

          // Process next in queue
          this.processQueue().catch(err => {
            console.error(chalk.red('Error processing queue:', err));
            this.processing = false;
          });
        });

      this.runningAgents.set(agentId, promise);
    }

    this.processing = false;
  }

  /**
   * Get current queue statistics
   */
  getStats(): QueueStats {
    return {
      running: this.runningAgents.size,
      queued: this.waitingQueue.length,
      completed: this.completedCount,
      failed: this.failedCount,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Get current queue status with details
   */
  getStatus() {
    const running = Array.from(this.runningAgents.keys());
    const queued = this.waitingQueue.map((agent, index) => ({
      id: agent.config.name || `queued_${index}`,
      task: agent.config.task,
      position: index,
    }));

    return {
      running,
      queued,
      stats: this.getStats(),
    };
  }
}

/**
 * Internal SubAgent class for queue execution
 */
class SubAgent extends EventEmitter {
  private conversation: ConversationManager;
  private maxIterations: number;
  private toolsUsed: Set<string> = new Set();

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    private config: QueuedAgent['config']
  ) {
    super();
    const systemPrompt = config.systemPrompt || this.buildDefaultSystemPrompt();
    this.conversation = new ConversationManager(systemPrompt, {
      maxHistoryLength: 30,
      contextConfig: {
        verbose: false,
      },
    });
    this.conversation.setLLMClient(llmClient);
    this.maxIterations = config.maxIterations || 1000;
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
