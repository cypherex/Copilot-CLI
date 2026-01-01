#!/usr/bin/env node

// Copilot CLI Agent - Entry Point

import chalk from 'chalk';
import { createCLI } from './cli/index.js';

async function main() {
  try {
    const program = createCLI();
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      // Handle Commander.js exit override errors silently
      if ('code' in error) {
        const code = (error as any).code;
        if (code === 'commander.version' || code === 'commander.helpDisplayed') {
          return;
        }
      }

      console.error(chalk.red('Fatal error:'), error.message);
    } else {
      console.error(chalk.red('Fatal error:'), String(error));
    }
    process.exit(1);
  }
}

main();
