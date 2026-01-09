// Tool Registry

import type { Tool, ToolDefinition, ToolExecutionContext } from './types.js';
import { CreateFileTool } from './create-file.js';
import { PatchFileTool } from './patch-file.js';
import { ReadFileTool } from './read-file.js';
import { ExecuteBashTool } from './execute-bash.js';
import { GrepRepoTool } from './grep-repo.js';
import { ListFilesTool } from './list-files.js';
import { UnifiedDiffTool } from './unified-diff-tool.js';
import { ParallelTool } from './parallel-tool.js';
import { SpawnAgentTool, WaitAgentTool, ListAgentsTool, GetAgentQueueStatusTool } from './subagent-tool.js';
import { ExploreCodebaseTool } from './explore-codebase.js';
import { TreeOfThoughtTool } from './tree-of-thought.js';
import { CreateTaskTool, UpdateTaskStatusTool, SetCurrentTaskTool, ListTasksTool, GetNextTasksTool, ListSubtasksTool, BreakDownTaskTool, ReviewTrackingItemTool, CloseTrackingItemTool, ListTrackingItemsTool, DebugScaffoldTool, RecordExperimentResultTool } from './task-management-tool.js';
import { RunReproTool } from './repro-tool.js';
import { VerifyProjectTool } from './verify-tool.js';
import { SummarizeContextTool, ExtractFocusTool, MergeContextTool } from './context-management-tool.js';
import { AddDecisionTool, GetDecisionsTool, SupersedeDecisionTool } from './decision-management-tool.js';
import { SetTaskComplexityTool, ReportTaskComplexityTool, GetComplexityInsightsTool } from './task-complexity-tool.js';
import type { SubAgentManager } from '../agent/subagent.js';
import type { MemoryStore } from '../memory/types.js';

import type { HookRegistry } from '../hooks/registry.js';
import type { ConversationManager } from '../agent/conversation.js';
import type { CompletionTracker } from '../audit/index.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private subAgentManager?: SubAgentManager;
  private hookRegistry?: HookRegistry;
  private conversation?: ConversationManager;
  private completionTracker?: CompletionTracker;

  constructor() {
    this.registerDefaultTools();
  }

  // Set execution context for tools that need hooks/tracking
  setExecutionContext(hookRegistry?: HookRegistry, conversation?: ConversationManager, completionTracker?: CompletionTracker): void {
    this.hookRegistry = hookRegistry;
    this.conversation = conversation;
    this.completionTracker = completionTracker;

    // Update ParallelTool with new context
    const parallelTool = this.get('parallel');
    if (parallelTool && 'setExecutionContext' in parallelTool) {
      (parallelTool as any).setExecutionContext(hookRegistry, conversation, completionTracker);
    }
  }

  private registerDefaultTools(): void {
    this.register(new CreateFileTool());
    this.register(new PatchFileTool());
    this.register(new UnifiedDiffTool());
    this.register(new ReadFileTool());
    this.register(new ExecuteBashTool());
    this.register(new GrepRepoTool());
    this.register(new ListFilesTool());
    this.register(new ParallelTool(this)); // Parallel tool needs registry reference
  }

  // Register subagent tools once the manager is available
  registerSubAgentTools(manager: SubAgentManager, memoryStore?: MemoryStore, conversation?: ConversationManager): void {
    this.subAgentManager = manager;
    if (memoryStore) {
      this.register(new SpawnAgentTool(manager, memoryStore));
      this.register(new ExploreCodebaseTool(manager, memoryStore));
      this.register(new TreeOfThoughtTool(manager, memoryStore, conversation));
    } else {
      this.register(new SpawnAgentTool(manager));
      this.register(new TreeOfThoughtTool(manager, undefined, conversation));
    }
    this.register(new WaitAgentTool(manager));
    this.register(new ListAgentsTool(manager));
    this.register(new GetAgentQueueStatusTool(manager));
  }

  // Register task management tools once memory store is available
  registerTaskManagementTools(memoryStore: MemoryStore): void {
    this.register(new CreateTaskTool(memoryStore));
    this.register(new UpdateTaskStatusTool(memoryStore));
    this.register(new SetCurrentTaskTool(memoryStore));
    this.register(new ListTasksTool(memoryStore));
    this.register(new GetNextTasksTool(memoryStore));
    this.register(new ListSubtasksTool(memoryStore));
    this.register(new BreakDownTaskTool(memoryStore));
    this.register(new DebugScaffoldTool(memoryStore));
    this.register(new RecordExperimentResultTool(memoryStore));
    // SWE-bench helpers
    this.register(new RunReproTool(memoryStore));
    this.register(new VerifyProjectTool(memoryStore));
    // Tracking item tools
    this.register(new ReviewTrackingItemTool(memoryStore));
    this.register(new CloseTrackingItemTool(memoryStore));
    this.register(new ListTrackingItemsTool(memoryStore));
  }

  // Register context management tools once memory store is available
  registerContextManagementTools(memoryStore: MemoryStore): void {
    this.register(new SummarizeContextTool(memoryStore));
    this.register(new ExtractFocusTool(memoryStore));
    this.register(new MergeContextTool(memoryStore));
  }

  // Register decision management tools once memory store is available
  registerDecisionManagementTools(memoryStore: MemoryStore): void {
    this.register(new AddDecisionTool(memoryStore));
    this.register(new GetDecisionsTool(memoryStore));
    this.register(new SupersedeDecisionTool(memoryStore));
  }

  // Register task complexity tools once memory store is available
  registerTaskComplexityTools(memoryStore: MemoryStore): void {
    this.register(new SetTaskComplexityTool(memoryStore));
    this.register(new ReportTaskComplexityTool(memoryStore));
    this.register(new GetComplexityInsightsTool(memoryStore));
  }

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((tool) => tool.definition);
  }

  async execute(name: string, args: Record<string, any>, context?: ToolExecutionContext) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(args, context);
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();

// Re-export types
export * from './types.js';
export * from './base-tool.js';