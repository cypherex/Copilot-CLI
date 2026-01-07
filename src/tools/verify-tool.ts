// Verify Tool - run verification commands and record results for completion gating

import { z } from 'zod';
import path from 'path';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { MemoryStore, CommandRecord, VerificationRecord } from '../memory/types.js';
import { execaBash } from '../utils/bash.js';

const VerifySchema = z.object({
  commands: z.array(z.string().min(1)).min(1).max(10).describe('Commands to run in order'),
  cwd: z.string().optional(),
  timeout_per_command: z.number().int().min(0).optional().default(600000),
  stop_on_fail: z.boolean().optional().default(true),
  store_output_chars: z.number().int().min(0).max(20000).optional().default(4000),
});

export class VerifyProjectTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'verify_project',
    description: `Run verification commands (tests/lint/build) and record a passing/failing result in working state.

Use this after implementing changes and before marking tasks as completed.`,
    parameters: {
      type: 'object',
      properties: {
        commands: { type: 'array', items: { type: 'string' }, description: 'Commands to run in order (1-10)' },
        cwd: { type: 'string', description: 'Working directory (default: current)' },
        timeout_per_command: { type: 'number', description: 'Timeout per command in ms (default: 600000)', default: 600000 },
        stop_on_fail: { type: 'boolean', description: 'Stop running commands on first failure (default: true)', default: true },
        store_output_chars: { type: 'number', description: 'How many output chars to store in memory (0-20000, default: 4000)', default: 4000 },
      },
      required: ['commands'],
    },
  };

  protected readonly schema = VerifySchema;

  constructor(private memoryStore: MemoryStore) {
    super();
  }

  protected async executeInternal(args: z.infer<typeof VerifySchema>): Promise<string> {
    const startedAt = new Date();
    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
    const timeout = args.timeout_per_command && args.timeout_per_command > 0 ? args.timeout_per_command : undefined;

    const results: VerificationRecord['results'] = [];
    const commandRecords: CommandRecord[] = [];
    let passed = true;

    for (const command of args.commands) {
      const start = Date.now();
      const res = await execaBash(command, { cwd, timeout, all: true, reject: false });
      const durationMs = Date.now() - start;
      const exitCode = res.exitCode ?? 0;
      const output = res.all ?? '';

      results.push({ command, exitCode, durationMs });
      commandRecords.push({
        id: `cmd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        command,
        cwd,
        exitCode,
        kind: 'verify',
        timestamp: new Date(),
        outputSnippet: args.store_output_chars > 0 ? output.slice(-args.store_output_chars) : undefined,
      });

      if (exitCode !== 0) {
        passed = false;
        if (args.stop_on_fail) break;
      }
    }

    const finishedAt = new Date();

    const verification: VerificationRecord = {
      id: `verify_${Date.now()}`,
      commands: args.commands,
      cwd,
      passed,
      startedAt,
      finishedAt,
      results,
    };

    const working = this.memoryStore.getWorkingState();
    this.memoryStore.updateWorkingState({
      commandHistory: [...(working.commandHistory || []), ...commandRecords].slice(-50),
      lastVerification: verification,
    });

    return JSON.stringify(
      {
        kind: 'verification',
        cwd,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        passed,
        results,
      },
      null,
      2
    );
  }
}

