// Subagent Detector - pattern detection for automatic subagent hints

/**
 * Represents an opportunity to spawn a subagent based on detected patterns
 */
export interface SubagentOpportunity {
  /** Optional role ID for the subagent (e.g., 'test-writer', 'investigator') */
  roleId?: string;
  /** Whether a subagent should be spawned for this opportunity */
  shouldSpawn: boolean;
  /** Human-readable reason for the delegation opportunity */
  reason: string;
  /** Priority level of the delegation opportunity */
  priority: 'low' | 'medium' | 'high';
  /** Optional custom hint message (overrides default) */
  hint?: string;
  /** 
   * Whether this delegation is MANDATORY.
   * When true, the agent MUST delegate this task to a subagent and not attempt it directly.
   * This is enforced for high-priority patterns that require specialized handling or parallel processing.
   * Defaults to false (suggestion mode).
   */
  mandatory?: boolean;
  /** 
   * Estimated number of independent tasks detected in the message.
   * Useful for determining whether multiple parallel subagents should be spawned.
   */
  taskCount?: number;
}

/**
 * Pattern matching configuration for subagent opportunity detection
 */
interface PatternMatch {
  /** Regular expression to match in user messages */
  pattern: RegExp;
  /** Delegation opportunity configuration */
  opportunity: {
    /** Optional role ID for the subagent */
    roleId?: string;
    /** Whether a subagent should be spawned */
    shouldSpawn: boolean;
    /** Human-readable reason for the opportunity */
    reason: string;
    /** Priority level (determines mandatory behavior) */
    priority: 'low' | 'medium' | 'high';
    /** Whether delegation is mandatory (defaults to false) */
    mandatory?: boolean;
  };
}

/**
 * Patterns for detecting subagent opportunities
 */
const PATTERNS: PatternMatch[] = [
  // Parallel processing patterns (HIGH PRIORITY - MANDATORY)
  {
    pattern: /\bfor each (file|module|service|component)\b/i,
    opportunity: {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'Multiple files/modules need processing - MUST spawn parallel subagents',
      priority: 'high',
      mandatory: true,
    },
  },

  {
    pattern: /\bacross all (files|modules|services)\b/i,
    opportunity: {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'Cross-module operation - MUST spawn parallel subagents',
      priority: 'high',
      mandatory: true,
    },
  },

  // Test writing patterns (MEDIUM PRIORITY - SUGGESTION)
  {
    pattern: /\b(add |write |create )tests?\b/i,
    opportunity: {
      roleId: 'test-writer',
      shouldSpawn: true,
      reason: 'Test writing task detected',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\b(testing|test cases?|unit tests?|coverage)\b/i,
    opportunity: {
      roleId: 'test-writer',
      shouldSpawn: true,
      reason: 'Testing-related task',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\bspec(s?|ification)\b/i,
    opportunity: {
      roleId: 'test-writer',
      shouldSpawn: true,
      reason: 'Specification or test requirements',
      priority: 'medium',
      mandatory: false,
    },
  },

  // Investigation patterns (HIGH PRIORITY - MANDATORY for investigation/debugging)
  {
    pattern: /\binvestigate\b/i,
    opportunity: {
      roleId: 'investigator',
      shouldSpawn: true,
      reason: 'Investigation task detected',
      priority: 'high',
      mandatory: true,
    },
  },

  {
    pattern: /\b(debug|debugging|diagnos)\b/i,
    opportunity: {
      roleId: 'investigator',
      shouldSpawn: true,
      reason: 'Debugging/diagnosis task',
      priority: 'high',
      mandatory: true,
    },
  },

  {
    pattern: /\b(fix|resolve|solves?)(\s+(a|the|this)?\s+)(bug|error|issue|problem)\b/i,
    opportunity: {
      roleId: 'fixer',
      shouldSpawn: true,
      reason: 'Bug fix task detected',
      priority: 'high',
      mandatory: true,
    },
  },

  {
    pattern: /\b(what|why|how|when)\s+(does|did|is)\s+.*\?\?/i,
    opportunity: {
      roleId: 'investigator',
      shouldSpawn: true,
      reason: 'Investigative question detected',
      priority: 'medium',
      mandatory: false,
    },
  },

  // Refactoring patterns (MEDIUM PRIORITY - SUGGESTION)
  {
    pattern: /\brefactor\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Refactoring task detected',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\b(cleanup|clean up|reorganize|restructure)\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Code cleanup/reorganization task',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\b(improve|optimize|simplify|consolidate)\s+(the )?\s+(code|structure)\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Code improvement/optimization task',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\bextract\b.*\b(into|from)\b/i,
    opportunity: {
      roleId: 'refactorer',
      shouldSpawn: true,
      reason: 'Extraction task - likely refactoring',
      priority: 'medium',
      mandatory: false,
    },
  },

  // Documentation patterns (LOW PRIORITY - SUGGESTION)
  {
    pattern: /\b(document|doc)\b/i,
    opportunity: {
      roleId: 'documenter',
      shouldSpawn: true,
      reason: 'Documentation task detected',
      priority: 'low',
      mandatory: false,
    },
  },

  {
    pattern: /\b(readme|docs?|api docs?|comments?)\b/i,
    opportunity: {
      roleId: 'documenter',
      shouldSpawn: true,
      reason: 'Documentation or README task',
      priority: 'low',
      mandatory: false,
    },
  },

  {
    pattern: /\b(add|update|improve)\s+(comments?|documentation?)\b/i,
    opportunity: {
      roleId: 'documenter',
      shouldSpawn: true,
      reason: 'Adding or updating documentation',
      priority: 'low',
      mandatory: false,
    },
  },

  // Multiple files mentioned (MEDIUM PRIORITY - SUGGESTION)
  {
    pattern: /(\w+\.?\w+\.\w+).*?,.*(\w+\.?\w+\.\w+)/i,
    opportunity: {
      roleId: undefined,
      shouldSpawn: true,
      reason: 'Multiple files mentioned - consider parallel processing',
      priority: 'medium',
      mandatory: false,
    },
  },

  // Quantifier patterns: several/multiple/various + file-related terms (MEDIUM - SUGGESTION)
  {
    pattern: /\b(several|multiple|various)\s+(files?|services?|modules?|components?)\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple files/modules/services/components mentioned - consider spawning parallel subagents',
      priority: 'medium',
      mandatory: false,
    },
  },

  // Quantifier patterns: each/every + singular file-related terms (MEDIUM - SUGGESTION)
  {
    pattern: /\b(each|every)\s+(file|service|module|component)\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Each/every file/service/module/component needs processing - consider spawning parallel subagents',
      priority: 'medium',
      mandatory: false,
    },
  },

  // Quantifier pattern: all + plural file-related terms (HIGH - MANDATORY)
  {
    pattern: /\ball\s+(files?|services?|modules?|components?)\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'All files/modules/services/components need processing - MUST spawn parallel subagents',
      priority: 'high',
      mandatory: true,
    },
  },

  // Quantifier pattern: "each of the" / "every one of the" + file-related terms (MEDIUM - SUGGESTION)
  {
    pattern: /\b(each of the|every one of the|each of|every one of)\s+(files?|services?|modules?|components?)\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Individual processing of each file/module/service/component - consider spawning parallel subagents',
      priority: 'medium',
      mandatory: false,
    },
  },

  // Quantifier pattern: number phrases (two, three, ..., ten) + file-related terms (LOW - SUGGESTION)
  {
    pattern: /\b(two|three|four|five|six|seven|eight|nine|ten)\s+(files?|services?|modules?|components?)\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Specific number of files/modules/services/components mentioned - consider spawning parallel subagents',
      priority: 'low',
      mandatory: false,
    },
  },

  // Conjunction patterns - detect multiple tasks joined by conjunctions (LOW/MEDIUM - SUGGESTION)
  {
    pattern: /\band\s+also\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple tasks joined by "and also" detected',
      priority: 'low',
      mandatory: false,
    },
  },

  {
    pattern: /\band\s+additionally\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple tasks joined by "and additionally" detected',
      priority: 'low',
      mandatory: false,
    },
  },

  {
    pattern: /\bas\s+well\s+as\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple tasks joined by "as well as" detected',
      priority: 'low',
      mandatory: false,
    },
  },

  {
    pattern: /\balong\s+with\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple tasks joined by "along with" detected',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\bin\s+addition\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple tasks joined by "in addition" detected',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\bfurthermore\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple tasks joined by "furthermore" detected',
      priority: 'medium',
      mandatory: false,
    },
  },

  {
    pattern: /\bplus\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Multiple tasks joined by "plus" detected',
      priority: 'low',
      mandatory: false,
    },
  },

  {
    pattern: /\balso\s+(refactor|update|add|write|create|fix|investigate|test|document|improve|optimize|cleanup)\b/i,
    opportunity: {
      roleId: 'general',
      shouldSpawn: true,
      reason: 'Secondary task detected with "also"',
      priority: 'medium',
      mandatory: false,
    },
  },
];

/**
 * Conjunction patterns used for task separation
 */
const CONJUNCTION_PATTERNS: RegExp[] = [
  /\band\s+also\b/i,
  /\band\s+additionally\b/i,
  /\bas\s+well\s+as\b/i,
  /\balong\s+with\b/i,
  /\bin\s+addition\b/i,
  /\bfurthermore\b/i,
  /\bplus\b/i,
];

/**
 * Separates a message into distinct tasks based on conjunction patterns
 * @param message The user message to analyze
 * @returns An array of distinct task strings
 */
export function separateTasks(message: string): string[] {
  let tasks = [message.trim()];
  
  for (const conjunctionPattern of CONJUNCTION_PATTERNS) {
    const newTasks: string[] = [];
    
    for (const task of tasks) {
      // Check if this task contains the conjunction
      if (conjunctionPattern.test(task)) {
        // Split at the conjunction
        const parts = task.split(conjunctionPattern);
        for (const part of parts) {
          // Clean up: remove leading punctuation and trim
          let trimmedPart = part.trim();
          // Remove leading punctuation marks
          trimmedPart = trimmedPart.replace(/^[,.\s]+/, '');
          // Filter out empty strings and very short fragments
          if (trimmedPart.length > 3) {
            newTasks.push(trimmedPart);
          }
        }
      } else {
        newTasks.push(task);
      }
    }
    
    tasks = newTasks;
  }
  
  return tasks;
}

/**
 * Counts the number of independent tasks in a message based on conjunction patterns
 * @param message The user message to analyze
 * @returns The estimated number of independent tasks
 */
export function countTasks(message: string): number {
  const tasks = separateTasks(message);
  return tasks.length;
}

/**
 * Detect opportunities for spawning subagents based on user message
 * 
 * Returns the highest priority match if multiple patterns are detected.
 * High priority patterns are marked as mandatory delegation.
 * 
 * @param userMessage - The user's message to analyze
 * @returns A SubagentOpportunity object or undefined if no pattern matches
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
        mandatory: opportunity.mandatory ?? false,
      };

      // Priority-based selection: high > medium > low
      if (!bestMatch ||
          (opportunity.priority === 'high' && bestMatch.priority !== 'high') ||
          (opportunity.priority === 'medium' && bestMatch.priority === 'low')) {
        bestMatch = candidate;
      }
    }
  }

  // Add task count if conjunction patterns are detected
  if (bestMatch) {
    const taskCount = countTasks(userMessage);
    if (taskCount > 1) {
      bestMatch.taskCount = taskCount;
    }
  }

  return bestMatch;
}

/**
 * Build a subagent hint message for injection into the conversation
 * 
 * Returns different formats based on mandatory flag:
 * - Mandatory: Uses imperative language ("YOU MUST", "REQUIREMENT")
 * - Suggestion: Uses polite recommendation language
 * 
 * @param opportunity - The detected subagent opportunity
 * @returns A formatted hint message string
 */
export function buildSubagentHint(opportunity: SubagentOpportunity): string {
  const isMandatory = opportunity.mandatory === true;
  const lines: string[] = [];

  if (isMandatory) {
    // MANDATORY MODE - Use imperative language and warnings
    lines.push(
      `⚠️ [WARNING] MANDATORY DELEGATION`,
      ``,
      `[REQUIREMENT]`,
      `YOU MUST delegate this task to a subagent. DO NOT attempt it directly.`,
      ``,
      `${opportunity.reason}`,
      ``,
      `Priority: ${opportunity.priority}`,
    );

    if (opportunity.roleId) {
      lines.push(`Required Role: ${opportunity.roleId}`);
    }

    if (opportunity.taskCount && opportunity.taskCount > 1) {
      lines.push(`Detected Tasks: ${opportunity.taskCount} (parallel processing required)`);
    }

    lines.push(
      ``,
      `ACTION STEPS:`,
      `1. Use spawn_agent tool with the appropriate role`,
      `2. If task involves multiple items, spawn parallel subagents (background: true)`,
      `3. Wait for subagent completion before proceeding`,
      `4. Review subagent results and integrate as needed`,
      ``,
      `⚠️ DO NOT PROCEED WITHOUT DELEGATING THIS TASK`,
      ``,
    );
  } else {
    // SUGGESTION MODE - Use strong recommendation language with context benefits
    lines.push(
      `[SUBAGENT SUGGESTION]`,
      ``,
      `⭐ STRONGLY RECOMMENDED - This is an excellent opportunity for delegation!`,
      ``,
      `${opportunity.reason}`,
      ``,
      `Priority: ${opportunity.priority}`,
    );

    if (opportunity.roleId) {
      lines.push(`Recommended Role: ${opportunity.roleId}`);
    }

    if (opportunity.taskCount && opportunity.taskCount > 1) {
      lines.push(`Detected Tasks: ${opportunity.taskCount} (parallel processing strongly recommended)`);
    }

    lines.push(
      ``,
      `🧠 CONTEXT BENEFIT: Delegating this to a subagent will:`,
      `   • Keep the main orchestrator focused and clean`,
      `   • Prevent context flooding with task-specific details`,
      `   • Allow the subagent to iterate thousands of times in isolation`,
      `   • Improve overall performance by containing complexity`,
      ``,
      `💡 STRONG RECOMMENDATION: Spawn a subagent for this task to maintain clean context separation.`,
      `   Use background=true for parallel work items to maximize efficiency.`,
      ``,
      `⚡ When in doubt, delegate! Subagents are cheap, context pollution is expensive.`,
      ``,
    );
  }

  return lines.join('\n');
}
