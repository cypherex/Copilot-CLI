// Ralph Wiggum Plugin - Autonomous looping agent technique
//
// The Ralph Wiggum technique allows the agent to continuously prompt itself
// in a loop, enabling long-running autonomous tasks without user intervention.
// Named after the Simpsons character who famously said "I'm helping!"

import chalk from 'chalk';
import type { Plugin, PluginContext, PluginCommand } from './types.js';
import type { HookRegistration, HookContext, HookResult } from '../hooks/types.js';

interface LoopState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  task: string;
  startTime: Date;
  stopReason?: string;
}

export class RalphWiggumPlugin implements Plugin {
  readonly info = {
    id: 'ralph-wiggum',
    name: 'Ralph Wiggum',
    version: '1.0.0',
    description: 'Autonomous looping agent technique for long-running tasks',
    author: 'Copilot CLI',
  };

  private loopState: LoopState | null = null;
  private context?: PluginContext;

  private readonly CONTINUE_PHRASES = [
    'Continue with the task.',
    'Keep going.',
    'Proceed to the next step.',
    'What\'s next?',
    'Continue working on this.',
  ];

  private readonly STOP_KEYWORDS = [
    'task complete',
    'task completed',
    'all done',
    'finished',
    'nothing left to do',
    'no more tasks',
    'completed successfully',
  ];

  initialize(context: PluginContext): void {
    this.context = context;
    console.log(chalk.magenta('Ralph Wiggum: I\'m helping!'));
  }

  destroy(): void {
    this.cancelLoop('Plugin unloaded');
  }

  getHooks(): HookRegistration[] {
    return [
      {
        type: 'assistant:response',
        name: 'ralph-wiggum-loop',
        description: 'Injects continuation prompts for autonomous looping',
        priority: 50,
        handler: this.handleAssistantResponse.bind(this),
      },
      {
        type: 'session:end',
        name: 'ralph-wiggum-cleanup',
        description: 'Cleans up loop state on session end',
        priority: 100,
        handler: this.handleSessionEnd.bind(this),
      },
    ];
  }

  readonly commands: Record<string, PluginCommand> = {
    'ralph-loop': {
      name: 'ralph-loop',
      description: 'Start an autonomous Ralph Wiggum loop',
      execute: (args: string[]) => this.startLoop(args.join(' ')),
    },
    'cancel-ralph': {
      name: 'cancel-ralph',
      description: 'Cancel the active Ralph Wiggum loop',
      execute: () => this.cancelLoop('User cancelled'),
    },
    'help': {
      name: 'help',
      description: 'Explain the Ralph Wiggum technique',
      execute: () => this.showHelp(),
    },
    'status': {
      name: 'status',
      description: 'Show current loop status',
      execute: () => this.showStatus(),
    },
  };

  private startLoop(task: string): string {
    if (this.loopState?.active) {
      return 'A Ralph Wiggum loop is already active. Use cancel-ralph to stop it first.';
    }

    const maxIterations = 50; // Default max iterations

    this.loopState = {
      active: true,
      iteration: 0,
      maxIterations,
      task: task || 'Continue working autonomously',
      startTime: new Date(),
    };

    console.log(chalk.magenta('\n🎯 Ralph Wiggum loop started!'));
    console.log(chalk.gray(`Task: ${this.loopState.task}`));
    console.log(chalk.gray(`Max iterations: ${maxIterations}`));
    console.log(chalk.gray('Say "task complete" or use /cancel-ralph to stop.\n'));

    return `Ralph Wiggum loop started. Task: ${task || 'autonomous work'}. ` +
           `I will continue working until the task is complete or max iterations (${maxIterations}) reached. ` +
           `Begin now: ${task || 'Continue with the current work.'}`;
  }

  private cancelLoop(reason: string): string {
    if (!this.loopState?.active) {
      return 'No active Ralph Wiggum loop to cancel.';
    }

    const duration = Date.now() - this.loopState.startTime.getTime();
    const iterations = this.loopState.iteration;

    this.loopState.active = false;
    this.loopState.stopReason = reason;

    console.log(chalk.magenta('\n🛑 Ralph Wiggum loop stopped'));
    console.log(chalk.gray(`Reason: ${reason}`));
    console.log(chalk.gray(`Iterations completed: ${iterations}`));
    console.log(chalk.gray(`Duration: ${Math.round(duration / 1000)}s\n`));

    return `Loop stopped. Completed ${iterations} iterations in ${Math.round(duration / 1000)} seconds.`;
  }

  private showHelp(): string {
    return `
# Ralph Wiggum Technique

The Ralph Wiggum technique enables autonomous agent loops for long-running tasks.
Named after the Simpsons character who said "I'm helping!"

## How it works:
1. Start a loop with a task description
2. The agent works on the task autonomously
3. After each response, a continuation prompt is injected
4. The loop continues until:
   - The agent indicates completion
   - Maximum iterations reached
   - User cancels the loop

## Commands:
- /ralph-loop <task>  - Start an autonomous loop
- /cancel-ralph       - Cancel the active loop
- /status             - Show loop status
- /help               - Show this help

## Example:
/ralph-loop Refactor all utility functions to use TypeScript strict mode

The agent will work through each file autonomously, stopping when done.
`;
  }

  private showStatus(): string {
    if (!this.loopState) {
      return 'No Ralph Wiggum loop has been started in this session.';
    }

    if (!this.loopState.active) {
      return `Last loop completed:\n` +
             `- Task: ${this.loopState.task}\n` +
             `- Iterations: ${this.loopState.iteration}\n` +
             `- Stop reason: ${this.loopState.stopReason || 'Completed'}`;
    }

    const duration = Date.now() - this.loopState.startTime.getTime();
    return `Loop active:\n` +
           `- Task: ${this.loopState.task}\n` +
           `- Iteration: ${this.loopState.iteration}/${this.loopState.maxIterations}\n` +
           `- Duration: ${Math.round(duration / 1000)}s`;
  }

  private handleAssistantResponse(context: HookContext): HookResult {
    if (!this.loopState?.active) {
      return { continue: true };
    }

    this.loopState.iteration++;

    // Check for completion indicators in the response
    const message = context.assistantMessage?.toLowerCase() || '';
    const isComplete = this.STOP_KEYWORDS.some(keyword => message.includes(keyword));

    if (isComplete) {
      this.cancelLoop('Task completed');
      return {
        continue: true,
        feedback: 'Ralph Wiggum detected task completion.',
      };
    }

    // Check max iterations
    if (this.loopState.iteration >= this.loopState.maxIterations) {
      this.cancelLoop('Max iterations reached');
      return {
        continue: true,
        feedback: `Ralph Wiggum reached max iterations (${this.loopState.maxIterations}).`,
      };
    }

    // Inject continuation prompt
    const continuePhrase = this.CONTINUE_PHRASES[
      Math.floor(Math.random() * this.CONTINUE_PHRASES.length)
    ];

    return {
      continue: true,
      metadata: {
        injectUserMessage: continuePhrase,
        ralphIteration: this.loopState.iteration,
      },
      feedback: `[${this.loopState.iteration}/${this.loopState.maxIterations}] ${continuePhrase}`,
    };
  }

  private handleSessionEnd(): HookResult {
    if (this.loopState?.active) {
      this.cancelLoop('Session ended');
    }
    return { continue: true };
  }
}
