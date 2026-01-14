// Tool type definitions

import type { ConversationManager } from '../agent/conversation.js';
import type { LLMClient } from '../llm/types.js';

export interface ToolPolicy {
  mode?: 'normal' | 'eval';
  executeBash?: {
    /** If provided, command must match at least one allow pattern (regex as string). */
    allowPatterns?: string[];
    /** If provided, command must NOT match any deny pattern (regex as string). */
    denyPatterns?: string[];
    /** If provided, overrides the tool timeout cap (ms). */
    maxTimeoutMs?: number;
  };
}

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
  llmClient?: LLMClient;
  toolPolicy?: ToolPolicy;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, any>, context?: ToolExecutionContext): Promise<ToolExecutionResult>;
}
