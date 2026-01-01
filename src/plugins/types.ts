// Plugin system types

import type { HookRegistration } from '../hooks/types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { HookRegistry } from '../hooks/registry.js';

export interface PluginContext {
  hookRegistry: HookRegistry;
  toolRegistry: ToolRegistry;
  workingDirectory: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
}

export interface Plugin {
  info: PluginInfo;

  // Called when plugin is loaded
  initialize(context: PluginContext): Promise<void> | void;

  // Called when plugin is unloaded
  destroy?(): Promise<void> | void;

  // Get hooks to register
  getHooks(): HookRegistration[];

  // Plugin-specific commands (optional)
  commands?: Record<string, PluginCommand>;
}

export interface PluginCommand {
  name: string;
  description: string;
  execute: (args: string[]) => Promise<string> | string;
}

export type PluginFactory = () => Plugin;
