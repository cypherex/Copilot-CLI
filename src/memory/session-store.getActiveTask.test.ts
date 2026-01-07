import { SessionMemoryStore } from './session-store.js';

describe('SessionMemoryStore.getActiveTask', () => {
  test('prefers workingState.currentTask when set', () => {
    const store = new SessionMemoryStore('test');

    const waiting = store.addTask({
      description: 'Waiting task',
      status: 'waiting',
      priority: 'medium',
      relatedToGoal: true,
      relatedFiles: [],
    });

    const active = store.addTask({
      description: 'Active task',
      status: 'active',
      priority: 'medium',
      relatedToGoal: true,
      relatedFiles: [],
    });

    // Without currentTask, fall back to active-like status selection.
    expect(store.getActiveTask()?.id).toBe(active.id);

    // With currentTask set, prefer it even if not active.
    store.updateWorkingState({ currentTask: waiting.id });
    expect(store.getActiveTask()?.id).toBe(waiting.id);

    // Completing the current task clears currentTask and falls back again.
    store.updateTask(waiting.id, { status: 'completed' });
    expect(store.getActiveTask()?.id).toBe(active.id);
  });
});

