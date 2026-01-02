// SubAgentQueue - Manages a queue of subagents with a concurrency limit
import { EventEmitter } from 'events';
import ora from 'ora';
import chalk from 'chalk';
import type { LLMClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { CompletionTracker } from '../audit/index.js';
import type { PlanningValidator } from './planning-validator.js';
import type { ProactiveContextMonitor } from './proactive-context-monitor.js';
import type { IncompleteWorkDetector } from './incomplete-work-detector.js';
import type { FileRelationshipTracker } from './file-relationship-tracker.js';

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
  private runningAgentControllers: Map<string, AbortController> = new Map();
  private waitingQueue: QueuedAgent[] = [];
  private maxConcurrency: number;
  private processing: boolean = false;
  private completedCount: number = 0;
  private failedCount: number = 0;
  private isShuttingDown: boolean = false;
  private hookRegistry?: HookRegistry;
  private completionTracker?: CompletionTracker;
  private planningValidator?: PlanningValidator;
  private proactiveContextMonitor?: ProactiveContextMonitor;
  private incompleteWorkDetector?: IncompleteWorkDetector;
  private fileRelationshipTracker?: FileRelationshipTracker;

  constructor(
    maxConcurrency: number = 5,
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    hookRegistry?: HookRegistry,
    completionTracker?: CompletionTracker,
    planningValidator?: PlanningValidator,
    proactiveContextMonitor?: ProactiveContextMonitor,
    incompleteWorkDetector?: IncompleteWorkDetector,
    fileRelationshipTracker?: FileRelationshipTracker
  ) {
    super();
    this.maxConcurrency = maxConcurrency;
    this.hookRegistry = hookRegistry;
    this.completionTracker = completionTracker;
    this.planningValidator = planningValidator;
    this.proactiveContextMonitor = proactiveContextMonitor;
    this.incompleteWorkDetector = incompleteWorkDetector;
    this.fileRelationshipTracker = fileRelationshipTracker;
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
    if (this.processing || this.isShuttingDown) {
      return;
    }

    this.processing = true;

    while (
      this.runningAgents.size < this.maxConcurrency &&
      this.waitingQueue.length > 0 &&
      !this.isShuttingDown
    ) {
      const queuedAgent = this.waitingQueue.shift();
      if (!queuedAgent) continue;

      const agentId = queuedAgent.config.name;

      console.log(chalk.cyan(`Starting agent ${agentId} (${this.runningAgents.size + 1}/${this.maxConcurrency} running)`));

      // Create abort controller for this agent
      const abortController = new AbortController();
      this.runningAgentControllers.set(agentId, abortController);

      // Create and execute the subagent with all infrastructure
      const agent = new SubAgent(
        this.llmClient,
        this.toolRegistry,
        queuedAgent.config,
        abortController.signal,
        this.hookRegistry,
        this.completionTracker,
        this.planningValidator,
        this.proactiveContextMonitor,
        this.incompleteWorkDetector,
        this.fileRelationshipTracker
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
          this.runningAgentControllers.delete(agentId);

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

  /**
   * Shutdown all running and queued agents
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    console.log(chalk.yellow('\n⚠️  Shutting down subagent queue...'));

    // Clear waiting queue
    const queuedCount = this.waitingQueue.length;
    this.waitingQueue = [];
    if (queuedCount > 0) {
      console.log(chalk.gray(`  Cancelled ${queuedCount} queued agent(s)`));
    }

    // Abort all running agents
    const runningCount = this.runningAgentControllers.size;
    if (runningCount > 0) {
      console.log(chalk.gray(`  Aborting ${runningCount} running agent(s)...`));

      for (const [agentId, controller] of this.runningAgentControllers) {
        controller.abort();
      }

      // Wait for all agents to finish aborting (with SHORT timeout)
      const timeout = 2000; // 2 second timeout - aggressive
      const allAgents = Array.from(this.runningAgents.values());
      const settled = await Promise.race([
        Promise.allSettled(allAgents),
        new Promise(resolve => setTimeout(() => resolve('timeout'), timeout))
      ]);

      if (settled === 'timeout') {
        console.log(chalk.yellow('  Timeout waiting for subagents - forcing exit'));
      } else {
        console.log(chalk.green('  All subagents terminated'));
      }
    }
  }
}

/**
 * Internal SubAgent class for queue execution
 */
class SubAgent extends EventEmitter {
  private conversation: ConversationManager;
  private maxIterations: number;
  private toolsUsed: Set<string> = new Set();
  private abortSignal?: AbortSignal;
  private hookRegistry?: HookRegistry;
  private completionTracker?: CompletionTracker;
  private planningValidator?: PlanningValidator;
  private proactiveContextMonitor?: ProactiveContextMonitor;
  private incompleteWorkDetector?: IncompleteWorkDetector;
  private fileRelationshipTracker?: FileRelationshipTracker;
  private responseCounter = 0;

  // Loop breaker state - prevents infinite validation loops
  private consecutiveIdenticalDetections = 0;
  private lastDetectionHash = '';
  private readonly LOOP_BREAKER_THRESHOLD = 3;

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    private config: QueuedAgent['config'],
    abortSignal?: AbortSignal,
    hookRegistry?: HookRegistry,
    completionTracker?: CompletionTracker,
    planningValidator?: PlanningValidator,
    proactiveContextMonitor?: ProactiveContextMonitor,
    incompleteWorkDetector?: IncompleteWorkDetector,
    fileRelationshipTracker?: FileRelationshipTracker
  ) {
    super();
    this.abortSignal = abortSignal;
    this.hookRegistry = hookRegistry;
    this.completionTracker = completionTracker;
    this.planningValidator = planningValidator;
    this.proactiveContextMonitor = proactiveContextMonitor;
    this.incompleteWorkDetector = incompleteWorkDetector;
    this.fileRelationshipTracker = fileRelationshipTracker;

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
    let hadFileModifications = false;
    const ITERATION_DELAY_MS = 35; // Minimal delay to prevent API rate limiting

    // Create spinner for progress tracking
    const spinner = ora({
      text: `${this.config.name} working...`,
      color: 'cyan',
    }).start();

    try {
      while (continueLoop && iteration < this.maxIterations) {
        iteration++;

        // Check if aborted
        if (this.abortSignal?.aborted) {
          spinner.warn(chalk.yellow(`${this.config.name} aborted`));
          return {
            success: false,
            output: finalOutput,
            error: 'Aborted by parent process',
            iterations: iteration,
            toolsUsed: Array.from(this.toolsUsed),
          };
        }

        // Enforce delay between iterations to prevent API rate limiting
        if (iteration > 1) {
          await new Promise(resolve => setTimeout(resolve, ITERATION_DELAY_MS));
        }

        // Execute agent:iteration hook
        if (this.hookRegistry) {
          const iterationResult = await this.hookRegistry.execute('agent:iteration', {
            iteration,
            maxIterations: this.maxIterations,
          });
          if (!iterationResult.continue) {
            spinner.warn(chalk.yellow(`${this.config.name} cancelled by hook`));
            break;
          }
        }

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

        // Execute assistant:response hook
        if (this.hookRegistry) {
          const responseResult = await this.hookRegistry.execute('assistant:response', {
            assistantMessage: response.content,
            hasToolCalls: !!(response.toolCalls && response.toolCalls.length > 0),
          });

          // Handle injected user message (used by Ralph Wiggum loop)
          if (responseResult.metadata?.injectUserMessage && !response.toolCalls?.length) {
            this.conversation.addAssistantMessage(response.content || '');
            this.conversation.addUserMessage(responseResult.metadata.injectUserMessage);
            continueLoop = true;
            continue;
          }
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          this.conversation.addAssistantMessage(response.content || '', response.toolCalls);

          // Check if any file modification tools were called
          const fileModificationTools = ['create_file', 'patch_file'];
          const hasFileModifications = response.toolCalls.some(tc =>
            fileModificationTools.includes(tc.function.name)
          );
          if (hasFileModifications) {
            hadFileModifications = true;
          }

          await this.executeTools(response.toolCalls);
          continueLoop = true;
        } else {
          this.conversation.addAssistantMessage(response.content || '');
          continueLoop = false;

          // Detect incomplete work - if LLM says it's done but left things undone
          if (this.incompleteWorkDetector && response.content) {
            const isToolFree = this.incompleteWorkDetector.isToolFreeResponse({
              role: 'assistant',
              content: response.content,
              toolCalls: response.toolCalls || []
            });
            const hasTrackingItems = (this.completionTracker?.getIncomplete().length || 0) > 0;
            const detection = this.incompleteWorkDetector.analyze(
              response.content,
              hasTrackingItems
            );

            // AUTO-PROCEED: When agent asks permission for task-authorized action
            if (detection.askingPermission && detection.permissionAlreadyGranted && detection.currentTask) {
              const autoDecision = `Your task is "${detection.currentTask}". This already authorizes the action you're asking about. Proceed with the best option that aligns with your task requirements. Do not wait for user confirmation - make the decision autonomously.`;

              this.conversation.addUserMessage(autoDecision);
              continueLoop = true;
              continue;
            }

            // Check for loop breaker - prevent infinite loops
            const detectionHash = `${detection.completionPhrases.join(',')}_${detection.remainingPhrases.join(',')}`;
            if (detectionHash === this.lastDetectionHash) {
              this.consecutiveIdenticalDetections++;
              if (this.consecutiveIdenticalDetections >= this.LOOP_BREAKER_THRESHOLD) {
                // Break the loop - stop asking about the same issue
                continueLoop = false;
                continue;
              }
            } else {
              this.consecutiveIdenticalDetections = 0;
              this.lastDetectionHash = detectionHash;
            }

            // Case 1: LLM says it's done but has tracking items
            if (isToolFree && detection.completionPhrases.length > 0 && hasTrackingItems) {
              const llmMessage = this.incompleteWorkDetector.generateLLMMessage(detection);
              const reviewPrompt = `${llmMessage}\n\nPlease review the items above and determine which ones are actually relevant. Complete any remaining work or confirm that all items are done.`;

              this.conversation.addUserMessage(reviewPrompt);
              continueLoop = true;
              continue;
            }

            // Case 2: LLM mentions remaining/incomplete work
            if (detection.remainingPhrases.length > 0 || detection.trackingItems.length > 0) {
              const llmMessage = this.incompleteWorkDetector.generateLLMMessage(detection);
              const reviewPrompt = `${llmMessage}\n\nPlease complete any remaining work mentioned above.`;

              this.conversation.addUserMessage(reviewPrompt);
              continueLoop = true;
              continue;
            }
          }

          // Track retrieval usefulness if we had retrievals
          const pendingRetrievalIds = this.conversation.getPendingRetrievalIds();
          if (pendingRetrievalIds.length > 0 && response.content) {
            await this.trackRetrievalUsefulness(pendingRetrievalIds, response.content);
          }

          // Audit completed response for incomplete scaffolding - ONLY if files were modified
          if (this.completionTracker && response.content && hadFileModifications) {
            const responseId = `response_${++this.responseCounter}`;
            const auditResult = await this.completionTracker.auditResponse(
              response.content,
              this.conversation.getMessages(),
              responseId
            );

            // If audit found incomplete items, continue the loop to address them
            if (auditResult.newItems.length > 0) {
              const itemDescriptions = auditResult.newItems
                .map(item => `- ${item.type} in ${item.file}: ${item.description}`)
                .join('\n');
              const auditPrompt = `\n\nScaffolding audit detected incomplete work:\n${itemDescriptions}\n\nPlease complete these items before finishing.`;

              this.conversation.addUserMessage(auditPrompt);
              continueLoop = true;
              continue;
            }
          }
        }
      }

      // Trim conversation history to save tokens
      await this.conversation.trimHistory();

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

      // Execute tool:pre-execute hook
      if (this.hookRegistry) {
        const preResult = await this.hookRegistry.execute('tool:pre-execute', {
          toolName,
          toolArgs,
        });
        if (!preResult.continue) {
          this.conversation.addToolResult(toolCall.id, toolName, 'Execution cancelled by hook');
          continue;
        }
        if (preResult.modifiedArgs) {
          toolArgs = preResult.modifiedArgs;
        }
      }

      let result: { success: boolean; output?: string; error?: string };

      try {
        result = await this.toolRegistry.execute(toolName, toolArgs);

        if (result.success) {
          this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');

          // Track file reads in memory
          if (toolName === 'read_file' && toolArgs.path) {
            this.conversation.trackFileRead(toolArgs.path, 'Read by tool');
          }

          // Track file edits in memory
          this.trackFileEdit(toolName, toolArgs);
        } else {
          this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.conversation.addToolResult(toolCall.id, toolName, `Error: ${errorMessage}`);
        result = { success: false, error: errorMessage };
      }

      // Execute tool:post-execute hook
      if (this.hookRegistry) {
        await this.hookRegistry.execute('tool:post-execute', {
          toolName,
          toolArgs,
          toolResult: result,
        });
      }
    }
  }

  private trackFileEdit(toolName: string, toolArgs: Record<string, any>): void {
    try {
      const memoryStore = this.conversation.getMemoryStore();
      const activeTask = memoryStore.getActiveTask();
      let editedFile: string | undefined;

      if (toolName === 'create_file') {
        editedFile = toolArgs.path;
        memoryStore.addEditRecord({
          file: toolArgs.path || 'unknown',
          description: toolArgs.overwrite ? 'Overwrote file' : 'Created new file',
          changeType: toolArgs.overwrite ? 'modify' : 'create',
          afterSnippet: toolArgs.content?.slice(0, 200),
          relatedTaskId: activeTask?.id,
        });
        memoryStore.addActiveFile({
          path: toolArgs.path,
          purpose: 'Created in session',
        });

        // Track file relationship
        if (this.fileRelationshipTracker && editedFile) {
          this.fileRelationshipTracker.trackFileAccess(editedFile, true);
        }
      } else if (toolName === 'patch_file') {
        editedFile = toolArgs.path;
        memoryStore.addEditRecord({
          file: toolArgs.path || 'unknown',
          description: `Replaced: ${toolArgs.search?.slice(0, 50)}...`,
          changeType: 'modify',
          beforeSnippet: toolArgs.search?.slice(0, 100),
          afterSnippet: toolArgs.replace?.slice(0, 100),
          relatedTaskId: activeTask?.id,
        });

        // Track file relationship
        if (this.fileRelationshipTracker && editedFile) {
          this.fileRelationshipTracker.trackFileAccess(editedFile, true);

          // Display prompt if this file has relationships
          if (this.fileRelationshipTracker.shouldPrompt(editedFile)) {
            this.fileRelationshipTracker.displayPrompt(editedFile);
          }
        }
        memoryStore.addActiveFile({
          path: toolArgs.path,
          purpose: 'Modified in session',
        });
      }
    } catch (error) {
      // Silently fail - file tracking is not critical
    }
  }

  private async trackRetrievalUsefulness(
    retrievalIds: string[],
    assistantResponse: string
  ): Promise<void> {
    const store = this.conversation.getMemoryStore();
    const history = store.getRetrievalHistory();

    for (const id of retrievalIds) {
      const retrieval = history.find(r => r.id === id);
      if (retrieval && retrieval.injectedContent) {
        // Simple heuristic: did the response use any of the retrieval keywords?
        const keywords = retrieval.backwardReference.searchQuery.toLowerCase().split(/\s+/);
        const responseWords = assistantResponse.toLowerCase();
        const wasUsed = keywords.some(k => k.length > 3 && responseWords.includes(k));
        store.markRetrievalUseful(id, wasUsed);
      }
    }
  }
}
