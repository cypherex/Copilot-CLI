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

      // Mock moderate complexity for subtask
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              rating: 'moderate',
              evidence: {
                filesCount: 2,
                functionsEstimate: 3,
                linesEstimate: 100,
                integrationPoints: [],
                hasMultipleSteps: false,
                requiresCoordination: false,
              },
              reasoning: 'Moderate subtask',
            }),
          },
        }],
      });

      const result = await validator.validateSpawn({
        task: 'Implement login endpoint',
        parent_task_id: 'task-123',
        memoryStore: mockMemoryStore,
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresBreakdown).toBe(false);
      expect(result.reason).toContain('spawn allowed');
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
      // Mock addTask for memory store
      const addTaskMock = jest.fn((task) => ({
        ...task,
        id: `task_${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      (mockMemoryStore as any).addTask = addTaskMock;

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
      expect(result.suggestedMessage).toContain('Task Automatically Broken Down');
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

  describe('recursiveBreakdownWithContext', () => {
    beforeEach(() => {
      mockMemoryStore = {
        getTasks: jest.fn(() => []),
        getGoal: jest.fn(() => ({ description: 'Build Flux compiler' })),
        addTask: jest.fn((task) => ({ ...task, id: `task_${Date.now()}`, createdAt: new Date(), updatedAt: new Date() })),
        updateTask: jest.fn(),
        getTaskById: jest.fn(),
        addIntegrationPoint: jest.fn((point) => ({ ...point, id: `int_${Date.now()}`, createdAt: new Date() })),
        getIntegrationPoints: jest.fn(() => []),
        getIntegrationPointsForTask: jest.fn(() => []),
        addDesignDecision: jest.fn((decision) => ({ ...decision, id: `design_${Date.now()}`, createdAt: new Date() })),
        getDesignDecisions: jest.fn(() => []),
        getDesignDecisionsForTask: jest.fn(() => []),
      } as any;
    });

    it('should perform recursive breakdown for complex task', async () => {
      // Mock complexity assessment - complex task
      (mockLLMClient.chat as any)
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                rating: 'complex',
                evidence: {
                  filesCount: 8,
                  functionsEstimate: 20,
                  linesEstimate: 500,
                  integrationPoints: ['parser', 'error handler'],
                  hasMultipleSteps: true,
                  requiresCoordination: true,
                },
                reasoning: 'Lexer is complex with multiple components',
              }),
            },
          }],
        })
        // Mock breakdown analysis
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                requiresBreakdown: true,
                reasoning: 'Lexer has multiple distinct components',
                coverageAnalysis: 'All lexer components covered',
                subtasks: [
                  {
                    description: 'Define token type system',
                    produces: ['Token enum'],
                    consumes: [],
                    covers: 'Token definitions',
                  },
                  {
                    description: 'Implement tokenization engine',
                    produces: ['Tokenizer'],
                    consumes: ['Token enum'],
                    covers: 'Core tokenization',
                  },
                ],
                integrationPoints: [
                  {
                    integrates_with: 'Parser',
                    requirement: 'Tokens must include span info',
                    dataContract: 'Token { kind, span }',
                  },
                ],
                designDecisions: [
                  {
                    decision: 'Use zero-copy slices',
                    reasoning: 'Performance',
                    alternatives: ['Copy strings'],
                    affects: ['Tokenizer', 'Parser'],
                    scope: 'module',
                  },
                ],
                missingTasks: [],
              }),
            },
          }],
        })
        // Mock subtask 1 - moderate (ready)
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                rating: 'moderate',
                evidence: {
                  filesCount: 1,
                  functionsEstimate: 3,
                  linesEstimate: 50,
                  integrationPoints: [],
                  hasMultipleSteps: false,
                  requiresCoordination: false,
                },
                reasoning: 'Simple type definitions',
              }),
            },
          }],
        })
        // Mock subtask 2 - moderate (ready)
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                rating: 'moderate',
                evidence: {
                  filesCount: 2,
                  functionsEstimate: 5,
                  linesEstimate: 150,
                  integrationPoints: [],
                  hasMultipleSteps: true,
                  requiresCoordination: false,
                },
                reasoning: 'Tokenizer is well-scoped',
              }),
            },
          }],
        });

      const result = await validator.recursiveBreakdownWithContext(
        'Implement Flux lexer',
        mockMemoryStore,
        { maxDepth: 3 }
      );

      expect(result).toBeDefined();
      expect(result.taskTree.description).toBe('Implement Flux lexer');
      expect(result.taskTree.complexity.rating).toBe('complex');
      expect(result.taskTree.subtasks).toBeDefined();
      expect(result.taskTree.subtasks!.length).toBe(2);

      // Check statistics
      expect(result.totalTasks).toBe(3); // Root + 2 subtasks
      expect(result.readyTasks).toBe(2); // 2 moderate subtasks
      expect(result.breakdownComplete).toBe(true); // All subtasks are ready

      // Check integration points
      expect(result.allIntegrationPoints.length).toBe(1);
      expect(result.allIntegrationPoints[0].requirement).toContain('span');

      // Check design decisions
      expect(result.allDesignDecisions.length).toBe(1);
      expect(result.allDesignDecisions[0].decision).toContain('zero-copy');
    });

    it('should create task hierarchy in memory store', async () => {
      // Mock for single moderate task (no breakdown needed)
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              rating: 'moderate',
              evidence: {
                filesCount: 2,
                functionsEstimate: 3,
                linesEstimate: 100,
                integrationPoints: [],
                hasMultipleSteps: false,
                requiresCoordination: false,
              },
              reasoning: 'Moderate scope',
            }),
          },
        }],
      });

      const result = await validator.recursiveBreakdownWithContext(
        'Add error handling',
        mockMemoryStore,
        { maxDepth: 3 }
      );

      const { rootTaskId, allTaskIds } = validator.createTaskHierarchy(
        result.taskTree,
        mockMemoryStore
      );

      expect(rootTaskId).toBeDefined();
      expect(allTaskIds.length).toBe(1);
      expect(mockMemoryStore.addTask).toHaveBeenCalled();
    });

    it('should handle simple tasks without breakdown', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              rating: 'simple',
              evidence: {
                filesCount: 1,
                functionsEstimate: 1,
                linesEstimate: 20,
                integrationPoints: [],
                hasMultipleSteps: false,
                requiresCoordination: false,
              },
              reasoning: 'Simple task',
            }),
          },
        }],
      });

      const result = await validator.recursiveBreakdownWithContext(
        'Write a unit test',
        mockMemoryStore,
        { maxDepth: 3 }
      );

      expect(result.taskTree.readyToSpawn).toBe(true);
      expect(result.taskTree.subtasks).toBeUndefined();
      expect(result.totalTasks).toBe(1);
      expect(result.breakdownComplete).toBe(true);
    });
  });

  describe('batchAssessComplexity', () => {
    it('should batch assess multiple tasks', async () => {
      (mockLLMClient.chat as any).mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify([
              {
                rating: 'simple',
                evidence: {
                  filesCount: 1,
                  functionsEstimate: 1,
                  linesEstimate: 20,
                  integrationPoints: [],
                  hasMultipleSteps: false,
                  requiresCoordination: false,
                },
                reasoning: 'Simple',
              },
              {
                rating: 'moderate',
                evidence: {
                  filesCount: 2,
                  functionsEstimate: 3,
                  linesEstimate: 100,
                  integrationPoints: [],
                  hasMultipleSteps: true,
                  requiresCoordination: false,
                },
                reasoning: 'Moderate',
              },
            ]),
          },
        }],
      });

      const tasks = ['Write test', 'Add validation'];
      const result = await validator.batchAssessComplexity(tasks);

      expect(result.size).toBe(2);
      expect(result.get('Write test')?.rating).toBe('simple');
      expect(result.get('Add validation')?.rating).toBe('moderate');
    });

    it('should fallback to individual assessment on failure', async () => {
      (mockLLMClient.chat as any)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Invalid JSON' } }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                rating: 'simple',
                evidence: { hasMultipleSteps: false, requiresCoordination: false },
                reasoning: 'Fallback',
              }),
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                rating: 'moderate',
                evidence: { hasMultipleSteps: true, requiresCoordination: false },
                reasoning: 'Fallback',
              }),
            },
          }],
        });

      const tasks = ['Task 1', 'Task 2'];
      const result = await validator.batchAssessComplexity(tasks);

      expect(result.size).toBe(2);
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(3); // 1 failed batch + 2 individual
    });
  });

  describe('validateSpawn with recursive breakdown', () => {
    beforeEach(() => {
      mockMemoryStore = {
        getTasks: jest.fn(() => []),
        getGoal: jest.fn(() => ({ description: 'Build Flux compiler' })),
        addTask: jest.fn((task) => ({ ...task, id: `task_${Date.now()}`, createdAt: new Date(), updatedAt: new Date() })),
        updateTask: jest.fn(),
        getTaskById: jest.fn(),
        addIntegrationPoint: jest.fn((point) => ({ ...point, id: `int_${Date.now()}`, createdAt: new Date() })),
        getIntegrationPoints: jest.fn(() => []),
        getIntegrationPointsForTask: jest.fn(() => []),
        addDesignDecision: jest.fn((decision) => ({ ...decision, id: `design_${Date.now()}`, createdAt: new Date() })),
        getDesignDecisions: jest.fn(() => []),
        getDesignDecisionsForTask: jest.fn(() => []),
      } as any;
    });

    it('should perform full recursive breakdown when enabled', async () => {
      // Mock complex task
      (mockLLMClient.chat as any)
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                rating: 'complex',
                evidence: { filesCount: 5, hasMultipleSteps: true, requiresCoordination: true },
                reasoning: 'Complex',
              }),
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                requiresBreakdown: true,
                reasoning: 'Too complex',
                coverageAnalysis: 'Complete',
                subtasks: [{ description: 'Subtask 1', produces: [], consumes: [], covers: 'Part 1' }],
                integrationPoints: [],
                designDecisions: [],
                missingTasks: [],
              }),
            },
          }],
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                rating: 'simple',
                evidence: { filesCount: 1, hasMultipleSteps: false, requiresCoordination: false },
                reasoning: 'Simple',
              }),
            },
          }],
        });

      const result = await validator.validateSpawn({
        task: 'Build complex feature',
        memoryStore: mockMemoryStore,
        useRecursiveBreakdown: true,
        maxBreakdownDepth: 3,
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresBreakdown).toBe(true);
      expect(result.recursiveBreakdownResult).toBeDefined();
      expect(result.suggestedMessage).toContain('RECURSIVE TASK BREAKDOWN COMPLETE');
      expect(mockMemoryStore.addTask).toHaveBeenCalled();
    });
  });
});
