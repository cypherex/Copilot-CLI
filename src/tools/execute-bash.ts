// Execute Bash Tool

import { z } from 'zod';
import { execa } from 'execa';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';

const executeBashSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().optional().default(30000),
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

  protected async executeInternal(args: z.infer<typeof executeBashSchema>): Promise<string> {
    const result = await execa('bash', ['-c', args.command], {
      cwd: args.cwd || process.cwd(),
      timeout: args.timeout,
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
