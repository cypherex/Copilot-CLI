// Session Memory Store - ephemeral session-scoped data (in-memory only)
// Contains: goals, tasks, working state, errors, edits, archive, retrieval history
// This data is NOT persisted between sessions

import type {
  SessionGoal,
  Task,
  TaskStatus,
  TrackingItem,
  TrackingItemStatus,
  IntegrationPoint,
  DesignDecision,
  WorkingState,
  ActiveFile,
  FileSection,
  ErrorContext,
  EditRecord,
  ArchiveEntry,
  RetrievalResult,
} from './types.js';

export interface SessionMemoryData {
  goals: SessionGoal[];
  tasks: Task[];
  trackingItems: TrackingItem[];
  integrationPoints: IntegrationPoint[];
  designDecisions: DesignDecision[];
  workingState: WorkingState;
  archive: ArchiveEntry[];
  retrievalHistory: RetrievalResult[];
}

export class SessionMemoryStore {
  private goals: Map<string, SessionGoal> = new Map();
  private rootGoalId?: string;
  private tasks: Map<string, Task> = new Map();
  private trackingItems: Map<string, TrackingItem> = new Map();
  private integrationPoints: Map<string, IntegrationPoint> = new Map();
  private designDecisions: Map<string, DesignDecision> = new Map();
  private workingState: WorkingState;
  private archiveEntries: ArchiveEntry[] = [];
  private retrievalHistory: RetrievalResult[] = [];
  private idCounter = 0;
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;

    this.workingState = {
      activeFiles: [],
      recentErrors: [],
      editHistory: [],
      commandHistory: [],
      lastUpdated: new Date(),
    };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // Export for session serialization
  export(): SessionMemoryData {
    return {
      goals: Array.from(this.goals.values()),
      tasks: Array.from(this.tasks.values()),
      trackingItems: Array.from(this.trackingItems.values()),
      integrationPoints: Array.from(this.integrationPoints.values()),
      designDecisions: Array.from(this.designDecisions.values()),
      workingState: this.workingState,
      archive: this.archiveEntries,
      retrievalHistory: this.retrievalHistory,
    }
  }

  // Import from session serialization
  import(data: SessionMemoryData): void {
    this.goals.clear();
    this.tasks.clear();
    this.trackingItems.clear();
    this.integrationPoints.clear();
    this.designDecisions.clear();
    this.rootGoalId = undefined;

    for (const goal of data.goals) {
      this.goals.set(goal.id, goal);
      if (!goal.parentGoalId) {
        this.rootGoalId = goal.id;
      }
    }

    for (const task of data.tasks) {
      this.tasks.set(task.id, task);
    }

    for (const item of data.trackingItems || []) {
      this.trackingItems.set(item.id, item);
    }

    for (const point of data.integrationPoints || []) {
      this.integrationPoints.set(point.id, point);
    }

    for (const decision of data.designDecisions || []) {
      this.designDecisions.set(decision.id, decision);
    }

    this.workingState = data.workingState;
    // Backward compatible defaults for older sessions
    if (!this.workingState.commandHistory) {
      this.workingState.commandHistory = [];
    }
    this.archiveEntries = data.archive;
    this.retrievalHistory = data.retrievalHistory;
  }

  private generateId(prefix: string): string {
    return `${prefix}_${++this.idCounter}_${Date.now().toString(36)}`;
  }

  // Session Goal (with hierarchy)
  getGoal(): SessionGoal | undefined {
    return this.rootGoalId ? this.goals.get(this.rootGoalId) : undefined;
  }

  getGoalById(id: string): SessionGoal | undefined {
    return this.goals.get(id);
  }

  getAllGoals(): SessionGoal[] {
    return Array.from(this.goals.values());
  }

  setGoal(goal: Omit<SessionGoal, 'id' | 'established'>): SessionGoal {
    const full: SessionGoal = {
      ...goal,
      id: this.generateId('goal'),
      established: new Date(),
      depth: 0,
    };
    this.goals.set(full.id, full);
    this.rootGoalId = full.id;
    return full;
  }

  addSubGoal(parentId: string, goal: Omit<SessionGoal, 'id' | 'established' | 'parentGoalId' | 'depth'>): SessionGoal {
    const parent = this.goals.get(parentId);
    if (!parent) {
      throw new Error(`Parent goal not found: ${parentId}`);
    }

    const full: SessionGoal = {
      ...goal,
      id: this.generateId('goal'),
      established: new Date(),
      parentGoalId: parentId,
      depth: (parent.depth || 0) + 1,
    };

    // Update parent's child list
    parent.childGoalIds = [...(parent.childGoalIds || []), full.id];

    this.goals.set(full.id, full);
    return full;
  }

  updateGoal(id: string, updates: Partial<SessionGoal>): void {
    const goal = this.goals.get(id);
    if (goal) {
      this.goals.set(id, { ...goal, ...updates });
    }
  }

  // Tasks
  getTasks(status?: TaskStatus): Task[] {
    const all = Array.from(this.tasks.values());
    if (status) {
      return all.filter(t => t.status === status);
    }
    return all;
  }

  getActiveTask(): Task | undefined {
    // Prefer explicitly selected current task, even if it isn't marked active yet.
    // This lets set_current_task establish context, and validators can still enforce status=active for writes.
    if (this.workingState.currentTask) {
      const current = this.tasks.get(this.workingState.currentTask);
      if (current && current.status !== 'completed' && current.status !== 'abandoned') {
        return current;
      }
    }

    const activeLike = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'active' || t.status === 'pending_verification'
    );

    if (activeLike.length === 0) return undefined;

    // Prefer newest, but break ties by preferring 'active' over 'pending_verification'
    return activeLike.sort((a, b) => {
      const timeDelta = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (timeDelta !== 0) return timeDelta;
      if (a.status === b.status) return 0;
      return a.status === 'active' ? -1 : 1;
    })[0];
  }

  getTaskById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const now = new Date();
    const full: Task = {
      ...task,
      id: this.generateId('task'),
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(full.id, full);

    if (task.status === 'active' && !this.workingState.currentTask) {
      this.workingState.currentTask = full.id;
    }

    return full;
  }

  updateTask(id: string, updates: Partial<Task>): void {
    const existing = this.tasks.get(id);
    if (existing) {
      const updated = {
        ...existing,
        ...updates,
        updatedAt: new Date(),
      };
      if (updates.status === 'completed') {
        updated.completedAt = new Date();
      }
      this.tasks.set(id, updated);

      if (this.workingState.currentTask === id &&
          (updates.status === 'completed' || updates.status === 'abandoned')) {
        this.workingState.currentTask = undefined;
      }
    }
  }

  // Tracking items
  getTrackingItems(status?: TrackingItemStatus): TrackingItem[] {
    const items = Array.from(this.trackingItems.values());
    if (status) {
      return items.filter(item => item.status === status);
    }
    return items.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  addTrackingItem(item: Omit<TrackingItem, 'id' | 'detectedAt'>): TrackingItem {
    const full: TrackingItem = {
      ...item,
      id: this.generateId('tracking'),
      detectedAt: new Date(),
    };
    this.trackingItems.set(full.id, full);
    return full;
  }

  updateTrackingItem(id: string, updates: Partial<TrackingItem>): void {
    const existing = this.trackingItems.get(id);
    if (existing) {
      const updated = {
        ...existing,
        ...updates,
      };

      // Auto-set timestamps based on status changes
      if (updates.status === 'under-review' && !updated.movedToReviewAt) {
        updated.movedToReviewAt = new Date();
      }
      if (updates.status === 'closed' && !updated.closedAt) {
        updated.closedAt = new Date();
      }

      this.trackingItems.set(id, updated);
    }
  }

  deleteTrackingItem(id: string): void {
    this.trackingItems.delete(id);
  }

  // Integration Points
  getIntegrationPoints(): IntegrationPoint[] {
    return Array.from(this.integrationPoints.values());
  }

  getIntegrationPointsForTask(taskId: string): IntegrationPoint[] {
    return Array.from(this.integrationPoints.values()).filter(
      point => point.sourceTask === taskId || point.targetTask === taskId
    );
  }

  addIntegrationPoint(point: Omit<IntegrationPoint, 'id' | 'createdAt'>): IntegrationPoint {
    const full: IntegrationPoint = {
      ...point,
      id: this.generateId('integration'),
      createdAt: new Date(),
    };
    this.integrationPoints.set(full.id, full);
    return full;
  }

  // Design Decisions
  getDesignDecisions(): DesignDecision[] {
    return Array.from(this.designDecisions.values());
  }

  getDesignDecisionsForTask(taskId: string): DesignDecision[] {
    return Array.from(this.designDecisions.values()).filter(
      decision => decision.parentTaskId === taskId || decision.affects.includes(taskId)
    );
  }

  addDesignDecision(decision: Omit<DesignDecision, 'id' | 'createdAt'>): DesignDecision {
    const full: DesignDecision = {
      ...decision,
      id: this.generateId('design'),
      createdAt: new Date(),
    };
    this.designDecisions.set(full.id, full);
    return full;
  }

  // Working state
  getWorkingState(): WorkingState {
    return { ...this.workingState };
  }

  updateWorkingState(updates: Partial<WorkingState>): void {
    this.workingState = {
      ...this.workingState,
      ...updates,
      lastUpdated: new Date(),
    };
  }

  addActiveFile(file: Omit<ActiveFile, 'lastAccessed' | 'sections'> & { sections?: FileSection[] }): void {
    const existing = this.workingState.activeFiles.findIndex(f => f.path === file.path);
    const entry: ActiveFile = {
      ...file,
      sections: file.sections || [],
      lastAccessed: new Date(),
    };

    if (existing >= 0) {
      // Merge sections
      const existingSections = this.workingState.activeFiles[existing].sections;
      entry.sections = this.mergeSections(existingSections, entry.sections);
      this.workingState.activeFiles[existing] = entry;
    } else {
      this.workingState.activeFiles.push(entry);
    }

    // Keep only 15 most recent
    if (this.workingState.activeFiles.length > 15) {
      this.workingState.activeFiles.sort((a, b) =>
        b.lastAccessed.getTime() - a.lastAccessed.getTime()
      );
      this.workingState.activeFiles = this.workingState.activeFiles.slice(0, 15);
    }

    this.workingState.lastUpdated = new Date();
  }

  addFileSection(filePath: string, section: FileSection): void {
    const file = this.workingState.activeFiles.find(f => f.path === filePath);
    if (file) {
      const existingIdx = file.sections.findIndex(s => s.name === section.name);
      if (existingIdx >= 0) {
        file.sections[existingIdx] = { ...file.sections[existingIdx], ...section };
      } else {
        file.sections.push(section);
      }
    } else {
      this.addActiveFile({
        path: filePath,
        purpose: `Editing ${section.name}`,
        sections: [section],
      });
    }
  }

  private mergeSections(existing: FileSection[], incoming: FileSection[]): FileSection[] {
    const merged = [...existing];
    for (const section of incoming) {
      const idx = merged.findIndex(s => s.name === section.name);
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...section };
      } else {
        merged.push(section);
      }
    }
    return merged;
  }

  addError(error: Omit<ErrorContext, 'timestamp' | 'resolved'>): void {
    this.workingState.recentErrors.push({
      ...error,
      timestamp: new Date(),
      resolved: false,
    });

    if (this.workingState.recentErrors.length > 20) {
      this.workingState.recentErrors = this.workingState.recentErrors.slice(-20);
    }

    this.workingState.lastUpdated = new Date();
  }

  resolveError(errorSubstring: string, resolution: string): void {
    for (const error of this.workingState.recentErrors) {
      if (!error.resolved && error.error.includes(errorSubstring)) {
        error.resolved = true;
        error.resolution = resolution;
      }
    }
    this.workingState.lastUpdated = new Date();
  }

  addEditRecord(edit: Omit<EditRecord, 'id' | 'timestamp'>): EditRecord {
    const record: EditRecord = {
      ...edit,
      id: this.generateId('edit'),
      timestamp: new Date(),
    };

    this.workingState.editHistory.push(record);

    // Keep last 50 edits
    if (this.workingState.editHistory.length > 50) {
      this.workingState.editHistory = this.workingState.editHistory.slice(-50);
    }

    this.workingState.lastUpdated = new Date();
    return record;
  }

  // Archive
  archive(entry: Omit<ArchiveEntry, 'id'>): ArchiveEntry {
    const full: ArchiveEntry = {
      ...entry,
      id: this.generateId('arch'),
    };
    this.archiveEntries.push(full);
    return full;
  }

  search(query: string, limit: number = 10): ArchiveEntry[] {
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(k => k.length > 2);

    const scored = this.archiveEntries.map(entry => {
      let score = 0;

      for (const keyword of keywords) {
        if (entry.keywords.some(k => k.includes(keyword))) score += 3;
        if (entry.summary.toLowerCase().includes(keyword)) score += 2;
        if (entry.content.toLowerCase().includes(keyword)) score += 1;
      }

      // Boost recent entries
      const age = Date.now() - new Date(entry.timestamp).getTime();
      const hoursOld = age / (1000 * 60 * 60);
      if (hoursOld < 1) score += 2;
      else if (hoursOld < 24) score += 1;

      // Boost by importance
      if (entry.importance === 'critical') score += 3;
      else if (entry.importance === 'high') score += 2;
      else if (entry.importance === 'medium') score += 1;

      return { entry, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry);
  }

  getRecentArchive(limit: number = 10): ArchiveEntry[] {
    return this.archiveEntries
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // Retrieval tracking
  trackRetrieval(result: Omit<RetrievalResult, 'id'>): RetrievalResult {
    const full: RetrievalResult = {
      ...result,
      id: this.generateId('ret'),
    };
    this.retrievalHistory.push(full);

    // Keep last 100 retrieval records
    if (this.retrievalHistory.length > 100) {
      this.retrievalHistory = this.retrievalHistory.slice(-100);
    }

    return full;
  }

  getRetrievalHistory(): RetrievalResult[] {
    return [...this.retrievalHistory];
  }

  markRetrievalUseful(id: string, useful: boolean): void {
    const result = this.retrievalHistory.find(r => r.id === id);
    if (result) {
      result.wasUseful = useful;
    }
  }

  // Clear all session data
  clear(): void {
    this.goals.clear();
    this.rootGoalId = undefined;
    this.tasks.clear();
    this.archiveEntries = [];
    this.retrievalHistory = [];
    this.workingState = {
      activeFiles: [],
      recentErrors: [],
      editHistory: [],
      commandHistory: [],
      lastUpdated: new Date(),
    };
  }
}
