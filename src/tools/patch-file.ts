// Patch File Tool with exact search/replace

import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import { createFilesystemError } from '../utils/filesystem-errors.js';

const patchFileSchema = z.object({
  path: z.string(),
  search: z.string(),
  replace: z.string(),
  expectCount: z.number().optional(),
});

export class PatchFileTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'patch_file',
    description: 'Patch a file using exact search/replace. The search string must match exactly (including whitespace).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to patch' },
        search: { type: 'string', description: 'Exact string to search for (must match exactly including whitespace)' },
        replace: { type: 'string', description: 'Replacement string' },
        expectCount: { type: 'number', description: 'Expected number of occurrences (for validation)' },
      },
      required: ['path', 'search', 'replace'],
    },
  };

  protected readonly schema = patchFileSchema;

  protected async executeInternal(args: z.infer<typeof patchFileSchema>): Promise<string> {
    const absolutePath = path.resolve(args.path);

    let content: string;
    try {
      content = await fs.readFile(absolutePath, 'utf-8');
    } catch (error) {
      throw createFilesystemError(error, absolutePath, 'read');
    }

    // Count occurrences
    const escapedSearch = args.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = (content.match(new RegExp(escapedSearch, 'g')) || []).length;

    if (occurrences === 0) {
      throw new Error(`Search string not found in ${absolutePath}. Ensure exact match including whitespace.`);
    }

    if (args.expectCount !== undefined && occurrences !== args.expectCount) {
      throw new Error(`Found ${occurrences} occurrence(s) but expected ${args.expectCount}.`);
    }

    const newContent = content.replace(new RegExp(escapedSearch, 'g'), args.replace);

    try {
      await fs.writeFile(absolutePath, newContent, 'utf-8');
    } catch (error) {
      throw createFilesystemError(error, absolutePath, 'write');
    }

    return `Successfully patched ${absolutePath}: ${occurrences} occurrence(s) replaced.`;
  }
}
