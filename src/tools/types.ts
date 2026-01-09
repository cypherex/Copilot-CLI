// Tool type definitions

import type { ConversationManager } from '../agent/conversation.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ToolExecutionContext {
  conversation?: ConversationManager;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, any>, context?: ToolExecutionContext): Promise<ToolExecutionResult>;
}
