// Subagent Brief - builds focused context for subagent tasks

import type { SubagentRole } from './subagent-roles.js';
import { getRole } from './subagent-roles.js';
import type { MemoryStore } from '../memory/types.js';

export interface SubagentBrief {
  task: string;
  role?: SubagentRole;
  files: string[];
  preferences: { key: string; value: string }[];
  techStack: { key: string; value: string }[];
  conventions: string[];
  recentErrors: string[];
  additionalContext?: string;
  successCriteria?: string;
}

export interface BuildSubagentBriefOptions {
  role?: string | SubagentRole;
  files?: string[];
  includePreferences?: boolean;
  includeTechStack?: boolean;
  includeConventions?: boolean;
  includeRecentErrors?: boolean;
  additionalContext?: string;
  successCriteria?: string;
}

/**
 * Build a focused brief for a subagent based on parent memory
 */
export function buildSubagentBrief(
  task: string,
  memoryStore: MemoryStore,
  options: BuildSubagentBriefOptions = {}
): SubagentBrief {
  const brief: SubagentBrief = {
    task,
    files: options.files || [],
    preferences: [],
    techStack: [],
    conventions: [],
    recentErrors: [],
    additionalContext: options.additionalContext,
    successCriteria: options.successCriteria,
  };

  // Set role if provided
  if (options.role) {
    const role = typeof options.role === 'string'
      ? getRole(options.role)
      : options.role;
    if (role) {
      brief.role = role;
    }
  }

  // Extract context based on role's context needs
  const role = brief.role;
  if (role) {
    // Extract from goals
    if (role.contextNeeds.includes('goal')) {
      const goal = memoryStore.getGoal();
      if (goal) {
        brief.additionalContext = brief.additionalContext
          ? `${brief.additionalContext}\n\nCurrent Goal: ${goal.description}`
          : `Current Goal: ${goal.description}`;
      }
    }

    // Extract from facts
    if (role.contextNeeds.includes('facts')) {
      const facts = memoryStore.getUserFacts().slice(0, 5);
      if (facts.length > 0) {
        brief.additionalContext = brief.additionalContext
          ? `${brief.additionalContext}\n\nRelevant Facts:\n${facts.map(f => `- ${f.fact}`).join('\n')}`
          : `Relevant Facts:\n${facts.map(f => `- ${f.fact}`).join('\n')}`;
      }
    }

    // Extract from preferences
    if (role.contextNeeds.includes('preferences') && options.includePreferences !== false) {
      const prefs = memoryStore.getPreferences().slice(0, 10);
      for (const pref of prefs) {
        brief.preferences.push({
          key: `${pref.category}/${pref.key}`,
          value: pref.value,
        });
      }
    }

    // Extract from project context
    if (role.contextNeeds.includes('projectContext')) {
      const ctx = memoryStore.getProjectContext().slice(0, 10);
      for (const c of ctx) {
        brief.techStack.push({
          key: c.type,
          value: `${c.key} = ${c.value}`,
        });
      }
    }

    // Extract from working state
    if (role.contextNeeds.includes('workingState')) {
      const workingState = memoryStore.getWorkingState();
      const activeTask = memoryStore.getActiveTask();
      if (activeTask) {
        brief.additionalContext = brief.additionalContext
          ? `${brief.additionalContext}\n\nCurrent Task: ${activeTask.description}`
          : `Current Task: ${activeTask.description}`;
      }

      // Extract recent errors
      if (role.contextNeeds.includes('recentErrors')) {
        const errors = workingState.recentErrors.filter(e => !e.resolved).slice(-5);
        for (const error of errors) {
          brief.recentErrors.push(error.error);
        }
      }

      // Extract from files
      if (role.contextNeeds.includes('files')) {
        const activeFiles = workingState.activeFiles.slice(0, 5);
        for (const file of activeFiles) {
          brief.files.push(file.path);
        }
      }
    }

    // Extract conventions (stored as preferences with category 'style')
    if (role.contextNeeds.includes('conventions') && options.includeConventions !== false) {
      const convPrefs = memoryStore.getPreferences()
        .filter(p => p.category === 'style')
        .slice(0, 10);
      for (const pref of convPrefs) {
        brief.conventions.push(`${pref.key}: ${pref.value}`);
      }
    }
  }

  return brief;
}

/**
 * Convert a subagent brief to a system prompt
 */
export function briefToSystemPrompt(brief: SubagentBrief): string {
  const parts: string[] = [
    `# Task\n${brief.task}`,
  ];

  // Add role-specific system prompt
  if (brief.role) {
    parts.push(`\n${brief.role.systemPrompt}`);
  }

  // Add files context
  if (brief.files.length > 0) {
    parts.push(`\n## Files to Work On\n${brief.files.map(f => `- ${f}`).join('\n')}`);
  }

  // Add preferences
  if (brief.preferences.length > 0) {
    parts.push(`\n## User Preferences\n${brief.preferences.map(p => `- ${p.key}: ${p.value}`).join('\n')}`);
  }

  // Add tech stack
  if (brief.techStack.length > 0) {
    parts.push(`\n## Tech Stack\n${brief.techStack.map(t => `- ${t.key}: ${t.value}`).join('\n')}`);
  }

  // Add conventions
  if (brief.conventions.length > 0) {
    parts.push(`\n## Code Conventions\n${brief.conventions.map(c => `- ${c}`).join('\n')}`);
  }

  // Add recent errors
  if (brief.recentErrors.length > 0) {
    parts.push(`\n## Recent Errors\n${brief.recentErrors.map(e => `- ${e.slice(0, 200)}`).join('\n')}`);
  }

  // Add additional context
  if (brief.additionalContext) {
    parts.push(`\n## Additional Context\n${brief.additionalContext}`);
  }

  // Add success criteria
  if (brief.successCriteria) {
    parts.push(`\n## Success Criteria\n${brief.successCriteria}`);
  }

  parts.push(`\n---\nExecute the task thoroughly. Report your findings or completion.`);

  return parts.join('\n\n');
}
