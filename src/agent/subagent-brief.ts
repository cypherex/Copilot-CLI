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
  goal?: string;
  taskHierarchy?: {
    currentTask?: { id: string; description: string; status: string };
    parentTask?: { id: string; description: string; status: string; completionMessage?: string };
    siblingTasks?: Array<{ id: string; description: string; status: string; completionMessage?: string }>;
    childTasks?: Array<{ id: string; description: string; status: string; completionMessage?: string }>;
    allTasks?: Array<{ id: string; description: string; status: string; completionMessage?: string; depth: number }>;
  };
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
  includeGoal?: boolean; // Default: true
  includeTaskHierarchy?: boolean; // Default: true
  currentTaskId?: string; // The task this subagent is working on
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

  // Include goal by default
  if (options.includeGoal !== false) {
    const goal = memoryStore.getGoal();
    if (goal) {
      brief.goal = goal.description;
    }
  }

  // Include task hierarchy by default
  if (options.includeTaskHierarchy !== false) {
    const allTasks = memoryStore.getTasks();
    const currentTaskId = options.currentTaskId;

    if (currentTaskId) {
      const currentTask = allTasks.find(t => t.id === currentTaskId);

      if (currentTask) {
        brief.taskHierarchy = {
          currentTask: {
            id: currentTask.id,
            description: currentTask.description,
            status: currentTask.status,
          },
        };

        // Find parent task
        if (currentTask.parentId) {
          const parentTask = allTasks.find(t => t.id === currentTask.parentId);
          if (parentTask) {
            brief.taskHierarchy.parentTask = {
              id: parentTask.id,
              description: parentTask.description,
              status: parentTask.status,
              completionMessage: parentTask.completionMessage,
            };
          }
        }

        // Find sibling tasks (tasks with same parent)
        const siblings = allTasks.filter(
          t => t.parentId === currentTask.parentId && t.id !== currentTask.id
        );
        if (siblings.length > 0) {
          brief.taskHierarchy.siblingTasks = siblings.map(t => ({
            id: t.id,
            description: t.description,
            status: t.status,
            completionMessage: t.completionMessage,
          }));
        }

        // Find child tasks
        const children = allTasks.filter(t => t.parentId === currentTask.id);
        if (children.length > 0) {
          brief.taskHierarchy.childTasks = children.map(t => ({
            id: t.id,
            description: t.description,
            status: t.status,
            completionMessage: t.completionMessage,
          }));
        }

        // Build full task list with depth calculation
        const taskDepthMap = new Map<string, number>();

        // Calculate depth for each task
        const calculateDepth = (taskId: string): number => {
          if (taskDepthMap.has(taskId)) {
            return taskDepthMap.get(taskId)!;
          }

          const task = allTasks.find(t => t.id === taskId);
          if (!task || !task.parentId) {
            taskDepthMap.set(taskId, 0);
            return 0;
          }

          const depth = calculateDepth(task.parentId) + 1;
          taskDepthMap.set(taskId, depth);
          return depth;
        };

        // Calculate depth for all tasks
        allTasks.forEach(t => calculateDepth(t.id));

        // Build task list sorted by creation order (preserves hierarchy)
        brief.taskHierarchy.allTasks = allTasks.map(t => ({
          id: t.id,
          description: t.description,
          status: t.status,
          completionMessage: t.completionMessage,
          depth: taskDepthMap.get(t.id) || 0,
        }));
      }
    }
  }

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

  // Add goal context
  if (brief.goal) {
    parts.push(`\n## Overall Goal\n${brief.goal}`);
  }

  // Add task hierarchy context
  if (brief.taskHierarchy) {
    const h = brief.taskHierarchy;
    const hierarchyParts: string[] = ['\n## Task Context'];

    // Current task
    if (h.currentTask) {
      hierarchyParts.push(`\n**Your Task**: ${h.currentTask.description} (${h.currentTask.status})`);
    }

    // Parent task
    if (h.parentTask) {
      hierarchyParts.push(
        `\n**Parent Task**: ${h.parentTask.description} (${h.parentTask.status})`
      );
      if (h.parentTask.completionMessage) {
        hierarchyParts.push(`  └─ Completed: ${h.parentTask.completionMessage}`);
      }
    }

    // Sibling tasks (other tasks at same level)
    if (h.siblingTasks && h.siblingTasks.length > 0) {
      hierarchyParts.push(`\n**Related Tasks** (siblings at same level):`);
      h.siblingTasks.forEach(t => {
        const icon = t.status === 'completed' ? '✓' : t.status === 'active' ? '→' : '○';
        hierarchyParts.push(`  ${icon} ${t.description} (${t.status})`);
        if (t.completionMessage) {
          hierarchyParts.push(`    └─ ${t.completionMessage}`);
        }
      });
    }

    // Child tasks (subtasks of current task)
    if (h.childTasks && h.childTasks.length > 0) {
      hierarchyParts.push(`\n**Subtasks** (children of your task):`);
      h.childTasks.forEach(t => {
        const icon = t.status === 'completed' ? '✓' : t.status === 'active' ? '→' : '○';
        hierarchyParts.push(`  ${icon} ${t.description} (${t.status})`);
        if (t.completionMessage) {
          hierarchyParts.push(`    └─ ${t.completionMessage}`);
        }
      });
    }

    // Full task list with all tasks shown hierarchically
    if (h.allTasks && h.allTasks.length > 0) {
      hierarchyParts.push(`\n**All Tasks Overview** (${h.allTasks.length} total):`);

      // Show all tasks with their status
      h.allTasks.forEach(t => {
        const indent = '  '.repeat(t.depth);
        const icon = t.status === 'completed' ? '✓' : t.status === 'active' ? '→' : t.status === 'blocked' ? '⚠' : '○';
        hierarchyParts.push(`${indent}${icon} ${t.description} (${t.status})`);
        if (t.completionMessage) {
          hierarchyParts.push(`${indent}  └─ ${t.completionMessage}`);
        }
      });

      // Show summary
      const pending = h.allTasks.filter(t => t.status === 'waiting').length;
      const active = h.allTasks.filter(t => t.status === 'active').length;
      const completed = h.allTasks.filter(t => t.status === 'completed').length;
      hierarchyParts.push(`\nTask Status Summary: ${completed} completed, ${active} active, ${pending} waiting`);
    }

    parts.push(hierarchyParts.join('\n'));
  }

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
