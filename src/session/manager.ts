// Session manager - handles session persistence

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { formatDistanceToNow } from 'date-fns';
import type { Session, SessionMetadata } from './types.js';
import type { ChatMessage } from '../llm/types.js';
import type { MemoryStore } from '../memory/types.js';

export class SessionManager {
  private sessionsDir: string;
  private currentSession: Session | null = null;

  constructor() {
    this.sessionsDir = path.join(os.homedir(), '.copilot-cli', 'sessions');
  }

  /**
   * Initialize the sessions directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.access(this.sessionsDir);
    } catch {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Create a new session
   */
  async createSession(
    workingDirectory: string,
    provider: string,
    model?: string,
    firstMessage?: ChatMessage
  ): Promise<Session> {
    const sessionId = uuidv4();
    const title = this.generateTitle(firstMessage);

    const session: Session = {
      id: sessionId,
      title,
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
      workingDirectory,
      provider,
      model,
      messages: firstMessage ? [firstMessage] : [],
    };

    this.currentSession = session;
    await this.saveSession(session);
    return session;
  }

  /**
   * Save the current session
   */
  async saveSession(session: Session): Promise<void> {
    await this.initialize();
    const sessionPath = path.join(this.sessionsDir, `${session.id}.json`);
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Save current session with memory data
   */
  async saveCurrentSession(memoryStore?: MemoryStore, scaffoldingDebt?: any): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    if (memoryStore) {
      this.currentSession.memoryData = this.extractMemoryData(memoryStore);
    }

    if (scaffoldingDebt) {
      this.currentSession.scaffoldingDebt = scaffoldingDebt;
    }

    this.currentSession.lastUpdatedAt = new Date();
    await this.saveSession(this.currentSession);
  }

  /**
   * Load a session by ID
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    await this.initialize();
    const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);

    try {
      const data = await fs.readFile(sessionPath, 'utf-8');
      const session: Session = JSON.parse(data);

      // Convert date strings back to Date objects
      session.createdAt = new Date(session.createdAt);
      session.lastUpdatedAt = new Date(session.lastUpdatedAt);

      if (session.scaffoldingDebt?.items) {
        session.scaffoldingDebt.items = session.scaffoldingDebt.items.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        }));
      }

      this.currentSession = session;
      return session;
    } catch {
      return null;
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionMetadata[]> {
    await this.initialize();
    const sessions: SessionMetadata[] = [];

    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of sessionFiles) {
        const sessionPath = path.join(this.sessionsDir, file);
        try {
          const data = await fs.readFile(sessionPath, 'utf-8');
          const session: Session = JSON.parse(data);

          sessions.push({
            id: session.id,
            title: session.title,
            createdAt: new Date(session.createdAt),
            lastUpdatedAt: new Date(session.lastUpdatedAt),
            workingDirectory: session.workingDirectory,
            provider: session.provider,
            model: session.model,
            messageCount: session.messages.length,
          });
        } catch {
          // Skip invalid session files
          continue;
        }
      }
    } catch {
      // Directory doesn't exist or is empty
    }

    // Sort by last updated time (newest first)
    sessions.sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());

    return sessions;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    await this.initialize();
    const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);

    try {
      await fs.unlink(sessionPath);

      // Clear current session if it's the one we just deleted
      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all sessions
   */
  async clearAllSessions(): Promise<number> {
    await this.initialize();

    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of sessionFiles) {
        const sessionPath = path.join(this.sessionsDir, file);
        await fs.unlink(sessionPath).catch(() => {
          // Skip files that can't be deleted
        });
      }

      this.currentSession = null;
      return sessionFiles.length;
    } catch {
      return 0;
    }
  }

  /**
   * Export a session as markdown
   */
  async exportSession(sessionId: string): Promise<string | null> {
    await this.initialize();
    const session = await this.loadSession(sessionId);

    if (!session) {
      return null;
    }

    const lines: string[] = [];
    lines.push(`# Session: ${session.title}`);
    lines.push('');
    lines.push(`**ID:** ${session.id}`);
    lines.push(`**Created:** ${session.createdAt.toISOString()}`);
    lines.push(`**Last Updated:** ${session.lastUpdatedAt.toISOString()}`);
    lines.push(`**Working Directory:** ${session.workingDirectory}`);
    lines.push(`**Provider:** ${session.provider}${session.model ? ` (${session.model})` : ''}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Export memory data if available
    if (session.memoryData) {
      if (session.memoryData.goal) {
        lines.push('## Goal');
        lines.push('');
        lines.push(`**Status:** ${session.memoryData.goal.status}`);
        lines.push(`**Description:** ${session.memoryData.goal.description}`);
        if (session.memoryData.goal.completionCriteria) {
          lines.push(`**Completion Criteria:**`);
          for (const criterion of session.memoryData.goal.completionCriteria) {
            lines.push(`  - ${criterion}`);
          }
        }
        lines.push('');
      }

      if (session.memoryData.tasks && session.memoryData.tasks.length > 0) {
        lines.push('## Tasks');
        lines.push('');
        for (const task of session.memoryData.tasks) {
          lines.push(`- [${task.status}] ${task.description} (${task.priority})`);
        }
        lines.push('');
      }

      if (session.memoryData.decisions && session.memoryData.decisions.length > 0) {
        lines.push('## Decisions');
        lines.push('');
        for (const decision of session.memoryData.decisions) {
          lines.push(`- **${decision.description}** ${decision.category ? `(${decision.category})` : ''}`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    // Export messages
    lines.push('## Conversation');
    lines.push('');

    for (const message of session.messages) {
      const role = message.role === 'user' ? '👤 User' : message.role === 'assistant' ? '🤖 Assistant' : '🔧 Tool';
      lines.push(`### ${role}`);
      lines.push('');

      if (message.toolCalls) {
        lines.push('**Tool Calls:**');
        for (const toolCall of message.toolCalls) {
          lines.push(`- \`${toolCall.function.name}\``);
        }
        lines.push('');
      }

      lines.push(message.content);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get the current session
   */
  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Set the current session
   */
  setCurrentSession(session: Session): void {
    this.currentSession = session;
  }

  /**
   * Add a message to the current session
   */
  async addMessage(message: ChatMessage, memoryStore?: MemoryStore, scaffoldingDebt?: any): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.messages.push(message);
    this.currentSession.lastUpdatedAt = new Date();

    if (memoryStore) {
      this.currentSession.memoryData = this.extractMemoryData(memoryStore);
    }

    if (scaffoldingDebt) {
      this.currentSession.scaffoldingDebt = scaffoldingDebt;
    }

    await this.saveSession(this.currentSession);
  }

  /**
   * Generate a title from the first user message
   */
  private generateTitle(firstMessage?: ChatMessage): string {
    if (!firstMessage || firstMessage.role !== 'user') {
      return 'Untitled Session';
    }

    const content = firstMessage.content.trim();
    const maxLength = 50;

    if (content.length <= maxLength) {
      return content;
    }

    // Try to break at a word boundary
    const truncated = content.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength / 2) {
      return truncated.slice(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Extract memory data for serialization
   */
  private extractMemoryData(memoryStore: MemoryStore): any {
    return {
      goal: memoryStore.getGoal()
        ? {
            id: memoryStore.getGoal()!.id,
            description: memoryStore.getGoal()!.description,
            originalMessage: memoryStore.getGoal()!.originalMessage,
            status: memoryStore.getGoal()!.status,
            completionCriteria: memoryStore.getGoal()!.completionCriteria,
            progress: memoryStore.getGoal()!.progress,
          }
        : undefined,
      preferences: memoryStore.getPreferences().map((p) => ({
        category: p.category,
        key: p.key,
        value: p.value,
        confidence: p.confidence,
      })),
      tasks: memoryStore.getActiveTask()
        ? [
            {
              id: memoryStore.getActiveTask()!.id,
              description: memoryStore.getActiveTask()!.description,
              status: memoryStore.getActiveTask()!.status,
              priority: memoryStore.getActiveTask()!.priority,
            },
          ]
        : [],
      decisions: memoryStore.getDecisions().slice(0, 10).map((d) => ({
        id: d.id,
        description: d.description,
        category: d.category,
      })),
    };
  }

  /**
   * Format a session for display in list
   */
  formatSessionDisplay(metadata: SessionMetadata): string {
    const timeAgo = formatDistanceToNow(metadata.lastUpdatedAt, { addSuffix: true });
    const shortId = metadata.id.slice(0, 8);

    return `  ${shortId} - ${metadata.title}\n    ${timeAgo} • ${metadata.messageCount} messages • ${metadata.workingDirectory}`;
  }

  /**
   * Format a list of sessions for display
   */
  formatSessionsList(sessions: SessionMetadata[]): string {
    if (sessions.length === 0) {
      return 'No saved sessions found.';
    }

    const lines = ['💾 Saved Sessions:'];
    for (const session of sessions) {
      lines.push(this.formatSessionDisplay(session));
      lines.push('');
    }

    return lines.join('\n');
  }
}
