// Example usage of SpawnValidator

import { SpawnValidator } from './spawn-validator.js';
import type { LLMClient } from '../llm/types.js';
import type { MemoryStore } from '../memory/types.js';

/**
 * Example: Integrating SpawnValidator into spawn_agent tool
 */
async function exampleUsage(
  llmClient: LLMClient,
  memoryStore: MemoryStore
): Promise<void> {
  // Create validator
  const validator = new SpawnValidator(llmClient);

  // Example 1: Validate a simple task (should allow)
  console.log('Example 1: Simple task');
  const simpleResult = await validator.validateSpawn({
    task: 'Add email validation to login form',
    memoryStore,
  });
  console.log('Simple task result:', simpleResult);
  // Expected: allowed=true, requiresBreakdown=false

  // Example 2: Validate a complex task (may require breakdown)
  console.log('\nExample 2: Complex task');
  const complexResult = await validator.validateSpawn({
    task: 'Implement complete authentication system with OAuth, JWT, and role-based access control',
    memoryStore,
  });
  console.log('Complex task result:', complexResult);
  // Expected: allowed=false, requiresBreakdown=true
  // Will include suggestedMessage with breakdown instructions

  // Example 3: Validate a subtask (should allow)
  console.log('\nExample 3: Subtask with parent_task_id');
  const subtaskResult = await validator.validateSpawn({
    task: 'Create JWT authentication middleware',
    parent_task_id: 'task-123', // Assuming this task exists
    memoryStore,
  });
  console.log('Subtask result:', subtaskResult);
  // Expected: allowed=true, requiresBreakdown=false (bypasses complexity check)
}

/**
 * Example: Integration pattern for spawn_agent tool
 */
async function integrateIntoSpawnTool(
  llmClient: LLMClient,
  memoryStore: MemoryStore,
  task: string,
  parentTaskId?: string
): Promise<string> {
  const validator = new SpawnValidator(llmClient);

  // Validate spawn request
  const result = await validator.validateSpawn({
    task,
    parent_task_id: parentTaskId,
    memoryStore,
  });

  if (!result.allowed) {
    if (result.requiresBreakdown && result.suggestedMessage) {
      // Return the breakdown message to the user
      return result.suggestedMessage;
    }
    return `Spawn blocked: ${result.reason || 'Unknown reason'}`;
  }

  // Proceed with spawning subagent
  console.log('Validation passed - proceeding to spawn subagent');
  console.log('Complexity:', result.complexity?.rating);

  return 'Spawn allowed - proceeding...';
}

/**
 * Example: How validation results look
 */
function exampleValidationResults(): void {
  // Example 1: Simple task allowed
  const simpleTaskResult = {
    allowed: true,
    requiresBreakdown: false,
    complexity: {
      rating: 'simple' as const,
      evidence: {
        filesCount: 1,
        functionsEstimate: 2,
        linesEstimate: 30,
        integrationPoints: [],
        hasMultipleSteps: false,
        requiresCoordination: false,
      },
      reasoning: 'Single file with minimal changes',
    },
    reason: 'Task complexity is simple - spawn allowed',
  };

  // Example 2: Complex task blocked
  const complexTaskResult = {
    allowed: false,
    requiresBreakdown: true,
    complexity: {
      rating: 'complex' as const,
      evidence: {
        filesCount: 8,
        functionsEstimate: 20,
        linesEstimate: 500,
        integrationPoints: ['Database', 'API Gateway', 'Auth Service'],
        hasMultipleSteps: true,
        requiresCoordination: true,
      },
      reasoning: 'Multiple systems with significant integration requirements',
    },
    breakdownDecision: {
      required: true,
      reasoning: 'Task involves multiple systems and requires coordination across components',
      suggestedSubtasks: [
        'Design and implement database schema for users and roles',
        'Create JWT token generation and validation service',
        'Implement OAuth provider integration',
        'Build role-based access control middleware',
        'Add comprehensive authentication tests',
      ],
      integrationConsiderations: [
        'Ensure JWT service can communicate with user database',
        'OAuth callback URLs must be registered with providers',
        'RBAC middleware needs access to role definitions',
      ],
    },
    reason: 'Task is too complex - requires breakdown before spawning subagent',
    suggestedMessage: '... (full breakdown message with instructions) ...',
  };

  // Example 3: Subtask allowed (bypasses complexity check)
  const subtaskResult = {
    allowed: true,
    requiresBreakdown: false,
    reason: 'Subtask spawn allowed (has valid parent task)',
  };

  console.log('Example results:', {
    simpleTaskResult,
    complexTaskResult,
    subtaskResult,
  });
}

/**
 * Example: Assessment methods
 */
async function exampleAssessmentMethods(
  llmClient: LLMClient,
  memoryStore: MemoryStore
): Promise<void> {
  const validator = new SpawnValidator(llmClient);

  // 1. Assess complexity only
  const complexity = await validator.assessTaskComplexity(
    'Build user management dashboard'
  );
  console.log('Complexity assessment:', complexity);

  // 2. Determine if breakdown needed (requires complexity + context)
  const breakdownDecision = await validator.shouldRequireBreakdown(
    'Build user management dashboard',
    complexity,
    'Task context here...'
  );
  console.log('Breakdown decision:', breakdownDecision);
}

// Export examples for documentation
export {
  exampleUsage,
  integrateIntoSpawnTool,
  exampleValidationResults,
  exampleAssessmentMethods,
};
