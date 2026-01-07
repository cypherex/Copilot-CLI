// Explore Codebase Tool - spawn a read-only explorer subagent and return a structured summary

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { SubAgentManager, SubAgentResult } from '../agent/subagent.js';
import type { MemoryStore } from '../memory/types.js';
import { buildSubagentBrief, briefToSystemPrompt } from '../agent/subagent-brief.js';
import { extractJsonObject } from '../utils/json-extract.js';
import { uiState } from '../ui/ui-state.js';
import { promises as fs } from 'fs';
import path from 'path';

const ExploreCodebaseSchema = z.object({
  question: z.string().describe('What you want to learn/find in the codebase'),
  directory: z.string().optional().describe('Working directory for exploration (defaults to current)'),
  hints: z.array(z.string()).optional().describe('Optional hints/constraints to guide exploration'),
  files: z.array(z.string()).optional().describe('Optional known-relevant files to prioritize'),
  depth: z.enum(['shallow', 'normal', 'deep']).optional().default('normal')
    .describe('Exploration depth (controls iteration budget)'),
  repair: z.boolean().optional().default(true)
    .describe('Attempt a 1-shot JSON repair pass if output is not valid JSON (default: true)'),
  timeout_ms: z.number().int().min(0).max(300000).optional().default(0)
    .describe('Overall timeout for exploration in ms (0 disables; default: 0)'),
});

const EXPLORER_SCHEMA_PROMPT = `Return ONE valid JSON object and nothing else (no markdown or code fences).

Schema:
{
  "question": string,
  "inferredUserGoal": string | null,
  "confidence": number,
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
      "source": string,
      "lineStart": number | null,
      "lineEnd": number | null,
      "excerpt": string
    }>,
    "relevance": string
  }>,
  "missingInfoQuestions": string[],
  "recommendedNextAction": "ask_confirmation" | "ask_clarifying_questions" | "ready_to_plan"
}`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs)),
  ]);
}

export class ExploreCodebaseTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'explore_codebase',
    description: `Spawn a read-only "explorer" subagent to explore the repo and return a structured JSON summary with evidence.

Use this when the user request is underspecified for an existing project, or anytime you need to locate code/ownership quickly before planning changes.`,
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        directory: { type: 'string' },
        hints: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } },
        depth: { type: 'string', enum: ['shallow', 'normal', 'deep'], default: 'normal' },
        repair: { type: 'boolean', default: true },
        timeout_ms: { type: 'number', default: 0, description: 'Overall timeout in ms (0 disables)' },
      },
      required: ['question'],
    },
  };

  protected readonly schema = ExploreCodebaseSchema;

  constructor(
    private subAgentManager: SubAgentManager,
    private memoryStore: MemoryStore,
  ) {
    super();
  }

  protected async executeInternal(args: z.infer<typeof ExploreCodebaseSchema>): Promise<string> {
    // No max-iteration cap for explorer; use `timeout_ms` to bound runtime if desired.
    // (We previously capped iterations here, but tool-driven subagents can legitimately need
    // multiple tool rounds before synthesizing a final answer.)
    const maxIterations = 0;
    const timeoutMs = args.timeout_ms;

    const additionalContextParts: string[] = [];
    if (args.hints && args.hints.length > 0) {
      additionalContextParts.push('Hints:');
      for (const hint of args.hints.slice(0, 10)) additionalContextParts.push(`- ${hint}`);
    }

    const defaultFiles = args.files && args.files.length > 0
      ? args.files
      : ['README.md', 'package.json', 'docs/README.md', 'src/index.ts', 'src/agent/index.ts'];

    const brief = buildSubagentBrief(args.question, this.memoryStore, {
      role: 'explorer',
      files: defaultFiles,
      includeGoal: true,
      includeTaskHierarchy: false,
      includePreferences: true,
      includeTechStack: true,
      includeConventions: true,
      includeRecentErrors: false,
      additionalContext: additionalContextParts.length > 0 ? additionalContextParts.join('\n') : undefined,
      successCriteria: 'Return valid JSON matching the explorer output schema, with concise evidence.',
    });

    const systemPrompt = briefToSystemPrompt(brief);

    uiState.addMessage({
      role: 'system',
      content: 'Starting codebase exploration...',
      timestamp: Date.now(),
    });

    const debugExplorer = !!process.env.DEBUG_EXPLORER || !!process.env.DEBUG_SUBAGENT;
    const debugDump = !!process.env.DEBUG_EXPLORER_DUMP;
    const debugLines: string[] = [];

    const agentId = this.subAgentManager.spawn({
      name: `explorer_${Date.now()}`,
      task: args.question,
      systemPrompt,
      maxIterations,
      workingDirectory: args.directory,
      allowedTools: ['read_file', 'grep_repo'],
      outputJsonFromReasoning: true,
    });

    const toolFailures: Array<{ toolName: string; error?: string }> = [];

    const onToolCall = (data: any) => {
      if (data.agentId !== agentId) return;
      const argsPreview = data.args ? JSON.stringify(data.args).slice(0, 180) : '';
      const parseErrorPreview = data.parseError ? String(data.parseError).slice(0, 120) : '';
      uiState.addMessage({
        role: 'system',
        content:
          '[explorer] Executing: ' +
          data.toolName +
          (argsPreview ? ` args=${argsPreview}${argsPreview.length >= 180 ? '…' : ''}` : '') +
          (parseErrorPreview ? ` parseError=${parseErrorPreview}${String(data.parseError).length > 120 ? '…' : ''}` : ''),
        timestamp: Date.now(),
      });
      if (debugDump) {
        debugLines.push(`[tool_call] ${data.toolName}`);
        if (data.args) debugLines.push(`[tool_call_args] ${JSON.stringify(data.args)}`);
        if (data.parseError) debugLines.push(`[tool_call_parse_error] ${String(data.parseError)}`);
      }
    };
    const onToolResult = (data: any) => {
      if (data.agentId !== agentId) return;
      const status = data.success ? 'completed' : 'failed';
      const errorPreview = !data.success && data.error ? ': ' + String(data.error).slice(0, 180) : '';
      if (!data.success) {
        toolFailures.push({ toolName: data.toolName, error: data.error ? String(data.error) : undefined });
      }
      uiState.addMessage({
        role: 'system',
        content: '[explorer] ' + data.toolName + ' ' + status + errorPreview,
        timestamp: Date.now(),
      });
      if (debugDump) {
        debugLines.push(`[tool_result] ${data.toolName} ${status}${data.error ? ` error=${String(data.error)}` : ''}`);
      }
    };

    const onMessage = (data: any) => {
      if (data.agentId !== agentId) return;
      if (debugDump && data.content) {
        debugLines.push(`[message:${data.type || 'message'}] ${String(data.content).replace(/\r\n/g, '\n')}`);
      }
      if (!debugExplorer) return;
      if (!data.content) return;
      const preview = String(data.content).replace(/\s+/g, ' ').slice(0, 200);
      uiState.addMessage({
        role: 'system',
        content: `[explorer] ${data.type || 'message'}: ${preview}${String(data.content).length > 200 ? '…' : ''}`,
        timestamp: Date.now(),
      });
    };

    this.subAgentManager.on('tool_call', onToolCall);
    this.subAgentManager.on('tool_result', onToolResult);
    this.subAgentManager.on('message', onMessage);

    let result: SubAgentResult;
    try {
      const waitPromise = this.subAgentManager.wait(agentId);
      result = timeoutMs && timeoutMs > 0
        ? await withTimeout(waitPromise, timeoutMs, `Explorer timed out after ${timeoutMs}ms`)
        : await waitPromise;
    } finally {
      this.subAgentManager.off('tool_call', onToolCall);
      this.subAgentManager.off('tool_result', onToolResult);
      this.subAgentManager.off('message', onMessage);
    }

    const raw = result.output || '';

    uiState.addMessage({
      role: 'system',
      content: `[explorer] Completed: success=${result.success} iterations=${result.iterations} toolsUsed=${(result.toolsUsed || []).join(',') || '(none)'} outputLen=${raw.trim().length}`,
      timestamp: Date.now(),
    });

    if (debugDump) {
      try {
        const dumpDir = path.join(args.directory || process.cwd(), 'testbox', 'explorer-debug');
        await fs.mkdir(dumpDir, { recursive: true });
        const dumpPath = path.join(dumpDir, `${agentId}.log`);
        const header = `agentId=${agentId}\nsuccess=${result.success}\niterations=${result.iterations}\ntoolsUsed=${(result.toolsUsed || []).join(',')}\n\n`;
        await fs.writeFile(dumpPath, header + debugLines.join('\n') + '\n\n[raw_output]\n' + raw + '\n', 'utf-8');
        uiState.addMessage({
          role: 'system',
          content: `[explorer] Debug dump written: ${dumpPath}`,
          timestamp: Date.now(),
        });
      } catch (e) {
        uiState.addMessage({
          role: 'system',
          content: `[explorer] Debug dump failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        });
      }
    }

    if (!raw.trim()) {
      return JSON.stringify({
        tool: 'explore_codebase',
        agentId,
        success: true,
        iterations: result.iterations,
        toolsUsed: result.toolsUsed,
        result: {
          question: args.question,
          inferredUserGoal: null,
          confidence: 0,
          repoMap: { entrypoints: [], keyDirs: [], configFiles: [], commands: [] },
          findings: toolFailures.length > 0 ? [{
            summary: 'Explorer returned empty output; some tool calls failed during exploration.',
            evidence: toolFailures.slice(0, 5).map(f => ({
              kind: 'grep',
              source: f.toolName,
              lineStart: null,
              lineEnd: null,
              excerpt: f.error ? f.error.slice(0, 240) : '(no error provided)',
            })),
            relevance: 'Exploration did not produce a structured summary; re-run after fixing tool invocation issues or try different hints/files.',
          }] : [],
          missingInfoQuestions: [
            'Explorer produced empty output. Re-run with more specific question or provide known relevant files/paths.',
          ],
          recommendedNextAction: 'ask_clarifying_questions',
        },
      }, null, 2);
    }
    if (!result.success) {
      const preview = raw.trim().slice(0, 800);
      throw new Error(
        `Explorer subagent failed (${agentId}): ${result.error || 'unknown error'}` +
        (preview ? `\nOutput preview:\n${preview}` : '')
      );
    }

    const parsed = extractJsonObject(raw);
    if (parsed.parsed) {
      return JSON.stringify({
        tool: 'explore_codebase',
        agentId,
        success: true,
        iterations: result.iterations,
        toolsUsed: result.toolsUsed,
        result: parsed.parsed,
      }, null, 2);
    }

    // Optional 1-shot repair pass: convert whatever text we got into valid JSON.
    if (args.repair && raw.trim()) {
      const formatterPrompt = [
        'You are a JSON reformatter.',
        'You will be given TEXT that should describe repo exploration findings.',
        EXPLORER_SCHEMA_PROMPT,
        '',
        'Rules:',
        '- Output MUST be valid JSON and MUST match the schema.',
        '- Do NOT include markdown, code fences, or commentary.',
        '- If some fields are unknown, use empty arrays, nulls, or conservative defaults.',
        '',
        'TEXT TO CONVERT:',
        raw.slice(0, 12000),
      ].join('\\n');

      const repairId = this.subAgentManager.spawn({
        name: `explorer_repair_${Date.now()}`,
        task: formatterPrompt,
        systemPrompt: [
          'You are a format-only assistant.',
          'You have NO tools.',
          'Return only JSON.',
        ].join('\\n'),
        maxIterations: 1,
        workingDirectory: args.directory,
        allowedTools: [], // no tools
        outputJsonFromReasoning: true,
      });

      const repairWaitPromise = this.subAgentManager.wait(repairId);
      const repairResult = timeoutMs && timeoutMs > 0
        ? await withTimeout(repairWaitPromise, Math.min(30000, timeoutMs), `Explorer repair timed out`)
        : await repairWaitPromise;
      if (repairResult.success) {
        const repaired = extractJsonObject(repairResult.output || '');
        if (repaired.parsed) {
          return JSON.stringify({
            tool: 'explore_codebase',
            agentId,
            repairedFromAgentId: repairId,
            success: true,
            iterations: result.iterations + repairResult.iterations,
            toolsUsed: Array.from(new Set([...(result.toolsUsed || []), ...(repairResult.toolsUsed || [])])),
            result: repaired.parsed,
          }, null, 2);
        }
      }
    }

    const detail = parsed.error || 'JSON parse failed';
    const preview = raw.trim().slice(0, 800);
    throw new Error(
      `Explorer produced invalid/empty output (${agentId}): ${detail}` +
      (preview ? `\\nOutput preview:\\n${preview}` : '\\nOutput preview: (empty)')
    );
  }
}
