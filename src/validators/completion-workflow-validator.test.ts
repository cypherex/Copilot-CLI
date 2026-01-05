// Tests for CompletionWorkflowValidator

import { CompletionWorkflowValidator } from './completion-workflow-validator.js';
import type { LLMClient, ChatCompletionResponse } from '../llm/types.js';
import type { Task } from '../memory/types.js';

describe('CompletionWorkflowValidator', () => {
  let mockLLMClient: LLMClient;
  let validator: CompletionWorkflowValidator;

  beforeEach(() => {
    mockLLMClient = {
      chat: jest.fn(),
      chatStream: jest.fn(),
    } as any;
    validator = new CompletionWorkflowValidator(mockLLMClient);
  });

  const createTask = (
    id: string,
    description: string,
    status: Task['status'] = 'waiting'
  ): Task => ({
    id,
    description,
    status,
    priority: 'medium',
    relatedFiles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  describe('validateCompletion', () => {
    it('should allow completion when next task is identified', async () => {
      const completedTask = createTask('task1', 'Setup database', 'completed');
      const nextTask = createTask('task2', 'Create API endpoints');
      const allTasks = [completedTask, nextTask];

      // Mock LLM response
      (mockLLMClient.chat as jest.Mock).mockResolvedValue({
        id: 'test',
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              nextTask: {
                nextTaskId: 'task2',
                nextTaskDescription: 'Create API endpoints',
                needsBreakdown: false,
                hasIntegrationDependencies: false,
              },
              workflowContinuity: {
                hasLogicalNext: true,
                reason: 'Database setup completed, API endpoints are next logical step',
              },
            }),
          },
          finishReason: 'stop',
        }],
      } as ChatCompletionResponse);

      const result = await validator.validateCompletion({
        completedTask,
        allTasks,
        completedTaskFiles: ['src/db/schema.ts'],
      });

      expect(result.allowed).toBe(true);
      expect(result.suggestions).toContain('Next recommended task: "Create API endpoints" (ID: task2)');
    });

    it('should allow completion with suggestions when no next task identified but tasks remain', async () => {
      const completedTask = createTask('task1', 'Setup database', 'completed');
      const remainingTask = createTask('task2', 'Create API endpoints');
      const allTasks = [completedTask, remainingTask];

      // Mock LLM response with no next task
      (mockLLMClient.chat as jest.Mock).mockResolvedValue({
        id: 'test',
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              nextTask: null,
              workflowContinuity: {
                hasLogicalNext: false,
                reason: 'Cannot determine logical next step',
              },
            }),
          },
          finishReason: 'stop',
        }],
      } as ChatCompletionResponse);

      const result = await validator.validateCompletion({
        completedTask,
        allTasks,
        completedTaskFiles: ['src/db/schema.ts'],
      });

      expect(result.allowed).toBe(true);
      expect(result.suggestions).toContainEqual(expect.stringContaining('1 tasks remain in the system'));
      expect(result.suggestions).toContainEqual(expect.stringContaining('Cannot determine logical next step'));
    });

    it('should warn when next task needs breakdown', async () => {
      const completedTask = createTask('task1', 'Design API', 'completed');
      const complexTask = createTask('task2', 'Implement entire authentication system');
      const allTasks = [completedTask, complexTask];

      // Mock LLM response indicating breakdown needed
      (mockLLMClient.chat as jest.Mock).mockResolvedValue({
        id: 'test',
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              nextTask: {
                nextTaskId: 'task2',
                nextTaskDescription: 'Implement entire authentication system',
                needsBreakdown: true,
                breakdownReason: 'Authentication system is complex and should be broken into: login, registration, password reset, session management',
                hasIntegrationDependencies: false,
              },
              workflowContinuity: {
                hasLogicalNext: true,
                reason: 'API design complete, authentication is next',
              },
            }),
          },
          finishReason: 'stop',
        }],
      } as ChatCompletionResponse);

      const result = await validator.validateCompletion({
        completedTask,
        allTasks,
        completedTaskFiles: ['docs/api-design.md'],
      });

      expect(result.allowed).toBe(true);
      expect(result.warnings).toContain('Next task "Implement entire authentication system" is complex and should be broken down');
      expect(result.suggestions).toContainEqual(expect.stringContaining('break_down_task'));
    });

    it('should warn about integration dependencies', async () => {
      const completedTask = createTask('task1', 'Create user model', 'completed');
      const nextTask = createTask('task2', 'Add user validation');
      const allTasks = [completedTask, nextTask];

      // Mock LLM response with integration dependencies
      (mockLLMClient.chat as jest.Mock).mockResolvedValue({
        id: 'test',
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              nextTask: {
                nextTaskId: 'task2',
                nextTaskDescription: 'Add user validation',
                needsBreakdown: false,
                hasIntegrationDependencies: true,
                integrationFiles: ['src/models/user.ts', 'src/types/user.ts'],
                reviewTasks: [{
                  taskId: 'task1',
                  description: 'Create user model',
                  reason: 'Need to understand user model structure for validation',
                }],
              },
              workflowContinuity: {
                hasLogicalNext: true,
                reason: 'User model created, validation is natural next step',
              },
            }),
          },
          finishReason: 'stop',
        }],
      } as ChatCompletionResponse);

      const result = await validator.validateCompletion({
        completedTask,
        allTasks,
        completedTaskFiles: ['src/models/user.ts'],
      });

      expect(result.allowed).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('integration dependencies'));
      expect(result.suggestions).toContainEqual(expect.stringContaining('Review these files before starting'));
    });

    it('should handle LLM failures gracefully with fallback', async () => {
      const completedTask = createTask('task1', 'Task 1', 'completed');
      const highPriorityTask = createTask('task2', 'High priority task');
      highPriorityTask.priority = 'high';
      const lowPriorityTask = createTask('task3', 'Low priority task');
      lowPriorityTask.priority = 'low';
      const allTasks = [completedTask, highPriorityTask, lowPriorityTask];

      // Mock LLM failure
      (mockLLMClient.chat as jest.Mock).mockRejectedValue(new Error('LLM error'));

      const result = await validator.validateCompletion({
        completedTask,
        allTasks,
        completedTaskFiles: [],
      });

      // Should use fallback analysis (select by priority)
      expect(result.allowed).toBe(true);
      expect(result.suggestions).toContainEqual(expect.stringContaining('High priority task'));
    });
  });

  describe('analyzeWorkflowState', () => {
    it('should include completed task info in context', async () => {
      const completedTask = createTask('task1', 'Setup database', 'completed');
      completedTask.relatedFiles = ['src/db/schema.ts', 'src/db/migrations.ts'];
      const allTasks = [completedTask];

      (mockLLMClient.chat as jest.Mock).mockResolvedValue({
        id: 'test',
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              nextTask: null,
              workflowContinuity: { hasLogicalNext: false, reason: 'All done' },
            }),
          },
          finishReason: 'stop',
        }],
      } as ChatCompletionResponse);

      await validator.analyzeWorkflowState(completedTask, allTasks, ['src/db/schema.ts']);

      expect(mockLLMClient.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Just Completed Task'),
          }),
        ])
      );
    });

    it('should include task hierarchy in context', async () => {
      const parentTask = createTask('parent', 'Parent task', 'completed');
      const childTask1 = createTask('child1', 'Child task 1', 'completed');
      childTask1.parentId = 'parent';
      const childTask2 = createTask('child2', 'Child task 2', 'waiting');
      childTask2.parentId = 'parent';
      const allTasks = [parentTask, childTask1, childTask2];

      (mockLLMClient.chat as jest.Mock).mockResolvedValue({
        id: 'test',
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              nextTask: null,
              workflowContinuity: { hasLogicalNext: false, reason: 'Done' },
            }),
          },
          finishReason: 'stop',
        }],
      } as ChatCompletionResponse);

      await validator.analyzeWorkflowState(childTask1, allTasks, []);

      const callArgs = (mockLLMClient.chat as jest.Mock).mock.calls[0][0];
      const userMessage = callArgs.find((m: any) => m.role === 'user');
      expect(userMessage?.content).toContain('Task Hierarchy');
    });
  });
});
