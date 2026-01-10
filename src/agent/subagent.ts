// SubAgent - autonomous agent that can be spawned to handle specific tasks

import { EventEmitter } from 'events';
import type { ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { CompletionTracker } from '../audit/index.js';
import type { PlanningValidator } from './planning-validator.js';
import type { ProactiveContextMonitor } from './proactive-context-monitor.js';
import type { IncompleteWorkDetector } from './incomplete-work-detector.js';
import type { FileRelationshipTracker } from './file-relationship-tracker.js';
import type { MemoryStore } from '../memory/types.js';
import { SubAgentQueue } from './subagent-queue.js';
import type { SubAgentConfig, SubAgentResult } from './subagent-instance.js';
import type { LLMConfig, LLMClient } from '../llm/types.js';
import type { AuthManager } from '../auth/index.js';

// Re-export SubAgent and types from the centralized instance file
export * from './subagent-instance.js';

// SubAgent Manager for tracking and managing multiple subagents with queue
export class SubAgentManager extends EventEmitter {
  private activeAgents: Map<string, Promise<SubAgentResult>> = new Map();
  private completedAgents: Map<string, SubAgentResult> = new Map();
  private agentCounter = 0;
  private agentQueue: SubAgentQueue;
  private hookRegistry?: HookRegistry;
  private completionTracker?: CompletionTracker;
  private planningValidator?: PlanningValidator;
  private proactiveContextMonitor?: ProactiveContextMonitor;
  private incompleteWorkDetector?: IncompleteWorkDetector;
  private fileRelationshipTracker?: FileRelationshipTracker;

  constructor(
    private llmConfig: LLMConfig,
    private toolRegistry: ToolRegistry,
    maxConcurrency: number = 5,
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
      llmConfig,
      toolRegistry,
      authManager,
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

    // Forward execution events from the real SubAgent in the queue
    this.agentQueue.on('message', (data) => {
      this.emit('message', data);
    });

    this.agentQueue.on('tool_call', (data) => {
      this.emit('tool_call', data);
    });

    this.agentQueue.on('tool_result', (data) => {
      this.emit('tool_result', data);
    });

    this.agentQueue.on('progress', (data) => {
      this.emit('progress', data);
    });
  }

  spawn(config: SubAgentConfig): string {
    const agentId = `agent_${++this.agentCounter}_${Date.now()}`;

    // Add to queue (will wait for slot)
    // The real SubAgent instance is created by the queue when a slot is available
    const queueConfig = {
      name: agentId,
      task: config.task,
      systemPrompt: config.systemPrompt,
      maxIterations: config.maxIterations,
      minIterations: config.minIterations,
      workingDirectory: config.workingDirectory,
      allowedTools: config.allowedTools,
      outputJsonFromReasoning: config.outputJsonFromReasoning,
      memoryStore: config.memoryStore,
    };

    const promise = this.agentQueue.addToQueue(queueConfig).then((result) => {
      this.activeAgents.delete(agentId);
      this.completedAgents.set(agentId, result);
      this.emit('completed', { agentId, result });
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