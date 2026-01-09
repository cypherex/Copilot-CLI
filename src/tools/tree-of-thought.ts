// Tree-of-Thought Tool - spawn parallel subagents to generate competing hypotheses/plans

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { SubAgentManager } from '../agent/subagent.js';
import type { MemoryStore } from '../memory/types.js';
import type { ConversationManager } from '../agent/conversation.js';
import { extractJsonObject } from '../utils/json-extract.js';
import { getRole } from '../agent/subagent-roles.js';
import { buildSubagentBrief, briefToSystemPrompt } from '../agent/subagent-brief.js';

const TreeOfThoughtSchema = z.object({
  mode: z.enum(['clarify', 'triage', 'diagnose', 'next_step', 'patch_plan']).optional().default('diagnose'),
  problem: z.string().min(1),
  branches: z.number().int().min(2).max(5).optional().default(3),
  role: z.string().optional().default('investigator'),
                  files: z.array(z.string()).optional(),
                        max_iterations: z.number().int().min(15).max(5000).optional().default(40),
                        min_iterations: z.number().int().min(0).max(100).optional().default(10),
                        allow_execute: z.boolean().optional().default(false),                    require_evidence: z.boolean().optional().default(true),  auto_reflect: z.boolean().optional().default(true),
  reflection_passes: z.number().int().min(0).max(3).optional().default(0),
});

type ToTMode = z.infer<typeof TreeOfThoughtSchema>['mode'];

type BranchSummary = {
  agent_id: string;
  branch: number;
  role: string;
  success: boolean;
  parsed_json?: any;
  parse_error?: string;
  output: string;
  tools_used: string[];
  score?: number;
  score_notes?: string[];
};

type ModeValidationResult = { ok: boolean; errors: string[] };

type RefinementSummary = {
  agent_id: string;
  pass: number;
  success: boolean;
  parsed_json?: any;
  parse_error?: string;
  output: string;
  tools_used: string[];
};

type RefinementValidationResult = { ok: boolean; errors: string[] };

function validateRefinementJson(parsed: any): RefinementValidationResult {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== 'object') return { ok: false, errors: ['Output is not a JSON object'] };

  if (typeof parsed.pass !== 'number') errors.push('Missing/invalid: pass (number)');
  if (typeof parsed.refined_focus !== 'string') errors.push('Missing/invalid: refined_focus (string)');
  if (!Array.isArray(parsed.missing_evidence)) errors.push('Missing/invalid: missing_evidence (string[])');
  if (!Array.isArray(parsed.risks)) errors.push('Missing/invalid: risks (string[])');
  if (!Array.isArray(parsed.improved_verification)) errors.push('Missing/invalid: improved_verification (string[])');

  return { ok: errors.length === 0, errors };
}

function truncateForPrompt(text: string, maxChars: number): string {
  const t = String(text ?? '');
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 20))}\n...<truncated>...`;
}

function validateBranchJson(mode: ToTMode, parsed: any): ModeValidationResult {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errors: ['Output is not a JSON object'] };
  }

  if (typeof parsed.branch !== 'number') errors.push('Missing/invalid: branch (number)');

  if (mode === 'clarify') {
    if (typeof parsed.interpretation !== 'string') errors.push('Missing/invalid: interpretation (string)');
    if (!Array.isArray(parsed.clarifying_questions)) errors.push('Missing/invalid: clarifying_questions (string[])');
    if (!Array.isArray(parsed.acceptance_criteria)) errors.push('Missing/invalid: acceptance_criteria (string[])');
    if (!Array.isArray(parsed.next_actions)) errors.push('Missing/invalid: next_actions (string[])');
  } else if (mode === 'triage') {
    if (typeof parsed.problem_summary !== 'string') errors.push('Missing/invalid: problem_summary (string)');
    if (typeof parsed.suspected_area !== 'string') errors.push('Missing/invalid: suspected_area (string)');
    if (!Array.isArray(parsed.quick_checks)) errors.push('Missing/invalid: quick_checks (string[])');
    if (!Array.isArray(parsed.next_experiment)) errors.push('Missing/invalid: next_experiment (string[])');
  } else if (mode === 'diagnose') {
    if (typeof parsed.hypothesis !== 'string') errors.push('Missing/invalid: hypothesis (string)');
    if (!Array.isArray(parsed.evidence_to_collect)) errors.push('Missing/invalid: evidence_to_collect (string[])');
    if (!Array.isArray(parsed.likely_files)) errors.push('Missing/invalid: likely_files (string[])');
    if (typeof parsed.proposed_fix !== 'string') errors.push('Missing/invalid: proposed_fix (string)');
    if (typeof parsed.next_experiment !== 'string') errors.push('Missing/invalid: next_experiment (string)');
    if (typeof parsed.decision_rule !== 'string') errors.push('Missing/invalid: decision_rule (string)');
    if (!Array.isArray(parsed.verification)) errors.push('Missing/invalid: verification (string[])');
  } else if (mode === 'next_step') {
    if (typeof parsed.primary_goal !== 'string') errors.push('Missing/invalid: primary_goal (string)');
    if (!Array.isArray(parsed.options)) errors.push('Missing/invalid: options (array)');
    if (typeof parsed.recommended_next !== 'string') errors.push('Missing/invalid: recommended_next (string)');
    if (!Array.isArray(parsed.verification)) errors.push('Missing/invalid: verification (string[])');
  } else if (mode === 'patch_plan') {
    if (typeof parsed.hypothesis !== 'string') errors.push('Missing/invalid: hypothesis (string)');
    if (!Array.isArray(parsed.files_to_change)) errors.push('Missing/invalid: files_to_change (string[])');
    if (typeof parsed.patch_sketch !== 'string') errors.push('Missing/invalid: patch_sketch (string)');
    if (typeof parsed.risk !== 'string') errors.push('Missing/invalid: risk (string)');
    if (!Array.isArray(parsed.verification)) errors.push('Missing/invalid: verification (string[])');
  }

  return { ok: errors.length === 0, errors };
}

function scoreBranch(mode: ToTMode, parsed: any): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 5; // Base score for pure reasoning

  // Experiment clarity (0-2)
  const hasExperiment =
    typeof parsed?.next_experiment === 'string' ||
    Array.isArray(parsed?.next_experiment) ||
    typeof parsed?.recommended_next === 'string';
  if (hasExperiment) score += 1;
  else notes.push('No explicit next experiment/step');

  const hasDecisionRule = typeof parsed?.decision_rule === 'string' || (Array.isArray(parsed?.options) && parsed.options.length > 0);
  if (hasDecisionRule) score += 1;
  else if (mode === 'diagnose') notes.push('No decision_rule to disambiguate');

  // Patch minimality (0-2)
  const patchText = String(parsed?.patch_sketch ?? parsed?.proposed_fix ?? '');
  if (patchText) {
    if (patchText.length < 600) score += 2;
    else score += 1;
  } else {
    if (mode === 'patch_plan' || mode === 'diagnose') notes.push('No patch_sketch/proposed_fix');
  }

  // Verification specificity (0-2)
  const verification = parsed?.verification;
  if (Array.isArray(verification) && verification.length > 0) {
    score += 1;
    if (verification.some((c: string) => /\b(test|pytest|jest|go test|cargo test|mvn|gradle)\b/i.test(String(c)))) {
      score += 1;
    }
  } else {
    notes.push('No verification commands');
  }

  // Bound to 0..10
  score = Math.max(0, Math.min(10, score));
  return { score, notes };
}

function formatForChat(
  mode: ToTMode,
  problem: string,
  branches: BranchSummary[],
  refinements: RefinementSummary[]
): string {
  const sorted = [...branches].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const top = sorted[0];

  const lines: string[] = [];
  lines.push(`[ToT Suggestions] mode=${mode} branches=${branches.length}`);
  lines.push('');
  lines.push('Problem:');
  lines.push(problem.trim());
  lines.push('');

  if (top) {
    lines.push(`Top branch: #${top.branch}${top.score !== undefined ? ` (score ${top.score.toFixed(1)}/10)` : ''}`);
    if (top.parsed_json) {
      const highlight =
        top.parsed_json.recommended_next ||
        top.parsed_json.next_experiment ||
        top.parsed_json.proposed_fix ||
        top.parsed_json.hypothesis ||
        top.parsed_json.problem_summary ||
        top.parsed_json.interpretation;
      if (typeof highlight === 'string') {
        lines.push(`Focus: ${highlight}`);
      }
      if (Array.isArray(top.parsed_json.verification) && top.parsed_json.verification.length > 0) {
        lines.push(`Verify: ${top.parsed_json.verification[0]}`);
      }
    } else if (top.parse_error) {
      lines.push(`Parse error: ${top.parse_error}`);
    }
    lines.push('');
  }

  lines.push('Branches (summary):');
  for (const b of sorted) {
    const prefix = `- #${b.branch}${b.score !== undefined ? ` (${b.score.toFixed(1)}/10)` : ''}${b.parse_error ? ' [invalid]' : ''}`;
    lines.push(prefix);
    if (b.parse_error) {
      lines.push(`  parse_error: ${b.parse_error}`);
      continue;
    }
    const p = b.parsed_json;
    const oneLiner =
      p?.recommended_next ||
      p?.next_experiment ||
      p?.proposed_fix ||
      p?.hypothesis ||
      p?.problem_summary ||
      p?.interpretation ||
      '';
    if (oneLiner) lines.push(`  ${String(oneLiner).split('\n')[0].slice(0, 180)}`);
    if (Array.isArray(p?.verification) && p.verification.length > 0) {
      lines.push(`  verify: ${String(p.verification[0]).slice(0, 180)}`);
    }
    if (b.score_notes && b.score_notes.length > 0) {
      lines.push(`  notes: ${b.score_notes.slice(0, 3).join('; ')}`);
    }
  }

  const validRefinements = refinements.filter((r) => !r.parse_error && r.parsed_json);
  if (validRefinements.length > 0) {
    lines.push('');
    lines.push('Refinement passes:');
    for (const r of validRefinements) {
      const p = r.parsed_json;
      lines.push(`- pass ${p.pass}: ${String(p.refined_focus).split('\n')[0].slice(0, 220)}`);
      if (Array.isArray(p.improved_verification) && p.improved_verification.length > 0) {
        lines.push(`  verify: ${String(p.improved_verification[0]).slice(0, 220)}`);
      }
      if (Array.isArray(p.missing_evidence) && p.missing_evidence.length > 0) {
        lines.push(`  missing_evidence: ${String(p.missing_evidence[0]).slice(0, 220)}`);
      }
      if (Array.isArray(p.risks) && p.risks.length > 0) {
        lines.push(`  risk: ${String(p.risks[0]).slice(0, 220)}`);
      }
    }
  }

  lines.push('');
  lines.push('Next: pick one branch and follow the suggested logic.');
  return lines.join('\n');
}

export class TreeOfThoughtTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'tree_of_thought',
    description: `Generate competing hypotheses/next steps by spawning multiple parallel subagents ("branches").

This is intended for runtime reasoning: clarifying an ask, triage, diagnosis, deciding next experiment, or planning a patch.
The tool is read-only by default (no file writes) and returns actionable suggestions (not an enforced decision).`,
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
        role: { type: 'string', description: 'Subagent role to use for branches (default: investigator)' },
        files: { type: 'array', items: { type: 'string' }, description: 'Optional relevant files to focus on' },
        max_iterations: { type: 'number', description: 'Max iterations per branch (default: 40)', default: 40 },
        min_iterations: { type: 'number', description: 'Min iterations per branch (default: 10)', default: 10 },
        allow_execute: { type: 'boolean', description: 'Allow execute_bash in branches (default: false)', default: false },
        require_evidence: { type: 'boolean', description: 'Require evidence block with citations (default: true)', default: true },
        auto_reflect: {
          type: 'boolean',
          description: 'Optionally run a post-pass synthesizer when results look weak (default: true)',
          default: true,
        },
        reflection_passes: {
          type: 'number',
          description: 'Force N refinement passes after branches (0-3, default: 0)',
          default: 0,
        },
      },
      required: ['problem'],
    },
  };

  protected readonly schema = TreeOfThoughtSchema;

  constructor(
    private subAgentManager: SubAgentManager,
    private memoryStore?: MemoryStore,
    private conversation?: ConversationManager
  ) {
    super();
  }

  protected async executeInternal(args: z.infer<typeof TreeOfThoughtSchema>): Promise<string> {
    const mode: ToTMode = args.mode ?? 'diagnose';
    const requireEvidence = false; // Pure reasoning agents don't gather new evidence
    const role = args.role || 'investigator';
    const roleConfig = getRole(role);

    // Pure reasoning: no tools allowed
    const allowedTools: string[] = [];

    // Extract recent conversation history if available
    let conversationContext = '';
    if (this.conversation) {
      const messages = this.conversation.getMessages();
      // Get last 15 messages, filtering out system messages and huge tool outputs
      const recent = messages
        .slice(-15)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          return `${m.role.toUpperCase()}: ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`;
        })
        .join('\n\n');
      
      if (recent) {
        conversationContext = `\nRECENT CONVERSATION HISTORY:\n${recent}\n`;
      }
    }

    const buildSchemaHint = (branch: number): string => {
      if (mode === 'clarify') {
        return `{
  "branch": ${branch},
  "interpretation": "<what the request is asking>",
  "unknowns": ["..."],
  "clarifying_questions": ["..."],
  "acceptance_criteria": ["..."],
  "next_actions": ["..."]
}`;
      }
      if (mode === 'triage') {
        return `{
  "branch": ${branch},
  "problem_summary": "<1-2 sentences>",
  "suspected_area": "<module/component>",
  "quick_checks": ["..."],
  "next_experiment": ["..."],
  "expected_observation": "<what you'd expect>",
  "decision_rule": "<how to choose after experiment>"
}`;
      }
      if (mode === 'next_step') {
        return `{
  "branch": ${branch},
  "primary_goal": "<what we are trying to prove or fix next>",
  "options": [
    { "name": "Option A", "why": "...", "experiment": "...", "expected": "...", "decision_rule": "..." },
    { "name": "Option B", "why": "...", "experiment": "...", "expected": "...", "decision_rule": "..." }
  ],
  "recommended_next": "<single best next step>",
  "verification": ["..."]
}`;
      }
      if (mode === 'patch_plan') {
        return `{
  "branch": ${branch},
  "hypothesis": "<root cause>",
  "files_to_change": ["..."],
  "patch_sketch": "<minimal diff sketch or edit instructions>",
  "risk": "<what could break>",
  "verification": ["..."]
}`;
      }
      // diagnose (default)
      return `{
  "branch": ${branch},
  "hypothesis": "<most likely root cause>",
  "evidence_to_collect": ["<MISSING INFO: what files/greps do you need?>"],
  "likely_files": ["..."],
  "proposed_fix": "<what to change>",
  "next_experiment": "<single experiment to disambiguate>",
  "expected_observation": "<what you'd expect>",
  "decision_rule": "<how to decide between hypotheses>",
  "verification": ["..."]
}`;
    };

    const branchPrompts = Array.from({ length: args.branches }, (_, idx) => {
      const branch = idx + 1;
      const specialization =
        mode === 'diagnose'
          ? (branch === 1
              ? 'Role: The Logic Analyst. Focus on rigorous control flow analysis and stack trace causality.'
              : branch === 2
                ? 'Role: The Pattern Detective. Focus on identifying implicit rules, subtle anomalies, and structural symmetries. Treat the code as a puzzle: what invariant property is being violated? Look for "spatial" relationships in data flow.'
                : 'Role: The Devil\'s Advocate. Actively try to disprove the leading hypothesis. Look for edge cases, race conditions, and hidden assumptions.')
          : mode === 'triage'
            ? (branch === 1 ? 'Role: The Rapid Responder. Focus on isolating the immediate failure domain.' : 'Role: The Context Mapper. Focus on recent changes and system-level dependencies.')
            : mode === 'clarify'
              ? (branch === 1 ? 'Role: The Literal Interpreter. Focus on exact requirements.' : 'Role: The Ambiguity Hunter. Focus on finding what is NOT stated.')
              : mode === 'next_step'
                ? (branch === 1 ? 'Role: The Pragmatist. Focus on the safest, smallest incremental step.' : 'Role: The Strategist. Focus on the high-leverage move that unlocks the most value.')
                : 'Role: The Architect. Focus on maintainability, robustness, and preventing regression.';

      return [
        `You are Branch ${branch}/${args.branches} in a Tree-of-Thought analysis.`,
        `You are a PURE REASONING AGENT. You do NOT have access to tools or the file system.`,
        `Rely entirely on the provided context, problem description, and your general knowledge.`,
        conversationContext,
        specialization,
        ``,
        `Problem:`,
        args.problem,
        ``,
        `Output ONLY valid JSON (no markdown) with this exact shape:`,
        buildSchemaHint(branch),
        ``,
        `Be concrete and analytical.`,
        `CRITICAL: Do not rush to a conclusion. You must spend at least 10 iterations expanding on your ideas. Use the "thinking" (reasoning) space effectively.`,
        `IF YOU LACK CONTEXT: Do not just list files. Perform a **Hypothetical Analysis**. Reason about dependencies: "If function A does X, then B must handle Y. I need to verify A." Use your iterations to build a precise "Information Acquisition Plan" in the 'evidence_to_collect' field.`,
        `   - If you identified missing context, your 'recommended_next' step should explicitly state: "Gather [specific evidence], then RE-RUN Tree of Thoughts to verify the hypothesis."`,
        `   - Avoid the "Streetlight Effect": Do not invent logic errors in the code you can see just because you cannot see the real source (e.g., imports, external libs). It is better to hypothesize about the invisible dependencies.`,
        ``,
        `METACOGNITIVE THINKING PROTOCOL (Guide - expand as needed):`,
        `1. [Iterations 1-3+] Deconstruction & Goal Alignment:`,
        `   - Re-read the goal. Are we solving the *right* problem? Challenge the premise.`,
        `   - List all assumptions. Which ones are unchecked?`,
        `2. [Iterations 4-6+] Pattern Recognition & Implicit Rules (ARC-AGI Style):`,
        `   - LOOK FOR PATTERNS: What repeating structures, naming conventions, or "shapes" are present?`,
        `   - Identify the "Invariant": What property *should* always hold true but is broken?`,
        `   - Look for "spatial" anomalies in data flow or file hierarchy.`,
        `3. [Iterations 7-8+] Red Teaming & Falsification:`,
        `   - Assume your best idea is WRONG. Why? Construct a counter-argument.`,
        `   - What evidence would definitively *disprove* your hypothesis?`,
        `4. [Iterations 9-10+] Synthesis & Abstraction:`,
        `   - Move from specific fix to general principle.`,
        `   - Propose a solution that restores the structural integrity of the system.`,
        `   - Finalize the JSON output only when you have high confidence.`,
      ].join('\n');
    });

    const agentIds = branchPrompts.map((task, idx) => {
      const brief = this.memoryStore && roleConfig
        ? buildSubagentBrief(task, this.memoryStore, {
            role: roleConfig,
            files: args.files,
            includeGoal: true,
            includeTaskHierarchy: true,
          })
        : undefined;

      const systemPrompt = brief ? briefToSystemPrompt(brief) : undefined;

      return this.subAgentManager.spawn({
        name: `ToT ${role} branch ${idx + 1}`,
        task,
        systemPrompt,
        maxIterations: args.max_iterations,
        minIterations: args.min_iterations,
        allowedTools,
      });
    });

    const results = await this.subAgentManager.waitAll(agentIds);

    const branches: BranchSummary[] = [];
    for (let i = 0; i < agentIds.length; i++) {
      const agentId = agentIds[i];
      const res = results.get(agentId);
      const output = res?.output ?? '';
      const parsed = extractJsonObject(output);

      const summary: BranchSummary = {
        agent_id: agentId,
        branch: i + 1,
        role,
        success: !!res?.success,
        parsed_json: parsed.parsed,
        parse_error: parsed.error,
        output,
        tools_used: res?.toolsUsed ?? [],
      };

      if (!summary.parse_error && summary.parsed_json) {
        const validation = validateBranchJson(mode, summary.parsed_json);
        if (!validation.ok) {
          summary.parse_error = validation.errors.join('; ');
        } else {
          const scored = scoreBranch(mode, summary.parsed_json);
          summary.score = scored.score;
          summary.score_notes = scored.notes;
        }
      }

      branches.push(summary);
    }

    const sorted = [...branches].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const top = sorted[0];

    const autoReflect = args.auto_reflect ?? true;
    const forcedPasses = args.reflection_passes ?? 0;

    const shouldAutoReflect = (() => {
      if (!autoReflect) return false;
      if (!top || top.parse_error || !top.parsed_json) return true;
      if ((top.score ?? 0) < 7) return true;
      if (!Array.isArray(top.parsed_json?.verification) || top.parsed_json.verification.length === 0) return true;
      if (requireEvidence) {
        const ev = top.parsed_json?.evidence;
        const files = Array.isArray(ev?.files_read) ? ev.files_read.length : 0;
        const snippets = Array.isArray(ev?.key_snippets) ? ev.key_snippets.length : 0;
        if (files < 1 || snippets < 1) return true;
      }
      return false;
    })();

    const passes = forcedPasses > 0 ? forcedPasses : shouldAutoReflect ? 1 : 0;
    const refinements: RefinementSummary[] = [];

    if (passes > 0) {
      const topCandidates = sorted.filter((b) => !b.parse_error && b.parsed_json).slice(0, 2);

      let previousRefinement: any | undefined;
      for (let pass = 1; pass <= passes; pass++) {
        const candidateBlock = topCandidates
          .map((b) => {
            const json = truncateForPrompt(JSON.stringify(b.parsed_json, null, 2), 3500);
            const notes = (b.score_notes ?? []).slice(0, 4).join('; ');
            return `Branch #${b.branch} (score ${b.score?.toFixed(1) ?? 'n/a'}/10)\nnotes: ${notes}\njson:\n${json}`;
          })
          .join('\n\n');

        const prevBlock = previousRefinement
          ? `\nPrevious refinement (pass ${pass - 1}):\n${truncateForPrompt(JSON.stringify(previousRefinement, null, 2), 2000)}\n`
          : '';

        const refinementTask = [
          `You are a post-pass synthesizer for a Tree-of-Thought run (refinement pass ${pass}/${passes}).`,
          `You must NOT modify files. Do NOT use create_file/patch_file/apply_unified_diff.`,
          `You may use read-only tools (read_file/grep_repo/list_files). If allowedTools include run_repro/verify_project/execute_bash, you may run commands to gather evidence.`,
          `Your job is to strengthen decision quality: identify missing evidence, key risks, and the tightest next step + verification.`,
          ``,
          `Mode: ${mode}`,
          `Problem:`,
          args.problem,
          ``,
          `Candidate branches:`,
          candidateBlock || '(no valid candidate branches)',
          prevBlock,
          `Output ONLY valid JSON (no markdown) with this exact shape:`,
          `{
  "pass": ${pass},
  "refined_focus": "<single best next step / experiment / patch direction>",
  "missing_evidence": ["<what to read/grep/run to disconfirm>"],
  "risks": ["<top risk/edge case>"],
  "improved_verification": ["<command(s) to verify>"]
}`,
          ``,
          `Be concrete. Prefer 1-2 missing_evidence items and 1-2 verification commands.`,
        ].join('\n');

        const refinementBrief = this.memoryStore && roleConfig
          ? buildSubagentBrief(refinementTask, this.memoryStore, {
              role: roleConfig,
              files: args.files,
              includeGoal: true,
              includeTaskHierarchy: true,
            })
          : undefined;

        const refinementSystemPrompt = refinementBrief ? briefToSystemPrompt(refinementBrief) : undefined;

        const refinementAgentId = this.subAgentManager.spawn({
          name: `ToT refinement pass ${pass}`,
          task: refinementTask,
          systemPrompt: refinementSystemPrompt,
          maxIterations: Math.min(500, args.max_iterations),
          minIterations: Math.max(1, Math.floor((args.min_iterations ?? 6) / 2)),
          allowedTools,
        });

        const refinementResult = await this.subAgentManager.waitAll([refinementAgentId]);
        const res = refinementResult.get(refinementAgentId);
        const output = res?.output ?? '';
        const parsed = extractJsonObject(output);

        const summary: RefinementSummary = {
          agent_id: refinementAgentId,
          pass,
          success: !!res?.success,
          parsed_json: parsed.parsed,
          parse_error: parsed.error,
          output,
          tools_used: res?.toolsUsed ?? [],
        };

        if (!summary.parse_error && summary.parsed_json) {
          const validation = validateRefinementJson(summary.parsed_json);
          if (!validation.ok) summary.parse_error = validation.errors.join('; ');
        }

        refinements.push(summary);
        if (!summary.parse_error && summary.parsed_json) previousRefinement = summary.parsed_json;
      }
    }

    return formatForChat(mode, args.problem, branches, refinements);
  }
}
