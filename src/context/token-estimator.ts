// Token estimation utility
// Provides approximate token counts for context management

import type { ChatMessage, ToolDefinition } from '../llm/types.js';

// Average characters per token varies by language/content
// English text: ~4 chars/token, code: ~3 chars/token
const CHARS_PER_TOKEN = 3.5;

// Overhead for message structure (role, formatting, etc.)
const MESSAGE_OVERHEAD = 4;

// Tool definition overhead
const TOOL_OVERHEAD = 20;

export interface TokenEstimate {
  tokens: number;
  breakdown: {
    content: number;
    overhead: number;
    toolCalls?: number;
  };
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: ChatMessage): TokenEstimate {
  const contentTokens = estimateTokens(message.content);
  let toolCallTokens = 0;

  if (message.toolCalls) {
    for (const toolCall of message.toolCalls) {
      toolCallTokens += estimateTokens(toolCall.function.name);
      toolCallTokens += estimateTokens(toolCall.function.arguments);
      toolCallTokens += 10; // Tool call structure overhead
    }
  }

  return {
    tokens: contentTokens + MESSAGE_OVERHEAD + toolCallTokens,
    breakdown: {
      content: contentTokens,
      overhead: MESSAGE_OVERHEAD,
      toolCalls: toolCallTokens || undefined,
    },
  };
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, msg) => total + estimateMessageTokens(msg).tokens, 0);
}

export function estimateToolsTokens(tools: ToolDefinition[]): number {
  return tools.reduce((total, tool) => {
    const nameTokens = estimateTokens(tool.name);
    const descTokens = estimateTokens(tool.description);
    const paramsTokens = estimateTokens(JSON.stringify(tool.parameters));
    return total + nameTokens + descTokens + paramsTokens + TOOL_OVERHEAD;
  }, 0);
}

export interface ContextUsage {
  totalTokens: number;
  systemTokens: number;
  conversationTokens: number;
  toolsTokens: number;
  percentUsed: number;
  remainingTokens: number;
}

export function calculateContextUsage(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  maxContextTokens: number
): ContextUsage {
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const systemTokens = systemMessage ? estimateMessageTokens(systemMessage).tokens : 0;
  const conversationTokens = estimateMessagesTokens(conversationMessages);
  const toolsTokens = estimateToolsTokens(tools);
  const totalTokens = systemTokens + conversationTokens + toolsTokens;

  return {
    totalTokens,
    systemTokens,
    conversationTokens,
    toolsTokens,
    percentUsed: (totalTokens / maxContextTokens) * 100,
    remainingTokens: maxContextTokens - totalTokens,
  };
}
