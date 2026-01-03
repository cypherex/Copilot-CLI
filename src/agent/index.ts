// Agent orchestrator

import { AuthManager } from '../auth/index.js';
import { createLLMClient, getProviderDisplayName } from '../llm/provider-factory.js';
import { ToolRegistry } from '../tools/index.js';
import { ConversationManager } from './conversation.js';
import { AgenticLoop } from './loop.js';
import { SubAgentManager } from './subagent.js';
import { buildSystemPrompt } from './system-prompt.js';
import { HookRegistry } from '../hooks/registry.js';
import { PluginRegistry, RalphWiggumPlugin } from '../plugins/index.js';
import { CompletionTracker } from '../audit/index.js';
import { PlanningValidator } from './planning-validator.js';
import { ProactiveContextMonitor } from './proactive-context-monitor.js';
import { IncompleteWorkDetector } from './incomplete-work-detector.js';
import { FileRelationshipTracker } from './file-relationship-tracker.js';
import { WorkContinuityManager } from './work-continuity-manager.js';
import type { AuthConfig } from '../auth/types.js';
import type { LLMConfig, LLMClient } from '../llm/types.js';
import type { CompletionTrackerConfig } from '../audit/types.js';

export class CopilotAgent {
  private authManager: AuthManager | null = null;
  private llmClient: LLMClient;
  private conversation: ConversationManager;
  private loop: AgenticLoop;
  private toolRegistry: ToolRegistry;
  private subAgentManager: SubAgentManager;
  private hookRegistry: HookRegistry;
  private pluginRegistry: PluginRegistry;
  private completionTracker: CompletionTracker;
  private llmConfig: LLMConfig;
  private workingDirectory: string;

  constructor(
    authConfig: AuthConfig,
    llmConfig: LLMConfig,
    workingDirectory: string = process.cwd(),
    trackerConfig?: Partial<CompletionTrackerConfig>
  ) {
    this.llmConfig = llmConfig;
    this.workingDirectory = workingDirectory;

    // Only create AuthManager for Copilot provider
    if (llmConfig.provider === 'copilot') {
      this.authManager = new AuthManager(authConfig);
    }

    // Create the appropriate LLM client
    this.llmClient = createLLMClient({
      config: llmConfig,
      authManager: this.authManager ?? undefined,
    });

    this.toolRegistry = new ToolRegistry();

    // Initialize conversation first so we can get the memory store
    const systemPrompt = buildSystemPrompt(workingDirectory);
    this.conversation = new ConversationManager(systemPrompt, {
      workingDirectory,
      enableSmartMemory: true,
      contextConfig: {
        verbose: false,
      },
    });

    // Set LLM client for context compression
    this.conversation.setLLMClient(this.llmClient);

    // Set model-specific context limits
    if (llmConfig.model) {
      this.conversation.setModelContextLimit(llmConfig.model);
    }

    // Register task management tools
    this.toolRegistry.registerTaskManagementTools(this.conversation.getMemoryStore());

    // Register context management tools
    this.toolRegistry.registerContextManagementTools(this.conversation.getMemoryStore());

    // Register decision management tools
    this.toolRegistry.registerDecisionManagementTools(this.conversation.getMemoryStore());

    // Register task complexity tools
    this.toolRegistry.registerTaskComplexityTools(this.conversation.getMemoryStore());

    // Initialize hook and plugin registries
    this.hookRegistry = new HookRegistry();
    this.pluginRegistry = new PluginRegistry(this.hookRegistry, this.toolRegistry, workingDirectory);

    // Initialize scaffolding tracker
    this.completionTracker = new CompletionTracker(workingDirectory, trackerConfig);

    // Initialize planning validator
    const planningValidator = new PlanningValidator(this.conversation.getMemoryStore());

    // Initialize proactive context monitor for context warnings
    const proactiveContextMonitor = new ProactiveContextMonitor(
      this.conversation,
      {
        warningThreshold: 70,
        criticalThreshold: 85,
        cooldownPeriod: 60000, // 1 minute between warnings
      }
    );

    // Initialize incomplete work detector for catching unfinished tasks
    const incompleteWorkDetector = new IncompleteWorkDetector(
      this.conversation.getMemoryStore(),
      this.llmClient
    );

    // Initialize file relationship tracker for smart file suggestions
    const fileRelationshipTracker = new FileRelationshipTracker();

    // Initialize work continuity manager for session resume
    const workContinuityManager = new WorkContinuityManager(this.conversation.getMemoryStore());

    // Create SubAgentManager with all infrastructure and register subagent tools
    this.subAgentManager = new SubAgentManager(
      this.llmClient,
      this.toolRegistry,
      5, // maxConcurrency
      this.hookRegistry,
      this.completionTracker,
      planningValidator,
      proactiveContextMonitor,
      incompleteWorkDetector,
      fileRelationshipTracker,
      llmConfig.model // Pass model name for context limit configuration
    );
    this.toolRegistry.registerSubAgentTools(this.subAgentManager, this.conversation.getMemoryStore());

    // Set execution context for parallel tool (hooks + file tracking)
    this.toolRegistry.setExecutionContext(this.hookRegistry, this.conversation);

    this.loop = new AgenticLoop(this.llmClient, this.toolRegistry, this.conversation);
    this.loop.setHookRegistry(this.hookRegistry);
    this.loop.setCompletionTracker(this.completionTracker);
    this.loop.setPlanningValidator(planningValidator);
    this.loop.setProactiveContextMonitor(proactiveContextMonitor);
    this.loop.setIncompleteWorkDetector(incompleteWorkDetector);
    this.loop.setFileRelationshipTracker(fileRelationshipTracker);
    this.loop.setWorkContinuityManager(workContinuityManager);
  }

  async chat(userMessage: string): Promise<void> {
    await this.loop.processUserMessage(userMessage);
  }

  clearConversation(): void {
    this.conversation.clear();
  }

  async initialize(): Promise<void> {
    // Only authenticate for Copilot provider
    if (this.authManager) {
      await this.authManager.getToken();
    }

    // Initialize conversation memory (loads persisted context)
    await this.conversation.initialize();

    // Initialize scaffolding tracker
    this.completionTracker.setLLMClient(this.llmClient);
    await this.completionTracker.load();

    // Load built-in plugins
    await this.pluginRegistry.register(new RalphWiggumPlugin());

    // Execute session:start hook
    await this.hookRegistry.execute('session:start', {
      sessionId: `session_${Date.now()}`,
    });
  }

  async shutdown(): Promise<void> {
    // Shutdown all running subagents first
    await this.subAgentManager.shutdown();

    // Save memory before shutdown
    await this.conversation.saveMemory();

    // Execute session:end hook
    await this.hookRegistry.execute('session:end', {});
  }

  getProviderName(): string {
    return getProviderDisplayName(this.llmConfig.provider);
  }

  getModelName(): string | undefined {
    return this.llmConfig.model;
  }

  // Plugin management
  getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  async executePluginCommand(pluginId: string, command: string, args: string[] = []): Promise<string> {
    return this.pluginRegistry.executeCommand(pluginId, command, args);
  }

  hasPluginCommand(pluginId: string, command: string): boolean {
    return this.pluginRegistry.hasCommand(pluginId, command);
  }

  // Context management
  getContextUsage(): string {
    return this.conversation.getContextUsage();
  }

  getMemorySummary(): string {
    return this.conversation.getMemorySummary();
  }

  async retrieveContext(query: string): Promise<string | null> {
    return this.conversation.retrieveContext(query);
  }

  // Scaffolding tracker management
  getScaffoldingDebt(): string | null {
    const debt = this.completionTracker.getDebt();
    if (debt.critical.length === 0 && debt.stale.length === 0 && debt.recent.length === 0) {
      return null;
    }
    return this.completionTracker.formatDebtDisplay();
  }

  getCompletionTracker(): CompletionTracker {
    return this.completionTracker;
  }

  getMemoryStore(): any {
    return this.conversation.getMemoryStore();
  }

  setMaxIterations(max: number | null): void {
    this.loop.setMaxIterations(max);
  }

  // Task management access
  getPlanningValidator(): PlanningValidator | undefined {
    // Note: This would need to be exposed via the loop
    // For now, we can access it indirectly
    return undefined;
  }

  // Session data management
  loadSessionData(sessionData: any): void {
    // Import session-scoped memory data into conversation
    this.conversation.getMemoryStore().importSessionData(sessionData);
  }

  exportSessionData(): any {
    // Export session-scoped memory data
    return this.conversation.getMemoryStore().exportSessionData();
  }
}
