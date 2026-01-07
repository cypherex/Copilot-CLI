import { UpdateTaskStatusTool } from './task-management-tool.js';

function makeMemoryStore() {
  const tasks: any[] = [
    {
      id: 'task_1',
      description: 'Fix failing test',
      status: 'pending_verification',
      priority: 'high',
      relatedFiles: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      pendingVerificationAt: new Date(Date.now() - 1000),
    },
  ];

  const workingState: any = {
    activeFiles: [],
    recentErrors: [],
    editHistory: [{ file: 'a.ts', description: 'Modified', changeType: 'modify', timestamp: new Date(), relatedTaskId: 'task_1' }],
    commandHistory: [],
    lastUpdated: new Date(),
  };

  const memoryStore: any = {
    getTasks: jest.fn(() => tasks),
    updateTask: jest.fn((id: string, updates: any) => {
      const task = tasks.find((t) => t.id === id);
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

describe('UpdateTaskStatusTool verification gating', () => {
  it('blocks completion when there were edits but no passing verification recorded', async () => {
    const { memoryStore } = makeMemoryStore();
    const tool = new UpdateTaskStatusTool(memoryStore);

    const res = await tool.execute({
      task_id: 'task_1',
      status: 'completed',
      completion_message: 'Fixed it',
    });

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('no verification run recorded');
  });

  it('allows completion when a passing verification exists after pending_verification', async () => {
    const { memoryStore, workingState } = makeMemoryStore();
    workingState.lastVerification = {
      id: 'verify_1',
      commands: ['npm test'],
      cwd: process.cwd(),
      passed: true,
      startedAt: new Date(Date.now() - 500),
      finishedAt: new Date(),
      results: [{ command: 'npm test', exitCode: 0, durationMs: 10 }],
    };

    const tool = new UpdateTaskStatusTool(memoryStore);
    const res = await tool.execute({
      task_id: 'task_1',
      status: 'completed',
      completion_message: 'Fixed it',
    });

    expect(res.success).toBe(true);
  });
});

