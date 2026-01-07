// List Files Tool

import { z } from 'zod';
import fg from 'fast-glob';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';

const stringArrayish = z.preprocess((value) => {
  if (typeof value === 'string') return [value];
  return value;
}, z.array(z.string()));

const DEFAULT_IGNORES = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/testbox/**',
];

const listFilesSchema = z.object({
  pattern: z.string(),
  cwd: z.string().optional(),
  ignoreHidden: z.boolean().optional().default(true),
  includeNodeModules: z.boolean().optional().default(false),
  excludeGlobs: stringArrayish.optional().default([]),
  maxResults: z.number().int().positive().optional().default(500),
  timeout_ms: z.number().int().min(0).optional().default(0),
});

export class ListFilesTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'list_files',
    description: `List files matching a glob pattern. Supports wildcards like *, **, ?, [abc].

⚡ PERFORMANCE TIP: Need to list files in multiple directories? Use the parallel tool.

Example - GOOD (parallel):
  parallel({ tools: [
    { tool: "list_files", parameters: { pattern: "src/**/*.ts" } },
    { tool: "list_files", parameters: { pattern: "tests/**/*.test.ts" } }
  ]})`,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.ts", "*.json")' },
        cwd: { type: 'string', description: 'Working directory for search' },
        ignoreHidden: { type: 'boolean', description: 'Ignore hidden files/directories', default: true },
        includeNodeModules: { type: 'boolean', description: 'Include node_modules (default: false)', default: false },
        excludeGlobs: { type: 'array', items: { type: 'string' }, description: 'Extra ignore globs (string or array)' },
        maxResults: { type: 'number', description: 'Max files to return', default: 500 },
        timeout_ms: { type: 'number', description: 'Timeout in ms (0 disables)', default: 0 },
      },
      required: ['pattern'],
    },
  };

  protected readonly schema = listFilesSchema;

  protected async executeInternal(args: z.infer<typeof listFilesSchema>): Promise<string> {
    const cwd = args.cwd || process.cwd();

    const ignores = [
      ...DEFAULT_IGNORES,
      ...(args.excludeGlobs || []),
    ].filter(Boolean);

    const effectiveIgnores = args.includeNodeModules
      ? ignores.filter(i => !i.includes('node_modules'))
      : ignores;

    const searchPromise = fg(args.pattern, {
      cwd,
      dot: !args.ignoreHidden,
      onlyFiles: true,
      absolute: false,
      followSymbolicLinks: false,
      unique: true,
      ignore: effectiveIgnores,
    });

    const timeoutMs = args.timeout_ms && args.timeout_ms > 0 ? args.timeout_ms : 0;
    const files = timeoutMs > 0
      ? await Promise.race([
        searchPromise,
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error(`list_files timed out after ${timeoutMs}ms`)), timeoutMs)),
      ])
      : await searchPromise;

    if (files.length === 0) {
      return `No files found matching pattern: ${args.pattern}`;
    }

    const limited = files.slice(0, args.maxResults);
    const suffix = files.length > limited.length ? `\n\n(truncated to ${limited.length} files)` : '';
    return `Found ${files.length} file(s):\n${limited.join('\n')}${suffix}`;
  }
}
