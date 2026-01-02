import chalk from 'chalk';
import { log } from '../utils/index.js';
import type { MemoryStore, SessionResume } from '../memory/types.js';

/**
 * Manages work continuity across sessions
 */
export class WorkContinuityManager {
  private readonly RESUME_THRESHOLD = 30 * 60 * 1000; // 30 minutes
  private lastSessionTime?: Date;

  constructor(private memoryStore: MemoryStore) {
    this.lastSessionTime = this.loadLastSessionTime();
  }

  /**
   * Check if this is a session resume (time gap above threshold)
   */
  isSessionResume(): boolean {
    if (!this.lastSessionTime) return false;

    const timeSince = Date.now() - this.lastSessionTime.getTime();
    return timeSince > this.RESUME_THRESHOLD;
  }

  /**
   * Get session resume information
   */
  getSessionResumeInfo(): SessionResume | null {
    if (!this.isSessionResume() || !this.lastSessionTime) {
      return null;
    }

    const goal = this.memoryStore.getGoal();
    const tasks = this.memoryStore.getTasks();
    const activeTask = tasks.find(t => t.status === 'active');
    const workingState = this.memoryStore.getWorkingState();
    const decisions = this.memoryStore.getDecisions();

    // Calculate time gap
    const timeSinceMs = Date.now() - this.lastSessionTime.getTime();
    const timeSinceHours = Math.round(timeSinceMs / (60 * 60 * 1000) * 10) / 10;
    const timeSinceStr = timeSinceHours < 1
      ? `${Math.round(timeSinceMs / 60000)} minutes ago`
      : timeSinceHours < 24
      ? `${timeSinceHours} hours ago`
      : `${Math.round(timeSinceHours / 24)} days ago`;

    // Get last edited file
    const lastEditedFile = workingState?.editHistory[0]?.file;

    return {
      lastActiveTime: this.lastSessionTime,
      lastGoalDescription: goal?.description,
      goalProgress: undefined, // progress is string, not number
      activeTaskDescription: activeTask?.description,
      pausedAtDescription: activeTask?.description || (workingState?.editHistory[0]?.description),
      lastFileEdited: lastEditedFile,
      pendingDecisionsCount: decisions.length,
      completedTasksCount: tasks.filter(t => t.status === 'completed').length,
      activeTasksCount: tasks.filter(t => t.status === 'active').length,
    };
  }

  /**
   * Display session resume prompt
   */
  displaySessionResume(): void {
    const info = this.getSessionResumeInfo();
    if (!info) return;

    const timeSince = this.getTimeSinceString(info.lastActiveTime);

    log.log('');
    log.log('[Session Resumed]', chalk.cyan.bold);
    log.log(`Last active: ${timeSince}`, chalk.gray);
    log.log('');

    // Last work
    if (info.lastGoalDescription || info.goalProgress !== undefined) {
      log.log('📋 You were working on:', chalk.cyan);
      if (info.lastGoalDescription) {
        log.log(`   ${info.lastGoalDescription}`);
      }
      if (info.goalProgress !== undefined) {
        const active = info.activeTasksCount || 0;
        const completed = info.completedTasksCount || 0;
        const total = active + completed;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        log.log(`   Status: ${percent}% complete (${completed}/${total} tasks done)`, chalk.gray);
      }
      log.log('');
    }

    // Paused at
    if (info.pausedAtDescription) {
      log.log('⏸️  Paused at:', chalk.cyan);
      log.log(`   ${info.pausedAtDescription}`);
      if (info.lastFileEdited) {
        log.log(`   Last file: ${this.shortPath(info.lastFileEdited)}`, chalk.gray);
      }
      log.log('');
    }

    // Pending decisions
    if (info.pendingDecisionsCount && info.pendingDecisionsCount > 0) {
      log.log('🔄 Pending decisions:', chalk.cyan);
      const decisions = this.memoryStore.getDecisions();
      if (decisions.length > 0) {
        decisions.slice(0, 3).forEach((decision, index) => {
          log.log(`   - ${decision.description}`, chalk.dim);
          if (decision.revisitCondition) {
            log.log(`     Revisit: ${decision.revisitCondition}`, chalk.dim);
          }
        });
        if (decisions.length > 3) {
          log.log(`   ... and ${decisions.length - 3} more`, chalk.dim);
        }
      }
      log.log('');
    }

    log.log('💡 Ready to continue where you left off!', chalk.green);
    log.log('');
  }

  /**
   * Update last session time
   */
  updateSessionTime(): void {
    this.lastSessionTime = new Date();
    this.saveLastSessionTime();
  }

  /**
   * Get formatted time since string
   */
  private getTimeSinceString(date: Date): string {
    const timeSinceMs = Date.now() - date.getTime();
    const minutes = Math.floor(timeSinceMs / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }
  }

  /**
   * Get shortened path for display
   */
  private shortPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    if (parts.length <= 2) return filePath;
    return parts.slice(-2).join('/');
  }

  /**
   * Save last session time to storage
   */
  private saveLastSessionTime(): void {
    try {
      // Could save to file or use memory store
      // For now, we'll use a simple approach
    } catch (error) {
      // Ignore save errors
    }
  }

  /**
   * Load last session time from storage
   */
  private loadLastSessionTime(): Date | undefined {
    try {
      // Could load from file or memory store
      // For now, return undefined (will be set on first update)
      return undefined;
    } catch (error) {
      return undefined;
    }
  }
}
