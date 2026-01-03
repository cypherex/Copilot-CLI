// SubAgent - autonomous agent that can be spawned to handle specific tasks

import { EventEmitter } from 'events';
import type { LLMClient, LLMConfig, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';
import chalk from 'chalk';
import type { HookRegistry } from '../hooks/registry.js';
import type { CompletionTracker } from '../audit/index.js';
import type { PlanningValidator } from './planning-validator.js';
import type { ProactiveContextMonitor } from './proactive-context-monitor.js';
import type { IncompleteWorkDetector } from './incomplete-work-detector.js';
import type { FileRelationshipTracker } from './file-relationship-tracker.js';

export interface SubAgentConfig {
  name: string;
  task: string;
  systemPrompt?: string;
  maxIterations?: number;
  workingDirectory?: string;
  allowUserInput?: boolean; // Allow user to queue messages during execution
}

export interface SubAgentResult {
  success: boolean;
  output: string;
  error?: string;
  iterations: number;
  toolsUsed: string[];
}

export interface SubAgentProgress {
  agentId: string;
  name: string;
  iteration: number;
  maxIterations: number;
  currentTool?: string;
  stage?: string; // Current stage within the iteration (e.g., 'thinking', 'executing', 'analyzing')
  stageLastUpdated?: number; // Timestamp when stage last updated
  status: 'running' | 'paused' | 'waiting_for_input' | 'completed' | 'failed';
}

export class SubAgent extends EventEmitter {
  private conversation: ConversationManager;
  private maxIterations: number;
  private toolsUsed: Set<string> = new Set();
  private userMessageQueue: string[] = [];
  private userMessageResolvers: Map<number, (message: string) => void> = new Map();
  private messageCounter = 0;
  private abortSignal?: AbortSignal;
  private hookRegistry?: HookRegistry;
  private completionTracker?: CompletionTracker;
  private planningValidator?: PlanningValidator;
  private proactiveContextMonitor?: ProactiveContextMonitor;
  private incompleteWorkDetector?: IncompleteWorkDetector;
  private fileRelationshipTracker?: FileRelationshipTracker;

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    private config: SubAgentConfig,
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
    this.config = config;
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

    this.maxIterations = config.maxIterations || 10000;
  }

  // Queue a user message for the subagent
  queueUserMessage(message: string): void {
    this.userMessageQueue.push(message);
    this.emit('user_message_queued', { message, queueLength: this.userMessageQueue.length });
  }

  // Send a message and wait for a response from the subagent
  async sendUserMessage(message: string, timeout: number = 30000): Promise<string> {
    const messageId = ++this.messageCounter;
    
    return new Promise((resolve, reject) => {
      // Store the resolver
      this.userMessageResolvers.set(messageId, resolve);
      
      // Queue the message with metadata
      this.userMessageQueue.push(`[SYNC:${messageId}]${message}`);
      
      // Set timeout
      const timer = setTimeout(() => {
        this.userMessageResolvers.delete(messageId);
        reject(new Error('Timeout waiting for subagent response'));
      }, timeout);
      
      // Clean up timer when resolved
      const originalResolve = resolve;
      this.userMessageResolvers.set(messageId, (result: string) => {
        clearTimeout(timer);
        originalResolve(result);
      });
      
      this.emit('user_message_queued', { message, messageId, queueLength: this.userMessageQueue.length });
    });
  }

  // Get current progress
  getProgress(): SubAgentProgress {
    return {
      agentId: this.config.name,
      name: this.config.name,
      iteration: 0,
      maxIterations: this.maxIterations,
      status: 'running',
      stage: 'thinking',
      stageLastUpdated: Date.now(),
    };
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

# ⚡ MAXIMIZE PARALLEL EXECUTION

**CRITICAL**: ALWAYS use the parallel tool for independent operations. This is a major performance optimization.

Reading 2+ files? Use parallel:
  parallel({ tools: [
    { tool: "read_file", parameters: { path: "src/a.ts" } },
    { tool: "read_file", parameters: { path: "src/b.ts" } }
  ]})

Running multiple commands? Use parallel:
  parallel({ tools: [
    { tool: "execute_bash", parameters: { command: "npm run lint" } },
    { tool: "execute_bash", parameters: { command: "npm run test" } }
  ]})

Mixed operations? Use parallel:
  parallel({ tools: [
    { tool: "read_file", parameters: { path: "config.json" } },
    { tool: "list_files", parameters: { pattern: "src/**/*.ts" } },
    { tool: "execute_bash", parameters: { command: "git status" } }
  ]})

**Default mindset**: If you're about to use the same tool twice, or use multiple different tools for independent operations, use parallel. It's 3-10x faster.

# Tracking Items (if applicable)

If you encounter tracking items during your work, you have access to these tools:

## list_tracking_items
- View tracking items by status (open, under-review, closed, all)
- Use to see incomplete work that needs attention

## review_tracking_item
- Move item to 'under-review' status
- **REQUIRES files_to_verify**: Array of file paths you READ (minimum 1)
- You MUST read files first before calling this - no guessing!

## close_tracking_item
- Close a tracking item with reason and evidence
- Reasons: completed, added-to-tasks, duplicate, not-needed, out-of-scope
- Provide file evidence for completed items

**Workflow**: list → read files → review → close with evidence

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
    let currentStage = 'thinking'; // Track current stage

    // Emit start message
    this.emit('message', {
      agentId: this.config.name,
      content: `Starting subagent execution\nTask: ${this.config.task}\nMax iterations: ${this.maxIterations}`,
      type: 'system',
    });

    try {
      while (continueLoop && iteration < this.maxIterations) {
        iteration++;

        // Emit iteration start message
        this.emit('message', {
          agentId: this.config.name,
          content: `\n${'='.repeat(60)}\nIteration ${iteration}/${this.maxIterations}\n${'='.repeat(60)}`,
          type: 'system',
        });

        // Update stage to thinking before LLM call
        currentStage = 'thinking';
        this.emit('progress', {
          agentId: this.config.name,
          name: this.config.name,
          iteration,
          maxIterations: this.maxIterations,
          currentTool: undefined,
          stage: currentStage,
          stageLastUpdated: Date.now(),
          status: 'running',
        });

        // Check for queued user messages
        if (this.userMessageQueue.length > 0) {
          const queuedMessage = this.userMessageQueue.shift();
          
          if (!queuedMessage) {
            continue;
          }

          if (queuedMessage.startsWith('[SYNC:')) {
            // Handle synchronous message that expects a response
            const match = queuedMessage.match(/\[SYNC:(\d+)\](.*)/);
            if (match) {
              const messageId = parseInt(match[1]);
              const message = match[2];

              // Process the message
              this.conversation.addUserMessage(message);
              
              // Get response and resolve the promise
              const response = await this.getSingleResponse();
              this.conversation.addAssistantMessage(response.content || '', undefined, response.reasoningContent);
              
              const resolver = this.userMessageResolvers.get(messageId);
              if (resolver) {
                resolver(response.content || 'No response');
                this.userMessageResolvers.delete(messageId);
              }
              
              continueLoop = true;
              continue;
            }
          } else {
            // Handle async user message (fire and forget)
            this.conversation.addUserMessage(queuedMessage);
          }
        }

        const tools = this.toolRegistry.getDefinitions();
        const accumulator = new StreamAccumulator();

        for await (const chunk of this.llmClient.chatStream(
          this.conversation.getMessages(),
          tools
        )) {
          accumulator.addChunk(chunk);
        }

        const response = accumulator.getResponse();

        // Always emit thinking content for logging (even if empty or with tool calls)
        if (response.content) {
          finalOutput = response.content;
          // Emit message event for real-time display and logging
          this.emit('message', {
            agentId: this.config.name,
            content: response.content,
            type: 'thinking',
            iteration,
          });
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          // Update stage to executing
          currentStage = 'executing';
          this.emit('progress', {
            agentId: this.config.name,
            name: this.config.name,
            iteration,
            maxIterations: this.maxIterations,
            currentTool: undefined,
            stage: currentStage,
            stageLastUpdated: Date.now(),
            status: 'running',
          });

          this.conversation.addAssistantMessage(response.content || '', response.toolCalls, response.reasoningContent);
          await this.executeTools(response.toolCalls);
          continueLoop = true;
        } else {
          // Final response (no tool calls) - emit as completion message
          this.emit('message', {
            agentId: this.config.name,
            content: response.content || '',
            type: 'final_response',
            iteration,
          });
          this.conversation.addAssistantMessage(response.content || '', undefined, response.reasoningContent);
          continueLoop = false;
        }
      }

      const toolsUsed = Array.from(this.toolsUsed);

      // Emit completion message
      this.emit('message', {
        agentId: this.config.name,
        content: `\n${'='.repeat(60)}\nSubagent Completed Successfully\nTotal iterations: ${iteration}\nTools used: ${toolsUsed.join(', ')}\n${'='.repeat(60)}`,
        type: 'system',
      });

      return {
        success: true,
        output: finalOutput,
        iterations: iteration,
        toolsUsed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Emit error message
      this.emit('message', {
        agentId: this.config.name,
        content: `\n${'='.repeat(60)}\nSubagent Failed\nError: ${errorMessage}\nIterations completed: ${iteration}\n${'='.repeat(60)}`,
        type: 'system',
      });

      return {
        success: false,
        output: finalOutput,
        error: errorMessage,
        iterations: iteration,
        toolsUsed: Array.from(this.toolsUsed),
      };
    }
  }

  private async getSingleResponse(): Promise<{ content: string; reasoningContent?: string; toolCalls?: any[] }> {
    const tools = this.toolRegistry.getDefinitions();
    const accumulator = new StreamAccumulator();

    for await (const chunk of this.llmClient.chatStream(
      this.conversation.getMessages(),
      tools
    )) {
      accumulator.addChunk(chunk);
    }

    return accumulator.getResponse();
  }

  private async executeTools(toolCalls: ToolCall[]): Promise<void> {
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      this.toolsUsed.add(toolName);

      // Update stage to show which tool is being executed
      this.emit('progress', {
        agentId: this.config.name,
        name: this.config.name,
        iteration: 0, // We don't track iteration here
        maxIterations: this.maxIterations,
        currentTool: toolName,
        stage: `executing: ${toolName}`,
        stageLastUpdated: Date.now(),
        status: 'running',
      });

      let toolArgs: Record<string, any>;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        toolArgs = {};
      }

      // Emit tool call event for real-time display and logging
      this.emit('tool_call', {
        agentId: this.config.name,
        toolName,
        args: toolArgs,
        toolCallId: toolCall.id,
      });

      try {
        const result = await this.toolRegistry.execute(toolName, toolArgs);

        // Emit tool result event for real-time display and logging
        this.emit('tool_result', {
          agentId: this.config.name,
          toolCallId: toolCall.id,
          toolName,
          success: result.success,
          output: result.output,
          error: result.error,
        });

        if (result.success) {
          this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');
          // Audit file modifications for incomplete scaffolding
          await this.auditFileModification(toolName, toolArgs, result);
        } else {
          this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Emit error result event
        this.emit('tool_result', {
          agentId: this.config.name,
          toolCallId: toolCall.id,
          toolName,
          success: false,
          error: errorMessage,
        });

        this.conversation.addToolResult(toolCall.id, toolName, `Error: ${errorMessage}`);
      }
    }
  }

  /**
   * Audit file modifications for incomplete scaffolding
   */
  private async auditFileModification(
    toolName: string,
    toolArgs: Record<string, any>,
    result: { success: boolean; output?: string; error?: string }
  ): Promise<void> {
    const fileModificationTools = ['create_file', 'patch_file'];
    if (!fileModificationTools.includes(toolName) || !result.success || !this.completionTracker) {
      return;
    }

    try {
      // Log audit start
      this.emit('message', {
        agentId: this.config.name,
        type: 'system',
        content: `🔍 [Subagent] Auditing ${toolName} on ${toolArgs.path || 'unknown'}...`,
      });

      // Build context with actual file content for audit
      let context: string;
      if (toolName === 'create_file') {
        // For create_file, include FULL file content so audit can detect all issues
        context = `Tool: ${toolName} (subagent: ${this.config.name})\nFile: ${toolArgs.path || 'unknown'}\n\nFile Content:\n${toolArgs.content || '(no content)'}`;
      } else if (toolName === 'patch_file') {
        // For patch_file, include search/replace patterns and context
        context = `Tool: ${toolName} (subagent: ${this.config.name})\nFile: ${toolArgs.path || 'unknown'}\n\nSearch pattern:\n${toolArgs.search || '(no search pattern)'}\n\nReplacement:\n${toolArgs.replace || '(no replacement)'}\n\nResult: ${result.output || ''}`;
      } else {
        context = `Tool: ${toolName} (subagent: ${this.config.name})\nFile: ${toolArgs.path || 'unknown'}\n${result.output || ''}`;
      }

      const responseId = `subagent_${this.config.name}_${toolName}_${Date.now()}`;
      const auditResult = await this.completionTracker.auditResponse(context, this.conversation.getMessages(), responseId);

      if (auditResult.newItems.length > 0 || auditResult.resolvedItems.length > 0) {
        // Emit audit results
        for (const item of auditResult.newItems) {
          this.emit('message', {
            agentId: this.config.name,
            type: 'system',
            content: `Tracking: ${item.type} in ${item.file}: ${item.description}`,
          });
        }
        for (const item of auditResult.resolvedItems) {
          this.emit('message', {
            agentId: this.config.name,
            type: 'system',
            content: `Resolved: ${item.type} in ${item.file}`,
          });
        }
      } else {
        this.emit('message', {
          agentId: this.config.name,
          type: 'system',
          content: `✓ [Subagent] Audit complete: No incomplete scaffolding detected in ${toolArgs.path || 'unknown'}`,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emit('message', {
        agentId: this.config.name,
        type: 'system',
        content: `⚠️ [Subagent] Scaffolding audit failed: ${errorMsg}`,
      });
      console.error(`[Subagent ${this.config.name} Scaffold Audit] Failed:`, error);
    }
  }
}

import { SubAgentQueue } from './subagent-queue.js';

// SubAgent Manager for tracking and managing multiple subagents with queue
export class SubAgentManager extends EventEmitter {
  private activeAgents: Map<string, Promise<SubAgentResult>> = new Map();
  private completedAgents: Map<string, SubAgentResult> = new Map();
  private agentInstances: Map<string, SubAgent> = new Map();
  private agentCounter = 0;
  private agentQueue: SubAgentQueue;
  private hookRegistry?: HookRegistry;
  private completionTracker?: CompletionTracker;
  private planningValidator?: PlanningValidator;
  private proactiveContextMonitor?: ProactiveContextMonitor;
  private incompleteWorkDetector?: IncompleteWorkDetector;
  private fileRelationshipTracker?: FileRelationshipTracker;

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    maxConcurrency: number = 5,
    hookRegistry?: HookRegistry,
    completionTracker?: CompletionTracker,
    planningValidator?: PlanningValidator,
    proactiveContextMonitor?: ProactiveContextMonitor,
    incompleteWorkDetector?: IncompleteWorkDetector,
    fileRelationshipTracker?: FileRelationshipTracker,
    private modelName?: string
  ) {
    super();
    // Store validators for use in spawn()
    this.hookRegistry = hookRegistry;
    this.completionTracker = completionTracker;
    this.planningValidator = planningValidator;
    this.proactiveContextMonitor = proactiveContextMonitor;
    this.incompleteWorkDetector = incompleteWorkDetector;
    this.fileRelationshipTracker = fileRelationshipTracker;

    // Create the queue with concurrency limit and all infrastructure
    this.agentQueue = new SubAgentQueue(
      maxConcurrency,
      llmClient,
      toolRegistry,
      hookRegistry,
      completionTracker,
      planningValidator,
      proactiveContextMonitor,
      incompleteWorkDetector,
      fileRelationshipTracker,
      modelName
    );

    // Forward queue events
    this.agentQueue.on('agent_started', (data) => {
      this.emit('agent_started', data);
    });

    this.agentQueue.on('agent_queued', (data) => {
      this.emit('agent_queued', data);
    });

    this.agentQueue.on('agent_completed', (data) => {
      this.emit('agent_completed', data);
    });

    this.agentQueue.on('agent_failed', (data) => {
      this.emit('agent_failed', data);
    });
  }

  spawn(config: SubAgentConfig): string {
    const agentId = `agent_${++this.agentCounter}_${Date.now()}`;

    // Create agent instance for progress tracking and user messages
    // Note: This is just a placeholder for message queueing; actual execution happens in the queue
    const agent = new SubAgent(
      this.llmClient,
      this.toolRegistry,
      {
        ...config,
        name: agentId,
      },
      undefined, // abortSignal - not needed for placeholder
      this.hookRegistry,
      this.completionTracker,
      this.planningValidator,
      this.proactiveContextMonitor,
      this.incompleteWorkDetector,
      this.fileRelationshipTracker,
      this.modelName
    );

    // Store agent instance for progress tracking and user messages
    this.agentInstances.set(agentId, agent);

    // Forward progress events
    agent.on('progress', (progress: SubAgentProgress) => {
      const progressWithAgentId = { ...progress, agentId };
      this.emit('progress', progressWithAgentId);
    });

    // Forward user_message_queued events
    agent.on('user_message_queued', (data: any) => {
      this.emit('user_message_queued', { agentId, ...data });
    });

    // Forward message events for real-time display
    agent.on('message', (data: any) => {
      this.emit('message', { agentId, ...data });
    });

    // Forward tool_call events for real-time display
    agent.on('tool_call', (data: any) => {
      this.emit('tool_call', { agentId, ...data });
    });

    // Forward tool_result events for real-time display
    agent.on('tool_result', (data: any) => {
      this.emit('tool_result', { agentId, ...data });
    });

    // Add to queue (will wait for slot)
    const queueConfig = {
      name: agentId,
      task: config.task,
      systemPrompt: config.systemPrompt,
      maxIterations: config.maxIterations,
      workingDirectory: config.workingDirectory,
      allowUserInput: config.allowUserInput,
    };

    const promise = this.agentQueue.addToQueue(queueConfig).then((result) => {
      this.activeAgents.delete(agentId);
      this.completedAgents.set(agentId, result);
      this.agentInstances.delete(agentId);
      this.emit('completed', { agentId, result });
      return result;
    });

    this.activeAgents.set(agentId, promise);

    return agentId;
  }

  // Send a message to a running subagent
  sendUserMessage(agentId: string, message: string): void {
    const agent = this.agentInstances.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found or not running: ${agentId}`);
    }
    agent.queueUserMessage(message);
  }

  // Send a message and wait for response from a running subagent
  async sendUserMessageAndWait(agentId: string, message: string, timeout?: number): Promise<string> {
    const agent = this.agentInstances.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found or not running: ${agentId}`);
    }
    return agent.sendUserMessage(message, timeout);
  }

  // Get progress of an active agent
  getProgress(agentId: string): SubAgentProgress | null {
    const agent = this.agentInstances.get(agentId);
    return agent?.getProgress() || null;
  }

  // Get all active agents with their progress
  getAllProgress(): Map<string, SubAgentProgress> {
    const progress = new Map<string, SubAgentProgress>();
    for (const [agentId, agent] of this.agentInstances.entries()) {
      progress.set(agentId, agent.getProgress());
    }
    return progress;
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

  getQueueStatus() {
    return this.agentQueue.getStatus();
  }

  /**
   * Wait for all active background subagents to complete
   */
  async waitForAll(): Promise<void> {
    const activeIds = this.listActive();
    if (activeIds.length === 0) {
      return;
    }

    // Wait for all active agents to complete
    await Promise.all(activeIds.map(id => this.wait(id).catch(() => {
      // Ignore errors - we just want to wait for completion
    })));
  }

  // Shutdown all running subagents
  async shutdown(): Promise<void> {
    await this.agentQueue.shutdown();
  }
}
