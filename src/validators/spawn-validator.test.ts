// SpawnValidator tests

import { SpawnValidator } from './spawn-validator.js';
import type { LLMClient } from '../llm/types.js';
import type { MemoryStore } from '../memory/types.js';

describe('SpawnValidator', () => {
  let mockLLMClient: LLMClient;
  let mockMemoryStore: MemoryStore;
  let validator: SpawnValidator;

  beforeEach(() => {
    // Mock LLM client
    mockLLMClient = {
      chat: jest.fn(),
      chatStream: jest.fn(),
    } as any;

    // Mock memory store
    mockMemoryStore = {
      getTasks: jest.fn(() => []),
      getGoal: jest.fn(() => undefined),
    } as any;

    validator = new SpawnValidator(mockLLMClient);
  });

  describe('validateSpawn', () => {
    it('should allow spawn when parent_task_id is provided and valid', async () => {
      const parentTask = {
        id: 'task-123',
        description: 'Parent task',
        status: 'active',
        relatedFiles: [],
        priority: 'high',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockMemoryStore.getTasks as any).mockReturnValue([parentTask]);

      const result = await validator.validateSpawn({
        task: 'Implement login endpoint',
        parent_task_id: 'task-123',
        memoryStore: mockMemoryStore,
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresBreakdown).toBe(false);
      expect(result.reason).toContain('Subtask spawn allowed');
    });

    it('should reject spawn when parent_task_id is invalid', async () => {
      (mockMemoryStore.getTasks as any).mockReturnValue([]);

      const result = await validator.validateSpawn({
        task: 'Implement login endpoint',
        parent_task_id: 'invalid-task-id',
        memoryStore: mockMemoryStore,
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresBreakdown).toBe(false);
      expect(result.reason).toContain('Parent task not found');
    });

    it('should allow spawn for simple tasks', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rating: 'simple',
                evidence: {
                  filesCount: 1,
                  functionsEstimate: 2,
                  linesEstimate: 30,
                  integrationPoints: [],
                  hasMultipleSteps: false,
                  requiresCoordination: false,
                },
                reasoning: 'Single file, minimal complexity',
              }),
            },
          },
        ],
      });

      const result = await validator.validateSpawn({
        task: 'Add validation to email field',
        memoryStore: mockMemoryStore,
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresBreakdown).toBe(false);
      expect(result.complexity?.rating).toBe('simple');
    });

    it('should allow spawn for moderate tasks', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rating: 'moderate',
                evidence: {
                  filesCount: 2,
                  functionsEstimate: 4,
                  linesEstimate: 100,
                  integrationPoints: ['API endpoint'],
                  hasMultipleSteps: true,
                  requiresCoordination: false,
                },
                reasoning: 'Moderate complexity with clear scope',
              }),
            },
          },
        ],
      });

      const result = await validator.validateSpawn({
        task: 'Implement user profile endpoint',
        memoryStore: mockMemoryStore,
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresBreakdown).toBe(false);
      expect(result.complexity?.rating).toBe('moderate');
    });

    it('should require breakdown for complex tasks', async () => {
      // Mock complexity assessment
      (mockLLMClient.chat as any).mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rating: 'complex',
                evidence: {
                  filesCount: 8,
                  functionsEstimate: 20,
                  linesEstimate: 500,
                  integrationPoints: ['Database', 'API', 'Auth Service'],
                  hasMultipleSteps: true,
                  requiresCoordination: true,
                },
                reasoning: 'Complex multi-component system',
              }),
            },
          },
        ],
      });

      // Mock breakdown decision
      (mockLLMClient.chat as any).mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                required: true,
                reasoning: 'Task involves multiple systems and requires coordination',
                suggestedSubtasks: [
                  'Design database schema',
                  'Implement authentication middleware',
                  'Create API endpoints',
                  'Add integration tests',
                ],
                integrationConsiderations: [
                  'Ensure auth service integration',
                  'Database migration strategy',
                ],
              }),
            },
          },
        ],
      });

      const result = await validator.validateSpawn({
        task: 'Implement complete authentication system',
        memoryStore: mockMemoryStore,
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresBreakdown).toBe(true);
      expect(result.complexity?.rating).toBe('complex');
      expect(result.breakdownDecision?.required).toBe(true);
      expect(result.suggestedMessage).toContain('Task Breakdown Required');
    });

    it('should handle LLM parsing failures gracefully', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Invalid JSON response',
            },
          },
        ],
      });

      const result = await validator.validateSpawn({
        task: 'Some task',
        memoryStore: mockMemoryStore,
      });

      // Should default to moderate and not block
      expect(result.allowed).toBe(true);
      expect(result.complexity?.rating).toBe('moderate');
    });
  });

  describe('assessTaskComplexity', () => {
    it('should parse valid complexity assessment', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                rating: 'complex',
                evidence: {
                  filesCount: 5,
                  functionsEstimate: 10,
                  linesEstimate: 300,
                  integrationPoints: ['Database'],
                  hasMultipleSteps: true,
                  requiresCoordination: true,
                },
                reasoning: 'Multiple files and integration points',
              }),
            },
          },
        ],
      });

      const result = await validator.assessTaskComplexity('Build user management system');

      expect(result.rating).toBe('complex');
      expect(result.evidence.filesCount).toBe(5);
      expect(result.reasoning).toBe('Multiple files and integration points');
    });

    it('should handle fallback on parse failure', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Not JSON',
            },
          },
        ],
      });

      const result = await validator.assessTaskComplexity('Some task');

      expect(result.rating).toBe('moderate');
      expect(result.reasoning).toContain('Failed to parse');
    });
  });

  describe('shouldRequireBreakdown', () => {
    it('should parse valid breakdown decision', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                required: true,
                reasoning: 'Too many moving parts',
                suggestedSubtasks: ['Task 1', 'Task 2', 'Task 3'],
                integrationConsiderations: ['Consider API compatibility'],
              }),
            },
          },
        ],
      });

      const complexity = {
        rating: 'complex' as const,
        evidence: {
          hasMultipleSteps: true,
          requiresCoordination: true,
        },
        reasoning: 'Test',
      };

      const result = await validator.shouldRequireBreakdown(
        'Build feature',
        complexity,
        'Task context'
      );

      expect(result.required).toBe(true);
      expect(result.suggestedSubtasks).toHaveLength(3);
    });

    it('should handle fallback on parse failure', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Invalid',
            },
          },
        ],
      });

      const complexity = {
        rating: 'complex' as const,
        evidence: {
          hasMultipleSteps: true,
          requiresCoordination: true,
        },
        reasoning: 'Test',
      };

      const result = await validator.shouldRequireBreakdown(
        'Build feature',
        complexity,
        'Task context'
      );

      expect(result.required).toBe(true);
      expect(result.reasoning).toContain('Failed to parse');
    });
  });
});
