// Smart Compressor - intelligent context compression with semantic awareness

import type { ChatMessage, LLMClient } from '../llm/types.js';
import type { LocalMemoryStore } from './store.js';
import { ContextExtractor } from './extractor.js';
import type {
  ClassifiedMessage,
  MessageImportance,
  ArchiveEntry,
} from './types.js';
import { estimateMessagesTokens } from '../context/token-estimator.js';

export interface SmartCompressionConfig {
  targetTokens: number;
  minRecentMessages: number;
  preserveErrorContext: boolean;
  preserveCodeBlocks: boolean;
  archiveOldContext: boolean;
  aggressiveMode: boolean; // Enable aggressive compression strategies
  semanticPreservation: boolean; // Preserve semantic meaning better
}

export interface SmartCompressionResult {
  messages: ChatMessage[];
  originalTokens: number;
  compressedTokens: number;
  archivedChunks: number;
  injectedContext: boolean;
  compressionRatio: number; // compressed / original
  strategiesUsed: string[];
}

const DEFAULT_CONFIG: SmartCompressionConfig = {
  targetTokens: 16000,
  minRecentMessages: 8,
  preserveErrorContext: true,
  preserveCodeBlocks: true,
  archiveOldContext: true,
  aggressiveMode: false,
  semanticPreservation: true,
};

export class SmartCompressor {
  private config: SmartCompressionConfig;
  private extractor: ContextExtractor;
  private memoryStore: LocalMemoryStore;
  private llmClient?: LLMClient;
  private chunkSummaryCache: Map<string, string>; // Cache for chunk summaries to avoid re-summarizing

  constructor(
    memoryStore: LocalMemoryStore,
    config: Partial<SmartCompressionConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memoryStore = memoryStore;
    this.extractor = new ContextExtractor();
    this.chunkSummaryCache = new Map();
  }

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
    this.extractor.setLLMClient(client);
  }

  /**
   * Clear the chunk summary cache.
   * Call this periodically or when session context changes significantly.
   */
  clearSummaryCache(): void {
    this.chunkSummaryCache.clear();
  }

  /**
   * Calculate token budget for memory context
   * Uses 20% of target tokens to avoid excessive memory.
   * 
   * Note: We use a simple calculation (20% of targetTokens) instead of calling
   * calculateBudget() from context/budget.ts because:
   * 1. The full ContextBudget type includes allocations for sections we don't use here
   * 2. We only need the memory portion for buildContextSummary()
   * 3. This keeps the smart-compressor focused on its specific use case
   * 4. The ConversationManager handles the full budget allocation
   */
  private calculateMemoryBudget(): number {
    // Use 20% of target tokens for memory context
    // This is separate from the ConversationManager's memory allocation (10% of 80% = 8%)
    // The difference is because:
    // - SmartCompressor's targetTokens is typically 50% of context limit (for compression)
    // - ConversationManager's budget is 80% of context limit (for total context)
    // - So: SmartCompressor memory = 0.2 * 0.5 * limit = 10% of limit
    // - ConversationManager memory = 0.1 * 0.8 * limit = 8% of limit
    // Both are reasonable amounts for memory context
    return Math.floor(this.config.targetTokens * 0.2);
  }

  async compress(messages: ChatMessage[]): Promise<SmartCompressionResult> {
    const originalTokens = estimateMessagesTokens(messages);
    const strategiesUsed: string[] = [];

    // Clear cache periodically to avoid stale summaries
    // Clear when cache size exceeds 100 entries
    if (this.chunkSummaryCache.size > 100) {
      this.clearSummaryCache();
    }

    // Check if compression needed
    if (originalTokens <= this.config.targetTokens) {
      return {
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        archivedChunks: 0,
        injectedContext: false,
        compressionRatio: 1.0,
        strategiesUsed: [],
      };
    }

    // Separate system message
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Classify all messages
    const classified = this.extractor.classifyMessages(conversationMessages);

    // Extract and store important information before compression
    await this.extractAndStore(conversationMessages, classified);

    // Apply compression strategies
    let messagesToProcess = [...conversationMessages];

    // Strategy 1: Remove low-importance messages
    if (originalTokens > this.config.targetTokens * 1.5) {
      messagesToProcess = this.removeLowImportanceMessages(messagesToProcess, classified);
      strategiesUsed.push('remove_low_importance');
    }

    // Strategy 2: Compress code blocks to signatures
    if (this.config.aggressiveMode && originalTokens > this.config.targetTokens * 2) {
      messagesToProcess = this.compressCodeBlocks(messagesToProcess, classified);
      strategiesUsed.push('compress_code_blocks');
    }

    // Strategy 3: Summarize long messages
    if (this.config.semanticPreservation && this.llmClient) {
      const threshold = this.config.aggressiveMode ? 500 : 1000;
      messagesToProcess = await this.summarizeLongMessages(messagesToProcess, threshold);
      strategiesUsed.push('summarize_long_messages');
    }

    // Strategy 4: Merge adjacent tool results
    messagesToProcess = this.mergeAdjacentToolResults(messagesToProcess);
    strategiesUsed.push('merge_tool_results');

    // Determine what to keep, compress, or discard from processed messages
    const { keep, archive, discard } = this.partitionMessages(
      messagesToProcess,
      classified
    );

    // Archive important older messages
    let archivedChunks = 0;
    if (this.config.archiveOldContext && archive.length > 0) {
      archivedChunks = await this.archiveMessages(archive, classified);
      strategiesUsed.push('archive_old_context');
    }

    // Build compressed message list
    const compressedMessages: ChatMessage[] = [];

    // Add system message
    if (systemMessage) {
      compressedMessages.push(systemMessage);
    }

    // Inject memory context
    const memoryBudget = this.calculateMemoryBudget();
    const memoryContext = this.memoryStore.buildContextSummary(memoryBudget);
    if (memoryContext) {
      compressedMessages.push({
        role: 'system',
        content: `[Persistent Memory]\n${memoryContext}`,
      });
      strategiesUsed.push('inject_memory_context');
    }

    // Generate summary of archived messages if we have LLM
    if (archive.length > 0 && this.llmClient) {
      const summary = await this.generateSummary(archive, classified);
      if (summary) {
        compressedMessages.push({
          role: 'system',
          content: `[Earlier Conversation Summary]\n${summary}`,
        });
        strategiesUsed.push('summarize_archived');
      }
    }

    // Add kept messages
    compressedMessages.push(...keep);

    const compressedTokens = estimateMessagesTokens(compressedMessages);
    const compressionRatio = compressedTokens / originalTokens;

    return {
      messages: compressedMessages,
      originalTokens,
      compressedTokens,
      archivedChunks,
      injectedContext: !!memoryContext,
      compressionRatio,
      strategiesUsed,
    };
  }

  private partitionMessages(
    messages: ChatMessage[],
    classified: ClassifiedMessage[]
  ): { keep: ChatMessage[]; archive: ChatMessage[]; discard: ChatMessage[] } {
    const keep: ChatMessage[] = [];
    const archive: ChatMessage[] = [];
    const discard: ChatMessage[] = [];

    // Always keep the most recent messages
    const recentCount = this.config.minRecentMessages;
    const recentStart = Math.max(0, messages.length - recentCount);

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const info = classified[i];

      // Always keep recent messages
      if (i >= recentStart) {
        keep.push(msg);
        continue;
      }

      // Decision based on importance and category
      if (this.shouldKeep(msg, info)) {
        keep.push(msg);
      } else if (this.shouldArchive(msg, info)) {
        archive.push(msg);
      } else {
        discard.push(msg);
      }
    }

    return { keep, archive, discard };
  }

  private shouldKeep(msg: ChatMessage, info: ClassifiedMessage): boolean {
    // Critical importance always kept
    if (info.importance === 'critical') return true;

    // User corrections always kept
    if (info.categories.includes('user_correction')) return true;

    // Key decisions kept
    if (info.categories.includes('key_decision')) return true;

    // Unresolved errors kept
    if (info.categories.includes('error_report') && this.config.preserveErrorContext) {
      // Check if this error was resolved later
      // For now, keep all errors
      return true;
    }

    // Recent code snippets with context
    if (info.categories.includes('code_snippet') && this.config.preserveCodeBlocks) {
      // Keep if it's small
      if (msg.content.length < 1000) return true;
    }

    // User preferences kept
    if (info.categories.includes('user_preference')) return true;

    return false;
  }

  private shouldArchive(msg: ChatMessage, info: ClassifiedMessage): boolean {
    // Archive anything medium or high importance that we're not keeping
    if (info.importance === 'high' || info.importance === 'medium') return true;

    // Archive user requests (the original asks)
    if (info.categories.includes('user_request')) return true;

    // Archive code snippets (can be retrieved later)
    if (info.categories.includes('code_snippet')) return true;

    // Archive file content
    if (info.categories.includes('file_content')) return true;

    return false;
  }

  // Strategy: Remove low-importance messages
  private removeLowImportanceMessages(
    messages: ChatMessage[],
    classified: ClassifiedMessage[]
  ): ChatMessage[] {
    const originalIndices = new Map<ChatMessage, number>();
    classified.forEach((c, i) => {
      originalIndices.set(messages[i], c.index);
    });

    return messages.filter((msg, idx) => {
      const info = classified.find(c => c.index === originalIndices.get(msg));
      if (!info) return true;
      
      // Keep if not noise or low importance
      return info.importance !== 'noise' && info.importance !== 'low';
    });
  }

  // Strategy: Compress code blocks to function signatures
  private compressCodeBlocks(
    messages: ChatMessage[],
    classified: ClassifiedMessage[]
  ): ChatMessage[] {
    return messages.map((msg) => {
      if (msg.content.length < 500) return msg; // Skip short messages

      // Extract code blocks and compress them
      const codeBlockPattern = /```[\s\S]*?```/g;
      let compressed = msg.content;
      let match;

      while ((match = codeBlockPattern.exec(msg.content)) !== null) {
        const fullBlock = match[0];
        const content = fullBlock.replace(/```[\w]*\n?/g, '').replace(/```$/g, '');

        // Try to extract function/class signatures
        const lines = content.split('\n');
        const signatures: string[] = [];

        for (const line of lines) {
          // Look for function/class declarations
          if (/^\s*(function|class|interface|type|const|let|var)\s+/.test(line)) {
            signatures.push(line.trim());
          } else if (/^\s*\w+\s*\([^)]*\)\s*(=>|:|\{)/.test(line)) {
            // Arrow functions or method signatures
            signatures.push(line.trim());
          }
        }

        if (signatures.length > 0) {
          const placeholder = `[${signatures.length} functions/classes defined]\n` +
                             signatures.map(s => `  ${s}`).join('\n');
          compressed = compressed.replace(fullBlock, placeholder);
        }
      }

      return { ...msg, content: compressed };
    });
  }

  // Strategy: Summarize long messages using LLM
  private async summarizeLongMessages(
    messages: ChatMessage[],
    threshold: number
  ): Promise<ChatMessage[]> {
    if (!this.llmClient) return messages;

    const results: ChatMessage[] = [];

    for (const msg of messages) {
      if (msg.content.length <= threshold) {
        results.push(msg);
        continue;
      }

      try {
        const summary = await this.summarizeMessage(msg);
        results.push({
          ...msg,
          content: summary,
        });
      } catch {
        // If summarization fails, keep original
        results.push(msg);
      }
    }

    return results;
  }

  private async summarizeMessage(msg: ChatMessage): Promise<string> {
    if (!this.llmClient) return msg.content;

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: 'Summarize this message concisely while preserving key information, code snippets, and technical details.',
        },
        {
          role: 'user',
          content: msg.content,
        },
      ]);

      return response.choices[0]?.message.content || msg.content;
    } catch {
      return msg.content;
    }
  }

  // Strategy: Merge adjacent tool results
  private mergeAdjacentToolResults(messages: ChatMessage[]): ChatMessage[] {
    const merged: ChatMessage[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      // If this is a tool result and next message is also a tool result
      if (msg.role === 'tool' && i + 1 < messages.length && messages[i + 1].role === 'tool') {
        // Merge consecutive tool results
        const mergedContent = [msg.content];
        let j = i + 1;

        while (j < messages.length && messages[j].role === 'tool') {
          mergedContent.push(messages[j].content);
          j++;
        }

        merged.push({
          ...msg,
          content: mergedContent.join('\n---\n'),
        });
        i = j;
      } else {
        merged.push(msg);
        i++;
      }
    }

    return merged;
  }

  private async extractAndStore(
    messages: ChatMessage[],
    classified: ClassifiedMessage[]
  ): Promise<void> {
    // NOTE: Preferences, facts, and decisions are now extracted in real-time
    // in ConversationManager.processNewMessage(). This method only handles
    // files, file sections, and errors for archival context.
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const info = classified[i];

      if (!info.extractedInfo) continue;

      // Store files as active (for archival context)
      for (const file of info.extractedInfo.files || []) {
        this.memoryStore.addActiveFile({
          path: file,
          purpose: 'Referenced in conversation',
        });
      }

      // Store file sections (for archival context)
      for (const { path, section } of info.extractedInfo.fileSections || []) {
        if (section.name && section.type) {
          this.memoryStore.addFileSection(path, {
            name: section.name,
            type: section.type,
            purpose: section.purpose || 'Mentioned in conversation',
            startLine: section.startLine,
            endLine: section.endLine,
          });
        }
      }

      // Store errors (for archive context - not resolved ones)
      for (const error of info.extractedInfo.errors || []) {
        if (error.error) {
          this.memoryStore.addError({
            error: error.error,
            file: error.file,
            line: error.line,
          });
        }
      }

      // Handle backward references - retrieve and track
      for (const ref of info.extractedInfo.backwardReferences || []) {
        const retrieved = await this.retrieveContext(ref.searchQuery);
        if (retrieved) {
          // Track the retrieval
          const archiveResults = this.memoryStore.search(ref.searchQuery, 5);
          this.memoryStore.trackRetrieval({
            backwardReference: ref,
            retrievedEntryIds: archiveResults.map(e => e.id),
            retrievedAt: new Date(),
            messageIndex: i,
            injectedContent: retrieved,
          });
        }
      }
    }

    // Save memory store
    await this.memoryStore.save();
  }

  private async archiveMessages(
    messages: ChatMessage[],
    classified: ClassifiedMessage[]
  ): Promise<number> {
    // Group messages into semantic chunks for archiving
    const chunks: { messages: ChatMessage[]; infos: ClassifiedMessage[] }[] = [];
    let currentChunk: { messages: ChatMessage[]; infos: ClassifiedMessage[] } = {
      messages: [],
      infos: [],
    };

    const originalIndices = new Map<ChatMessage, number>();
    const conversationMessages = classified.map((c, i) => {
      originalIndices.set(messages.find((_, idx) => idx === i)!, c.index);
      return c;
    });

    let prevFiles: Set<string> = new Set();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const info = classified.find(c => c.index === originalIndices.get(msg))!;

      // Use chunk boundary hints from classifier, with fallback to our own detection
      const shouldBreak = info.topicBoundary ||
        this.isSemanticBoundary(msg, info, currentChunk, prevFiles);

      if (shouldBreak && currentChunk.messages.length >= 2) {
        chunks.push(currentChunk);
        currentChunk = { messages: [], infos: [] };
        prevFiles = new Set(info.extractedInfo?.files || []);
      }

      currentChunk.messages.push(msg);
      currentChunk.infos.push(info);

      // Update tracked files
      for (const file of info.extractedInfo?.files || []) {
        prevFiles.add(file);
      }

      // Also break on exchange complete if chunk is getting large
      if (info.exchangeComplete && currentChunk.messages.length >= 4) {
        chunks.push(currentChunk);
        currentChunk = { messages: [], infos: [] };
        prevFiles = new Set();
      }

      // Max chunk size fallback
      if (currentChunk.messages.length >= 8) {
        chunks.push(currentChunk);
        currentChunk = { messages: [], infos: [] };
        prevFiles = new Set();
      }
    }

    if (currentChunk.messages.length > 0) {
      chunks.push(currentChunk);
    }

    // Archive each chunk
    for (const chunk of chunks) {
      const summary = await this.summarizeChunk(chunk.messages);
      const keywords = this.extractKeywords(chunk.messages);
      const files = chunk.infos.flatMap(i => i.extractedInfo?.files || []);
      const maxImportance = this.getMaxImportance(chunk.infos);

      this.memoryStore.archive({
        type: 'conversation_chunk',
        content: chunk.messages.map(m => `${m.role}: ${m.content}`).join('\n'),
        summary,
        keywords,
        relatedFiles: [...new Set(files)],
        timestamp: new Date(),
        sessionId: 'current', // Should be actual session ID
        importance: maxImportance,
      });
    }

    await this.memoryStore.save();
    return chunks.length;
  }

  private async summarizeChunk(messages: ChatMessage[]): Promise<string> {
    if (!this.llmClient) {
      // Simple summary without LLM
      const userMsgs = messages.filter(m => m.role === 'user');
      const assistantMsgs = messages.filter(m => m.role === 'assistant');
      return `User asked about: ${userMsgs.map(m => m.content.slice(0, 50)).join('; ')}. ` +
             `Assistant: ${assistantMsgs.map(m => m.content.slice(0, 50)).join('; ')}`;
    }

    // Generate cache key from message contents
    const cacheKey = messages.map(m => `${m.role}:${m.content.slice(0, 100)}`).join('|');

    // Check cache first
    const cachedSummary = this.chunkSummaryCache.get(cacheKey);
    if (cachedSummary) {
      return cachedSummary;
    }

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: 'Summarize this conversation chunk in 2-3 sentences. Focus on: what was asked, what was done, key outcomes.',
        },
        {
          role: 'user',
          content: messages.map(m => `${m.role}: ${m.content.slice(0, 300)}`).join('\n'),
        },
      ]);
      const summary = response.choices[0]?.message.content || 'No summary available';
      
      // Cache the summary
      this.chunkSummaryCache.set(cacheKey, summary);
      
      return summary;
    } catch {
      return 'Conversation chunk (summary unavailable)';
    }
  }

  private extractKeywords(messages: ChatMessage[]): string[] {
    const keywords = new Set<string>();
    const content = messages.map(m => m.content).join(' ').toLowerCase();

    // Extract potential keywords
    const words = content.split(/\s+/);
    for (const word of words) {
      // Filter to meaningful words
      if (word.length > 4 && !this.isStopWord(word)) {
        keywords.add(word.replace(/[^a-z0-9]/g, ''));
      }
    }

    // Extract file paths
    const pathPattern = /[\w-]+\.\w+/g;
    let match;
    while ((match = pathPattern.exec(content)) !== null) {
      keywords.add(match[0]);
    }

    return Array.from(keywords).slice(0, 20);
  }

  private isStopWord(word: string): boolean {
    const stopWords = [
      'this', 'that', 'these', 'those', 'have', 'been', 'were', 'would',
      'could', 'should', 'about', 'there', 'their', 'which', 'where',
      'what', 'when', 'will', 'with', 'from', 'they', 'your', 'just',
      'some', 'also', 'very', 'then', 'than', 'into', 'only',
    ];
    return stopWords.includes(word);
  }

  private getMaxImportance(infos: ClassifiedMessage[]): MessageImportance {
    const order: MessageImportance[] = ['critical', 'high', 'medium', 'low', 'noise'];
    for (const importance of order) {
      if (infos.some(i => i.importance === importance)) {
        return importance;
      }
    }
    return 'medium';
  }

  private isSemanticBoundary(
    msg: ChatMessage,
    info: ClassifiedMessage,
    currentChunk: { messages: ChatMessage[]; infos: ClassifiedMessage[] },
    prevFiles: Set<string>
  ): boolean {
    // Empty chunk = no boundary
    if (currentChunk.messages.length === 0) return false;

    // New user request after assistant response indicates new topic
    if (msg.role === 'user' && currentChunk.messages[currentChunk.messages.length - 1].role === 'assistant') {
      // Check if this looks like a new request vs follow-up
      if (info.categories.includes('user_request') || info.categories.includes('goal_statement')) {
        return true;
      }
    }

    // Significant file context change (discussing new files)
    const currentFiles = new Set(info.extractedInfo?.files || []);
    if (currentFiles.size > 0 && prevFiles.size > 0) {
      const overlap = [...currentFiles].filter(f => prevFiles.has(f)).length;
      const noOverlap = overlap === 0;
      if (noOverlap && currentFiles.size >= 2) {
        return true; // Switched to completely different files
      }
    }

    // Transition from error to non-error (resolution boundary)
    const prevHadError = currentChunk.infos.some(i => i.categories.includes('error_report'));
    const currentIsResolution = info.categories.includes('error_resolution') ||
      (prevHadError && msg.role === 'assistant' && !info.categories.includes('error_report'));
    if (prevHadError && currentIsResolution) {
      return true;
    }

    // New key decision after discussion
    if (info.categories.includes('key_decision') && currentChunk.messages.length >= 3) {
      return true;
    }

    // User correction starts new context
    if (info.categories.includes('user_correction')) {
      return true;
    }

    return false;
  }

  private async generateSummary(
    messages: ChatMessage[],
    classified: ClassifiedMessage[]
  ): Promise<string | null> {
    if (!this.llmClient) return null;

    // Build context-aware summary prompt
    const highPriorityMessages = messages.filter((_, i) =>
      classified[i].importance === 'critical' || classified[i].importance === 'high'
    );

    const prompt = `Summarize this earlier part of our conversation. Preserve:
1. The original user request/goal
2. Key decisions made
3. Important errors encountered and how they were resolved
4. Current progress and what's left to do

Be concise but complete. Use bullet points.

Conversation:
${messages.map(m => `${m.role}: ${m.content.slice(0, 300)}`).join('\n\n')}

${highPriorityMessages.length > 0 ? `\nHigh priority items to preserve:\n${
  highPriorityMessages.map(m => `- ${m.content.slice(0, 100)}`).join('\n')
}` : ''}`;

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: 'You are summarizing an earlier portion of a coding conversation. Be concise but preserve critical context.',
        },
        { role: 'user', content: prompt },
      ]);

      return response.choices[0]?.message.content || null;
    } catch {
      return null;
    }
  }

  // Retrieve relevant context from archive
  async retrieveContext(query: string): Promise<string | null> {
    const results = this.memoryStore.search(query, 5);
    if (results.length === 0) return null;

    const parts: string[] = ['[Retrieved from earlier context]'];
    for (const entry of results) {
      parts.push(`\n${entry.summary}`);
      if (entry.relatedFiles.length > 0) {
        parts.push(`Files: ${entry.relatedFiles.join(', ')}`);
      }
    }

    return parts.join('\n');
  }
}
