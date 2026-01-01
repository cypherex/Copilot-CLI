// Interactive chat command

import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { CopilotAgent } from '../../agent/index.js';
import { loadConfig } from '../../utils/config.js';

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

export async function chatCommand(options: { directory: string }): Promise<void> {
  console.log(chalk.blue.bold('\n🤖 Copilot CLI Agent'));
  console.log(chalk.gray('Type your message or /help for commands\n'));

  const config = await loadConfig();

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

    await agent.initialize();
    spinner.succeed('Agent ready!');

    const providerInfo = agent.getModelName()
      ? `${agent.getProviderName()} (${agent.getModelName()})`
      : agent.getProviderName();
    console.log(chalk.gray(`Provider: ${providerInfo}`));
    console.log(chalk.gray(`Working directory: ${options.directory}\n`));

    while (true) {
      const userInput = await input({
        message: chalk.green('You:'),
      });

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
          showHelp();
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
            console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      }

      console.log();
    }
  } catch (error) {
    spinner.fail('Failed to initialize agent');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(chalk.bold('\nAvailable Commands:'));
  console.log(chalk.gray('  /help     - Show this help message'));
  console.log(chalk.gray('  /clear    - Clear conversation history'));
  console.log(chalk.gray('  /context  - Show context/token usage'));
  console.log(chalk.gray('  /memory   - Show memory status (preferences, tasks, etc.)'));
  console.log(chalk.gray('  /plugins  - List loaded plugins'));
  console.log(chalk.gray('  /exit     - Exit the chat session'));
  console.log();
  console.log(chalk.bold('Plugin Commands (Ralph Wiggum):'));
  console.log(chalk.gray('  /ralph-loop <task>  - Start autonomous agent loop'));
  console.log(chalk.gray('  /cancel-ralph       - Cancel active Ralph Wiggum loop'));
  console.log();
}

function showContext(agent: CopilotAgent): void {
  const usage = agent.getContextUsage();
  console.log(chalk.bold('\nContext Usage:'));
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
