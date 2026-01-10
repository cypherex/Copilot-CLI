import type { MemoryStore, WorkingState, Task } from '../memory/types.js';

export type AutoToTTrigger =
  | { kind: 'after_task_set' }
  | { kind: 'repro_failed' }
  | { kind: 'iteration_tick'; iteration: number }
  | { kind: 'subagent_spawn' };

export type AutoToTDecision = {
  shouldTrigger: boolean;
  toolName?: string;
  key?: string;
  reason?: string;
  toolArgs?: any;
};

const isBugLike = (text: string): boolean => /\b(fix|bug|error|fail|failing|failure|regression|crash|exception|stack|trace|debug|investigate)\b/i.test(text);

function getActiveTask(memoryStore: MemoryStore): Task | undefined {
  try {
    return memoryStore.getActiveTask();
  } catch {
    return undefined;
  }
}

function isRecent(date: Date | undefined, withinMs: number): boolean {
  if (!date) return false;
  return Date.now() - new Date(date).getTime() <= withinMs;
}

export function decideAutoToT(memoryStore: MemoryStore, trigger: AutoToTTrigger): AutoToTDecision {
  const working: WorkingState = memoryStore.getWorkingState();
  const task = getActiveTask(memoryStore);

  const lastReproFailing = !!working.lastRepro && working.lastRepro.exitCode !== 0;
  const taskText = task?.description ?? '';
  const shouldConsider =
    trigger.kind === 'iteration_tick' || // Always consider periodic checks
    lastReproFailing ||
    isBugLike(taskText) ||
    (working.lastVerification ? !working.lastVerification.passed : false);

  if (!shouldConsider) {
    return { shouldTrigger: false };
  }

  // Throttle: donâ€™t re-trigger for the same â€œstate keyâ€.
  const keyPayload = {
    kind: trigger.kind,
    iteration: trigger.kind === 'iteration_tick' ? trigger.iteration : undefined,
    taskId: task?.id,
    reproId: working.lastRepro?.id,
    verifyId: working.lastVerification?.id,
  };
  const key = JSON.stringify(keyPayload);

  if (working.lastAutoToT?.key === key && isRecent(working.lastAutoToT.triggeredAt, 60_000)) {
    return { shouldTrigger: false };
  }

  // Trigger-specific gating
  let useToT = false;
  let useDeepReasoning = false;

  if (trigger.kind === 'iteration_tick') {
    if (trigger.iteration % 30 === 0) {
      useToT = true;
    } else if (trigger.iteration % 5 === 0) {
      useDeepReasoning = true;
    } else {
      return { shouldTrigger: false };
    }
  }

  if (trigger.kind === 'repro_failed' || trigger.kind === 'after_task_set' || trigger.kind === 'subagent_spawn') {
    useDeepReasoning = true; // Use smaller reasoning for immediate errors
  }

  const problemParts: string[] = [];
  if (task) problemParts.push(`Current task: ${task.description} (ID: ${task.id})`);
  if (working.lastRepro) {
    problemParts.push(`Last repro command: ${working.lastRepro.command}`);
    problemParts.push(`Repro exit code: ${working.lastRepro.exitCode}`);
    if (working.lastRepro.outputSnippet) {
      problemParts.push(`Repro output (tail):\n${working.lastRepro.outputSnippet}`);
    }
  }
  if (working.lastVerification) {
    problemParts.push(`Last verification passed: ${working.lastVerification.passed}`);
    problemParts.push(`Verification commands: ${working.lastVerification.commands.join(' | ')}`);
  }

  const problem = problemParts.join('\n\n') || 'Investigate and propose a minimal fix plan.';

  if (useToT) {
    return {
      shouldTrigger: true,
      toolName: 'tree_of_thought',
      key,
      reason: 'Major architectural milestone (30 iterations); generating broad parallel hypotheses.',
      toolArgs: {
        mode: 'diagnose',
        problem,
        branches: 3,
        role: 'investigator',
        max_iterations: 40,
        min_iterations: 10,
      },
    };
  }

  if (useDeepReasoning) {
    return {
      shouldTrigger: true,
      toolName: 'deep_reasoning',
      key,
      reason: 'Periodic deep reasoning (5 iterations) or immediate error detection.',
      toolArgs: {
        problem,
        max_iterations: 15,
        min_iterations: 8,
      },
    };
  }

  return { shouldTrigger: false };
}

export function recordAutoToT(memoryStore: MemoryStore, decision: AutoToTDecision): void {
  if (!decision.shouldTrigger || !decision.key || !decision.reason) return;
  const active = getActiveTask(memoryStore);
  memoryStore.updateWorkingState({
    lastAutoToT: {
      key: decision.key,
      reason: decision.reason,
      taskId: active?.id,
      triggeredAt: new Date(),
    },
  });
}

export function buildAutoToTInstruction(decision: AutoToTDecision): string {
  if (!decision.shouldTrigger || !decision.toolArgs || !decision.toolName) {
    return '';
  }

  return [
    `[AUTO REASONING REQUIRED: ${decision.toolName.toUpperCase()}]`,
    `Reason: ${decision.reason ?? 'Generate alternatives'}`,
    '',
    `Call ${decision.toolName} with these exact parameters:`,
    JSON.stringify(decision.toolArgs, null, 2),
    '',
    `${decision.toolName} will return suggestions to the chat.`,
    'Then: execute the suggested plan immediately.',
  ].join('\n');
}
