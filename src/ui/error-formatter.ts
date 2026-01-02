// Enhanced error formatting with helpful suggestions

import chalk from 'chalk';
import { simpleIndent, BOX_CHARS } from './box-drawer.js';
import * as fs from 'fs';
import * as path from 'path';

export interface FormattedError {
  type: string;
  message: string;
  suggestions?: string[];
  details?: string;
  stack?: string;
}

/**
 * Error formatter that provides helpful, contextual error messages
 */
export class ErrorFormatter {
  /**
   * Format a tool error with helpful context
   */
  formatToolError(toolName: string, error: Error | string, context?: {file?: string; args?: Record<string, any>}): string {
    const errorMsg = error instanceof Error ? error.message : error;
    const errorType = this.detectErrorType(errorMsg);

    const formatted: FormattedError = {
      type: errorType,
      message: errorMsg,
      suggestions: this.generateSuggestions(errorType, errorMsg, context),
    };

    return this.renderError(formatted);
  }

  /**
   * Detect the type of error from the error message
   */
  private detectErrorType(errorMsg: string): string {
    if (errorMsg.includes('ENOENT') || errorMsg.includes('no such file')) {
      return 'FILE_NOT_FOUND';
    }
    if (errorMsg.includes('EACCES') || errorMsg.includes('permission denied')) {
      return 'PERMISSION_DENIED';
    }
    if (errorMsg.includes('EISDIR')) {
      return 'IS_DIRECTORY';
    }
    if (errorMsg.includes('ENOTDIR')) {
      return 'NOT_DIRECTORY';
    }
    if (errorMsg.includes('EEXIST') || errorMsg.includes('already exists')) {
      return 'ALREADY_EXISTS';
    }
    if (errorMsg.includes('EMFILE') || errorMsg.includes('too many open files')) {
      return 'TOO_MANY_FILES';
    }
    if (errorMsg.includes('SyntaxError') || errorMsg.includes('JSON.parse')) {
      return 'SYNTAX_ERROR';
    }
    if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
      return 'TIMEOUT';
    }
    if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('connection refused')) {
      return 'CONNECTION_REFUSED';
    }

    return 'UNKNOWN';
  }

  /**
   * Generate helpful suggestions based on error type
   */
  private generateSuggestions(errorType: string, errorMsg: string, context?: {file?: string; args?: Record<string, any>}): string[] {
    const suggestions: string[] = [];

    switch (errorType) {
      case 'FILE_NOT_FOUND':
        if (context?.file) {
          // Try to find similar files
          const similarFiles = this.findSimilarFiles(context.file);
          if (similarFiles.length > 0) {
            suggestions.push('Did you mean:');
            similarFiles.slice(0, 3).forEach(file => {
              suggestions.push(`  - ${file}`);
            });
          } else {
            suggestions.push('File does not exist. Check the path and try again.');
            suggestions.push('Use list_files to see available files in the directory.');
          }
        }
        break;

      case 'PERMISSION_DENIED':
        suggestions.push('Permission denied. Check file permissions.');
        if (process.platform !== 'win32') {
          suggestions.push('You may need to run with elevated permissions or change file ownership.');
        }
        break;

      case 'IS_DIRECTORY':
        suggestions.push('Target is a directory, not a file.');
        suggestions.push('Use list_files to list directory contents.');
        break;

      case 'ALREADY_EXISTS':
        suggestions.push('File or directory already exists.');
        suggestions.push('Use patch_file to modify existing files.');
        suggestions.push('Or use create_file with overwrite=true to replace it.');
        break;

      case 'SYNTAX_ERROR':
        suggestions.push('Invalid syntax in JSON or code.');
        suggestions.push('Check for:');
        suggestions.push('  - Missing or extra commas');
        suggestions.push('  - Unmatched brackets or quotes');
        suggestions.push('  - Invalid escape sequences');
        break;

      case 'TIMEOUT':
        suggestions.push('Operation timed out.');
        suggestions.push('The request took too long to complete.');
        suggestions.push('Try again or check network connectivity.');
        break;

      case 'CONNECTION_REFUSED':
        suggestions.push('Connection refused. The server may be down or unreachable.');
        suggestions.push('Check network connectivity and server status.');
        break;

      default:
        // Generic suggestions
        suggestions.push('Check the error message for details.');
        suggestions.push('Review the tool parameters and try again.');
    }

    return suggestions;
  }

  /**
   * Find similar file names in the directory
   */
  private findSimilarFiles(targetPath: string): string[] {
    try {
      const dir = path.dirname(targetPath);
      const fileName = path.basename(targetPath);

      if (!fs.existsSync(dir)) {
        return [];
      }

      const files = fs.readdirSync(dir);

      // Calculate Levenshtein distance and find similar files
      const similarities = files.map(file => ({
        file: path.join(dir, file),
        distance: this.levenshteinDistance(fileName.toLowerCase(), file.toLowerCase()),
      }));

      // Return files with small edit distance
      return similarities
        .filter(s => s.distance <= 3)
        .sort((a, b) => a.distance - b.distance)
        .map(s => s.file);
    } catch (error) {
      return [];
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Render the error in a structured format
   */
  private renderError(error: FormattedError): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(chalk.red.bold('<error>'));
    lines.push(chalk.red('  <tool_use_error>'));
    lines.push(simpleIndent(error.message, 4));

    if (error.suggestions && error.suggestions.length > 0) {
      lines.push('');
      for (const suggestion of error.suggestions) {
        if (suggestion.startsWith('  -')) {
          lines.push(simpleIndent(chalk.yellow(suggestion), 4));
        } else {
          lines.push(simpleIndent(chalk.dim(suggestion), 4));
        }
      }
    }

    if (error.details) {
      lines.push('');
      lines.push(simpleIndent(chalk.dim('Details:'), 4));
      lines.push(simpleIndent(error.details, 4));
    }

    lines.push(chalk.red('  </tool_use_error>'));
    lines.push(chalk.red('</error>'));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format a stack trace with syntax highlighting
   */
  formatStackTrace(stack: string): string {
    const lines = stack.split('\n');
    const formatted: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith('at ')) {
        // Stack frame
        const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
          const [, funcName, file, lineNum, col] = match;
          formatted.push(
            chalk.gray('  at ') +
            chalk.cyan(funcName) +
            chalk.gray(' (') +
            chalk.white(file) +
            chalk.gray(':') +
            chalk.yellow(lineNum) +
            chalk.gray(':') +
            chalk.yellow(col) +
            chalk.gray(')')
          );
        } else {
          formatted.push(chalk.gray(line));
        }
      } else {
        // Error message
        formatted.push(chalk.red(line));
      }
    }

    return formatted.join('\n');
  }
}

// Export singleton instance
export const errorFormatter = new ErrorFormatter();
