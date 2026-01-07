// Repro Tool - run and record a minimal reproduction command (usually a targeted test)

import { z } from 'zod';
import path from 'path';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import type { MemoryStore, CommandRecord } from '../memory/types.js';
import { execaBash } from '../utils/bash.js';

const ReproSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeout: z.number().int().min(0).optional().default(300000),
  store_output_chars: z.number().int().min(0).max(20000).optional().default(4000),
});

export class RunReproTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'run_repro',
    description: `Run a minimal reproduction command (typically a targeted failing test) and record the result in working state.

Use this before making changes so the agent can reason from real failures and stack traces.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run (e.g., "pytest -q tests/test_x.py::test_y")' },
        cwd: { type: 'string', description: 'Working directory (default: current)' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 300000)', default: 300000 },
        store_output_chars: { type: 'number', description: 'How many output chars to store in memory (0-20000, default: 4000)', default: 4000 },
      },
      required: ['command'],
    },
  };

  protected readonly schema = ReproSchema;

  constructor(private memoryStore: MemoryStore) {
    super();
  }

  protected async executeInternal(args: z.infer<typeof ReproSchema>): Promise<string> {
    const startedAt = new Date();
    const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
    const timeout = args.timeout && args.timeout > 0 ? args.timeout : undefined;

    const result = await execaBash(args.command, {
      cwd,
      timeout,
      all: true,
      reject: false,
    });

    const finishedAt = new Date();
    const output = result.all ?? '';
    const snippet = args.store_output_chars > 0 ? output.slice(-args.store_output_chars) : undefined;

    const record: CommandRecord = {
      id: `cmd_${Date.now()}`,
      command: args.command,
      cwd,
      exitCode: result.exitCode ?? 0,
      kind: 'repro',
      timestamp: finishedAt,
      outputSnippet: snippet,
    };

    const working = this.memoryStore.getWorkingState();
    this.memoryStore.updateWorkingState({
      commandHistory: [...(working.commandHistory || []), record].slice(-50),
      lastRepro: record,
    });

    const payload = {
      kind: 'repro',
      command: args.command,
      cwd,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      exitCode: result.exitCode,
      output,
    };

    return JSON.stringify(payload, null, 2);
  }
}

