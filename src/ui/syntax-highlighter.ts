// Syntax highlighting for code blocks in terminal output

import chalk from 'chalk';

/**
 * Simple syntax highlighter for common languages
 * Uses ANSI color codes for terminal display
 */
export class SyntaxHighlighter {
  /**
   * Highlight code based on language
   */
  highlight(code: string, language: string = 'text'): string {
    const lang = language.toLowerCase();

    switch (lang) {
      case 'typescript':
      case 'ts':
      case 'javascript':
      case 'js':
        return this.highlightJavaScript(code);
      case 'python':
      case 'py':
        return this.highlightPython(code);
      case 'rust':
      case 'rs':
        return this.highlightRust(code);
      case 'json':
        return this.highlightJSON(code);
      case 'bash':
      case 'sh':
      case 'shell':
        return this.highlightBash(code);
      case 'sql':
        return this.highlightSQL(code);
      default:
        return code; // No highlighting for unknown languages
    }
  }

  /**
   * Highlight JavaScript/TypeScript code
   */
  private highlightJavaScript(code: string): string {
    const keywords = [
      'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
      'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
      'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
      'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'package',
      'private', 'protected', 'public', 'return', 'set', 'static', 'super', 'switch',
      'this', 'throw', 'true', 'try', 'type', 'typeof', 'var', 'void', 'while', 'with',
      'yield',
    ];

    let highlighted = code;

    // Keywords
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
      highlighted = highlighted.replace(regex, chalk.blue('$1'));
    }

    // Strings (single and double quotes)
    highlighted = highlighted.replace(/(['"`])((?:\\.|(?!\1).)*?)\1/g, (_match, quote, content) => {
      return chalk.green(quote + content + quote);
    });

    // Comments
    highlighted = highlighted.replace(/(\/\/.*$)/gm, chalk.gray('$1'));
    highlighted = highlighted.replace(/(\/\*[\s\S]*?\*\/)/g, chalk.gray('$1'));

    // Numbers
    highlighted = highlighted.replace(/\b(\d+(\.\d+)?)\b/g, chalk.yellow('$1'));

    // Function names
    highlighted = highlighted.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, chalk.cyan('$1') + '(');

    return highlighted;
  }

  /**
   * Highlight Python code
   */
  private highlightPython(code: string): string {
    const keywords = [
      'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
      'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global',
      'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass',
      'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
    ];

    let highlighted = code;

    // Keywords
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
      highlighted = highlighted.replace(regex, chalk.blue('$1'));
    }

    // Strings
    highlighted = highlighted.replace(/(['"])((?:\\.|(?!\1).)*?)\1/g, (_match, quote, content) => {
      return chalk.green(quote + content + quote);
    });

    // Comments
    highlighted = highlighted.replace(/(#.*$)/gm, chalk.gray('$1'));

    // Numbers
    highlighted = highlighted.replace(/\b(\d+(\.\d+)?)\b/g, chalk.yellow('$1'));

    // Function names
    highlighted = highlighted.replace(/\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, 'def ' + chalk.cyan('$1'));

    return highlighted;
  }

  /**
   * Highlight Rust code
   */
  private highlightRust(code: string): string {
    const keywords = [
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else',
      'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
      'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static',
      'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
    ];

    let highlighted = code;

    // Keywords
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
      highlighted = highlighted.replace(regex, chalk.blue('$1'));
    }

    // Strings
    highlighted = highlighted.replace(/("(?:\\.|[^"\\])*")/g, chalk.green('$1'));

    // Comments
    highlighted = highlighted.replace(/(\/\/.*$)/gm, chalk.gray('$1'));
    highlighted = highlighted.replace(/(\/\*[\s\S]*?\*\/)/g, chalk.gray('$1'));

    // Numbers
    highlighted = highlighted.replace(/\b(\d+(\.\d+)?)\b/g, chalk.yellow('$1'));

    // Function names
    highlighted = highlighted.replace(/\bfn\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, 'fn ' + chalk.cyan('$1'));

    return highlighted;
  }

  /**
   * Highlight JSON
   */
  private highlightJSON(code: string): string {
    let highlighted = code;

    // Keys
    highlighted = highlighted.replace(/("([^"\\]|\\.)*")(\s*:)/g, chalk.cyan('$1') + '$3');

    // Strings (values)
    highlighted = highlighted.replace(/:\s*("([^"\\]|\\.)*")/g, ': ' + chalk.green('$1'));

    // Numbers
    highlighted = highlighted.replace(/:\s*(-?\d+(\.\d+)?([eE][+-]?\d+)?)/g, ': ' + chalk.yellow('$1'));

    // Booleans and null
    highlighted = highlighted.replace(/\b(true|false|null)\b/g, chalk.blue('$1'));

    return highlighted;
  }

  /**
   * Highlight Bash/Shell scripts
   */
  private highlightBash(code: string): string {
    const keywords = [
      'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until',
      'do', 'done', 'in', 'function', 'select', 'time', 'coproc',
    ];

    let highlighted = code;

    // Keywords
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
      highlighted = highlighted.replace(regex, chalk.blue('$1'));
    }

    // Strings
    highlighted = highlighted.replace(/(['"])((?:\\.|(?!\1).)*?)\1/g, (_match, quote, content) => {
      return chalk.green(quote + content + quote);
    });

    // Comments
    highlighted = highlighted.replace(/(#.*$)/gm, chalk.gray('$1'));

    // Variables
    highlighted = highlighted.replace(/(\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?)/g, chalk.yellow('$1'));

    // Commands (basic)
    highlighted = highlighted.replace(/\b(echo|cd|ls|pwd|mkdir|rm|cp|mv|cat|grep|sed|awk)\b/g, chalk.cyan('$1'));

    return highlighted;
  }

  /**
   * Highlight SQL
   */
  private highlightSQL(code: string): string {
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
      'ALTER', 'TABLE', 'INDEX', 'VIEW', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER',
      'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'BETWEEN', 'LIKE', 'ORDER',
      'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'DISTINCT', 'COUNT', 'SUM',
      'AVG', 'MIN', 'MAX',
    ];

    let highlighted = code;

    // Keywords (case insensitive)
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
      highlighted = highlighted.replace(regex, chalk.blue('$1'));
    }

    // Strings
    highlighted = highlighted.replace(/('(?:[^']|'')*')/g, chalk.green('$1'));

    // Numbers
    highlighted = highlighted.replace(/\b(\d+(\.\d+)?)\b/g, chalk.yellow('$1'));

    // Comments
    highlighted = highlighted.replace(/(--.*$)/gm, chalk.gray('$1'));
    highlighted = highlighted.replace(/(\/\*[\s\S]*?\*\/)/g, chalk.gray('$1'));

    return highlighted;
  }
}

/**
 * Code block detector for streaming content
 * Detects when code blocks start and end in markdown
 */
export class CodeBlockDetector {
  private inCodeBlock = false;
  private currentLanguage = '';
  private currentBlockContent = '';

  /**
   * Parse a chunk of text and detect code blocks
   */
  parse(chunk: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> {
    const blocks: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];

    // Check for code block markers only at line boundaries
    if (chunk.includes('```')) {
      // Has potential code block markers - process line by line
      const lines = chunk.split('\n');
      let currentText = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isLastLine = i === lines.length - 1;
        const lineWithNewline = isLastLine ? line : line + '\n';

        // Check for code block markers
        const codeBlockMatch = line.match(/^```(\w+)?/);

        if (codeBlockMatch) {
          // Flush any accumulated text
          if (currentText) {
            blocks.push({ type: 'text', content: currentText });
            currentText = '';
          }

          if (!this.inCodeBlock) {
            // Starting a code block
            this.inCodeBlock = true;
            this.currentLanguage = codeBlockMatch[1] || 'text';
            this.currentBlockContent = '';
          } else {
            // Ending a code block
            blocks.push({
              type: 'code',
              content: this.currentBlockContent,
              language: this.currentLanguage,
            });
            this.inCodeBlock = false;
            this.currentLanguage = '';
            this.currentBlockContent = '';
          }
        } else {
          if (this.inCodeBlock) {
            // Inside code block
            this.currentBlockContent += lineWithNewline;
          } else {
            // Regular text
            currentText += lineWithNewline;
          }
        }
      }

      // Flush remaining content
      if (currentText) {
        blocks.push({ type: 'text', content: currentText });
      }
    } else {
      // No code blocks - return chunk as-is (preserves streaming without adding newlines)
      if (this.inCodeBlock) {
        this.currentBlockContent += chunk;
      } else {
        blocks.push({ type: 'text', content: chunk });
      }
    }

    return blocks;
  }

  /**
   * Check if currently inside a code block
   */
  isInCodeBlock(): boolean {
    return this.inCodeBlock;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.inCodeBlock = false;
    this.currentLanguage = '';
    this.currentBlockContent = '';
  }
}

// Export singleton instance
export const syntaxHighlighter = new SyntaxHighlighter();
