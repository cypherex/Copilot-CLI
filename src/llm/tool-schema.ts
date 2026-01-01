// Tool schema converter for Microsoft 365 Copilot API

import type { ToolDefinition } from './types.js';

/**
 * Converts internal tool definitions to OpenAI-compatible function schemas
 * for Microsoft 365 Copilot API
 */
export function convertToToolSchema(tool: ToolDefinition): any {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required || [],
      },
    },
  };
}

/**
 * Converts all tools in registry to schemas
 */
export function buildToolSchemas(tools: ToolDefinition[]): any[] {
  return tools.map(convertToToolSchema);
}
