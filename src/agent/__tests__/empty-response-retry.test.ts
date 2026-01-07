import { AgenticLoop } from '../loop.js';
import { ConversationManager } from '../conversation.js';
import { uiState } from '../../ui/ui-state.js';
import type { LLMClient, ChatMessage, ChatCompletionResponse, StreamChunk } from '../../llm/types.js';
import type { ToolExecutionResult } from '../../tools/types.js';
import path from 'path';
import { promises as fs } from 'fs';

class MockLLMClient implements LLMClient {
  private responseQueue: ChatCompletionResponse[] = [];
  private callIndex = 0;

  queueResponse(response: ChatCompletionResponse): void {
    this.responseQueue.push(response);
  }

  async chat(_messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    if (this.callIndex >= this.responseQueue.length) {
      throw new Error('No more mocked responses available');
    }
    return this.responseQueue[this.callIndex++];
  }

  async *chatStream(_messages: ChatMessage[]): AsyncIterable<StreamChunk> {
    if (this.callIndex >= this.responseQueue.length) {
      throw new Error('No more mocked responses available');
    }
    const response = this.responseQueue[this.callIndex++];
    const message = response.choices[0]?.message;

    if (message?.content) {
      yield { delta: { role: 'assistant', content: message.content } };
    }

    if (message?.toolCalls) {
      for (const [index, toolCall] of message.toolCalls.entries()) {
        yield {
          delta: {
            toolCalls: [{
              index,
              id: toolCall.id,
              type: 'function' as const,
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            }],
          },
        };
      }
    }

    yield { delta: {}, finishReason: response.choices[0]?.finishReason };
  }

  getProviderName(): string {
    return 'mock';
  }

  getModelName(): string {
    return 'mock-model';
  }
}

function createResponse(content: string, toolCalls?: Array<{ name: string; args: any }>): ChatCompletionResponse {
  return {
    id: `mock_${Date.now()}`,
    choices: [{
      message: {
        role: 'assistant',
        content,
        toolCalls: toolCalls?.map((tc, idx) => ({
          id: `call_${idx}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      },
      finishReason: 'stop',
    }],
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  };
}

describe('AgenticLoop empty-response retry', () => {
  let tmpDir: string;
  let unsubscribe: (() => void) | undefined;
  let priorCopilotHome: string | undefined;
  const captured: Array<{ role: string; content: string }> = [];

  beforeEach(async () => {
    uiState.reset();
    captured.length = 0;
    unsubscribe = uiState.subscribe((state, changedKeys) => {
      if (changedKeys.includes('pendingMessages') && state.pendingMessages.length > 0) {
        const msgs = uiState.clearPendingMessages();
        for (const msg of msgs) captured.push({ role: msg.role, content: msg.content });
      }
    });

    const root = path.join(process.cwd(), 'testbox', 'tmp');
    await fs.mkdir(root, { recursive: true });
    tmpDir = await fs.mkdtemp(path.join(root, 'copilot-cli-empty-response-'));

    // Keep all on-disk memory/session state inside the workspace for sandboxed test runs.
    priorCopilotHome = process.env.COPILOT_CLI_HOME;
    process.env.COPILOT_CLI_HOME = path.join(tmpDir, 'copilot-cli-home');
  });

  afterEach(async () => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (priorCopilotHome === undefined) {
      delete process.env.COPILOT_CLI_HOME;
    } else {
      process.env.COPILOT_CLI_HOME = priorCopilotHome;
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test('retries when model returns empty content after a tool call', async () => {
    const mockLLM = new MockLLMClient();
    const tools = {
      getDefinitions: () => ([
        {
          name: 'explore_codebase',
          description: 'dummy explore tool',
          parameters: {
            type: 'object',
            properties: { question: { type: 'string' } },
            required: ['question'],
          },
        },
      ]),
      execute: async (toolName: string, _args: any): Promise<ToolExecutionResult> => {
        if (toolName === 'explore_codebase') {
          return { success: true, output: JSON.stringify({ ok: true }) };
        }
        return { success: false, error: `Unknown tool: ${toolName}` };
      },
    } as any;

    const conversation = new ConversationManager('You are a helpful assistant.', {
      workingDirectory: tmpDir,
      enableSmartMemory: false,
    });
    conversation.setLLMClient(mockLLM);

    const loop = new AgenticLoop(mockLLM, tools, conversation);
    loop.setMaxIterations(10);

    await conversation.initialize();

    mockLLM.queueResponse(createResponse(
      "I'll explore the codebase first.",
      [{ name: 'explore_codebase', args: { question: 'best feature' } }]
    ));
    mockLLM.queueResponse(createResponse('', undefined));
    mockLLM.queueResponse(createResponse('Best feature: the task + validation system.', undefined));

    await loop.processUserMessage('Tell me the best feature of this codebase.');

    expect(captured.some(m => m.role === 'system' && m.content.includes('empty response'))).toBe(true);
    expect(captured.some(m => m.role === 'assistant' && m.content.includes('Best feature:'))).toBe(true);
  });
});
