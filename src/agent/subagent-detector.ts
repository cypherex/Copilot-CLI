// Subagent Detector - pattern detection for automatic subagent hints

export interface SubagentOpportunity {
  roleId?: string;
  shouldSpawn: boolean;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  hint?: string;
}

interface PatternMatch {
  pattern: RegExp;
  opportunity: {
    roleId?: string;
    shouldSpawn: boolean;
    reason: string;
    priority: 'low' | 'medium' | 'high';
  };
}

/**
 * Patterns for detecting subagent opportunities
 */
const PATTERNS: PatternMatch[] = [
  // Parallel processing patterns
  {
    pattern: /\bfor each (file|module|service|component)\b/i,
    opportunity: {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'Multiple files/modules need processing - consider spawning parallel subagents',
      priority: 'high',
    },
  },

  {
    pattern: /\bacross all (files|modules|services)\b/i,
    opportunity: {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'Cross-module operation - consider spawning parallel subagents',
      priority: 'high',
    },
  },

  // Test writing patterns
  {
    pattern: /\b(add |write |create )tests?\b/i,
    opportunity: {
      roleId: 'test-writer',
      shouldSpawn: true,
      reason: 'Test writing task detected',
      priority: 'medium',
    },
  },

  {
    pattern: /\b(testing|test cases?|unit tests?|coverage)\b/i,
    opportunity: {
      roleId: 'test-writer',
      shouldSpawn: true,
      reason: 'Testing-related task',
      priority: 'medium',
    },
  },

  {
    pattern: /\bspec(s?|ification)\b/i,
    opportunity: {
      roleId: 'test-writer',
      shouldSpawn: true,
      reason: 'Specification or test requirements',
      priority: 'medium',
    },
  },

  // Investigation patterns
  {
    pattern: /\binvestigate\b/i,
    opportunity: {
      roleId: 'investigator',
      shouldSpawn: true,
      reason: 'Investigation task detected',
      priority: 'high',
    },
  },

  {
    pattern: /\b(debug|debugging|diagnos)\b/i,
    opportunity: {
      roleId: 'investigator',
      shouldSpawn: true,
      reason: 'Debugging/dagnosis task',
      priority: 'high',
    },
  },

  {
    pattern: /\b(fix|resolve|solves?)(\s+(a|the|this)?\s+)(bug|error|issue|problem)\b/i,
    opportunity: {
      roleId: 'fixer',
      shouldSpawn: true,
      reason: 'Bug fix task detected',
      priority: 'high',
    },
  },

  {
    pattern: /\b(what|why|how|when)\s+(does|did|is)\s+.*\?\?/i,
    opportunity: {
      roleId: 'investigator',
      shouldSpawn: true,
      reason: 'Investigative question detected',
      priority: 'medium',
    },
  },

  // Refactoring patterns
  {
    pattern: /\brefactor\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Refactoring task detected',
      priority: 'medium',
    },
  },

  {
    pattern: /\b(cleanup|clean up|reorganize|restructure)\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Code cleanup/reorganization task',
      priority: 'medium',
    },
  },

  {
    pattern: /\b(improve|optimize|simplify|consolidate)\s+(the )?\s+(code|structure)\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Code improvement/optimization task',
      priority: 'medium',
    },
  },

  {
    pattern: /\bextract\b.*\b(into|from)\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Extraction task - likely refactoring',
      priority: 'medium',
    },
  },

  // Documentation patterns
  {
    pattern: /\b(document|doc)\b/i,
    opportunity: {
      roleId: 'documenter',
      shouldSpawn: true,
      reason: 'Documentation task detected',
      priority: 'low',
    },
  },

  {
    pattern: /\b(readme|docs?|api docs?|comments?)\b/i,
    opportunity: {
      roleId: 'documenter',
      shouldSpawn: true,
      reason: 'Documentation or README task',
      priority: 'low',
    },
  },

  {
    pattern: /\b(add|update|improve)\s+(comments?|documentation?)\b/i,
    opportunity: {
      roleId: 'documenter',
      shouldSpawn: true,
      reason: 'Adding or updating documentation',
      priority: 'low',
    },
  },

  // Multiple files mentioned
  {
    pattern: /(\w+\.?\w+\.\w+).*?,.*(\w+\.?\w+\.\w+)/i,
    opportunity: {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'Multiple files mentioned - consider parallel processing',
      priority: 'medium',
    },
  },
];

/**
 * Detect opportunities for spawning subagents based on user message
 */
export function detectSubagentOpportunity(userMessage: string): SubagentOpportunity | undefined {
  const message = userMessage.toLowerCase();
  let bestMatch: SubagentOpportunity | undefined = undefined;

  for (const { pattern, opportunity } of PATTERNS) {
    if (pattern.test(message)) {
      // Keep highest priority match
      const candidate: SubagentOpportunity = {
        roleId: opportunity.roleId,
        shouldSpawn: opportunity.shouldSpawn,
        reason: opportunity.reason,
        priority: opportunity.priority as 'high' | 'medium' | 'low',
      };

      if (!bestMatch ||
          (opportunity.priority === 'high' && bestMatch.priority !== 'high') ||
          (opportunity.priority === 'medium' && bestMatch.priority === 'low')) {
        bestMatch = candidate;
      }
    }
  }

  return bestMatch;
}

/**
 * Build a subagent hint message for injection into the conversation
 */
export function buildSubagentHint(opportunity: SubagentOpportunity): string {
  const lines: string[] = [
    `[SUBAGENT SUGGESTION]`,
    `${opportunity.reason}`,
    `Priority: ${opportunity.priority}`,
  ];

  if (opportunity.roleId) {
    lines.push(`Suggested Role: ${opportunity.roleId}`);
  }

  lines.push(
    `Consider spawning a subagent if this task is large or complex.`,
    `You may also spawn multiple parallel subagents for independent work items.`,
  '',
  );

  return lines.join('\n');
}
