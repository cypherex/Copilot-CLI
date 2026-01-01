// Main agentic loop

import chalk from 'chalk';
import ora from 'ora';
import type { LLMClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { ConversationManager } from './conversation.js';
import { StreamAccumulator } from '../llm/streaming.js';
import type { HookRegistry } from '../hooks/registry.js';
import { CompletionTracker } from '../audit/index.js';
import { detectSubagentOpportunity, buildSubagentHint } from './subagent-detector.js';

export class AgenticLoop {
  private maxIterations: number | null = 10;
  private hookRegistry?: HookRegistry;
  private completionTracker?: CompletionTracker;
  private responseCounter = 0;
  private currentSubagentOpportunity?: ReturnType<typeof detectSubagentOpportunity>;

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

  async processUserMessage(userMessage: string): Promise<void> {
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
      const hint = buildSubagentHint(this.currentSubagentOpportunity);
      console.log(chalk.gray('\n💡 Subagent suggestion available'));
    }

    this.conversation.addUserMessage(messageToProcess);

    let iteration = 0;
    let continueLoop = true;

    while (continueLoop && (this.maxIterations === null || iteration < this.maxIterations)) {
      iteration++;

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
      const spinner = ora('Thinking...').start();
      const accumulator = new StreamAccumulator();

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

      try {
        let hasToolCalls = false;
        let currentContent = '';

        for await (const chunk of this.llmClient.chatStream(
          messages,
          tools
        )) {
          if (chunk.delta.content) {
            currentContent += chunk.delta.content;
            if (!hasToolCalls) {
              spinner.text = chalk.gray(
                currentContent.slice(0, 60) + (currentContent.length > 60 ? '...' : '')
              );
            }
          }

          accumulator.addChunk(chunk);

          if (chunk.delta.toolCalls) {
            hasToolCalls = true;
            spinner.text = 'Executing tools...';
          }
        }

        spinner.stop();

        const response = accumulator.getResponse();

        if (response.content) {
          console.log(chalk.cyan('\nAssistant:'));
          console.log(response.content);
          console.log();
        }

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
          await this.executeTools(response.toolCalls);
          continueLoop = true;
        } else {
          this.conversation.addAssistantMessage(response.content || '');
          continueLoop = false;

          // Track retrieval usefulness if we had retrievals
          const pendingRetrievalIds = this.conversation.getPendingRetrievalIds();
          if (pendingRetrievalIds.length > 0 && response.content) {
            await this.trackRetrievalUsefulness(pendingRetrievalIds, response.content);
          }

          // Audit completed response for incomplete scaffolding
          if (this.completionTracker && response.content) {
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

            // Show debt summary if blocking
            const debt = this.completionTracker.getDebt();
            if (debt.shouldBlock) {
              console.log(chalk.red('\n⛔ Scaffolding debt limit reached. Please complete existing items before adding features.'));
            }
          }
        }
      } catch (error) {
        spinner.fail('Error communicating with Copilot');
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
      console.log(chalk.gray(JSON.stringify(toolArgs, null, 2)));

      let result: { success: boolean; output?: string; error?: string };

      try {
        result = await this.toolRegistry.execute(toolName, toolArgs);

        if (result.success) {
          console.log(chalk.green('✓ Success'));
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
          console.log(chalk.red('✗ Failed'));
          console.log(chalk.red(result.error));
          this.conversation.addToolResult(toolCall.id, toolName, `Error: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red('✗ Failed'));
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

      console.log();
    }
  }

  private trackFileEdit(toolName: string, toolArgs: Record<string, any>): void {
    try {
      const memoryStore = this.conversation.getMemoryStore();
      const activeTask = memoryStore.getActiveTask();

      if (toolName === 'create_file') {
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
      } else if (toolName === 'patch_file') {
        memoryStore.addEditRecord({
          file: toolArgs.path || 'unknown',
          description: `Replaced: ${toolArgs.search?.slice(0, 50)}...`,
          changeType: 'modify',
          beforeSnippet: toolArgs.search?.slice(0, 100),
          afterSnippet: toolArgs.replace?.slice(0, 100),
          relatedTaskId: activeTask?.id,
        });
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
