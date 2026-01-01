// List Files Tool

import { z } from 'zod';
import fg from 'fast-glob';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';

const listFilesSchema = z.object({
  pattern: z.string(),
  cwd: z.string().optional(),
  ignoreHidden: z.boolean().optional().default(true),
});

export class ListFilesTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'list_files',
    description: 'List files matching a glob pattern. Supports wildcards like *, **, ?, [abc].',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.ts", "*.json")' },
        cwd: { type: 'string', description: 'Working directory for search' },
        ignoreHidden: { type: 'boolean', description: 'Ignore hidden files/directories', default: true },
      },
      required: ['pattern'],
    },
  };

  protected readonly schema = listFilesSchema;

  protected async executeInternal(args: z.infer<typeof listFilesSchema>): Promise<string> {
    const files = await fg(args.pattern, {
      cwd: args.cwd || process.cwd(),
      dot: !args.ignoreHidden,
      onlyFiles: true,
      absolute: false,
    });

    if (files.length === 0) {
      return `No files found matching pattern: ${args.pattern}`;
    }

    return `Found ${files.length} file(s):\n${files.join('\n')}`;
  }
}
