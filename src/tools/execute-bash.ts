// Execute Bash Tool

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import { execaBash } from '../utils/bash.js';

const executeBashSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().int().min(0).optional().default(30000),
});

export class ExecuteBashTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'execute_bash',
    description: `Execute a shell command. Returns stdout/stderr. Can execute Python scripts via "python script.py".

⚡ PERFORMANCE TIP: Running multiple INDEPENDENT commands? Use the parallel tool to run them simultaneously.

Example - GOOD (parallel for independent commands):
  parallel({ tools: [
    { tool: "execute_bash", parameters: { command: "npm run lint" } },
    { tool: "execute_bash", parameters: { command: "npm run test" } },
    { tool: "execute_bash", parameters: { command: "npm run build" } }
  ]})

Example - BAD (sequential when could be parallel):
  execute_bash({ command: "npm run lint" })
  execute_bash({ command: "npm run test" })
  execute_bash({ command: "npm run build" })

Note: Only use parallel for commands that don't depend on each other.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute (e.g., "ls -la", "python script.py")' },
        cwd: { type: 'string', description: 'Working directory for command execution' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)', default: 30000 },
      },
      required: ['command'],
    },
  };

  protected readonly schema = executeBashSchema;

  private compilePatterns(patterns: string[] | undefined): RegExp[] {
    if (!patterns || patterns.length === 0) return [];
    const compiled: RegExp[] = [];
    for (const p of patterns) {
      try {
        compiled.push(new RegExp(p, 'i'));
      } catch {
        // Ignore invalid patterns
      }
    }
    return compiled;
  }

  private enforcePolicy(command: string, timeoutMs: number | undefined, policy: any): { timeoutMs?: number } {
    if (!policy) return { timeoutMs };

    const mode = policy.mode as string | undefined;
    const bashPolicy = policy.executeBash || {};

    const defaultEvalDeny = [
      '\\bcurl\\b',
      '\\bwget\\b',
      '\\bInvoke-WebRequest\\b',
      '\\bpowershell\\s+-Command\\b',
      '\\bgit\\s+clone\\b',
      '\\bnpm\\s+(install|ci)\\b',
      '\\bpnpm\\s+(install|add)\\b',
      '\\byarn\\s+(install|add)\\b',
      '\\bpip(3)?\\s+install\\b',
      '\\bapt(-get)?\\s+(install|update|upgrade)\\b',
      '\\bbrew\\s+install\\b',
      '\\bchoco\\s+install\\b',
      '\\bdocker\\b',
      '\\bssh\\b',
      '\\bscp\\b',
    ];

    const defaultJudgeDeny = [
      ...defaultEvalDeny,
      // Disallow Git and shell composition in judge mode.
      '\\bgit\\b',
      '[;&|]',
      '>>',
      '>',
      '\\brm\\b',
      '\\bdel\\b',
      '\\bmv\\b',
      '\\bcopy\\b',
      '\\bmove\\b',
    ];

    const defaultDeny = mode === 'judge' ? defaultJudgeDeny : mode === 'eval' ? defaultEvalDeny : [];

    const defaultAllow = mode === 'judge'
      ? [
          // Allow running local test/smoke commands only.
          '^(node|python|cargo)(\\s|$)',
        ]
      : undefined;

    const allowPatterns = this.compilePatterns(bashPolicy.allowPatterns ?? defaultAllow);
    const denyPatterns = this.compilePatterns(bashPolicy.denyPatterns && bashPolicy.denyPatterns.length > 0
      ? bashPolicy.denyPatterns
      : defaultDeny);

    if (allowPatterns.length > 0) {
      const allowed = allowPatterns.some(r => r.test(command));
      if (!allowed) {
        throw new Error(`execute_bash blocked by policy (not in allowlist): ${command}`);
      }
    }

    if (denyPatterns.length > 0) {
      const denied = denyPatterns.find(r => r.test(command));
      if (denied) {
        throw new Error(`execute_bash blocked by policy (matched deny pattern ${denied}): ${command}`);
      }
    }

    const maxTimeoutMs = typeof bashPolicy.maxTimeoutMs === 'number' ? bashPolicy.maxTimeoutMs : undefined;
    if (maxTimeoutMs !== undefined && timeoutMs !== undefined) {
      return { timeoutMs: Math.min(timeoutMs, maxTimeoutMs) };
    }
    if (maxTimeoutMs !== undefined && timeoutMs === undefined) {
      return { timeoutMs: maxTimeoutMs };
    }

    return { timeoutMs };
  }

  protected async executeInternal(args: z.infer<typeof executeBashSchema>, context?: any): Promise<string> {
    const requestedTimeout = args.timeout && args.timeout > 0 ? args.timeout : undefined;
    const enforced = this.enforcePolicy(args.command, requestedTimeout, context?.toolPolicy);
    const timeout = enforced.timeoutMs;

    const result = await execaBash(args.command, {
      cwd: args.cwd || process.cwd(),
      timeout,
      all: true,
      reject: false,
    });

    let output = `Exit Code: ${result.exitCode}\n\n`;
    if (result.all) {
      output += `Output:\n${result.all}`;
    } else {
      if (result.stdout) output += `STDOUT:\n${result.stdout}\n`;
      if (result.stderr) output += `STDERR:\n${result.stderr}\n`;
    }

    return output;
  }
}
