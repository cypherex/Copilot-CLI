import { AgenticLoop } from '../loop.js';
import { ConversationManager } from '../conversation.js';
import { PlanningValidator } from '../planning-validator.js';
import { IncompleteWorkDetector } from '../incomplete-work-detector.js';
import { uiState } from '../../ui/ui-state.js';
import type { LLMClient, ChatMessage, ChatCompletionResponse, StreamChunk } from '../../llm/types.js';

type ToolExecutionResult = { success: boolean; output?: string; error?: string };

class FakeToolRegistry {
  private tools = new Map<string, { name: string; execute: (args: any, ctx?: any) => Promise<ToolExecutionResult> }>();

  register(tool: { definition: { name: string }; execute: (args: any, ctx?: any) => Promise<ToolExecutionResult> }): void {
    this.tools.set(tool.definition.name, { name: tool.definition.name, execute: tool.execute });
  }

  getDefinitions(): any[] {
    return Array.from(this.tools.keys()).map((name) => ({ name, description: name, parameters: { type: 'object', properties: {} } }));
  }

  async execute(name: string, args: any, ctx?: any): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` };
    }
    return tool.execute(args, ctx);
  }
}

/**
 * Mock LLM client that returns predefined responses
 */
class MockLLMClient implements LLMClient {
  private responseQueue: ChatCompletionResponse[] = [];
  private callIndex = 0;

  queueResponse(response: ChatCompletionResponse): void {
    this.responseQueue.push(response);
  }

  async chat(messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    if (this.callIndex >= this.responseQueue.length) {
      throw new Error('No more mocked responses available');
    }
    return this.responseQueue[this.callIndex++];
  }

  async *chatStream(messages: ChatMessage[]): AsyncIterable<StreamChunk> {
    if (this.callIndex >= this.responseQueue.length) {
      throw new Error('No more mocked responses available');
    }
    const response = this.responseQueue[this.callIndex++];
    const message = response.choices[0]?.message;

    if (message.content) {
      yield { delta: { role: 'assistant', content: message.content } };
    }

    if (message.toolCalls) {
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

  getProviderName(): string { return 'mock'; }
  getModelName(): string { return 'mock-model'; }
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
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  };
}

describe('Completion Validation Test', () => {
  let mockLLM: MockLLMClient;
  let toolRegistry: FakeToolRegistry;
  let conversation: ConversationManager;
  let loop: AgenticLoop;

  beforeEach(async () => {
    uiState.reset();
    mockLLM = new MockLLMClient();
    toolRegistry = new FakeToolRegistry();
    
    conversation = new ConversationManager('You are a helpful assistant.', {
      workingDirectory: '/test',
      enableSmartMemory: true,
    });
    conversation.setLLMClient(mockLLM);

    // Minimal task management tool subset used by these tests
    toolRegistry.register({
      definition: { name: 'create_task' },
      execute: async (args: any, ctx?: any) => {
        const store = ctx?.conversation?.getMemoryStore?.();
        const task = store.addTask({
          description: args.description || 'task',
          status: 'waiting',
          priority: 'medium',
          relatedFiles: [],
        });
        return { success: true, output: JSON.stringify({ task_id: task.id }) };
      },
    });
    toolRegistry.register({
      definition: { name: 'set_current_task' },
      execute: async (args: any, ctx?: any) => {
        const store = ctx?.conversation?.getMemoryStore?.();
        store.updateWorkingState({ currentTask: args.task_id, lastUpdated: new Date() });
        return { success: true, output: 'ok' };
      },
    });
    toolRegistry.register({
      definition: { name: 'update_task_status' },
      execute: async (args: any, ctx?: any) => {
        const store = ctx?.conversation?.getMemoryStore?.();
        store.updateTask(args.task_id, { status: args.status, completionMessage: args.completion_message });
        return { success: true, output: 'ok' };
      },
    });
    
    const planningValidator = new PlanningValidator(conversation.getMemoryStore());
    const incompleteWorkDetector = new IncompleteWorkDetector(conversation.getMemoryStore(), mockLLM);

    loop = new AgenticLoop(mockLLM, toolRegistry as any, conversation);
    loop.setMaxIterations(15);
    loop.setPlanningValidator(planningValidator);
    loop.setIncompleteWorkDetector(incompleteWorkDetector);
    loop.setMemoryStore(conversation.getMemoryStore());

    await conversation.initialize();
  });

  test('Loop continues when agent says "complete" but has open tasks', async () => {
    // 1. Create a task manually in the memory store
    const store = conversation.getMemoryStore();
    store.setGoal({ description: 'Test goal' });
    const task = store.addTask({
      description: 'Open task',
      status: 'waiting',
      priority: 'high',
      relatedToGoal: true,
      relatedFiles: []
    });
    const taskId = task.id;

    // 2. Mock LLM saying it's done without calling any tools
    mockLLM.queueResponse(createResponse("I have finished all the work. Everything is complete."));
    
    // 3. Mock LLM's response to the validation prompt
    mockLLM.queueResponse(createResponse("Oh, I see. I need to set the task as active first.", [
      { name: 'set_current_task', args: { task_id: taskId } },
      { name: 'update_task_status', args: { task_id: taskId, status: 'active' } }
    ]));

    // 4. Mock LLM's response after tool execution - it will try to finish again
    mockLLM.queueResponse(createResponse("Now it is active and I have done the work. I am finished."));

    // 5. Mock LLM's response to "Open tasks remaining" prompt
    mockLLM.queueResponse(createResponse("I will mark it as complete now.", [
      { name: 'update_task_status', args: { task_id: taskId, status: 'pending_verification' } }
    ]));
    
    // 6. Mock LLM marking it complete (after pending_verification)
    mockLLM.queueResponse(createResponse("Verification passed. Marking complete.", [
      { name: 'update_task_status', args: { task_id: taskId, status: 'completed', completion_message: 'Done' } }
    ]));

        // 7. Final finish
        mockLLM.queueResponse(createResponse("All work is truly complete now."));
        
        // Add a few extra just in case of unexpected internal calls
        mockLLM.queueResponse(createResponse("I am sure I am done."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
        mockLLM.queueResponse(createResponse("Confirmed."));
    
        // Start the loop
        await loop.processUserMessage('Check status');
    
        const messages = conversation.getMessages();
    
        // Check for planning validation
        const planningValidation = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Planning Validation Required]'));
        expect(planningValidation).toBeDefined();
    
        // Check for open tasks remaining message
        const openTasksMsg = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('open tasks that need to be completed'));
        expect(openTasksMsg).toBeDefined();
        
        // Ensure the task was driven to completion via tool calls
        const updated = store.getTasks().find((t: any) => t.id === taskId);
        expect(updated?.status).toBe('completed');
      });
  test('Loop continues when agent attempts write operation without active task', async () => {
    const store = conversation.getMemoryStore();
    store.setGoal({ description: 'Test goal' });
    // No active task set
    
    // 1. Mock LLM trying to create a file
    // Register create_file for this test
    toolRegistry.register({
      definition: { name: 'create_file' },
      execute: async () => ({ success: true, output: 'Created' }),
    });

    mockLLM.queueResponse(createResponse("Creating file...", [
      { name: 'create_file', args: { path: 'test.txt', content: 'test' } }
    ]));

    // 2. Mock LLM response to planning validation error
    mockLLM.queueResponse(createResponse("I need to set a task first.", [
      { name: 'create_task', args: { description: 'Create test file' } }
    ]));

    // 3. Final response
    mockLLM.queueResponse(createResponse("Task created."));

    // Extra buffers in case the loop injects follow-ups
    mockLLM.queueResponse(createResponse("Continuing."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));
    mockLLM.queueResponse(createResponse("Done."));

    await loop.processUserMessage('Create a file');

    const messages = conversation.getMessages();
    const validationMsg = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Planning Validation Required]'));
    expect(validationMsg).toBeDefined();
  });
});
