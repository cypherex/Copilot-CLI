// Create File Tool

import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import { createFilesystemError } from '../utils/filesystem-errors.js';

const createFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  overwrite: z.boolean().optional().default(false),
});

export class CreateFileTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'create_file',
    description: `Create a new file with specified content. Creates parent directories if needed.
⚡ PERFORMANCE TIP: Creating multiple files? Use the parallel tool to create them all at once.

Example - GOOD (parallel):
  parallel({ tools: [
    { tool: "create_file", parameters: { path: "src/a.ts", content: "..." } },
    { tool: "create_file", parameters: { path: "src/b.ts", content: "..." } }
  ]})

Example - BAD (sequential):
  create_file({ path: "src/a.ts", content: "..." })
  create_file({ path: "src/b.ts", content: "..." })`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
        content: { type: 'string', description: 'File content to write' },
        overwrite: { type: 'boolean', description: 'Whether to overwrite if file exists', default: false },
      },
      required: ['path', 'content'],
    },
  };

  protected readonly schema = createFileSchema;

  protected async executeInternal(args: z.infer<typeof createFileSchema>): Promise<string> {
    const absolutePath = path.resolve(args.path);

    // Check if file exists
    try {
      await fs.access(absolutePath);
      if (!args.overwrite) {
        throw new Error(`File already exists: ${absolutePath}. Use overwrite: true to replace.`);
      }
    } catch (e) {
      // File doesn't exist, continue (unless it's our own error)
      if (e instanceof Error && e.message.includes('File already exists')) throw e;
    }

    // Create parent directories
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    } catch (error) {
      throw createFilesystemError(error, path.dirname(absolutePath), 'create directory');
    }

    // Write file
    try {
      await fs.writeFile(absolutePath, args.content, 'utf-8');
    } catch (error) {
      throw createFilesystemError(error, absolutePath, 'write');
    }

    return `Successfully created file: ${absolutePath}`;
  }
}
