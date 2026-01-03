// OpenAI-compatible client for Z.ai and Ollama

import type {
  LLMClient,
  LLMConfig,
  ChatMessage,
  ChatCompletionResponse,
  StreamChunk,
  ToolDefinition,
} from './types.js';

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

      // Check for rate limit (429)
      if (response.status === RATE_LIMIT_STATUS_CODE) {
        console.warn(`Rate limit hit! Waiting ${RATE_LIMIT_DELAY_MS / 1000} seconds before retrying...`);
        await sleep(RATE_LIMIT_DELAY_MS);
        continue;
      }

      // Check if we should retry for other errors
      if (!response.ok && RETRYABLE_STATUS_CODES.includes(response.status)) {
        if (attempt < maxRetries) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
          console.warn(`API returned ${response.status}, retrying in ${waitTime}ms...`);
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

export class OpenAICompatibleClient implements LLMClient {
  private config: LLMConfig;
  private providerName: string;

  constructor(config: LLMConfig, providerName: string = 'OpenAI-compatible') {
    this.config = config;
    this.providerName = providerName;
  }

  private get chatEndpoint(): string {
    const base = this.config.endpoint.replace(/\/$/, '');
    return `${base}/chat/completions`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private buildRequestBody(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    stream: boolean
  ): any {
    const body: any = {
      model: this.config.model || 'default',
      messages: messages.map((msg) => ({
        role: msg.role,
        content: msg.content || '',
        ...(msg.name && { name: msg.name }),
        ...(msg.toolCalls && { tool_calls: msg.toolCalls }),
        ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
      })),
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    // Add thinking parameter for providers that support it (GLM, o1, etc.)
    if (this.config.enableThinking) {
      body.thinking = {
        type: 'enabled'
      };
    }

    return body;
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<ChatCompletionResponse> {
    const requestBody = this.buildRequestBody(messages, tools, false);

    const response = await fetchWithRetry(this.chatEndpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createApiError(response.status, errorText);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  async *chatStream(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): AsyncIterable<StreamChunk> {
    const requestBody = this.buildRequestBody(messages, tools, true);

    const response = await fetchWithRetry(this.chatEndpoint, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createApiError(response.status, errorText);
    }

    yield* this.parseSSEStream(response);
  }

  private async *parseSSEStream(response: Response): AsyncIterable<StreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

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
            if (data === '[DONE]') return;

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta || {};

              yield {
                delta: {
                  role: delta.role,
                  content: delta.content,
                  toolCalls: delta.tool_calls?.map((tc: any) => ({
                    index: tc.index,
                    id: tc.id,
                    type: tc.type,
                    function: tc.function,
                  })),
                },
                finishReason: chunk.choices?.[0]?.finish_reason,
              };
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseResponse(data: any): ChatCompletionResponse {
    if (!data || !Array.isArray(data.choices)) {
      throw new Error('Invalid API response: missing choices array');
    }

    return {
      id: data.id || 'unknown',
      choices: data.choices.map((choice: any) => ({
        message: {
          role: choice.message?.role || 'assistant',
          content: choice.message?.content || '',
          toolCalls: choice.message?.tool_calls,
        },
        finishReason: choice.finish_reason || 'stop',
      })),
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  private createApiError(status: number, errorText: string): Error {
    let message = `${this.providerName} API error (${status})`;

    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error?.message) {
        message = `${message}: ${errorData.error.message}`;
      } else {
        message = `${message}: ${errorText}`;
      }
    } catch {
      message = `${message}: ${errorText}`;
    }

    if (status === 401) {
      message += '\n\nHint: Check your API key configuration.';
    } else if (status === 404) {
      message += '\n\nHint: Check the endpoint URL and model name.';
    } else if (status === 429) {
      message += '\n\nHint: Rate limit exceeded. Wait a moment before retrying.';
    }

    return new Error(message);
  }
}
