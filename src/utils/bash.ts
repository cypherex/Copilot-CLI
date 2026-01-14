import { existsSync } from 'fs';
import path from 'path';
import type { ExecaReturnValue } from 'execa';

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function candidateGitBashPaths(): string[] {
  const roots = unique([
    process.env.BASH_PATH,
    process.env.GIT_BASH_PATH,
    process.env.ProgramW6432,
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean) as string[]);

  const candidates: string[] = [];

  for (const root of roots) {
    // If BASH_PATH points directly to bash.exe, include it.
    if (root.toLowerCase().endsWith('bash.exe')) {
      candidates.push(root);
      continue;
    }

    // Common Git for Windows install locations.
    candidates.push(path.join(root, 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(root, 'Git', 'usr', 'bin', 'bash.exe'));
  }

  return candidates;
}

export function getBashCandidates(): string[] {
  // On Windows, prefer Git for Windows' bash.exe over PATH `bash` because PATH may
  // resolve to the WSL shim (C:\Windows\System32\bash.exe), which won't work for
  // Windows repo paths and may hang or error unexpectedly.
  if (process.platform === 'win32') {
    return unique([
      ...candidateGitBashPaths(),
      'bash',
    ]);
  }

  return ['bash'];
}

export async function execaBash(
  script: string,
  options: { cwd?: string; timeout?: number; reject?: boolean; all?: boolean } = {}
): Promise<ExecaReturnValue> {
  // Dynamic import avoids Jest ESM/CJS interop issues when tests import modules
  // that reference this helper but don't actually execute it.
  const { execa } = await import('execa');
  const candidates = getBashCandidates().filter((c) => c === 'bash' || existsSync(c));

  let lastError: any;
  for (const bash of candidates) {
    try {
      return await execa(bash, ['-lc', script], {
        cwd: options.cwd,
        timeout: options.timeout,
        all: options.all ?? true,
        reject: options.reject ?? false,
      });
    } catch (error: any) {
      lastError = error;
      // If the executable couldn't be spawned, try next candidate.
      if (error && (error.code === 'ENOENT' || error.errno === 'ENOENT')) {
        continue;
      }
      throw error;
    }
  }

  const hint = [
    'bash executable not found.',
    'Install Git for Windows (Git Bash) or set BASH_PATH to your bash.exe.',
    `Tried: ${candidates.join(', ')}`,
  ].join(' ');

  const msg = lastError?.message ? `${hint} Last error: ${lastError.message}` : hint;
  throw new Error(msg);
}
