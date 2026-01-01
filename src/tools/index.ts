// Tool Registry

import type { Tool, ToolDefinition } from './types.js';
import { CreateFileTool } from './create-file.js';
import { PatchFileTool } from './patch-file.js';
import { ReadFileTool } from './read-file.js';
import { ExecuteBashTool } from './execute-bash.js';
import { ListFilesTool } from './list-files.js';
import { SpawnAgentTool, WaitAgentTool, ListAgentsTool } from './subagent-tool.js';
import type { SubAgentManager } from '../agent/subagent.js';
import type { MemoryStore } from '../memory/types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private subAgentManager?: SubAgentManager;

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    this.register(new CreateFileTool());
    this.register(new PatchFileTool());
    this.register(new ReadFileTool());
    this.register(new ExecuteBashTool());
    this.register(new ListFilesTool());
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
