/**
 * Debug harness (build-friendly): runs `explore_codebase`, injects the tool result into the
 * conversation as a proper tool message, then (optionally) runs a follow-up prompt.
 *
 * Build + run:
 *   npm run build
 *   node dist/debug/debug-explorer-flow.js --explore-only --local-home --timeout-ms 0
 *
 * Optional args:
 *   --prompt "..."              The user prompt to run after exploration
 *   --question "..."            The explorer question (defaults to repo feature/architecture)
 *   --depth shallow|normal|deep Explorer depth
 *   --dir "C:\\path\\to\\repo"  Working directory (defaults to cwd)
 *   --local-home               Store Copilot CLI state under testbox/ (avoids ~/.copilot-cli)
 *   --explore-only              Run explorer only (no main prompt)
 *   --timeout-ms <n>           Explorer timeout in ms (default: 0, disables timeout)
 */

import path from 'path';
import { promises as fs } from 'fs';

import { loadConfig } from '../utils/config.js';
import { AuthManager } from '../auth/index.js';
import { createLLMClient, getProviderDisplayName } from '../llm/provider-factory.js';
import { ToolRegistry } from '../tools/index.js';
import { ConversationManager } from '../agent/conversation.js';
import { AgenticLoop } from '../agent/loop.js';
import { SubAgentManager } from '../agent/subagent.js';
import { buildSystemPrompt } from '../agent/system-prompt.js';
import { CompletionTracker } from '../audit/index.js';
import { PlanningValidator } from '../agent/planning-validator.js';
import { ProactiveContextMonitor } from '../agent/proactive-context-monitor.js';
import { IncompleteWorkDetector } from '../agent/incomplete-work-detector.js';
import { FileRelationshipTracker } from '../agent/file-relationship-tracker.js';
import { WorkContinuityManager } from '../agent/work-continuity-manager.js';
import { SpawnValidator } from '../validators/spawn-validator.js';
import { CompletionWorkflowValidator } from '../validators/completion-workflow-validator.js';
import { AskRenderer } from '../ui/ask-renderer.js';
import { getCopilotCliHomeDir } from '../utils/app-paths.js';
import type { ToolCall } from '../llm/types.js';

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
  const explorerTimeoutMs = getArgNumber('--timeout-ms') ?? 0;

  const debugRoot = path.join(workingDirectory, 'testbox', 'debug-explorer-flow');
  await ensureDir(debugRoot);

  if (useLocalHome) {
    process.env.COPILOT_CLI_HOME = path.join(workingDirectory, 'testbox', 'local-home');
  }

  const appConfig = await loadConfig();
  const authManager = new AuthManager(appConfig.auth);
  const llmClient = createLLMClient({
    config: appConfig.llm,
    authManager: appConfig.llm.provider === 'copilot' ? authManager : undefined,
  });

  const systemPrompt = buildSystemPrompt(workingDirectory);
  const conversation = new ConversationManager(systemPrompt, { workingDirectory });
  conversation.setLLMClient(llmClient);

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
    appConfig.llm.model
  );
  toolRegistry.registerSubAgentTools(subAgentManager, conversation.getMemoryStore());

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

  const renderer = new AskRenderer({ captureMode: false, verbose: true, subAgentManager });
  renderer.start();

  console.log(`[debug] provider=${getProviderDisplayName(appConfig.llm.provider)} model=${appConfig.llm.model || '(default)'}`);
  console.log(`[debug] workingDirectory=${workingDirectory}`);
  console.log(`[debug] COPILOT_CLI_HOME=${getCopilotCliHomeDir()}`);
  console.log('');

  await conversation.initialize();
  completionTracker.setLLMClient(llmClient);
  await completionTracker.load();

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

  if (!exploreOnly) {
    console.log(`[debug] Running prompt:\n${prompt}\n`);
    await loop.processUserMessage(prompt);
  } else {
    console.log('[debug] --explore-only set; skipping main prompt.');
  }

  const messagesPath = path.join(debugRoot, 'conversation_messages.json');
  await writeText(messagesPath, JSON.stringify(conversation.getMessages(), null, 2) + '\n');
  console.log(`[debug] messages saved: ${messagesPath}`);
  console.log('');

  renderer.stop();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
