// Tree-of-Thought Tool - Standalone reasoning engine
// Generates competing hypotheses/plans using a 4-phase metacognitive protocol

import { z } from 'zod';
import chalk from 'chalk';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './types.js';
import type { LLMClient, ChatMessage } from '../llm/types.js';
import { StreamAccumulator } from '../llm/streaming.js';
import { extractJsonObject } from '../utils/json-extract.js';
import { getRole } from '../agent/subagent-roles.js';
import { buildSubagentBrief, briefToSystemPrompt } from '../agent/subagent-brief.js';
import { uiState } from '../ui/ui-state.js';
import type { MemoryStore } from '../memory/types.js';

const TreeOfThoughtSchema = z.object({
  mode: z.enum(['clarify', 'triage', 'diagnose', 'next_step', 'patch_plan']).optional().default('diagnose'),
  problem: z.string().min(1),
  branches: z.number().int().min(2).max(5).optional().default(3),
  role: z.string().optional().default('investigator'),
  files: z.array(z.string()).optional(),
  max_iterations: z.number().int().min(15).max(5000).optional().default(40),
  min_iterations: z.number().int().min(0).max(100).optional().default(10),
  auto_reflect: z.boolean().optional().default(true),
  reflection_passes: z.number().int().min(0).max(3).optional().default(0),
});

type ToTMode = z.infer<typeof TreeOfThoughtSchema>['mode'];

interface BranchResult {
  branchIdx: number;
  success: boolean;
  output: string;
  parsedJson?: any;
  parseError?: string;
  iterations: number;
  score?: number;
  scoreNotes?: string[];
}

/**
 * Unique Branch Runner - manages the reasoning loop for a single ToT branch
 */
class BranchRunner {
  private messages: ChatMessage[] = [];
  private currentIteration = 0;
  private branchId: string;

  constructor(
    private branchIdx: number,
    private totalBranches: number,
    private llmClient: LLMClient,
    private systemPrompt: string,
    private userTask: string,
    private maxIterations: number,
    private minIterations: number,
    private mode: string
  ) {
    this.branchId = `tot_branch_${Date.now()}_${branchIdx}`;
    // Push context first
    this.messages.push({ role: 'user', content: userTask });
    // Push rules/persona last so they are more impactful
    this.messages.push({ role: 'system', content: systemPrompt });
  }

  async run(): Promise<BranchResult> {
    const shortId = this.branchId.slice(-6);
    uiState.addMessage({
      role: 'system',
      content: `[ToT] Branch ${this.branchIdx} starting reasoning loop...`,
      timestamp: Date.now()
    });

    let finalOutput = '';
    let success = true;
    let errorMsg: string | undefined;

    try {
      // Add a small staggered delay based on branch index to prevent API collision
      await new Promise(resolve => setTimeout(resolve, (this.branchIdx - 1) * 800));

      while (this.currentIteration < this.maxIterations) {
        this.currentIteration++;
        
        const phase = this.getPhase(this.currentIteration);
        
        // Inject iteration directive
        if (this.currentIteration <= this.minIterations) {
          const directive = this.currentIteration === this.minIterations
            ? `CRITICAL: Reasoning phase complete. You MUST now output your FINAL RESPONSE in the valid JSON format specified. Output JSON only.`
            : `Continue reasoning (Phase: ${phase}). Iteration ${this.currentIteration}/${this.minIterations} (min). Expand your thoughts.`;
          this.messages.push({ role: 'system', content: `[System] ${directive}` });
        }

        const accumulator = new StreamAccumulator();
        try {
          for await (const chunk of this.llmClient.chatStream(this.messages, [])) {
            accumulator.addChunk(chunk);
          }
        } catch (streamErr: any) {
          console.error(`[ToT Error] Branch ${this.branchIdx} stream failed: ${streamErr.message}`);
          throw streamErr;
        }

        const response = accumulator.getResponse();
        const content = response.content || '';
        this.messages.push({ role: 'assistant', content, reasoningContent: response.reasoningContent });

        // Update the UI with the full thought (no slicing)
        uiState.addMessage({
          role: 'system',
          content: `[ToT Branch ${this.branchIdx}][Iter ${this.currentIteration}] ${content.trim()}`,
          timestamp: Date.now()
        });

        // Check if we have JSON and are past minIterations
        const hasJson = content.includes('{') && content.includes('}');
        if (hasJson && this.currentIteration >= this.minIterations) {
          finalOutput = content;
          break; 
        }

        // If it provided JSON too early, tell it to keep thinking
        if (hasJson && this.currentIteration < this.minIterations) {
          this.messages.push({ role: 'user', content: `Good start, but continue exploring. Do not finalize yet. Reach iteration ${this.minIterations} first.` });
        }
        
        // If we reached max iterations without JSON, use the last content
        if (this.currentIteration >= this.maxIterations) {
          finalOutput = content;
        }
      }
    } catch (err: any) {
      success = false;
      errorMsg = err.message;
      uiState.addMessage({
        role: 'system',
        content: `[ToT Error] Branch ${this.branchIdx} CRASHED: ${err.message}`,
        timestamp: Date.now()
      });
    }

    const parsed = extractJsonObject(finalOutput);

    return {
      branchIdx: this.branchIdx,
      success,
      output: finalOutput,
      parsedJson: parsed.parsed,
      parseError: parsed.error || errorMsg,
      iterations: this.currentIteration,
    };
  }

  private getPhase(iter: number): string {
    if (iter <= 3) return 'Deconstruction';
    if (iter <= 6) return 'Pattern Recognition';
    if (iter <= 8) return 'Red Teaming';
    return 'Synthesis';
  }

  private updateUi(status: string) {
    const shortId = this.branchId.slice(-6);
    uiState.updateLiveMessage(this.branchId, {
      content: chalk.yellow(`▶ [ToT] Branch ${this.branchIdx}/${this.totalBranches} (${shortId})
  Status: ${status}`),
    });
  }

    private updateUiPreview(content: string) {
      const shortId = this.branchId.slice(-6);
      const preview = content.trim() || '...';
      uiState.updateLiveMessage(this.branchId, {
        content: chalk.yellow(`▶ [ToT] Branch ${this.branchIdx}/${this.totalBranches} (${shortId})
  `) +
                 chalk.dim(`  Current Thought: ${preview}`) + `
  ` +
                 chalk.cyan(`  Iter: ${this.currentIteration}/${this.minIterations}+`),
      });
      
      // Also push a system message for the trace log
      uiState.addMessage({
        role: 'system',
        content: `[ToT Branch ${this.branchIdx}] ${preview}`,
        timestamp: Date.now()
      });
    }}

export class TreeOfThoughtTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'tree_of_thought',
    description: `Perform high-level architectural reasoning by spawning parallel "thought branches". 
Use this for complex triage, diagnosis, or strategy formulation where multiple competing hypotheses are needed.
The tool is read-only and returns actionable suggestions.`,
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['clarify', 'triage', 'diagnose', 'next_step', 'patch_plan'],
          description: 'Reasoning mode (default: diagnose)',
        },
        problem: { type: 'string', description: 'Problem statement / bug description' },
        branches: { type: 'number', description: 'Number of branches (2-5, default: 3)', default: 3 },
        role: { type: 'string', description: 'Reasoning persona (default: investigator)' },
        files: { type: 'array', items: { type: 'string' }, description: 'Optional relevant files' },
        max_iterations: { type: 'number', description: 'Max iterations per branch', default: 40 },
        min_iterations: { type: 'number', description: 'Min iterations (enforces depth)', default: 10 },
      },
      required: ['problem'],
    },
  };

  protected readonly schema = TreeOfThoughtSchema;

  constructor(
    private memoryStore?: MemoryStore
  ) {
    super();
  }

  protected async executeInternal(args: z.infer<typeof TreeOfThoughtSchema>, context?: ToolExecutionContext): Promise<string> {
    const { mode = 'diagnose', problem, branches: numBranches = 3, role = 'investigator' } = args;
    const llmClient = context?.llmClient;
    const conversation = context?.conversation;

    if (!llmClient) {
      throw new Error('LLM client not available in tool execution context');
    }

    uiState.addMessage({
      role: 'system',
      content: chalk.bold(`
🧠 STARTING STANDALONE TREE OF THOUGHT (${mode.toUpperCase()} MODE)`),
      timestamp: Date.now()
    });

    const conversationContext = this.extractRecentContext(conversation);
    const branchPrompts = this.buildBranchPrompts(numBranches, problem, mode, conversationContext);

    // Run branches in parallel
    const runners = branchPrompts.map((task, idx) => {
      const brief = this.memoryStore ? buildSubagentBrief(task, this.memoryStore, {
        role: getRole(role) || getRole('investigator')!,
        files: args.files,
        includeGoal: true,
        includeTaskHierarchy: true,
      }) : undefined;

      const systemPrompt = brief ? briefToSystemPrompt(brief) : 'You are a reasoning agent.';

      return new BranchRunner(
        idx + 1,
        numBranches,
        llmClient,
        systemPrompt,
        task,
        args.max_iterations,
        args.min_iterations,
        mode
      );
    });

    const results = await Promise.all(runners.map(r => r.run()));

    // Process and format results
    const summaries: BranchResult[] = results.map(res => {
      const scored = this.scoreResult(mode, res.parsedJson);
      return { ...res, score: scored.score, scoreNotes: scored.notes };
    });

    const finalOutput = this.formatFinalSummary(mode, problem, summaries);
    
    uiState.addMessage({
      role: 'system',
      content: chalk.green(`✓ Tree of Thought reasoning complete. Synthesizing ${summaries.length} branches.`),
      timestamp: Date.now()
    });

    return finalOutput;
  }

  private extractRecentContext(conversation?: any): string {
    if (!conversation) return '';
    const messages = conversation.getMessages();
    return messages.slice(-10)
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`)
      .join('\n\n');
  }

  private buildBranchPrompts(count: number, problem: string, mode: ToTMode, context: string): string[] {
    return Array.from({ length: count }, (_, i) => {
      const branch = i + 1;
      const specialization = this.getSpecialization(mode, branch);
      return [
        `You are Branch ${branch}/${count} in a Tree-of-Thought analysis.`, 
        `Role: ${specialization}`,
        `You are a PURE REASONING ENGINE. You have NO TOOLS.`, 
        `Problem: ${problem}`, 
        `Context: ${context}`, 
        `Output ONLY valid JSON at the end of your reasoning phase.`, 
        this.getSchemaHint(mode, branch)
      ].join('\n\n');
    });
  }

  private getSpecialization(mode: string, branch: number): string {
    const specs: Record<string, string[]> = {
      diagnose: ['Logic Analyst (Rigorous flow)', 'Pattern Detective (Structural anomalies)', 'Devil\'s Advocate (Disprove hypotheses)'],
      triage: ['Rapid Responder (Domain isolation)', 'Context Mapper (Dependencies)', 'Impact Auditor (Blast radius)'],
      next_step: ['Pragmatist (Smallest safe step)', 'Strategist (High-leverage)', 'Architect (Robustness)']
    };
    return specs[mode]?.[branch - 1] || 'General Analyst';
  }

  private getSchemaHint(mode: string, branch: number): string {
    return `Final JSON Schema: {"branch": ${branch}, "hypothesis": "...", "recommended_next": "...", "verification": ["..."]}`;
  }

  private scoreResult(mode: string, parsed: any): { score: number; notes: string[] } {
    if (!parsed) return { score: 0, notes: ['Invalid JSON output'] };
    let score = 5;
    const notes = [];
    if (parsed.recommended_next) score += 2; else notes.push('Missing next step');
    if (parsed.verification?.length > 0) score += 2; else notes.push('Missing verification');
    return { score, notes };
  }

  private formatFinalSummary(mode: string, problem: string, branches: BranchResult[]): string {
    const sorted = [...branches].sort((a, b) => (b.score || 0) - (a.score || 0));
    const lines = [
      `[ToT Standalone Summary] Mode: ${mode}`,
      `Problem: ${problem}`,
      '',
      `Top Recommendation (Branch #${sorted[0].branchIdx}):`,
      `  Focus: ${sorted[0].parsedJson?.recommended_next || 'N/A'}`,
      `  Verify: ${sorted[0].parsedJson?.verification?.[0] || 'N/A'}`,
      '',
      'Branch Summaries:'
    ];

    for (const b of sorted) {
      lines.push(`- Branch #${b.branchIdx} (Score: ${b.score}/9): ${b.parsedJson?.hypothesis || 'No hypothesis'}`);
    }

    lines.push('\nSYSTEM: Reasoning complete. ACT NOW. Use read_file or create_task to execute the top plan.');
    return lines.join('\n');
  }
}