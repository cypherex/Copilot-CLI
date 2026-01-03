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
import { uiState } from '../ui/ui-state.js';
import type { LLMClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';
import type { HookRegistry } from '../hooks/registry.js';
import { CompletionTracker } from '../audit/index.js';
import { detectSubagentOpportunity, buildSubagentHint } from './subagent-detector.js';
import { getRole } from './subagent-roles.js';
import { PlanningValidator, buildSubagentReminder, buildParallelExecutionReminder } from './planning-validator.js';
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
  private proactiveContextMonitor?: ProactiveContextMonitor;
  private incompleteWorkDetector?: IncompleteWorkDetector;
  private fileRelationshipTracker?: FileRelationshipTracker;
  private workContinuityManager?: WorkContinuityManager;
  private memoryStore?: MemoryStore;
  private subAgentManager?: any; // SubAgentManager - avoid circular dependency
  private responseCounter = 0;
  private currentSubagentOpportunity?: ReturnType<typeof detectSubagentOpportunity>;

  // Message queue for handling user messages during processing
  private queuedMessages: string[] = [];

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

  setSubAgentManager(manager: any): void {
    this.subAgentManager = manager;
  }

  /**
   * Queue a message to be processed during the next iteration
   */
  queueMessage(message: string): void {
    this.queuedMessages.push(message);
  }

  /**
   * Check if there are queued messages
   */
  hasQueuedMessages(): boolean {
    return this.queuedMessages.length > 0;
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
        uiState.addMessage({
          role: 'system',
          content: 'Message processing cancelled by hook.',
          timestamp: Date.now(),
        });
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

      // Send subagent opportunity as system message - UI region will format it
      const lines: string[] = [];
      if (isMandatory) {
        lines.push('[MANDATORY DELEGATION]');
        lines.push(`Role: ${roleName}`);
        lines.push(`Reason: ${opportunity.reason}`);
        lines.push(`Priority: ${opportunity.priority}`);
        if (opportunity.taskCount && opportunity.taskCount > 1) {
          lines.push(`Detected Tasks: ${opportunity.taskCount}`);
        }
        lines.push('YOU MUST delegate this task to a subagent');
      } else {
        lines.push(`[Suggestion] ${roleName}`);
        lines.push(`Reason: ${opportunity.reason}`);
        lines.push(`Priority: ${opportunity.priority}`);
        if (opportunity.taskCount && opportunity.taskCount > 1) {
          lines.push(`Detected Tasks: ${opportunity.taskCount}`);
        }
      }
      uiState.addMessage({
        role: 'system',
        content: lines.join('\n'),
        timestamp: Date.now(),
      });
    }

    // Add user message to conversation and UI
    this.conversation.addUserMessage(messageToProcess);
    uiState.addMessage({
      role: 'user',
      content: messageToProcess,
      timestamp: Date.now(),
    });

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
      if (this.hasQueuedMessages()) {
        const nextMessage = this.queuedMessages.shift();
        if (nextMessage) {
          // Add the new user message via uiState
          uiState.addMessage({
            role: 'user',
            content: nextMessage,
            timestamp: Date.now(),
          });

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
          uiState.addMessage({
            role: 'system',
            content: 'Iteration cancelled by hook.',
            timestamp: Date.now(),
          });
          break;
        }
      }

      const tools = this.toolRegistry.getDefinitions();
      uiState.setAgentStatus('thinking', 'Processing...');

      // Show thinking indicator in conversation
      if (iteration === 1) {
        uiState.addMessage({
          role: 'system',
          content: chalk.dim('🤔 Processing your request...'),
          timestamp: Date.now(),
        });
      }

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
              // Enable streaming output
              accumulator.enableStreaming();
              hasStartedStreaming = true;
            } else if (hasStartedStreaming) {
              // Update streaming display in real-time
              accumulator.updateStreamingDisplay();
            }
          }

          accumulator.addChunk(chunk);

          if (chunk.delta.toolCalls) {
            hasToolCalls = true;
          }
        }

        // Finalize streaming if enabled
        if (hasStartedStreaming) {
          accumulator.finalizeStreaming();
        }

        const response = accumulator.getResponse();

        // If we didn't stream (tool-only response or very fast), add to messages
        if (response.content && !hasStartedStreaming) {
          uiState.addMessage({
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
          });
        }

        // Update status back to idle
        uiState.setAgentStatus('idle');

        // Update tasks from memory store
        this.syncTasksToUIState();

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

          // Validate planning ONLY when LLM attempts write operations
          if (this.planningValidator && this.planningValidator.hasWriteOperationTools(response.toolCalls)) {
            const validation = this.planningValidator.validate(true); // true = write operation

            if (!validation.canProceed) {
              // Check if agent is trying to fix validation with task management tools
              const taskManagementTools = [
                'create_task', 'update_task_status', 'set_current_task',
                'list_tasks', 'list_subtasks', 'break_down_task',
                'review_tracking_item', 'close_tracking_item', 'list_tracking_items'
              ];
              const taskToolCalls = response.toolCalls.filter(tc =>
                taskManagementTools.includes(tc.function.name)
              );

              if (taskToolCalls.length > 0) {
                // Agent is setting up tasks - execute them and let it continue
                await this.executeTools(taskToolCalls);

                // Continue loop to let LLM respond after setting up tasks
                continueLoop = true;
                continue;
              } else {
                // No task management tools - this is a real validation failure
                this.planningValidator.displayValidation(validation);

                // Inject validation message to guide the LLM
                const validationMessage = `[Planning Validation Required]\n${validation.reason}\n\nSuggestions:\n${validation.suggestions?.join('\n') || ''}`;
                this.conversation.addUserMessage(validationMessage);

                // Continue loop to let LLM respond
                continueLoop = true;
                continue;
              }
            } else if (validation.suggestions && validation.suggestions.length > 0) {
              // Validation passed but has suggestions
              uiState.addMessage({
                role: 'system',
                content: `[Planning Suggestions]\n${validation.suggestions.join('\n')}`,
                timestamp: Date.now(),
              });
            }
          }

          await this.executeTools(response.toolCalls);
          continueLoop = true;
        } else {
          this.conversation.addAssistantMessage(response.content || '');

          // Log assistant message to UI/session (important for troubleshooting)
          if (response.content) {
            uiState.addMessage({
              role: 'assistant',
              content: response.content,
              timestamp: Date.now(),
            });
          }

          // Check if we need compression before ending the loop
          const contextManager = this.conversation.getContextManager();
          contextManager.updateUsage(this.conversation.getMessages());
          const needsCompression = contextManager.needsCompression();

          if (needsCompression) {
            // Compression will happen, continue loop after compression
            await this.conversation.trimHistory();
            uiState.addMessage({
              role: 'system',
              content: 'Context compressed - continuing work...',
              timestamp: Date.now(),
            });
            continueLoop = true;
            continue;
          }

          // Check for active background subagents BEFORE ending loop
          if (this.subAgentManager) {
            const activeAgents = this.subAgentManager.listActive();
            if (activeAgents.length > 0) {
              // Agent tried to finish but has background agents still running!
              uiState.addMessage({
                role: 'system',
                content: `⚠️  You have ${activeAgents.length} background subagent(s) still running. You must call wait_agent for each one to get their results and complete the task. Active agents: ${activeAgents.join(', ')}`,
                timestamp: Date.now(),
              });

              this.conversation.addUserMessage(
                `You have ${activeAgents.length} background subagent(s) still running. You must call wait_agent for each one to get their results before finishing. Active agent IDs: ${activeAgents.join(', ')}`
              );

              continueLoop = true;
              continue; // Go to next iteration
            }
          }

          // Check for open tasks BEFORE ending loop
          if (this.memoryStore) {
            const allTasks = this.memoryStore.getTasks();
            const openTasks = allTasks.filter(t => t.status !== 'completed' && t.status !== 'abandoned');
            if (openTasks.length > 0) {
              // Agent tried to finish but has open tasks!
              const taskList = openTasks.map(t => `- [${t.status}] ${t.description}`).join('\n');

              uiState.addMessage({
                role: 'system',
                content: `⚠️  Cannot finish: ${openTasks.length} open task(s) remaining`,
                timestamp: Date.now(),
              });

              this.conversation.addUserMessage(
                `You cannot finish yet. There are ${openTasks.length} open tasks that need to be completed:\n\n${taskList}\n\nPlease continue working on these tasks. Use update_task_status to mark them as completed when done, or blocked if you encounter issues.`
              );

              continueLoop = true;
              continue; // Go to next iteration
            }
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
                // Tracking item review complete - resuming detection
                this.justAskedToReviewTrackingItems = false;
              }
              // Silent - no need to log this internal state
              // Continue with normal flow (don't re-detect while flag is true)
            } else {
              const isToolFree = this.incompleteWorkDetector.isToolFreeResponse({
                role: 'assistant',
                content: response.content,
                toolCalls: response.toolCalls || []
              });
              // Check for open tracking items and tasks in memory
              const openTrackingItems = this.memoryStore?.getTrackingItems('open') || [];
              const hasTrackingItems = openTrackingItems.length > 0;

              // Check for open tasks (active, blocked, or waiting)
              const allTasks = this.memoryStore?.getTasks() || [];
              const openTasks = allTasks.filter(t => t.status !== 'completed' && t.status !== 'abandoned');
              const hasOpenTasks = openTasks.length > 0;

              const detection = this.incompleteWorkDetector.analyze(
                response.content,
                hasTrackingItems
              );

            // AUTO-PROCEED: When agent asks permission for task-authorized action
            if (detection.askingPermission && detection.permissionAlreadyGranted && detection.currentTask) {
              const prompt = this.incompleteWorkDetector.generatePrompt(detection);
              if (prompt) {
                uiState.addMessage({
                  role: 'system',
                  content: prompt,
                  timestamp: Date.now(),
                });
              }

              // Inject decision directly into conversation
              const autoDecision = `Your task is "${detection.currentTask}". This already authorizes the action you're asking about. Proceed with the best option that aligns with your task requirements. Do not wait for user confirmation - make the decision autonomously.`;

              uiState.addMessage({
                role: 'system',
                content: 'Auto-injecting decision to proceed',
                timestamp: Date.now(),
              });

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
                uiState.addMessage({
                  role: 'system',
                  content: 'Loop breaker activated - stopping repeated validation',
                  timestamp: Date.now(),
                });
                continueLoop = false;
                continue;
              }
            } else {
              this.consecutiveIdenticalDetections = 0;
              this.lastDetectionHash = detectionHash;
            }

            // Case 0: LLM says it's done but has open tasks (priority check)
            if (isToolFree && detection.completionPhrases.length > 0 && hasOpenTasks) {
              const taskList = openTasks.map(t => `- [${t.status}] ${t.description}`).join('\n');
              const taskPrompt = `You said the work is complete, but there are ${openTasks.length} open tasks that need to be completed:

${taskList}

Please continue working on these tasks. Use mark_task_complete when you finish each one, or mark_task_blocked if you encounter issues.`;

              uiState.addMessage({
                role: 'system',
                content: `⚠️ Cannot complete: ${openTasks.length} open tasks remaining`,
                timestamp: Date.now(),
              });

              this.conversation.addUserMessage(taskPrompt);
              continueLoop = true;
              continue;
            }

            // Case 1: LLM says it's done but has tracking items (pre-response check)
            if (isToolFree && detection.completionPhrases.length > 0 && hasTrackingItems) {
              // Show formatted warning to user
              const consolePrompt = this.incompleteWorkDetector.generatePrompt(detection);
              if (consolePrompt) {
                uiState.addMessage({
                  role: 'system',
                  content: consolePrompt,
                  timestamp: Date.now(),
                });
              }

              // Generate LLM-friendly message and ask to review using tracking item tools
              const reviewPrompt = `You said the work is complete, but there are pending tracking items that need review.

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

              uiState.addMessage({
                role: 'system',
                content: 'Asking LLM to review tracking items with file verification',
                timestamp: Date.now(),
              });

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
                await this.incompleteWorkDetector.storeDetectedItems(
                  detection.trackingItems,
                  response.content || 'LLM response'
                );
                uiState.addMessage({
                  role: 'system',
                  content: `Stored ${detection.trackingItems.length} tracking items in memory`,
                  timestamp: Date.now(),
                });
              }

              // Show formatted warning to user
              const consolePrompt = this.incompleteWorkDetector.generatePrompt(detection);
              if (consolePrompt) {
                uiState.addMessage({
                  role: 'system',
                  content: consolePrompt,
                  timestamp: Date.now(),
                });
              }

              // Generate LLM-friendly message and ask to review using tracking item tools
              const reviewPrompt = `You mentioned incomplete or remaining work. These items have been added as tracking items.

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

              uiState.addMessage({
                role: 'system',
                content: 'Asking LLM to review tracking items with file verification',
                timestamp: Date.now(),
              });

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
              uiState.addMessage({
                role: 'system',
                content: 'Scaffolding debt limit reached. Please complete existing items before adding features.',
                timestamp: Date.now(),
              });
            }
          }
        }
      } catch (error) {
        uiState.setAgentStatus('error', error instanceof Error ? error.message : String(error));
        uiState.addMessage({
          role: 'system',
          content: 'Error communicating with Copilot: ' + (error instanceof Error ? error.message : String(error)),
          timestamp: Date.now(),
        });
        continueLoop = false;
      }
    }

    if (this.maxIterations !== null && iteration >= this.maxIterations) {
      uiState.addMessage({
        role: 'system',
        content: 'Warning: Maximum iteration limit reached',
        timestamp: Date.now(),
      });
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
   * Execute tools sequentially
   */
  private async executeToolsSequential(toolCalls: ToolCall[]): Promise<void> {
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
          uiState.addMessage({
            role: 'tool',
            content: `Tool execution cancelled by hook: ${toolName}`,
            timestamp: Date.now(),
          });
          this.conversation.addToolResult(toolCall.id, toolName, 'Execution cancelled by hook');
          continue;
        }
        if (preResult.modifiedArgs) {
          toolArgs = preResult.modifiedArgs;
        }
      }

      // Update uiState with tool execution start
      uiState.startToolExecution({
        id: toolCall.id,
        name: toolName,
        args: toolArgs,
        status: 'running',
        startTime: Date.now(),
      });
      uiState.setAgentStatus('executing', `Running ${toolName}...`);

      // Show tool execution in conversation
      const argsPreview = toolArgs ? JSON.stringify(toolArgs).substring(0, 100) : '';
      uiState.addMessage({
        role: 'system',
        content: chalk.dim(`⚙️  Executing: ${toolName}${argsPreview ? `(${argsPreview}${argsPreview.length >= 100 ? '...' : ''})` : ''}`),
        timestamp: Date.now(),
      });

      let result: { success: boolean; output?: string; error?: string };
      const startTime = Date.now();

      try {
        result = await this.toolRegistry.execute(toolName, toolArgs);
        const duration = Date.now() - startTime;

        // Update uiState with tool result
        uiState.endToolExecution(result.output, result.error);

        if (result.success) {
          this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');

          // Show tool output if there is any
          if (result.output && result.output.trim()) {
            uiState.addMessage({
              role: 'tool',
              content: result.output,
              timestamp: Date.now(),
            });
          }

          // Show success message in conversation
          uiState.addMessage({
            role: 'system',
            content: chalk.dim(`✓ Completed: ${toolName} (${duration}ms)`),
            timestamp: Date.now(),
          });

          // Track file reads in memory
          if (toolName === 'read_file' && toolArgs.path) {
            this.conversation.trackFileRead(toolArgs.path, 'Read by tool');
          }

          // Track file edits in memory
          this.trackFileEdit(toolName, toolArgs);

          // Audit file modifications immediately for incomplete scaffolding
          await this.auditFileModification(toolName, toolArgs, result);
        } else {
          uiState.addMessage({
            role: 'tool',
            content: `${toolName} error: ${result.error}`,
            timestamp: Date.now(),
          });
          this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        uiState.endToolExecution(undefined, errorMessage);
        uiState.addMessage({
          role: 'tool',
          content: `${toolName} error: ${errorMessage}`,
          timestamp: Date.now(),
        });

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

      // Update tasks from memory store
      this.syncTasksToUIState();
    }
  }

  /**
   * Execute tools in parallel
   */
  private async executeToolsInParallel(toolCalls: ToolCall[]): Promise<void> {
    uiState.addMessage({
      role: 'system',
      content: `Running ${toolCalls.length} operations in parallel`,
      timestamp: Date.now(),
    });

    const results = await Promise.all(
      toolCalls.map((toolCall) => this.executeSingleToolParallel(toolCall))
    );

    const maxDuration = Math.max(...results.map(r => r.duration));
    uiState.addMessage({
      role: 'system',
      content: `All ${toolCalls.length} operations completed in ${maxDuration}ms`,
      timestamp: Date.now(),
    });
  }

  /**
   * Execute a single tool for parallel execution
   */
  private async executeSingleToolParallel(toolCall: ToolCall): Promise<{ duration: number }> {
    const toolName = toolCall.function.name;
    let toolArgs: Record<string, any>;

    try {
      toolArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      toolArgs = {};
    }

    const startTime = Date.now();

    try {
      const result = await this.toolRegistry.execute(toolName, toolArgs);
      const duration = Date.now() - startTime;

      if (result.success) {
        this.conversation.addToolResult(toolCall.id, toolName, result.output || 'Success');
        this.trackFileEdit(toolName, toolArgs);

        // Audit file modifications immediately for incomplete scaffolding
        await this.auditFileModification(toolName, toolArgs, result);
      } else {
        this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
      }

      return { duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

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
    } catch {
      // Silent - memory tracking failure is not critical
    }
  }

  private displayAuditResults(auditResult: {
    newItems: { type: string; description: string; file: string }[];
    resolvedItems: { type: string; description: string; file: string }[];
  }): void {
    const lines: string[] = [];

    // Show resolved items first (positive feedback)
    for (const item of auditResult.resolvedItems) {
      lines.push(`Resolved: ${item.type} in ${item.file}`);
    }

    // Show new incomplete items
    for (const item of auditResult.newItems) {
      lines.push(`Tracking: ${item.type} in ${item.file}: ${item.description.slice(0, 60)}`);
    }

    if (lines.length > 0) {
      uiState.addMessage({
        role: 'system',
        content: lines.join('\n'),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Audit file modification immediately after tool execution
   * Checks for incomplete scaffolding (stubs, placeholders, TODOs, etc.)
   */
  private async auditFileModification(
    toolName: string,
    toolArgs: Record<string, any>,
    result: { success: boolean; output?: string; error?: string }
  ): Promise<void> {
    // Only audit successful file modifications
    if (!result.success || !this.completionTracker) {
      return;
    }

    const fileModificationTools = ['create_file', 'patch_file'];
    if (!fileModificationTools.includes(toolName)) {
      return;
    }

    try {
      // Log audit start for verbose logging in ask mode
      uiState.addMessage({
        role: 'system',
        content: `🔍 Auditing ${toolName} on ${toolArgs.path || 'unknown'}...`,
        timestamp: Date.now(),
      });

      // Build context for audit with actual file content
      let context: string;
      if (toolName === 'create_file') {
        // For create_file, include FULL file content so audit can detect all issues
        context = `Tool: ${toolName}\nFile: ${toolArgs.path || 'unknown'}\n\nFile Content:\n${toolArgs.content || '(no content)'}`;
      } else if (toolName === 'patch_file') {
        // For patch_file, include search/replace patterns and context
        context = `Tool: ${toolName}\nFile: ${toolArgs.path || 'unknown'}\n\nSearch pattern:\n${toolArgs.search || '(no search pattern)'}\n\nReplacement:\n${toolArgs.replace || '(no replacement)'}\n\nResult: ${result.output || ''}`;
      } else {
        context = `Tool: ${toolName}\nFile: ${toolArgs.path || 'unknown'}\n${result.output || ''}`;
      }

      const responseId = `tool_${toolName}_${Date.now()}`;
      const auditResult = await this.completionTracker.auditResponse(
        context,
        this.conversation.getMessages(),
        responseId
      );

      // Display audit results if any issues found
      if (auditResult.newItems.length > 0 || auditResult.resolvedItems.length > 0) {
        this.displayAuditResults(auditResult);
      } else {
        // Log that audit completed with no issues
        uiState.addMessage({
          role: 'system',
          content: `✓ Audit complete: No incomplete scaffolding detected in ${toolArgs.path || 'unknown'}`,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      // Surface audit failures to UI instead of silent stderr
      const errorMsg = error instanceof Error ? error.message : String(error);
      uiState.addMessage({
        role: 'system',
        content: `⚠️ Scaffolding audit failed: ${errorMsg}`,
        timestamp: Date.now(),
      });
      console.error('[Scaffold Audit] Failed:', error);
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

  // Sync tasks from memory store to uiState
  private syncTasksToUIState(): void {
    try {
      const memoryStore = this.conversation.getMemoryStore();
      const currentTask = memoryStore.getActiveTask();
      const allTasks = memoryStore.getTasks();

      // Convert to TaskState format
      const uiTasks = allTasks.map(t => ({
        id: t.id,
        description: t.description,
        status: t.status as 'pending' | 'in_progress' | 'completed' | 'blocked',
        priority: t.priority as 'low' | 'medium' | 'high' | undefined,
      }));

      const uiCurrentTask = currentTask ? {
        id: currentTask.id,
        description: currentTask.description,
        status: currentTask.status as 'pending' | 'in_progress' | 'completed' | 'blocked',
        priority: currentTask.priority as 'low' | 'medium' | 'high' | undefined,
      } : null;

      uiState.setTasks(uiCurrentTask, uiTasks);
    } catch {
      // Silent - task sync failure is not critical
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
