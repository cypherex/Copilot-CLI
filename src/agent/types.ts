// Agent type definitions

import type { ChatMessage } from '../llm/types.js';

export interface AgentConfig {
  maxIterations: number;
  maxHistoryLength: number;
}

export interface ConversationState {
  messages: ChatMessage[];
  systemPrompt: string;
}
