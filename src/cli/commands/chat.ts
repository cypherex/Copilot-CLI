// Interactive chat command - using ManagedChatUI with RenderManager

import { editor, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { CopilotAgent } from '../../agent/index.js';
import { loadConfig } from '../../utils/config.js';
import { SessionManager } from '../../session/index.js';
import { ManagedChatUI } from '../../ui/managed-chat-ui.js';
import { getRenderManager } from '../../ui/render-manager.js';

const AVAILABLE_COMMANDS = [
  'help',
  'clear',
  'exit',
  'quit',
  'paste',
  'editor',
  'context',
  'memory',
  'debt',
  'tasks',
  'plugins',
  'sessions',
  'new-session',
  'resume',
  'ralph-loop',
  'cancel-ralph',
];

// Helper function to provide context-aware error hints
function getErrorHint(error: Error | unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes('quota') || message.includes('token') && message.includes('limit') ||
      message.includes('rate limit') || message.includes('429') || message.includes('maximum')) {
    return '💡 Tip: Try /context to check token usage';
  }

  if (message.includes('enoent') || message.includes('no such file') ||
      message.includes('file not found') || message.includes('cannot find')) {
    return '💡 Tip: Check that the file path is correct';
  }

  if (message.includes('unauthorized') || message.includes('401') ||
      message.includes('403') || message.includes('authentication') ||
      message.includes('auth') || message.includes('forbidden')) {
    return '💡 Tip: Run `copilot-cli config --verify`';
  }

  return '';
}

// Parse plugin command from input
function parsePluginCommand(input: string): { pluginId: string; command: string; args: string[] } | null {
  const pluginCommands: Record<string, string> = {
    'ralph-loop': 'ralph-wiggum',
    'cancel-ralph': 'ralph-wiggum',
  };

  const parts = input.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const pluginId = pluginCommands[command];

  if (pluginId) {
    return {
      pluginId,
      command,
      args: parts.slice(1),
    };
  }

  return null;
}

// Parse sessions command
function parseSessionsCommand(input: string): { action: 'list' | 'load' | 'export' | 'delete' | 'clear', id?: string } | null {
  const parts = input.trim().split(/\s+/);

  if (parts.length === 1) {
    return { action: 'list' };
  }

  const action = parts[1].toLowerCase();
  const validActions = ['list', 'load', 'export', 'delete', 'clear'];

  if (!validActions.includes(action)) {
    return null;
  }

  const id = parts[2];

  if ((action === 'load' || action === 'export' || action === 'delete') && !id) {
    return null;
  }

  return {
    action: action as any,
    id,
  };
}

export async function chatCommand(options: { directory: string; maxIterations?: number }): Promise<void> {
  const config = await loadConfig();

  // Track if agent is paused
  let agentPaused = false;

  // Initialize UI with RenderManager
  const ui = new ManagedChatUI({
    showStatusBar: true,
    showTaskBar: true,
    updateInterval: 1000,
  });

  let agentInstance: CopilotAgent | null = null;

  // Cleanup function
  const cleanup = async () => {
    if (agentInstance) {
      try {
        await agentInstance.shutdown();
      } catch {
        // Ignore shutdown errors
      }
    }
    ui.shutdown();
  };

  // Setup interrupt handler (Ctrl+C)
  process.removeAllListeners('SIGINT');
  process.on('SIGINT', async () => {
    if (agentPaused) {
      // Second Ctrl+C - exit
      await cleanup();
      process.exit(0);
    }
    // First Ctrl+C - pause
    agentPaused = true;
    ui.showWarning('Agent paused. Press Enter to continue or type a new message.');
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  // Initialize session manager
  const sessionManager = new SessionManager();
  await sessionManager.initialize();

  // Provider-specific validation (before UI init so errors go to stderr)
  if (config.llm.provider === 'copilot' && !config.auth.clientId) {
    process.stderr.write(chalk.yellow('⚠️  No Azure Client ID configured.\n'));
    process.stderr.write(chalk.gray('Set AZURE_CLIENT_ID environment variable or run:\n'));
    process.stderr.write(chalk.gray('  copilot-cli config --set auth.clientId=YOUR_CLIENT_ID\n\n'));
    return;
  }

  if (config.llm.provider === 'zai' && !config.llm.apiKey) {
    process.stderr.write(chalk.yellow('⚠️  No Z.ai API key configured.\n'));
    process.stderr.write(chalk.gray('Get your API key at https://z.ai/subscribe\n'));
    process.stderr.write(chalk.gray('Then set ZAI_API_KEY environment variable\n\n'));
    return;
  }

  // Initialize UI
  ui.initialize();
  ui.startSpinner('Initializing agent...');

  try {
    const agent = new CopilotAgent(config.auth, config.llm, options.directory);
    agentInstance = agent;

    agent.setMaxIterations(options.maxIterations ?? null);

    await agent.initialize();
    ui.spinnerSucceed('Agent ready!');

    // Show welcome
    const providerInfo = agent.getModelName()
      ? `${agent.getProviderName()} (${agent.getModelName()})`
      : agent.getProviderName();
    ui.showWelcome(providerInfo, options.directory);

    // Check for saved sessions
    const sessions = await sessionManager.listSessions();
    const recentSession = sessions.length > 0 ? sessions[0] : null;
    let currentSession = sessionManager.getCurrentSession();

    if (recentSession && !currentSession) {
      ui.showInfo(`Recent session available: ${recentSession.title.slice(0, 40)}...`);
      ui.writeLine(chalk.dim('   Use /sessions to browse and load saved sessions'));
    }

    // Update status bar
    const updateStatus = () => {
      const memoryStore = agent.getMemoryStore();
      const tasks = memoryStore.getTasks();
      const activeTask = memoryStore.getActiveTask();

      ui.updateStatus({
        status: 'idle',
        tokensUsed: 0,
        tokensLimit: 0,
        modelName: agent.getModelName(),
      });

      ui.updateTasks(
        activeTask ? {
          id: activeTask.id,
          description: activeTask.description,
          status: activeTask.status,
          priority: activeTask.priority,
        } : null,
        tasks.map((t: any) => ({
          id: t.id,
          description: t.description,
          status: t.status,
          priority: t.priority,
        }))
      );
    };

    // Initial status update
    updateStatus();

    // Main chat loop
    try {
      while (true) {
        if (agentPaused) {
          ui.showWarning('Agent is paused. Type /resume to continue, /quit to exit.');
        }

        const userInput = await ui.readInput();

        // Handle resume when paused
        if (agentPaused && userInput.toLowerCase().trim() === '/resume') {
          agentPaused = false;
          ui.showSuccess('Agent resumed');
          continue;
        }

        if (agentPaused) {
          ui.showInfo('Agent is paused. Use /resume to continue.');
          continue;
        }

        if (userInput.startsWith('/')) {
          const command = userInput.slice(1).toLowerCase().trim().split(/\s+/)[0];

          if (command === 'exit' || command === 'quit') {
            await cleanup();
            break;
          }

          if (command === 'clear') {
            agent.clearConversation();
            ui.clearOutput();
            ui.showWelcome(providerInfo, options.directory);
            ui.showSuccess('Conversation cleared');
            continue;
          }

          if (command === 'help') {
            ui.showHelp();
            continue;
          }

          if (command === 'paste' || command === 'editor') {
            // Need to temporarily shutdown UI for editor
            ui.shutdown();
            try {
              const content = await editor({
                message: 'Enter your message (save and close editor when done):',
                postfix: '.md',
              });
              ui.initialize();
              if (content.trim()) {
                ui.startSpinner('Processing...');
                await agent.chat(content);
                ui.clearSpinner();
                updateStatus();
              }
            } catch {
              ui.initialize();
              ui.showWarning('Editor cancelled');
            }
            continue;
          }

          if (command === 'plugins') {
            showPlugins(agent, ui);
            continue;
          }

          if (command === 'context') {
            showContext(agent, ui);
            continue;
          }

          if (command === 'memory') {
            showMemory(agent, ui);
            continue;
          }

          if (command === 'debt') {
            showDebt(agent, ui);
            continue;
          }

          if (command === 'tasks') {
            showTasks(agent, ui);
            continue;
          }

          if (command === 'sessions') {
            const sessionsCmd = parseSessionsCommand(userInput);
            if (sessionsCmd) {
              await handleSessionsCommand(agent, sessionManager, sessionsCmd, ui);
            } else {
              await handleSessionsCommand(agent, sessionManager, { action: 'load' }, ui);
            }
            continue;
          }

          if (command === 'new-session') {
            const currentSession = sessionManager.getCurrentSession();
            if (currentSession) {
              await sessionManager.saveCurrentSession(agent.getMemoryStore());
            }
            agent.clearConversation();
            sessionManager.setCurrentSession(null as any);
            ui.showSuccess('Started fresh session');
            continue;
          }

          // Check for plugin commands
          const pluginCmd = parsePluginCommand(userInput);
          if (pluginCmd) {
            try {
              const result = await agent.executePluginCommand(
                pluginCmd.pluginId,
                pluginCmd.command,
                pluginCmd.args
              );
              if (result) {
                ui.writeLine(chalk.cyan(result));
              }
            } catch (error) {
              const hint = getErrorHint(error);
              ui.showError(error instanceof Error ? error.message : String(error), hint);
            }
            continue;
          }

          ui.showWarning(`Unknown command: ${command}`);
          continue;
        }

        if (!userInput.trim()) continue;

        try {
          ui.startSpinner('Thinking...');
          await agent.chat(userInput);
          ui.clearSpinner();
          updateStatus();

          // Auto-save session
          const currentSession = sessionManager.getCurrentSession();
          if (!currentSession) {
            await sessionManager.createSession(
              options.directory,
              config.llm.provider,
              config.llm.model,
              { role: 'user', content: userInput },
              agent.getMemoryStore().getSessionId()
            );
          } else {
            await sessionManager.addMessage(
              { role: 'user', content: userInput },
              agent.getMemoryStore(),
              agent.getCompletionTracker().getDebt()
            );
          }
        } catch (error) {
          ui.clearSpinner();
          const hint = getErrorHint(error);
          ui.showError(error instanceof Error ? error.message : String(error), hint);
        }
      }
    } catch (loopError) {
      const hint = getErrorHint(loopError);
      ui.showError(loopError instanceof Error ? loopError.message : String(loopError), hint);
    }
  } catch (error) {
    ui.spinnerFail('Failed to initialize agent');
    ui.showError(error instanceof Error ? error.message : String(error));
    ui.shutdown();
    process.exit(1);
  }
}

function showPlugins(agent: CopilotAgent, ui: ManagedChatUI): void {
  const plugins = agent.getPluginRegistry().list();

  if (plugins.length === 0) {
    ui.showInfo('No plugins loaded');
    return;
  }

  ui.writeLine('');
  ui.writeLine(chalk.bold('Loaded Plugins:'));
  for (const plugin of plugins) {
    ui.writeLine(chalk.cyan(`  ${plugin.name} v${plugin.version}`));
    ui.writeLine(chalk.gray(`    ${plugin.description}`));
  }
  ui.writeLine('');
}

function showContext(agent: CopilotAgent, ui: ManagedChatUI): void {
  ui.writeLine('');
  ui.writeLine(chalk.bold('Context Usage:'));
  const usage = agent.getContextUsage();
  ui.writeLine(usage);
  ui.writeLine('');
}

function showMemory(agent: CopilotAgent, ui: ManagedChatUI): void {
  const summary = agent.getMemorySummary();
  ui.writeLine('');
  ui.writeLine(summary);
  ui.writeLine('');
}

function showDebt(agent: CopilotAgent, ui: ManagedChatUI): void {
  const debt = agent.getScaffoldingDebt();
  if (!debt) {
    ui.showSuccess('No scaffolding debt - all items complete!');
    return;
  }
  ui.writeLine('');
  ui.writeLine(debt);
  ui.writeLine('');
}

function showTasks(agent: CopilotAgent, ui: ManagedChatUI): void {
  const memoryStore = agent.getMemoryStore();
  const tasks = memoryStore.getTasks();

  if (tasks.length === 0) {
    ui.showInfo('No tasks tracked yet');
    ui.writeLine(chalk.dim('Tasks are automatically tracked when you mention things like:'));
    ui.writeLine(chalk.dim('  - "Need to implement authentication"'));
    ui.writeLine(chalk.dim('  - "Should refactor the API"'));
    ui.writeLine('');
    return;
  }

  ui.writeLine('');
  ui.writeLine(chalk.bold('📋 Tracked Tasks:'));
  ui.writeLine('');

  const pending = tasks.filter((t: any) => t.status === 'pending');
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress');
  const completed = tasks.filter((t: any) => t.status === 'completed');
  const blocked = tasks.filter((t: any) => t.status === 'blocked');

  if (inProgress.length > 0) {
    ui.writeLine(chalk.yellow('● In Progress:'));
    for (const task of inProgress) {
      ui.writeLine(`  ${task.description}${task.priority === 'high' ? chalk.red(' [HIGH]') : ''}`);
    }
    ui.writeLine('');
  }

  if (pending.length > 0) {
    ui.writeLine(chalk.gray('○ Pending:'));
    for (const task of pending) {
      ui.writeLine(`  ${task.description}${task.priority === 'high' ? chalk.red(' [HIGH]') : ''}`);
    }
    ui.writeLine('');
  }

  if (blocked.length > 0) {
    ui.writeLine(chalk.red('⚠ Blocked:'));
    for (const task of blocked) {
      ui.writeLine(`  ${task.description}`);
    }
    ui.writeLine('');
  }

  if (completed.length > 0) {
    ui.writeLine(chalk.green(`✓ Completed (${completed.length}):`));
    for (const task of completed.slice(-5)) {
      ui.writeLine(chalk.dim(`  ${task.description}`));
    }
    if (completed.length > 5) {
      ui.writeLine(chalk.dim(`  ... and ${completed.length - 5} more`));
    }
    ui.writeLine('');
  }
}

async function handleSessionsCommand(
  agent: CopilotAgent,
  sessionManager: SessionManager,
  cmd: { action: 'list' | 'load' | 'export' | 'delete' | 'clear', id?: string },
  ui: ManagedChatUI
): Promise<void> {
  switch (cmd.action) {
    case 'list': {
      const sessions = await sessionManager.listSessions();
      ui.writeLine('');
      ui.writeLine(chalk.bold('💾 Saved Sessions:'));
      ui.writeLine(sessionManager.formatSessionsList(sessions));
      break;
    }

    case 'load': {
      let sessionId = cmd.id;

      if (!sessionId) {
        const sessions = await sessionManager.listSessions();
        if (sessions.length === 0) {
          ui.showWarning('No saved sessions found');
          return;
        }

        // Need to temporarily shutdown UI for select prompt
        ui.shutdown();
        try {
          sessionId = await select({
            message: 'Select a session to load:',
            choices: sessions.map(s => ({
              name: `${s.title}\n  ${chalk.dim(sessionManager.formatDistanceToNow(s.lastUpdatedAt) + ' • ' + s.messageCount + ' messages')}`,
              value: s.id,
              description: s.workingDirectory
            })),
          });
          ui.initialize();
        } catch {
          ui.initialize();
          ui.showWarning('Cancelled');
          return;
        }
      }

      const session = await sessionManager.loadSession(sessionId);
      if (!session) {
        ui.showError(`Session not found: ${sessionId}`);
        return;
      }

      ui.showSuccess(`Loading session: ${session.title}`);
      ui.writeLine(chalk.gray(`  Created: ${session.createdAt.toLocaleString()}`));
      ui.writeLine(chalk.gray(`  Messages: ${session.messages.length}`));

      ui.startSpinner('Restoring conversation...');

      // Restore conversation
      const messages = session.messages;
      for (const msg of messages) {
        if (msg.role === 'user') {
          agent['conversation'].addUserMessage(msg.content);
        } else if (msg.role === 'assistant') {
          agent['conversation'].addAssistantMessage(msg.content, msg.toolCalls);
        } else if (msg.role === 'tool') {
          agent['conversation'].addToolResult(msg.toolCallId || '', msg.name || '', msg.content);
        }
      }

      if (session.sessionData) {
        agent.loadSessionData(session.sessionData);
      }

      ui.spinnerSucceed('Session loaded');

      // Show conversation history
      ui.writeLine('');
      ui.writeLine(chalk.bold('📜 Conversation History:'));
      ui.showSeparator();

      for (const msg of messages) {
        if (msg.role === 'user') {
          ui.writeLine(chalk.green('\nYou:'));
          ui.writeLine(msg.content);
        } else if (msg.role === 'assistant') {
          ui.writeLine(chalk.cyan('\nAssistant:'));
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            for (const toolCall of msg.toolCalls) {
              ui.writeLine(chalk.blue(`→ Executing: ${toolCall.function.name}`));
            }
          }
          if (msg.content) {
            ui.writeLine(msg.content);
          }
        }
      }

      ui.showSeparator();
      ui.showSuccess('Session restored - continue the conversation');
      break;
    }

    case 'export': {
      if (!cmd.id) {
        ui.showWarning('Usage: /sessions export <session-id>');
        return;
      }

      const markdown = await sessionManager.exportSession(cmd.id);
      if (!markdown) {
        ui.showError(`Session not found: ${cmd.id}`);
        return;
      }

      ui.writeLine(markdown);
      ui.writeLine('');
      ui.showInfo('Save this to a file for documentation');
      break;
    }

    case 'delete': {
      if (!cmd.id) {
        ui.showWarning('Usage: /sessions delete <session-id>');
        return;
      }

      const success = await sessionManager.deleteSession(cmd.id);
      if (success) {
        ui.showSuccess(`Deleted session: ${cmd.id}`);
      } else {
        ui.showError(`Failed to delete session: ${cmd.id}`);
      }
      break;
    }

    case 'clear': {
      const count = await sessionManager.clearAllSessions();
      ui.showSuccess(`Cleared ${count} session(s)`);
      break;
    }
  }
}
