// Hook Registry - manages hook registration and execution

import chalk from 'chalk';
import type { Hook, HookType, HookContext, HookResult, HookRegistration } from './types.js';

export class HookRegistry {
  private hooks: Map<HookType, Hook[]> = new Map();
  private hookCounter = 0;

  register(registration: HookRegistration, pluginId?: string): string {
    const hookId = `hook_${++this.hookCounter}_${Date.now()}`;

    const hook: Hook = {
      id: hookId,
      type: registration.type,
      name: registration.name,
      description: registration.description,
      priority: registration.priority ?? 100,
      handler: registration.handler,
      enabled: true,
      pluginId,
    };

    const existing = this.hooks.get(registration.type) || [];
    existing.push(hook);
    // Sort by priority (lower first)
    existing.sort((a, b) => a.priority - b.priority);
    this.hooks.set(registration.type, existing);

    return hookId;
  }

  unregister(hookId: string): boolean {
    for (const [type, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex(h => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  unregisterByPlugin(pluginId: string): number {
    let count = 0;
    for (const [type, hooks] of this.hooks.entries()) {
      const filtered = hooks.filter(h => {
        if (h.pluginId === pluginId) {
          count++;
          return false;
        }
        return true;
      });
      this.hooks.set(type, filtered);
    }
    return count;
  }

  enable(hookId: string): boolean {
    const hook = this.findHook(hookId);
    if (hook) {
      hook.enabled = true;
      return true;
    }
    return false;
  }

  disable(hookId: string): boolean {
    const hook = this.findHook(hookId);
    if (hook) {
      hook.enabled = false;
      return true;
    }
    return false;
  }

  private findHook(hookId: string): Hook | undefined {
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find(h => h.id === hookId);
      if (hook) return hook;
    }
    return undefined;
  }

  async execute(type: HookType, context: Partial<HookContext>): Promise<HookResult> {
    const hooks = this.hooks.get(type) || [];
    const enabledHooks = hooks.filter(h => h.enabled);

    const fullContext: HookContext = {
      ...context,
      timestamp: new Date(),
    };

    let result: HookResult = { continue: true };

    for (const hook of enabledHooks) {
      try {
        const hookResult = await hook.handler(fullContext);

        // Merge results
        result = {
          continue: result.continue && hookResult.continue,
          modifiedMessage: hookResult.modifiedMessage ?? result.modifiedMessage,
          modifiedArgs: hookResult.modifiedArgs ?? result.modifiedArgs,
          metadata: { ...result.metadata, ...hookResult.metadata },
          feedback: hookResult.feedback ?? result.feedback,
        };

        // Display feedback if provided
        if (hookResult.feedback) {
          console.log(chalk.yellow(`[${hook.name}] ${hookResult.feedback}`));
        }

        // Stop chain if continue is false
        if (!hookResult.continue) {
          break;
        }
      } catch (error) {
        console.error(chalk.red(`Hook error [${hook.name}]: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    return result;
  }

  getHooks(type?: HookType): Hook[] {
    if (type) {
      return [...(this.hooks.get(type) || [])];
    }

    const allHooks: Hook[] = [];
    for (const hooks of this.hooks.values()) {
      allHooks.push(...hooks);
    }
    return allHooks;
  }

  getHooksByPlugin(pluginId: string): Hook[] {
    const allHooks: Hook[] = [];
    for (const hooks of this.hooks.values()) {
      allHooks.push(...hooks.filter(h => h.pluginId === pluginId));
    }
    return allHooks;
  }

  clear(): void {
    this.hooks.clear();
  }
}

// Export singleton instance
export const hookRegistry = new HookRegistry();
