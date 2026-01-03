// Parallel Tool - execute multiple tools in parallel

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition, Tool } from './types.js';
import type { ToolRegistry } from './index.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { ConversationManager } from '../agent/conversation.js';
import type { CompletionTracker } from '../audit/index.js';
import { uiState } from '../ui/ui-state.js';
import chalk from 'chalk';
import ora from 'ora';

/**
 * Represents a single tool call in a parallel block
 */
interface ParallelToolCall {
  tool: string;
  parameters: Record<string, any>;
}

// Schema for parallel tool execution
const ParallelSchema = z.object({
  tools: z.array(z.object({
    tool: z.string().describe('The name of the tool to execute'),
    parameters: z.record(z.any()).describe('Parameters for the tool'),
  })).max(10).describe('Array of tool calls to execute in parallel (max 10)'),
  description: z.string().optional().describe('Optional description of what the parallel block is accomplishing'),
});

/**
 * Result of a single parallel tool execution
 */
interface ParallelToolResult {
  tool: string;
  success: boolean;
  output?: string;
  error?: string;
  executionTime: number; // milliseconds
}

/**
 * Overall parallel execution result
 */
interface ParallelResult {
  tools: ParallelToolResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    totalTime: number;
  };
}

export class ParallelTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'parallel',
    description: `Execute multiple tools in parallel and wait for all to complete.

This tool is useful for:
- Reading multiple files simultaneously (faster than sequential)
- Running independent operations that don't depend on each other
- Combining reads with other non-dependent operations
- Executing multiple similar checks at once

Example usage:
{
  "tools": [
    {"tool": "read_file", "parameters": {"path": "src/utils.ts"}},
    {"tool": "read_file", "parameters": {"path": "src/config.ts"}},
    {"tool": "spawn_agent", "parameters": {"task": "Investigate the bug", "role": "investigator", "background": false}}
  ],
  "description": "Read files and investigate bug in parallel"
}

All tools will execute concurrently. Results will be returned in the order specified.

Note: Tools that have dependencies should NOT be run in parallel - use sequential execution instead.`,
    parameters: {
      type: 'object',
      properties: {
        tools: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              parameters: { type: 'object' },
            },
            required: ['tool', 'parameters'],
          },
          maxItems: 10,
          description: 'Array of tool calls to execute in parallel (max 10)',
        },
        description: {
          type: 'string',
          description: 'Optional description of what the parallel block is accomplishing',
        },
      },
      required: ['tools'],
    },
  };

  protected readonly schema = ParallelSchema;
  private toolRegistry: ToolRegistry;
  private hookRegistry?: HookRegistry;
  private conversation?: ConversationManager;
  private completionTracker?: CompletionTracker;

  constructor(toolRegistry: ToolRegistry) {
    super();
    this.toolRegistry = toolRegistry;
  }

  // Set execution context for hook and tracking support
  setExecutionContext(hookRegistry?: HookRegistry, conversation?: ConversationManager, completionTracker?: CompletionTracker): void {
    this.hookRegistry = hookRegistry;
    this.conversation = conversation;
    this.completionTracker = completionTracker;
  }

  protected async executeInternal(args: z.infer<typeof ParallelSchema>): Promise<string> {
    const { tools: toolCalls, description } = args;

    if (toolCalls.length === 0) {
      return JSON.stringify({
        error: 'No tools specified for parallel execution',
        summary: { total: 0, successful: 0, failed: 0, totalTime: 0 },
        tools: [],
      }, null, 2);
    }

    const startTime = Date.now();
    const executionId = `parallel_${startTime}`;

    // Initialize parallel execution state in UIState
    uiState.update({
      parallelExecution: {
        id: executionId,
        description,
        tools: toolCalls.map((tc, index) => ({
          id: `${executionId}_${index}`,
          tool: tc.tool,
          status: 'pending',
          startTime: Date.now(),
          args: tc.parameters,  // Store arguments
        })),
        startTime,
        isActive: true,
      },
    });

    // Add live-updating message
    uiState.addLiveMessage(executionId, {
      role: 'parallel-status',
      content: '', // Will be rendered from ParallelExecutionRenderer
      timestamp: Date.now(),
      parallelExecutionId: executionId,
    });

    // Create spinner
    const spinner = ora(`Running ${toolCalls.length} tool(s) in parallel...`).start();

    // Execute all tools in parallel
    const toolPromises = toolCalls.map(async (toolCall, index): Promise<ParallelToolResult> => {
      const toolStartTime = Date.now();
      const toolName = toolCall.tool;
      const toolId = `${executionId}_${index}`;
      let toolArgs = toolCall.parameters;

      // Update tool status to running
      const currentState = uiState.getState().parallelExecution;
      if (currentState) {
        uiState.update({
          parallelExecution: {
            ...currentState,
            tools: currentState.tools.map(t =>
              t.id === toolId ? { ...t, status: 'running' } : t
            ),
          },
        });
      }

      try {
        // Execute tool:pre-execute hook
        if (this.hookRegistry) {
          const preResult = await this.hookRegistry.execute('tool:pre-execute', {
            toolName,
            toolArgs,
          });
          if (!preResult.continue) {
            const toolExecutionTime = Date.now() - toolStartTime;
            return {
              tool: toolName,
              success: false,
              error: 'Execution cancelled by hook',
              executionTime: toolExecutionTime,
            };
          }
          if (preResult.modifiedArgs) {
            toolArgs = preResult.modifiedArgs;
          }
        }

        const tool = this.toolRegistry.get(toolName);
        if (!tool) {
          const toolExecutionTime = Date.now() - toolStartTime;
          return {
            tool: toolName,
            success: false,
            error: `Tool not found: ${toolName}`,
            executionTime: toolExecutionTime,
          };
        }

        const result = await tool.execute(toolArgs);
        const toolExecutionTime = Date.now() - toolStartTime;

        // Track file operations in conversation
        if (this.conversation && result.success) {
          // Track file reads
          if (toolName === 'read_file' && toolArgs.path) {
            this.conversation.trackFileRead(toolArgs.path, 'Read by parallel tool');
          }

          // Track file edits
          const memoryStore = this.conversation.getMemoryStore();
          const activeTask = memoryStore.getActiveTask();

          if (toolName === 'create_file' && toolArgs.path) {
            memoryStore.addEditRecord({
              file: toolArgs.path || 'unknown',
              description: toolArgs.overwrite ? 'Overwrote file (parallel)' : 'Created new file (parallel)',
              changeType: toolArgs.overwrite ? 'modify' : 'create',
              afterSnippet: toolArgs.content?.slice(0, 200),
              relatedTaskId: activeTask?.id,
            });
            memoryStore.addActiveFile({
              path: toolArgs.path,
              purpose: 'Created in parallel block',
            });
          } else if (toolName === 'patch_file' && toolArgs.path) {
            memoryStore.addEditRecord({
              file: toolArgs.path || 'unknown',
              description: `Patched (parallel): ${toolArgs.search?.slice(0, 50)}...`,
              changeType: 'modify',
              beforeSnippet: toolArgs.search?.slice(0, 100),
              afterSnippet: toolArgs.replace?.slice(0, 100),
              relatedTaskId: activeTask?.id,
            });
          }

          // Audit file modifications for incomplete scaffolding
          await this.auditFileModification(toolName, toolArgs, result);
        }

        // Execute tool:post-execute hook
        if (this.hookRegistry) {
          await this.hookRegistry.execute('tool:post-execute', {
            toolName,
            toolArgs,
            toolResult: result,
          });
        }

        // Update UIState with completion status
        const finalState = uiState.getState().parallelExecution;
        if (finalState) {
          uiState.update({
            parallelExecution: {
              ...finalState,
              tools: finalState.tools.map(t =>
                t.id === toolId
                  ? {
                      ...t,
                      status: result.success ? 'success' : 'error',
                      endTime: Date.now(),
                      executionTime: toolExecutionTime,
                      error: result.success ? undefined : result.error,
                      output: result.output,  // Store output
                    }
                  : t
              ),
            },
          });
        }

        return {
          tool: toolName,
          success: result.success,
          output: result.success ? result.output : undefined,
          error: result.success ? undefined : result.error,
          executionTime: toolExecutionTime,
        };
      } catch (error) {
        const toolExecutionTime = Date.now() - toolStartTime;
        const errorResult = {
          tool: toolName,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          executionTime: toolExecutionTime,
        };

        // Update UIState with error status
        const finalState = uiState.getState().parallelExecution;
        if (finalState) {
          uiState.update({
            parallelExecution: {
              ...finalState,
              tools: finalState.tools.map(t =>
                t.id === toolId
                  ? {
                      ...t,
                      status: 'error',
                      endTime: Date.now(),
                      executionTime: toolExecutionTime,
                      error: error instanceof Error ? error.message : String(error),
                    }
                  : t
              ),
            },
          });
        }

        // Execute tool:post-execute hook even on error
        if (this.hookRegistry) {
          await this.hookRegistry.execute('tool:post-execute', {
            toolName,
            toolArgs,
            toolResult: errorResult,
          });
        }

        return errorResult;
      }
    });

    // Wait for all tools to complete
    const results = await Promise.all(toolPromises);
    const totalTime = Date.now() - startTime;

    // Update spinner
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    if (failed === 0) {
      spinner.succeed(`All ${toolCalls.length} tool(s) completed successfully in ${totalTime}ms`);
    } else {
      spinner.warn(`${successful}/${toolCalls.length} tools completed (${failed} failed) in ${totalTime}ms`);
    }

    // Mark parallel execution as completed in UIState
    const completedState = uiState.getState().parallelExecution;
    if (completedState) {
      uiState.update({
        parallelExecution: {
          ...completedState,
          endTime: Date.now(),
          isActive: false,
        },
      });

      // Finalize the live message (moves it to static messages)
      uiState.finalizeLiveMessage(executionId);

      // Clear state after a moment
      setTimeout(() => {
        uiState.update({ parallelExecution: null });
      }, 100);
    }

    // Build result object
    const parallelResult: ParallelResult = {
      tools: results,
      summary: {
        total: toolCalls.length,
        successful,
        failed,
        totalTime,
      },
    };

    return JSON.stringify(parallelResult, null, 2);
  }

  /**
   * Audit file modifications for incomplete scaffolding
   */
  private async auditFileModification(
    toolName: string,
    toolArgs: Record<string, any>,
    result: { success: boolean; output?: string; error?: string }
  ): Promise<void> {
    const fileModificationTools = ['create_file', 'patch_file'];
    if (!fileModificationTools.includes(toolName) || !result.success || !this.completionTracker || !this.conversation) {
      return;
    }

    try {
      uiState.addMessage({
        role: 'system',
        content: `🔍 [Parallel] Auditing ${toolName} on ${toolArgs.path || 'unknown'}...`,
        timestamp: Date.now(),
      });

      const context = `Tool: ${toolName} (parallel)\nFile: ${toolArgs.path || 'unknown'}\n${result.output || ''}`;
      const responseId = `parallel_${toolName}_${Date.now()}`;
      const auditResult = await this.completionTracker.auditResponse(context, this.conversation.getMessages(), responseId);

      if (auditResult.newItems.length > 0 || auditResult.resolvedItems.length > 0) {
        // Display audit results
        for (const item of auditResult.newItems) {
          uiState.addMessage({
            role: 'system',
            content: `Tracking: ${item.type} in ${item.file}: ${item.description}`,
            timestamp: Date.now(),
          });
        }
        for (const item of auditResult.resolvedItems) {
          uiState.addMessage({
            role: 'system',
            content: `Resolved: ${item.type} in ${item.file}`,
            timestamp: Date.now(),
          });
        }
      } else {
        uiState.addMessage({
          role: 'system',
          content: `✓ [Parallel] Audit complete: No incomplete scaffolding detected in ${toolArgs.path || 'unknown'}`,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      uiState.addMessage({
        role: 'system',
        content: `⚠️ [Parallel] Scaffolding audit failed: ${errorMsg}`,
        timestamp: Date.now(),
      });
      console.error('[Parallel Scaffold Audit] Failed:', error);
    }
  }

  /**
   * Validate that tools can be safely run in parallel
   * Checks for obvious dependencies (e.g., writing to the same file)
   */
  private validateParallelSafety(toolCalls: ParallelToolCall[]): { safe: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check for multiple write operations to the same file
    const writeTargets: Record<string, string[]> = {}; // tool -> file

    for (const call of toolCalls) {
      if (call.tool === 'patch_file' && 'path' in call.parameters) {
        const path = call.parameters.path;
        if (!writeTargets[path]) writeTargets[path] = [];
        writeTargets[path].push(call.tool);
      }

      if (call.tool === 'create_file' && 'path' in call.parameters) {
        const path = call.parameters.path;
        if (!writeTargets[path]) writeTargets[path] = [];
        writeTargets[path].push(call.tool);
      }
    }

    // Warn about potential conflicts
    for (const [path, tools] of Object.entries(writeTargets)) {
      if (tools.length > 1) {
        warnings.push(`Multiple write operations targeting the same file: ${path} (${tools.join(', ')})`);
      }
    }

    return {
      safe: warnings.length === 0,
      warnings,
    };
  }
}
