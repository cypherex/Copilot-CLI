// Conversation state management with smart memory

import chalk from 'chalk';
import type { ChatMessage, ToolCall, LLMClient } from '../llm/types.js';
import { ContextManager, type ContextManagerConfig, MODEL_CONTEXT_LIMITS } from '../context/manager.js';
import { LocalMemoryStore } from '../memory/store.js';
import { SmartCompressor, type SmartCompressionConfig } from '../memory/smart-compressor.js';
import { ContextExtractor } from '../memory/extractor.js';

export interface ConversationConfig {
  maxHistoryLength?: number;
  contextConfig?: Partial<ContextManagerConfig>;
  compressionConfig?: Partial<SmartCompressionConfig>;
  workingDirectory?: string;
  enableSmartMemory?: boolean;
}

export class ConversationManager {
  private messages: ChatMessage[] = [];
  private maxHistoryLength: number;
  private contextManager: ContextManager;
  private memoryStore: LocalMemoryStore;
  private smartCompressor: SmartCompressor;
  private extractor: ContextExtractor;
  private llmClient?: LLMClient;
  private enableSmartMemory: boolean;
  private initialized: boolean = false;

  constructor(systemPrompt: string, config: ConversationConfig = {}) {
    this.maxHistoryLength = config.maxHistoryLength ?? 50;
    this.enableSmartMemory = config.enableSmartMemory ?? true;

    // Initialize context manager for token tracking
    this.contextManager = new ContextManager({
      verbose: false,
      ...config.contextConfig,
    });

    // Initialize memory store
    const workingDir = config.workingDirectory || process.cwd();
    this.memoryStore = new LocalMemoryStore(workingDir);

    // Initialize smart compressor
    this.smartCompressor = new SmartCompressor(this.memoryStore, {
      targetTokens: config.contextConfig?.maxContextTokens
        ? Math.floor(config.contextConfig.maxContextTokens * 0.5)
        : 16000,
      ...config.compressionConfig,
    });

    // Initialize extractor
    this.extractor = new ContextExtractor();

    // Add system prompt
    this.messages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load persisted memory
    await this.memoryStore.load();

    // Inject persistent context into system prompt if available
    const memoryContext = this.memoryStore.buildContextSummary();
    if (memoryContext && this.messages.length > 0) {
      const systemMsg = this.messages[0];
      if (systemMsg.role === 'system') {
        // Append memory context to system prompt
        this.messages[0] = {
          role: 'system',
          content: `${systemMsg.content}\n\n[Persistent Memory - Previous Session Context]\n${memoryContext}`,
        };
      }
    }

    this.initialized = true;
    console.log(chalk.gray('[Memory] Loaded persistent context'));
  }

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
    this.contextManager.setLLMClient(client);
    this.smartCompressor.setLLMClient(client);
    this.extractor.setLLMClient(client);
  }

  setModelContextLimit(model: string): void {
    this.contextManager.setModelContextLimit(model);

    // Update smart compressor target
    const limit = MODEL_CONTEXT_LIMITS[model] || 32000;
    this.smartCompressor = new SmartCompressor(this.memoryStore, {
      targetTokens: Math.floor(limit * 0.5),
    });
    if (this.llmClient) {
      this.smartCompressor.setLLMClient(this.llmClient);
    }
  }

  addUserMessage(content: string): void {
    this.messages.push({
      role: 'user',
      content,
    });

    // Extract information from user message in real-time
    if (this.enableSmartMemory) {
      this.processNewMessage(this.messages[this.messages.length - 1]);
    }
  }

  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    this.messages.push({
      role: 'assistant',
      content,
      toolCalls,
    });
  }

  addToolResult(toolCallId: string, toolName: string, result: string): void {
    this.messages.push({
      role: 'tool',
      name: toolName,
      content: result,
      toolCallId,
    });

    // Track file reads
    if (toolName === 'read_file' && this.enableSmartMemory) {
      // Extract file path from the tool result context
      this.memoryStore.addActiveFile({
        path: toolName, // Would need actual path from args
        purpose: 'Read by tool',
      });
    }

    // Track errors from tool results
    if (result.toLowerCase().includes('error') && this.enableSmartMemory) {
      this.memoryStore.addError({
        error: result.slice(0, 500),
      });
    }
  }

  private async processNewMessage(message: ChatMessage): Promise<void> {
    const classified = this.extractor.classifyMessage(message, this.messages.length - 1);

    if (!classified.extractedInfo) return;

    const info = classified.extractedInfo;

    // Store goal (mission statement) - first substantial ask
    if (info.goal && !this.memoryStore.getGoal()) {
      this.memoryStore.setGoal({
        description: info.goal.description || message.content.slice(0, 200),
        originalMessage: info.goal.originalMessage || message.content,
        status: 'active',
      });
    }

    // Store user facts
    for (const fact of info.userFacts || []) {
      if (fact.fact && fact.category) {
        this.memoryStore.addUserFact({
          fact: fact.fact,
          category: fact.category,
          source: fact.source || message.content.slice(0, 100),
          confidence: fact.confidence || 0.7,
          lifespan: fact.lifespan || 'session',
        });
      }
    }

    // Handle corrections with supersession
    for (const correction of info.corrections || []) {
      if (correction.from && correction.to && correction.category === 'preference') {
        // Find and supersede the old preference
        const oldPref = this.memoryStore.getPreferenceByKey('tooling', correction.from);
        const newPref = this.memoryStore.addPreference({
          category: 'tooling',
          key: correction.from,
          value: correction.to,
          source: message.content.slice(0, 100),
          confidence: 0.9, // Corrections are high confidence
          lifespan: 'project',
        });
        if (oldPref) {
          this.memoryStore.supersedePreference(oldPref.id, newPref.id);
        }
      }
    }

    // Store preferences
    for (const pref of info.preferences || []) {
      if (pref.category && pref.key && pref.value) {
        // Check if this supersedes an existing preference
        const existing = this.memoryStore.getPreferenceByKey(pref.category, pref.key);
        const newPref = this.memoryStore.addPreference({
          category: pref.category,
          key: pref.key,
          value: pref.value,
          source: pref.source || message.content.slice(0, 100),
          confidence: pref.confidence || 0.7,
          lifespan: 'project',
        });
        if (existing && existing.value !== pref.value) {
          this.memoryStore.supersedePreference(existing.id, newPref.id);
        }
      }
    }

    // Store project context
    for (const ctx of info.projectContext || []) {
      if (ctx.type && ctx.key && ctx.value) {
        this.memoryStore.addProjectContext({
          type: ctx.type,
          key: ctx.key,
          value: ctx.value,
          lifespan: ctx.lifespan || 'project',
        });
      }
    }

    // Track active files with sections
    for (const file of info.files || []) {
      this.memoryStore.addActiveFile({
        path: file,
        purpose: 'Mentioned in conversation',
      });
    }

    // Track file sections
    for (const { path, section } of info.fileSections || []) {
      if (section.name && section.type) {
        this.memoryStore.addFileSection(path, {
          name: section.name,
          type: section.type,
          purpose: section.purpose,
        });
      }
    }

    // Handle backward references - retrieve from archive
    for (const ref of info.backwardReferences || []) {
      const retrieved = await this.retrieveContext(ref.searchQuery);
      if (retrieved) {
        // Inject retrieved context as a system message
        console.log(chalk.gray(`[Memory] Retrieved context for: "${ref.phrase}"`));
        // The context will be available in the next LLM call
      }
    }

    // Track tasks from user requests
    if (classified.categories.includes('user_request') && message.role === 'user') {
      const activeTask = this.memoryStore.getActiveTask();
      if (!activeTask) {
        this.memoryStore.addTask({
          description: message.content.slice(0, 200),
          status: 'active',
          relatedFiles: info.files || [],
          priority: classified.importance === 'critical' ? 'critical' : 'medium',
        });
      }
    }
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  clear(): void {
    const systemPrompt = this.messages[0];
    this.messages = [systemPrompt];
    this.contextManager.reset();
    this.memoryStore.clear('session');
  }

  async trimHistory(): Promise<void> {
    // Update context usage
    this.contextManager.updateUsage(this.messages);

    // Use smart compression if enabled and needed
    if (this.enableSmartMemory && this.contextManager.needsCompression()) {
      console.log(chalk.yellow('[Memory] Context threshold reached, compressing...'));

      const result = await this.smartCompressor.compress(this.messages);
      this.messages = result.messages;

      console.log(chalk.green(
        `[Memory] Compressed: ${result.originalTokens} → ${result.compressedTokens} tokens ` +
        `(archived ${result.archivedChunks} chunks)`
      ));

      // Save memory after compression
      await this.memoryStore.save();

    } else if (this.messages.length > this.maxHistoryLength) {
      // Fallback to simple truncation
      const systemMessages = this.messages.filter(m => m.role === 'system');
      const conversationMessages = this.messages.filter(m => m.role !== 'system');
      const recentMessages = conversationMessages.slice(-this.maxHistoryLength + systemMessages.length);
      this.messages = [...systemMessages, ...recentMessages];
    }
  }

  getContextUsage(): string {
    this.contextManager.updateUsage(this.messages);
    return this.contextManager.getUsageSummary();
  }

  getContextManager(): ContextManager {
    return this.contextManager;
  }

  getMemoryStore(): LocalMemoryStore {
    return this.memoryStore;
  }

  // Retrieve relevant context from memory based on query
  async retrieveContext(query: string): Promise<string | null> {
    return this.smartCompressor.retrieveContext(query);
  }

  // Get memory summary for display
  getMemorySummary(): string {
    const prefs = this.memoryStore.getPreferences();
    const ctx = this.memoryStore.getProjectContext();
    const tasks = this.memoryStore.getTasks();
    const state = this.memoryStore.getWorkingState();

    const parts: string[] = [];

    parts.push(chalk.bold('Memory Status:'));
    parts.push(`  Preferences: ${prefs.length}`);
    parts.push(`  Project context: ${ctx.length}`);
    parts.push(`  Tasks: ${tasks.filter(t => t.status === 'active').length} active, ${tasks.filter(t => t.status === 'completed').length} completed`);
    parts.push(`  Active files: ${state.activeFiles.length}`);
    parts.push(`  Unresolved errors: ${state.recentErrors.filter(e => !e.resolved).length}`);

    return parts.join('\n');
  }

  async saveMemory(): Promise<void> {
    await this.memoryStore.save();
  }
}
