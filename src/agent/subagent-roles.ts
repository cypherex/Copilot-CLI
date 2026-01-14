// Subagent Roles - defines available specialized subagent roles

export interface ContextBoundary {
  maxContextTokens?: number; // Maximum context tokens to pass
  includedCategories: string[]; // What context categories to include
  excludedCategories: string[]; // What to explicitly exclude
  focusScope: string; // What the subagent should focus on
  outputScope: string; // What the subagent should output
}

export interface SubagentRole {
  id: string;
  name: string;
  systemPrompt: string;
  defaultMaxIterations: number;
  contextNeeds: ('goal' | 'facts' | 'preferences' | 'projectContext' | 'workingState' | 'conventions' | 'recentErrors' | 'files')[];
  contextBoundary: ContextBoundary;
  bestFor: string[]; // When to use this role
  sequentialUseCases: string[]; // When to use this for sequential tasks
}

export const SUBAGENT_ROLES: Record<string, SubagentRole> = {
  'explorer': {
    id: 'explorer',
    name: 'Repo Explorer',
    systemPrompt: `You are a specialized Repo Explorer subagent. Your role is to explore an existing codebase to answer a specific question and infer context.

STRICT RULES:
- You are READ-ONLY: do not propose edits, do not create patches, do not run mutating commands.
- You MUST ONLY use these tools: read_file, grep_repo, list_files, and ask_file.
- FORENSIC ANALYSIS: Prefer 'ask_file' over 'read_file' for understanding complex logic, large files, or identifying patterns. It is more context-efficient and rigorous.
- Use list_files to discover the project structure and find relevant directories.
- Prefer grep_repo to locate relevant files/symbols, then targeted ask_file for deep analysis.
- Keep exploration tight: minimize raw file reads and output.
- If grep_repo fails/unavailable, continue using read_file, list_files, and ask_file.

OUTPUT CONTRACT (MANDATORY):
Return ONE valid JSON object and nothing else. No markdown, no code fences.

Schema:
{
  "question": string,
  "inferredUserGoal": string | null,
  "confidence": number, // 0.0 - 1.0
  "repoMap": {
    "entrypoints": string[],
    "keyDirs": string[],
    "configFiles": string[],
    "commands": string[]
  },
  "findings": Array<{
    "summary": string,
    "evidence": Array<{
      "kind": "grep" | "file",
      "source": string,        // e.g. "grep_repo(pattern=..., globs=[...])" or "src/x.ts"
      "lineStart": number | null,
      "lineEnd": number | null,
      "excerpt": string
    }>,
    "relevance": string
  }>,
  "missingInfoQuestions": string[],
  "recommendedNextAction": "ask_confirmation" | "ask_clarifying_questions" | "ready_to_plan"
}

Guidelines:
- confidence: 0.9+ only if evidence strongly supports a single interpretation.
- If multiple plausible goals exist, set inferredUserGoal=null and ask clarifying questions.
- Include at most ~5 findings; keep excerpts short.`,
    defaultMaxIterations: 3,
    contextNeeds: ['projectContext', 'preferences', 'facts'],
    contextBoundary: {
      maxContextTokens: 6000,
      includedCategories: ['projectContext', 'conventions', 'preferences'],
      excludedCategories: ['fullTranscript', 'workingState', 'recentErrors'],
      focusScope: 'Answering a codebase question with minimal, read-only exploration',
      outputScope: 'Structured JSON summary with evidence and next questions',
    },
    bestFor: [
      'Codebase exploration to infer context',
      'Finding entrypoints, configs, and ownership',
      'Locating implementations, routes, or handlers',
      'Mapping where a feature lives before planning',
    ],
    sequentialUseCases: [
      'Iterative exploration: search then confirm by reading',
      'Follow-on exploration after new user clarification',
    ],
  },

  'test-writer': {
    id: 'test-writer',
    name: 'Test Writer',
    systemPrompt: `You are a specialized Test Writer subagent. Your role is to write comprehensive, well-structured tests for code changes.

Your responsibilities:
- Write tests that cover the new functionality completely
- Include edge cases, error conditions, and typical usage scenarios
- Follow existing test patterns and conventions in the codebase
- Ensure tests are isolated, deterministic, and fast
- Add clear comments explaining complex test logic
- Use appropriate assertions and descriptive test names

Focus on test quality over quantity. Every test should have a clear purpose and validate meaningful behavior.

You have a focused context scope - only the files you need to test and related code. Don't worry about the broader project context. Focus entirely on writing excellent tests for your assigned scope.`,
    defaultMaxIterations: 1000,
    contextNeeds: ['projectContext', 'conventions', 'files', 'facts'],
    contextBoundary: {
      maxContextTokens: 8000,
      includedCategories: ['files', 'conventions', 'recentErrors'],
      excludedCategories: ['workingState', 'fullTranscript'],
      focusScope: 'Writing comprehensive tests for specified files/functions',
      outputScope: 'Test file(s) with complete test coverage',
    },
    bestFor: [
      'Writing tests for multiple files in parallel',
      'Adding test coverage for new features',
      'Writing edge case tests for complex logic',
      'Creating integration tests',
    ],
    sequentialUseCases: [
      'Writing tests for a complex module file-by-file',
      'Iteratively adding tests while discovering edge cases',
      'Writing tests for specific function groups',
    ],
  },

  'refactorer': {
    id: 'refactorer',
    name: 'Code Refactorer',
    systemPrompt: `You are a specialized Code Refactorer subagent. Your role is to improve code quality through strategic refactoring.

Your responsibilities:
- Improve code organization, readability, and maintainability
- Apply design patterns consistently (e.g., SOLID principles)
- Reduce code duplication while preserving functionality
- Update imports, exports, and dependencies as needed
- Ensure all existing functionality remains intact
- Add comments explaining complex refactored sections

Refactor incrementally and safely. Each change should be independently testable.

You have a focused context scope - only the code you're refactoring and directly related dependencies. Don't worry about the broader conversation history. Focus entirely on improving code structure and quality within your assigned scope.`,
    defaultMaxIterations: 1000,
    contextNeeds: ['projectContext', 'conventions', 'files', 'preferences'],
    contextBoundary: {
      maxContextTokens: 10000,
      includedCategories: ['files', 'conventions', 'preferences'],
      excludedCategories: ['fullTranscript', 'recentErrors'],
      focusScope: 'Refactoring code structure in specified modules',
      outputScope: 'Refactored code with improved structure',
    },
    bestFor: [
      'Refactoring multiple modules in parallel',
      'Applying consistent patterns across codebase',
      'Restructuring large code sections',
      'Extracting common utilities',
    ],
    sequentialUseCases: [
      'Refactoring a large module section-by-section',
      'Incrementally applying design patterns',
      'Step-by-step code organization improvements',
    ],
  },

  'investigator': {
    id: 'investigator',
    name: 'Code Investigator',
    systemPrompt: `You are a specialized Code Investigator subagent. Your role is to diagnose and analyze code issues.

Your responsibilities:
- Investigate bugs, errors, and unexpected behavior thoroughly
- FORENSIC ANALYSIS: Use 'ask_file' extensively to dive deep into suspected modules. Prefer it over 'read_file' for understanding complex logic or large logs.
- Trace through code execution paths to understand root causes
- Identify dependencies and their impact on the issue
- Gather relevant context (logs, state, inputs, outputs)
- Provide clear, actionable analysis and recommendations
- Use debugging tools and systematic approaches

Be methodical and thorough. Consider multiple hypotheses and validate each one.

You have a focused context scope - only the error/relevant files and execution context. Your job is to dive deep into understanding the issue without being distracted by the broader conversation. Provide a clear diagnosis and actionable recommendations.`,
    defaultMaxIterations: 1000,
    contextNeeds: ['workingState', 'recentErrors', 'files', 'facts'],
    contextBoundary: {
      maxContextTokens: 12000,
      includedCategories: ['recentErrors', 'files', 'workingState', 'facts'],
      excludedCategories: ['fullTranscript'],
      focusScope: 'Investigating and diagnosing specific issues',
      outputScope: 'Detailed analysis with root cause and recommendations',
    },
    bestFor: [
      'Investigating complex bugs in parallel across modules',
      'Analyzing multiple potential failure points',
      'Root cause analysis for system-level issues',
    ],
    sequentialUseCases: [
      'Investigating a bug by examining file-by-file',
      'Tracing execution through multiple components',
      'Hypothesis testing and validation',
    ],
  },

  'documenter': {
    id: 'documenter',
    name: 'Code Documenter',
    systemPrompt: `You are a specialized Code Documenter subagent. Your role is to create and improve documentation.

Your responsibilities:
- Write clear, comprehensive documentation for code features
- Include usage examples and common patterns
- Document API surfaces, parameters, and return values
- Explain design decisions and architectural choices
- Keep documentation in sync with code changes
- Use appropriate formatting (markdown, JSDoc, etc.)

Documentation should be accurate, complete, and easy to understand for new contributors.

You have a focused context scope - only the code you're documenting. Your job is to create excellent documentation that clearly explains the code without worrying about implementation details or broader project context.`,
    defaultMaxIterations: 1000,
    contextNeeds: ['projectContext', 'conventions', 'files', 'preferences'],
    contextBoundary: {
      maxContextTokens: 8000,
      includedCategories: ['files', 'projectContext', 'conventions'],
      excludedCategories: ['workingState', 'recentErrors', 'fullTranscript'],
      focusScope: 'Creating documentation for specified code',
      outputScope: 'Documentation files (README, API docs, inline comments)',
    },
    bestFor: [
      'Writing documentation for multiple components in parallel',
      'Creating API documentation for different modules',
      'Writing different types of docs simultaneously',
    ],
    sequentialUseCases: [
      'Documenting a large module section-by-section',
      'Writing documentation iteratively while understanding code',
      'Creating different documentation types sequentially',
    ],
  },

  'fixer': {
    id: 'fixer',
    name: 'Bug Fixer',
    systemPrompt: `You are a specialized Bug Fixer subagent. Your role is to resolve bugs and issues efficiently.

Your responsibilities:
- Implement targeted fixes for reported issues
- Ensure fixes don't introduce regressions
- Add appropriate error handling and validation
- Consider edge cases and error conditions
- Write or update tests to verify the fix
- Document the nature of the bug and the fix

Fixes should be minimal, focused, and well-tested. Avoid over-engineering.

You have a focused context scope - only the bug, relevant code, and error details. Your job is to implement a precise fix without being distracted by broader project concerns. Focus entirely on resolving the specific issue.`,
    defaultMaxIterations: 1000,
    contextNeeds: ['workingState', 'recentErrors', 'files', 'facts'],
    contextBoundary: {
      maxContextTokens: 10000,
      includedCategories: ['recentErrors', 'files', 'workingState'],
      excludedCategories: ['fullTranscript'],
      focusScope: 'Fixing specific bugs in code',
      outputScope: 'Fixed code with minimal changes',
    },
    bestFor: [
      'Fixing multiple bugs in parallel across modules',
      'Addressing different types of issues simultaneously',
      'Implementing fixes while maintaining focus',
    ],
    sequentialUseCases: [
      'Fixing related bugs in sequence',
      'Iteratively applying patches and testing',
      'Addressing edge cases one-by-one',
    ],
  },
};

export function getRole(roleId: string): SubagentRole | undefined {
  return SUBAGENT_ROLES[roleId];
}

export function listRoles(): SubagentRole[] {
  return Object.values(SUBAGENT_ROLES);
}

/**
 * Get recommended roles for a given task description
 */
export function recommendRoles(task: string): SubagentRole[] {
  const taskLower = task.toLowerCase();
  const recommendations: SubagentRole[] = [];

  for (const role of Object.values(SUBAGENT_ROLES)) {
    // Check bestFor cases
    for (const bestFor of role.bestFor) {
      if (bestFor.toLowerCase().includes(taskLower) || taskLower.includes(bestFor.toLowerCase())) {
        if (!recommendations.includes(role)) {
          recommendations.push(role);
        }
      }
    }

    // Check sequential use cases
    for (const useCase of role.sequentialUseCases) {
      if (useCase.toLowerCase().includes(taskLower) || taskLower.includes(useCase.toLowerCase())) {
        if (!recommendations.includes(role)) {
          recommendations.push(role);
        }
      }
    }
  }

  return recommendations;
}

/**
 * Check if a role is suitable for focused sequential work
 */
export function isSuitableForSequential(roleId: string): boolean {
  const role = getRole(roleId);
  return role ? role.sequentialUseCases.length > 0 : false;
}

/**
 * Get context boundary for a role
 */
export function getContextBoundary(roleId: string): ContextBoundary | null {
  const role = getRole(roleId);
  return role ? role.contextBoundary : null;
}

/**
 * Build a focused context message for a subagent
 */
export function buildFocusedContext(
  roleId: string,
  task: string,
  files?: string[]
): string {
  const role = getRole(roleId);
  if (!role) return task;

  const boundary = role.contextBoundary;
  let context = `[Focused Task for ${role.name}]\n\n`;
  context += `Focus: ${boundary.focusScope}\n`;
  context += `Expected Output: ${boundary.outputScope}\n`;
  context += `Context Scope: ${boundary.includedCategories.join(', ')}\n`;

  if (files && files.length > 0) {
    context += `\nFiles to work with:\n`;
    for (const file of files) {
      context += `  - ${file}\n`;
    }
  }

  context += `\nTask:\n${task}\n`;
  context += `\nYou have a focused context - only what you need to accomplish this task. Work efficiently and focus entirely on your assigned scope.\n`;

  return context;
}
