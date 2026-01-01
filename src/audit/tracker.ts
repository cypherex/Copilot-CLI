// Scaffolding Tracker - audits LLM responses for incomplete work

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ChatMessage, LLMClient } from '../llm/types.js';
import type {
  IncompleteItem,
  IncompleteItemType,
  AuditResult,
  CompletionTrackerConfig,
  TrackerState,
  ScaffoldingDebt,
} from './types.js';
import { DEFAULT_TRACKER_CONFIG, ITEM_PRIORITY } from './types.js';

const CURRENT_VERSION = 1;

const AUDIT_SYSTEM_PROMPT = `You are a code completeness auditor. Your job is to identify incomplete scaffolding in code changes.

Analyze the assistant's response for:
1. **unwired_extraction**: Extractors/parsers that extract data but don't store/use it
2. **unconnected_method**: Methods defined but never called anywhere
3. **missing_call**: Expected call sites that are missing (e.g., save() never called)
4. **stub**: Placeholder implementations (throw NotImplemented, empty bodies, "TODO" in code)
5. **simplified**: Logic that works but is explicitly noted as needing enhancement later
6. **todo**: Explicit TODO/FIXME comments added
7. **missing_implementation**: Interfaces/types without concrete implementation
8. **dead_code**: Code that can never be reached
9. **obsolete_code**: Old code made redundant by new implementation (e.g., old function replaced by new one, old file superseded by new module) - flag these for cleanup while context is fresh

Also check if any previously incomplete items (provided as "pending") are now resolved.

Return ONLY valid JSON in this exact format:
{
  "new": [
    {"type": "unwired_extraction", "description": "extractFoo() parses data but nothing calls storeFoo()", "file": "parser.ts", "line": 42}
  ],
  "resolved": ["item_id_1", "item_id_2"]
}

Rules:
- Only report genuine incompleteness, not stylistic issues
- Be specific about what's missing and where
- A method is "connected" if it's exported and reasonably expected to be called externally
- Don't flag test files or intentional abstractions
- IMPORTANT: When new code replaces/supersedes old code, flag the old code as obsolete_code - this is high priority because cleanup is easiest while context is fresh
- If nothing is incomplete, return {"new": [], "resolved": []}`;

export class CompletionTracker {
  private config: CompletionTrackerConfig;
  private state: TrackerState;
  private storePath: string;
  private llmClient?: LLMClient;
  private auditClient?: LLMClient;
  private sessionResolvedIds: Set<string> = new Set();
  private idCounter = 0;

  constructor(projectPath: string, config: Partial<CompletionTrackerConfig> = {}) {
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
    this.storePath = this.getStorePath(projectPath);
    this.state = this.createEmptyState();
  }

  private getStorePath(projectPath: string): string {
    const configDir = join(homedir(), '.copilot-cli', 'memory');
    const projectHash = this.hashPath(projectPath);
    const projectDir = join(configDir, projectHash);

    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    return join(projectDir, 'scaffolding.json');
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

  private createEmptyState(): TrackerState {
    return {
      version: CURRENT_VERSION,
      items: [],
      responseCount: 0,
      sessionStats: {
        totalIntroduced: 0,
        totalResolved: 0,
        avgResolutionResponses: 0,
      },
    };
  }

  private generateId(): string {
    return `scaffold_${++this.idCounter}_${Date.now().toString(36)}`;
  }

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  setAuditClient(client: LLMClient): void {
    this.auditClient = client;
  }

  private getAuditClient(): LLMClient | undefined {
    return this.auditClient || this.llmClient;
  }

  // Main audit entry point - call after each assistant response
  async auditResponse(
    response: string,
    recentMessages: ChatMessage[],
    responseId: string
  ): Promise<{ newItems: IncompleteItem[]; resolvedItems: IncompleteItem[] }> {
    if (!this.config.enabled) {
      return { newItems: [], resolvedItems: [] };
    }

    const client = this.getAuditClient();
    if (!client) {
      return { newItems: [], resolvedItems: [] };
    }

    this.state.responseCount++;

    // Increment responsesSinceIntroduced for all pending items
    for (const item of this.state.items) {
      if (!item.resolved) {
        item.responsesSinceIntroduced++;
      }
    }

    try {
      const auditResult = await this.callAuditLLM(response, recentMessages, client);
      const newItems = this.processNewItems(auditResult.new, responseId);
      const resolvedItems = this.processResolved(auditResult.resolved, responseId);

      this.state.lastAuditAt = new Date();
      await this.save();

      return { newItems, resolvedItems };
    } catch (error) {
      console.error('[Scaffold Audit] Failed:', error);
      return { newItems: [], resolvedItems: [] };
    }
  }

  private async callAuditLLM(
    response: string,
    recentMessages: ChatMessage[],
    client: LLMClient
  ): Promise<AuditResult> {
    // Build minimal context for audit
    const pendingItems = this.getIncomplete();
    const pendingContext = pendingItems.length > 0
      ? `\n\nPending incomplete items to check for resolution:\n${
          pendingItems.map(i => `- ${i.id}: ${i.type} in ${i.file}: ${i.description}`).join('\n')
        }`
      : '';

    // Only include last few messages for context
    const contextMessages = recentMessages.slice(-5).map(m =>
      `${m.role}: ${m.content.slice(0, 500)}${m.content.length > 500 ? '...' : ''}`
    ).join('\n\n');

    const userPrompt = `## Recent conversation context:
${contextMessages}

## Assistant response to audit:
${response}
${pendingContext}

Analyze for incomplete scaffolding and return JSON:`;

    const auditResponse = await client.chat([
      { role: 'system', content: AUDIT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    const content = auditResponse.choices[0]?.message.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as AuditResult;
        return {
          new: Array.isArray(parsed.new) ? parsed.new : [],
          resolved: Array.isArray(parsed.resolved) ? parsed.resolved : [],
        };
      } catch {
        return { new: [], resolved: [] };
      }
    }

    return { new: [], resolved: [] };
  }

  private processNewItems(
    newItems: AuditResult['new'],
    responseId: string
  ): IncompleteItem[] {
    const added: IncompleteItem[] = [];

    for (const item of newItems) {
      // Validate type
      if (!ITEM_PRIORITY[item.type]) continue;

      const priority = ITEM_PRIORITY[item.type];
      if (priority < this.config.minPriority) continue;

      // Check for duplicates
      const isDuplicate = this.state.items.some(existing =>
        !existing.resolved &&
        existing.file === item.file &&
        existing.type === item.type &&
        existing.description.toLowerCase().includes(item.description.toLowerCase().slice(0, 50))
      );
      if (isDuplicate) continue;

      const newItem: IncompleteItem = {
        id: this.generateId(),
        type: item.type,
        description: item.description,
        file: item.file,
        line: item.line,
        introducedAt: new Date(),
        introducedByResponseId: responseId,
        responsesSinceIntroduced: 0,
        resolved: false,
        priority,
      };

      this.state.items.push(newItem);
      this.state.sessionStats.totalIntroduced++;
      added.push(newItem);
    }

    return added;
  }

  private processResolved(
    resolvedIds: string[],
    responseId: string
  ): IncompleteItem[] {
    const resolved: IncompleteItem[] = [];

    for (const id of resolvedIds) {
      const item = this.state.items.find(i => i.id === id && !i.resolved);
      if (item) {
        item.resolved = true;
        item.resolvedAt = new Date();
        item.resolvedByResponseId = responseId;

        this.sessionResolvedIds.add(id);
        this.state.sessionStats.totalResolved++;

        // Update average resolution time
        const total = this.state.sessionStats.totalResolved;
        const currentAvg = this.state.sessionStats.avgResolutionResponses;
        this.state.sessionStats.avgResolutionResponses =
          (currentAvg * (total - 1) + item.responsesSinceIntroduced) / total;

        resolved.push(item);
      }
    }

    return resolved;
  }

  // Get all incomplete items
  getIncomplete(): IncompleteItem[] {
    return this.state.items
      .filter(i => !i.resolved)
      .sort((a, b) => b.priority - a.priority);
  }

  // Get stale items (past threshold)
  getStale(): IncompleteItem[] {
    return this.getIncomplete().filter(
      i => i.responsesSinceIntroduced >= this.config.staleThreshold
    );
  }

  // Get critical items (high priority)
  getCritical(): IncompleteItem[] {
    return this.getIncomplete().filter(i => i.priority >= 4);
  }

  // Build reminder for stale items (for context injection)
  buildReminder(): string | null {
    const stale = this.getStale();
    if (stale.length === 0) return null;

    const lines = ['## Incomplete Scaffolding Reminder', ''];
    lines.push('The following items were introduced but never completed:');
    lines.push('');

    for (const item of stale.slice(0, 5)) {
      const age = item.responsesSinceIntroduced;
      lines.push(`- **${item.type}** in \`${item.file}\`: ${item.description} (${age} responses ago)`);
    }

    if (stale.length > 5) {
      lines.push(`- ... and ${stale.length - 5} more`);
    }

    lines.push('');
    lines.push('Please complete these before adding new features.');

    return lines.join('\n');
  }

  // Build context injection for very stale items
  buildContextInjection(): string | null {
    if (this.config.strictnessMode === 'off') return null;

    const stale = this.state.items.filter(
      i => !i.resolved && i.responsesSinceIntroduced >= this.config.reminderThreshold
    );

    if (stale.length === 0) return null;

    return this.buildReminder();
  }

  // Check if should block new features
  shouldBlock(): boolean {
    if (this.config.strictnessMode !== 'block') return false;
    return this.getCritical().length >= this.config.blockThreshold;
  }

  // Get debt summary for CLI display
  getDebt(): ScaffoldingDebt {
    const incomplete = this.getIncomplete();
    const critical = incomplete.filter(i => i.priority >= 4);
    const stale = incomplete.filter(i => i.responsesSinceIntroduced >= this.config.staleThreshold);
    const recent = incomplete.filter(i => i.responsesSinceIntroduced < this.config.staleThreshold);

    // Get recently resolved (this session)
    const resolved = this.state.items.filter(i =>
      i.resolved && this.sessionResolvedIds.has(i.id)
    );

    return {
      critical,
      stale,
      recent,
      resolved,
      totalDebt: incomplete.reduce((sum, i) => sum + i.priority, 0),
      shouldBlock: this.shouldBlock(),
    };
  }

  // Get formatted display for CLI
  formatDebtDisplay(): string {
    const debt = this.getDebt();
    const lines: string[] = [];

    if (debt.resolved.length > 0) {
      lines.push('\x1b[32m✓ Resolved:\x1b[0m');
      for (const item of debt.resolved.slice(-3)) {
        lines.push(`  \x1b[32m✓\x1b[0m ${item.type}: ${item.description.slice(0, 60)}`);
      }
    }

    if (debt.critical.length > 0) {
      lines.push('\x1b[31m⚠ Critical incomplete:\x1b[0m');
      for (const item of debt.critical.slice(0, 3)) {
        lines.push(`  \x1b[31m●\x1b[0m ${item.file}: ${item.description.slice(0, 60)}`);
      }
    }

    if (debt.stale.length > 0) {
      lines.push('\x1b[33m● Stale items:\x1b[0m');
      for (const item of debt.stale.filter(i => i.priority < 4).slice(0, 3)) {
        lines.push(`  \x1b[33m●\x1b[0m ${item.file}: ${item.description.slice(0, 50)} (${item.responsesSinceIntroduced} ago)`);
      }
    }

    if (debt.recent.length > 0 && this.config.strictnessMode !== 'off') {
      lines.push(`\x1b[90m○ ${debt.recent.length} new item(s) tracking\x1b[0m`);
    }

    if (debt.shouldBlock) {
      lines.push('');
      lines.push('\x1b[31m⛔ Too much scaffolding debt - complete existing items before adding features\x1b[0m');
    }

    return lines.join('\n');
  }

  // Persistence
  async save(): Promise<void> {
    writeFileSync(this.storePath, JSON.stringify(this.state, null, 2));
  }

  async load(): Promise<void> {
    if (!existsSync(this.storePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.storePath, 'utf-8');
      const data = JSON.parse(raw) as TrackerState;

      if (data.version !== CURRENT_VERSION) {
        console.warn('[Scaffold] Version mismatch, resetting tracker');
        return;
      }

      this.state = {
        ...data,
        items: data.items.map(item => ({
          ...item,
          introducedAt: new Date(item.introducedAt),
          resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : undefined,
        })),
        lastAuditAt: data.lastAuditAt ? new Date(data.lastAuditAt) : undefined,
      };

      // Find max ID for counter
      for (const item of this.state.items) {
        const match = item.id.match(/scaffold_(\d+)_/);
        if (match) {
          this.idCounter = Math.max(this.idCounter, parseInt(match[1], 10));
        }
      }
    } catch (error) {
      console.error('[Scaffold] Failed to load:', error);
    }
  }

  reset(): void {
    this.state = this.createEmptyState();
    this.sessionResolvedIds.clear();
  }

  getConfig(): CompletionTrackerConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<CompletionTrackerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
