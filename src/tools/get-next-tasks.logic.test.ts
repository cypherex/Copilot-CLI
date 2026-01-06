import { getNextTasks } from './get-next-tasks.js';

describe('getNextTasks', () => {
  it('returns highest-priority ready task based on blocking count', () => {
    const tasks: any[] = [
      { id: 'p1', description: 'Parent 1', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'p2', description: 'Parent 2', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'a', description: 'Task A', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p1', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: true },
      { id: 'b', description: 'Task B', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p2', breakdownDepth: 1, estimatedComplexity: 'moderate', isDependencyLeaf: true },
      { id: 'c', description: 'Task C (blocked by A)', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p2', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: false, dependsOn: ['a'] },
    ];

    const result = getNextTasks(tasks as any, { maxTasks: 1 });
    expect(result.total_ready).toBe(2);
    expect(result.ready_tasks).toHaveLength(1);
    expect(result.ready_tasks[0].id).toBe('a');
  });

  it('supports includeParallel by selecting independent tasks', () => {
    const tasks: any[] = [
      { id: 'root', description: 'Root', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'p1', description: 'Parent 1', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'root' },
      { id: 'p2', description: 'Parent 2', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'root' },
      { id: 'a', description: 'Task A', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p1', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: true },
      { id: 'c', description: 'Task C (different subtree)', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p2', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: true },
    ];

    const result = getNextTasks(tasks as any, { maxTasks: 2, includeParallel: true });
    const ids = result.ready_tasks.map(t => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
  });
});
