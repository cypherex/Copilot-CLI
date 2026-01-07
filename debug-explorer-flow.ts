/**
 * Debug harness: run `explore_codebase` for the current repo, inject the tool result
 * into the conversation as a proper tool message, then run the full prompt.
 *
 * Run (PowerShell):
 *   `npx tsx debug-explorer-flow.ts`
 *
 * Run (Git Bash):
 *   `npx tsx debug-explorer-flow.ts`
 *
 * Optional args:
 *   --prompt "..."              The user prompt to run after exploration
 *   --question "..."            The explorer question (defaults to repo feature/architecture)
 *   --depth shallow|normal|deep Explorer depth
 *   --dir "C:\\path\\to\\repo"  Working directory (defaults to cwd)
 *   --local-home               Store Copilot CLI state under testbox/ (avoids ~/.copilot-cli)
 *   --explore-only              Run explorer only (no main prompt)
 *   --timeout-ms <n>           Explorer timeout in ms (default: 60000, 0 disables)
 */

import path from 'path';
import { promises as fs } from 'fs';

import { loadConfig } from './src/utils/config.js';
import { AuthManager } from './src/auth/index.js';
import { createLLMClient, getProviderDisplayName } from './src/llm/provider-factory.js';
import { ToolRegistry } from './src/tools/index.js';
import { ConversationManager } from './src/agent/conversation.js';
import { AgenticLoop } from './src/agent/loop.js';
import { SubAgentManager } from './src/agent/subagent.js';
import { buildSystemPrompt } from './src/agent/system-prompt.js';
import { CompletionTracker } from './src/audit/index.js';
import { PlanningValidator } from './src/agent/planning-validator.js';
import { ProactiveContextMonitor } from './src/agent/proactive-context-monitor.js';
import { IncompleteWorkDetector } from './src/agent/incomplete-work-detector.js';
import { FileRelationshipTracker } from './src/agent/file-relationship-tracker.js';
import { WorkContinuityManager } from './src/agent/work-continuity-manager.js';
import { SpawnValidator } from './src/validators/spawn-validator.js';
import { CompletionWorkflowValidator } from './src/validators/completion-workflow-validator.js';
import { AskRenderer } from './src/ui/ask-renderer.js';
import type { ChatMessage, ToolCall } from './src/llm/types.js';

type Depth = 'shallow' | 'normal' | 'deep';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function getArgEnum<T extends string>(name: string, allowed: readonly T[]): T | undefined {
  const value = getArg(name);
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function getArgNumber(name: string): number | undefined {
  const value = getArg(name);
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function defaultPrompt(): string {
  return 'Whats the best feature in this codebase? Write the answer in answer.md';
}

function defaultExplorerQuestion(): string {
  return 'What are the main features and architecture of this codebase? What makes this project unique/valuable?';
}

function formatCopilotHistoryForDebug(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const systemMessages = messages.filter(m => m.role === 'system');
  const contextMessages = messages
    .filter(m => m.role !== 'user' || m !== lastUser)
    .filter(m => m.role !== 'system');

  const parts: string[] = [];

  if (systemMessages.length > 0) {
    parts.push('System Instructions:');
    parts.push(systemMessages.map(m => m.content).join('\n'));
    parts.push('');
  }

  if (contextMessages.length > 0) {
    parts.push('Previous conversation (as Copilot additionalContext):');
    parts.push(
      contextMessages
        .map(m => {
          if (m.role === 'user') return `User: ${m.content}`;
          if (m.role === 'assistant') return `Assistant: ${m.content}`;
          const toolName = m.name || 'unknown';
          return `Tool(${toolName}): ${m.content}`;
        })
        .join('\n\n')
    );
  }

  return parts.join('\n');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}

async function main(): Promise<void> {
  const workingDirectory = getArg('--dir') || process.cwd();
  const prompt = getArg('--prompt') || defaultPrompt();
  const explorerQuestion = getArg('--question') || defaultExplorerQuestion();
  const depth: Depth = getArgEnum('--depth', ['shallow', 'normal', 'deep'] as const) || 'normal';
  const useLocalHome = process.argv.includes('--local-home');
  const exploreOnly = process.argv.includes('--explore-only');
  const explorerTimeoutMs = getArgNumber('--timeout-ms') ?? 60_000;

  const debugRoot = path.join(workingDirectory, 'testbox', 'debug-explorer-flow');
  const homeDir = path.join(debugRoot, 'copilot-cli-home');

  // Optionally force all CLI state into the repo (avoids writing to ~/.copilot-cli during debugging).
  if (useLocalHome && !process.env.COPILOT_CLI_HOME) {
    process.env.COPILOT_CLI_HOME = homeDir;
  }

  await ensureDir(debugRoot);

  const config = await loadConfig();

  if (config.llm.provider === 'copilot' && !config.auth.clientId) {
    console.error('Error: No Azure Client ID configured.');
    console.error('Set `AZURE_CLIENT_ID` or run: `copilot-cli config --set auth.clientId=YOUR_CLIENT_ID`');
    console.error('Tip: if you already have a working CLI config in `~/.copilot-cli`, run without `--local-home`.');
    process.exit(1);
  }

  const authManager = config.llm.provider === 'copilot' ? new AuthManager(config.auth) : undefined;
  const llmClient = createLLMClient({ config: config.llm, authManager });

  const systemPrompt = buildSystemPrompt(workingDirectory);
  const conversation = new ConversationManager(systemPrompt, {
    workingDirectory,
    enableSmartMemory: true,
    contextConfig: { verbose: false },
  });
  conversation.setLLMClient(llmClient);

  // Tools + infrastructure (mirrors CopilotAgent wiring, but keeps references for debugging).
  const toolRegistry = new ToolRegistry();
  toolRegistry.registerTaskManagementTools(conversation.getMemoryStore());
  toolRegistry.registerContextManagementTools(conversation.getMemoryStore());
  toolRegistry.registerDecisionManagementTools(conversation.getMemoryStore());
  toolRegistry.registerTaskComplexityTools(conversation.getMemoryStore());

  const completionTracker = new CompletionTracker(workingDirectory);
  const planningValidator = new PlanningValidator(conversation.getMemoryStore());
  const proactiveContextMonitor = new ProactiveContextMonitor(conversation, {
    warningThreshold: 70,
    criticalThreshold: 85,
    cooldownPeriod: 60_000,
  });
  const incompleteWorkDetector = new IncompleteWorkDetector(conversation.getMemoryStore(), llmClient);
  const fileRelationshipTracker = new FileRelationshipTracker();
  const workContinuityManager = new WorkContinuityManager(conversation.getMemoryStore());

  const spawnValidator = new SpawnValidator(llmClient);
  const completionWorkflowValidator = new CompletionWorkflowValidator(llmClient);

  const subAgentManager = new SubAgentManager(
    llmClient,
    toolRegistry,
    5,
    undefined,
    completionTracker,
    planningValidator,
    proactiveContextMonitor,
    incompleteWorkDetector,
    fileRelationshipTracker,
    config.llm.model
  );
  toolRegistry.registerSubAgentTools(subAgentManager, conversation.getMemoryStore());

  // Wire validators into tools (matches CopilotAgent).
  const spawnAgentTool = toolRegistry.get('spawn_agent');
  if (spawnAgentTool && 'setValidator' in spawnAgentTool) (spawnAgentTool as any).setValidator(spawnValidator);
  const createTaskTool = toolRegistry.get('create_task');
  if (createTaskTool && 'setValidator' in createTaskTool) (createTaskTool as any).setValidator(spawnValidator);
  const updateTaskStatusTool = toolRegistry.get('update_task_status');
  if (updateTaskStatusTool && 'setValidator' in updateTaskStatusTool) {
    (updateTaskStatusTool as any).setValidator(completionWorkflowValidator);
  }
  toolRegistry.setExecutionContext(undefined, conversation, completionTracker);

  const loop = new AgenticLoop(llmClient, toolRegistry, conversation);
  loop.setCompletionTracker(completionTracker);
  loop.setPlanningValidator(planningValidator);
  loop.setProactiveContextMonitor(proactiveContextMonitor);
  loop.setIncompleteWorkDetector(incompleteWorkDetector);
  loop.setSubAgentManager(subAgentManager);
  loop.setFileRelationshipTracker(fileRelationshipTracker);
  loop.setWorkContinuityManager(workContinuityManager);
  loop.setMemoryStore(conversation.getMemoryStore());
  loop.setMaxIterations(null);

  // Renderer (prints uiState messages, including subagent tool logs).
  const renderer = new AskRenderer({ captureMode: false, verbose: true, subAgentManager });
  renderer.start();

  console.log(`[debug] provider=${getProviderDisplayName(config.llm.provider)} model=${config.llm.model || '(default)'}`);
  console.log(`[debug] workingDirectory=${workingDirectory}`);
  console.log(`[debug] COPILOT_CLI_HOME=${process.env.COPILOT_CLI_HOME}`);
  console.log('');

  await conversation.initialize();
  completionTracker.setLLMClient(llmClient);
  await completionTracker.load();

  // 1) Run explorer tool directly, capture the raw output.
  const exploreArgs = {
    question: explorerQuestion,
    directory: workingDirectory,
    depth,
    timeout_ms: explorerTimeoutMs,
  };

  console.log('[debug] Running explore_codebase...');
  const exploreExec = await toolRegistry.execute('explore_codebase', exploreArgs);
  const exploreText = exploreExec.output || `Error: ${exploreExec.error || '(no error)'}`;
  if (!exploreExec.success) {
    console.error('[debug] explore_codebase failed:', exploreExec.error || '(no error)');
  }

  const exploreOutPath = path.join(debugRoot, 'explore_codebase_result.json');
  await writeText(exploreOutPath, exploreText + '\n');
  console.log(`[debug] explore_codebase saved: ${exploreOutPath}`);
  console.log('');

  // 2) Inject the tool call + tool result into the conversation explicitly (mimics real tool call history).
  const toolCallId = `debug_explore_${Date.now()}`;
  const syntheticToolCall: ToolCall = {
    id: toolCallId,
    type: 'function',
    function: {
      name: 'explore_codebase',
      arguments: JSON.stringify(exploreArgs),
    },
  };
  conversation.addAssistantMessage('[debug] explore_codebase', [syntheticToolCall]);
  conversation.addToolResult(toolCallId, 'explore_codebase', exploreText);

  // 3) Run the actual prompt.
  if (!exploreOnly) {
    console.log(`[debug] Running prompt:\n${prompt}\n`);
    await loop.processUserMessage(prompt);
  } else {
    console.log('[debug] --explore-only set; skipping main prompt.');
  }

  // 4) Dump conversation messages so we can verify the tool result is in history.
  const messages = conversation.getMessages();
  const transcriptPath = path.join(debugRoot, 'conversation_messages.json');
  await writeText(transcriptPath, JSON.stringify(messages, null, 2) + '\n');

  const copilotContextPreview = formatCopilotHistoryForDebug(messages);
  const copilotPreviewPath = path.join(debugRoot, 'copilot_additionalContext_preview.txt');
  await writeText(copilotPreviewPath, copilotContextPreview + '\n');

  console.log(`[debug] conversation messages saved: ${transcriptPath}`);
  console.log(`[debug] Copilot additionalContext preview saved: ${copilotPreviewPath}`);

  renderer.stop();
  await subAgentManager.shutdown();
  await conversation.saveMemory();
}

main().catch((err) => {
  console.error('[debug] fatal:', err);
  process.exit(1);
});
