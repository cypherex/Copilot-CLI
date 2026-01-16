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
import { SpawnValidator } from '../validators/spawn-validator.js';
import { CompletionWorkflowValidator } from '../validators/completion-workflow-validator.js';
import { ErrorHandler, handleError } from '../utils/error-handler.js';
import { TraceRecorder } from '../trace/recorder.js';
import type { AuthConfig } from '../auth/types.js';
import type { LLMConfig, LLMClient } from '../llm/types.js';
import type { CompletionTrackerConfig } from '../audit/types.js';
import type { ToolPolicy } from '../tools/types.js';

export interface AgentRuntimeConfig {
  traceFile?: string;
  evalMode?: boolean;
  allowedTools?: string[];
  seed?: string;
  toolPolicyMode?: ToolPolicy['mode'];
  toolPolicy?: ToolPolicy;
}

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
  private spawnValidator: SpawnValidator;
  private traceRecorder?: TraceRecorder;
  private runtime: { evalMode: boolean; allowedTools?: string[]; toolPolicy?: ToolPolicy; seed?: string };
  private sessionId?: string;

  constructor(
    authConfig: AuthConfig,
    llmConfig: LLMConfig,
    workingDirectory: string = process.cwd(),
    trackerConfig?: Partial<CompletionTrackerConfig>,
    runtimeConfig?: AgentRuntimeConfig
  ) {
    this.llmConfig = llmConfig;
    this.workingDirectory = workingDirectory;

    const evalMode = (runtimeConfig?.evalMode ?? (process.env.COPILOT_CLI_EVAL === '1')) === true;
    const defaultEvalAllowedTools = [
      // Safe file + repo inspection
      'read_file',
      'list_files',
      'grep_repo',
      'apply_unified_diff',
      // Local edits
      'create_file',
      'patch_file',
      // Local validation
      'execute_bash',
      // Optional helpers
      'verify_project',
      'run_repro',
      'parallel',
      // Task tracking (for scoring + governance)
      'create_task',
      'update_task_status',
      'set_current_task',
      'list_tasks',
      'list_subtasks',
      'break_down_task',
      'get_next_tasks',
      'list_tracking_items',
      'review_tracking_item',
      'close_tracking_item',
      'record_experiment_result',
    ];

    const allowedTools = runtimeConfig?.allowedTools ?? (evalMode ? defaultEvalAllowedTools : undefined);

    const envPolicyMode = (process.env.COPILOT_CLI_TOOL_POLICY_MODE as ToolPolicy['mode'] | undefined);
    const policyMode = runtimeConfig?.toolPolicyMode ?? envPolicyMode;
    const toolPolicy: ToolPolicy | undefined =
      runtimeConfig?.toolPolicy ??
      (policyMode ? { mode: policyMode } : undefined) ??
      (evalMode ? { mode: 'eval' } : undefined);

    this.runtime = {
      evalMode,
      allowedTools,
      toolPolicy,
      seed: runtimeConfig?.seed,
    };

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

    if (runtimeConfig?.traceFile) {
      this.traceRecorder = new TraceRecorder(this.hookRegistry, {
        tracePath: runtimeConfig.traceFile,
        evalMode: this.runtime.evalMode,
        seed: this.runtime.seed,
        allowedTools: this.runtime.allowedTools,
        llm: { provider: llmConfig.provider, model: llmConfig.model },
      });
    }

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

    // Initialize spawn validator and completion workflow validator
    this.spawnValidator = new SpawnValidator(this.llmClient);
    const completionWorkflowValidator = new CompletionWorkflowValidator(this.llmClient);

    // Create SubAgentManager with all infrastructure and register subagent tools
    this.subAgentManager = new SubAgentManager(
      this.llmConfig,
      this.toolRegistry,
      5, // maxConcurrency
      this.authManager ?? undefined,
      this.hookRegistry,
      this.completionTracker,
      planningValidator,
      proactiveContextMonitor,
      incompleteWorkDetector,
      fileRelationshipTracker,
      llmConfig.model // Pass model name for context limit configuration
    );
    this.toolRegistry.registerSubAgentTools(this.subAgentManager, this.conversation.getMemoryStore(), this.conversation);

    // Wire validators into tools
    const spawnAgentTool = this.toolRegistry.get('spawn_agent');
    if (spawnAgentTool && 'setValidator' in spawnAgentTool) {
      (spawnAgentTool as any).setValidator(this.spawnValidator);
    }

    const createTaskTool = this.toolRegistry.get('create_task');
    if (createTaskTool && 'setValidator' in createTaskTool) {
      (createTaskTool as any).setValidator(this.spawnValidator);
    }

    const updateTaskStatusTool = this.toolRegistry.get('update_task_status');
    if (updateTaskStatusTool && 'setValidator' in updateTaskStatusTool) {
      (updateTaskStatusTool as any).setValidator(completionWorkflowValidator);
    }

    // Set execution context for parallel tool (hooks + file tracking + auditing)
    this.toolRegistry.setExecutionContext(this.hookRegistry, this.conversation, this.completionTracker, this.llmClient);

    this.loop = new AgenticLoop(this.llmClient, this.toolRegistry, this.conversation);
    this.loop.setHookRegistry(this.hookRegistry);
    this.loop.setCompletionTracker(this.completionTracker);
    this.loop.setPlanningValidator(planningValidator);
    this.loop.setProactiveContextMonitor(proactiveContextMonitor);
    this.loop.setIncompleteWorkDetector(incompleteWorkDetector);
    this.loop.setSubAgentManager(this.subAgentManager);
    this.loop.setFileRelationshipTracker(fileRelationshipTracker);
    this.loop.setWorkContinuityManager(workContinuityManager);
    this.loop.setMemoryStore(this.conversation.getMemoryStore());

    this.loop.setAllowedTools(this.runtime.allowedTools);
    this.loop.setToolPolicy(this.runtime.toolPolicy);
  }

  async chat(userMessage: string): Promise<void> {
    try {
      await this.loop.processUserMessage(userMessage);
    } catch (error) {
      handleError(error, {
        context: "CopilotAgent.chat",
        includeStack: (process.env.NODE_ENV === 'development' || !!process.env.DEBUG),
      });
      throw error;
    }
  }

  clearConversation(): void {
    this.conversation.clear();
  }

  async initialize(): Promise<void> {
    // Trace recorder must be installed before session:start.
    if (this.traceRecorder) {
      await this.traceRecorder.install();
    }

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
    const sessionId = `session_${Date.now()}`;
    this.sessionId = sessionId;
    this.loop.setSessionId(sessionId);
    await this.hookRegistry.execute('session:start', {
      sessionId,
    });
  }

  async shutdown(): Promise<void> {
    // Shutdown all running subagents first
    await this.subAgentManager.shutdown();

    // Save memory before shutdown
    await this.conversation.saveMemory();

    // Execute session:end hook
    await this.hookRegistry.execute('session:end', { sessionId: this.sessionId });
  }

  getProviderName(): string {
    return getProviderDisplayName(this.llmConfig.provider);
  }

  getModelName(): string | undefined {
    return this.llmConfig.model;
  }

  getSubAgentManager(): SubAgentManager {
    return this.subAgentManager;
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

  getConversationMessages(): any[] {
    return this.conversation.getMessages();
  }

  getSpawnValidator(): SpawnValidator {
    return this.spawnValidator;
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
