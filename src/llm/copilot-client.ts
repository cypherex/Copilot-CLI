// Microsoft 365 Copilot Client via Graph API
import chalk from 'chalk';
// Uses the Copilot Chat API (beta): https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/chat/overview

import type { AuthManager } from '../auth/index.js';
import type {
  LLMClient,
  LLMConfig,
  ChatMessage,
  ChatCompletionResponse,
  StreamChunk,
  ToolDefinition,
} from './types.js';
import { RateLimiter } from './rate-limiter.js';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
const RATE_LIMIT_STATUS_CODE = 429;
const RATE_LIMIT_DELAY_MS = 10000; // 10 seconds

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  let delay = INITIAL_RETRY_DELAY_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      const status = response.status;

      // Check for rate limit (429)
      if (status === RATE_LIMIT_STATUS_CODE) {
        console.warn(chalk.yellow(`Rate limit hit! Waiting ${RATE_LIMIT_DELAY_MS / 1000} seconds before retrying...`));
        await sleep(RATE_LIMIT_DELAY_MS);
        continue;
      }

      // Check if we should retry for other errors
      if (!response.ok && RETRYABLE_STATUS_CODES.includes(status)) {
        if (attempt < maxRetries) {
          // Check for Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;

          console.warn(`API returned ${status}, retrying in ${waitTime}ms...`);
          await sleep(waitTime);
          delay *= 2; // Exponential backoff
          continue;
        }
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        console.warn(`Network error, retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

interface CopilotConversation {
  id: string;
  createdDateTime: string;
  displayName: string;
  state: string;
  turnCount: number;
}

interface CopilotMessage {
  '@odata.type': string;
  id: string;
  text: string;
  createdDateTime: string;
  adaptiveCards?: any[];
  attributions?: any[];
}

interface CopilotChatResponse extends CopilotConversation {
  messages: CopilotMessage[];
}

export class CopilotClient implements LLMClient {
  private conversationId: string | null = null;
  private config: LLMConfig;
  private authManager: AuthManager;
  private rateLimiter: RateLimiter;

  constructor(
    authManager: AuthManager,
    config: LLMConfig
  ) {
    this.authManager = authManager;
    this.config = config;
    this.rateLimiter = new RateLimiter(config.rateLimitInterval || 25);
  }

  private get baseUrl(): string {
    return `${this.config.endpoint}/beta/copilot`;
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken();

    // Debug: decode and print token scopes
    if (process.env.DEBUG_TOKEN) {
      try {
        const parts = token.accessToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
          console.log('\n[DEBUG] Token info:');
          console.log('  aud:', payload.aud);
          console.log('  scp:', payload.scp);
          console.log('  iss:', payload.iss?.slice(0, 50));
        }
      } catch (e) {
        console.log('[DEBUG] Could not decode token');
      }
    }

    return {
      'Authorization': `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a new Copilot conversation
   */
  private async createConversation(): Promise<string> {
    const headers = await this.getAuthHeaders();

    const response = await fetchWithRetry(`${this.baseUrl}/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createApiError(response.status, errorText);
    }

    let data: CopilotConversation;
    try {
      data = await response.json() as CopilotConversation;
    } catch (error) {
      const responseText = await response.text().catch(() => 'Unable to read response');
      throw new Error(`Failed to parse Copilot API response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}. Response: ${responseText}`);
    }

    return data.id;
  }

  /**
   * Ensure we have an active conversation, creating one if needed
   */
  private async ensureConversation(): Promise<string> {
    if (!this.conversationId) {
      this.conversationId = await this.createConversation();
    }
    return this.conversationId;
  }

  /**
   * Build the request body for Copilot Chat API
   * Note: Copilot API uses a different format than OpenAI
   */
  private buildChatRequestBody(
    messages: ChatMessage[],
    _tools?: ToolDefinition[]
  ): any {
    // Get the last user message as the prompt
    // Copilot API doesn't support the full message history directly,
    // we need to use additionalContext for context
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const systemMessages = messages.filter(m => m.role === 'system');
    const contextMessages = messages.filter(m =>
      m.role !== 'user' || m !== lastUserMessage
    ).filter(m => m.role !== 'system');

    // Build additional context from conversation history
    const additionalContext: { text: string }[] = [];

    // Add system message as context
    if (systemMessages.length > 0) {
      additionalContext.push({
        text: `System Instructions:\n${systemMessages.map(m => m.content).join('\n')}`,
      });
    }

    // Add conversation history as context
    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      additionalContext.push({
        text: `Previous conversation:\n${historyText}`,
      });
    }

    // Note: Tool definitions are added to the system context
    // Copilot doesn't have native tool calling like OpenAI, so we handle it via prompts
    if (_tools && _tools.length > 0) {
      const toolDescriptions = _tools.map(t =>
        `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters, null, 2)}`
      ).join('\n');

      additionalContext.push({
        text: `Available tools:\n${toolDescriptions}\n\nTo use a tool, respond with a JSON block: {"tool": "tool_name", "arguments": {...}}`,
      });
    }

    return {
      message: {
        text: lastUserMessage?.content || '',
      },
      locationHint: {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      ...(additionalContext.length > 0 && { additionalContext }),
      contextualResources: {
        webContext: {
          isWebEnabled: true,
        },
      },
    };
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    // Apply rate limiting before making API request
    await this.rateLimiter.acquire();

    const conversationId = await this.ensureConversation();
    const requestBody = this.buildChatRequestBody(messages, tools);
    const headers = await this.getAuthHeaders();

    const response = await fetchWithRetry(
      `${this.baseUrl}/conversations/${conversationId}/chat`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      // If conversation expired, create new one and retry
      if (response.status === 404 || response.status === 410) {
        this.conversationId = null;
        return this.chat(messages, tools);
      }

      throw this.createApiError(response.status, errorText);
    }

    let data: CopilotChatResponse;
    try {
      data = await response.json() as CopilotChatResponse;
    } catch (error) {
      const responseText = await response.text().catch(() => 'Unable to read response');
      throw new Error(`Failed to parse Copilot API response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}. Response: ${responseText}`);
    }

    return this.parseResponse(data, tools);
  }

  async *chatStream(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): AsyncIterable<StreamChunk> {
    // Apply rate limiting before making API request
    await this.rateLimiter.acquire();

    const conversationId = await this.ensureConversation();
    const requestBody = this.buildChatRequestBody(messages, tools);
    const headers = await this.getAuthHeaders();
    headers['Accept'] = 'text/event-stream';

    const response = await fetchWithRetry(
      `${this.baseUrl}/conversations/${conversationId}/chatOverStream`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      // If conversation expired, create new one and retry
      if (response.status === 404 || response.status === 410) {
        this.conversationId = null;
        yield* this.chatStream(messages, tools);
        return;
      }

      throw this.createApiError(response.status, errorText);
    }

    yield* this.parseSSEStream(response, tools);
  }

  private async *parseSSEStream(
    response: Response,
    tools?: ToolDefinition[]
  ): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let lastText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const chunk: CopilotChatResponse = JSON.parse(data);

              // Find the assistant's response message
              const assistantMessage = chunk.messages?.find(
                m => m['@odata.type'] === '#microsoft.graph.copilotConversationResponseMessage'
              );

              if (assistantMessage?.text) {
                // Only emit the new content (delta)
                const newContent = assistantMessage.text.slice(lastText.length);
                lastText = assistantMessage.text;

                if (newContent) {
                  yield {
                    delta: {
                      content: newContent,
                      role: 'assistant',
                    },
                    finishReason: undefined,
                  };
                }
              }
            } catch (e) {
              // Log parsing errors for debugging
              if (data.trim()) {
                console.warn('Failed to parse SSE chunk:', data.slice(0, 100));
              }
            }
          }
        }
      }

      // Final chunk to signal completion
      yield {
        delta: {},
        finishReason: 'stop',
      };

    } finally {
      reader.releaseLock();
    }
  }

  private parseResponse(
    response: CopilotChatResponse,
    tools?: ToolDefinition[]
  ): ChatCompletionResponse {
    // Find the assistant's response message
    const assistantMessage = response.messages?.find(
      m => m['@odata.type'] === '#microsoft.graph.copilotConversationResponseMessage'
    );

    if (!assistantMessage) {
      throw new Error('No response message from Copilot');
    }

    const content = assistantMessage.text || '';

    // Try to parse tool calls from the response
    // Since Copilot doesn't have native tool calling, we parse JSON blocks
    const toolCalls = this.extractToolCalls(content, tools);

    return {
      id: response.id,
      choices: [{
        message: {
          role: 'assistant',
          content: toolCalls.length > 0 ? '' : content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      }],
      usage: undefined,
    };
  }

  /**
   * Extract tool calls from the response text
   * Since Copilot doesn't have native tool calling, we look for JSON blocks
   */
  private extractToolCalls(
    content: string,
    tools?: ToolDefinition[]
  ): any[] {
    if (!tools || tools.length === 0) return [];

    const toolCalls: any[] = [];
    const jsonPattern = /```(?:json)?\s*(\{[\s\S]*?\})\s*```|(\{[\s\S]*?"tool"[\s\S]*?\})/g;

    let match;
    while ((match = jsonPattern.exec(content)) !== null) {
      try {
        const jsonStr = match[1] || match[2];
        const parsed = JSON.parse(jsonStr);

        if (parsed.tool && tools.some(t => t.name === parsed.tool)) {
          toolCalls.push({
            id: `call_${Date.now()}_${toolCalls.length}`,
            type: 'function',
            function: {
              name: parsed.tool,
              arguments: JSON.stringify(parsed.arguments || {}),
            },
          });
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    return toolCalls;
  }

  private createApiError(status: number, errorText: string): Error {
    let message = `Copilot API error (${status})`;

    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error?.message) {
        message = `${message}: ${errorData.error.message}`;
      } else if (errorData.message) {
        message = `${message}: ${errorData.message}`;
      } else {
        message = `${message}: ${errorText}`;
      }
    } catch {
      message = `${message}: ${errorText}`;
    }

    // Add helpful hints for common errors
    if (status === 401) {
      message += '\n\nHint: Your authentication token may have expired. Try running: copilot-cli config --clear-cache';
    } else if (status === 403) {
      message += '\n\nHint: You may not have the required permissions. Ensure you have a Microsoft 365 Copilot license and the required scopes.';
      message += '\nRequired scopes: Sites.Read.All, Mail.Read, People.Read.All, OnlineMeetingTranscript.Read.All, Chat.Read, ChannelMessage.Read.All, ExternalItem.Read.All';
    } else if (status === 404) {
      message += '\n\nHint: The Copilot API endpoint may not be available. Check if your organization has Copilot enabled.';
    } else if (status === 429) {
      message += '\n\nHint: Rate limit exceeded. Wait a moment before retrying.';
    }

    return new Error(message);
  }

  /**
   * Reset the conversation (start fresh)
   */
  resetConversation(): void {
    this.conversationId = null;
  }
}
