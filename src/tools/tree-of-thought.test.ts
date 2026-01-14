import { TreeOfThoughtTool } from './tree-of-thought.js';
import type { LLMClient, StreamChunk, ChatCompletionResponse, ChatMessage, ToolDefinition } from '../llm/types.js';

class FakeLLM implements LLMClient {
  async chat(_messages: ChatMessage[], _tools?: ToolDefinition[]): Promise<ChatCompletionResponse> {
    throw new Error('not implemented');
  }

  async *chatStream(_messages: ChatMessage[], _tools?: ToolDefinition[]): AsyncIterable<StreamChunk> {
    const json = JSON.stringify({
      branch: 1,
      hypothesis: 'Root cause X',
      recommended_next: 'Make the smallest safe change',
      verification: ['node --test'],
    });
    yield { delta: { role: 'assistant', content: json } } as any;
    yield { delta: {}, finishReason: 'stop' } as any;
  }
}

describe('TreeOfThoughtTool', () => {
  it('returns a standalone summary when llmClient is provided', async () => {
    const tool = new TreeOfThoughtTool();
    const res = await tool.execute(
      { mode: 'diagnose', problem: 'Test problem', branches: 2, min_iterations: 0, max_iterations: 15 },
      { llmClient: new FakeLLM() as any }
    );

    expect(res.success).toBe(true);
    expect(res.output).toContain('[ToT Standalone Summary]');
    expect(res.output).toContain('Branch Summaries:');
  });

  it('fails if llmClient is missing in tool execution context', async () => {
    const tool = new TreeOfThoughtTool();
    const res = await tool.execute({ mode: 'diagnose', problem: 'Test problem', branches: 2, min_iterations: 0, max_iterations: 15 });
    expect(res.success).toBe(false);
    expect(res.error).toContain('LLM client not available');
  });
});

