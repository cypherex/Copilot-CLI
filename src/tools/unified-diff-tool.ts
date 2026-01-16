// Unified Diff Patch Tool - apply a unified diff to one or more files

import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { BaseTool } from './base-tool.js';
import type { ToolDefinition } from './types.js';
import { createFilesystemError } from '../utils/filesystem-errors.js';

const unifiedDiffSchema = z.object({
  diff: z.string().min(1),
  cwd: z.string().optional(),
  dry_run: z.boolean().optional().default(false),
  fuzz: z.number().int().min(0).max(10).optional().default(3),
});

type FilePatch = {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
};

type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[]; // raw lines starting with ' ', '+', '-'
};

function parsePathHeader(line: string): string {
  // "--- a/foo" or "+++ b/foo" or "--- /dev/null"
  const trimmed = line.replace(/^---\s+|\+\+\+\s+/, '').trim();
  // Drop timestamps if present: "a/foo\t2020-..."
  const first = trimmed.split(/\s+/)[0];
  return first;
}

function stripPrefix(p: string): string {
  if (p === '/dev/null') return p;
  return p.replace(/^(a|b)\//, '');
}

function parseUnifiedDiff(diffText: string): FilePatch[] {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n');
  const patches: FilePatch[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.startsWith('--- ')) {
      i++;
      continue;
    }

    const oldPath = stripPrefix(parsePathHeader(line));
    const next = lines[i + 1] ?? '';
    if (!next.startsWith('+++ ')) {
      throw new Error(`Invalid unified diff: expected '+++' after '---' at line ${i + 1}`);
    }
    const newPath = stripPrefix(parsePathHeader(next));
    i += 2;

    const hunks: Hunk[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.startsWith('--- ')) break;
      if (!l.startsWith('@@')) {
        i++;
        continue;
      }

      const m = l.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m) {
        throw new Error(`Invalid hunk header at line ${i + 1}: ${l}`);
      }

      const oldStart = parseInt(m[1], 10);
      const oldCount = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10);
      const newCount = m[4] ? parseInt(m[4], 10) : 1;
      i++;

      const hunkLines: string[] = [];
      while (i < lines.length) {
        const hl = lines[i];
        if (hl.startsWith('@@') || hl.startsWith('--- ')) break;
        if (hl.startsWith('\\ No newline at end of file')) {
          i++;
          continue;
        }
        if (!hl.startsWith(' ') && !hl.startsWith('+') && !hl.startsWith('-')) {
          // Diff noise; ignore
          i++;
          continue;
        }
        hunkLines.push(hl);
        i++;
      }

      hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
    }

    patches.push({ oldPath, newPath, hunks });
  }

  if (patches.length === 0) {
    throw new Error('No file patches found in unified diff.');
  }

  return patches;
}

function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function splitWithTrailing(text: string, eol: string): { lines: string[]; hasTrailing: boolean } {
  const hasTrailing = text.endsWith(eol);
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const raw = normalized.split(eol);
  if (hasTrailing) raw.pop();
  return { lines: raw, hasTrailing };
}

function joinWithTrailing(lines: string[], eol: string, hasTrailing: boolean): string {
  const body = lines.join(eol);
  return hasTrailing ? `${body}${eol}` : body;
}

function applyHunk(
  fileLines: string[],
  hunk: Hunk,
  fuzz: number
): { lines: string[]; appliedAt: number } {
  const oldBlock = hunk.lines.filter((l) => l[0] !== '+').map((l) => l.slice(1));
  const newBlock = hunk.lines.filter((l) => l[0] !== '-').map((l) => l.slice(1));

  const expectedIdx = Math.max(0, hunk.oldStart - 1);
  const maxStart = Math.max(0, fileLines.length - oldBlock.length);

  const candidates: number[] = [];
  const startMin = Math.max(0, expectedIdx - fuzz);
  const startMax = Math.min(maxStart, expectedIdx + fuzz);

  const matchesAt = (start: number): boolean => {
    for (let i = 0; i < oldBlock.length; i++) {
      if ((fileLines[start + i] ?? '') !== oldBlock[i]) return false;
    }
    return true;
  };

  for (let start = startMin; start <= startMax; start++) {
    if (matchesAt(start)) candidates.push(start);
  }

  // If not found near expected location, try global search (still require uniqueness).
  if (candidates.length === 0) {
    for (let start = 0; start <= maxStart; start++) {
      if (matchesAt(start)) candidates.push(start);
    }
  }

  if (candidates.length === 0) {
    throw new Error(`Hunk failed to apply (no match found near line ${hunk.oldStart}).`);
  }
  if (candidates.length > 1) {
    throw new Error(`Hunk is ambiguous (matches at multiple locations: ${candidates.slice(0, 5).join(', ')}...).`);
  }

  const start = candidates[0];
  const updated = [...fileLines];
  updated.splice(start, oldBlock.length, ...newBlock);
  return { lines: updated, appliedAt: start + 1 };
}

async function runGitApply(opts: { cwd: string; diff: string; checkOnly: boolean }): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const args = opts.checkOnly
      ? ['apply', '--check', '--whitespace=nowarn', '--recount', '-']
      : ['apply', '--whitespace=nowarn', '--recount', '-'];

    const child = spawn('git', args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      out += String(d);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output: out }));

    child.stdin.write(opts.diff);
    child.stdin.end();
  });
}

export class UnifiedDiffTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'apply_unified_diff',
    description: `Apply a unified diff (multi-file, multi-hunk) to the workspace.

This tool uses the native [1mgit apply[0m patch engine when available.
It is more resilient and LLM-friendly than exact search/replace for multi-hunk edits.`,
    parameters: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Unified diff text (---/+++ and @@ hunks)' },
        cwd: { type: 'string', description: 'Base directory for relative paths (default: current)' },
        dry_run: { type: 'boolean', description: 'Validate only; do not write files (default: false)', default: false },
        fuzz: { type: 'number', description: 'Line offset tolerance when applying hunks (0-10, default: 3)', default: 3 },
      },
      required: ['diff'],
    },
  };

  protected readonly schema = unifiedDiffSchema;

  protected async executeInternal(args: z.infer<typeof unifiedDiffSchema>): Promise<string> {
    const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
    const patches = parseUnifiedDiff(args.diff);

    // Precompute a lightweight summary (even if git apply fails).
    const summary: any = {
      engine: 'git',
      dry_run: args.dry_run,
      files: patches.map(p => ({
        oldPath: p.oldPath,
        newPath: p.newPath,
        hunks: p.hunks.length,
      })),
      note: args.fuzz ? `fuzz=${args.fuzz} (note: git apply uses its own context heuristics)` : undefined,
    };

    // Use git apply (works even outside a git repo). If git isn't available, fall back to the old in-process engine.
    try {
      const res = await runGitApply({ cwd: baseDir, diff: args.diff, checkOnly: args.dry_run });

      if (res.exitCode !== 0) {
        throw new Error(res.output || `git apply failed (exit=${res.exitCode})`);
      }

      return JSON.stringify(summary, null, 2);
    } catch (err: any) {
      // Fallback if git is not present.
      const msg = String(err?.message ?? err);
      if (!/ENOENT|not found|spawn\s+git/i.test(msg) && !(process.platform === 'win32' && /is not recognized/i.test(msg))) {
        // git exists but patch didn't apply.
        throw new Error(`${msg}\n\nSummary:\n${JSON.stringify(summary, null, 2)}`);
      }
    }

    // === Fallback engine (no git) ===
    // Apply a best-effort, conservative unified-diff application.
    const fbSummary: any = { ...summary, engine: 'builtin' };

    for (const patch of patches) {
      const oldPath = patch.oldPath === '/dev/null' ? '/dev/null' : path.resolve(baseDir, patch.oldPath);
      const newPath = patch.newPath === '/dev/null' ? '/dev/null' : path.resolve(baseDir, patch.newPath);

      if (patch.oldPath === '/dev/null' && patch.newPath === '/dev/null') {
        throw new Error('Invalid patch: both oldPath and newPath are /dev/null.');
      }

      // Delete file
      if (patch.newPath === '/dev/null') {
        if (!args.dry_run) {
          try {
            await fs.unlink(oldPath);
          } catch (error) {
            throw createFilesystemError(error, oldPath, 'delete');
          }
        }
        continue;
      }

      let original = '';
      if (patch.oldPath !== '/dev/null') {
        try {
          original = await fs.readFile(oldPath, 'utf-8');
        } catch {
          original = '';
        }
      }

      const eol = detectEol(original);
      const { lines: fileLines, hasTrailing } = splitWithTrailing(original, eol);
      let updatedLines = fileLines;

      for (const hunk of patch.hunks) {
        updatedLines = applyHunk(updatedLines, hunk, args.fuzz).lines;
      }

      const updatedText = joinWithTrailing(updatedLines, eol, hasTrailing);
      if (!args.dry_run) {
        const targetPath = newPath;
        try {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, updatedText, 'utf-8');
        } catch (error) {
          throw createFilesystemError(error, targetPath, 'write');
        }
      }

    }

    return JSON.stringify(fbSummary, null, 2);
  }
}

