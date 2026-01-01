// Plugin Registry - manages plugin lifecycle

import chalk from 'chalk';
import type { Plugin, PluginContext, PluginInfo } from './types.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { ToolRegistry } from '../tools/index.js';

export interface LoadedPlugin {
  plugin: Plugin;
  info: PluginInfo;
  enabled: boolean;
  hookIds: string[];
}

export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private hookRegistry: HookRegistry;
  private toolRegistry: ToolRegistry;
  private workingDirectory: string;

  constructor(hookRegistry: HookRegistry, toolRegistry: ToolRegistry, workingDirectory: string) {
    this.hookRegistry = hookRegistry;
    this.toolRegistry = toolRegistry;
    this.workingDirectory = workingDirectory;
  }

  async register(plugin: Plugin): Promise<void> {
    const { id } = plugin.info;

    if (this.plugins.has(id)) {
      throw new Error(`Plugin already registered: ${id}`);
    }

    const context: PluginContext = {
      hookRegistry: this.hookRegistry,
      toolRegistry: this.toolRegistry,
      workingDirectory: this.workingDirectory,
    };

    // Initialize plugin
    await plugin.initialize(context);

    // Register hooks
    const hookIds: string[] = [];
    for (const hookReg of plugin.getHooks()) {
      const hookId = this.hookRegistry.register(hookReg, id);
      hookIds.push(hookId);
    }

    this.plugins.set(id, {
      plugin,
      info: plugin.info,
      enabled: true,
      hookIds,
    });

    console.log(chalk.green(`Plugin loaded: ${plugin.info.name} v${plugin.info.version}`));
  }

  async unregister(pluginId: string): Promise<boolean> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) {
      return false;
    }

    // Call destroy if available
    if (loaded.plugin.destroy) {
      await loaded.plugin.destroy();
    }

    // Unregister all hooks
    this.hookRegistry.unregisterByPlugin(pluginId);

    this.plugins.delete(pluginId);
    console.log(chalk.yellow(`Plugin unloaded: ${loaded.info.name}`));

    return true;
  }

  enable(pluginId: string): boolean {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) return false;

    loaded.enabled = true;
    for (const hookId of loaded.hookIds) {
      this.hookRegistry.enable(hookId);
    }
    return true;
  }

  disable(pluginId: string): boolean {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) return false;

    loaded.enabled = false;
    for (const hookId of loaded.hookIds) {
      this.hookRegistry.disable(hookId);
    }
    return true;
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getAll(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  list(): PluginInfo[] {
    return Array.from(this.plugins.values()).map(p => p.info);
  }

  executeCommand(pluginId: string, commandName: string, args: string[]): Promise<string> | string {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const command = loaded.plugin.commands?.[commandName];
    if (!command) {
      throw new Error(`Command not found: ${commandName} in plugin ${pluginId}`);
    }

    return command.execute(args);
  }

  hasCommand(pluginId: string, commandName: string): boolean {
    const loaded = this.plugins.get(pluginId);
    return !!loaded?.plugin.commands?.[commandName];
  }
}
