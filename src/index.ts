#!/usr/bin/env node

// Copilot CLI Agent - Entry Point

import chalk from 'chalk';
import { createCLI } from './cli/index.js';
import { ErrorHandler, handleError } from './utils/error-handler.js';

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

      // Use ErrorHandler with stack logging
      handleError(error, {
        context: 'main',
        includeStack: (process.env.NODE_ENV === 'development' || !!process.env.DEBUG),
      });
    } else {
      handleError(error, {
        context: 'main',
        includeStack: (process.env.NODE_ENV === 'development' || !!process.env.DEBUG),
      });
    }
    process.exit(1);
  }
}

// Handle unhandled promise rejections globally
process.on('unhandledRejection', (reason, promise) => {
  handleError(reason, {
    context: 'unhandledRejection',
    includeStack: (process.env.NODE_ENV === 'development' || !!process.env.DEBUG),
  });
});

// Handle uncaught exceptions globally
process.on('uncaughtException', (error) => {
  handleError(error, {
    context: 'uncaughtException',
    includeStack: true, // Always show stack for uncaught exceptions
    exitProcess: true,
    exitCode: 1,
  });
});

// Final emergency flush on exit
process.on('exit', (code) => {
  if (code !== 0) {
    process.stdout.write(`\n[CRITICAL] Process exiting with non-zero code: ${code}\n`);
  }
});

main();
