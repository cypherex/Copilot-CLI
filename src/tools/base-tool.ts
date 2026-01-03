// Base Tool abstract class with Zod validation

import { z } from 'zod';
import type { Tool, ToolDefinition, ToolExecutionResult } from './types.js';

export abstract class BaseTool implements Tool {
  abstract readonly definition: ToolDefinition;
  protected abstract readonly schema: z.ZodSchema;

  async execute(args: Record<string, any>): Promise<ToolExecutionResult> {
    try {
      // Validate arguments
      const validatedArgs = this.schema.parse(args);

      // Execute tool logic
      const result = await this.executeInternal(validatedArgs);

      return {
        success: true,
        output: result,
        metadata: this.getMetadata(),
      };
    } catch (error) {
      // Format Zod validation errors with specific field information
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(err => {
          const field = err.path.join('.');
          return `  - ${field}: ${err.message}`;
        }).join('\n');

        return {
          success: false,
          error: `Validation error:\n${fieldErrors}`,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  protected abstract executeInternal(args: any): Promise<string>;

  protected getMetadata(): Record<string, any> {
    return {
      executedAt: new Date().toISOString(),
    };
  }
}
