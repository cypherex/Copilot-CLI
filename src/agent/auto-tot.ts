import type { MemoryStore, WorkingState, Task } from '../memory/types.js';

export type AutoToTTrigger =
  | { kind: 'after_task_set' }
  | { kind: 'repro_failed' }
  | { kind: 'iteration_tick'; iteration: number }
  | { kind: 'subagent_spawn' };

export type AutoToTDecision = {
  shouldTrigger: boolean;
  key?: string;
  reason?: string;
  toolArgs?: {
    mode: 'clarify' | 'triage' | 'diagnose' | 'next_step' | 'patch_plan';
    problem: string;
    branches: number;
    role: string;
    allow_execute: boolean;
    max_iterations: number;
    files?: string[];
    require_evidence: boolean;
  };
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

  // Throttle: don’t re-trigger for the same “state key”.
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
  if (trigger.kind === 'iteration_tick') {
    if (trigger.iteration % 5 !== 0) return { shouldTrigger: false };
    // Relaxed: Run periodic check regardless of failure state to ensure architectural alignment
  }

  if (trigger.kind === 'after_task_set') {
    // Only auto-trigger after setting a task if we recently generated a dependency-ordered tree or have a failing repro.
    const hasRecentBreakdown = isRecent(working.lastTaskBreakdown?.generatedAt, 5 * 60_000);
    if (!hasRecentBreakdown && !lastReproFailing) return { shouldTrigger: false };
  }

  if (trigger.kind === 'repro_failed') {
    if (!lastReproFailing) return { shouldTrigger: false };
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

  const reason =
    trigger.kind === 'repro_failed'
      ? 'Repro is failing; generate competing root-cause hypotheses and patch sketches.'
      : trigger.kind === 'after_task_set'
        ? 'Task selected after breakdown; generate a focused plan and verification strategy.'
        : trigger.kind === 'iteration_tick'
          ? 'Periodic checkpoint; generate alternatives to unblock progress.'
          : 'Subagent spawn; generate focused plan before proceeding.';

  const mode =
    trigger.kind === 'after_task_set'
      ? 'next_step'
      : trigger.kind === 'iteration_tick'
        ? 'next_step'
        : trigger.kind === 'subagent_spawn'
          ? 'next_step'
          : 'diagnose';

  return {
    shouldTrigger: true,
    key,
    reason,
    toolArgs: {
      mode,
      problem: problemParts.join('\n\n') || 'Investigate and propose a minimal fix plan.',
      branches: 3,
      role: 'investigator',
      allow_execute: false,
      max_iterations: 40,
      require_evidence: false,
    },
  };
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
  if (!decision.shouldTrigger || !decision.toolArgs) {
    return '';
  }

  return [
    '[AUTO ToT REQUIRED]',
    `Reason: ${decision.reason ?? 'Generate alternatives'}`,
    '',
    'Call tree_of_thought with these exact parameters:',
    JSON.stringify(decision.toolArgs, null, 2),
    '',
    'tree_of_thought will return ranked suggestions to the chat (it does not enforce a decision).',
    'Then: pick a branch idea, gather evidence (read_file/grep_repo), implement the minimal fix, run run_repro and verify_project, and continue.',
  ].join('\n');
}
