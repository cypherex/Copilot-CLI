
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { AgenticLoop } from '../loop.js';
import { ConversationManager } from '../conversation.js';
import { ToolRegistry } from '../../tools/index.js';
import { PlanningValidator } from '../planning-validator.js';
import { IncompleteWorkDetector } from '../incomplete-work-detector.js';
import { uiState } from '../../ui/ui-state.js';
import type { LLMClient, ChatMessage, ChatCompletionResponse, StreamChunk } from '../../llm/types.js';

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
  let toolRegistry: ToolRegistry;
  let conversation: ConversationManager;
  let loop: AgenticLoop;

  beforeEach(async () => {
    uiState.reset();
    mockLLM = new MockLLMClient();
    toolRegistry = new ToolRegistry();
    
    conversation = new ConversationManager('You are a helpful assistant.', {
      workingDirectory: '/test',
      enableSmartMemory: true,
    });
    conversation.setLLMClient(mockLLM);

    toolRegistry.registerTaskManagementTools(conversation.getMemoryStore());
    
    const planningValidator = new PlanningValidator(conversation.getMemoryStore());
    const incompleteWorkDetector = new IncompleteWorkDetector(conversation.getMemoryStore(), mockLLM);

    loop = new AgenticLoop(mockLLM, toolRegistry, conversation);
    loop.setMaxIterations(5);
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
    
        // Start the loop
        await loop.processUserMessage('Check status');
    
        // Verify conversation history
        const messages = conversation.getMessages();
        
        // Debug: log all messages
        console.log('Conversation History:');
        messages.forEach((m, i) => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          console.log(`[${i}] ${m.role}: ${content.substring(0, 100)}`);
        });
    
        // Check for planning validation
        const planningValidation = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Planning Validation Required]'));
        expect(planningValidation).toBeDefined();
    
        // Check for open tasks remaining message
        const openTasksMsg = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('open tasks that need to be completed'));
        expect(openTasksMsg).toBeDefined();
        
        // Verify it reached the end - find the last assistant message
        const assistantMessages = messages.filter(m => m.role === 'assistant');
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
        expect(lastAssistantMsg).toBeDefined();
        expect(lastAssistantMsg.content).toContain('complete now');
      });
  test('Loop continues when agent attempts write operation without active task', async () => {
    const store = conversation.getMemoryStore();
    store.setGoal({ description: 'Test goal' });
    // No active task set
    
    // 1. Mock LLM trying to create a file
    // Note: We need to register create_file or it will fail
    toolRegistry.register({
      definition: { name: 'create_file', description: 'desc', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ success: true, output: 'Created' })
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

    await loop.processUserMessage('Create a file');

    const messages = conversation.getMessages();
    const validationMsg = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[Planning Validation Required]'));
    expect(validationMsg).toBeDefined();
  });
});
