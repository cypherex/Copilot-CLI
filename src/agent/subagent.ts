// SubAgent - autonomous agent that can be spawned to handle specific tasks

import { EventEmitter } from 'events';
import type { LLMClient, LLMConfig, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';
import ora from 'ora';
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
  status: 'running' | 'paused' | 'waiting_for_input' | 'completed' | 'failed';
}

export class SubAgent extends EventEmitter {
  private conversation: ConversationManager;
  private maxIterations: number;
  private toolsUsed: Set<string> = new Set();
  private userMessageQueue: string[] = [];
  private userMessageResolvers: Map<number, (message: string) => void> = new Map();
  private messageCounter = 0;

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    private config: SubAgentConfig
  ) {
    super();
    this.config = config;
    const systemPrompt = config.systemPrompt || this.buildDefaultSystemPrompt();
    this.conversation = new ConversationManager(systemPrompt, {
      maxHistoryLength: 30,
      contextConfig: {
        verbose: false,
      },
    });
    this.conversation.setLLMClient(llmClient);
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
        
        // Emit progress update
        this.emit('progress', {
          agentId: this.config.name,
          name: this.config.name,
          iteration,
          maxIterations: this.maxIterations,
          currentTool: undefined,
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
              
              spinner.info(chalk.yellow(`User message: ${message.slice(0, 50)}...`));
              
              // Process the message
              this.conversation.addUserMessage(message);
              
              // Get response and resolve the promise
              const response = await this.getSingleResponse();
              this.conversation.addAssistantMessage(response.content || '');
              
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
            spinner.info(chalk.yellow(`User message: ${queuedMessage.slice(0, 50)}...`));
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

  private async getSingleResponse(): Promise<{ content: string; toolCalls?: any[] }> {
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

import { SubAgentQueue } from './subagent-queue.js';

// SubAgent Manager for tracking and managing multiple subagents with queue
export class SubAgentManager extends EventEmitter {
  private activeAgents: Map<string, Promise<SubAgentResult>> = new Map();
  private completedAgents: Map<string, SubAgentResult> = new Map();
  private agentInstances: Map<string, SubAgent> = new Map();
  private agentCounter = 0;
  private agentQueue: SubAgentQueue;

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    maxConcurrency: number = 5,
    hookRegistry?: HookRegistry,
    completionTracker?: CompletionTracker,
    planningValidator?: PlanningValidator,
    proactiveContextMonitor?: ProactiveContextMonitor,
    incompleteWorkDetector?: IncompleteWorkDetector,
    fileRelationshipTracker?: FileRelationshipTracker
  ) {
    super();
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
      fileRelationshipTracker
    );

    // Forward queue events
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
    const agent = new SubAgent(this.llmClient, this.toolRegistry, {
      ...config,
      name: agentId,
    });

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

  // Shutdown all running subagents
  async shutdown(): Promise<void> {
    await this.agentQueue.shutdown();
  }
}
