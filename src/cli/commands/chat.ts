// Interactive chat command

import { editor, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { CopilotAgent } from '../../agent/index.js';
import { loadConfig } from '../../utils/config.js';
import { SessionManager } from '../../session/index.js';
import { ChatUI } from '../../ui/index.js';
import { log } from '../../utils/index.js';

// Find all commands that start with the given prefix
function findMatchingCommands(prefix: string): string[] {
  const searchPrefix = prefix.toLowerCase();
  return AVAILABLE_COMMANDS.filter(cmd => cmd.startsWith(searchPrefix));
}

// Add new-session to available commands
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

// Find the longest common prefix among a list of strings
function getCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  const first = strings[0];
  let commonLength = first.length;

  for (let i = 1; i < strings.length; i++) {
    const current = strings[i];
    let j = 0;
    while (j < Math.min(commonLength, current.length) && first[j] === current[j]) {
      j++;
    }
    commonLength = j;
  }

  return first.slice(0, commonLength);
}

// Multiline input reader - collects until double-enter or timeout after paste
async function readMultilineInput(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(promptText);

    const lines: string[] = [];
    let lastInputTime = Date.now();
    let isPasting = false;
    let inputBuffer = '';

    // Enable raw mode for character-by-character reading
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const finish = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');

      // Combine current buffer with collected lines
      if (inputBuffer) {
        lines.push(inputBuffer);
      }
      resolve(lines.join('\n').trim());
    };

    // Show command suggestions when user types /
    let shownSuggestions = false;

    const showCommandSuggestions = () => {
      if (shownSuggestions) return;
      shownSuggestions = true;
      log.newline();
      log.info(chalk.dim('Available commands:'));
      log.info(chalk.dim('  ' + AVAILABLE_COMMANDS.join('  ')));
      // Redraw current input
      process.stdout.write(promptText + inputBuffer);
    };

    const onData = (chunk: string) => {
      const now = Date.now();
      const timeSinceLastInput = now - lastInputTime;
      lastInputTime = now;

      // Detect paste: multiple chars at once or rapid succession (<10ms)
      if (chunk.length > 1 || timeSinceLastInput < 10) {
        isPasting = true;
      }

      for (const char of chunk) {
        // Ctrl+C - cancel
        if (char === '\x03') {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve('');
          return;
        }

        // Ctrl+D - submit
        if (char === '\x04') {
          finish();
          return;
        }

        // Enter/Return
        if (char === '\r' || char === '\n') {
          if (isPasting) {
            // During paste, collect the line and continue
            lines.push(inputBuffer);
            inputBuffer = '';
            process.stdout.write('\n');
          } else if (inputBuffer === '' && lines.length > 0) {
            // Empty line after content = submit (double-enter)
            finish();
            return;
          } else {
            // Single enter on first line = submit single line
            if (lines.length === 0 && inputBuffer) {
              lines.push(inputBuffer);
              finish();
              return;
            }
            lines.push(inputBuffer);
            inputBuffer = '';
            process.stdout.write('\n');
          }
          continue;
        }

        // Backspace
        if (char === '\x7f' || char === '\b') {
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }

        // Tab key - command autocomplete
        if (char === '\t') {
          // Only autocomplete if input starts with /
          if (inputBuffer.startsWith('/')) {
            const currentInput = inputBuffer.slice(1).trimStart(); // Remove leading / and any space
            const matches = findMatchingCommands(currentInput);

            if (matches.length === 1) {
              // Single match - complete the command
              const completedCommand = matches[0];
              // Clear current input (after /)
              const clearCount = currentInput.length;
              for (let i = 0; i < clearCount; i++) {
                process.stdout.write('\b \b');
              }
              // Write completed command
              process.stdout.write(completedCommand);
              inputBuffer = '/' + completedCommand;
            } else if (matches.length > 1) {
              // Multiple matches - show options and complete to common prefix
              const commonPrefix = getCommonPrefix(matches);
              if (commonPrefix.length > currentInput.length) {
                // Clear current input
                const clearCount = currentInput.length;
                for (let i = 0; i < clearCount; i++) {
                  process.stdout.write('\b \b');
                }
                // Write common prefix
                process.stdout.write(commonPrefix);
                inputBuffer = '/' + commonPrefix;
              } else {
                // Show available options
                log.newline();
                log.info(chalk.dim('Possible commands:'));
                log.info(chalk.dim('  ' + matches.join('  ')));
                // Redraw current input
                process.stdout.write(promptText + inputBuffer);
              }
            }
            // If no matches, do nothing
          }
          continue;
        }

        // Regular character
        if (char >= ' ') {
          inputBuffer += char;
          process.stdout.write(char);

          // Show suggestions after typing /
          if (char === '/' && !shownSuggestions) {
            showCommandSuggestions();
          }
        }
      }

      // After paste detected, set a short timeout to finalize
      if (isPasting) {
        setTimeout(() => {
          // If no new input for 50ms after paste, we're done pasting
          if (Date.now() - lastInputTime >= 50) {
            isPasting = false;
          }
        }, 50);
      }
    };

    process.stdin.on('data', onData);
  });
}

// Helper function to provide context-aware error hints
function getErrorHint(error: Error | unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Token/quota errors
  if (message.includes('quota') || message.includes('token') && message.includes('limit') || 
      message.includes('rate limit') || message.includes('429') || message.includes('maximum')) {
    return chalk.dim('💡 Tip: Try /context to check token usage');
  }

  // File not found errors
  if (message.includes('enoent') || message.includes('no such file') || 
      message.includes('file not found') || message.includes('cannot find')) {
    return chalk.dim('💡 Tip: Run /files to see available files');
  }

  // Authentication errors
  if (message.includes('unauthorized') || message.includes('401') || 
      message.includes('403') || message.includes('authentication') || 
      message.includes('auth') || message.includes('forbidden')) {
    return chalk.dim('💡 Tip: Run `copilot-cli config --verify`');
  }

  // No specific hint for generic errors
  return '';
}

// Parse plugin command from input (e.g., "/ralph-loop task" -> ["ralph-wiggum", "ralph-loop", ["task"]])
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

// Parse sessions command (e.g., "/sessions list", "/sessions load abc123", "/sessions delete abc123")
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
  let pauseReason = '';

  // Initialize UI with persistent bottom bar - taskbar and input always visible
  // Note: The input prompt is handled by BottomBar, not by Input class
  const ui = new ChatUI({
    showStatusBar: true,
    showTaskPanel: true,
    useSplitScreen: false, // Disabled - causes word-per-line streaming issues
    usePersistentBottomBar: true, // Enable persistent bottom bar with taskbar and input
  });

  // Setup interrupt handler (Ctrl+C)
  const originalSigintListener = process.listeners('SIGINT')[0];
  process.removeAllListeners('SIGINT');

  let agentInstance: any = null; // Store agent reference for cleanup

  const cleanupAndExit = async (signal: string) => {
    log.info(chalk.yellow(`\n${signal} received - cleaning up...`));
    if (agentInstance) {
      // Set timeout to force exit if shutdown hangs
      const forceExitTimeout = setTimeout(() => {
        log.info(chalk.red('Shutdown timeout - forcing exit'));
        process.exit(1);
      }, 3000);

      try {
        await agentInstance.shutdown();
        clearTimeout(forceExitTimeout);
      } catch (error) {
        log.error('Shutdown error: ' + error);
        clearTimeout(forceExitTimeout);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', async () => {
    if (agentPaused) {
      // Second Ctrl+C - cleanup and exit
      await cleanupAndExit('SIGINT');
    }

    // First Ctrl+C - pause
    agentPaused = true;
    pauseReason = 'User interrupted';
    ui.showWarning('Agent paused. Press Enter to continue or type a new message.');
  });

  // Handle SIGTERM (process kill)
  process.on('SIGTERM', async () => {
    await cleanupAndExit('SIGTERM');
  });

  // Handle process exit
  process.on('beforeExit', async () => {
    if (agentInstance) {
      await agentInstance.shutdown();
    }
  });

  // Initialize session manager
  const sessionManager = new SessionManager();
  await sessionManager.initialize();

  // Provider-specific validation
  if (config.llm.provider === 'copilot' && !config.auth.clientId) {
    log.info(chalk.yellow('⚠️  No Azure Client ID configured.'));
    log.info(chalk.gray('Set AZURE_CLIENT_ID environment variable or run:'));
    log.info(chalk.gray('  copilot-cli config --set auth.clientId=YOUR_CLIENT_ID\n'));
    return;
  }

  if (config.llm.provider === 'zai' && !config.llm.apiKey) {
    log.info(chalk.yellow('⚠️  No Z.ai API key configured.'));
    log.info(chalk.gray('Get your API key at https://z.ai/subscribe'));
    log.info(chalk.gray('Then set ZAI_API_KEY environment variable or run:'));
    log.info(chalk.gray('  copilot-cli config --set llm.apiKey=YOUR_API_KEY\n'));
    return;
  }

  const spinner = ora('Initializing agent...').start();

  try {
    const agent = new CopilotAgent(config.auth, config.llm, options.directory);
    agentInstance = agent; // Store for cleanup handlers

    // Unlimited iterations by default, unless user specifies a limit
    agent.setMaxIterations(options.maxIterations ?? null);

    await agent.initialize();
    spinner.succeed('Agent ready!');

    // Initialize UI with agent
    ui.initialize(agent);

    // Connect UI to agent for non-blocking message processing (split-screen mode)
    agent.setChatUI(ui);

    // Show session header
    const providerInfo = agent.getModelName()
      ? `${agent.getProviderName()} (${agent.getModelName()})`
      : agent.getProviderName();
    ui.showWelcome(providerInfo, options.directory);

    // Check if there's a saved session to load
    const sessions = await sessionManager.listSessions();
    const recentSession = sessions.length > 0 ? sessions[0] : null;
    let currentSession = sessionManager.getCurrentSession();

    if (recentSession && !currentSession) {
      ui.showInfo(`Recent session available: ${recentSession.title.slice(0, 40)}...`);
      log.info(chalk.dim('   Use /sessions to browse and load saved sessions\n'));
    }

    // Show initial status
    ui.showStatusPanel();

    try {
      while (true) {
        // Check if agent was paused
        if (agentPaused) {
          ui.showWarning('Agent is paused. Type /resume to continue, /quit to exit, or a new message to start a new task.');
        }

        const userInput = await ui.readInput();

        // Handle resume command when paused
        if (agentPaused && userInput.toLowerCase().trim() === '/resume') {
          agentPaused = false;
          pauseReason = '';
          log.info(chalk.green('▶️  Agent resumed\n'));
          continue;
        }

        // If paused and user sends a non-resume message, just continue
        if (agentPaused) {
          log.info(chalk.gray('Agent is paused. Use /resume to continue the current task.\n'));
          continue;
        }

        if (userInput.startsWith('/')) {
          const command = userInput.slice(1).toLowerCase().trim().split(/\s+/)[0];

          if (command === 'exit' || command === 'quit') {
            await agent.shutdown();
            ui.shutdown();
            ui.showInfo('Goodbye!');
            break;
          }

          if (command === 'clear') {
            agent.clearConversation();
            ui.clearScreen();
            ui.showWelcome(providerInfo, options.directory);
            ui.showSuccess('Conversation cleared');
            continue;
          }

          if (command === 'help') {
            ui.showHelp();
            continue;
          }

          if (command === 'paste' || command === 'editor') {
            // Open editor for long content
            log.info(chalk.gray('Opening editor for multiline input...'));
            try {
              const content = await editor({
                message: 'Enter your message (save and close editor when done):',
                postfix: '.md',
              });
              if (content.trim()) {
                log.info(chalk.green('You:') + ' ' + (content.slice(0, 100) + (content.length > 100 ? '...' : '')));
                await agent.chat(content);
              }
            } catch {
              log.info(chalk.yellow('Editor cancelled.\n'));
            }
            log.newline();
            continue;
          }

          if (command === 'plugins') {
            showPlugins(agent);
            continue;
          }

          if (command === 'context') {
            showContext(agent);
            continue;
          }

          if (command === 'memory') {
            showMemory(agent);
            continue;
          }

          if (command === 'debt') {
            showDebt(agent);
            continue;
          }

          if (command === 'tasks') {
            showTasks(agent);
            continue;
          }

          if (command === 'sessions') {
            const sessionsCmd = parseSessionsCommand(userInput);
            if (sessionsCmd) {
              await handleSessionsCommand(agent, sessionManager, sessionsCmd);
            } else {
              // Default to interactive load instead of list
              await handleSessionsCommand(agent, sessionManager, { action: 'load' });
            }
            log.newline();
            continue;
          }

          if (command === 'new-session') {
            // Start a fresh session
            const currentSession = sessionManager.getCurrentSession();
            if (currentSession) {
              await sessionManager.saveCurrentSession(agent.getMemoryStore());
            }

            // Clear agent conversation
            agent.clearConversation();

            // Clear session in sessionManager
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
                log.info(chalk.cyan(result));
              }
            } catch (error) {
              const hint = getErrorHint(error);
              ui.showError(error instanceof Error ? error : new Error(String(error)), hint);
            }
            continue;
          }

          ui.showWarning(`Unknown command: ${command}`);
          continue;
        }

        if (!userInput.trim()) continue;

        try {
          await agent.chat(userInput);

          // Update status after chat
          ui.showStatusPanel();
          
          // Auto-save session after each message
          const currentSession = sessionManager.getCurrentSession();
          if (!currentSession) {
            // Create session on first message if not exists
            await sessionManager.createSession(
              options.directory,
              config.llm.provider,
              config.llm.model,
              { role: 'user', content: userInput },
              agent.getMemoryStore().getSessionId()
            );
          } else {
            // Add message to existing session
            await sessionManager.addMessage(
              { role: 'user', content: userInput },
              agent.getMemoryStore(),
              agent.getCompletionTracker().getDebt()
            );
          }
        } catch (error) {
          const hint = getErrorHint(error);
          ui.showError(error instanceof Error ? error : new Error(String(error)), hint);
        }
      }
    } catch (loopError) {
      // Handle errors in the chat loop
      const hint = getErrorHint(loopError);
      ui.showError(loopError instanceof Error ? loopError : new Error(String(loopError)), hint);
    } finally {
      ui.shutdown();
    }
  } catch (error) {
    spinner.fail('Failed to initialize agent');
    const hint = getErrorHint(error);
    ui.showError(error instanceof Error ? error : new Error(String(error)), hint);
    process.exit(1);
  }
}

function showHelp(agent: CopilotAgent): void {
  log.info(chalk.bold('\n📖 Available Commands:'));
  log.info(chalk.gray('  /help        - Show this help message'));
  log.info(chalk.gray('  /paste       - Open editor for long/multiline input'));
  log.info(chalk.gray('  /clear       - Clear conversation history'));
  log.info(chalk.gray('  /context     - Show context/token usage'));
  log.info(chalk.gray('  /memory      - Show memory status (preferences, tasks, etc.)'));
  log.info(chalk.gray('  /debt        - Show scaffolding debt (incomplete items)'));
  log.info(chalk.gray('  /tasks       - Show task list with statuses'));
  log.info(chalk.gray('  /sessions    - Interactive session browser (or: list, load <id>, export <id>, delete <id>, clear)'));
  log.info(chalk.gray('  /new-session - Start a fresh session'));
  log.info(chalk.gray('  /resume      - Resume a paused agent'));
  log.info(chalk.gray('  /plugins     - List loaded plugins'));
  log.info(chalk.gray('  /exit        - Exit the chat session'));
  log.newline();
  log.info(chalk.bold('Plugin Commands (Ralph Wiggum):'));
  log.info(chalk.gray('  /ralph-loop <task>  - Start autonomous agent loop'));
  log.info(chalk.gray('  /cancel-ralph       - Cancel active Ralph Wiggum loop'));
  
  // Dynamic suggestions based on current session state
  const suggestions: string[] = [];
  
  // Check for scaffolding debt
  const debt = agent.getScaffoldingDebt();
  if (debt && debt.length > 0) {
    suggestions.push(chalk.yellow('  → Run /debt to see incomplete scaffolding items'));
  }
  
  // Check for active tasks (parse memory summary)
  const memorySummary = agent.getMemorySummary();
  if (memorySummary.includes('Tasks: 0 active')) {
    suggestions.push(chalk.gray('  → Set a goal: "I want to build a REST API"'));
  }
  
  if (suggestions.length > 0) {
    log.newline();
    log.info(chalk.bold('💡 Current Suggestions:'));
    for (const suggestion of suggestions) {
      log.info(suggestion);
    }
  }
  
  log.newline();
}

function showContext(agent: CopilotAgent): void {
  log.info(chalk.bold('\nContext Usage:'));
  const usage = agent.getContextUsage();
  log.info(usage);
  log.newline();
}

function showMemory(agent: CopilotAgent): void {
  const summary = agent.getMemorySummary();
  log.newline();
  log.info(summary);
  log.newline();
}

function showPlugins(agent: CopilotAgent): void {
  const plugins = agent.getPluginRegistry().list();

  if (plugins.length === 0) {
    log.info(chalk.gray('No plugins loaded.\n'));
    return;
  }

  log.info(chalk.bold('\nLoaded Plugins:'));
  for (const plugin of plugins) {
    log.info(chalk.cyan(`  ${plugin.name} v${plugin.version}`));
    log.info(chalk.gray(`    ${plugin.description}`));
  }
  log.newline();
}

function showDebt(agent: CopilotAgent): void {
  const debt = agent.getScaffoldingDebt();
  if (!debt) {
    log.info(chalk.green('\nNo scaffolding debt - all items complete!\n'));
    return;
  }
  log.newline();
  log.info(debt);
  log.newline();
}

function showTasks(agent: CopilotAgent): void {
  const memoryStore = agent.getMemoryStore();
  const tasks = memoryStore.getTasks();
  
  if (tasks.length === 0) {
    log.info(chalk.gray('\nNo tasks tracked yet.\n'));
    log.info(chalk.dim('Tasks are automatically tracked when you mention things like:'));
    log.info(chalk.dim('  - "Need to implement authentication"'));
    log.info(chalk.dim('  - "Should refactor the API"'));
    log.info(chalk.dim('  - "Going to add unit tests"\n'));
    return;
  }

  log.info(chalk.bold('\n📋 Tracked Tasks:\n'));

  // Group by status
  const pending = tasks.filter((t: any) => t.status === 'pending');
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress');
  const completed = tasks.filter((t: any) => t.status === 'completed');
  const blocked = tasks.filter((t: any) => t.status === 'blocked');

  if (inProgress.length > 0) {
    log.info(chalk.yellow('● In Progress:'));
    for (const task of inProgress) {
      log.info(`  ${task.description}${task.priority === 'high' ? chalk.red(' [HIGH]') : ''}`);
    }
    log.newline();
  }

  if (pending.length > 0) {
    log.info(chalk.gray('○ Pending:'));
    for (const task of pending) {
      log.info(`  ${task.description}${task.priority === 'high' ? chalk.red(' [HIGH]') : ''}`);
    }
    log.newline();
  }

  if (blocked.length > 0) {
    log.info(chalk.red('⚠ Blocked:'));
    for (const task of blocked) {
      log.info(`  ${task.description}${task.priority === 'high' ? chalk.red(' [HIGH]') : ''}`);
    }
    log.newline();
  }

  if (completed.length > 0) {
    log.info(chalk.green(`✓ Completed (${completed.length}):`));
    for (const task of completed.slice(-5)) {
      log.info(chalk.dim(`  ${task.description}`));
    }
    if (completed.length > 5) {
      log.info(chalk.dim(`  ... and ${completed.length - 5} more`));
    }
    log.newline();
  }
}

function showSessionHeader(providerInfo: string, workingDirectory: string, sessionId?: string, sessionTitle?: string): void {
  log.info(chalk.dim('━'.repeat(60)));
  log.info(chalk.cyan.bold('  🤖 Copilot CLI Agent') + chalk.gray(` v0.1.0`));
  log.info(chalk.dim('━'.repeat(60)));
  log.info(chalk.gray(`  Provider: ${providerInfo}`));
  log.info(chalk.gray(`  Directory: ${workingDirectory}`));
  
  if (sessionId && sessionTitle) {
    log.info(chalk.gray(`  Session: ${sessionTitle} (${sessionId.slice(0, 8)}...) ✓`));
  }
  
  log.info(chalk.dim('━'.repeat(60)));
  log.info(chalk.dim('💡 Type /help for commands, /exit to quit\n'));
}

async function handleSessionsCommand(
  agent: CopilotAgent,
  sessionManager: SessionManager,
  cmd: { action: 'list' | 'load' | 'export' | 'delete' | 'clear', id?: string },
  providerInfo?: string
): Promise<void> {
  switch (cmd.action) {
    case 'list': {
      const sessions = await sessionManager.listSessions();
      log.info(chalk.bold('\n💾 Saved Sessions:'));
      log.info(sessionManager.formatSessionsList(sessions));
      break;
    }

    case 'load': {
      let sessionId = cmd.id;

      // If no ID provided, show interactive selector
      if (!sessionId) {
        const sessions = await sessionManager.listSessions();
        if (sessions.length === 0) {
          log.info(chalk.yellow('No saved sessions found.\n'));
          return;
        }

        try {
          sessionId = await select({
            message: 'Select a session to load:',
            choices: sessions.map(s => ({
              name: `${s.title}\n  ${chalk.dim(sessionManager.formatDistanceToNow(s.lastUpdatedAt) + ' • ' + s.messageCount + ' messages')}`,
              value: s.id,
              description: s.workingDirectory
            })),
          });
        } catch {
          log.info(chalk.yellow('\nCancelled\n'));
          return;
        }
      }

      const session = await sessionManager.loadSession(sessionId);
      if (!session) {
        log.info(chalk.red(`✗ Session not found: ${sessionId}\n`));
        return;
      }

      log.info(chalk.green(`\n✓ Loading session: ${session.title}`));
      log.info(chalk.gray(`  Created: ${session.createdAt.toLocaleString()}`));
      log.info(chalk.gray(`  Messages: ${session.messages.length}`));

      // Show preview of conversation
      const spinner = ora('Restoring conversation...').start();

      // Update session header to show loaded session (re-create providerInfo for this scope)
      const providerInfo = agent.getModelName()
        ? `${agent.getProviderName()} (${agent.getModelName()})`
        : agent.getProviderName();

      // Restore conversation from session
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

      // Restore session data if available
      if (session.sessionData) {
        agent.loadSessionData(session.sessionData);
      }

      spinner.succeed('Session loaded');

      // Show session header
      showSessionHeader(providerInfo, session.workingDirectory, session.id, session.title);

      // Display full conversation history
      log.info(chalk.bold('📜 Conversation History:\n'));
      log.info(chalk.dim('─'.repeat(60)));

      for (const msg of messages) {
        if (msg.role === 'user') {
          log.info(chalk.green('\nYou:'));
          log.info(msg.content);
        } else if (msg.role === 'assistant') {
          log.info(chalk.cyan('\nAssistant:'));
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            // Show tool calls
            for (const toolCall of msg.toolCalls) {
              log.info(chalk.blue(`→ Executing: ${toolCall.function.name}`));
            }
          }
          if (msg.content) {
            log.info(msg.content);
          }
        } else if (msg.role === 'tool') {
          // Optionally show tool results (commented out to reduce noise)
          // log.info(chalk.gray(`  ✓ ${msg.name}: ${msg.content.slice(0, 100)}...`));
        }
      }

      log.info(chalk.dim('\n' + '─'.repeat(60)));
      log.info(chalk.green('\n✓ Session restored - continue the conversation\n'));
      break;
    }

    case 'export': {
      if (!cmd.id) {
        log.info(chalk.yellow('Usage: /sessions export <session-id>'));
        log.info(chalk.gray('Use /sessions list to see available sessions\n'));
        return;
      }

      const markdown = await sessionManager.exportSession(cmd.id);
      if (!markdown) {
        log.info(chalk.red(`✗ Session not found: ${cmd.id}\n`));
        return;
      }

      log.info(markdown);
      log.info(chalk.gray('\n---\n'));
      log.info(chalk.cyan('💡 Tip: Save this to a file for documentation\n'));
      break;
    }

    case 'delete': {
      if (!cmd.id) {
        log.info(chalk.yellow('Usage: /sessions delete <session-id>'));
        log.info(chalk.gray('Use /sessions list to see available sessions\n'));
        return;
      }

      const success = await sessionManager.deleteSession(cmd.id);
      if (success) {
        log.info(chalk.green(`✓ Deleted session: ${cmd.id}\n`));
      } else {
        log.info(chalk.red(`✗ Failed to delete session: ${cmd.id}\n`));
      }
      break;
    }

    case 'clear': {
      const count = await sessionManager.clearAllSessions();
      log.info(chalk.green(`✓ Cleared ${count} session(s)\n`));
      break;
    }
  }
}
