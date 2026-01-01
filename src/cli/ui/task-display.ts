// Task Display UI - shows tasks at the bottom of the interface with status

import chalk from 'chalk';
import type { Task } from '../../memory/types.js';

export interface TaskDisplayItem {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  assignedTo?: string; // Which subagent or main agent is working on this
  progress?: number; // 0-100 - not in Task interface yet, can be added later
}

export interface TaskTree {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  children: TaskTree[];
  assignedTo?: string;
  progress?: number;
}

export class TaskDisplay {
  private tasks: Map<string, TaskDisplayItem> = new Map();
  private taskTree: TaskTree = { id: 'root', description: 'All Tasks', status: 'completed', priority: 'medium', children: [] };
  private currentBranch: string[] = ['root']; // Path to currently focused branch
  private maxHeight: number;
  private isInitialized = false;

  constructor(maxHeight: number = 8) {
    this.maxHeight = maxHeight;
  }

  // Update task list
  updateTasks(tasks: Task[]): void {
    this.tasks.clear();

    for (const task of tasks) {
      this.tasks.set(task.id, {
        id: task.id,
        description: task.description,
        status: task.status as any,
        priority: (task.priority === 'critical' ? 'high' : task.priority) as 'high' | 'medium' | 'low',
      });
    }

    this.rebuildTree();
  }

  // Add or update a single task
  updateTask(task: TaskDisplayItem): void {
    this.tasks.set(task.id, task);
    this.rebuildTree();
  }

  // Set task status
  setTaskStatus(taskId: string, status: TaskDisplayItem['status']): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      this.rebuildTree();
    }
  }

  // Set which subagent is working on a task
  assignTask(taskId: string, agentId: string, agentName: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.assignedTo = agentName;
      this.rebuildTree();
    }
  }

  // Set current branch (path to focus)
  setCurrentBranch(path: string[]): void {
    this.currentBranch = path.length > 0 ? path : ['root'];
  }

  // Rebuild the task tree from flat task list
  private rebuildTree(): void {
    // For now, create a simple flat tree under root
    // In the future, this could support hierarchical tasks
    this.taskTree = {
      id: 'root',
      description: 'All Tasks',
      status: this.getRootStatus(),
      priority: 'medium',
      children: Array.from(this.tasks.values()).map(task => ({
        id: task.id,
        description: task.description,
        status: task.status,
        priority: this.normalizePriority(task.priority),
        assignedTo: task.assignedTo,
        children: [],
      })),
    };
  }

  // Determine root status based on children
  private getRootStatus(): TaskDisplayItem['status'] {
    const statuses = Array.from(this.tasks.values()).map(t => t.status);
    
    if (statuses.some(s => s === 'in_progress')) return 'in_progress';
    if (statuses.some(s => s === 'blocked')) return 'blocked';
    if (statuses.some(s => s === 'pending')) return 'pending';
    return 'completed';
  }

  // Render the task display
  render(): string {
    if (!this.isInitialized || this.tasks.size === 0) {
      return '';
    }

    const lines: string[] = [];

    // Separator line
    lines.push(chalk.dim('─'.repeat(process.stdout.columns || 80)));

    // Get current branch to display
    const currentTree = this.getCurrentBranch();

    // Header
    const header = this.formatHeader(currentTree);
    lines.push(header);

    // Tasks (truncated to max height)
    const tasks = this.getTasksToDisplay(currentTree);
    for (const task of tasks.slice(0, this.maxHeight - 2)) {
      lines.push(this.formatTask(task));
    }

    // If there are more tasks, show indicator
    if (tasks.length > this.maxHeight - 2) {
      lines.push(chalk.dim(`... ${tasks.length - (this.maxHeight - 2)} more tasks`));
    }

    return lines.join('\n');
  }

  // Get the current branch (or root if not found)
  private getCurrentBranch(): TaskTree {
    let current = this.taskTree;
    
    for (let i = 1; i < this.currentBranch.length; i++) {
      const child = current.children.find(c => c.id === this.currentBranch[i]);
      if (child) {
        current = child;
      } else {
        break;
      }
    }

    return current;
  }

  // Get tasks to display (children of current branch, plus other roots at top level)
  private getTasksToDisplay(tree: TaskTree): TaskDisplayItem[] {
    const items: TaskDisplayItem[] = [];

    // Add children of current branch
    for (const child of tree.children) {
      items.push({
        id: child.id,
        description: child.description,
        status: child.status,
        priority: child.priority,
        assignedTo: child.assignedTo,
        progress: child.progress || undefined,
      });
    }

    // If we're not at root, add other roots at the bottom (collapsed)
    if (tree.id !== 'root') {
      const otherRoots = this.taskTree.children.filter(c => c.id !== tree.id);
      if (otherRoots.length > 0) {
        items.push({
          id: 'other-roots',
          description: `+ ${otherRoots.length} other task(s)`,
          status: 'pending',
          priority: 'low',
        });
      }
    }

    return items;
  }

  // Format the header
  private formatHeader(tree: TaskTree): string {
    const totalTasks = this.tasks.size;
    const completed = Array.from(this.tasks.values()).filter(t => t.status === 'completed').length;
    const inProgress = Array.from(this.tasks.values()).filter(t => t.status === 'in_progress').length;
    const blocked = Array.from(this.tasks.values()).filter(t => t.status === 'blocked').length;

    let parts: string[] = [];

    // Task count
    parts.push(chalk.bold.blue(`📋 Tasks (${totalTasks})`));

    // Status breakdown
    const statusParts: string[] = [];
    if (completed > 0) statusParts.push(chalk.green(`✓${completed}`));
    if (inProgress > 0) statusParts.push(chalk.yellow(`●${inProgress}`));
    if (blocked > 0) statusParts.push(chalk.red(`⚠${blocked}`));
    if (statusParts.length > 0) parts.push(statusParts.join(' '));

    // Current branch (if not root)
    if (tree.id !== 'root' && tree.id !== 'All Tasks') {
      parts.push(chalk.dim(`└ ${tree.description}`));
    }

    return parts.join(' • ');
  }

  // Format a single task
  private formatTask(task: TaskDisplayItem): string {
    const icon = this.getStatusIcon(task.status);
    const priorityColor = this.getPriorityColor(task.priority);
    const description = task.description.slice(0, 60) + (task.description.length > 60 ? '...' : '');
    let parts: string[] = [];

    // Status icon
    parts.push(icon);

    // Description
    parts.push(chalk.white(description));

    // Assigned to
    if (task.assignedTo) {
      parts.push(chalk.dim(`(${task.assignedTo})`));
    }

    // Progress bar
    if (task.progress !== undefined && task.progress > 0) {
      const filled = Math.floor(task.progress / 10);
      const empty = 10 - filled;
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      parts.push(chalk.cyan(`[${bar}]`));
    }

    return '  ' + parts.join(' ');
  }

  // Get status icon
  private getStatusIcon(status: TaskDisplayItem['status']): string {
    switch (status) {
      case 'completed':
        return chalk.green('✓');
      case 'in_progress':
        return chalk.yellow('●');
      case 'blocked':
        return chalk.red('⚠');
      case 'pending':
      default:
        return chalk.gray('○');
    }
  }

  // Get priority color
  private getPriorityColor(priority: TaskDisplayItem['priority']): (text: string) => string {
    switch (priority) {
      case 'high':
        return chalk.red;
      case 'medium':
        return chalk.yellow;
      case 'low':
      default:
        return chalk.gray;
    }
  }

  // Normalize task priority (handle 'critical' from MemoryPriority)
  private normalizePriority(priority: 'critical' | 'high' | 'medium' | 'low'): 'high' | 'medium' | 'low' {
    return priority === 'critical' ? 'high' : priority;
  }

  // Initialize the display (call once when first showing)
  initialize(): void {
    this.isInitialized = true;
  }

  // Clear the display
  clear(): void {
    this.tasks.clear();
    this.taskTree = { id: 'root', description: 'All Tasks', status: 'completed', priority: 'medium', children: [] };
    this.isInitialized = false;
  }

  // Get task count
  getTaskCount(): number {
    return this.tasks.size;
  }

  // Get active task count
  getActiveTaskCount(): number {
    return Array.from(this.tasks.values()).filter(t => t.status === 'in_progress').length;
  }
}
