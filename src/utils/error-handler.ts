/**
 * Centralized error handler with stack trace logging
 * Provides consistent error handling across CLI commands and agent loops
 */

import chalk from 'chalk';
import { LogLevel, logger } from './logger.js';

export interface ErrorHandlingOptions {
  /** Whether to include full stack trace */
  includeStack?: boolean;
  /** Log level to use (default: ERROR) */
  logLevel?: LogLevel;
  /** Custom context message */
  context?: string;
  /** Whether to exit the process (default: false) */
  exitProcess?: boolean;
  /** Exit code (default: 1) */
  exitCode?: number;
  /** Whether to suppress output (for JSON mode, etc.) */
  silent?: boolean;
}

/**
 * Enhanced Error class with additional context
 */
export class HandledError extends Error {
  constructor(
    message: string,
    public readonly context?: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'HandledError';
  }
}

/**
 * Centralized error handler with stack trace logging
 */
export class ErrorHandler {
  private static formatError(error: unknown, options: ErrorHandlingOptions): string {
    let output: string[] = [];

    // Add context if provided
    if (options.context) {
      output.push(chalk.red.bold(`Error in ${options.context}:`));
    }

    // Get error message
    let errorMessage: string;
    let stackTrace: string | undefined;

    if (error instanceof Error) {
      errorMessage = error.message;
      stackTrace = error.stack;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else {
      errorMessage = String(error);
    }

    // Add error message
    output.push(chalk.red(errorMessage));

    // Add stack trace if requested and available
    if (options.includeStack && stackTrace) {
      output.push('');
      output.push(chalk.dim('Stack trace:'));
      output.push(chalk.gray(stackTrace));
    }

    // Add separator
    output.push('');

    return output.join('\n');
  }

  /**
   * Handle an error with consistent logging and optional stack trace
   */
  static handle(error: unknown, options: ErrorHandlingOptions = {}): void {
    const {
      includeStack = (process.env.NODE_ENV === 'development' || process.env.DEBUG) as boolean,
      logLevel = LogLevel.ERROR,
      context,
      exitProcess = false,
      exitCode = 1,
      silent = false,
    } = options;

    // Don't log if silent mode
    if (!silent) {
      const formattedError = this.formatError(error, { includeStack, context });

      // Write to stderr
      process.stderr.write(formattedError);

      // Log to logger at appropriate level
      if (error instanceof Error) {
        if (logLevel === LogLevel.DEBUG) {
          logger.debug(`[${context || 'ErrorHandler'}] ${error.message}`);
          if (includeStack && error.stack) {
            logger.debug(error.stack);
          }
        } else if (logLevel === LogLevel.WARN) {
          logger.warn(`[${context || 'ErrorHandler'}] ${error.message}`);
        } else {
          logger.error(`[${context || 'ErrorHandler'}] ${error.message}`);
        }
      } else {
        logger.error(`[${context || 'ErrorHandler'}] ${String(error)}`);
      }
    }

    // Exit process if requested
    if (exitProcess) {
      process.exit(exitCode);
    }
  }

  /**
   * Handle an error asynchronously (for async/await contexts)
   */
  static async handleAsync(
    error: unknown,
    options: ErrorHandlingOptions = {}
  ): Promise<void> {
    this.handle(error, options);
  }

  /**
   * Wrap a function with error handling
   */
  static wrap<T extends (...args: any[]) => any>(
    fn: T,
    options: ErrorHandlingOptions = {}
  ): T {
    return ((...args: any[]) => {
      try {
        return fn(...args);
      } catch (error) {
        this.handle(error, options);
        if (options.exitProcess !== false) {
          process.exit(options.exitCode || 1);
        }
        throw error; // Re-throw if not exiting
      }
    }) as T;
  }

  /**
   * Wrap an async function with error handling
   */
  static wrapAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: ErrorHandlingOptions = {}
  ): T {
    return (async (...args: any[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        await this.handleAsync(error, options);
        if (options.exitProcess !== false) {
          process.exit(options.exitCode || 1);
        }
        throw error; // Re-throw if not exiting
      }
    }) as T;
  }

  /**
   * Check if an error is a specific type
   */
  static isInstance(error: unknown, errorClass: new (...args: any[]) => Error): boolean {
    return error instanceof errorClass;
  }

  /**
   * Check if an error has a specific message pattern
   */
  static hasMessagePattern(error: unknown, pattern: RegExp): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return pattern.test(message);
  }

  /**
   * Extract error message safely
   */
  static getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Extract stack trace safely
   */
  static getStackTrace(error: unknown): string | undefined {
    if (error instanceof Error) {
      return error.stack;
    }
    return undefined;
  }

  /**
   * Get a user-friendly error message (hide stack traces from end users)
   */
  static getUserFriendlyMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Log an error with full context (for debugging)
   */
  static logFullContext(error: unknown, context: string, additionalData?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    const output: string[] = [];

    output.push(chalk.red.bold('=== ERROR CONTEXT ==='));
    output.push(chalk.dim(`Timestamp: ${timestamp}`));
    output.push(chalk.dim(`Context: ${context}`));
    output.push('');

    if (error instanceof Error) {
      output.push(chalk.red.bold('Error:'), error.message);
      output.push('');
      output.push(chalk.dim('Stack trace:'));
      output.push(chalk.gray(error.stack || 'No stack trace available'));
    } else {
      output.push(chalk.red.bold('Error:'), String(error));
    }

    if (additionalData) {
      output.push('');
      output.push(chalk.dim('Additional data:'));
      output.push(chalk.gray(JSON.stringify(additionalData, null, 2)));
    }

    output.push(chalk.red.bold('=== END ERROR CONTEXT ==='));
    output.push('');

    process.stderr.write(output.join('\n'));
    logger.error(`[${context}] ${this.getErrorMessage(error)}`);
  }
}

/**
 * Convenience function for quick error handling
 */
export function handleError(error: unknown, options?: ErrorHandlingOptions): void {
  ErrorHandler.handle(error, options);
}

/**
 * Create a wrapped async function with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options?: ErrorHandlingOptions
): T {
  return ErrorHandler.wrapAsync(fn, options);
}

/**
 * Common error patterns for checking
 */
export const ErrorPatterns = {
  // Network/API errors
  NETWORK: /network|timeout|econnrefused|etimedout/i,
  AUTH: /unauthorized|401|403|authentication|forbidden/i,
  QUOTA: /quota|limit|rate limit|429|maximum/i,

  // File system errors
  FILE_NOT_FOUND: /enoent|no such file|file not found|cannot find/i,
  PERMISSION_DENIED: /eacces|permission denied/i,

  // Configuration errors
  CONFIG: /config|configuration|missing.*required/i,

  // Validation errors
  VALIDATION: /validation|invalid|malformed/i,
};

/**
 * Check if error matches a pattern
 */
export function matchesErrorPattern(error: unknown, pattern: RegExp): boolean {
  return ErrorHandler.hasMessagePattern(error, pattern);
}
