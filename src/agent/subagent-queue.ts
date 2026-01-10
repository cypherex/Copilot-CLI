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
import { buildAutoToTInstruction, decideAutoToT, recordAutoToT } from './auto-tot.js';
import type { MemoryStore } from '../memory/types.js';
import { SubAgent, type SubAgentResult, type SubAgentConfig } from './subagent-instance.js';
import { createLLMClient } from '../llm/provider-factory.js';
import type { LLMConfig } from '../llm/types.js';
import type { AuthManager } from '../auth/index.js';

export interface QueuedAgent {
  config: SubAgentConfig;
  resolve: (result: SubAgentResult) => void;
  reject: (error: Error) => void;
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
    private llmConfig: LLMConfig,
    private toolRegistry: ToolRegistry,
    private authManager?: AuthManager,
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

    try {
      while (
        this.runningAgents.size < this.maxConcurrency &&
        this.waitingQueue.length > 0 &&
        !this.isShuttingDown
      ) {
        const queuedAgent = this.waitingQueue.shift();
        if (!queuedAgent) continue;

        const agentId = queuedAgent.config.name;

        log.log(`[TRACE] Queue: Starting agent ${agentId} (${this.runningAgents.size + 1}/${this.maxConcurrency} running)`, chalk.cyan);

        // Emit agent_started event
        this.emit('agent_started', { agentId, name: queuedAgent.config.name });

        // Create abort controller for this agent
        const abortController = new AbortController();
        this.runningAgentControllers.set(agentId, abortController);

        // Create a FRESH LLM client for this agent to ensure session isolation
        const llmClient = createLLMClient({
          config: this.llmConfig,
          authManager: this.authManager,
        });

        // Create and execute the subagent with all infrastructure
        const agent = new SubAgent(
          llmClient,
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
            log.log(`[TRACE] Queue: Agent ${agentId} completed (success=${result.success})`, chalk.green);
            this.completedCount++;
            this.emit('agent_completed', { agentId, result });
            queuedAgent.resolve(result);
            return result;
          })
          .catch(error => {
            log.log(`[TRACE] Queue: Agent ${agentId} CRASHED: ${error.message}`, chalk.red);
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
              log.error('Error processing queue: ' + err);
            });
          });

        this.runningAgents.set(agentId, promise);
      }
    } finally {
      // RESET processing flag so new calls to processQueue can evaluate the state
      this.processing = false;
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