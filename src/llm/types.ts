// LLM Client type definitions

export type LLMProvider = 'copilot' | 'zai' | 'ollama';

export interface LLMConfig {
  provider: LLMProvider;
  endpoint: string;
  apiVersion: string;
  apiKey?: string;
  model?: string;
  maxTokens: number;
  temperature: number;
  streamingEnabled: boolean;
  enableThinking?: boolean; // Enable extended thinking/reasoning (GLM, o1, etc.)
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string; // For tool messages
  toolCalls?: ToolCall[]; // For assistant messages with tool calls
  toolCallId?: string; // For tool response messages
  reasoningContent?: string; // Extended thinking/reasoning content (GLM, o1, etc.)
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
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

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: ChatMessage;
    finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  delta: {
    role?: string;
    content?: string;
    reasoningContent?: string;
    toolCalls?: Array<{
      index: number;
      id?: string;
      type?: 'function';
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finishReason?: string;
}

export interface LLMClient {
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatCompletionResponse>;
  chatStream(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): AsyncIterable<StreamChunk>;
}
