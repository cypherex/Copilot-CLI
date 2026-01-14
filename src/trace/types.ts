export type AgentEventType =
  | 'trace_header'
  | 'session_start'
  | 'session_end'
  | 'user_prompt_submit'
  | 'agent_iteration'
  | 'assistant_response'
  | 'tool_pre_execute'
  | 'tool_post_execute'
  | 'note';

export interface AgentEventBase {
  type: AgentEventType;
  ts: string; // ISO timestamp
}

export interface TraceHeaderEvent extends AgentEventBase {
  type: 'trace_header';
  argv: string[];
  node: string;
  platform: string;
  cwd: string;
  packageVersion?: string;
  git?: {
    sha?: string;
    branch?: string;
  };
  run?: {
    evalMode?: boolean;
    seed?: string;
    allowedTools?: string[];
  };
  llm?: {
    provider?: string;
    model?: string;
  };
}

export interface SessionStartEvent extends AgentEventBase {
  type: 'session_start';
  sessionId?: string;
}

export interface SessionEndEvent extends AgentEventBase {
  type: 'session_end';
  sessionId?: string;
}

export interface UserPromptSubmitEvent extends AgentEventBase {
  type: 'user_prompt_submit';
  sessionId?: string;
  userMessage?: string;
}

export interface AgentIterationEvent extends AgentEventBase {
  type: 'agent_iteration';
  sessionId?: string;
  iteration?: number;
  maxIterations?: number;
}

export interface AssistantResponseEvent extends AgentEventBase {
  type: 'assistant_response';
  sessionId?: string;
  assistantMessage?: string;
  hasToolCalls?: boolean;
}

export interface ToolPreExecuteEvent extends AgentEventBase {
  type: 'tool_pre_execute';
  sessionId?: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
}

export interface ToolPostExecuteEvent extends AgentEventBase {
  type: 'tool_post_execute';
  sessionId?: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: {
    success: boolean;
    output?: string;
    error?: string;
  };
}

export interface NoteEvent extends AgentEventBase {
  type: 'note';
  message: string;
  data?: any;
}

export type AgentEvent =
  | TraceHeaderEvent
  | SessionStartEvent
  | SessionEndEvent
  | UserPromptSubmitEvent
  | AgentIterationEvent
  | AssistantResponseEvent
  | ToolPreExecuteEvent
  | ToolPostExecuteEvent
  | NoteEvent;
