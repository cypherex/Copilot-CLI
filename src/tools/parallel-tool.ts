// Parallel Tool - execute multiple tools in parallel

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition, Tool } from './types.js';
import type { ToolRegistry } from './index.js';
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

  constructor(toolRegistry: ToolRegistry) {
    super();
    this.toolRegistry = toolRegistry;
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

    // Display parallel block header
    if (description) {
      console.log(chalk.cyan(`\n🔄 Parallel Block: ${description}`));
    } else {
      console.log(chalk.cyan(`\n🔄 Parallel Block: Executing ${toolCalls.length} tool(s)`));
    }

    // Create spinner
    const spinner = ora(`Running ${toolCalls.length} tool(s) in parallel...`).start();

    const startTime = Date.now();

    // Execute all tools in parallel
    const toolPromises = toolCalls.map(async (toolCall): Promise<ParallelToolResult> => {
      const toolStartTime = Date.now();

      try {
        const tool = this.toolRegistry.get(toolCall.tool);
        if (!tool) {
          const toolExecutionTime = Date.now() - toolStartTime;
          return {
            tool: toolCall.tool,
            success: false,
            error: `Tool not found: ${toolCall.tool}`,
            executionTime: toolExecutionTime,
          };
        }

        const result = await tool.execute(toolCall.parameters);
        const toolExecutionTime = Date.now() - toolStartTime;

        return {
          tool: toolCall.tool,
          success: result.success,
          output: result.success ? result.output : undefined,
          error: result.success ? undefined : result.error,
          executionTime: toolExecutionTime,
        };
      } catch (error) {
        const toolExecutionTime = Date.now() - toolStartTime;
        return {
          tool: toolCall.tool,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          executionTime: toolExecutionTime,
        };
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

    // Display individual tool results
    for (const result of results) {
      if (result.success) {
        console.log(chalk.green(`  ✓ ${result.tool} (${result.executionTime}ms)`));
      } else {
        console.log(chalk.red(`  ✗ ${result.tool} (${result.executionTime}ms): ${result.error}`));
      }
    }

    console.log();

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
