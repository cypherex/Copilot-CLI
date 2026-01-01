// Memory Store - persistent storage for structured information

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type {
  MemoryStore,
  MemoryLifespan,
  SessionGoal,
  UserFact,
  UserPreference,
  ProjectContext,
  FeatureGroup,
  Task,
  TaskStatus,
  WorkingState,
  ActiveFile,
  FileSection,
  ErrorContext,
  EditRecord,
  ArchiveEntry,
  Decision,
  RetrievalResult,
  DecayConfig,
} from './types.js';
import { DEFAULT_DECAY_CONFIG } from './types.js';

interface StoredData {
  version: number;
  goals: SessionGoal[]; // Now supports multiple goals with hierarchy
  userFacts: UserFact[];
  preferences: UserPreference[];
  decisions: Decision[];
  projectContext: ProjectContext[];
  featureGroups: FeatureGroup[];
  tasks: Task[];
  workingState: WorkingState;
  archive: ArchiveEntry[];
  retrievalHistory: RetrievalResult[];
  decayConfig?: DecayConfig;
  lastSession?: {
    endTime: Date;
    goalProgress?: string;
    activeTaskDescription?: string;
  };
}

const CURRENT_VERSION = 3;

export class LocalMemoryStore implements MemoryStore {
  private goals: Map<string, SessionGoal> = new Map();
  private rootGoalId?: string;
  private userFacts: Map<string, UserFact> = new Map();
  private preferences: Map<string, UserPreference> = new Map();
  private decisions: Map<string, Decision> = new Map();
  private projectContext: Map<string, ProjectContext> = new Map();
  private featureGroups: Map<string, FeatureGroup> = new Map();
  private tasks: Map<string, Task> = new Map();
  private workingState: WorkingState;
  private archiveEntries: ArchiveEntry[] = [];
  private retrievalHistory: RetrievalResult[] = [];
  private decayConfig: DecayConfig = { ...DEFAULT_DECAY_CONFIG };
  private storePath: string;
  private projectPath: string;
  private sessionId: string;
  private idCounter = 0;
  private lastSessionInfo?: StoredData['lastSession'];

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.sessionId = `session_${Date.now()}`;
    this.storePath = this.getStorePath(projectPath);

    this.workingState = {
      activeFiles: [],
      recentErrors: [],
      editHistory: [],
      lastUpdated: new Date(),
    };
  }

  private getStorePath(projectPath: string): string {
    const configDir = join(homedir(), '.copilot-cli', 'memory');
    const projectHash = this.hashPath(projectPath);
    const projectDir = join(configDir, projectHash);

    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    return join(projectDir, 'memory.json');
  }

  private hashPath(path: string): string {
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
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

  // User Facts
  getUserFacts(): UserFact[] {
    return Array.from(this.userFacts.values()).filter(f => !this.isExpired(f) && !f.supersededBy);
  }

  // Get all user facts including superseded (for history)
  getAllUserFacts(): UserFact[] {
    return Array.from(this.userFacts.values());
  }

  addUserFact(fact: Omit<UserFact, 'id' | 'timestamp'>): UserFact {
    const full: UserFact = {
      ...fact,
      id: this.generateId('fact'),
      timestamp: new Date(),
    };
    this.userFacts.set(full.id, full);
    return full;
  }

  reinforceUserFact(id: string): void {
    const fact = this.userFacts.get(id);
    if (fact) {
      fact.lastReinforced = new Date();
      fact.confidence = Math.min(1, fact.confidence + 0.1);
    }
  }

  supersedeUserFact(id: string, newFactId: string): void {
    const existing = this.userFacts.get(id);
    if (existing) {
      existing.supersededBy = newFactId;
      existing.supersededAt = new Date();
    }
  }

  getUserFactById(id: string): UserFact | undefined {
    return this.userFacts.get(id);
  }

  // Preferences
  getPreferences(): UserPreference[] {
    return Array.from(this.preferences.values())
      .filter(p => !p.supersededBy && !this.isExpired(p));
  }

  // Get all preferences including superseded (for history)
  getAllPreferences(): UserPreference[] {
    return Array.from(this.preferences.values());
  }

  addPreference(pref: Omit<UserPreference, 'id' | 'timestamp'>): UserPreference {
    const full: UserPreference = {
      ...pref,
      id: this.generateId('pref'),
      timestamp: new Date(),
    };
    this.preferences.set(full.id, full);
    return full;
  }

  updatePreference(id: string, updates: Partial<UserPreference>): void {
    const existing = this.preferences.get(id);
    if (existing) {
      this.preferences.set(id, { ...existing, ...updates });
    }
  }

  supersedePreference(id: string, newPrefId: string): void {
    const existing = this.preferences.get(id);
    if (existing) {
      existing.supersededBy = newPrefId;
      existing.supersededAt = new Date();
    }
  }

  getPreferenceByKey(category: string, key: string): UserPreference | undefined {
    for (const pref of this.preferences.values()) {
      if (pref.category === category && pref.key === key && !pref.supersededBy) {
        return pref;
      }
    }
    return undefined;
  }

  // Decisions (with supersession)
  getDecisions(): Decision[] {
    return Array.from(this.decisions.values()).filter(d => !d.supersededBy);
  }

  // Get all decisions including superseded (for history)
  getAllDecisions(): Decision[] {
    return Array.from(this.decisions.values());
  }

  addDecision(decision: Omit<Decision, 'id' | 'timestamp'>): Decision {
    const full: Decision = {
      ...decision,
      id: this.generateId('dec'),
      timestamp: new Date(),
    };
    this.decisions.set(full.id, full);
    return full;
  }

  supersedeDecision(id: string, newDecisionId: string): void {
    const existing = this.decisions.get(id);
    if (existing) {
      existing.supersededBy = newDecisionId;
      existing.supersededAt = new Date();
    }
  }

  getDecisionById(id: string): Decision | undefined {
    return this.decisions.get(id);
  }

  // Project context
  getProjectContext(): ProjectContext[] {
    return Array.from(this.projectContext.values());
  }

  addProjectContext(ctx: Omit<ProjectContext, 'id' | 'timestamp'>): ProjectContext {
    const full: ProjectContext = {
      ...ctx,
      id: this.generateId('ctx'),
      timestamp: new Date(),
    };
    this.projectContext.set(full.id, full);
    return full;
  }

  getProjectContextByType(type: ProjectContext['type']): ProjectContext[] {
    return Array.from(this.projectContext.values()).filter(c => c.type === type);
  }

  // Feature Groups
  getFeatureGroups(): FeatureGroup[] {
    return Array.from(this.featureGroups.values());
  }

  addFeatureGroup(group: Omit<FeatureGroup, 'id' | 'createdAt'>): FeatureGroup {
    const full: FeatureGroup = {
      ...group,
      id: this.generateId('feature'),
      createdAt: new Date(),
    };
    this.featureGroups.set(full.id, full);
    return full;
  }

  addFileToGroup(groupId: string, filePath: string): void {
    const group = this.featureGroups.get(groupId);
    if (group && !group.files.includes(filePath)) {
      group.files.push(filePath);
    }
  }

  getFeatureGroupForFile(filePath: string): FeatureGroup | undefined {
    for (const group of this.featureGroups.values()) {
      if (group.files.includes(filePath)) {
        return group;
      }
    }
    return undefined;
  }

  inferFeatureGroup(filePath: string): string | undefined {
    // Infer feature group from path
    const parts = filePath.split(/[/\\]/);
    const featureIndicators = ['auth', 'api', 'components', 'utils', 'hooks', 'services', 'models', 'types'];

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (featureIndicators.includes(lower)) {
        return lower;
      }
    }
    return undefined;
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
    const active = this.getTasks('active');
    if (active.length === 0) return undefined;
    return active.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
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

    // Infer feature group if not provided
    if (!entry.featureGroup) {
      entry.featureGroup = this.inferFeatureGroup(file.path);
    }

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

  // Decay configuration
  setDecayConfig(config: Partial<DecayConfig>): void {
    this.decayConfig = { ...this.decayConfig, ...config };
  }

  // Confidence Decay (configurable)
  applyConfidenceDecay(config?: Partial<DecayConfig>): void {
    const cfg = config ? { ...this.decayConfig, ...config } : this.decayConfig;
    const now = Date.now();

    // Decay preferences
    for (const pref of this.preferences.values()) {
      if (pref.supersededBy) continue;

      // Skip stable categories
      if (pref.lifespan === 'permanent' && cfg.stableCategories?.includes('permanent')) continue;
      if (pref.lifespan === 'project' && cfg.stableCategories?.includes('project')) continue;

      const lastActive = pref.lastReinforced || pref.timestamp;
      const hoursOld = (now - new Date(lastActive).getTime()) / (1000 * 60 * 60);
      const decay = Math.min(hoursOld * cfg.preferenceDecayRate, pref.confidence - cfg.minConfidence);

      if (decay > 0) {
        pref.confidence = Math.max(cfg.minConfidence, pref.confidence - decay);
      }
    }

    // Decay user facts (slower rate for personal facts)
    for (const fact of this.userFacts.values()) {
      // Skip stable categories
      if (fact.category === 'personal' && cfg.stableCategories?.includes('personal')) continue;
      if (fact.lifespan === 'permanent' && cfg.stableCategories?.includes('permanent')) continue;

      const lastActive = fact.lastReinforced || fact.timestamp;
      const hoursOld = (now - new Date(lastActive).getTime()) / (1000 * 60 * 60);

      // Use appropriate decay rate based on category
      const decayRate = fact.category === 'context' ? cfg.exploratoryDecayRate : cfg.userFactDecayRate;
      const decay = Math.min(hoursOld * decayRate, fact.confidence - cfg.minConfidence);

      if (decay > 0) {
        fact.confidence = Math.max(cfg.minConfidence, fact.confidence - decay);
      }
    }
  }

  private isExpired(item: { confidence: number; lifespan: MemoryLifespan }): boolean {
    // Session items expire at very low confidence
    if (item.lifespan === 'session' && item.confidence < 0.2) {
      return true;
    }
    return false;
  }

  // Session Resumption
  buildResumptionContext(): string {
    const parts: string[] = [];

    // Last session info
    if (this.lastSessionInfo) {
      parts.push('## Previous Session');
      if (this.lastSessionInfo.goalProgress) {
        parts.push(`Progress: ${this.lastSessionInfo.goalProgress}`);
      }
      if (this.lastSessionInfo.activeTaskDescription) {
        parts.push(`Was working on: ${this.lastSessionInfo.activeTaskDescription}`);
      }
    }

    // Current goal (with hierarchy)
    const rootGoal = this.getGoal();
    if (rootGoal && rootGoal.status === 'active') {
      parts.push('\n## Current Goal');
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

    // Incomplete tasks
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

    // Unresolved errors from last session
    const unresolvedErrors = this.workingState.recentErrors.filter(e => !e.resolved);
    if (unresolvedErrors.length > 0) {
      parts.push('\n## Unresolved Issues');
      for (const error of unresolvedErrors.slice(-3)) {
        parts.push(`- ${error.error.slice(0, 150)}`);
      }
    }

    // Recent edit summary
    if (this.workingState.editHistory.length > 0) {
      parts.push('\n## Recent Changes');
      const recentEdits = this.workingState.editHistory.slice(-5);
      for (const edit of recentEdits) {
        parts.push(`- ${edit.file}: ${edit.description}`);
      }
    }

    return parts.join('\n');
  }

  // Estimate tokens for a string (rough: ~4 chars per token)
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Build full context summary for injection with optional budget
  buildContextSummary(tokenBudget?: number): string {
    const budget = tokenBudget || Infinity;
    let usedTokens = 0;

    // Priority-ordered sections to include
    const sections: { priority: number; content: string }[] = [];

    // Priority 1: Goal (always first, critical)
    const rootGoal = this.getGoal();
    if (rootGoal && rootGoal.status === 'active') {
      let goalSection = '## Mission\n' + rootGoal.description;
      if (rootGoal.progress) {
        goalSection += `\nCurrent progress: ${rootGoal.progress}`;
      }
      const subGoals = this.getAllGoals().filter(g =>
        g.parentGoalId && g.status === 'active'
      );
      if (subGoals.length > 0) {
        for (const sub of subGoals.slice(0, 3)) {
          const indent = '  '.repeat(sub.depth || 1);
          goalSection += `\n${indent}→ ${sub.description}`;
        }
      }
      sections.push({ priority: 1, content: goalSection });
    }

    // Priority 2: Active task
    const activeTask = this.getActiveTask();
    if (activeTask) {
      let taskSection = '\n## Current Task\n' + activeTask.description;
      if (activeTask.blockedBy) {
        taskSection += `\nBlocked by: ${activeTask.blockedBy}`;
      }
      sections.push({ priority: 2, content: taskSection });
    }

    // Priority 3: Unresolved errors (critical for debugging)
    const unresolvedErrors = this.workingState.recentErrors.filter(e => !e.resolved);
    if (unresolvedErrors.length > 0) {
      let errorSection = '\n## Unresolved Errors';
      for (const error of unresolvedErrors.slice(-3)) {
        errorSection += `\n- ${error.error.slice(0, 200)}`;
      }
      sections.push({ priority: 3, content: errorSection });
    }

    // Priority 4: User facts (high confidence)
    const facts = this.getUserFacts().filter(f => f.confidence >= 0.6);
    if (facts.length > 0) {
      let factSection = '\n## User Context';
      for (const fact of facts.slice(0, 5)) {
        factSection += `\n- ${fact.fact}`;
      }
      sections.push({ priority: 4, content: factSection });
    }

    // Priority 5: User preferences (high confidence)
    const prefs = this.getPreferences().filter(p => p.confidence >= 0.6);
    if (prefs.length > 0) {
      let prefSection = '\n## User Preferences';
      for (const pref of prefs.slice(0, 10)) {
        prefSection += `\n- ${pref.category}/${pref.key}: ${pref.value}`;
      }
      sections.push({ priority: 5, content: prefSection });
    }

    // Priority 6: Active files with sections
    const activeFiles = this.workingState.activeFiles.filter(f =>
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
      sections.push({ priority: 6, content: fileSection });
    }

    // Priority 7: Pending tasks
    const pendingTasks = this.getTasks('blocked').concat(this.getTasks('waiting'));
    if (pendingTasks.length > 0) {
      let pendingSection = '\n## Pending Tasks';
      for (const task of pendingTasks.slice(0, 5)) {
        const status = task.blockedBy ? `blocked: ${task.blockedBy}` :
                       task.waitingFor ? `waiting: ${task.waitingFor}` : task.status;
        pendingSection += `\n- ${task.description} (${status})`;
      }
      sections.push({ priority: 7, content: pendingSection });
    }

    // Priority 8: Project context
    const ctx = this.getProjectContext();
    if (ctx.length > 0) {
      let ctxSection = '\n## Project Context';
      for (const c of ctx.slice(0, 10)) {
        ctxSection += `\n- ${c.type}: ${c.key} = ${c.value}`;
      }
      sections.push({ priority: 8, content: ctxSection });
    }

    // Priority 9: Feature groups (lowest priority)
    const groups = this.getFeatureGroups();
    if (groups.length > 0) {
      let groupSection = '\n## Feature Areas';
      for (const group of groups.slice(0, 5)) {
        groupSection += `\n- ${group.name}: ${group.files.slice(0, 3).join(', ')}${group.files.length > 3 ? '...' : ''}`;
      }
      sections.push({ priority: 9, content: groupSection });
    }

    // Sort by priority and build output within budget
    sections.sort((a, b) => a.priority - b.priority);
    const parts: string[] = [];

    for (const section of sections) {
      const sectionTokens = this.estimateTokens(section.content);
      if (usedTokens + sectionTokens <= budget) {
        parts.push(section.content);
        usedTokens += sectionTokens;
      } else if (budget !== Infinity) {
        // Budget exceeded, stop adding
        break;
      }
    }

    return parts.join('\n');
  }

  // Persistence
  async save(): Promise<void> {
    const rootGoal = this.getGoal();
    const data: StoredData = {
      version: CURRENT_VERSION,
      goals: Array.from(this.goals.values()),
      userFacts: Array.from(this.userFacts.values()),
      preferences: Array.from(this.preferences.values()),
      decisions: Array.from(this.decisions.values()),
      projectContext: Array.from(this.projectContext.values()),
      featureGroups: Array.from(this.featureGroups.values()),
      tasks: Array.from(this.tasks.values()),
      workingState: this.workingState,
      archive: this.archiveEntries,
      retrievalHistory: this.retrievalHistory,
      decayConfig: this.decayConfig,
      lastSession: {
        endTime: new Date(),
        goalProgress: rootGoal?.progress,
        activeTaskDescription: this.getActiveTask()?.description,
      },
    };

    writeFileSync(this.storePath, JSON.stringify(data, null, 2));
  }

  async load(): Promise<void> {
    if (!existsSync(this.storePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.storePath, 'utf-8');
      const data: StoredData = JSON.parse(raw);

      if (data.version !== CURRENT_VERSION) {
        console.warn(`Memory store version mismatch: ${data.version} vs ${CURRENT_VERSION}`);
        // Migration: handle old single-goal format
        if (data.version === 2 && (data as any).goal) {
          const oldGoal = (data as any).goal;
          if (oldGoal.status === 'active') {
            oldGoal.established = new Date(oldGoal.established);
            oldGoal.depth = 0;
            this.goals.set(oldGoal.id, oldGoal);
            this.rootGoalId = oldGoal.id;
          }
        }
      }

      // Store last session info for resumption context
      this.lastSessionInfo = data.lastSession;

      // Restore decay config
      if (data.decayConfig) {
        this.decayConfig = { ...DEFAULT_DECAY_CONFIG, ...data.decayConfig };
      }

      // Restore goals (with hierarchy)
      for (const goal of data.goals || []) {
        if (goal.status === 'active') {
          goal.established = new Date(goal.established);
          this.goals.set(goal.id, goal);
          if (!goal.parentGoalId) {
            this.rootGoalId = goal.id;
          }
        }
      }

      // Restore user facts
      for (const fact of data.userFacts || []) {
        if (fact.lifespan !== 'session') {
          fact.timestamp = new Date(fact.timestamp);
          if (fact.lastReinforced) fact.lastReinforced = new Date(fact.lastReinforced);
          if (fact.supersededAt) fact.supersededAt = new Date(fact.supersededAt);
          this.userFacts.set(fact.id, fact);
        }
      }

      // Restore preferences
      for (const pref of data.preferences || []) {
        if (pref.lifespan !== 'session') {
          pref.timestamp = new Date(pref.timestamp);
          if (pref.lastReinforced) pref.lastReinforced = new Date(pref.lastReinforced);
          if (pref.supersededAt) pref.supersededAt = new Date(pref.supersededAt);
          this.preferences.set(pref.id, pref);
        }
      }

      // Restore decisions
      for (const dec of data.decisions || []) {
        dec.timestamp = new Date(dec.timestamp);
        if (dec.supersededAt) dec.supersededAt = new Date(dec.supersededAt);
        this.decisions.set(dec.id, dec);
      }

      // Restore project context
      for (const ctx of data.projectContext || []) {
        if (ctx.lifespan !== 'session') {
          ctx.timestamp = new Date(ctx.timestamp);
          this.projectContext.set(ctx.id, ctx);
        }
      }

      // Restore feature groups
      for (const group of data.featureGroups || []) {
        group.createdAt = new Date(group.createdAt);
        this.featureGroups.set(group.id, group);
      }

      // Restore non-completed tasks
      for (const task of data.tasks || []) {
        if (task.status !== 'completed' && task.status !== 'abandoned') {
          task.createdAt = new Date(task.createdAt);
          task.updatedAt = new Date(task.updatedAt);
          this.tasks.set(task.id, task);
        }
      }

      // Restore archive
      this.archiveEntries = (data.archive || []).map(entry => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
      }));

      // Restore retrieval history
      this.retrievalHistory = (data.retrievalHistory || []).map(r => ({
        ...r,
        retrievedAt: new Date(r.retrievedAt),
      }));

      // Restore some working state (resolved errors as knowledge)
      if (data.workingState) {
        this.workingState.recentErrors = (data.workingState.recentErrors || [])
          .filter(e => e.resolved)
          .slice(-10)
          .map(e => ({
            ...e,
            timestamp: new Date(e.timestamp),
          }));

        // Restore edit history
        this.workingState.editHistory = (data.workingState.editHistory || [])
          .slice(-20)
          .map(e => ({
            ...e,
            timestamp: new Date(e.timestamp),
          }));
      }

      // Apply confidence decay for time passed
      this.applyConfidenceDecay();

    } catch (error) {
      console.error('Failed to load memory store:', error);
    }
  }

  clear(lifespan?: MemoryLifespan): void {
    if (!lifespan) {
      this.goals.clear();
      this.rootGoalId = undefined;
      this.userFacts.clear();
      this.preferences.clear();
      this.decisions.clear();
      this.projectContext.clear();
      this.featureGroups.clear();
      this.tasks.clear();
      this.archiveEntries = [];
      this.retrievalHistory = [];
      this.workingState = {
        activeFiles: [],
        recentErrors: [],
        editHistory: [],
        lastUpdated: new Date(),
      };
    } else {
      // Clear only matching lifespan
      for (const [id, fact] of this.userFacts) {
        if (fact.lifespan === lifespan) {
          this.userFacts.delete(id);
        }
      }
      for (const [id, pref] of this.preferences) {
        if (pref.lifespan === lifespan) {
          this.preferences.delete(id);
        }
      }
      for (const [id, ctx] of this.projectContext) {
        if (ctx.lifespan === lifespan) {
          this.projectContext.delete(id);
        }
      }
      if (lifespan === 'session') {
        this.goals.clear();
        this.rootGoalId = undefined;
        this.retrievalHistory = [];
        this.workingState = {
          activeFiles: [],
          recentErrors: [],
          editHistory: [],
          lastUpdated: new Date(),
        };
      }
    }
  }
}
