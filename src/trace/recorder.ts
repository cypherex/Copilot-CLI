import { createWriteStream } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { HookRegistry } from '../hooks/registry.js';
import type { HookContext } from '../hooks/types.js';
import type { AgentEvent, TraceHeaderEvent } from './types.js';

const execFileAsync = promisify(execFile);

export interface TraceRecorderOptions {
  tracePath: string;
  evalMode?: boolean;
  seed?: string;
  allowedTools?: string[];
  llm?: {
    provider?: string;
    model?: string;
  };
}

export class TraceRecorder {
  private stream?: ReturnType<typeof createWriteStream>;
  private installed = false;
  private sessionId?: string;

  constructor(
    private hookRegistry: HookRegistry,
    private options: TraceRecorderOptions
  ) {}

  async install(): Promise<void> {
    if (this.installed) return;
    this.installed = true;

    const fullPath = resolve(this.options.tracePath);
    await mkdir(dirname(fullPath), { recursive: true });
    this.stream = createWriteStream(fullPath, { flags: 'w' });

    const header: TraceHeaderEvent = {
      type: 'trace_header',
      ts: new Date().toISOString(),
      argv: process.argv,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cwd: process.cwd(),
      packageVersion: await this.tryReadPackageVersion(),
      git: await this.tryReadGitInfo(),
      run: {
        evalMode: this.options.evalMode,
        seed: this.options.seed,
        allowedTools: this.options.allowedTools,
      },
      llm: this.options.llm,
    };
    this.write(header);

    // Register hooks (late priority so we observe final context after other hooks).
    const priority = 1000;

    this.hookRegistry.register({
      type: 'session:start',
      name: 'trace-recorder:session-start',
      priority,
      handler: async (ctx: HookContext) => {
        this.sessionId = ctx.sessionId;
        this.write({ type: 'session_start', ts: ctx.timestamp.toISOString(), sessionId: ctx.sessionId });
        return { continue: true };
      },
    });

    this.hookRegistry.register({
      type: 'session:end',
      name: 'trace-recorder:session-end',
      priority,
      handler: async (ctx: HookContext) => {
        this.write({ type: 'session_end', ts: ctx.timestamp.toISOString(), sessionId: ctx.sessionId ?? this.sessionId });
        await this.close();
        return { continue: true };
      },
    });

    this.hookRegistry.register({
      type: 'user:prompt-submit',
      name: 'trace-recorder:user-prompt-submit',
      priority,
      handler: async (ctx: HookContext) => {
        this.write({
          type: 'user_prompt_submit',
          ts: ctx.timestamp.toISOString(),
          sessionId: ctx.sessionId ?? this.sessionId,
          userMessage: ctx.userMessage,
        });
        return { continue: true };
      },
    });

    this.hookRegistry.register({
      type: 'agent:iteration',
      name: 'trace-recorder:agent-iteration',
      priority,
      handler: async (ctx: HookContext) => {
        this.write({
          type: 'agent_iteration',
          ts: ctx.timestamp.toISOString(),
          sessionId: ctx.sessionId ?? this.sessionId,
          iteration: ctx.iteration,
          maxIterations: ctx.maxIterations,
        });
        return { continue: true };
      },
    });

    this.hookRegistry.register({
      type: 'assistant:response',
      name: 'trace-recorder:assistant-response',
      priority,
      handler: async (ctx: HookContext) => {
        this.write({
          type: 'assistant_response',
          ts: ctx.timestamp.toISOString(),
          sessionId: ctx.sessionId ?? this.sessionId,
          assistantMessage: ctx.assistantMessage,
          hasToolCalls: ctx.hasToolCalls,
        });
        return { continue: true };
      },
    });

    this.hookRegistry.register({
      type: 'tool:pre-execute',
      name: 'trace-recorder:tool-pre-execute',
      priority,
      handler: async (ctx: HookContext) => {
        this.write({
          type: 'tool_pre_execute',
          ts: ctx.timestamp.toISOString(),
          sessionId: ctx.sessionId ?? this.sessionId,
          toolName: ctx.toolName,
          toolArgs: ctx.toolArgs,
        });
        return { continue: true };
      },
    });

    this.hookRegistry.register({
      type: 'tool:post-execute',
      name: 'trace-recorder:tool-post-execute',
      priority,
      handler: async (ctx: HookContext) => {
        this.write({
          type: 'tool_post_execute',
          ts: ctx.timestamp.toISOString(),
          sessionId: ctx.sessionId ?? this.sessionId,
          toolName: ctx.toolName,
          toolArgs: ctx.toolArgs,
          toolResult: ctx.toolResult,
        });
        return { continue: true };
      },
    });
  }

  write(event: AgentEvent): void {
    if (!this.stream) return;
    this.stream.write(JSON.stringify(event) + '\n');
  }

  private async close(): Promise<void> {
    if (!this.stream) return;
    const s = this.stream;
    this.stream = undefined;
    await new Promise<void>((resolvePromise) => s.end(() => resolvePromise()));
  }

  private async tryReadPackageVersion(): Promise<string | undefined> {
    try {
      const pkgPath = new URL('../../package.json', import.meta.url);
      const raw = await readFile(pkgPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return typeof parsed.version === 'string' ? parsed.version : undefined;
    } catch {
      return undefined;
    }
  }

  private async tryReadGitInfo(): Promise<{ sha?: string; branch?: string } | undefined> {
    const git = async (args: string[]) => {
      try {
        const { stdout } = await execFileAsync('git', args, { timeout: 1500 });
        return stdout.trim();
      } catch {
        return undefined;
      }
    };

    const sha = await git(['rev-parse', 'HEAD']);
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (!sha && !branch) return undefined;
    return { sha, branch };
  }
}
