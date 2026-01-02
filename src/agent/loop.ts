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
import { PlanningValidator, buildSubagentReminder, buildParallelExecutionReminder } from './planning-validator.js';
import { TaskBarRenderer } from '../ui/task-bar.js';
import { ProactiveContextMonitor } from './proactive-context-monitor.js';
import { IncompleteWorkDetector } from './incomplete-work-detector.js';
import { FileRelationshipTracker } from './file-relationship-tracker.js';
import { WorkContinuityManager } from './work-continuity-manager.js';
import type { MemoryStore } from '../memory/types.js';
import { ToolCallRenderer } from '../ui/tool-call-renderer.js';
import { errorFormatter } from '../ui/error-formatter.js';
import { BOX_CHARS } from '../ui/box-drawer.js';
import type { ChatUI } from '../ui/chat-ui.js';

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
  private memoryStore?: MemoryStore;
  private chatUI?: ChatUI;
  private responseCounter = 0;
  private currentSubagentOpportunity?: ReturnType<typeof detectSubagentOpportunity>;

  // Loop breaker state - prevents infinite validation loops
  private consecutiveIdenticalDetections = 0;
  private lastDetectionHash = '';
  private readonly LOOP_BREAKER_THRESHOLD = 3;

  // Track if we just asked LLM to review tracking items (to avoid re-parsing the review response)
  private justAskedToReviewTrackingItems = false;

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
    this.memoryStore = memoryStore;
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

  setChatUI(chatUI: ChatUI): void {
    this.chatUI = chatUI;
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

      // Check for queued user messages (split-screen mode)
      // This allows users to send messages while the agent is working
      if (this.chatUI?.hasQueuedMessages()) {
        const nextMessage = this.chatUI.pollQueuedMessage();
        if (nextMessage) {
          console.log(chalk.blue('\n📨 New message received while working:\n'));
          console.log(chalk.green('You: ') + nextMessage);
          console.log();

          // Add the new message to conversation
          this.conversation.addUserMessage(nextMessage);

          // Reset iteration counter to give fresh attempts for new message
          iteration = 0;

          // Continue loop to process the new message
          continueLoop = true;
          continue;
        }
      }

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

      // Remove old parallel execution reminders before injecting new one
      messages = messages.filter(msg =>
        !(msg.role === 'system' && typeof msg.content === 'string' && msg.content.includes('[⚡ Parallel Execution Reminder]'))
      );

      // Inject parallel execution reminder frequently (every 2 iterations)
      const parallelReminder = buildParallelExecutionReminder(iteration);
      if (parallelReminder) {
        messages = [
          ...messages.slice(0, -1),
          { role: 'system' as const, content: parallelReminder },
          messages[messages.length - 1],
        ];
      }

      // Remove old subagent reminders before injecting new one
      messages = messages.filter(msg =>
        !(msg.role === 'system' && typeof msg.content === 'string' && msg.content.includes('[Subagent Reminder]'))
      );

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

          // Check if we need compression before ending the loop
          const contextManager = this.conversation.getContextManager();
          contextManager.updateUsage(this.conversation.getMessages());
          const needsCompression = contextManager.needsCompression();

          if (needsCompression) {
            // Compression will happen, continue loop after compression
            await this.conversation.trimHistory();
            console.log(chalk.cyan('\n💾 Context compressed - continuing work...\n'));
            continueLoop = true;
            continue;
          }

          continueLoop = false;

          // Detect incomplete work - if LLM says it's done but left things undone
          if (this.incompleteWorkDetector && response.content) {
            // Skip detection if we just asked LLM to review tracking items
            // (prevents re-parsing the LLM's explanation as new tracking items)
            if (this.justAskedToReviewTrackingItems) {
              // Only reset flag when review is complete:
              // 1. All tracking items are closed, OR
              // 2. LLM made tool-free response (finished using tracking item tools)
              const openItems = this.memoryStore?.getTrackingItems('open') || [];
              const isStillWorkingOnReview = response.toolCalls?.some(tc =>
                ['list_tracking_items', 'review_tracking_item', 'close_tracking_item'].includes(tc.function.name)
              );

              if (openItems.length === 0 || (!isStillWorkingOnReview && !response.toolCalls?.length)) {
                console.log(chalk.dim('⏭️  Tracking item review complete - resuming detection\n'));
                this.justAskedToReviewTrackingItems = false;
              } else {
                console.log(chalk.dim('⏭️  Skipping detection - LLM is still reviewing tracking items\n'));
              }
              // Continue with normal flow (don't re-detect while flag is true)
            } else {
              const isToolFree = this.incompleteWorkDetector.isToolFreeResponse({
                role: 'assistant',
                content: response.content,
                toolCalls: response.toolCalls || []
              });
              // Check for open tracking items in memory
              const openTrackingItems = this.memoryStore?.getTrackingItems('open') || [];
              const hasTrackingItems = openTrackingItems.length > 0;
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

              // Generate LLM-friendly message and ask to review using tracking item tools
              const reviewPrompt = `⚠️ You said the work is complete, but there are pending tracking items that need review.

Use list_tracking_items to see all open items, then for each item:

1. **READ FILES FIRST** - Use read_file to examine relevant files
2. **Move to review** - Call review_tracking_item with:
   - item_id: the tracking item ID
   - files_to_verify: paths of files you READ (required!)
   - initial_assessment: your assessment after reading

3. **Make decision**:
   - If INCOMPLETE: Call create_task to add to task list, then close_tracking_item with reason='added-to-tasks' and the new task_id
   - If COMPLETE: Call close_tracking_item with reason='completed' and file evidence
   - If NOT NEEDED: Call close_tracking_item with reason='duplicate'/'not-needed'/'out-of-scope' and explanation

CRITICAL: You MUST read actual files to verify completion - no guessing! The review_tracking_item tool enforces this by requiring file paths.

Start by calling list_tracking_items with status='open' to see what needs review.`;

              console.log(chalk.green.bold('🤖 Asking LLM to review tracking items with file verification\n'));

              // Set flag to skip detection on next response (prevents re-parsing LLM's explanation)
              this.justAskedToReviewTrackingItems = true;

              this.conversation.addUserMessage(reviewPrompt);
              continueLoop = true;
              continue;
            }

            // Case 2: LLM mentions remaining/incomplete work (post-response check)
            if (detection.remainingPhrases.length > 0 || detection.trackingItems.length > 0) {
              // Store detected items in memory as 'open' tracking items
              if (detection.trackingItems.length > 0) {
                this.incompleteWorkDetector.storeDetectedItems(
                  detection.trackingItems,
                  response.content || 'LLM response'
                );
                console.log(chalk.cyan(`📋 Stored ${detection.trackingItems.length} tracking items in memory\n`));
              }

              // Show formatted warning to user
              const consolePrompt = this.incompleteWorkDetector.generatePrompt(detection);
              if (consolePrompt) {
                console.log(consolePrompt);
              }

              // Generate LLM-friendly message and ask to review using tracking item tools
              const reviewPrompt = `⚠️ You mentioned incomplete or remaining work. These items have been added as tracking items.

Use list_tracking_items with status='open' to see all items that need review, then for each:

1. **READ FILES FIRST** - Use read_file to examine relevant files and verify status
2. **Move to review** - Call review_tracking_item with:
   - item_id: the tracking item ID
   - files_to_verify: paths of files you READ (required - no guessing!)
   - initial_assessment: your findings after reading the files

3. **Make decision based on file evidence**:
   - If INCOMPLETE: Call create_task to add to task list, then close_tracking_item with reason='added-to-tasks' and the task_id
   - If COMPLETE: Call close_tracking_item with reason='completed' and cite specific file evidence
   - If DUPLICATE/NOT-NEEDED: Call close_tracking_item with appropriate reason and explanation

CRITICAL: The review_tracking_item tool REQUIRES file paths - you must read actual files to verify, not guess!

Start with list_tracking_items to see what needs review.`;

              console.log(chalk.green.bold('🤖 Asking LLM to review tracking items with file verification\n'));

              // Set flag to skip detection on next response (prevents re-parsing LLM's explanation)
              this.justAskedToReviewTrackingItems = true;

              this.conversation.addUserMessage(reviewPrompt);
              continueLoop = true;
              continue;
            }
            } // End of detection else block
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
    // Detect if we can run tools in parallel
    const canRunInParallel = toolCalls.length > 1 && this.canExecuteInParallel(toolCalls);

    if (canRunInParallel) {
      await this.executeToolsInParallel(toolCalls);
    } else {
      await this.executeToolsSequential(toolCalls);
    }
  }

  /**
   * Execute tools sequentially with enhanced display
   */
  private async executeToolsSequential(toolCalls: ToolCall[]): Promise<void> {
    const toolCallRenderer = new ToolCallRenderer();

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

      // Render structured tool call
      const toolCallDisplay = toolCallRenderer.renderToolCall({
        id: toolCall.id,
        name: toolName,
        args: toolArgs,
        startTime: Date.now(),
      });
      console.log(toolCallDisplay);

      // Create spinner for execution
      const spinner = ora({ indent: 2, text: `Executing ${toolName}...` }).start();

      let result: { success: boolean; output?: string; error?: string };
      const startTime = Date.now();

      try {
        result = await this.toolRegistry.execute(toolName, toolArgs);
        const duration = Date.now() - startTime;

        spinner.stop();

        // Render structured result
        const resultDisplay = toolCallRenderer.renderToolResult({
          id: toolCall.id,
          name: toolName,
          success: result.success,
          output: result.output,
          error: result.error,
          duration,
        });
        console.log(resultDisplay);

        if (result.success) {
          this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');

          // Track file reads in memory
          if (toolName === 'read_file' && toolArgs.path) {
            this.conversation.trackFileRead(toolArgs.path, 'Read by tool');
          }

          // Track file edits in memory
          this.trackFileEdit(toolName, toolArgs);
        } else {
          // Format error with helpful suggestions
          const formattedError = errorFormatter.formatToolError(
            toolName,
            result.error || 'Unknown error',
            { file: toolArgs.path, args: toolArgs }
          );
          console.log(formattedError);
          this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        spinner.stop();

        // Format error with helpful suggestions
        const formattedError = errorFormatter.formatToolError(
          toolName,
          error instanceof Error ? error : new Error(errorMessage),
          { file: toolArgs.path, args: toolArgs }
        );
        console.log(formattedError);

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

  /**
   * Execute tools in parallel with visual grouping
   */
  private async executeToolsInParallel(toolCalls: ToolCall[]): Promise<void> {
    console.log(chalk.blue(`\nRunning ${toolCalls.length} operations in parallel:\n`));

    const results = await Promise.all(
      toolCalls.map((toolCall, index) => this.executeToolWithBox(toolCall, index, toolCalls.length))
    );

    const maxDuration = Math.max(...results.map(r => r.duration));
    console.log(chalk.green(`\nAll operations completed in ${maxDuration}ms\n`));
  }

  /**
   * Execute a single tool with box-drawing visualization for parallel execution
   */
  private async executeToolWithBox(toolCall: ToolCall, index: number, total: number): Promise<{ duration: number }> {
    const toolName = toolCall.function.name;
    let toolArgs: Record<string, any>;

    try {
      toolArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      toolArgs = {};
    }

    // Determine box character
    const isLast = index === total - 1;
    const connector = isLast ? BOX_CHARS.bottomLeft : BOX_CHARS.verticalRight;

    // Display tool call with box drawing
    const prefix = connector + BOX_CHARS.horizontal + ' ';
    console.log(chalk.dim(prefix) + chalk.cyan(`[${toolName}]`) + ' ' + chalk.gray(JSON.stringify(toolArgs).slice(0, 60)));

    const startTime = Date.now();

    try {
      const result = await this.toolRegistry.execute(toolName, toolArgs);
      const duration = Date.now() - startTime;

      const statusIcon = result.success ? chalk.green('✓') : chalk.red('✗');
      const statusMsg = result.success ? `Completed (${duration}ms)` : `Failed (${duration}ms)`;

      console.log(chalk.dim(BOX_CHARS.vertical + '   ') + statusIcon + ' ' + chalk.gray(statusMsg));

      if (result.success) {
        this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');
        this.trackFileEdit(toolName, toolArgs);
      } else {
        this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
      }

      return { duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.log(chalk.dim(BOX_CHARS.vertical + '   ') + chalk.red('✗') + ' ' + chalk.red(`Error (${duration}ms)`));
      this.conversation.addToolResult(toolCall.id, toolName, `Error: ${errorMessage}`);

      return { duration };
    }
  }

  /**
   * Check if tools can be executed in parallel
   * Returns false if tools have dependencies (e.g., one creates a file that another reads)
   */
  private canExecuteInParallel(toolCalls: ToolCall[]): boolean {
    // Tools that modify state should not run in parallel with tools that depend on that state
    const writeTools = new Set(['create_file', 'patch_file', 'execute_bash']);
    const readTools = new Set(['read_file', 'list_files', 'search_files']);

    let hasWrites = false;
    let hasReads = false;

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      if (writeTools.has(toolName)) hasWrites = true;
      if (readTools.has(toolName)) hasReads = true;
    }

    // If we have both reads and writes, they might be dependent, so run sequentially
    if (hasWrites && hasReads) {
      return false;
    }

    // All tools are reads or all are writes - can run in parallel
    return true;
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
