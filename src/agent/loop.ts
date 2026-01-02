// Main agentic loop
//
// MANDATORY DELEGATION SYSTEM:
// When a subagent opportunity is detected with mandatory=true, the agent MUST delegate
// the task to a subagent and not attempt it directly. This is enforced for:
// - High priority patterns (parallel processing, investigation, debugging)
// - Tasks requiring specialized handling or parallel execution
//
// Non-mandatory opportunities are presented as suggestions that the agent may consider.

import chalk from 'chalk';
import ora from 'ora';
import type { LLMClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';
import type { HookRegistry } from '../hooks/registry.js';
import { CompletionTracker } from '../audit/index.js';
import { detectSubagentOpportunity, buildSubagentHint } from './subagent-detector.js';
import { getRole } from './subagent-roles.js';
import { PlanningValidator, buildSubagentReminder } from './planning-validator.js';
import { TaskBarRenderer } from '../ui/task-bar.js';
import { ProactiveContextMonitor } from './proactive-context-monitor.js';
import { IncompleteWorkDetector } from './incomplete-work-detector.js';
import { FileRelationshipTracker } from './file-relationship-tracker.js';
import { WorkContinuityManager } from './work-continuity-manager.js';
import type { MemoryStore } from '../memory/types.js';

export class AgenticLoop {
  private maxIterations: number | null = 10;
  private hookRegistry?: HookRegistry;
  private completionTracker?: CompletionTracker;
  private planningValidator?: PlanningValidator;
  private taskBarRenderer?: TaskBarRenderer;
  private proactiveContextMonitor?: ProactiveContextMonitor;
  private incompleteWorkDetector?: IncompleteWorkDetector;
  private fileRelationshipTracker?: FileRelationshipTracker;
  private workContinuityManager?: WorkContinuityManager;
  private responseCounter = 0;
  private currentSubagentOpportunity?: ReturnType<typeof detectSubagentOpportunity>;

  // Loop breaker state - prevents infinite validation loops
  private consecutiveIdenticalDetections = 0;
  private lastDetectionHash = '';
  private readonly LOOP_BREAKER_THRESHOLD = 3;

  constructor(
    private llmClient: LLMClient,
    private toolRegistry: ToolRegistry,
    private conversation: ConversationManager
  ) {}

  setMaxIterations(max: number | null): void {
    this.maxIterations = max;
  }

  setHookRegistry(hookRegistry: HookRegistry): void {
    this.hookRegistry = hookRegistry;
  }

  setCompletionTracker(tracker: CompletionTracker): void {
    this.completionTracker = tracker;
  }

  setPlanningValidator(validator: PlanningValidator): void {
    this.planningValidator = validator;
  }

  setTaskBarRenderer(renderer: TaskBarRenderer): void {
    this.taskBarRenderer = renderer;
  }

  setMemoryStore(memoryStore: MemoryStore): void {
    // For task bar updates
  }

  setProactiveContextMonitor(monitor: ProactiveContextMonitor): void {
    this.proactiveContextMonitor = monitor;
  }

  setIncompleteWorkDetector(detector: IncompleteWorkDetector): void {
    this.incompleteWorkDetector = detector;
  }

  setFileRelationshipTracker(tracker: FileRelationshipTracker): void {
    this.fileRelationshipTracker = tracker;
  }

  setWorkContinuityManager(manager: WorkContinuityManager): void {
    this.workContinuityManager = manager;
  }

  async processUserMessage(userMessage: string): Promise<void> {
    // Check for session resume and display continuity info
    if (this.workContinuityManager && this.workContinuityManager.isSessionResume()) {
      this.workContinuityManager.displaySessionResume();
    }

    // Track if any file modifications occurred during this user message processing
    let hadFileModifications = false;

    // Execute user:prompt-submit hook
    let messageToProcess = userMessage;
    if (this.hookRegistry) {
      const promptResult = await this.hookRegistry.execute('user:prompt-submit', {
        userMessage,
      });
      if (!promptResult.continue) {
        console.log(chalk.yellow('Message processing cancelled by hook.'));
        return;
      }
      if (promptResult.modifiedMessage) {
        messageToProcess = promptResult.modifiedMessage;
      }
    }

    // Detect subagent opportunities on first iteration
    this.currentSubagentOpportunity = detectSubagentOpportunity(messageToProcess);
    if (this.currentSubagentOpportunity && this.currentSubagentOpportunity.shouldSpawn) {
      const opportunity = this.currentSubagentOpportunity;
      const isMandatory = opportunity.mandatory === true;
      
      // Get role name if roleId exists
      const roleName = opportunity.roleId ? getRole(opportunity.roleId)?.name : 'General Subagent';
      
      if (isMandatory) {
        // MANDATORY delegation - use warning style with different color
        console.log(chalk.yellow.bold('\n⚠️ [WARNING] MANDATORY DELEGATION'));
        console.log(chalk.yellow('   ' + roleName));
        console.log(chalk.yellow('   ' + opportunity.reason));
        console.log(chalk.yellow('   Priority: ' + opportunity.priority));
        if (opportunity.taskCount && opportunity.taskCount > 1) {
          console.log(chalk.yellow('   Detected Tasks: ' + opportunity.taskCount));
        }
        console.log(chalk.yellow('   ⚠️ YOU MUST delegate this task to a subagent'));
      } else {
        // Suggestion mode - use gray color
        console.log(chalk.gray('\n💡 Suggestion: ' + roleName));
        console.log(chalk.gray('   ' + opportunity.reason));
        console.log(chalk.gray('   Priority: ' + opportunity.priority));
        if (opportunity.taskCount && opportunity.taskCount > 1) {
          console.log(chalk.gray('   Detected Tasks: ' + opportunity.taskCount));
        }
      }
    }

    // Validate planning before proceeding
    if (this.planningValidator) {
      // Detect if this is a read-only operation (query) vs write operation (task)
      const isReadOnly = this.planningValidator.isReadOnlyOperation(messageToProcess);
      const validation = this.planningValidator.validate(!isReadOnly); // Skip requirements for read-only

      if (!validation.canProceed) {
        this.planningValidator.displayValidation(validation);

        // Add validation result to conversation for context, but DON'T block the agent
        // The agent needs to be able to respond to CREATE tasks
        const validationMessage = `[Planning Validation Required]\n${validation.reason}\n\nSuggestions:\n${validation.suggestions?.join('\n') || ''}`;
        this.conversation.addUserMessage(messageToProcess + '\n\n' + validationMessage);
        // Don't return early - let the agent respond and create tasks!
      } else if (validation.suggestions && validation.suggestions.length > 0) {
        // Validation passed but has suggestions (e.g., complex task should be broken down)
        // Inject suggestions so LLM is aware
        const suggestionsMessage = `[Planning Suggestions]\n${validation.suggestions.join('\n')}`;
        this.conversation.addUserMessage(messageToProcess + '\n\n' + suggestionsMessage);
      } else {
        this.conversation.addUserMessage(messageToProcess);
      }

      // Inject planning reminders into system message
      const planningReminders = this.planningValidator.buildPlanningReminders();
      if (planningReminders) {
        // We'll inject this before the LLM call
      }
    } else {
      this.conversation.addUserMessage(messageToProcess);
    }

    // Check context usage proactively and warn if approaching limits
    if (this.proactiveContextMonitor) {
      const warned = this.proactiveContextMonitor.checkAndWarn();
      if (!warned && this.proactiveContextMonitor.shouldPromptSummary()) {
        this.proactiveContextMonitor.displaySummaryPrompt();
      }
    }

    let iteration = 0;
    let continueLoop = true;
    const ITERATION_DELAY_MS = 35; // Minimal delay to prevent API rate limiting

    while (continueLoop && (this.maxIterations === null || iteration < this.maxIterations)) {
      iteration++;

      // Enforce delay between iterations to prevent API rate limiting
      if (iteration > 1) {
        await new Promise(resolve => setTimeout(resolve, ITERATION_DELAY_MS));
      }

      // Execute agent:iteration hook
      if (this.hookRegistry) {
        const iterationResult = await this.hookRegistry.execute('agent:iteration', {
          iteration,
          maxIterations: this.maxIterations ?? Infinity,
        });
        if (!iterationResult.continue) {
          console.log(chalk.yellow('Iteration cancelled by hook.'));
          break;
        }
      }

      const tools = this.toolRegistry.getDefinitions();
      let spinner: ReturnType<typeof ora> | null = ora('Thinking...').start();
      const accumulator = new StreamAccumulator();
      const startTime = Date.now();
      let hasStartedStreaming = false;

      // Build messages with optional scaffolding reminder and subagent hint
      let messages = this.conversation.getMessages();

      // Inject scaffolding reminder on first iteration
      const scaffoldingContext = this.completionTracker?.buildContextInjection();
      if (scaffoldingContext && iteration === 1) {
        // Inject reminder as a system message before the latest user message
        messages = [
          ...messages.slice(0, -1),
          { role: 'system' as const, content: scaffoldingContext },
          messages[messages.length - 1],
        ];
      }

      // Inject subagent hint on first iteration if opportunity detected
      if (this.currentSubagentOpportunity && iteration === 1) {
        const hint = buildSubagentHint(this.currentSubagentOpportunity);
        // Inject hint as a system message before the latest user message
        messages = [
          ...messages.slice(0, -1),
          { role: 'system' as const, content: hint },
          messages[messages.length - 1],
        ];
      }

      // Inject planning reminders on first iteration
      if (this.planningValidator && iteration === 1) {
        const planningReminders = this.planningValidator.buildPlanningReminders();
        if (planningReminders) {
          messages = [
            ...messages.slice(0, -1),
            { role: 'system' as const, content: planningReminders },
            messages[messages.length - 1],
          ];
        }
      }

      // Inject subagent usage reminder occasionally
      const subagentReminder = buildSubagentReminder(iteration);
      if (subagentReminder) {
        messages = [
          ...messages.slice(0, -1),
          { role: 'system' as const, content: subagentReminder },
          messages[messages.length - 1],
        ];
      }

      try {
        let hasToolCalls = false;
        let currentContent = '';

        for await (const chunk of this.llmClient.chatStream(
          messages,
          tools
        )) {
          if (chunk.delta.content) {
            currentContent += chunk.delta.content;

            // Check if we should start streaming (after 500ms or when we have content)
            const elapsed = Date.now() - startTime;
            if (!hasStartedStreaming && elapsed >= 500) {
              // Stop spinner and enable streaming
              spinner?.stop();
              spinner = null;
              accumulator.enableStreaming();
              hasStartedStreaming = true;
            } else if (hasStartedStreaming) {
              // Update streaming display in real-time
              accumulator.updateStreamingDisplay();
            } else if (!hasToolCalls && spinner) {
              // Still showing spinner, update preview
              spinner.text = chalk.gray(
                currentContent.slice(0, 60) + (currentContent.length > 60 ? '...' : '')
              );
            }
          }

          accumulator.addChunk(chunk);

          if (chunk.delta.toolCalls) {
            hasToolCalls = true;
            if (spinner) {
              spinner.text = 'Executing tools...';
            }
          }
        }

        // Stop spinner if still running
        if (spinner) {
          spinner.stop();
          spinner = null;
        }

        // Finalize streaming if enabled
        if (hasStartedStreaming) {
          accumulator.finalizeStreaming();
        }

        const response = accumulator.getResponse();

        // If we didn't stream (tool-only response or very fast), display now
        if (response.content && !hasStartedStreaming) {
          console.log(chalk.cyan('\nAssistant:'));
          console.log(response.content);
          console.log();
        } else if (!response.content && hasStartedStreaming) {
          // Ensure proper newline even if no content
          console.log();
        }

        // Update task bar after response
        this.updateTaskBar();

        // Execute assistant:response hook
        if (this.hookRegistry) {
          const responseResult = await this.hookRegistry.execute('assistant:response', {
            assistantMessage: response.content,
            hasToolCalls: !!(response.toolCalls && response.toolCalls.length > 0),
          });

          // Handle injected user message (used by Ralph Wiggum loop)
          if (responseResult.metadata?.injectUserMessage && !response.toolCalls?.length) {
            this.conversation.addAssistantMessage(response.content || '');
            this.conversation.addUserMessage(responseResult.metadata.injectUserMessage);
            continueLoop = true;
            continue;
          }
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          this.conversation.addAssistantMessage(response.content || '', response.toolCalls);

          // Check if any file modification tools were called
          const fileModificationTools = ['create_file', 'patch_file'];
          const hasFileModifications = response.toolCalls.some(tc =>
            fileModificationTools.includes(tc.function.name)
          );
          if (hasFileModifications) {
            hadFileModifications = true;
          }

          await this.executeTools(response.toolCalls);
          continueLoop = true;
        } else {
          this.conversation.addAssistantMessage(response.content || '');
          continueLoop = false;

          // Detect incomplete work - if LLM says it's done but left things undone
          if (this.incompleteWorkDetector && response.content) {
            const isToolFree = this.incompleteWorkDetector.isToolFreeResponse({
              role: 'assistant',
              content: response.content,
              toolCalls: response.toolCalls || []
            });
            const hasTrackingItems = (this.completionTracker?.getIncomplete().length || 0) > 0;
            const detection = this.incompleteWorkDetector.analyze(
              response.content,
              hasTrackingItems
            );

            // AUTO-PROCEED: When agent asks permission for task-authorized action
            if (detection.askingPermission && detection.permissionAlreadyGranted && detection.currentTask) {
              const prompt = this.incompleteWorkDetector.generatePrompt(detection);
              console.log(prompt);

              // Inject decision directly into conversation
              const autoDecision = `Your task is "${detection.currentTask}". This already authorizes the action you're asking about. Proceed with the best option that aligns with your task requirements. Do not wait for user confirmation - make the decision autonomously.`;

              console.log(chalk.green.bold('🤖 Auto-injecting decision to proceed\n'));

              this.conversation.addUserMessage(autoDecision);
              continueLoop = true;
              continue;
            }

            // Check for loop breaker - prevent infinite validation loops
            const detectionHash = `${detection.completionPhrases.join(',')}_${detection.remainingPhrases.join(',')}`;
            if (detectionHash === this.lastDetectionHash) {
              this.consecutiveIdenticalDetections++;
              if (this.consecutiveIdenticalDetections >= this.LOOP_BREAKER_THRESHOLD) {
                // Break the loop - stop asking about the same issue
                console.log(chalk.yellow('\n⚠️ Loop breaker activated - stopping repeated validation\n'));
                continueLoop = false;
                continue;
              }
            } else {
              this.consecutiveIdenticalDetections = 0;
              this.lastDetectionHash = detectionHash;
            }

            // Case 1: LLM says it's done but has tracking items (pre-response check)
            if (isToolFree && detection.completionPhrases.length > 0 && hasTrackingItems) {
              // Show formatted warning to user
              const consolePrompt = this.incompleteWorkDetector.generatePrompt(detection);
              if (consolePrompt) {
                console.log(consolePrompt);
              }

              // Generate LLM-friendly message and ask to review
              const llmMessage = this.incompleteWorkDetector.generateLLMMessage(detection);
              const reviewPrompt = `${llmMessage}\n\nPlease review the items above and determine which ones are actually relevant and should be added to the task list. Use the task management tools to add only the relevant items. Skip any items that are:\n- Already completed\n- Duplicates of existing tasks\n- Not actually needed\n- Outside the current scope\n\nExplain your reasoning briefly for which items you're adding or skipping.`;

              console.log(chalk.green.bold('🤖 Asking LLM to review and filter tracking items\n'));
              this.conversation.addUserMessage(reviewPrompt);
              continueLoop = true;
              continue;
            }

            // Case 2: LLM mentions remaining/incomplete work (post-response check)
            if (detection.remainingPhrases.length > 0 || detection.trackingItems.length > 0) {
              // Show formatted warning to user
              const consolePrompt = this.incompleteWorkDetector.generatePrompt(detection);
              if (consolePrompt) {
                console.log(consolePrompt);
              }

              // Generate LLM-friendly message and ask to review
              const llmMessage = this.incompleteWorkDetector.generateLLMMessage(detection);
              const reviewPrompt = `${llmMessage}\n\nPlease review the tracking items above and determine which ones should be added to the task list. Use the task management tools to add only the relevant items. Skip any items that are:\n- Already completed\n- Duplicates of existing tasks\n- Not actually needed\n- Just informational notes\n\nExplain briefly which items you're adding and why you're skipping others (if any).`;

              console.log(chalk.green.bold('🤖 Asking LLM to review and filter tracking items\n'));
              this.conversation.addUserMessage(reviewPrompt);
              continueLoop = true;
              continue;
            }
          }

          // Track retrieval usefulness if we had retrievals
          const pendingRetrievalIds = this.conversation.getPendingRetrievalIds();
          if (pendingRetrievalIds.length > 0 && response.content) {
            await this.trackRetrievalUsefulness(pendingRetrievalIds, response.content);
          }

          // Audit completed response for incomplete scaffolding - ONLY if files were modified
          if (this.completionTracker && response.content && hadFileModifications) {
            const responseId = `response_${++this.responseCounter}`;
            const auditResult = await this.completionTracker.auditResponse(
              response.content,
              this.conversation.getMessages(),
              responseId
            );

            // Show audit results
            if (auditResult.newItems.length > 0 || auditResult.resolvedItems.length > 0) {
              this.displayAuditResults(auditResult);
            }

            // Force completion if new incomplete items found
            if (auditResult.newItems.length > 0) {
              const itemDescriptions = auditResult.newItems
                .map(item => `- ${item.type} in ${item.file}: ${item.description}`)
                .join('\n');
              const auditPrompt = `\n\nScaffolding audit detected incomplete work:\n${itemDescriptions}\n\nPlease complete these items before finishing.`;

              this.conversation.addUserMessage(auditPrompt);
              continueLoop = true;
              continue;
            }

            // Show debt summary if blocking
            const debt = this.completionTracker.getDebt();
            if (debt.shouldBlock) {
              console.log(chalk.red('\n⛔ Scaffolding debt limit reached. Please complete existing items before adding features.'));
            }
          }
        }
      } catch (error) {
        spinner?.fail('Error communicating with Copilot');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        continueLoop = false;
      }
    }

    if (this.maxIterations !== null && iteration >= this.maxIterations) {
      console.warn(chalk.yellow('\nWarning: Maximum iteration limit reached'));
    }

    await this.conversation.trimHistory();
  }

  private async executeTools(toolCalls: ToolCall[]): Promise<void> {
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let toolArgs: Record<string, any>;

      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        toolArgs = {};
      }

      // Execute tool:pre-execute hook
      if (this.hookRegistry) {
        const preResult = await this.hookRegistry.execute('tool:pre-execute', {
          toolName,
          toolArgs,
        });
        if (!preResult.continue) {
          console.log(chalk.yellow(`Tool execution cancelled by hook: ${toolName}`));
          this.conversation.addToolResult(toolCall.id, toolName, 'Execution cancelled by hook');
          continue;
        }
        if (preResult.modifiedArgs) {
          toolArgs = preResult.modifiedArgs;
        }
      }

      console.log(chalk.blue(`\n→ Executing: ${toolName}`));

      // Display compact tool arguments
      const argSummary = Object.entries(toolArgs)
        .map(([key, value]) => {
          const strValue = typeof value === 'string' ? value : JSON.stringify(value);
          const truncated = strValue.length > 50 ? strValue.slice(0, 50) + '...' : strValue;
          return `${key}="${truncated}"`;
        })
        .join(', ');
      console.log(chalk.gray('   ' + argSummary));

      // Create spinner for real-time status
      const spinner = ora({ indent: 2, text: toolName }).start();

      let result: { success: boolean; output?: string; error?: string };

      try {
        result = await this.toolRegistry.execute(toolName, toolArgs);

        if (result.success) {
          spinner.succeed(chalk.green(toolName));
          if (result.output) {
            console.log(chalk.gray(result.output.slice(0, 500) + (result.output.length > 500 ? '...' : '')));
          }
          this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');

          // Track file reads in memory
          if (toolName === 'read_file' && toolArgs.path) {
            this.conversation.trackFileRead(toolArgs.path, 'Read by tool');
          }

          // Track file edits in memory
          this.trackFileEdit(toolName, toolArgs);
        } else {
          spinner.fail(chalk.red(toolName));
          console.log(chalk.red(result.error));
          this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        spinner.fail(chalk.red(toolName));
        console.log(chalk.red(errorMessage));
        this.conversation.addToolResult(toolCall.id, toolName, `Error: ${errorMessage}`);
        result = { success: false, error: errorMessage };
      }

      // Execute tool:post-execute hook
      if (this.hookRegistry) {
        await this.hookRegistry.execute('tool:post-execute', {
          toolName,
          toolArgs,
          toolResult: result,
        });
      }

      // Update task bar after tool execution
      this.updateTaskBar();
    }

    console.log();
  }

  private trackFileEdit(toolName: string, toolArgs: Record<string, any>): void {
    try {
      const memoryStore = this.conversation.getMemoryStore();
      const activeTask = memoryStore.getActiveTask();
      let editedFile: string | undefined;

      if (toolName === 'create_file') {
        editedFile = toolArgs.path;
        memoryStore.addEditRecord({
          file: toolArgs.path || 'unknown',
          description: toolArgs.overwrite ? 'Overwrote file' : 'Created new file',
          changeType: toolArgs.overwrite ? 'modify' : 'create',
          afterSnippet: toolArgs.content?.slice(0, 200),
          relatedTaskId: activeTask?.id,
        });
        memoryStore.addActiveFile({
          path: toolArgs.path,
          purpose: 'Created in session',
        });

        // Track file relationship
        if (this.fileRelationshipTracker && editedFile) {
          this.fileRelationshipTracker.trackFileAccess(editedFile, true);
        }
      } else if (toolName === 'patch_file') {
        editedFile = toolArgs.path;
        memoryStore.addEditRecord({
          file: toolArgs.path || 'unknown',
          description: `Replaced: ${toolArgs.search?.slice(0, 50)}...`,
          changeType: 'modify',
          beforeSnippet: toolArgs.search?.slice(0, 100),
          afterSnippet: toolArgs.replace?.slice(0, 100),
          relatedTaskId: activeTask?.id,
        });

        // Track file relationship
        if (this.fileRelationshipTracker && editedFile) {
          this.fileRelationshipTracker.trackFileAccess(editedFile, true);

          // Display prompt if this file has relationships
          if (this.fileRelationshipTracker.shouldPrompt(editedFile)) {
            this.fileRelationshipTracker.displayPrompt(editedFile);
          }
        }
        memoryStore.addActiveFile({
          path: toolArgs.path,
          purpose: 'Modified in session',
        });
      }
    } catch (error) {
      console.log(chalk.gray(`[Memory] Failed to track edit: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private displayAuditResults(auditResult: {
    newItems: { type: string; description: string; file: string }[];
    resolvedItems: { type: string; description: string; file: string }[];
  }): void {
    console.log();

    // Show resolved items first (positive feedback)
    for (const item of auditResult.resolvedItems) {
      console.log(chalk.green(`✓ Resolved: ${item.type} in ${item.file}`));
    }

    // Show new incomplete items
    for (const item of auditResult.newItems) {
      const color = item.type === 'obsolete_code' ? chalk.yellow : chalk.gray;
      const icon = item.type === 'obsolete_code' ? '⚠' : '○';
      console.log(color(`${icon} Tracking: ${item.type} in ${item.file}: ${item.description.slice(0, 60)}`));
    }
  }

  // Get context injection for stale items (call before LLM request)
  getScaffoldingContext(): string | null {
    return this.completionTracker?.buildContextInjection() ?? null;
  }

  // Get debt summary for status display
  getDebtSummary(): string | null {
    if (!this.completionTracker) return null;
    const debt = this.completionTracker.getDebt();
    if (debt.critical.length === 0 && debt.stale.length === 0) return null;
    return this.completionTracker.formatDebtDisplay();
  }

  // Update task bar display
  private updateTaskBar(): void {
    if (!this.taskBarRenderer) return;

    try {
      const memoryStore = this.conversation.getMemoryStore();
      const currentTask = memoryStore.getActiveTask();
      const allTasks = memoryStore.getTasks();

      const taskBar = this.taskBarRenderer.renderCompact(currentTask, allTasks);
      if (taskBar) {
        // Use process.stdout.write to avoid newline
        process.stdout.write('\r' + ' '.repeat(100) + '\r' + taskBar);
      }
    } catch (error) {
      // Silently fail to avoid disrupting the flow
    }
  }

  // Track if retrieved context was useful (heuristic-based)
  private async trackRetrievalUsefulness(
    retrievalIds: string[],
    assistantResponse: string
  ): Promise<void> {
    const store = this.conversation.getMemoryStore();
    const history = store.getRetrievalHistory();

    for (const id of retrievalIds) {
      const retrieval = history.find(r => r.id === id);
      if (retrieval && retrieval.injectedContent) {
        // Simple heuristic: did the response use any of the retrieval keywords?
        const keywords = retrieval.backwardReference.searchQuery.toLowerCase().split(/\s+/);
        const responseWords = assistantResponse.toLowerCase();
        const wasUsed = keywords.some(k => k.length > 3 && responseWords.includes(k));
        store.markRetrievalUseful(id, wasUsed);
      }
    }
  }
}
