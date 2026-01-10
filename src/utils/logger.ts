/**
 * Centralized logging utility for debug/file logging
 *
 * NOTE: This logger is NOT for UI output. UI components should use
 * RenderManager directly to manage their own screen regions.
 * This logger writes to stderr or log files only.
 */

import chalk from 'chalk';
import { uiState } from '../ui/ui-state.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 99,
}

export interface LoggerConfig {
  level: LogLevel;
  useTimestamps: boolean;
  useColors: boolean;
}

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  useTimestamps: false, // Disabled by default for cleaner output
  useColors: true,
};

/**
 * Debug/diagnostic logger that writes to stderr
 * NOT for UI output - use RenderManager for that
 */
export class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Check if a given log level would be printed
   */
  shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  /**
   * Internal write method - writes to stderr for debug logging
   * UI output should go through RenderManager, not this logger
   */
  private write(message: string, level: LogLevel): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = this.config.useTimestamps
      ? chalk.dim(`[${new Date().toISOString()}] `)
      : '';

    const fullMessage = timestamp + message + '\n';

    // Write to UI state - ensures capture in log files
    uiState.addMessage({ role: 'system', content: timestamp + message, timestamp: Date.now() });

    // Write to stderr - keeps debug output separate from UI
    process.stderr.write(fullMessage);
  }

  /**
   * Format a message with color
   */
  private format(message: string, colorFn: (str: string) => string): string {
    if (this.config.useColors) {
      return colorFn(message);
    }
    return message;
  }

  /**
   * Log debug message
   */
  debug(message: string): void {
    this.write(this.format(message, chalk.gray), LogLevel.DEBUG);
  }

  /**
   * Log info message
   */
  info(message: string): void {
    this.write(this.format(message, chalk.white), LogLevel.INFO);
  }

  /**
   * Log success message
   */
  success(message: string): void {
    this.write(this.format(message, chalk.green), LogLevel.INFO);
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    this.write(this.format(message, chalk.yellow), LogLevel.WARN);
  }

  /**
   * Log error message
   */
  error(message: string): void {
    this.write(this.format(message, chalk.red), LogLevel.ERROR);
  }

  /**
   * Log message with custom color
   */
  log(message: string, colorFn: (str: string) => string = chalk.white): void {
    this.write(this.format(message, colorFn), LogLevel.INFO);
  }

  /**
   * Log a new line (for spacing) - writes to stderr
   */
  newline(): void {
    if (this.shouldLog(LogLevel.INFO)) {
      uiState.addMessage({ role: 'system', content: '', timestamp: Date.now() });
      process.stderr.write('\n');
    }
  }

  /**
   * Log a separator line
   */
  separator(char: string = '─', length: number = 80): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.write(chalk.dim(char.repeat(length)), LogLevel.INFO);
    }
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();

/**
 * Convenience functions for direct import
 * NOTE: These write to stderr, not stdout. For UI output use RenderManager.
 */
export const log = {
  debug: (message: string) => logger.debug(message),
  info: (message: string) => logger.info(message),
  success: (message: string) => logger.success(message),
  warn: (message: string) => logger.warn(message),
  error: (message: string) => logger.error(message),
  log: (message: string, colorFn?: (str: string) => string) => logger.log(message, colorFn),
  newline: () => logger.newline(),
  separator: (char?: string, length?: number) => logger.separator(char, length),
  setLevel: (level: LogLevel) => logger.setLevel(level),
};

/**
 * Export for backwards compatibility with console.*
 */
export const consoleCompat = {
  log: (message: string) => logger.log(message),
  warn: (message: string) => logger.warn(message),
  error: (message: string) => logger.error(message),
  info: (message: string) => logger.info(message),
  debug: (message: string) => logger.debug(message),
};
