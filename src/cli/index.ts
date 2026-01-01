// CLI setup with Commander

import { Command } from 'commander';
import { chatCommand } from './commands/chat.js';
import { askCommand } from './commands/ask.js';
import { configCommand } from './commands/config.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('copilot-cli')
    .description('AI-powered CLI agent using Microsoft 365 Copilot')
    .version('0.1.0');

  // Default command: interactive chat
  program
    .command('chat', { isDefault: true })
    .description('Start interactive chat session with Copilot agent')
    .option('-d, --directory <path>', 'Working directory', process.cwd())
    .option('--max-iterations <n>', 'Limit iterations per message (default: unlimited)', parseInt)
    .action(chatCommand);

  // One-shot ask command
  program
    .command('ask [question]')
    .description('Ask a single question (or read from stdin if no question provided)')
    .option('-d, --directory <path>', 'Working directory', process.cwd())
    .option('-p, --print', 'Print mode: minimal output, no spinners (for piping/scripts)')
    .option('--json', 'Output response as JSON')
    .option('--no-tools', 'Disable tool execution (answer only)')
    .option('--max-iterations <n>', 'Limit iterations (default: unlimited)', parseInt)
    .action(askCommand);

  // Configuration management
  program
    .command('config')
    .description('Manage CLI configuration')
    .option('--set <key=value>', 'Set configuration value')
    .option('--get <key>', 'Get configuration value')
    .option('--list', 'List all configuration')
    .option('--clear-cache', 'Clear authentication token cache')
    .option('--verify', 'Verify Azure AD configuration')
    .action(configCommand);

  return program;
}
