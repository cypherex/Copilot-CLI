// SubAgentQueue - Manages a queue of subagents with a concurrency limit
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { log } from '../utils/index.js';
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
import { filterToolDefinitions, isToolAllowed } from './tool-allowlist.js';
import { extractJsonObject } from '../utils/json-extract.js';

export interface QueuedAgent {
  config: {
    name: string;
    task: string;
    systemPrompt?: string;
    maxIterations?: number;
    workingDirectory?: string;
    allowedTools?: string[]; // Optional per-agent tool allowlist
    outputJsonFromReasoning?: boolean; // If true, extract JSON from reasoningContent when content is empty (used for explorer)
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
    fileRelationshipTracker?: FileRelationshipTracker,
    private modelName?: string
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
        log.error('Error processing queue: ' + err);
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

      log.log(`Starting agent ${agentId} (${this.runningAgents.size + 1}/${this.maxConcurrency} running)`, chalk.cyan);

      // Emit agent_started event
      this.emit('agent_started', { agentId, name: queuedAgent.config.name });

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
        this.fileRelationshipTracker,
        this.modelName
      );

      // Forward detailed subagent events for real-time logging
      agent.on('message', (data: any) => {
        this.emit('message', { agentId, ...data });
      });

      agent.on('tool_call', (data: any) => {
        this.emit('tool_call', { agentId, ...data });
      });

      agent.on('tool_result', (data: any) => {
        this.emit('tool_result', { agentId, ...data });
      });

      agent.on('progress', (data: any) => {
        this.emit('progress', { agentId, ...data });
      });

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

          // Process next in queue - this will eventually set processing=false when queue is fully processed
          this.processQueue().catch(err => {
            log.error('Error processing queue: ' + err);
            this.processing = false;
          });
        });

      this.runningAgents.set(agentId, promise);
    }

    // Only set processing=false if we didn't start any agents (queue empty or at max concurrency with nothing to do)
    if (this.runningAgents.size === 0 && this.waitingQueue.length === 0) {
      this.processing = false;
    } else {
      // If we started agents, don't reset processing yet - let the finally() callbacks handle it
      // This prevents race condition where processing=false before agents complete
    }
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
    log.log('\n⚠️  Shutting down subagent queue...', chalk.yellow);

    // Clear waiting queue
    const queuedCount = this.waitingQueue.length;
    this.waitingQueue = [];
    if (queuedCount > 0) {
      log.log(`  Cancelled ${queuedCount} queued agent(s)`, chalk.gray);
    }

    // Wait for all running agents to complete (no timeout - user requested)
    const runningCount = this.runningAgentControllers.size;
    if (runningCount > 0) {
      log.log(`  Waiting for ${runningCount} running agent(s) to complete...`, chalk.gray);

      const allAgents = Array.from(this.runningAgents.values());
      await Promise.allSettled(allAgents);

      log.log('  All subagents completed', chalk.green);
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
    fileRelationshipTracker?: FileRelationshipTracker,
    private modelName?: string
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
      // Use same max history as main agent (defaults to 50)
      enableSmartMemory: true,
      contextConfig: {
        verbose: false,
      },
    });
    this.conversation.setLLMClient(llmClient);

    // Set model-specific context limits (same as main agent)
    if (modelName) {
      this.conversation.setModelContextLimit(modelName);
    }
    // Treat maxIterations=0 as unlimited (useful for tool-driven debug/exploration flows).
    this.maxIterations = config.maxIterations === 0 ? Number.POSITIVE_INFINITY : (config.maxIterations || 1000);
  }

  private buildDefaultSystemPrompt(): string {
    return `You are a focused subagent tasked with completing a specific objective.

Your task: ${this.config.task}

# Your Tools

## read_file
- Read files before patching to ensure exact matching
- Use to explore existing code and integration points
- Essential for understanding the codebase before making changes

## create_file
- Creates new files with content
- Automatically creates parent directories
- Use overwrite: true only when explicitly needed
- **Avoid** creating files over 250 lines long

## patch_file
- **CRITICAL**: Uses EXACT string matching (including whitespace/indentation)
- The search string must match character-for-character
- ALWAYS read the file first to get exact formatting
- Use expectCount to validate you're changing what you intend

## execute_bash
- Run shell commands, tests, build steps
- Execute Python via: "python script.py"
- Use timeout for long-running commands

## list_files
- Use glob patterns: "**/*.ts" for recursive, "*.json" for current dir
- Discover project structure and find relevant files

## parallel
- Execute multiple tools in parallel (e.g., read multiple files at once)
- All tools execute concurrently; results returned together

# Critical Requirements

1. **NO PLACEHOLDERS**: Never leave TODO, FIXME, NotImplemented, or placeholder comments
   - Implement complete, working solutions
   - If you can't implement something, explain why in your response

2. **EXPLORE INTEGRATION POINTS**: Before implementing:
   - Read relevant files to understand existing patterns
   - Check how similar features are implemented
   - Understand data flow and dependencies
   - Verify your changes integrate correctly with existing code

3. **READ BEFORE PATCH**: ALWAYS read files before using patch_file
   - Get exact whitespace and formatting
   - Understand the context around your change
   - Ensure search string will match

4. **COMPLETE THE TASK**: Don't stop until the task is fully complete
   - Test your changes if applicable
   - Verify integration points work
   - Clean up any temporary code

5. **BE THOROUGH**:
   - Explore necessary files to understand the system
   - Follow existing code patterns and conventions
   - Make changes that fit naturally with the codebase

Working directory: ${this.config.workingDirectory || process.cwd()}

Remember: You are responsible for delivering complete, production-ready work. No shortcuts, no placeholders.
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
    const debugSubagent = !!process.env.DEBUG_SUBAGENT || !!process.env.DEBUG_EXPLORER;
    let lastResponseHadToolCalls = false;

    try {
      while (continueLoop && iteration < this.maxIterations) {
        iteration++;

        // Emit progress event (no spinner - UI handles display)
        this.emit('progress', {
          agentId: this.config.name,
          name: this.config.name,
          iteration,
          maxIterations: this.maxIterations,
          currentTool: undefined,
          status: 'running',
        });

        // Check if aborted
        if (this.abortSignal?.aborted) {
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
            break;
          }
        }

        const tools = filterToolDefinitions(this.toolRegistry.getDefinitions(), this.config.allowedTools);
        const accumulator = new StreamAccumulator();

        for await (const chunk of this.llmClient.chatStream(
          this.conversation.getMessages(),
          tools
        )) {
          accumulator.addChunk(chunk);
        }

        const response = accumulator.getResponse();
        const contentLen = (response.content || '').trim().length;
        const reasoningLen = (response.reasoningContent || '').trim().length;
        const toolCallsCount = response.toolCalls?.length || 0;
        lastResponseHadToolCalls = toolCallsCount > 0;

        // Emit a lightweight per-iteration trace for debugging tool-driven subagents like explorer.
        if (debugSubagent || this.config.outputJsonFromReasoning) {
          this.emit('message', {
            content: `[Subagent Debug] iter ${iteration}/${this.maxIterations} contentLen=${contentLen} reasoningLen=${reasoningLen} toolCalls=${toolCallsCount}`,
            type: 'system',
            iteration,
          });
        }

        if (response.content) {
          finalOutput = response.content;

          // Emit message event for thinking/reasoning content
          this.emit('message', {
            content: response.content,
            type: response.toolCalls && response.toolCalls.length > 0 ? 'thinking' : 'final_response',
            iteration,
          });
        }

        // Execute assistant:response hook
        if (this.hookRegistry) {
          const responseResult = await this.hookRegistry.execute('assistant:response', {
            assistantMessage: response.content,
            hasToolCalls: !!(response.toolCalls && response.toolCalls.length > 0),
          });

          // Handle injected user message (used by Ralph Wiggum loop)
          if (responseResult.metadata?.injectUserMessage && !response.toolCalls?.length) {
            this.conversation.addAssistantMessage(response.content || '', undefined, response.reasoningContent);
            this.conversation.addUserMessage(responseResult.metadata.injectUserMessage);
            continueLoop = true;
            continue;
          }
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          this.conversation.addAssistantMessage(response.content || '', response.toolCalls, response.reasoningContent);

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
          this.conversation.addAssistantMessage(response.content || '', undefined, response.reasoningContent);

          // If model produced output only in reasoning_content (thinking-enabled providers),
          // optionally extract JSON for tool-driven subagents (e.g., explorer) without leaking reasoning.
          // If extraction fails, fall back to returning the raw reasoning content instead of an empty output
          // (the caller can attempt its own parse/repair).
          if (this.config.outputJsonFromReasoning && (!response.content || !response.content.trim()) && response.reasoningContent) {
            const extracted = extractJsonObject(response.reasoningContent);
            finalOutput = extracted.jsonText || response.reasoningContent;
          } else if (response.content) {
            finalOutput = response.content;
          }

          // Check if we need compression before ending the loop
          const contextManager = this.conversation.getContextManager();
          contextManager.updateUsage(this.conversation.getMessages());
          const needsCompression = contextManager.needsCompression();

          if (needsCompression) {
            // Compression will happen, continue loop after compression
            await this.conversation.trimHistory();
            // Note: subagents run in background, no console logging
            continueLoop = true;
            continue;
          }

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

            // Log incomplete items but don't block - orchestrator will handle via global tracking
            if (auditResult.newItems.length > 0) {
              log.log(
                `
⚠️  Subagent detected ${auditResult.newItems.length} incomplete item(s) - ` +
                `added to global tracking list for orchestrator
`,
                chalk.yellow
              );
            }
          }
        }
      }

      // If we hit maxIterations while still expecting a post-tool synthesis step, do one final no-tools pass.
      // This prevents empty explorer outputs when the model used up its iteration budget on tool calls.
      if (continueLoop && lastResponseHadToolCalls && this.config.outputJsonFromReasoning) {
        this.emit('message', {
          content: `[Subagent Debug] reached maxIterations (${this.maxIterations}) after tool calls; running 1 final no-tools completion pass`,
          type: 'system',
          iteration,
        });

        this.conversation.addUserMessage(
          'Finalize now: you have NO tools. Return the final required output directly (one JSON object if requested).'
        );

        const accumulator = new StreamAccumulator();
        for await (const chunk of this.llmClient.chatStream(this.conversation.getMessages(), [])) {
          accumulator.addChunk(chunk);
        }

        const response = accumulator.getResponse();

        if (this.config.outputJsonFromReasoning && (!response.content || !response.content.trim()) && response.reasoningContent) {
          const extracted = extractJsonObject(response.reasoningContent);
          finalOutput = extracted.jsonText || response.reasoningContent;
        } else if (response.content) {
          finalOutput = response.content;
        }

        this.conversation.addAssistantMessage(response.content || '', undefined, response.reasoningContent);
        continueLoop = false;
      }

      // Trim conversation history to save tokens
      await this.conversation.trimHistory();

      const toolsUsed = Array.from(this.toolsUsed);

      return {
        success: true,
        output: finalOutput,
        iterations: iteration,
        toolsUsed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

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
      if (!isToolAllowed(toolName, this.config.allowedTools)) {
        throw new Error(`Tool not allowed for this subagent: ${toolName}`);
      }
      this.toolsUsed.add(toolName);

      let toolArgs: Record<string, any>;
      let toolArgsParseError: string | undefined;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        toolArgs = {};
        toolArgsParseError = e instanceof Error ? e.message : String(e);
        if (process.env.DEBUG_TOOL_ARGS || process.env.DEBUG_EXPLORER || process.env.DEBUG_SUBAGENT) {
          const raw = String(toolCall.function.arguments || '');
          const preview = raw.replace(/\s+/g, ' ').slice(0, 220);
          this.emit('message', {
            type: 'system',
            content: `[Subagent Debug] tool args JSON.parse failed for ${toolName}: ${toolArgsParseError}. rawLen=${raw.length} rawPreview=${preview}${raw.length > 220 ? '…' : ''}`,
          });
        }
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

      // Emit tool call event for real-time logging
      this.emit('tool_call', {
        toolName,
        args: toolArgs,
        toolCallId: toolCall.id,
        ...(toolArgsParseError ? { parseError: toolArgsParseError } : {}),
      });

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

      // Emit tool result event for real-time logging
      this.emit('tool_result', {
        toolCallId: toolCall.id,
        toolName,
        success: result.success,
        output: result.output,
        error: result.error,
      });

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
