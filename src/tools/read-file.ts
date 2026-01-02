// Read File Tool

import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';

const readFileSchema = z.object({
  path: z.string(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
});

export class ReadFileTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'read_file',
    description: `Read file contents. Optionally specify line range to read only part of file.

⚡ PERFORMANCE TIP: Reading multiple files? Use the parallel tool to read them all at once instead of sequential reads. This is SIGNIFICANTLY faster.

Example - GOOD (parallel):
  parallel({ tools: [
    { tool: "read_file", parameters: { path: "src/a.ts" } },
    { tool: "read_file", parameters: { path: "src/b.ts" } },
    { tool: "read_file", parameters: { path: "src/c.ts" } }
  ]})

Example - BAD (sequential):
  read_file({ path: "src/a.ts" })
  read_file({ path: "src/b.ts" })
  read_file({ path: "src/c.ts" })`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        lineStart: { type: 'number', description: 'Starting line number (1-indexed)' },
        lineEnd: { type: 'number', description: 'Ending line number (1-indexed)' },
      },
      required: ['path'],
    },
  };

  protected readonly schema = readFileSchema;

  protected async executeInternal(args: z.infer<typeof readFileSchema>): Promise<string> {
    const absolutePath = path.resolve(args.path);
    const content = await fs.readFile(absolutePath, 'utf-8');

    if (args.lineStart !== undefined || args.lineEnd !== undefined) {
      const lines = content.split('\n');
      const start = (args.lineStart || 1) - 1;
      const end = args.lineEnd || lines.length;
      return lines.slice(start, end).join('\n');
    }

    return content;
  }
}
