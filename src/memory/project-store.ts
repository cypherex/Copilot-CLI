// Project Memory Store - persistent project-scoped data
// Contains: user facts, user preferences, decisions, project context, feature groups
// This data persists between sessions and is saved to disk

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type {
  UserFact,
  UserPreference,
  ProjectContext,
  FeatureGroup,
  Decision,
  MemoryLifespan,
  DecayConfig,
} from './types.js';
import { DEFAULT_DECAY_CONFIG } from './types.js';

interface StoredData {
  version: number;
  userFacts: UserFact[];
  preferences: UserPreference[];
  decisions: Decision[];
  projectContext: ProjectContext[];
  featureGroups: FeatureGroup[];
  decayConfig?: DecayConfig;
}

const CURRENT_VERSION = 1;

export class ProjectMemoryStore {
  private userFacts: Map<string, UserFact> = new Map();
  private preferences: Map<string, UserPreference> = new Map();
  private decisions: Map<string, Decision> = new Map();
  private projectContext: Map<string, ProjectContext> = new Map();
  private featureGroups: Map<string, FeatureGroup> = new Map();
  private decayConfig: DecayConfig = { ...DEFAULT_DECAY_CONFIG };
  private storePath: string;
  private projectPath: string;
  private idCounter = 0;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.storePath = this.getStorePath(projectPath);
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

  // User Facts
  getUserFacts(): UserFact[] {
    return Array.from(this.userFacts.values()).filter(f => !this.isExpired(f) && !f.supersededBy);
  }

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

  // Clear project data
  clear(lifespan?: MemoryLifespan): void {
    if (!lifespan) {
      this.userFacts.clear();
      this.preferences.clear();
      this.decisions.clear();
      this.projectContext.clear();
      this.featureGroups.clear();
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
    }
  }

  // Persistence
  async save(): Promise<void> {
    try {
      const data: StoredData = {
        version: CURRENT_VERSION,
        userFacts: Array.from(this.userFacts.values()),
        preferences: Array.from(this.preferences.values()),
        decisions: Array.from(this.decisions.values()),
        projectContext: Array.from(this.projectContext.values()),
        featureGroups: Array.from(this.featureGroups.values()),
        decayConfig: this.decayConfig,
      };

      writeFileSync(this.storePath, JSON.stringify(data, null, 2));
    } catch (error: any) {
      // Log error but don't throw - allow app to continue with degraded functionality
      const errorMsg = error.code === 'ENOSPC'
        ? 'Cannot save project memory: Disk full'
        : error.code === 'EACCES'
        ? `Cannot save project memory: Permission denied for ${this.storePath}`
        : `Failed to save project memory: ${error.message}`;

      console.error(`[Project Memory] ${errorMsg}`, error);
      // Don't throw - graceful degradation is better than crashing
    }
  }

  async load(): Promise<void> {
    if (!existsSync(this.storePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.storePath, 'utf-8');
      const data: StoredData = JSON.parse(raw);

      // Restore decay config
      if (data.decayConfig) {
        this.decayConfig = { ...DEFAULT_DECAY_CONFIG, ...data.decayConfig };
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

      // Apply confidence decay for time passed
      this.applyConfidenceDecay();

    } catch (error) {
      console.error('Failed to load project memory store:', error);
    }
  }
}
