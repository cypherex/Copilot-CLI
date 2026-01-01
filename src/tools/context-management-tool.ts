// Context Management Tools - manage context for orchestrator and subagents

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { MemoryStore } from '../memory/types.js';

// Schema for summarize_context
const SummarizeContextSchema = z.object({
  scope: z.enum(['current_task', 'recent_messages', 'all_transcript', 'files']).optional().default('recent_messages').describe('What to summarize'),
  detail_level: z.enum(['brief', 'normal', 'detailed']).optional().default('normal').describe('How much detail to include'),
  include_files: z.array(z.string()).optional().describe('Specific files to include in summary'),
});

// Schema for extract_focus
const ExtractFocusSchema = z.object({
  focus_area: z.string().describe('The specific area or problem to extract'),
  files: z.array(z.string()).optional().describe('Specific files to include'),
  max_token_budget: z.number().optional().default(8000).describe('Maximum tokens for extracted context'),
  include_errors: z.boolean().optional().default(true).describe('Include recent errors related to focus'),
});

// Schema for merge_context
const MergeContextSchema = z.object({
  subagent_output: z.string().describe('The output/context from a subagent'),
  summary: z.string().optional().describe('A summary of what the subagent did'),
  files_affected: z.array(z.string()).optional().describe('Files that were modified'),
  action_items: z.array(z.string()).optional().describe('Action items from the subagent'),
});

export class SummarizeContextTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'summarize_context',
    description: `Summarize the current context to reduce bloat and focus on key information.

Use this when:
- The conversation is getting long and context is accumulating
- You need to step back and review what's been done
- You want to create a checkpoint before spawning a subagent
- You need to understand the overall state without all details

This helps prevent context overflow and keeps reasoning focused.`,
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['current_task', 'recent_messages', 'all_transcript', 'files'],
          description: 'What to summarize (default: recent_messages)',
        },
        detail_level: {
          type: 'string',
          enum: ['brief', 'normal', 'detailed'],
          description: 'How much detail to include (default: normal)',
        },
        include_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to include in summary',
        },
      },
      required: [],
    },
  };

  protected readonly schema = SummarizeContextSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof SummarizeContextSchema>): Promise<string> {
    const { scope, detail_level, include_files } = args;

    const goal = this.memoryStore.getGoal();
    const tasks = this.memoryStore.getTasks();
    const currentTask = tasks.find((t: any) => t.status === 'active');
    const userFacts = (this.memoryStore as any).getUserFacts();

    let summary = '';
    const lines: string[] = [];

    // Header based on scope
    lines.push(`[Context Summary - ${scope.toUpperCase()}]`);
    lines.push('');

    // Goal
    if (goal) {
      lines.push(`🎯 Goal: ${goal}`);
      lines.push('');
    }

    // Current task
    if (currentTask) {
      lines.push(`📋 Current Task: ${currentTask.description}`);
      lines.push(`   Status: ${currentTask.status} | Priority: ${currentTask.priority}`);
      lines.push('');
    }

    // Task progress
    const completed = tasks.filter((t: any) => t.status === 'completed').length;
    const active = tasks.filter((t: any) => t.status === 'active').length;
    const waiting = tasks.filter((t: any) => t.status === 'waiting').length;
    const blocked = tasks.filter((t: any) => t.status === 'blocked').length;

    if (tasks.length > 0) {
      lines.push(`📊 Task Progress:`);
      lines.push(`   Total: ${tasks.length}`);
      lines.push(`   ✅ Completed: ${completed}`);
      lines.push(`   🔄 Active: ${active}`);
      lines.push(`   ⏳ Waiting: ${waiting}`);
      lines.push(`   🚫 Blocked: ${blocked}`);
      lines.push('');
    }

    // Key user facts (brief)
    if (userFacts && userFacts.length > 0) {
      lines.push(`👤 Key User Facts:`);
      const factsToShow = detail_level === 'brief' ? 3 : detail_level === 'detailed' ? userFacts.length : 5;
      for (let i = 0; i < Math.min(factsToShow, userFacts.length); i++) {
        const fact = userFacts[i];
        lines.push(`   • ${fact.key}: ${fact.value}`);
      }
      if (userFacts.length > factsToShow) {
        lines.push(`   ... and ${userFacts.length - factsToShow} more`);
      }
      lines.push('');
    }

    // Recent working state
    const workingState = (this.memoryStore as any).getWorkingState();
    if (workingState) {
      lines.push(`💼 Working State:`);
      if (workingState.lastAction) {
        lines.push(`   Last Action: ${workingState.lastAction}`);
      }
      if (workingState.currentTask) {
        const task = tasks.find((t: any) => t.id === workingState.currentTask);
        if (task) {
          lines.push(`   Focus: ${task.description}`);
        }
      }
      lines.push('');
    }

    // Files if requested
    if (include_files && include_files.length > 0) {
      lines.push(`📁 Files in Scope:`);
      for (const file of include_files) {
        lines.push(`   • ${file}`);
      }
      lines.push('');
    }

    lines.push(`[End Summary]`);
    lines.push('');
    lines.push(`💡 Tip: Use this summary to create focused context for subagents or to reset focus.`);
    lines.push(`💡 Use extract_focus to get specific context for a subagent task.`);

    summary = lines.join('\n');

    // Store summary in working state for reference
    (this.memoryStore as any).updateWorkingState({
      lastContextSummary: summary,
      summaryScope: scope,
      summaryTimestamp: new Date(),
    });

    return summary;
  }
}

export class ExtractFocusTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'extract_focus',
    description: `Extract focused context for a subagent or specific task.

Use this when:
- Spawning a subagent and need to provide focused context
- Isolating a specific problem for deep analysis
- Reducing context bloat by extracting only relevant information
- Creating a bounded context for a specific task

This extracts minimal context needed for the focus area, avoiding context overload.`,
    parameters: {
      type: 'object',
      properties: {
        focus_area: {
          type: 'string',
          description: 'The specific area or problem to extract (e.g., "auth bug in login function")',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to include (optional, recommended if known)',
        },
        max_token_budget: {
          type: 'number',
          description: 'Maximum tokens for extracted context (default: 8000)',
        },
        include_errors: {
          type: 'boolean',
          description: 'Include recent errors related to focus (default: true)',
        },
      },
      required: ['focus_area'],
    },
  };

  protected readonly schema = ExtractFocusSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof ExtractFocusSchema>): Promise<string> {
    const { focus_area, files, max_token_budget, include_errors } = args;

    const goal = this.memoryStore.getGoal();
    const tasks = this.memoryStore.getTasks();
    const currentTask = tasks.find((t: any) => t.status === 'active');
    const userFacts = (this.memoryStore as any).getUserFacts();
    const workingState = (this.memoryStore as any).getWorkingState();

    let context = '';
    const lines: string[] = [];

    // Header
    lines.push(`[Focused Context]`);
    lines.push(`Focus Area: ${focus_area}`);
    lines.push(`Token Budget: ${max_token_budget}`);
    lines.push('');

    // Brief goal (if relevant)
    if (goal) {
      lines.push(`🎯 Context: ${goal}`);
      lines.push('');
    }

    // Current task if focused
    if (currentTask) {
      lines.push(`📋 Current Task: ${currentTask.description}`);
      lines.push('');
    }

    // Focus-specific user facts
    if (userFacts && userFacts.length > 0) {
      const relevantFacts = this.filterRelevantFacts(userFacts, focus_area, files);
      if (relevantFacts.length > 0) {
        lines.push(`👤 Relevant User Preferences:`);
        for (const fact of relevantFacts) {
          lines.push(`   • ${fact.key}: ${fact.value}`);
        }
        lines.push('');
      }
    }

    // Recent errors if requested and relevant
    if (include_errors) {
      const recentErrors = workingState?.recentErrors || [];
      const relevantErrors = this.filterRelevantErrors(recentErrors, focus_area, files);
      if (relevantErrors.length > 0) {
        lines.push(`🐛 Relevant Errors:`);
        for (const error of relevantErrors.slice(0, 3)) {
          lines.push(`   • ${error.message}`);
        }
        lines.push('');
      }
    }

    // Files to work with
    if (files && files.length > 0) {
      lines.push(`📁 Files to Work With:`);
      for (const file of files) {
        lines.push(`   • ${file}`);
      }
      lines.push('');
    }

    lines.push(`[End Focused Context]`);
    lines.push('');
    lines.push(`💡 You have focused context - only what's relevant to your task.`);
    lines.push(`💡 Work efficiently on this specific problem without worrying about broader context.`);

    context = lines.join('\n');

    return context;
  }

  private filterRelevantFacts(
    facts: any[],
    focusArea: string,
    files?: string[]
  ): any[] {
    const focusLower = focusArea.toLowerCase();
    return facts.filter((fact) => {
      const keyLower = fact.key.toLowerCase();
      const valueLower = fact.value.toString().toLowerCase();

      // Direct match to focus area
      if (focusLower.includes(keyLower) || keyLower.includes(focusLower)) {
        return true;
      }

      // File-specific facts
      if (files && files.length > 0) {
        for (const file of files) {
          const fileName = file.toLowerCase();
          if (keyLower.includes(fileName) || valueLower.includes(fileName)) {
            return true;
          }
        }
      }

      return false;
    });
  }

  private filterRelevantErrors(
    errors: any[],
    focusArea: string,
    files?: string[]
  ): any[] {
    const focusLower = focusArea.toLowerCase();
    return errors.filter((error) => {
      const messageLower = error.message?.toLowerCase() || '';
      const fileLower = error.file?.toLowerCase() || '';

      // Direct match to focus area
      if (focusLower.includes(messageLower) || messageLower.includes(focusLower)) {
        return true;
      }

      // File-specific errors
      if (files && files.length > 0) {
        for (const file of files) {
          if (file.toLowerCase() === fileLower) {
            return true;
          }
        }
      }

      return false;
    });
  }
}

export class MergeContextTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'merge_context',
    description: `Merge subagent output back into orchestrator context.

Use this when:
- A subagent has completed and you need to integrate results
- Merging parallel subagent results into coherent state
- Updating orchestrator's understanding based on subagent work
- Maintaining continuity after context isolation

This consolidates subagent findings while maintaining orchestrator's overall view.`,
    parameters: {
      type: 'object',
      properties: {
        subagent_output: {
          type: 'string',
          description: 'The output/context from a subagent',
        },
        summary: {
          type: 'string',
          description: 'A brief summary of what the subagent did',
        },
        files_affected: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files that were modified by the subagent',
        },
        action_items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Action items identified by the subagent',
        },
      },
      required: ['subagent_output'],
    },
  };

  protected readonly schema = MergeContextSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof MergeContextSchema>): Promise<string> {
    const { subagent_output, summary, files_affected, action_items } = args;

    const workingState = (this.memoryStore as any).getWorkingState();
    const lines: string[] = [];

    // Update working state with merge info
    const mergeInfo = {
      summary: summary || 'Subagent completed',
      filesAffected: files_affected || [],
      actionItems: action_items || [],
      timestamp: new Date(),
    };

    (this.memoryStore as any).updateWorkingState({
      lastSubagentMerge: mergeInfo,
      lastMergedOutput: subagent_output,
    });

    // Build merge confirmation
    lines.push(`[Context Merged]`);

    if (summary) {
      lines.push(`Summary: ${summary}`);
    }

    if (files_affected && files_affected.length > 0) {
      lines.push(`Files Affected:`);
      for (const file of files_affected) {
        lines.push(`  • ${file}`);
      }
    }

    if (action_items && action_items.length > 0) {
      lines.push(`Action Items:`);
      for (const item of action_items) {
        lines.push(`  • ${item}`);
      }
    }

    // Check if current task should be updated
    const tasks = this.memoryStore.getTasks();
    const activeTask = tasks.find((t: any) => t.status === 'active');
    if (activeTask && files_affected && files_affected.length > 0) {
      lines.push('');
      lines.push(`💡 Consider updating the current task status if work is complete.`);
      lines.push(`💡 Use update_task_status to mark "${activeTask.description}" as completed if done.`);
    }

    lines.push('');
    lines.push(`[End Merge]`);

    const result = lines.join('\n');

    return result;
  }
}
