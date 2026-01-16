export type ToolErrorCategory =
  | 'transient'
  | 'parse'
  | 'file_read'
  | 'file_patch'
  | 'permissions'
  | 'dependencies'
  | 'policy'
  | 'unknown';

type ErrorKey = `${ToolErrorCategory}:${string}`;

export class ToolErrorRecovery {
  private readonly transientPatterns: RegExp[] = [
    /timeout/i,
    /timed out/i,
    /rate limit/i,
    /temporarily unavailable/i,
    /connection.*reset/i,
    /etimedout/i,
    /econnrefused/i,
    /eai_again/i,
    /429\b/i,
    /502\b/i,
    /503\b/i,
  ];

  private readonly categoryPatterns: Array<{ category: ToolErrorCategory; pattern: RegExp }> = [
    { category: 'policy', pattern: /blocked by policy/i },
    { category: 'parse', pattern: /parse.*error|unexpected token|syntax error/i },
    { category: 'file_read', pattern: /file not found|no such file|enoent/i },
    { category: 'file_patch', pattern: /patch failed|search string not found|hunk failed/i },
    { category: 'permissions', pattern: /permission denied|access denied|eacces|eperm/i },
    { category: 'dependencies', pattern: /module not found|cannot resolve|missing dependency/i },
  ];

  private readonly retryableTools = new Set<string>([
    'read_file',
    'list_files',
    'grep_repo',
    'search_files',
    'explore_codebase',
    'ask_file',
  ]);

  private readonly recentWindowMs = 5 * 60 * 1000;
  private readonly adviceThreshold = 2;

  private errorHistory = new Map<ErrorKey, { count: number; lastAt: number }>();

  isTransientError(error: string): boolean {
    return this.transientPatterns.some((p) => p.test(error));
  }

  categorizeError(error: string): ToolErrorCategory {
    if (this.isTransientError(error)) return 'transient';
    for (const { category, pattern } of this.categoryPatterns) {
      if (pattern.test(error)) return category;
    }
    return 'unknown';
  }

  recordToolError(toolName: string, error: string, now = Date.now()): void {
    const category = this.categorizeError(error);
    const key = `${category}:${toolName}` as const;
    const prev = this.errorHistory.get(key);
    this.errorHistory.set(key, { count: (prev?.count ?? 0) + 1, lastAt: now });
  }

  shouldRetry(input: { toolName: string; error: string; attempt: number; maxRetries: number }): boolean {
    if (input.attempt >= input.maxRetries) return false;
    if (!this.retryableTools.has(input.toolName)) return false;
    return this.isTransientError(input.error);
  }

  buildSystemAdvice(now = Date.now()): string | null {
    const recent: Array<{ category: ToolErrorCategory; toolName: string; count: number }> = [];

    for (const [key, value] of this.errorHistory) {
      if (now - value.lastAt > this.recentWindowMs) continue;
      if (value.count < this.adviceThreshold) continue;
      const [category, toolName] = key.split(':') as [ToolErrorCategory, string];
      recent.push({ category, toolName, count: value.count });
    }

    if (recent.length === 0) return null;

    const lines: string[] = [];
    lines.push('[Tool Error Triage]');
    lines.push('Recurring tool errors detected. Adjust approach to reduce retries/errors:');

    for (const r of recent) {
      lines.push(this.adviceLine(r.category, r.toolName, r.count));
    }

    lines.push('[End Tool Error Triage]');
    return lines.join('\n');
  }

  private adviceLine(category: ToolErrorCategory, toolName: string, count: number): string {
    switch (category) {
      case 'transient':
        return `- Transient failures (${count}x in ${toolName}): retry with backoff; if persistent, simplify/sequence calls and reduce parallelism.`;
      case 'file_patch':
        return `- Patch failures (${count}x in ${toolName}): read the file first; use a larger multi-line search block or switch matchMode to "line"/"fuzzy"; consider apply_unified_diff for multi-hunk edits.`;
      case 'file_read':
        return `- File read failures (${count}x in ${toolName}): verify paths via list_files/grep_repo; prefer workspace-relative paths.`;
      case 'parse':
        return `- Parse failures (${count}x in ${toolName}): confirm exact expected format (read file or print sample output) before editing/parsing.`;
      case 'permissions':
        return `- Permission failures (${count}x in ${toolName}): avoid restricted paths; choose project-local files and ensure write access.`;
      case 'dependencies':
        return `- Dependency failures (${count}x in ${toolName}): verify import/module names; confirm package manager state before changing code.`;
      case 'policy':
        return `- Policy blocks (${count}x in ${toolName}): the command/tool usage is restricted in this mode; choose an allowed alternative.`;
      default:
        return `- Repeated failures (${count}x in ${toolName}): change strategy and re-check assumptions before retrying.`;
    }
  }
}
