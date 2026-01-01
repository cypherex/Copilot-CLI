// Hook system types

export type HookType =
  | 'session:start'
  | 'session:end'
  | 'user:prompt-submit'
  | 'tool:pre-execute'
  | 'tool:post-execute'
  | 'assistant:response'
  | 'agent:iteration';

export interface HookContext {
  // Session context
  sessionId?: string;

  // User prompt context
  userMessage?: string;

  // Tool execution context
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: {
    success: boolean;
    output?: string;
    error?: string;
  };

  // Assistant response context
  assistantMessage?: string;
  hasToolCalls?: boolean;

  // Agent iteration context
  iteration?: number;
  maxIterations?: number;

  // Metadata
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface HookResult {
  // Whether to continue with the operation
  continue: boolean;

  // Modified message (for user:prompt-submit)
  modifiedMessage?: string;

  // Modified tool args (for tool:pre-execute)
  modifiedArgs?: Record<string, any>;

  // Additional context to pass along
  metadata?: Record<string, any>;

  // Feedback message to display
  feedback?: string;
}

export type HookHandler = (context: HookContext) => Promise<HookResult> | HookResult;

export interface Hook {
  id: string;
  type: HookType;
  name: string;
  description?: string;
  priority: number; // Lower runs first
  handler: HookHandler;
  enabled: boolean;
  pluginId?: string;
}

export interface HookRegistration {
  type: HookType;
  name: string;
  description?: string;
  priority?: number;
  handler: HookHandler;
}
