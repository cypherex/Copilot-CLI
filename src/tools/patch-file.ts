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
  matchMode: z.enum(['exact', 'line', 'fuzzy']).optional().default('line'),
  replaceMode: z.enum(['all', 'first']).optional(),
  fuzzyThreshold: z.number().min(0.5).max(1).optional().default(0.92),
  contextLines: z.number().int().min(0).max(5).optional().default(2),
});

export class PatchFileTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'patch_file',
    description: `Patch a file using search/replace.

Default behavior is matchMode="line" (more resilient to whitespace/BOM/CRLF differences). You can opt into:
- matchMode="line": matches whole lines ignoring leading/trailing whitespace (good for indentation / CRLF vs LF issues)
- matchMode="fuzzy": finds the best near-match block (requires an unambiguous match; defaults to replacing only the best match)

Use matchMode="exact" when you need byte-for-byte precision.

Tips:
- Prefer multi-line search blocks (2-20 lines) for stable matching.
- Use expectCount to validate you are changing what you intend.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to patch' },
        search: { type: 'string', description: 'String or multi-line block to search for' },
        replace: { type: 'string', description: 'Replacement string' },
        expectCount: { type: 'number', description: 'Expected number of occurrences (for validation)' },
        matchMode: {
          type: 'string',
          enum: ['exact', 'line', 'fuzzy'],
          description: 'Match strategy (default: exact)',
        },
        replaceMode: {
          type: 'string',
          enum: ['all', 'first'],
          description: 'Replace all matches or only the first match (default: all; fuzzy defaults to first)',
        },
        fuzzyThreshold: {
          type: 'number',
          description: 'Fuzzy similarity threshold 0.5-1.0 (default: 0.92)',
        },
        contextLines: {
          type: 'number',
          description: 'On failure, include up to N context lines in suggestions (0-5, default: 2)',
        },
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

    const writeAndVerify = async (nextContent: string): Promise<void> => {
      try {
        await fs.writeFile(absolutePath, nextContent, 'utf-8');
      } catch (error) {
        throw createFilesystemError(error, absolutePath, 'write');
      }

      let reread: string;
      try {
        reread = await fs.readFile(absolutePath, 'utf-8');
      } catch (error) {
        throw createFilesystemError(error, absolutePath, 'read');
      }

      if (reread !== nextContent) {
        throw new Error(
          `Patch verification failed for ${absolutePath}: file contents on disk did not match the expected result after write. ` +
            `This may indicate another process modified the file concurrently. Consider using apply_unified_diff for more robust edits.`
        );
      }
    };

    const fileEol = content.includes('\r\n') ? '\r\n' : '\n';
    const fileHasTrailingEol = content.endsWith(fileEol);

    const normalizeEol = (text: string) => text.replace(/\r?\n/g, fileEol);
    const effectiveSearch = normalizeEol(args.search);
    const effectiveReplace = normalizeEol(args.replace);

    const splitLines = (text: string): string[] => {
      const normalized = normalizeEol(text);
      const lines = normalized.split(fileEol);
      if (normalized.endsWith(fileEol)) {
        lines.pop();
      }
      return lines;
    };

    const joinLines = (lines: string[]): string => {
      const body = lines.join(fileEol);
      return fileHasTrailingEol ? `${body}${fileEol}` : body;
    };

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const getOccurrences = (haystack: string, needle: string): number => {
      if (!needle) return 0;
      const escaped = escapeRegExp(needle);
      return (haystack.match(new RegExp(escaped, 'g')) || []).length;
    };

    const getDefaultReplaceMode = (): 'all' | 'first' => (args.matchMode === 'fuzzy' ? 'first' : 'all');
    const replaceMode: 'all' | 'first' = args.replaceMode ?? getDefaultReplaceMode();

    // 1) EXACT match (with EOL normalization)
    if (args.matchMode === 'exact') {
      const exactOccurrences = getOccurrences(content, effectiveSearch);
      if (exactOccurrences > 0) {
        if (args.expectCount !== undefined && exactOccurrences !== args.expectCount) {
          throw new Error(`Found ${exactOccurrences} occurrence(s) but expected ${args.expectCount}.`);
        }

        const escapedSearch = escapeRegExp(effectiveSearch);
        const regex = new RegExp(escapedSearch, replaceMode === 'all' ? 'g' : undefined);
        const newContent = content.replace(regex, effectiveReplace);

        await writeAndVerify(newContent);

        const replacedCount = replaceMode === 'all' ? exactOccurrences : 1;
        return `Successfully patched ${absolutePath}: ${replacedCount} occurrence(s) replaced (matchMode=exact, replaceMode=${replaceMode}).`;
      }
    }

    // Helper utilities for line/fuzzy modes
    const fileLines = splitLines(content);
    const searchLines = splitLines(args.search);
    const replaceLines = splitLines(args.replace);

    const normalizeLineForMatch = (line: string) => line.trim();

    const levenshtein = (a: string, b: string): number => {
      if (a === b) return 0;
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;

      // Ensure a is the shorter string for less memory.
      if (a.length > b.length) {
        const tmp = a;
        a = b;
        b = tmp;
      }

      const prev = new Array(a.length + 1);
      const curr = new Array(a.length + 1);
      for (let i = 0; i <= a.length; i++) prev[i] = i;

      for (let j = 1; j <= b.length; j++) {
        curr[0] = j;
        const bChar = b.charCodeAt(j - 1);
        for (let i = 1; i <= a.length; i++) {
          const cost = a.charCodeAt(i - 1) === bChar ? 0 : 1;
          curr[i] = Math.min(
            curr[i - 1] + 1, // insertion
            prev[i] + 1, // deletion
            prev[i - 1] + cost // substitution
          );
        }
        for (let i = 0; i <= a.length; i++) prev[i] = curr[i];
      }

      return prev[a.length];
    };

    const similarity = (a: string, b: string): number => {
      const aa = normalizeLineForMatch(a);
      const bb = normalizeLineForMatch(b);
      if (aa === bb) return 1;
      const maxLen = Math.max(aa.length, bb.length);
      if (maxLen === 0) return 1;
      return 1 - levenshtein(aa, bb) / maxLen;
    };

    type WindowCandidate = { start: number; score: number };

    const scoreWindow = (start: number): number => {
      const len = searchLines.length;
      let total = 0;
      for (let i = 0; i < len; i++) {
        total += similarity(fileLines[start + i] ?? '', searchLines[i] ?? '');
      }
      return total / Math.max(1, len);
    };

    const findExactLineWindows = (): number[] => {
      if (searchLines.length === 0) return [];
      const len = searchLines.length;
      const targets = searchLines.map(normalizeLineForMatch);
      const matches: number[] = [];
      for (let start = 0; start <= fileLines.length - len; start++) {
        let ok = true;
        for (let i = 0; i < len; i++) {
          if (normalizeLineForMatch(fileLines[start + i]) !== targets[i]) {
            ok = false;
            break;
          }
        }
        if (ok) matches.push(start);
      }
      return matches;
    };

    const formatSuggestions = (candidates: WindowCandidate[]): string => {
      if (candidates.length === 0 || searchLines.length === 0) {
        return '';
      }

      const context = args.contextLines ?? 2;
      const len = searchLines.length;
      const top = candidates.slice(0, 3);
      const blocks = top.map((c, idx) => {
        const startLine = c.start + 1;
        const endLine = c.start + len;
        const previewStart = Math.max(0, c.start - context);
        const previewEnd = Math.min(fileLines.length, c.start + len + context);
        const preview = fileLines.slice(previewStart, previewEnd).join('\n');
        return [
          `  ${idx + 1}) lines ${startLine}-${endLine} (score ${(c.score * 100).toFixed(1)}%)`,
          preview ? `\n${preview}` : '',
        ].join('');
      });

      return [
        '',
        'Closest matches in file (to help you craft a stable search block):',
        ...blocks,
        '',
      ].join('\n');
    };

    if (args.matchMode === 'exact') {
      // Helpful error for LLMs: recommend switching to line mode if only whitespace/indentation differs.
      const candidates: WindowCandidate[] = [];
      if (searchLines.length > 0 && fileLines.length >= searchLines.length) {
        for (let start = 0; start <= fileLines.length - searchLines.length; start++) {
          const score = scoreWindow(start);
          if (score >= 0.6) candidates.push({ start, score });
        }
        candidates.sort((a, b) => b.score - a.score);
      }

      throw new Error(
        [
          `Search string not found in ${absolutePath}.`,
          `- If the snippet differs only by indentation/trailing spaces, try matchMode="line".`,
          `- If the snippet is close but not exact, try matchMode="fuzzy" with a multi-line block.`,
          formatSuggestions(candidates),
        ].join('\n')
      );
    }

    // 2) LINE mode: whole-line matching ignoring leading/trailing whitespace
    if (args.matchMode === 'line') {
      const matches = findExactLineWindows();
      if (matches.length === 0) {
        const candidates: WindowCandidate[] = [];
        if (searchLines.length > 0 && fileLines.length >= searchLines.length) {
          for (let start = 0; start <= fileLines.length - searchLines.length; start++) {
            const score = scoreWindow(start);
            if (score >= 0.6) candidates.push({ start, score });
          }
          candidates.sort((a, b) => b.score - a.score);
        }
        throw new Error(
          [
            `No line-based match found in ${absolutePath} (matchMode=line).`,
            `Tip: Provide a multi-line search block (2-20 lines) copied from read_file.`,
            formatSuggestions(candidates),
          ].join('\n')
        );
      }

      const effectiveMatches = replaceMode === 'all' ? matches : matches.slice(0, 1);
      if (args.expectCount !== undefined && effectiveMatches.length !== args.expectCount) {
        throw new Error(`Found ${effectiveMatches.length} match(es) but expected ${args.expectCount}.`);
      }

      // Apply bottom-up so indices don't shift.
      const updated = [...fileLines];
      const sorted = [...effectiveMatches].sort((a, b) => b - a);
      for (const start of sorted) {
        updated.splice(start, searchLines.length, ...replaceLines);
      }

      await writeAndVerify(joinLines(updated));

      return `Successfully patched ${absolutePath}: ${effectiveMatches.length} match(es) replaced (matchMode=line, replaceMode=${replaceMode}).`;
    }

    // 3) FUZZY mode: unambiguous best near-match, default replaceMode=first
    const threshold = args.fuzzyThreshold ?? 0.92;
    if (searchLines.length === 0 || fileLines.length < searchLines.length) {
      throw new Error(`Cannot fuzzy match: search block is empty or longer than file (matchMode=fuzzy).`);
    }

    const windowScores: WindowCandidate[] = [];
    for (let start = 0; start <= fileLines.length - searchLines.length; start++) {
      windowScores.push({ start, score: scoreWindow(start) });
    }
    windowScores.sort((a, b) => b.score - a.score);

    const best = windowScores[0];
    const second = windowScores[1];
    const ambiguityGap = 0.03;

    if (!best || best.score < threshold) {
      throw new Error(
        [
          `No fuzzy match above threshold found in ${absolutePath} (best ${(((best?.score ?? 0) * 100)).toFixed(1)}%, threshold ${(threshold * 100).toFixed(1)}%).`,
          `Tip: Use a larger, more unique search block (2-20 lines) from read_file.`,
          formatSuggestions(windowScores),
        ].join('\n')
      );
    }

    if (second && best.score - second.score < ambiguityGap) {
      throw new Error(
        [
          `Fuzzy match is ambiguous in ${absolutePath} (best ${(best.score * 100).toFixed(1)}%, second ${(second.score * 100).toFixed(1)}%).`,
          `Tip: Provide a longer/more unique search block or switch to matchMode="exact" with an exact snippet.`,
          formatSuggestions(windowScores),
        ].join('\n')
      );
    }

    if (replaceMode === 'all' && args.expectCount === undefined) {
      throw new Error(`replaceMode="all" with matchMode="fuzzy" requires expectCount to avoid accidental broad edits.`);
    }

    let selectedStarts: number[] = [];
    if (replaceMode === 'first') {
      selectedStarts = [best.start];
    } else {
      const matchesAbove = windowScores.filter((w) => w.score >= threshold);
      const nonOverlapping: number[] = [];
      let lastTakenEnd = -1;
      for (const w of matchesAbove) {
        if (nonOverlapping.length >= (args.expectCount ?? 0)) break;
        if (w.start <= lastTakenEnd) continue;
        nonOverlapping.push(w.start);
        lastTakenEnd = w.start + searchLines.length - 1;
      }
      selectedStarts = nonOverlapping;
      if (args.expectCount !== undefined && selectedStarts.length !== args.expectCount) {
        throw new Error(`Found ${selectedStarts.length} fuzzy match(es) but expected ${args.expectCount}.`);
      }
    }

    const updated = [...fileLines];
    const sorted = [...selectedStarts].sort((a, b) => b - a);
    for (const start of sorted) {
      updated.splice(start, searchLines.length, ...replaceLines);
    }

    await writeAndVerify(joinLines(updated));

    const bestLine = selectedStarts[0] + 1;
    return `Successfully patched ${absolutePath}: ${selectedStarts.length} match(es) replaced (matchMode=fuzzy, replaceMode=${replaceMode}, bestScore=${(best.score * 100).toFixed(1)}%, bestAtLine=${bestLine}).`;
  }
}
