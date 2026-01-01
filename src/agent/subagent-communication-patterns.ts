// Subagent Communication Patterns
// Standardized patterns for orchestrator-subagent communication

export interface SubagentContextPackage {
  focusArea: string;
  minimalContext: string;
  files?: string[];
  tokenBudget: number;
  boundaries: string[];
}

export interface SubagentResultPackage {
  output: string;
  summary: string;
  filesAffected: string[];
  actionItems: string[];
  nextSteps?: string[];
}

export type CommunicationPattern =
  | 'parallel-dispatch'
  | 'sequential-focus'
  | 'investigate-diagnose'
  | 'test-generate'
  | 'refactor-structure';

/**
 * Build a focused context package for spawning a subagent
 */
export function buildContextPackage(
  roleId: string,
  task: string,
  files?: string[],
  memoryStore?: any
): SubagentContextPackage {
  // Context boundaries based on role
  const boundaries: Record<string, string[]> = {
    'test-writer': [
      'Only the files you need to test',
      'Existing test patterns and conventions',
      'Relevant function signatures and interfaces',
    ],
    'investigator': [
      'Only the error and relevant execution context',
      'Files involved in the error path',
      'Recent error messages and stack traces',
    ],
    'refactorer': [
      'Only the code you are refactoring',
      'Direct dependencies and imports',
      'Relevant patterns and conventions',
    ],
    'fixer': [
      'Only the bug and related code',
      'Error messages and reproduction steps',
      'Directly affected code sections',
    ],
    'documenter': [
      'Only the code you are documenting',
      'API signatures and public interfaces',
      'Usage examples from tests',
    ],
  };

  const roleBoundaries = boundaries[roleId] || ['Focus on your assigned task'];

  return {
    focusArea: task,
    minimalContext: extractMinimalContext(task, files, memoryStore),
    files,
    tokenBudget: getTokenBudget(roleId),
    boundaries: roleBoundaries,
  };
}

/**
 * Extract minimal context for a subagent task
 */
function extractMinimalContext(task: string, files?: string[], memoryStore?: any): string {
  const parts: string[] = [];

  parts.push('=== FOCUSED TASK ===');
  parts.push(task);
  parts.push('');

  if (files && files.length > 0) {
    parts.push('=== WORKING FILES ===');
    for (const file of files) {
      parts.push(`• ${file}`);
    }
    parts.push('');
  }

  parts.push('=== CONTEXT BOUNDARIES ===');
  parts.push('You have a focused, minimal context.');
  parts.push('Work efficiently on your assigned task.');
  parts.push('Do not worry about broader project context.');
  parts.push('Focus entirely on completing your specific task.');
  parts.push('');

  return parts.join('\n');
}

/**
 * Get token budget for a role
 */
function getTokenBudget(roleId: string): number {
  const budgets: Record<string, number> = {
    'test-writer': 8000,
    'investigator': 12000,
    'refactorer': 10000,
    'fixer': 10000,
    'documenter': 8000,
  };
  return budgets[roleId] || 8000;
}

/**
 * Parse and validate subagent results
 */
export function parseSubagentResult(rawOutput: string): SubagentResultPackage {
  // Try to extract structured output
  const result: SubagentResultPackage = {
    output: rawOutput,
    summary: '',
    filesAffected: [],
    actionItems: [],
    nextSteps: [],
  };

  // Look for summary markers
  const summaryMatch = rawOutput.match(/(?:Summary|SUMMARY):\s*([^\n]+)/i);
  if (summaryMatch) {
    result.summary = summaryMatch[1].trim();
  } else {
    // Use first line as summary if no explicit marker
    const firstLine = rawOutput.split('\n')[0].trim();
    result.summary = firstLine.substring(0, 200);
  }

  // Look for file mentions
  const fileMatches = rawOutput.matchAll(/(?:file|File|FILE):\s*([^\s,]+)/g);
  for (const match of fileMatches) {
    const file = match[1].trim();
    if (!result.filesAffected.includes(file)) {
      result.filesAffected.push(file);
    }
  }

  // Look for action items
  const actionMatches = rawOutput.matchAll(/[-•*]\s*(.+)/g);
  for (const match of actionMatches) {
    const action = match[1].trim();
    if (action.length > 10) { // Filter out bullets
      result.actionItems.push(action);
    }
  }

  return result;
}

/**
 * Build orchestrator message before spawning subagent
 */
export function buildOrchestratorDispatchMessage(
  pattern: CommunicationPattern,
  subagentTasks: Array<{ task: string; roleId: string; files?: string[] }>
): string {
  const parts: string[] = [];

  switch (pattern) {
    case 'parallel-dispatch':
      parts.push('🚀 Dispatching parallel subagents for focused execution...');
      parts.push('');
      parts.push(`Spawning ${subagentTasks.length} subagents to work independently.`);
      parts.push('Each subagent has minimal, focused context.');
      parts.push('');
      break;

    case 'sequential-focus':
      parts.push('🎯 Focusing subagent on specific task...');
      parts.push('');
      parts.push('Task will be handled with minimal context isolation.');
      parts.push('Subagent will provide focused output for merging.');
      parts.push('');
      break;

    case 'investigate-diagnose':
      parts.push('🔍 Investigating issue with isolated context...');
      parts.push('');
      parts.push('Subagent will focus on root cause analysis.');
      parts.push('Investigation will be methodical and thorough.');
      parts.push('');
      break;

    case 'test-generate':
      parts.push('🧪 Generating tests with focused context...');
      parts.push('');
      parts.push('Test writer will focus on comprehensive coverage.');
      parts.push('Minimal context ensures focused, high-quality tests.');
      parts.push('');
      break;

    case 'refactor-structure':
      parts.push('🏗️ Refactoring with focused context...');
      parts.push('');
      parts.push('Refactorer will improve code structure.');
      parts.push('Changes will be incremental and testable.');
      parts.push('');
      break;
  }

  // List tasks
  parts.push('Tasks:');
  subagentTasks.forEach((st, idx) => {
    parts.push(`  ${idx + 1}. [${st.roleId}] ${st.task}`);
    if (st.files && st.files.length > 0) {
      parts.push(`     Files: ${st.files.join(', ')}`);
    }
  });

  return parts.join('\n');
}

/**
 * Build orchestrator message after subagent completion
 */
export function buildOrchestratorMergeMessage(
  pattern: CommunicationPattern,
  results: Array<{ taskId: string; result: SubagentResultPackage }>
): string {
  const parts: string[] = [];

  switch (pattern) {
    case 'parallel-dispatch':
      parts.push('✅ All parallel subagents completed.');
      parts.push('');
      parts.push(`Merging results from ${results.length} focused tasks.`);
      parts.push('Integrating outputs into coherent understanding.');
      parts.push('');
      break;

    case 'sequential-focus':
      parts.push('✅ Focused task completed.');
      parts.push('');
      parts.push('Merging subagent output back into context.');
      parts.push('Updating orchestrator understanding.');
      parts.push('');
      break;

    case 'investigate-diagnose':
      parts.push('🔍 Investigation complete.');
      parts.push('');
      parts.push('Root cause analysis ready for review.');
      parts.push('Diagnosis and recommendations available.');
      parts.push('');
      break;

    case 'test-generate':
      parts.push('🧪 Test generation complete.');
      parts.push('');
      parts.push('Tests created with focused context.');
      parts.push('Review and run tests to verify coverage.');
      parts.push('');
      break;

    case 'refactor-structure':
      parts.push('🏗️ Refactoring complete.');
      parts.push('');
      parts.push('Code structure improved with focused changes.');
      parts.push('All existing functionality preserved.');
      parts.push('');
      break;
  }

  // Summarize results
  parts.push('Results Summary:');
  results.forEach((r, idx) => {
    parts.push(`  ${idx + 1}. ${r.result.summary}`);
    if (r.result.filesAffected.length > 0) {
      parts.push(`     Modified: ${r.result.filesAffected.join(', ')}`);
    }
  });

  if (results.some(r => r.result.actionItems.length > 0)) {
    parts.push('');
    parts.push('Action Items:');
    results.forEach(r => {
      r.result.actionItems.forEach(item => {
        parts.push(`  • ${item}`);
      });
    });
  }

  return parts.join('\n');
}

/**
 * Get recommended communication pattern for a task
 */
export function getRecommendedPattern(task: string, files?: string[]): CommunicationPattern {
  const taskLower = task.toLowerCase();
  const hasMultipleFiles = files && files.length > 2;

  // Parallel dispatch patterns
  if (taskLower.includes('parallel') || taskLower.includes('simultaneous')) {
    return 'parallel-dispatch';
  }

  if (hasMultipleFiles && taskLower.includes('test')) {
    return 'test-generate';
  }

  if (hasMultipleFiles && taskLower.includes('refactor')) {
    return 'refactor-structure';
  }

  // Sequential focus patterns
  if (taskLower.includes('investigate') || taskLower.includes('diagnose') || taskLower.includes('debug')) {
    return 'investigate-diagnose';
  }

  if (taskLower.includes('test') || taskLower.includes('spec')) {
    return 'test-generate';
  }

  if (taskLower.includes('refactor') || taskLower.includes('restructure') || taskLower.includes('organize')) {
    return 'refactor-structure';
  }

  // Default to sequential focus
  return 'sequential-focus';
}

/**
 * Estimate context token count (rough approximation)
 */
export function estimateTokenCount(text: string): number {
  // Rough approximation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Check if context is getting large and should be summarized
 */
export function shouldSummarizeContext(messages: any[]): boolean {
  const totalChars = messages.reduce((sum, msg) => {
    return sum + (msg.content?.length || 0);
  }, 0);

  const estimatedTokens = estimateTokenCount(totalChars.toString());

  // Suggest summarization if over 15k tokens (~50k characters)
  return estimatedTokens > 15000;
}

/**
 * Build subagent task with focused context
 */
export function buildSubagentTask(
  roleId: string,
  task: string,
  files?: string[],
  pattern?: CommunicationPattern
): string {
  const actualPattern = pattern || getRecommendedPattern(task, files);
  const contextPackage = buildContextPackage(roleId, task, files);

  const parts: string[] = [
    contextPackage.minimalContext,
    '',
    `=== TASK ===`,
    task,
    '',
    `=== COMMUNICATION PATTERN ===`,
    `Pattern: ${actualPattern}`,
    `Expected Output: ${contextPackage.boundaries[0]}`,
    '',
    `Execute your task with focused, minimal context.`,
    `Provide clear, specific output for merging.`,
  ];

  return parts.join('\n');
}
