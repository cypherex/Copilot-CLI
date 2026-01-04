// Memory Store - unified interface combining session and project memory
//
// Session Memory (ephemeral, not persisted to disk):
// - Goals and sub-goals
// - Tasks and task status
// - Working state (active files, recent errors, edit history)
// - Archive (context compression archive)
// - Retrieval history
//
// Project Memory (persisted to disk, shared across sessions):
// - User facts (about the user's preferences, habits, etc.)
// - User preferences (tooling, coding style, etc.)
// - Decisions (with supersession tracking)
// - Project context (tech stack, architecture, etc.)
// - Feature groups (file groupings)

import type { MemoryStore } from './types.js';
import { SessionMemoryStore } from './session-store.js';
import { ProjectMemoryStore } from './project-store.js';
import { v4 as uuidv4 } from 'uuid';

export class LocalMemoryStore implements MemoryStore {
  private sessionStore: SessionMemoryStore;
  private projectStore: ProjectMemoryStore;

  constructor(projectPath: string, sessionId?: string) {
    this.projectStore = new ProjectMemoryStore(projectPath);
    this.sessionStore = new SessionMemoryStore(sessionId || uuidv4());
  }

  // Initialize stores
  async initialize(): Promise<void> {
    await this.projectStore.load();
  }

  // Save project memory only (session memory is handled by SessionManager)
  async save(): Promise<void> {
    await this.projectStore.save();
  }

  // Session identification
  getSessionId(): string {
    return this.sessionStore.getSessionId();
  }

  // === DELEGATE TO SESSION STORE ===

  // Goals (session-scoped)
  getGoal() {
    return this.sessionStore.getGoal();
  }

  getGoalById(id: string) {
    return this.sessionStore.getGoalById(id);
  }

  getAllGoals() {
    return this.sessionStore.getAllGoals();
  }

  setGoal(goal: any) {
    return this.sessionStore.setGoal(goal);
  }

  addSubGoal(parentId: string, goal: any) {
    return this.sessionStore.addSubGoal(parentId, goal);
  }

  updateGoal(id: string, updates: any) {
    return this.sessionStore.updateGoal(id, updates);
  }

  // Tasks (session-scoped)
  getTasks(status?: any) {
    return this.sessionStore.getTasks(status);
  }

  getActiveTask() {
    return this.sessionStore.getActiveTask();
  }

  getTaskById(id: string) {
    return this.sessionStore.getTaskById(id);
  }

  addTask(task: any) {
    return this.sessionStore.addTask(task);
  }

  updateTask(id: string, updates: any) {
    return this.sessionStore.updateTask(id, updates);
  }

  // Tracking items (session-scoped)
  getTrackingItems(status?: any) {
    return this.sessionStore.getTrackingItems(status);
  }

  addTrackingItem(item: any) {
    return this.sessionStore.addTrackingItem(item);
  }

  updateTrackingItem(id: string, updates: any) {
    return this.sessionStore.updateTrackingItem(id, updates);
  }

  deleteTrackingItem(id: string) {
    return this.sessionStore.deleteTrackingItem(id);
  }

  // Integration Points (session-scoped)
  getIntegrationPoints() {
    return this.sessionStore.getIntegrationPoints();
  }

  getIntegrationPointsForTask(taskId: string) {
    return this.sessionStore.getIntegrationPointsForTask(taskId);
  }

  addIntegrationPoint(point: any) {
    return this.sessionStore.addIntegrationPoint(point);
  }

  // Design Decisions (session-scoped)
  getDesignDecisions() {
    return this.sessionStore.getDesignDecisions();
  }

  getDesignDecisionsForTask(taskId: string) {
    return this.sessionStore.getDesignDecisionsForTask(taskId);
  }

  addDesignDecision(decision: any) {
    return this.sessionStore.addDesignDecision(decision);
  }

  // Working state (session-scoped)
  getWorkingState() {
    return this.sessionStore.getWorkingState();
  }

  updateWorkingState(updates: any) {
    return this.sessionStore.updateWorkingState(updates);
  }

  addActiveFile(file: any) {
    // Infer feature group from project store
    const featureGroup = this.projectStore.inferFeatureGroup(file.path);
    if (featureGroup && !file.featureGroup) {
      file.featureGroup = featureGroup;
    }
    return this.sessionStore.addActiveFile(file);
  }

  addFileSection(filePath: string, section: any) {
    return this.sessionStore.addFileSection(filePath, section);
  }

  addError(error: any) {
    return this.sessionStore.addError(error);
  }

  resolveError(errorSubstring: string, resolution: string) {
    return this.sessionStore.resolveError(errorSubstring, resolution);
  }

  addEditRecord(edit: any) {
    return this.sessionStore.addEditRecord(edit);
  }

  // Archive (session-scoped)
  archive(entry: any) {
    return this.sessionStore.archive(entry);
  }

  search(query: string, limit?: number) {
    return this.sessionStore.search(query, limit);
  }

  getRecentArchive(limit?: number) {
    return this.sessionStore.getRecentArchive(limit);
  }

  // Retrieval tracking (session-scoped)
  trackRetrieval(result: any) {
    return this.sessionStore.trackRetrieval(result);
  }

  getRetrievalHistory() {
    return this.sessionStore.getRetrievalHistory();
  }

  markRetrievalUseful(id: string, useful: boolean) {
    return this.sessionStore.markRetrievalUseful(id, useful);
  }

  // === DELEGATE TO PROJECT STORE ===

  // User Facts (project-scoped)
  getUserFacts() {
    return this.projectStore.getUserFacts();
  }

  getAllUserFacts() {
    return this.projectStore.getAllUserFacts();
  }

  addUserFact(fact: any) {
    return this.projectStore.addUserFact(fact);
  }

  reinforceUserFact(id: string) {
    return this.projectStore.reinforceUserFact(id);
  }

  supersedeUserFact(id: string, newFactId: string) {
    return this.projectStore.supersedeUserFact(id, newFactId);
  }

  getUserFactById(id: string) {
    return this.projectStore.getUserFactById(id);
  }

  // Preferences (project-scoped)
  getPreferences() {
    return this.projectStore.getPreferences();
  }

  getAllPreferences() {
    return this.projectStore.getAllPreferences();
  }

  addPreference(pref: any) {
    return this.projectStore.addPreference(pref);
  }

  updatePreference(id: string, updates: any) {
    return this.projectStore.updatePreference(id, updates);
  }

  supersedePreference(id: string, newPrefId: string) {
    return this.projectStore.supersedePreference(id, newPrefId);
  }

  getPreferenceByKey(category: string, key: string) {
    return this.projectStore.getPreferenceByKey(category, key);
  }

  // Decisions (project-scoped)
  getDecisions() {
    return this.projectStore.getDecisions();
  }

  getAllDecisions() {
    return this.projectStore.getAllDecisions();
  }

  addDecision(decision: any) {
    return this.projectStore.addDecision(decision);
  }

  supersedeDecision(id: string, newDecisionId: string) {
    return this.projectStore.supersedeDecision(id, newDecisionId);
  }

  getDecisionById(id: string) {
    return this.projectStore.getDecisionById(id);
  }

  // Project context (project-scoped)
  getProjectContext() {
    return this.projectStore.getProjectContext();
  }

  addProjectContext(ctx: any) {
    return this.projectStore.addProjectContext(ctx);
  }

  getProjectContextByType(type: any) {
    return this.projectStore.getProjectContextByType(type);
  }

  // Feature Groups (project-scoped)
  getFeatureGroups() {
    return this.projectStore.getFeatureGroups();
  }

  addFeatureGroup(group: any) {
    return this.projectStore.addFeatureGroup(group);
  }

  addFileToGroup(groupId: string, filePath: string) {
    return this.projectStore.addFileToGroup(groupId, filePath);
  }

  getFeatureGroupForFile(filePath: string) {
    return this.projectStore.getFeatureGroupForFile(filePath);
  }

  // Decay configuration (project-scoped)
  setDecayConfig(config: any) {
    return this.projectStore.setDecayConfig(config);
  }

  // Clear operations
  clear(lifespan?: any) {
    // Only clear session data - project data persists
    if (!lifespan || lifespan === 'session') {
      this.sessionStore.clear();
    }
    // Allow clearing project data if explicitly requested
    if (lifespan && lifespan !== 'session') {
      this.projectStore.clear(lifespan);
    }
  }

  // Session data export/import
  exportSessionData() {
    return this.sessionStore.export();
  }

  importSessionData(data: any) {
    return this.sessionStore.import(data);
  }

  // Apply confidence decay to project data
  applyConfidenceDecay(config?: any) {
    return this.projectStore.applyConfidenceDecay(config);
  }

  // Build context summary combining session and project data
  buildContextSummary(tokenBudget?: number): string {
    // This method combines session and project context
    // For now, we'll keep minimal implementation
    const parts: string[] = [];

    // Session goal
    const rootGoal = this.getGoal();
    if (rootGoal && rootGoal.status === 'active') {
      let goalSection = '## Mission\n' + rootGoal.description;
      if (rootGoal.progress) {
        goalSection += `\nCurrent progress: ${rootGoal.progress}`;
      }
      parts.push(goalSection);
    }

    // Active task
    const activeTask = this.getActiveTask();
    if (activeTask) {
      let taskSection = '\n## Current Task\n' + activeTask.description;
      if (activeTask.blockedBy) {
        taskSection += `\nBlocked by: ${activeTask.blockedBy}`;
      }
      parts.push(taskSection);
    }

    // Unresolved errors
    const unresolvedErrors = this.getWorkingState().recentErrors.filter(e => !e.resolved);
    if (unresolvedErrors.length > 0) {
      let errorSection = '\n## Unresolved Errors';
      for (const error of unresolvedErrors.slice(-3)) {
        errorSection += `\n- ${error.error.slice(0, 200)}`;
      }
      parts.push(errorSection);
    }

    // User facts (from project)
    const facts = this.getUserFacts().filter(f => f.confidence >= 0.6);
    if (facts.length > 0) {
      let factSection = '\n## User Context';
      for (const fact of facts.slice(0, 5)) {
        factSection += `\n- ${fact.fact}`;
      }
      parts.push(factSection);
    }

    // User preferences (from project)
    const prefs = this.getPreferences().filter(p => p.confidence >= 0.6);
    if (prefs.length > 0) {
      let prefSection = '\n## User Preferences';
      for (const pref of prefs.slice(0, 10)) {
        prefSection += `\n- ${pref.category}/${pref.key}: ${pref.value}`;
      }
      parts.push(prefSection);
    }

    // Active files (from session)
    const activeFiles = this.getWorkingState().activeFiles.filter(f =>
      f.sections.length > 0 || f.purpose
    );
    if (activeFiles.length > 0) {
      let fileSection = '\n## Working On';
      for (const file of activeFiles.slice(0, 5)) {
        let line = `\n- ${file.path}`;
        if (file.sections.length > 0) {
          line += ` (${file.sections.map(s => s.name).join(', ')})`;
        }
        if (file.purpose) {
          line += `: ${file.purpose}`;
        }
        fileSection += line;
      }
      parts.push(fileSection);
    }

    // Pending tasks (from session)
    const pendingTasks = this.getTasks('blocked').concat(this.getTasks('waiting'));
    if (pendingTasks.length > 0) {
      let pendingSection = '\n## Pending Tasks';
      for (const task of pendingTasks.slice(0, 5)) {
        const status = task.blockedBy ? `blocked: ${task.blockedBy}` :
                       task.waitingFor ? `waiting: ${task.waitingFor}` : task.status;
        pendingSection += `\n- ${task.description} (${status})`;
      }
      parts.push(pendingSection);
    }

    // Project context (from project)
    const ctx = this.getProjectContext();
    if (ctx.length > 0) {
      let ctxSection = '\n## Project Context';
      for (const c of ctx.slice(0, 10)) {
        ctxSection += `\n- ${c.type}: ${c.key} = ${c.value}`;
      }
      parts.push(ctxSection);
    }

    return parts.join('\n');
  }

  buildResumptionContext(): string {
    const parts: string[] = [];

    // Current goal (session-scoped)
    const rootGoal = this.getGoal();
    if (rootGoal && rootGoal.status === 'active') {
      parts.push('## Current Goal');
      parts.push(rootGoal.description);
      if (rootGoal.progress) {
        parts.push(`Progress: ${rootGoal.progress}`);
      }
      // Show active sub-goals
      const subGoals = this.getAllGoals().filter(g =>
        g.parentGoalId && g.status === 'active'
      );
      if (subGoals.length > 0) {
        parts.push('\nActive sub-goals:');
        for (const sub of subGoals.slice(0, 3)) {
          const indent = '  '.repeat(sub.depth || 1);
          parts.push(`${indent}- ${sub.description}`);
        }
      }
    }

    // Incomplete tasks (session-scoped)
    const incompleteTasks = this.getTasks().filter(t =>
      t.status === 'active' || t.status === 'blocked' || t.status === 'waiting'
    );
    if (incompleteTasks.length > 0) {
      parts.push('\n## Pending Tasks');
      for (const task of incompleteTasks.slice(0, 5)) {
        const status = task.blockedBy ? `blocked: ${task.blockedBy}` :
                       task.waitingFor ? `waiting: ${task.waitingFor}` : 'active';
        parts.push(`- [${status}] ${task.description}`);
      }
    }

    // Unresolved errors from last session (session-scoped)
    const unresolvedErrors = this.getWorkingState().recentErrors.filter(e => !e.resolved);
    if (unresolvedErrors.length > 0) {
      parts.push('\n## Unresolved Issues');
      for (const error of unresolvedErrors.slice(-3)) {
        parts.push(`- ${error.error.slice(0, 150)}`);
      }
    }

    // Recent edit summary (session-scoped)
    const editHistory = this.getWorkingState().editHistory;
    if (editHistory.length > 0) {
      parts.push('\n## Recent Changes');
      const recentEdits = editHistory.slice(-5);
      for (const edit of recentEdits) {
        parts.push(`- ${edit.file}: ${edit.description}`);
      }
    }

    return parts.join('\n');
  }
}
