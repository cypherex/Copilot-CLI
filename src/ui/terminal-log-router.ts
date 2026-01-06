import chalk from 'chalk';
import { format } from 'util';
import { getRenderManager } from './render-manager.js';

export interface TerminalLogRouterOptions {
  interceptConsole?: boolean;
  interceptStderr?: boolean;
}

const DEFAULT_OPTIONS: Required<TerminalLogRouterOptions> = {
  interceptConsole: true,
  interceptStderr: true,
};

export type UninstallFn = () => void;

function isInteractiveUiActive(): boolean {
  return Boolean(process.stdout.isTTY && getRenderManager());
}

function writeToUi(lines: string[], level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'stderr'): boolean {
  const renderManager = getRenderManager();
  if (!process.stdout.isTTY || !renderManager) return false;

  const prefix =
    level === 'warn' ? chalk.yellow('⚠ ') :
    level === 'error' ? chalk.red('✗ ') :
    level === 'debug' ? chalk.dim('· ') :
    level === 'stderr' ? chalk.dim('· ') :
    '';

  for (const line of lines) {
    if (!line) {
      renderManager.writeOutput('');
      continue;
    }
    const decorated =
      level === 'stderr' || level === 'debug'
        ? chalk.dim(prefix + line)
        : prefix + line;
    renderManager.writeOutput(decorated);
  }
  return true;
}

function normalizeToLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  // Avoid emitting a trailing empty line for common `write(... + '\n')` calls.
  if (parts.length > 1 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Installs a router so accidental `console.*` and `process.stderr.write` output
 * won't corrupt RenderManager-driven UIs.
 */
export function installTerminalLogRouter(options: TerminalLogRouterOptions = {}): UninstallFn {
  const config = { ...DEFAULT_OPTIONS, ...options };

  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  if (config.interceptConsole) {
    console.log = (...args: any[]) => {
      const text = format(...args);
      if (!isInteractiveUiActive() || !writeToUi(normalizeToLines(text), 'log')) {
        originalConsole.log(...args);
      }
    };

    console.info = (...args: any[]) => {
      const text = format(...args);
      if (!isInteractiveUiActive() || !writeToUi(normalizeToLines(text), 'info')) {
        originalConsole.info(...args);
      }
    };

    console.warn = (...args: any[]) => {
      const text = format(...args);
      if (!isInteractiveUiActive() || !writeToUi(normalizeToLines(text), 'warn')) {
        originalConsole.warn(...args);
      }
    };

    console.error = (...args: any[]) => {
      const text = format(...args);
      if (!isInteractiveUiActive() || !writeToUi(normalizeToLines(text), 'error')) {
        originalConsole.error(...args);
      }
    };

    console.debug = (...args: any[]) => {
      const text = format(...args);
      if (!isInteractiveUiActive() || !writeToUi(normalizeToLines(text), 'debug')) {
        originalConsole.debug(...args);
      }
    };
  }

  if (config.interceptStderr) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stderr.write = ((chunk: any, encoding?: any, cb?: any) => {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString(
                typeof encoding === 'string' && Buffer.isEncoding(encoding)
                  ? (encoding as BufferEncoding)
                  : 'utf8'
              )
            : String(chunk);

      const lines = normalizeToLines(text);

      if (!isInteractiveUiActive() || !writeToUi(lines, 'stderr')) {
        return originalStderrWrite(chunk, encoding, cb);
      }

      if (typeof cb === 'function') cb();
      return true;
    }) as any;
  }

  return () => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    process.stderr.write = originalStderrWrite as any;
  };
}
