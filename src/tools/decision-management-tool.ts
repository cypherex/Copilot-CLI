import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { MemoryStore } from '../memory/types.js';

// Schema for add_decision
const AddDecisionSchema = z.object({
  description: z.string().describe('Brief description of the decision'),
  rationale: z.string().optional().describe('Why this decision was made'),
  alternatives: z.array(z.string()).optional().describe('Alternative approaches considered'),
  tradeoffs: z.string().optional().describe('Pros/cons of the chosen approach'),
  revisit_condition: z.string().optional().describe('When to revisit this decision (e.g., "Revisit if performance degrades")'),
  category: z.enum(['architecture', 'implementation', 'tooling', 'approach', 'other']).optional().describe('Category of decision'),
  related_files: z.array(z.string()).optional().describe('Files affected by this decision'),
});

// Schema for get_decisions
const GetDecisionsSchema = z.object({
  include_superseded: z.boolean().optional().default(false).describe('Include decisions that have been superseded'),
  category: z.enum(['architecture', 'implementation', 'tooling', 'approach', 'other', 'all']).optional().default('all').describe('Filter by category'),
});

// Schema for supersede_decision
const SupersedeDecisionSchema = z.object({
  old_decision_id: z.string().describe('ID of the decision being superseded'),
  new_decision_id: z.string().describe('ID of the new decision'),
});

export class AddDecisionTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'add_decision',
    description: `Record a technical decision with rationale, alternatives, and tradeoffs.

Use this when:
- Making important architectural choices
- Selecting between different approaches
- Choosing tools or libraries
- Deciding on implementation strategies
- Any decision that may need to be revisited later

This helps maintain context across sessions and understand WHY decisions were made.`,
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Brief description of the decision',
        },
        rationale: {
          type: 'string',
          description: 'Why this decision was made',
        },
        alternatives: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative approaches considered',
        },
        tradeoffs: {
          type: 'string',
          description: 'Pros/cons of the chosen approach',
        },
        revisit_condition: {
          type: 'string',
          description: 'When to revisit this decision (e.g., "Revisit if performance degrades")',
        },
        category: {
          type: 'string',
          enum: ['architecture', 'implementation', 'tooling', 'approach', 'other'],
          description: 'Category of decision',
        },
        related_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files affected by this decision',
        },
      },
      required: ['description'],
    },
  };

  protected readonly schema = AddDecisionSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof AddDecisionSchema>): Promise<string> {
    const decision = this.memoryStore.addDecision({
      description: args.description,
      rationale: args.rationale,
      alternatives: args.alternatives,
      tradeoffs: args.tradeoffs,
      revisitCondition: args.revisit_condition,
      category: args.category,
      relatedFiles: args.related_files,
    });

    let result = `✅ Decision recorded\n`;
    result += `   ID: ${decision.id}\n`;
    result += `   Description: ${decision.description}\n`;

    if (decision.rationale) {
      result += `   Rationale: ${decision.rationale}\n`;
    }

    if (decision.alternatives && decision.alternatives.length > 0) {
      result += `   Alternatives: ${decision.alternatives.join(', ')}\n`;
    }

    if (decision.tradeoffs) {
      result += `   Tradeoffs: ${decision.tradeoffs}\n`;
    }

    if (decision.revisitCondition) {
      result += `   Revisit: ${decision.revisitCondition}\n`;
    }

    if (decision.category) {
      result += `   Category: ${decision.category}\n`;
    }

    result += `   Timestamp: ${decision.timestamp.toISOString()}\n`;

    return result;
  }
}

export class GetDecisionsTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'get_decisions',
    description: `Retrieve recorded decisions for context and review.

Use this when:
- Understanding why certain approaches were chosen
- Resuming work after a session break
- Reviewing architectural decisions
- Needing to revisit previous decisions
- Looking for decisions related to specific files or categories

This helps maintain continuity and understand project history.`,
    parameters: {
      type: 'object',
      properties: {
        include_superseded: {
          type: 'boolean',
          description: 'Include decisions that have been superseded (default: false)',
        },
        category: {
          type: 'string',
          enum: ['architecture', 'implementation', 'tooling', 'approach', 'other', 'all'],
          description: 'Filter by category (default: all)',
        },
      },
      required: [],
    },
  };

  protected readonly schema = GetDecisionsSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof GetDecisionsSchema>): Promise<string> {
    const { include_superseded, category } = args;

    const allDecisions = this.memoryStore.getAllDecisions();
    const activeDecisions = this.memoryStore.getDecisions();

    const decisionsToShow = include_superseded
      ? allDecisions
      : activeDecisions;

    const filteredDecisions = category !== 'all'
      ? decisionsToShow.filter(d => d.category === category)
      : decisionsToShow;

    if (filteredDecisions.length === 0) {
      return `No decisions found${category !== 'all' ? ` for category: ${category}` : ''}.`;
    }

    let result = `📋 Decisions (${filteredDecisions.length})\n\n`;

    for (const decision of filteredDecisions) {
      result += `[${decision.id}]\n`;
      result += `Description: ${decision.description}\n`;

      if (decision.rationale) {
        result += `Rationale: ${decision.rationale}\n`;
      }

      if (decision.alternatives && decision.alternatives.length > 0) {
        result += `Alternatives:\n`;
        for (const alt of decision.alternatives) {
          result += `  - ${alt}\n`;
        }
      }

      if (decision.tradeoffs) {
        result += `Tradeoffs: ${decision.tradeoffs}\n`;
      }

      if (decision.revisitCondition) {
        result += `Revisit Condition: ${decision.revisitCondition}\n`;
      }

      if (decision.category) {
        result += `Category: ${decision.category}\n`;
      }

      if (decision.relatedFiles && decision.relatedFiles.length > 0) {
        result += `Related Files: ${decision.relatedFiles.join(', ')}\n`;
      }

      if (decision.supersededBy) {
        result += `⚠️  Superseded by: ${decision.supersededBy}\n`;
      }

      result += `Date: ${new Date(decision.timestamp).toLocaleString()}\n`;
      result += '\n';
    }

    return result.trim();
  }
}

export class SupersedeDecisionTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'supersede_decision',
    description: `Mark a decision as superseded by a new decision.

Use this when:
- Revisiting and changing a previous decision
- Replacing an old approach with a new one
- Documenting the evolution of technical choices

This maintains decision history while showing what is currently active.`,
    parameters: {
      type: 'object',
      properties: {
        old_decision_id: {
          type: 'string',
          description: 'ID of the decision being superseded',
        },
        new_decision_id: {
          type: 'string',
          description: 'ID of the new decision',
        },
      },
      required: ['old_decision_id', 'new_decision_id'],
    },
  };

  protected readonly schema = SupersedeDecisionSchema;
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    super();
    this.memoryStore = memoryStore;
  }

  protected async executeInternal(args: z.infer<typeof SupersedeDecisionSchema>): Promise<string> {
    const { old_decision_id, new_decision_id } = args;

    const oldDecision = this.memoryStore.getDecisionById(old_decision_id);
    const newDecision = this.memoryStore.getDecisionById(new_decision_id);

    if (!oldDecision) {
      return `❌ Error: Decision "${old_decision_id}" not found.`;
    }

    if (!newDecision) {
      return `❌ Error: Decision "${new_decision_id}" not found.`;
    }

    this.memoryStore.supersedeDecision(old_decision_id, new_decision_id);

    return `✅ Decision superseded\n` +
           `   Old: ${old_decision_id} - ${oldDecision.description}\n` +
           `   New: ${new_decision_id} - ${newDecision.description}\n` +
           `   ${new Date().toLocaleString()}\n`;
  }
}
