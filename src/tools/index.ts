// Tool Registry

import type { Tool, ToolDefinition } from './types.js';
import { CreateFileTool } from './create-file.js';
import { PatchFileTool } from './patch-file.js';
import { ReadFileTool } from './read-file.js';
import { ExecuteBashTool } from './execute-bash.js';
import { ListFilesTool } from './list-files.js';
import { ParallelTool } from './parallel-tool.js';
import { SpawnAgentTool, WaitAgentTool, ListAgentsTool, GetAgentQueueStatusTool } from './subagent-tool.js';
import { CreateTaskTool, UpdateTaskStatusTool, SetCurrentTaskTool, ListTasksTool, ListSubtasksTool, BreakDownTaskTool, ReviewTrackingItemTool, CloseTrackingItemTool, ListTrackingItemsTool } from './task-management-tool.js';
import { SummarizeContextTool, ExtractFocusTool, MergeContextTool } from './context-management-tool.js';
import { AddDecisionTool, GetDecisionsTool, SupersedeDecisionTool } from './decision-management-tool.js';
import { SetTaskComplexityTool, ReportTaskComplexityTool, GetComplexityInsightsTool } from './task-complexity-tool.js';
import type { SubAgentManager } from '../agent/subagent.js';
import type { MemoryStore } from '../memory/types.js';

import type { HookRegistry } from '../hooks/registry.js';
import type { ConversationManager } from '../agent/conversation.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private subAgentManager?: SubAgentManager;
  private hookRegistry?: HookRegistry;
  private conversation?: ConversationManager;

  constructor() {
    this.registerDefaultTools();
  }

  // Set execution context for tools that need hooks/tracking
  setExecutionContext(hookRegistry?: HookRegistry, conversation?: ConversationManager): void {
    this.hookRegistry = hookRegistry;
    this.conversation = conversation;

    // Update ParallelTool with new context
    const parallelTool = this.get('parallel');
    if (parallelTool && 'setExecutionContext' in parallelTool) {
      (parallelTool as any).setExecutionContext(hookRegistry, conversation);
    }
  }

  private registerDefaultTools(): void {
    this.register(new CreateFileTool());
    this.register(new PatchFileTool());
    this.register(new ReadFileTool());
    this.register(new ExecuteBashTool());
    this.register(new ListFilesTool());
    this.register(new ParallelTool(this)); // Parallel tool needs registry reference
  }

  // Register subagent tools once the manager is available
  registerSubAgentTools(manager: SubAgentManager, memoryStore?: MemoryStore): void {
    this.subAgentManager = manager;
    if (memoryStore) {
      this.register(new SpawnAgentTool(manager, memoryStore));
    } else {
      this.register(new SpawnAgentTool(manager));
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
    this.register(new ListSubtasksTool(memoryStore));
    this.register(new BreakDownTaskTool(memoryStore));
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

  async execute(name: string, args: Record<string, any>) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(args);
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();

// Re-export types
export * from './types.js';
export * from './base-tool.js';
