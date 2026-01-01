// Interactive chat command

import { editor } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { CopilotAgent } from '../../agent/index.js';
import { loadConfig } from '../../utils/config.js';
import { SessionManager } from '../../session/index.js';

// Define available commands with aliases for autocomplete
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
  'plugins',
  'sessions',
  'ralph-loop',
  'cancel-ralph',
];

// Find all commands that start with the given prefix
function findMatchingCommands(prefix: string): string[] {
  const searchPrefix = prefix.toLowerCase();
  return AVAILABLE_COMMANDS.filter(cmd => cmd.startsWith(searchPrefix));
}

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
      console.log();
      console.log(chalk.dim('Available commands:'));
      console.log(chalk.dim('  ' + AVAILABLE_COMMANDS.join('  ')));
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
                console.log();
                console.log(chalk.dim('Possible commands:'));
                console.log(chalk.dim('  ' + matches.join('  ')));
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
  console.log(chalk.blue.bold('\n🤖 Copilot CLI Agent'));
  console.log(chalk.gray('Type your message or /help for commands\n'));

  const config = await loadConfig();

  // Initialize session manager
  const sessionManager = new SessionManager();
  await sessionManager.initialize();

  // Provider-specific validation
  if (config.llm.provider === 'copilot' && !config.auth.clientId) {
    console.log(chalk.yellow('⚠️  No Azure Client ID configured.'));
    console.log(chalk.gray('Set AZURE_CLIENT_ID environment variable or run:'));
    console.log(chalk.gray('  copilot-cli config --set auth.clientId=YOUR_CLIENT_ID\n'));
    return;
  }

  if (config.llm.provider === 'zai' && !config.llm.apiKey) {
    console.log(chalk.yellow('⚠️  No Z.ai API key configured.'));
    console.log(chalk.gray('Get your API key at https://z.ai/subscribe'));
    console.log(chalk.gray('Then set ZAI_API_KEY environment variable or run:'));
    console.log(chalk.gray('  copilot-cli config --set llm.apiKey=YOUR_API_KEY\n'));
    return;
  }

  const spinner = ora('Initializing agent...').start();

  try {
    const agent = new CopilotAgent(config.auth, config.llm, options.directory);

    // Unlimited iterations by default, unless user specifies a limit
    agent.setMaxIterations(options.maxIterations ?? null);

    await agent.initialize();
    spinner.succeed('Agent ready!');

    // Show session header
    const providerInfo = agent.getModelName()
      ? `${agent.getProviderName()} (${agent.getModelName()})`
      : agent.getProviderName();
    showSessionHeader(providerInfo, options.directory);

    // Check if there's a saved session to load
    const sessions = await sessionManager.listSessions();
    const recentSession = sessions.length > 0 ? sessions[0] : null;
    let currentSession = sessionManager.getCurrentSession();

    if (recentSession && !currentSession) {
      console.log(chalk.dim(`ℹ️  Recent session available: ${recentSession.title.slice(0, 40)}...`));
      console.log(chalk.dim('   Use /sessions load to restore it\n'));
    }

    try {
      while (true) {
        const userInput = await readMultilineInput(chalk.green('You: '));

        if (userInput.startsWith('/')) {
          const command = userInput.slice(1).toLowerCase().trim().split(/\s+/)[0];

          if (command === 'exit' || command === 'quit') {
            await agent.shutdown();
            console.log(chalk.gray('Goodbye!'));
            break;
          }

          if (command === 'clear') {
            agent.clearConversation();
            console.log(chalk.gray('Conversation cleared\n'));
            continue;
          }

          if (command === 'help') {
            showHelp(agent);
            continue;
          }

          if (command === 'paste' || command === 'editor') {
            // Open editor for long content
            console.log(chalk.gray('Opening editor for multiline input...'));
            try {
              const content = await editor({
                message: 'Enter your message (save and close editor when done):',
                postfix: '.md',
              });
              if (content.trim()) {
                console.log(chalk.green('You:'), content.slice(0, 100) + (content.length > 100 ? '...' : ''));
                await agent.chat(content);
              }
            } catch {
              console.log(chalk.yellow('Editor cancelled.\n'));
            }
            console.log();
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

          if (command === 'sessions') {
            const sessionsCmd = parseSessionsCommand(userInput);
            if (sessionsCmd) {
              await handleSessionsCommand(agent, sessionManager, sessionsCmd);
            } else {
              await handleSessionsCommand(agent, sessionManager, { action: 'list' });
            }
            console.log();
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
                console.log(chalk.cyan(result));
              }
            } catch (error) {
              console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
              const hint = getErrorHint(error);
              if (hint) {
                console.log(hint);
              }
            }
            console.log();
            continue;
          }

          console.log(chalk.yellow(`Unknown command: ${command}\n`));
          continue;
        }

        if (!userInput.trim()) continue;

        try {
          await agent.chat(userInput);
          
          // Auto-save session after each message
          const currentSession = sessionManager.getCurrentSession();
          if (!currentSession) {
            // Create session on first message if not exists
            await sessionManager.createSession(
              options.directory,
              config.llm.provider,
              config.llm.model,
              { role: 'user', content: userInput }
            );
          } else {
            // Add message to existing session
            await sessionManager.addMessage(
              { role: 'user', content: userInput },
              agent.getMemoryStore(),
              undefined // scaffoldingDebt would need proper typing
            );
          }
        } catch (error) {
          console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
          const hint = getErrorHint(error);
          if (hint) {
            console.log(hint);
          }
        }

        console.log();
      }
    } catch (loopError) {
      // Handle errors in the chat loop
      console.error(chalk.red('✗ Error:'), loopError instanceof Error ? loopError.message : String(loopError));
      const hint = getErrorHint(loopError);
      if (hint) {
        console.log(hint);
      }
    }
  } catch (error) {
    spinner.fail('Failed to initialize agent');
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    const hint = getErrorHint(error);
    if (hint) {
      console.log(hint);
    }
    process.exit(1);
  }
}

function showHelp(agent: CopilotAgent): void {
  console.log(chalk.bold('\n📖 Available Commands:'));
  console.log(chalk.gray('  /help     - Show this help message'));
  console.log(chalk.gray('  /paste    - Open editor for long/multiline input'));
  console.log(chalk.gray('  /clear    - Clear conversation history'));
  console.log(chalk.gray('  /context  - Show context/token usage'));
  console.log(chalk.gray('  /memory   - Show memory status (preferences, tasks, etc.)'));
  console.log(chalk.gray('  /debt     - Show scaffolding debt (incomplete items)'));
  console.log(chalk.gray('  /sessions - Manage saved sessions (list, load, export, delete, clear)'));
  console.log(chalk.gray('  /plugins  - List loaded plugins'));
  console.log(chalk.gray('  /exit     - Exit the chat session'));
  console.log();
  console.log(chalk.bold('Plugin Commands (Ralph Wiggum):'));
  console.log(chalk.gray('  /ralph-loop <task>  - Start autonomous agent loop'));
  console.log(chalk.gray('  /cancel-ralph       - Cancel active Ralph Wiggum loop'));
  
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
    console.log();
    console.log(chalk.bold('💡 Current Suggestions:'));
    for (const suggestion of suggestions) {
      console.log(suggestion);
    }
  }
  
  console.log();
}

function showContext(agent: CopilotAgent): void {
  console.log(chalk.bold('\nContext Usage:'));
  const usage = agent.getContextUsage();
  console.log(usage);
  console.log();
}

function showMemory(agent: CopilotAgent): void {
  const summary = agent.getMemorySummary();
  console.log();
  console.log(summary);
  console.log();
}

function showPlugins(agent: CopilotAgent): void {
  const plugins = agent.getPluginRegistry().list();

  if (plugins.length === 0) {
    console.log(chalk.gray('No plugins loaded.\n'));
    return;
  }

  console.log(chalk.bold('\nLoaded Plugins:'));
  for (const plugin of plugins) {
    console.log(chalk.cyan(`  ${plugin.name} v${plugin.version}`));
    console.log(chalk.gray(`    ${plugin.description}`));
  }
  console.log();
}

function showDebt(agent: CopilotAgent): void {
  const debt = agent.getScaffoldingDebt();
  if (!debt) {
    console.log(chalk.green('\nNo scaffolding debt - all items complete!\n'));
    return;
  }
  console.log();
  console.log(debt);
  console.log();
}

function showSessionHeader(providerInfo: string, workingDirectory: string, sessionId?: string, sessionTitle?: string): void {
  console.log(chalk.dim('━'.repeat(60)));
  console.log(chalk.cyan.bold('  🤖 Copilot CLI Agent') + chalk.gray(` v0.1.0`));
  console.log(chalk.dim('━'.repeat(60)));
  console.log(chalk.gray(`  Provider: ${providerInfo}`));
  console.log(chalk.gray(`  Directory: ${workingDirectory}`));
  
  if (sessionId && sessionTitle) {
    console.log(chalk.gray(`  Session: ${sessionTitle} (${sessionId.slice(0, 8)}...) ✓`));
  }
  
  console.log(chalk.dim('━'.repeat(60)));
  console.log(chalk.dim('💡 Type /help for commands, /exit to quit\n'));
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
      console.log(chalk.bold('\n💾 Saved Sessions:'));
      console.log(sessionManager.formatSessionsList(sessions));
      break;
    }

    case 'load': {
      if (!cmd.id) {
        console.log(chalk.yellow('Usage: /sessions load <session-id>'));
        console.log(chalk.gray('Use /sessions list to see available sessions\n'));
        return;
      }

      const session = await sessionManager.loadSession(cmd.id);
      if (!session) {
        console.log(chalk.red(`✗ Session not found: ${cmd.id}\n`));
        return;
      }

      console.log(chalk.green(`✓ Loaded session: ${session.title}`));
      console.log(chalk.gray(`  Created: ${session.createdAt.toLocaleString()}`));
      console.log(chalk.gray(`  Messages: ${session.messages.length}\n`));
      
      // Update session header to show loaded session (re-create providerInfo for this scope)
      const providerInfo = agent.getModelName()
        ? `${agent.getProviderName()} (${agent.getModelName()})`
        : agent.getProviderName();
      showSessionHeader(providerInfo, session.workingDirectory, session.id, session.title);
      
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

      // Restore memory if available
      if (session.memoryData) {
        const memoryStore = agent.getMemoryStore();
        if (session.memoryData.goal) {
          memoryStore.setGoal(session.memoryData.goal);
        }
        for (const pref of session.memoryData.preferences || []) {
          memoryStore.addPreference(pref);
        }
        for (const task of session.memoryData.tasks || []) {
          memoryStore.addTask(task);
        }
        for (const decision of session.memoryData.decisions || []) {
          memoryStore.addDecision(decision);
        }
        console.log(chalk.gray('✓ Memory restored from session\n'));
      }
      break;
    }

    case 'export': {
      if (!cmd.id) {
        console.log(chalk.yellow('Usage: /sessions export <session-id>'));
        console.log(chalk.gray('Use /sessions list to see available sessions\n'));
        return;
      }

      const markdown = await sessionManager.exportSession(cmd.id);
      if (!markdown) {
        console.log(chalk.red(`✗ Session not found: ${cmd.id}\n`));
        return;
      }

      console.log(markdown);
      console.log(chalk.gray('\n---\n'));
      console.log(chalk.cyan('💡 Tip: Save this to a file for documentation\n'));
      break;
    }

    case 'delete': {
      if (!cmd.id) {
        console.log(chalk.yellow('Usage: /sessions delete <session-id>'));
        console.log(chalk.gray('Use /sessions list to see available sessions\n'));
        return;
      }

      const success = await sessionManager.deleteSession(cmd.id);
      if (success) {
        console.log(chalk.green(`✓ Deleted session: ${cmd.id}\n`));
      } else {
        console.log(chalk.red(`✗ Failed to delete session: ${cmd.id}\n`));
      }
      break;
    }

    case 'clear': {
      const count = await sessionManager.clearAllSessions();
      console.log(chalk.green(`✓ Cleared ${count} session(s)\n`));
      break;
    }
  }
}
