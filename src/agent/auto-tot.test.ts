import { buildAutoToTInstruction, decideAutoToT, recordAutoToT } from './auto-tot.js';

function makeMemoryStore(overrides: any = {}) {
  const workingState: any = {
    activeFiles: [],
    recentErrors: [],
    editHistory: [],
    commandHistory: [],
    lastUpdated: new Date(),
    ...overrides.workingState,
  };

  const activeTask: any = overrides.activeTask ?? {
    id: 'task_1',
    description: 'Fix failing test in parser',
    status: 'active',
    priority: 'high',
    relatedFiles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const memoryStore: any = {
    getWorkingState: jest.fn(() => workingState),
    updateWorkingState: jest.fn((u: any) => Object.assign(workingState, u)),
    getActiveTask: jest.fn(() => activeTask),
  };

  return { memoryStore, workingState, activeTask };
}

describe('auto ToT', () => {
  it('does not trigger when there is no failure signal', () => {
    const { memoryStore } = makeMemoryStore({
      activeTask: { id: 'task_1', description: 'Write docs', status: 'active', priority: 'low', relatedFiles: [], createdAt: new Date(), updatedAt: new Date() },
    });

    const decision = decideAutoToT(memoryStore, { kind: 'after_task_set' });
    expect(decision.shouldTrigger).toBe(false);
  });

  it('triggers after task set when breakdown is recent', () => {
    const { memoryStore } = makeMemoryStore({
      workingState: {
        lastTaskBreakdown: { rootTaskId: 'task_root', totalTasks: 10, readyTasks: 6, generatedAt: new Date() },
      },
    });

    const decision = decideAutoToT(memoryStore, { kind: 'after_task_set' });
    expect(decision.shouldTrigger).toBe(true);
    expect(decision.toolName).toBe('deep_reasoning');
    expect(decision.toolArgs?.problem).toContain('Current task:');
    expect(buildAutoToTInstruction(decision)).toContain('DEEP_REASONING');
  });

  it('triggers on repro_failed when last repro is failing', () => {
    const { memoryStore } = makeMemoryStore({
      workingState: {
        lastRepro: { id: 'cmd_1', command: 'pytest -q', cwd: process.cwd(), exitCode: 1, kind: 'repro', timestamp: new Date() },
      },
    });

    const decision = decideAutoToT(memoryStore, { kind: 'repro_failed' });
    expect(decision.shouldTrigger).toBe(true);
    expect(decision.toolName).toBe('deep_reasoning');
    expect(decision.toolArgs?.problem).toContain('Last repro command:');
  });

  it('triggers on iteration 5 tick when repro is failing', () => {
    const { memoryStore } = makeMemoryStore({
      workingState: {
        lastRepro: { id: 'cmd_1', command: 'npm test', cwd: process.cwd(), exitCode: 1, kind: 'repro', timestamp: new Date() },
      },
    });

    const decision = decideAutoToT(memoryStore, { kind: 'iteration_tick', iteration: 5 });
    expect(decision.shouldTrigger).toBe(true);
  });

  it('throttles repeated triggers with same key', () => {
    const { memoryStore, workingState } = makeMemoryStore({
      workingState: {
        lastRepro: { id: 'cmd_1', command: 'npm test', cwd: process.cwd(), exitCode: 1, kind: 'repro', timestamp: new Date() },
      },
    });

    const first = decideAutoToT(memoryStore, { kind: 'repro_failed' });
    expect(first.shouldTrigger).toBe(true);
    recordAutoToT(memoryStore, first);
    expect(workingState.lastAutoToT).toBeTruthy();

    const second = decideAutoToT(memoryStore, { kind: 'repro_failed' });
    expect(second.shouldTrigger).toBe(false);
  });
});
