// Context Extractor - extracts structured information from messages

import type { ChatMessage, LLMClient } from '../llm/types.js';
import type {
  ClassifiedMessage,
  MessageImportance,
  MessageCategory,
  ExtractedInfo,
  UserPreference,
  UserFact,
  ProjectContext,
  Task,
  ErrorContext,
  Decision,
  BackwardReference,
  Correction,
  SessionGoal,
  FileSection,
} from './types.js';

// Patterns for extracting information
const PATTERNS = {
  // Goal/mission patterns - first substantial request
  goalStatements: [
    /(?:help me|i want to|i need to|let's|we need to|can you help me)\s+(?:build|create|implement|make|develop|write|design)\s+(.+?)(?:\.|$)/gi,
    /(?:my goal is to|the goal is to|i'm trying to)\s+(.+?)(?:\.|$)/gi,
  ],

  // User facts - personal information
  userFacts: [
    /(?:my name is|i'm|i am)\s+(\w+)(?:\s|,|\.)/gi,
    /(?:i'm|i am)\s+(?:a|an)\s+(\w+\s+\w+)(?:\s|,|\.)/gi, // "I'm a senior developer"
    /(?:i have|i've got)\s+(?:a|an)?\s*(.+?)(?:coming up|due|deadline|tomorrow|friday|monday)/gi,
    /(?:deadline|meeting|presentation|demo)\s+(?:is\s+)?(?:on\s+)?(\w+day|\d+\/\d+)/gi,
  ],

  // Backward references - mentions of earlier context
  backwardReferences: [
    /(?:like|as)\s+(?:we did|before|earlier|previously)/gi,
    /(?:that|the)\s+(?:regex|function|code|snippet|approach|solution|file|pattern)\s+(?:we|you|i)\s+(?:wrote|used|discussed|mentioned|created)/gi,
    /(?:remember|recall)\s+(?:when|that|the)/gi,
    /(?:go back to|return to|use)\s+(?:the|that)\s+(?:earlier|previous|first|original)/gi,
    /(?:what|where)\s+(?:was|were|did)\s+(?:that|the)\s+(.+?)\s+(?:we|you|i)/gi,
    /(?:the one|that thing)\s+(?:from|we)\s+(?:earlier|before)/gi,
  ],

  // User preferences
  preferences: [
    /(?:i\s+)?(?:prefer|like|want|use|always)\s+(.+?)(?:\.|$)/gi,
    /(?:we|our team)\s+(?:use|prefer|always)\s+(.+?)(?:\.|$)/gi,
    /(?:please\s+)?(?:don't|do not|never)\s+(.+?)(?:\.|$)/gi,
    /(?:make sure|ensure|remember)\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
  ],

  // Corrections with supersession
  corrections: [
    /(?:no,?\s+)?(?:i meant|actually|not that|wrong|wait)\s+(.+?)(?:\.|$)/gi,
    /(?:sorry,?\s+)?(?:the other|different)\s+(.+?)(?:\.|$)/gi,
    /(?:instead|rather)\s+(?:use|do|try)\s+(.+?)(?:\.|$)/gi,
    /(?:not\s+)(\w+)(?:,?\s+)(?:but|use)\s+(\w+)/gi, // "not npm, use pnpm"
    /(?:change|switch)\s+(?:from\s+)?(\w+)\s+to\s+(\w+)/gi, // "change from X to Y"
  ],

  // Project context
  techStack: [
    /(?:we're using|we use|this is a|built with)\s+(.+?)(?:\s+project|\s+app|\.|$)/gi,
    /(?:package manager|using)\s+(?:is\s+)?(\w+)/gi,
    /(?:framework|library|stack):\s*(.+?)(?:\.|$)/gi,
  ],

  // File paths
  filePaths: [
    /(?:^|\s)((?:\.{0,2}\/)?(?:[\w-]+\/)*[\w-]+\.\w+)(?:\s|$|:|\)|,)/g,
    /(?:in|at|file|path)\s+[`"']?([^\s`"']+\.\w+)[`"']?/gi,
  ],

  // Function/class sections
  fileSections: [
    /(?:function|method|class|interface|type|const|let|var)\s+(\w+)/gi,
    /(?:in|editing|modify|change|update)\s+(?:the\s+)?(\w+)\s+(?:function|method|class)/gi,
    /(\w+)\s*(?:\(|:|\{)/g, // Function calls or definitions
  ],

  // Error patterns
  errors: [
    /error[:\s]+(.+?)(?:\n|$)/gi,
    /(?:failed|failure)[:\s]+(.+?)(?:\n|$)/gi,
    /exception[:\s]+(.+?)(?:\n|$)/gi,
    /(?:cannot|can't|couldn't)\s+(.+?)(?:\.|$)/gi,
  ],

  // Task/request patterns
  taskRequest: [
    /(?:can you|could you|please|i need you to|help me)\s+(.+?)(?:\?|$)/gi,
    /(?:let's|we need to|we should)\s+(.+?)(?:\.|$)/gi,
  ],

  // Decision patterns
  decisions: [
    /(?:let's go with|i'll use|we'll use|decided to)\s+(.+?)(?:\.|$)/gi,
    /(?:the approach|solution) (?:is|will be)\s+(.+?)(?:\.|$)/gi,
  ],
};

// Keywords for importance classification
const IMPORTANCE_KEYWORDS = {
  critical: [
    'error', 'failed', 'crash', 'bug', 'broken', 'fix', 'urgent',
    'security', 'vulnerability', 'data loss', 'production',
  ],
  high: [
    'important', 'must', 'require', 'need', 'should', 'correction',
    'wrong', 'instead', 'actually', 'prefer', 'always', 'never',
    'goal', 'objective', 'mission',
  ],
  low: [
    'maybe', 'perhaps', 'could', 'might', 'just wondering',
    'curious', 'btw', 'by the way', 'fyi',
  ],
  noise: [
    'thanks', 'thank you', 'ok', 'okay', 'got it', 'sure',
    'yes', 'no', 'right', 'i see', 'understood',
  ],
};

export class ContextExtractor {
  private llmClient?: LLMClient;
  private isFirstUserMessage: boolean = true;
  private classificationCache: Map<string, ClassifiedMessage>;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient;
    this.classificationCache = new Map<string, ClassifiedMessage>();
  }

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  resetSession(): void {
    this.isFirstUserMessage = true;
  }

  clearClassificationCache(): void {
    this.classificationCache.clear();
  }

  private getContentHash(message: ChatMessage): string {
    return `${message.role}:${message.content.slice(0, 200)}:${message.content.length}`;
  }

  // Classify a single message
  classifyMessage(message: ChatMessage, index: number, prevMessage?: ChatMessage): ClassifiedMessage {
    const content = message.content.toLowerCase();
    const categories: MessageCategory[] = [];
    let importance: MessageImportance = 'medium';
    let topicBoundary = false;
    let exchangeComplete = false;
    let boundaryReason: ClassifiedMessage['boundaryReason'];

    // Determine categories
    if (message.role === 'user') {
      // Check for goal statement (especially first message)
      if (this.isFirstUserMessage && this.looksLikeGoal(content)) {
        categories.push('goal_statement');
        importance = 'critical'; // Goals are always critical
        this.isFirstUserMessage = false;
        topicBoundary = true;
        boundaryReason = 'new_request';
      }

      // Check for backward references
      if (this.matchesPatterns(content, PATTERNS.backwardReferences)) {
        categories.push('backward_reference');
        importance = 'high';
      }

      if (this.matchesPatterns(content, PATTERNS.corrections)) {
        categories.push('user_correction');
        importance = 'high';
        topicBoundary = true;
        boundaryReason = 'correction';
      }

      if (this.matchesPatterns(content, PATTERNS.preferences)) {
        categories.push('user_preference');
        importance = 'high';
      }

      if (this.matchesPatterns(content, PATTERNS.userFacts)) {
        categories.push('user_fact');
        importance = 'high';
      }

      if (this.matchesPatterns(content, PATTERNS.taskRequest)) {
        categories.push('user_request');
        // New user request after assistant response = topic boundary
        if (prevMessage?.role === 'assistant') {
          topicBoundary = true;
          boundaryReason = 'new_request';
        }
      }
    }

    if (message.role === 'tool') {
      categories.push('tool_output');
      if (content.includes('error') || content.includes('failed')) {
        categories.push('error_report');
        importance = 'critical';
      } else {
        importance = 'low';
      }
    }

    if (this.matchesPatterns(content, PATTERNS.errors)) {
      categories.push('error_report');
      importance = 'critical';
    }

    if (this.containsCodeBlock(message.content)) {
      categories.push('code_snippet');
    }

    if (this.matchesPatterns(content, PATTERNS.decisions)) {
      categories.push('key_decision');
      importance = 'high';
      topicBoundary = true;
      boundaryReason = 'decision_made';
    }

    // Check keyword-based importance
    importance = this.adjustImportanceByKeywords(content, importance);

    // Check for file content
    if (this.looksLikeFileContent(message.content)) {
      categories.push('file_content');
      if (importance === 'medium') importance = 'low';
    }

    // Check for error resolution
    if (message.role === 'assistant' && prevMessage?.role === 'tool') {
      const prevContent = prevMessage.content.toLowerCase();
      if ((prevContent.includes('error') || prevContent.includes('failed')) &&
          !content.includes('error') && !content.includes('failed')) {
        categories.push('error_resolution');
        topicBoundary = true;
        boundaryReason = 'error_resolved';
      }
    }

    // Mark exchange complete when assistant responds after user without pending tool calls
    if (message.role === 'assistant' && prevMessage?.role === 'user') {
      // Check if this message has tool calls (stored in toolCalls property)
      const hasToolCalls = 'toolCalls' in message && Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
      if (!hasToolCalls) {
        exchangeComplete = true;
      }
    }

    // Extract structured info
    const extractedInfo = this.extractInfo(message);

    return {
      index,
      role: message.role,
      importance,
      categories: categories.length > 0 ? categories : ['exploratory'],
      extractedInfo: Object.keys(extractedInfo).length > 0 ? extractedInfo : undefined,
      topicBoundary,
      exchangeComplete,
      boundaryReason,
    };
  }

  // Classify all messages with caching for incremental updates
  classifyMessages(messages: ChatMessage[]): ClassifiedMessage[] {
    this.resetSession();
    return messages.map((msg, idx) => {
      const hash = this.getContentHash(msg);
      const cached = this.classificationCache.get(hash);
      if (cached) {
        // Update index for cache hit
        return { ...cached, index: idx };
      }
      const result = this.classifyMessage(msg, idx, idx > 0 ? messages[idx - 1] : undefined);
      this.classificationCache.set(hash, result);
      return result;
    });
  }

  private looksLikeGoal(content: string): boolean {
    // First message that's substantial and contains action words
    if (content.length < 20) return false;

    const goalIndicators = [
      'help me', 'i want to', 'i need to', 'let\'s', 'we need to',
      'build', 'create', 'implement', 'make', 'develop', 'write', 'design',
      'my goal', 'the goal', 'objective', 'i\'m trying to',
    ];

    return goalIndicators.some(indicator => content.includes(indicator));
  }

  // Extract structured information from a message
  extractInfo(message: ChatMessage): ExtractedInfo {
    const info: ExtractedInfo = {};
    const content = message.content;

    // Extract goal (from user messages, especially first)
    if (message.role === 'user' && this.looksLikeGoal(content.toLowerCase())) {
      info.goal = this.extractGoal(content);
    }

    // Extract backward references
    const backwardRefs = this.extractBackwardReferences(content);
    if (backwardRefs.length > 0) {
      info.backwardReferences = backwardRefs;
    }

    // Extract corrections with supersession info
    const corrections = this.extractCorrections(content);
    if (corrections.length > 0) {
      info.corrections = corrections;
    }

    // Extract user facts
    if (message.role === 'user') {
      const facts = this.extractUserFacts(content);
      if (facts.length > 0) {
        info.userFacts = facts;
      }
    }

    // Extract file paths
    const files = this.extractFilePaths(content);
    if (files.length > 0) {
      info.files = files;
    }

    // Extract file sections
    const sections = this.extractFileSections(content, files);
    if (sections.length > 0) {
      info.fileSections = sections;
    }

    // Extract preferences (from user messages)
    if (message.role === 'user') {
      const prefs = this.extractPreferences(content);
      if (prefs.length > 0) {
        info.preferences = prefs;
      }
    }

    // Extract project context
    const ctx = this.extractProjectContext(content);
    if (ctx.length > 0) {
      info.projectContext = ctx;
    }

    // Extract errors
    const errors = this.extractErrors(content);
    if (errors.length > 0) {
      info.errors = errors;
    }

    // Extract decisions (from assistant messages)
    if (message.role === 'assistant') {
      const decisions = this.extractDecisions(content);
      if (decisions.length > 0) {
        info.decisions = decisions;
      }
    }

    return info;
  }

  private extractGoal(content: string): Partial<SessionGoal> {
    // Try to extract a clean goal statement
    for (const pattern of PATTERNS.goalStatements) {
      pattern.lastIndex = 0;
      const match = pattern.exec(content);
      if (match) {
        return {
          description: match[1].slice(0, 200),
          originalMessage: content.slice(0, 500),
          status: 'active',
        };
      }
    }

    // Fallback: use the whole message as goal
    return {
      description: content.slice(0, 200),
      originalMessage: content.slice(0, 500),
      status: 'active',
    };
  }

  private extractBackwardReferences(content: string): BackwardReference[] {
    const refs: BackwardReference[] = [];
    const contentLower = content.toLowerCase();

    // Pattern-based detection
    const patterns: [RegExp, BackwardReference['referenceType']][] = [
      [/(?:that|the)\s+(regex|pattern)\s+(?:we|you|i)/gi, 'code'],
      [/(?:that|the)\s+(function|method|class)\s+(?:we|you|i)/gi, 'code'],
      [/(?:that|the)\s+(approach|solution|strategy)\s+(?:we|you|i)/gi, 'approach'],
      [/(?:that|the)\s+(file)\s+(?:we|you|i)/gi, 'file'],
      [/(?:that|the)\s+(decision)\s+(?:we|you|i)/gi, 'decision'],
      [/(?:like|as)\s+(?:we did|before|earlier)/gi, 'general'],
      [/(?:remember|recall)\s+(?:when|that|the)\s+(.+?)(?:\?|$)/gi, 'general'],
    ];

    for (const [pattern, refType] of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const phrase = match[0];
        const searchTerm = match[1] || phrase;

        refs.push({
          phrase,
          referenceType: refType,
          searchQuery: searchTerm.replace(/[^\w\s]/g, '').trim(),
        });
      }
    }

    return refs;
  }

  private extractCorrections(content: string): Correction[] {
    const corrections: Correction[] = [];
    const contentLower = content.toLowerCase();

    // "not X, use Y" pattern
    const notUsePattern = /(?:not\s+)(\w+)(?:,?\s+)(?:but|use)\s+(\w+)/gi;
    let match;
    while ((match = notUsePattern.exec(contentLower)) !== null) {
      corrections.push({
        what: match[1],
        from: match[1],
        to: match[2],
        category: 'preference',
      });
    }

    // "change from X to Y" pattern
    const changePattern = /(?:change|switch)\s+(?:from\s+)?(\w+)\s+to\s+(\w+)/gi;
    while ((match = changePattern.exec(contentLower)) !== null) {
      corrections.push({
        what: match[1],
        from: match[1],
        to: match[2],
        category: 'preference',
      });
    }

    // "I meant X" pattern
    const meantPattern = /(?:i meant|actually|no,?\s+)\s*(.+?)(?:\.|$)/gi;
    while ((match = meantPattern.exec(contentLower)) !== null) {
      corrections.push({
        what: 'previous statement',
        to: match[1].slice(0, 100),
        category: 'fact',
      });
    }

    return corrections;
  }

  private extractUserFacts(content: string): Partial<UserFact>[] {
    const facts: Partial<UserFact>[] = [];
    const contentLower = content.toLowerCase();

    // Name detection
    const namePattern = /(?:my name is|i'm|i am)\s+(\w+)/i;
    const nameMatch = content.match(namePattern);
    if (nameMatch) {
      facts.push({
        fact: `User's name is ${nameMatch[1]}`,
        category: 'personal',
        confidence: 0.9,
        source: content.slice(0, 100),
        lifespan: 'permanent',
      });
    }

    // Role/job detection
    const rolePattern = /(?:i'm|i am)\s+(?:a|an)\s+([\w\s]+?)(?:\s+at|\s+for|\.|,|$)/i;
    const roleMatch = content.match(rolePattern);
    if (roleMatch) {
      facts.push({
        fact: `User is a ${roleMatch[1].trim()}`,
        category: 'personal',
        confidence: 0.8,
        source: content.slice(0, 100),
        lifespan: 'permanent',
      });
    }

    // Schedule/deadline detection
    const schedulePatterns = [
      [/(?:deadline|due)\s+(?:is\s+)?(?:on\s+)?(\w+day|\d+\/\d+)/i, 'Deadline'],
      [/(?:meeting|presentation|demo)\s+(?:is\s+)?(?:on\s+)?(\w+day|\d+\/\d+)/i, 'Event'],
      [/(?:presenting|demoing)\s+(?:on\s+)?(\w+day)/i, 'Presentation'],
    ];

    for (const [pattern, prefix] of schedulePatterns) {
      const match = content.match(pattern as RegExp);
      if (match) {
        facts.push({
          fact: `${prefix} on ${match[1]}`,
          category: 'schedule',
          confidence: 0.8,
          source: content.slice(0, 100),
          lifespan: 'session',
        });
      }
    }

    return facts;
  }

  private extractFileSections(content: string, files: string[]): { path: string; section: Partial<FileSection> }[] {
    const sections: { path: string; section: Partial<FileSection> }[] = [];

    // Detect function/class references
    const sectionPatterns: [RegExp, FileSection['type']][] = [
      [/(?:function|method)\s+(\w+)/gi, 'function'],
      [/(?:class)\s+(\w+)/gi, 'class'],
      [/(?:interface)\s+(\w+)/gi, 'interface'],
      [/(?:type)\s+(\w+)/gi, 'type'],
      [/(?:editing|modify|change|update)\s+(?:the\s+)?(\w+)\s+(?:function|method)/gi, 'function'],
    ];

    for (const [pattern, type] of sectionPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const sectionName = match[1];
        // Associate with most recently mentioned file, or leave unassociated
        const file = files.length > 0 ? files[files.length - 1] : 'unknown';
        sections.push({
          path: file,
          section: {
            name: sectionName,
            type,
            purpose: 'Mentioned in conversation',
          },
        });
      }
    }

    return sections;
  }

  private matchesPatterns(content: string, patterns: RegExp[]): boolean {
    return patterns.some(p => {
      p.lastIndex = 0;
      return p.test(content);
    });
  }

  private extractFilePaths(content: string): string[] {
    const paths = new Set<string>();

    for (const pattern of PATTERNS.filePaths) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const path = match[1];
        if (path.length > 3 &&
            !path.startsWith('http') &&
            !path.match(/^\d+\.\d+/) &&
            path.includes('.')) {
          paths.add(path);
        }
      }
    }

    return Array.from(paths);
  }

  private extractPreferences(content: string): Partial<UserPreference>[] {
    const prefs: Partial<UserPreference>[] = [];
    const contentLower = content.toLowerCase();

    // Style preferences
    if (contentLower.includes('functional') && contentLower.includes('style')) {
      prefs.push({ category: 'style', key: 'paradigm', value: 'functional', confidence: 0.8 });
    }
    if (contentLower.includes('oop') || contentLower.includes('object-oriented')) {
      prefs.push({ category: 'style', key: 'paradigm', value: 'object-oriented', confidence: 0.8 });
    }

    // Tooling preferences
    const toolingPatterns: [RegExp, string, string][] = [
      [/\b(pnpm|npm|yarn|bun)\b/i, 'package_manager', '$1'],
      [/\b(prettier|eslint|biome)\b/i, 'formatter', '$1'],
      [/\b(jest|vitest|mocha|ava)\b/i, 'test_framework', '$1'],
      [/\b(typescript|javascript)\b/i, 'language', '$1'],
    ];

    for (const [pattern, key, _] of toolingPatterns) {
      const match = content.match(pattern);
      if (match && (contentLower.includes('use') || contentLower.includes('prefer'))) {
        prefs.push({
          category: 'tooling',
          key,
          value: match[1].toLowerCase(),
          confidence: 0.7,
          source: content.slice(0, 100),
        });
      }
    }

    return prefs;
  }

  private extractProjectContext(content: string): Partial<ProjectContext>[] {
    const ctx: Partial<ProjectContext>[] = [];
    const contentLower = content.toLowerCase();

    const frameworks = [
      'react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt', 'express',
      'fastify', 'nest', 'django', 'flask', 'fastapi', 'spring',
    ];

    for (const fw of frameworks) {
      if (contentLower.includes(fw)) {
        ctx.push({
          type: 'tech_stack',
          key: 'framework',
          value: fw,
          lifespan: 'project',
        });
      }
    }

    const databases = [
      'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite',
      'dynamodb', 'firestore', 'supabase', 'prisma',
    ];

    for (const db of databases) {
      if (contentLower.includes(db)) {
        ctx.push({
          type: 'tech_stack',
          key: 'database',
          value: db,
          lifespan: 'project',
        });
      }
    }

    return ctx;
  }

  private extractErrors(content: string): Partial<ErrorContext>[] {
    const errors: Partial<ErrorContext>[] = [];

    for (const pattern of PATTERNS.errors) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        errors.push({
          error: match[1].slice(0, 500),
          resolved: false,
        });
      }
    }

    return errors;
  }

  private extractDecisions(content: string): Partial<Decision>[] {
    const decisions: Partial<Decision>[] = [];

    for (const pattern of PATTERNS.decisions) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        decisions.push({
          description: match[1].slice(0, 200),
        });
      }
    }

    return decisions;
  }

  private adjustImportanceByKeywords(content: string, current: MessageImportance): MessageImportance {
    if (IMPORTANCE_KEYWORDS.critical.some(k => content.includes(k))) {
      return 'critical';
    }

    if (current !== 'critical' && IMPORTANCE_KEYWORDS.high.some(k => content.includes(k))) {
      return 'high';
    }

    if (IMPORTANCE_KEYWORDS.noise.some(k => content.includes(k)) && content.length < 50) {
      return 'noise';
    }

    if (current === 'medium' && IMPORTANCE_KEYWORDS.low.some(k => content.includes(k))) {
      return 'low';
    }

    return current;
  }

  private containsCodeBlock(content: string): boolean {
    return content.includes('```') || content.includes('`');
  }

  private looksLikeFileContent(content: string): boolean {
    const lines = content.split('\n');
    if (lines.length < 10) return false;

    const indentedLines = lines.filter(l => l.startsWith('  ') || l.startsWith('\t'));
    if (indentedLines.length > lines.length * 0.5) return true;

    const numberedLines = lines.filter(l => /^\s*\d+[:\|→]/.test(l));
    if (numberedLines.length > lines.length * 0.3) return true;

    return false;
  }

  // Use LLM for deeper extraction when available
  async extractWithLLM(messages: ChatMessage[]): Promise<ExtractedInfo> {
    if (!this.llmClient) {
      const combined: ExtractedInfo = {};
      for (const msg of messages) {
        const info = this.extractInfo(msg);
        this.mergeExtractedInfo(combined, info);
      }
      return combined;
    }

    try {
      const conversationText = messages
        .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
        .join('\n\n');

      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: `Extract structured information from this conversation. Return JSON with:
- goal: {description} - the main objective/mission
- preferences: [{category, key, value}] - user stated preferences
- userFacts: [{fact, category}] - personal info (name, role, schedule)
- projectContext: [{type, key, value}] - project tech stack, conventions
- tasks: [{description, status}] - tasks mentioned
- corrections: [{from, to, category}] - corrections made
- files: [string] - file paths
Be concise. Only include clearly stated information.`,
        },
        { role: 'user', content: conversationText },
      ]);

      const content = response.choices[0]?.message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ExtractedInfo;
      }
    } catch (error) {
      console.error('LLM extraction failed:', error);
    }

    const combined: ExtractedInfo = {};
    for (const msg of messages) {
      const info = this.extractInfo(msg);
      this.mergeExtractedInfo(combined, info);
    }
    return combined;
  }

  private mergeExtractedInfo(target: ExtractedInfo, source: ExtractedInfo): void {
    if (source.preferences) {
      target.preferences = [...(target.preferences || []), ...source.preferences];
    }
    if (source.projectContext) {
      target.projectContext = [...(target.projectContext || []), ...source.projectContext];
    }
    if (source.tasks) {
      target.tasks = [...(target.tasks || []), ...source.tasks];
    }
    if (source.files) {
      target.files = [...new Set([...(target.files || []), ...source.files])];
    }
    if (source.errors) {
      target.errors = [...(target.errors || []), ...source.errors];
    }
    if (source.decisions) {
      target.decisions = [...(target.decisions || []), ...source.decisions];
    }
    if (source.userFacts) {
      target.userFacts = [...(target.userFacts || []), ...source.userFacts];
    }
    if (source.goal && !target.goal) {
      target.goal = source.goal;
    }
    if (source.backwardReferences) {
      target.backwardReferences = [...(target.backwardReferences || []), ...source.backwardReferences];
    }
    if (source.corrections) {
      target.corrections = [...(target.corrections || []), ...source.corrections];
    }
    if (source.fileSections) {
      target.fileSections = [...(target.fileSections || []), ...source.fileSections];
    }
  }
}
