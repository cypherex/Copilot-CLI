import type { Task } from '../memory/types.js';

export type GetNextTasksInput = {
  maxTasks: number;
  includeParallel: boolean;
};

export type GetNextTasksReadyTask = {
  id: string;
  description: string;
  complexity?: Task['estimatedComplexity'];
  depth?: number;
  blocking_count: number;
  dependencies_completed: string[];
};

export type GetNextTasksResult = {
  ready_tasks: GetNextTasksReadyTask[];
  total_ready: number;
  total_remaining: number;
  execution_progress: string;
  message?: string;
};

export function getNextTasks(allTasks: Task[], input: Partial<GetNextTasksInput> = {}): GetNextTasksResult {
  const maxTasks = input.maxTasks ?? 1;
  const includeParallel = input.includeParallel ?? false;

  const readyTasks = allTasks.filter((t) => t.status === 'waiting' && t.isDependencyLeaf === true);

  const totalCompleted = allTasks.filter((t) => t.status === 'completed').length;
  const totalRemaining = allTasks.length - totalCompleted;
  const executionProgress =
    allTasks.length === 0 ? '0.0%' : `${((totalCompleted / allTasks.length) * 100).toFixed(1)}%`;

  if (readyTasks.length === 0) {
    return {
      ready_tasks: [],
      total_ready: 0,
      total_remaining: totalRemaining,
      execution_progress: executionProgress,
      message: 'No tasks ready. Either all dependencies are unmet or all tasks completed.',
    };
  }

  // Calculate blocking count for each task (how many tasks depend on it)
  const blockingCounts = new Map<string, number>();
  for (const task of allTasks) {
    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        blockingCounts.set(depId, (blockingCounts.get(depId) || 0) + 1);
      }
    }
  }

  // Sort by priority:
  // 1) Higher blocking count (more tasks depend on it)
  // 2) Lower depth (foundational tasks first)
  // 3) Higher complexity (tackle hard things first)
  readyTasks.sort((a, b) => {
    const aBlocking = blockingCounts.get(a.id) || 0;
    const bBlocking = blockingCounts.get(b.id) || 0;
    if (aBlocking !== bBlocking) return bBlocking - aBlocking;

    const aDepth = a.breakdownDepth ?? Number.POSITIVE_INFINITY;
    const bDepth = b.breakdownDepth ?? Number.POSITIVE_INFINITY;
    if (aDepth !== bDepth) return aDepth - bDepth;

    const complexityOrder: Record<string, number> = { complex: 3, moderate: 2, simple: 1 };
    const aComplexity = complexityOrder[a.estimatedComplexity || 'simple'] ?? 1;
    const bComplexity = complexityOrder[b.estimatedComplexity || 'simple'] ?? 1;
    return bComplexity - aComplexity;
  });

  const byId = new Map(allTasks.map((t) => [t.id, t]));

  const sharesParentChain = (task1: Task, task2: Task): boolean => {
    const getParentChain = (task: Task): string[] => {
      const chain: string[] = [task.id];
      let current: Task | undefined = task;
      while (current?.parentId) {
        chain.push(current.parentId);
        current = byId.get(current.parentId);
      }
      return chain;
    };

    const chain1 = getParentChain(task1);
    const chain2 = getParentChain(task2);
    // Ignore overlap on global root tasks (tasks with no parentId), otherwise parallel selection
    // would never return more than 1 task for a single breakdown tree.
    return chain1.some((id) => {
      if (!chain2.includes(id)) return false;
      const node = byId.get(id);
      return !!node?.parentId;
    });
  };

  let selectedTasks: Task[] = [];
  if (includeParallel) {
    for (const candidate of readyTasks) {
      if (selectedTasks.length >= maxTasks) break;
      const isIndependent = selectedTasks.every((selected) => !sharesParentChain(candidate, selected));
      if (isIndependent) {
        selectedTasks.push(candidate);
      }
    }
  } else {
    selectedTasks = readyTasks.slice(0, maxTasks);
  }

  return {
    ready_tasks: selectedTasks.map((t) => ({
      id: t.id,
      description: t.description,
      complexity: t.estimatedComplexity,
      depth: t.breakdownDepth,
      blocking_count: blockingCounts.get(t.id) || 0,
      dependencies_completed: (t.dependsOn || []).map((depId) => {
        const dep = byId.get(depId);
        return dep ? `${depId}: ${dep.description}` : depId;
      }),
    })),
    total_ready: readyTasks.length,
    total_remaining: totalRemaining,
    execution_progress: executionProgress,
  };
}
