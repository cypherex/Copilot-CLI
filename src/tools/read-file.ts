// Read File Tool

import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import { createFilesystemError } from '../utils/filesystem-errors.js';

const readFileSchema = z.object({
  path: z.string(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
});

export class ReadFileTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'read_file',
    description: `Read file contents. BEST for small files or when you need the exact text for patching.
IMPORTANT FOR COMPLEX ANALYSIS: Use 'ask_file' instead. It is much more context-efficient and performs deeper verification.

PERFORMANCE TIP: Reading multiple files? Use the parallel tool to read them all at once instead of sequential reads. This is SIGNIFICANTLY faster.`,
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

    let content: string;
    try {
      content = await fs.readFile(absolutePath, 'utf-8');
    } catch (error) {
      throw createFilesystemError(error, absolutePath, 'read');
    }

    if (args.lineStart !== undefined || args.lineEnd !== undefined) {
      const lines = content.split('\n');
      const start = (args.lineStart || 1) - 1;
      const end = args.lineEnd || lines.length;
      return lines.slice(start, end).join('\n');
    }

    return content;
  }
}
