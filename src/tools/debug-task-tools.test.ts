import { DebugScaffoldTool, RecordExperimentResultTool } from './task-management-tool.js';

function createMockMemoryStore() {
  const tasks: any[] = [];
  let counter = 0;
  const workingState: any = {
    activeFiles: [],
    recentErrors: [],
    editHistory: [],
    commandHistory: [],
    lastUpdated: new Date(),
    currentTask: undefined,
  };

  const memoryStore: any = {
    getTasks: jest.fn(() => tasks),
    addTask: jest.fn((t: any) => {
      const now = new Date();
      const task = {
        id: `task_${++counter}`,
        createdAt: now,
        updatedAt: now,
        relatedFiles: [],
        ...t,
      };
      tasks.push(task);
      return task;
    }),
    updateTask: jest.fn((id: string, updates: any) => {
      const task = tasks.find((x) => x.id === id);
      if (!task) throw new Error(`Task not found: ${id}`);
      Object.assign(task, updates);
    }),
    getWorkingState: jest.fn(() => workingState),
    updateWorkingState: jest.fn((updates: any) => {
      Object.assign(workingState, updates);
    }),
  };

  return { memoryStore, tasks, workingState };
}

describe('debug task tools', () => {
  test('debug_scaffold creates a task tree and sets current to Repro', async () => {
    const { memoryStore, tasks, workingState } = createMockMemoryStore();
    const tool = new DebugScaffoldTool(memoryStore);

    const res = await tool.execute({
      bug: 'Login returns 500 when password contains unicode',
      experiments: 2,
      set_current_to_repro: true,
      include_regression_test_task: true,
    });

    expect(res.success).toBe(true);
    expect(tasks.length).toBe(10); // 1 root + 9 children

    const root = tasks.find(t => (t.description as string).startsWith('Debug:'));
    expect(root).toBeTruthy();

    const children = tasks.filter(t => t.parentId === root.id);
    expect(children.length).toBe(9);

    const repro = children.find(t => t.description.startsWith('Repro:'));
    expect(repro).toBeTruthy();
    expect(repro.status).toBe('active');
    expect(workingState.currentTask).toBe(repro.id);
  });

  test('record_experiment_result appends log, updates status, and can create follow-up', async () => {
    const { memoryStore, tasks, workingState } = createMockMemoryStore();

    const root = memoryStore.addTask({
      description: 'Debug: Something',
      status: 'active',
      priority: 'high',
      relatedToGoal: true,
      relatedFiles: [],
    });
    const exp = memoryStore.addTask({
      description: 'Experiment 1: run a targeted test (record outcome)',
      status: 'active',
      priority: 'high',
      relatedToGoal: true,
      relatedFiles: [],
      parentId: root.id,
    });
    workingState.currentTask = exp.id;

    const tool = new RecordExperimentResultTool(memoryStore);
    const res = await tool.execute({
      title: 'Try running tests with NODE_ENV=production',
      hypothesis: 'Different env toggles feature flag',
      prediction: '500 disappears in production env',
      steps: ['NODE_ENV=production npm test'],
      observed: '500 still reproduces; stack trace points to auth middleware',
      conclusion: 'refutes',
      next_step: 'Inspect auth middleware and route handler',
      status: 'blocked',
      blocked_by: 'Need repro steps from user including request payload',
      create_followup_task: true,
      followup_description: 'Collect exact request payload and headers that trigger 500',
      followup_priority: 'high',
    });

    expect(res.success).toBe(true);
    expect(exp.completionMessage).toContain('[Experiment Log]');
    expect(exp.completionMessage).toContain('Conclusion: refutes');
    expect(exp.status).toBe('blocked');
    expect(exp.blockedBy).toBe('Need repro steps from user including request payload');

    const followups = tasks.filter(t => t.description.includes('Collect exact request payload'));
    expect(followups).toHaveLength(1);
    expect(followups[0].parentId).toBe(root.id);
    expect(followups[0].priority).toBe('high');
  });
});
