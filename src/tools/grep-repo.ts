// Grep Repo Tool - fast codebase search (read-only)

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import { execaBash } from '../utils/bash.js';

const stringArrayish = z.preprocess((value) => {
  if (typeof value === 'string') return [value];
  return value;
}, z.array(z.string()));

const grepRepoSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object') return value;
  const v = value as any;
  if (typeof v.pattern !== 'string') {
    if (typeof v.query === 'string') return { ...v, pattern: v.query };
    if (typeof v.search === 'string') return { ...v, pattern: v.search };
  }
  return value;
}, z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  cwd: z.string().optional().describe('Working directory (defaults to process.cwd())'),
  globs: stringArrayish.optional().describe('Glob filters (passed to rg as -g)'),
  fileTypes: stringArrayish.optional().describe('File types (passed to rg as -t, e.g., ["ts","js"])'),
  caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
  fixedStrings: z.boolean().optional().default(false).describe('Treat pattern as a literal string'),
  maxResults: z.number().int().positive().optional().default(200).describe('Max output lines to return'),
  contextLines: z.number().int().min(0).max(5).optional().default(0).describe('Context lines around matches'),
  filesOnly: z.boolean().optional().default(false).describe('List matching files only (no match lines)'),
  timeout_ms: z.number().int().min(0).optional().default(0).describe('Timeout for the underlying search (0 disables)'),
}));

function bashSingleQuote(value: string): string {
  // Wrap in single quotes, escape embedded single quotes.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRgCommand(args: z.infer<typeof grepRepoSchema>): string {
  const parts: string[] = [];
  parts.push('rg');

  // Output formatting: stable + parseable
  parts.push('--no-heading');
  parts.push('--line-number');
  parts.push('--color=never');
  parts.push('--max-columns=300');
  parts.push('--hidden'); // allow searching dotfiles if globs include them

  if (!args.caseSensitive) parts.push('--ignore-case');
  if (args.fixedStrings) parts.push('--fixed-strings');
  if (args.contextLines > 0) parts.push(`--context=${args.contextLines}`);
  if (args.filesOnly) parts.push('--files-with-matches');

  for (const glob of args.globs || []) {
    parts.push('-g', bashSingleQuote(glob));
  }

  for (const t of args.fileTypes || []) {
    parts.push('-t', bashSingleQuote(t));
  }

  parts.push(bashSingleQuote(args.pattern));
  parts.push('.'); // search root

  return parts.join(' ');
}

function buildRgArgs(args: z.infer<typeof grepRepoSchema>): string[] {
  const parts: string[] = [];

  // Output formatting: stable + parseable
  parts.push('--no-heading');
  parts.push('--line-number');
  parts.push('--color=never');
  parts.push('--max-columns=300');
  parts.push('--hidden'); // allow searching dotfiles if globs include them

  if (!args.caseSensitive) parts.push('--ignore-case');
  if (args.fixedStrings) parts.push('--fixed-strings');
  if (args.contextLines > 0) parts.push(`--context=${args.contextLines}`);
  if (args.filesOnly) parts.push('--files-with-matches');

  for (const glob of args.globs || []) {
    parts.push('-g', glob);
  }

  for (const t of args.fileTypes || []) {
    parts.push('-t', t);
  }

  parts.push(args.pattern);
  parts.push('.'); // search root

  return parts;
}

function buildGrepFallbackCommand(args: z.infer<typeof grepRepoSchema>): string {
  // Basic fallback when rg isn't available in bash.
  // Note: grep fallback ignores globs/types and context for simplicity.
  const parts: string[] = [];
  parts.push('grep', '-RIn', '--exclude-dir=.git', '--exclude-dir=node_modules');
  if (!args.caseSensitive) parts.push('-i');
  if (args.fixedStrings) parts.push('-F');
  if (args.filesOnly) parts.push('-l');
  parts.push(bashSingleQuote(args.pattern), '.');
  return parts.join(' ');
}

export class GrepRepoTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'grep_repo',
    description: `Search the repository (read-only). Uses ripgrep (rg) via bash when available, with a grep fallback.

Best for codebase exploration: locate symbols, configs, entrypoints, or usages quickly.

Examples:
  grep_repo({ pattern: "createCLI\\(", fileTypes: ["ts"] })
  grep_repo({ pattern: "CopilotAgent", globs: ["src/**/*.ts"] })
  grep_repo({ pattern: "spawn_agent", filesOnly: true })`,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        cwd: { type: 'string' },
        globs: { type: 'array', items: { type: 'string' } },
        fileTypes: { type: 'array', items: { type: 'string' } },
        caseSensitive: { type: 'boolean', default: false },
        fixedStrings: { type: 'boolean', default: false },
        maxResults: { type: 'number', default: 200 },
        contextLines: { type: 'number', default: 0 },
        filesOnly: { type: 'boolean', default: false },
        timeout_ms: { type: 'number', default: 0, description: 'Timeout in ms (0 disables)' },
      },
      required: ['pattern'],
    },
  };

  protected readonly schema = grepRepoSchema;

  protected async executeInternal(args: z.infer<typeof grepRepoSchema>): Promise<string> {
    const cwd = args.cwd || process.cwd();

    const timeout = args.timeout_ms && args.timeout_ms > 0 ? args.timeout_ms : undefined;

    // Prefer native rg (avoids MSYS/WSL bash edge cases); fall back to bash-driven rg/grep.
    try {
      const { execa } = await import('execa');
      const rgArgs = buildRgArgs(args);
      const result = await execa('rg', rgArgs, {
        cwd,
        all: true,
        reject: false,
        timeout,
      });

      const output = (result.all || '').replace(/\r\n/g, '\n');
      const lines = output.split('\n');
      const trimmed = lines.slice(0, args.maxResults).join('\n').trimEnd();

      const header = `Exit Code: ${result.exitCode}\n`;
      if (!trimmed) {
        return `${header}\n(no matches)`;
      }

      const suffix = lines.length > args.maxResults ? `\n\n(truncated to ${args.maxResults} lines)` : '';
      return `${header}\n${trimmed}${suffix}`;
    } catch (error: any) {
      if (!(error && (error.code === 'ENOENT' || error.errno === 'ENOENT'))) {
        throw error;
      }
    }

    const rgCmd = buildRgCommand(args);
    const grepCmd = buildGrepFallbackCommand(args);

    const bashScript = [
      'set -euo pipefail',
      // Prefer rg if available, otherwise fall back to grep.
      'if command -v rg >/dev/null 2>&1; then',
      `  ${rgCmd}`,
      'else',
      `  ${grepCmd}`,
      'fi',
    ].join('\n');

    const result = await execaBash(bashScript, { cwd, all: true, reject: false, timeout });

    const output = (result.all || '').replace(/\r\n/g, '\n');
    const lines = output.split('\n');
    const trimmed = lines.slice(0, args.maxResults).join('\n').trimEnd();

    const header = `Exit Code: ${result.exitCode}\n`;
    if (!trimmed) {
      return `${header}\n(no matches)`;
    }

    const suffix = lines.length > args.maxResults ? `\n\n(truncated to ${args.maxResults} lines)` : '';
    return `${header}\n${trimmed}${suffix}`;
  }
}
