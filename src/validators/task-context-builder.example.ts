// Example usage of task context builder
// This file demonstrates how to use the task context builder functions

import { buildTaskContext, buildCompletedTasksSummary, buildTaskContextByStatus } from './task-context-builder.js';
import type { Task } from '../memory/types.js';

// Example: Create some sample tasks
function createExampleTasks(): Task[] {
  const now = new Date();

  return [
    // Parent task that's active
    {
      id: 'task_1',
      description: 'Implement user authentication system',
      status: 'active',
      priority: 'high',
      relatedFiles: [],
      createdAt: now,
      updatedAt: now,
    },
    // Completed subtask with files modified
    {
      id: 'task_2',
      description: 'Create user schema and database tables',
      status: 'completed',
      priority: 'high',
      parentId: 'task_1',
      relatedFiles: ['src/models/user.ts', 'src/db/schema.sql'],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      filesModified: ['src/models/user.ts', 'src/db/schema.sql'], // Auto-populated from EditRecords
    },
    // Active subtask
    {
      id: 'task_3',
      description: 'Implement login endpoint with JWT',
      status: 'active',
      priority: 'high',
      parentId: 'task_1',
      relatedFiles: [],
      createdAt: now,
      updatedAt: now,
    },
    // Waiting subtask
    {
      id: 'task_4',
      description: 'Add password hashing middleware',
      status: 'waiting',
      priority: 'medium',
      parentId: 'task_1',
      relatedFiles: [],
      createdAt: now,
      updatedAt: now,
    },
    // Another completed task (standalone)
    {
      id: 'task_5',
      description: 'Fix navbar styling bug',
      status: 'completed',
      priority: 'low',
      relatedFiles: ['src/components/Navbar.tsx'],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      filesModified: ['src/components/Navbar.tsx', 'src/styles/navbar.css'],
    },
  ];
}

// Example 1: Build complete task context
export function example1() {
  const tasks = createExampleTasks();
  const context = buildTaskContext(tasks);

  console.log('=== EXAMPLE 1: Complete Task Context ===');
  console.log(context);
  console.log('\n');
}

// Example 2: Build completed tasks summary
export function example2() {
  const tasks = createExampleTasks();
  const summary = buildCompletedTasksSummary(tasks);

  console.log('=== EXAMPLE 2: Completed Tasks Summary ===');
  console.log(summary);
  console.log('\n');
}

// Example 3: Filter by status
export function example3() {
  const tasks = createExampleTasks();
  const activeContext = buildTaskContextByStatus(tasks, 'active');

  console.log('=== EXAMPLE 3: Active Tasks Only ===');
  console.log(activeContext);
  console.log('\n');
}

// Example 4: How automatic file tracking works
export function example4() {
  console.log('=== EXAMPLE 4: How Automatic File Tracking Works ===');
  console.log('');
  console.log('1. During task execution:');
  console.log('   - User marks task as active using update_task_status');
  console.log('   - As files are created/modified, EditRecords are created with relatedTaskId');
  console.log('   - Example: memoryStore.addEditRecord({');
  console.log('       file: "src/models/user.ts",');
  console.log('       description: "Created user model",');
  console.log('       changeType: "create",');
  console.log('       relatedTaskId: "task_2"  // Links to active task');
  console.log('     })');
  console.log('');
  console.log('2. When task is marked as completed:');
  console.log('   - UpdateTaskStatusTool automatically:');
  console.log('     a) Finds all EditRecords with matching relatedTaskId');
  console.log('     b) Extracts unique file paths from those records');
  console.log('     c) Populates task.filesModified with the list');
  console.log('');
  console.log('3. Result:');
  console.log('   - Task now has complete history of files modified');
  console.log('   - Can be used for context building, summaries, etc.');
  console.log('   - Example output: "Files modified: src/models/user.ts, src/db/schema.sql"');
  console.log('\n');
}

// Run all examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example1();
  example2();
  example3();
  example4();
}
