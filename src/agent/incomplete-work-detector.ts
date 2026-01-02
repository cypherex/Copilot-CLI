import { ChatMessage } from '../llm/types.js';
import type { MemoryStore } from '../memory/types.js';
import chalk from 'chalk';

export interface TrackingItem {
  description: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface DetectionResult {
  isIncomplete: boolean;
  reason: string;
  trackingItems: TrackingItem[];
  completionPhrases: string[];
  remainingPhrases: string[];
  askingPermission?: boolean;
  permissionAlreadyGranted?: boolean;
  currentTask?: string;
}

/**
 * Detects when LLM says it's complete but left work undone
 */
export class IncompleteWorkDetector {
  private memoryStore?: MemoryStore;

  constructor(memoryStore?: MemoryStore) {
    this.memoryStore = memoryStore;
  }

  private static readonly COMPLETION_PHRASES = [
    "that's it",
    'done',
    'complete',
    'finished',
    'all done',
    'that should',
    'that completes',
    'nothing more',
    "that's all",
    "we're done",
    'we have completed',
    'successfully implemented',
    'that should be everything',
  ];

  private static readonly REMAINING_PHRASES = [
    'remaining',
    'left to do',
    'still need',
    "haven't",
    'not yet',
    'to do',
    'todo',
    'pending',
    'coming next',
    'later',
    'in a bit',
    'next step',
    'subsequent',
    'following',
  ];

  private static readonly PERMISSION_PATTERNS = [
    /would you like me to/i,
    /should I/i,
    /do you want/i,
    /shall I/i,
    /may I/i,
    /can I proceed/i,
    /would you prefer/i,
    /what would you prefer/i,
    /which would you like/i,
    /how would you like/i,
    /let me know if/i,
  ];

  private static readonly TODO_PATTERNS = [
    /(?:^|\n)\s*[-*+]\s*(.+)/g,      // Bullet points
    /(?:^|\n)\s*\d+[.)]\s*(.+)/g,    // Numbered lists
    /(?:^|\n)\s*TODO:\s*(.+)/gi,     // TODO: prefix
    /(?:^|\n)\s*\[\s*\]\s*(.+)/g,    // [ ] checkboxes
  ];

  /**
   * Check if the agent's response indicates completion
   */
  isCompletionMessage(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return IncompleteWorkDetector.COMPLETION_PHRASES.some(phrase =>
      new RegExp(phrase, 'i').test(lowerMessage)
    );
  }

  /**
   * Check if the message mentions remaining or incomplete work
   */
  hasRemainingWork(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return IncompleteWorkDetector.REMAINING_PHRASES.some(phrase =>
      new RegExp(phrase, 'i').test(lowerMessage)
    );
  }

  /**
   * Check if the agent is asking for permission to do something
   */
  isAskingPermission(message: string): boolean {
    return IncompleteWorkDetector.PERMISSION_PATTERNS.some(pattern =>
      pattern.test(message)
    );
  }

  /**
   * Check if the current task already authorizes the action being asked about
   */
  checkPermissionFromTask(message: string): { granted: boolean; taskDescription?: string } {
    if (!this.memoryStore) {
      return { granted: false };
    }

    const currentTask = this.memoryStore.getActiveTask();
    if (!currentTask) {
      return { granted: false };
    }

    const taskLower = currentTask.description.toLowerCase();
    const messageLower = message.toLowerCase();

    // Extract what the agent is asking permission for
    // Look for patterns like "proceed with the cleanup", "execute all", etc.
    const actionPatterns = [
      /(?:proceed with|execute|do|perform|run|start)\s+(?:the\s+)?([^?.\n]+)/gi,
      /(?:would you like me to)\s+([^?.\n]+)/gi,
      /(?:should I)\s+([^?.\n]+)/gi,
    ];

    for (const pattern of actionPatterns) {
      let match;
      const tempPattern = new RegExp(pattern);
      while ((match = tempPattern.exec(messageLower)) !== null) {
        const action = match[1].trim();

        // Check if the task description contains similar words to the action
        const actionWords = action.split(/\s+/).filter(w => w.length > 3);
        const taskWords = taskLower.split(/\s+/);

        // If at least 2 key words from the action appear in the task, consider it granted
        const matchingWords = actionWords.filter(word =>
          taskWords.some(taskWord => taskWord.includes(word) || word.includes(taskWord))
        );

        if (matchingWords.length >= 2 || (actionWords.length === 1 && matchingWords.length === 1)) {
          return {
            granted: true,
            taskDescription: currentTask.description
          };
        }
      }
    }

    return { granted: false, taskDescription: currentTask.description };
  }

  /**
   * Extract tracking items (TODOs, bullet points, etc.) from message
   */
  extractTrackingItems(message: string): TrackingItem[] {
    const items: TrackingItem[] = [];

    for (const pattern of IncompleteWorkDetector.TODO_PATTERNS) {
      let match;
      while ((match = pattern.exec(message)) !== null) {
        const itemText = match[1].trim();
        if (itemText && !items.some(i => i.description === itemText)) {
          items.push({
            description: itemText,
            priority: this.inferPriority(itemText),
          });
        }
      }
    }

    return items;
  }

  /**
   * Filter out obvious non-work items using heuristics
   * This removes documentation, examples, explanations, etc. before storage
   */
  private filterObviousNonWork(items: TrackingItem[]): TrackingItem[] {
    return items.filter(item => {
      const text = item.description;

      // Rule 1: Documentation/file reference markers
      // Matches: "*File:", "**File:", "→ Lines 463-520", etc.
      if (/^\*\*?File:|→\s+Lines|^\*[A-Z].*\*\*?/.test(text)) {
        return false;
      }

      // Rule 2: Emoji prefixes (indicating examples, summaries, or status)
      // Matches: ✅, ❌, ⚠️, 📋, 💡, 🎯, 🔍, 📌, etc.
      if (/^[✅❌⚠️📋💡🎯🔍📌✓✗]/.test(text)) {
        return false;
      }

      // Rule 3: Explanatory phrases (past tense, descriptive)
      // Matches: "This is", "This was", "That was", "What happened", etc.
      if (/^(?:This|That|What|Which|How|Why) (?:is|was|are|were)|happened|occurred/i.test(text)) {
        return false;
      }

      // Rule 4: Workflow arrows with function names
      // Matches: "create_task()", "close_tracking_item()", etc.
      if (text.includes('→') && /\b[A-Z][a-zA-Z_]+\(\)/.test(text)) {
        return false;
      }

      // Rule 5: Meta-descriptions (review, close, read files)
      // Matches: "Read files:", "Review:", "Close:", "Stage 1", "Stage 2"
      if (/^(?:Read files|Review|Close|Store|Prompt|Stage \d+):/i.test(text)) {
        return false;
      }

      // Rule 6: Summary/analysis markers
      // Matches: "detected", "extracted from", "identified as", "found in"
      if (/detected|extracted from|identified as|found in|contained|consisted of/i.test(text)) {
        return false;
      }

      // Rule 7: Example/illustration markers
      // Matches: "Example:", "E.g.", "For instance:", "Like:", "Such as:"
      if (/^(?:E\.?xample|E\.?g\.?|For instance|Like|Such as):|^(?:This|That|Which) (?:is an?|was an?) /i.test(text)) {
        return false;
      }

      // Rule 8: Code file paths in isolation (not action items)
      // Matches: "src/agent/loop.ts", "src/ui/chat-ui.ts" (no action verb)
      if (/^(?:src\/|[a-zA-Z]:\\|\.\/).+\.(?:ts|js|py|json|md|txt)$/i.test(text) &&
          !/^(?:create|update|modify|fix|add|remove|delete|implement|build)/i.test(text)) {
        return false;
      }

      // Rule 9: Explanations of system behavior
      // Matches: "Requires file verification", "Prompts: LLM", "Stores them as"
      if (/^(?:Requires|Prompts|Stores|Validates|Enforces|Ensures|Prevents|Allows|Enables)/i.test(text)) {
        return false;
      }

      // Include only if it looks like actionable work
      return true;
    });
  }

  /**
   * Store detected tracking items in memory (called after analysis)
   * NOW WITH PRE-VALIDATION - filters out obvious false positives before storage
   */
  storeDetectedItems(items: TrackingItem[], extractedFrom: string): void {
    if (!this.memoryStore) return;

    // Filter out obvious non-work items before storage
    const validItems = this.filterObviousNonWork(items);

    if (validItems.length < items.length) {
      // Log filtered items for debugging
      const filteredCount = items.length - validItems.length;
      // Note: Can't use chalk here as this module imports it but may be used in non-terminal context
      // Use console.warn instead
      console.warn(`[Tracking] Filtered ${filteredCount} non-work items (${validItems.length}/${items.length} kept)`);
    }

    for (const item of validItems) {
      this.memoryStore.addTrackingItem({
        description: item.description,
        status: 'open',
        priority: (item.priority || 'medium') as any,
        extractedFrom,
      });
    }
  }

  /**
   * Analyze a message for incomplete work
   */
  analyze(message: string, hasTrackingItemsInMemory: boolean = false): DetectionResult {
    const result: DetectionResult = {
      isIncomplete: false,
      reason: '',
      trackingItems: [],
      completionPhrases: [],
      remainingPhrases: [],
    };

    const trackingItems = this.extractTrackingItems(message);
    const isCompletion = this.isCompletionMessage(message);
    const hasRemaining = this.hasRemainingWork(message);
    const askingPermission = this.isAskingPermission(message);

    // Check which completion phrases were found
    if (isCompletion) {
      const lowerMessage = message.toLowerCase();
      result.completionPhrases = IncompleteWorkDetector.COMPLETION_PHRASES.filter(phrase =>
        new RegExp(phrase, 'i').test(lowerMessage)
      );
    }

    // Check which remaining phrases were found
    if (hasRemaining) {
      const lowerMessage = message.toLowerCase();
      result.remainingPhrases = IncompleteWorkDetector.REMAINING_PHRASES.filter(phrase =>
        new RegExp(phrase, 'i').test(lowerMessage)
      );
    }

    // NEW: Check if asking permission when task already grants it
    if (askingPermission) {
      const permissionCheck = this.checkPermissionFromTask(message);
      result.askingPermission = true;
      result.permissionAlreadyGranted = permissionCheck.granted;
      result.currentTask = permissionCheck.taskDescription;

      if (permissionCheck.granted) {
        result.isIncomplete = true;
        result.reason = 'Agent is asking for permission when current task already authorizes the action';
      }
    }

    // Case 1: LLM says it's done but has tracking items in message
    if (isCompletion && trackingItems.length > 0) {
      result.isIncomplete = true;
      result.reason = `Agent said "done" but listed ${trackingItems.length} items to complete`;
      result.trackingItems = trackingItems;
    }

    // Case 2: LLM says it's done but there are tracking items in memory
    if (isCompletion && hasTrackingItemsInMemory) {
      result.isIncomplete = true;
      result.reason = 'Agent said "done" but there are pending tracking items in memory';
    }

    // Case 3: LLM mentions remaining work (even if not saying "done")
    if (hasRemaining && trackingItems.length > 0) {
      result.isIncomplete = true;
      result.reason = 'Agent explicitly mentioned remaining or incomplete work';
      result.trackingItems = trackingItems;
    }

    return result;
  }

  /**
   * Generate prompt to add items to task list (console output)
   */
  generatePrompt(result: DetectionResult): string {
    if (!result.isIncomplete) {
      return '';
    }

    let prompt = '\n';

    // NEW: Handle permission requests when task already authorizes action
    if (result.askingPermission && result.permissionAlreadyGranted && result.currentTask) {
      prompt += chalk.yellow.bold('⚠️  You are asking for permission, but...\n\n');
      prompt += chalk.white('🎯 Your current task is: ') + chalk.cyan.bold(result.currentTask) + '\n\n';
      prompt += chalk.green.bold('✅ This task already authorizes the action you are asking about.\n\n');
      prompt += chalk.green('💡 For autonomous operation:\n');
      prompt += chalk.dim('   Review your current task and proceed with actions it already covers.\n');
      prompt += chalk.dim('   Only ask for permission when doing something outside your task scope.\n');
      prompt += chalk.dim('   This enables multi-day autonomous coding without user intervention.\n\n');
      return prompt;
    }

    if (result.completionPhrases.length > 0) {
      prompt += chalk.yellow('⚠️  You mentioned the work is ');
      prompt += chalk.yellow.bold(result.completionPhrases[0]);
      prompt += chalk.yellow(', but...\n\n');
    } else {
      prompt += chalk.yellow('⚠️  Incomplete work detected:\n\n');
    }

    prompt += chalk.white(result.reason + '\n\n');

    if (result.trackingItems.length > 0) {
      prompt += chalk.cyan('📋 Items that should be added to task list:\n');
      result.trackingItems.forEach((item, index) => {
        const priorityColor = item.priority === 'high' ? 'red' :
                            item.priority === 'medium' ? 'yellow' : 'white';
        const priorityLabel = item.priority ? `[${item.priority.toUpperCase()}]` : '';
        prompt += chalk.dim(`   ${index + 1}. `) +
                  chalk[priorityColor](priorityLabel) +
                  chalk.white(` ${item.description}\n`);
      });
      prompt += '\n';
    }

    prompt += chalk.green('💡 Suggestion:\n');
    prompt += chalk.dim('   Use the task management tools to add these items and track progress.\n');
    prompt += chalk.dim("   This ensures work doesn't get left half-done.\n\n");

    return prompt;
  }

  /**
   * Generate plain text summary for LLM consumption (no chalk formatting)
   */
  generateLLMMessage(result: DetectionResult): string {
    if (!result.isIncomplete) {
      return '';
    }

    let message = '';

    if (result.completionPhrases.length > 0) {
      message += `You mentioned the work is "${result.completionPhrases[0]}", but `;
    } else {
      message += 'Incomplete work detected: ';
    }

    message += result.reason + '\n\n';

    if (result.trackingItems.length > 0) {
      message += 'Potential tracking items:\n';
      result.trackingItems.forEach((item, index) => {
        const priorityLabel = item.priority ? `[${item.priority.toUpperCase()}] ` : '';
        message += `${index + 1}. ${priorityLabel}${item.description}\n`;
      });
    }

    return message.trim();
  }

  /**
   * Infer priority from item text
   */
  private inferPriority(text: string): 'high' | 'medium' | 'low' {
    const lowerText = text.toLowerCase();

    const highPriorityKeywords = [
      'critical', 'urgent', 'important', 'fix', 'bug', 'error',
      'security', 'must', 'immediately', 'asap', 'priority',
      'blocking', 'blocker',
    ];

    const mediumPriorityKeywords = [
      'implement', 'add', 'create', 'update', 'improve', 'enhance',
      'refactor', 'should', 'need to', 'next', 'then',
    ];

    if (highPriorityKeywords.some(k => lowerText.includes(k))) {
      return 'high';
    }

    if (mediumPriorityKeywords.some(k => lowerText.includes(k))) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Check if the LLM response contains tools or is just a plain response
   */
  isToolFreeResponse(message: ChatMessage): boolean {
    // Check if there are no tool calls
    return !message.toolCalls || message.toolCalls.length === 0;
  }
}
