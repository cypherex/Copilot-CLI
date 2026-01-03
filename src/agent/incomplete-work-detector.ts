import { ChatMessage, LLMClient } from '../llm/types.js';
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
  private llmClient?: LLMClient;

  constructor(memoryStore?: MemoryStore, llmClient?: LLMClient) {
    this.memoryStore = memoryStore;
    this.llmClient = llmClient;
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
    /(?:^|\n)\s*TODO:\s*(.+)/gi,     // TODO: prefix
    /(?:^|\n)\s*\[\s*\]\s*(.+)/g,    // [ ] checkboxes
    /(?:^|\n)\s*\[[ xX]\]\s*(.+)/g,  // [x] or [X] checked boxes
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
   * Filter out non-work items using LLM-based batch validation
   * This intelligently identifies documentation, capability descriptions, explanations, etc.
   */
  private async filterNonWorkWithLLM(items: TrackingItem[]): Promise<TrackingItem[]> {
    // If no LLM client available, fall back to keeping all items (conservative approach)
    if (!this.llmClient || items.length === 0) {
      return items;
    }

    try {
      // Create a numbered list for the LLM to evaluate
      const itemsList = items.map((item, index) => `${index + 1}. ${item.description}`).join('\n');

      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: `You are a task classification expert. Analyze each item in the list and determine if it represents ACTUAL INCOMPLETE WORK that should be tracked.

INCOMPLETE WORK includes:
- Specific implementation tasks (e.g., "Add error handling to API endpoint")
- Bug fixes (e.g., "Fix login validation")
- Features to implement (e.g., "Implement dark mode toggle")
- Tests to write (e.g., "Write unit tests for auth module")
- Refactoring tasks (e.g., "Refactor database queries")
- Configuration/setup tasks (e.g., "Configure CI/CD pipeline")

NOT INCOMPLETE WORK (filter these out):
- Capability descriptions (e.g., "Read and create files", "Run shell commands")
- Tool/feature listings (e.g., "Execute Python scripts", "Spawn parallel subagents")
- Documentation references (e.g., "Documentation", "Examples", "File references")
- Explanatory text (e.g., "The reason is...", "This indicates...")
- Metadata (e.g., "User preferences: tooling/editor: Neovim")
- Section headers (e.g., "Examples", "Explanations")
- Filler phrases (e.g., "And more!", "Or anything else!")
- System behavior descriptions (e.g., "Validates input", "Stores data")
- File paths alone without action verbs (e.g., "src/agent/loop.ts")

Return a JSON array with one boolean for each item (true = track as work, false = filter out).
Example: [true, false, true, false]

IMPORTANT: Only return the JSON array, nothing else.`,
        },
        {
          role: 'user',
          content: `Classify these items:\n\n${itemsList}`,
        },
      ]);

      const responseContent = response.choices[0]?.message?.content?.trim();
      if (!responseContent) {
        console.warn('[Tracking] LLM returned empty response, keeping all items');
        return items;
      }

      // Parse the JSON array
      let classifications: boolean[];
      try {
        classifications = JSON.parse(responseContent);
      } catch (parseError) {
        console.warn('[Tracking] Failed to parse LLM response, keeping all items:', responseContent);
        return items;
      }

      // Validate the response
      if (!Array.isArray(classifications) || classifications.length !== items.length) {
        console.warn(
          `[Tracking] LLM returned invalid array (expected ${items.length}, got ${classifications?.length}), keeping all items`
        );
        return items;
      }

      // Filter items based on LLM classifications
      const filteredItems = items.filter((item, index) => classifications[index] === true);

      if (filteredItems.length < items.length) {
        const filteredCount = items.length - filteredItems.length;
        console.log(
          `[Tracking] LLM filtered ${filteredCount} non-work items (${filteredItems.length}/${items.length} kept)`
        );
      }

      return filteredItems;
    } catch (error) {
      console.warn('[Tracking] Error during LLM filtering, keeping all items:', error);
      return items;
    }
  }

  /**
   * Store detected tracking items in memory (called after analysis)
   * Uses LLM-based filtering to remove false positives before storage
   */
  async storeDetectedItems(items: TrackingItem[], extractedFrom: string): Promise<void> {
    if (!this.memoryStore) return;

    // Filter out non-work items using LLM
    const validItems = await this.filterNonWorkWithLLM(items);

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
