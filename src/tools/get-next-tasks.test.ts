import { GetNextTasksTool } from './task-management-tool.js';

describe('GetNextTasksTool', () => {
  it('returns highest-priority ready task based on blocking count', async () => {
    const tasks: any[] = [
      { id: 'p1', description: 'Parent 1', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'p2', description: 'Parent 2', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'a', description: 'Task A', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p1', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: true },
      { id: 'b', description: 'Task B', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p2', breakdownDepth: 1, estimatedComplexity: 'moderate', isDependencyLeaf: true },
      { id: 'c', description: 'Task C (blocked by A)', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p2', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: false, dependsOn: ['a'] },
    ];

    const memoryStore = { getTasks: jest.fn(() => tasks) } as any;
    const tool = new GetNextTasksTool(memoryStore);

    const result = await tool.execute({ max_tasks: 1 });
    expect(result.success).toBe(true);

    const parsed = JSON.parse(result.output as string);
    expect(parsed.total_ready).toBe(2);
    expect(parsed.ready_tasks).toHaveLength(1);
    expect(parsed.ready_tasks[0].id).toBe('a');
  });

  it('supports include_parallel by selecting independent tasks (ignores shared root)', async () => {
    const tasks: any[] = [
      { id: 'root', description: 'Root', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'p1', description: 'Parent 1', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'root' },
      { id: 'p2', description: 'Parent 2', status: 'active', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'root' },
      { id: 'a', description: 'Task A', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p1', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: true },
      { id: 'c', description: 'Task C', status: 'waiting', priority: 'high', relatedFiles: [], createdAt: new Date(), updatedAt: new Date(), parentId: 'p2', breakdownDepth: 2, estimatedComplexity: 'simple', isDependencyLeaf: true },
    ];

    const memoryStore = { getTasks: jest.fn(() => tasks) } as any;
    const tool = new GetNextTasksTool(memoryStore);

    const result = await tool.execute({ max_tasks: 2, include_parallel: true });
    expect(result.success).toBe(true);

    const parsed = JSON.parse(result.output as string);
    const ids = parsed.ready_tasks.map((t: any) => t.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
  });
});
