// Input handler with proper arrow key and editing support

import chalk from 'chalk';

export interface InputLine {
  text: string;
  cursor: number; // Cursor position within the line
}

export class Input {
  private lines: string[] = [];
  private currentLine = '';
  private cursorPosition = 0;
  private commandHistory: string[] = [];
  private historyIndex = -1;
  private isPasting = false;
  private lastInputTime = Date.now();
  private isActive = false;

  constructor(private availableCommands: string[] = []) {}

  /**
   * Read input with full editing capabilities
   */
  async read(promptText: string = chalk.green('You: ')): Promise<string> {
    return new Promise((resolve, reject) => {
      this.isActive = true;
      this.currentLine = '';
      this.cursorPosition = 0;
      this.lines = [];

      // Enable raw mode
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      // Show prompt
      process.stdout.write(promptText);

      const cleanup = () => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
        this.isActive = false;
      };

      const finish = (result: string) => {
        cleanup();
        process.stdout.write('\n');
        resolve(result);
      };

      const onData = (chunk: string) => {
        const now = Date.now();
        const timeSinceLastInput = now - this.lastInputTime;
        this.lastInputTime = now;

        // Detect paste
        if (chunk.length > 1 || timeSinceLastInput < 10) {
          this.isPasting = true;
        }

        let i = 0;
        while (i < chunk.length) {
          const char = chunk[i];

          // Check for escape sequences (arrow keys, etc.)
          if (char === '\x1b') {
            const seq = chunk.slice(i, i + 3);

            // Arrow keys
            if (seq === '\x1b[A') {
              // Up arrow - navigate history
              this.navigateHistory('up', promptText);
              i += 3;
              continue;
            } else if (seq === '\x1b[B') {
              // Down arrow - navigate history
              this.navigateHistory('down', promptText);
              i += 3;
              continue;
            } else if (seq === '\x1b[C') {
              // Right arrow - move cursor right
              this.moveCursor('right');
              i += 3;
              continue;
            } else if (seq === '\x1b[D') {
              // Left arrow - move cursor left
              this.moveCursor('left');
              i += 3;
              continue;
            }

            // Home/End keys
            const extSeq = chunk.slice(i, i + 4);
            if (extSeq === '\x1b[H' || extSeq.startsWith('\x1b[1~')) {
              // Home - move to start
              this.moveCursorToStart();
              i += extSeq.length;
              continue;
            } else if (extSeq === '\x1b[F' || extSeq.startsWith('\x1b[4~')) {
              // End - move to end
              this.moveCursorToEnd();
              i += extSeq.length;
              continue;
            }

            // Delete key
            if (extSeq.startsWith('\x1b[3~')) {
              this.deleteChar();
              i += 4;
              continue;
            }

            // Skip other escape sequences
            i++;
            continue;
          }

          // Ctrl+C - cancel
          if (char === '\x03') {
            cleanup();
            process.stdout.write('\n');
            resolve('');
            return;
          }

          // Ctrl+D - submit if line is empty, otherwise delete forward
          if (char === '\x04') {
            if (this.currentLine.length === 0 && this.lines.length === 0) {
              finish('');
              return;
            } else {
              this.deleteChar();
              i++;
              continue;
            }
          }

          // Ctrl+A - move to start
          if (char === '\x01') {
            this.moveCursorToStart();
            i++;
            continue;
          }

          // Ctrl+E - move to end
          if (char === '\x05') {
            this.moveCursorToEnd();
            i++;
            continue;
          }

          // Ctrl+U - clear line
          if (char === '\x15') {
            this.clearLine(promptText);
            i++;
            continue;
          }

          // Ctrl+K - delete to end of line
          if (char === '\x0b') {
            this.deleteToEnd();
            i++;
            continue;
          }

          // Ctrl+W - delete word backwards
          if (char === '\x17') {
            this.deleteWordBackward(promptText);
            i++;
            continue;
          }

          // Enter/Return
          if (char === '\r' || char === '\n') {
            if (this.isPasting) {
              // During paste, collect the line
              this.lines.push(this.currentLine);
              this.currentLine = '';
              this.cursorPosition = 0;
              process.stdout.write('\n' + promptText);
            } else if (this.currentLine === '' && this.lines.length > 0) {
              // Empty line after content = submit (double-enter)
              const result = this.lines.join('\n').trim();
              this.addToHistory(result);
              finish(result);
              return;
            } else {
              // Single enter = submit
              if (this.lines.length === 0 && this.currentLine) {
                const result = this.currentLine.trim();
                this.addToHistory(result);
                finish(result);
                return;
              }
              this.lines.push(this.currentLine);
              this.currentLine = '';
              this.cursorPosition = 0;
              process.stdout.write('\n' + promptText);
            }
            i++;
            continue;
          }

          // Backspace
          if (char === '\x7f' || char === '\b') {
            this.backspace();
            i++;
            continue;
          }

          // Tab - autocomplete
          if (char === '\t') {
            this.autocomplete(promptText);
            i++;
            continue;
          }

          // Regular character
          if (char >= ' ' || char === '\t') {
            this.insertChar(char);
            i++;
            continue;
          }

          i++;
        }

        // After paste detected, set timeout to finalize
        if (this.isPasting) {
          setTimeout(() => {
            if (Date.now() - this.lastInputTime >= 50) {
              this.isPasting = false;
            }
          }, 50);
        }
      };

      process.stdin.on('data', onData);
    });
  }

  private insertChar(char: string): void {
    // Insert character at cursor position
    this.currentLine =
      this.currentLine.slice(0, this.cursorPosition) +
      char +
      this.currentLine.slice(this.cursorPosition);

    this.cursorPosition++;

    // Redraw from cursor position
    const afterCursor = this.currentLine.slice(this.cursorPosition);
    process.stdout.write(char + afterCursor);

    // Move cursor back to correct position
    if (afterCursor.length > 0) {
      process.stdout.write('\x1b[' + afterCursor.length + 'D');
    }
  }

  private backspace(): void {
    if (this.cursorPosition > 0) {
      this.currentLine =
        this.currentLine.slice(0, this.cursorPosition - 1) +
        this.currentLine.slice(this.cursorPosition);

      this.cursorPosition--;

      // Redraw line from cursor
      const afterCursor = this.currentLine.slice(this.cursorPosition);
      process.stdout.write('\b' + afterCursor + ' ');

      // Move cursor back
      process.stdout.write('\x1b[' + (afterCursor.length + 1) + 'D');
    }
  }

  private deleteChar(): void {
    if (this.cursorPosition < this.currentLine.length) {
      this.currentLine =
        this.currentLine.slice(0, this.cursorPosition) +
        this.currentLine.slice(this.cursorPosition + 1);

      // Redraw from cursor
      const afterCursor = this.currentLine.slice(this.cursorPosition);
      process.stdout.write(afterCursor + ' ');

      // Move cursor back
      process.stdout.write('\x1b[' + (afterCursor.length + 1) + 'D');
    }
  }

  private moveCursor(direction: 'left' | 'right'): void {
    if (direction === 'left' && this.cursorPosition > 0) {
      this.cursorPosition--;
      process.stdout.write('\x1b[D');
    } else if (direction === 'right' && this.cursorPosition < this.currentLine.length) {
      this.cursorPosition++;
      process.stdout.write('\x1b[C');
    }
  }

  private moveCursorToStart(): void {
    if (this.cursorPosition > 0) {
      process.stdout.write('\x1b[' + this.cursorPosition + 'D');
      this.cursorPosition = 0;
    }
  }

  private moveCursorToEnd(): void {
    const distance = this.currentLine.length - this.cursorPosition;
    if (distance > 0) {
      process.stdout.write('\x1b[' + distance + 'C');
      this.cursorPosition = this.currentLine.length;
    }
  }

  private clearLine(promptText: string): void {
    // Clear entire line
    process.stdout.write('\r' + ' '.repeat(promptText.length + this.currentLine.length + 10) + '\r');
    process.stdout.write(promptText);
    this.currentLine = '';
    this.cursorPosition = 0;
  }

  private deleteToEnd(): void {
    if (this.cursorPosition < this.currentLine.length) {
      const deleted = this.currentLine.slice(this.cursorPosition);
      this.currentLine = this.currentLine.slice(0, this.cursorPosition);

      // Clear to end of line
      process.stdout.write(' '.repeat(deleted.length));
      process.stdout.write('\x1b[' + deleted.length + 'D');
    }
  }

  private deleteWordBackward(promptText: string): void {
    if (this.cursorPosition === 0) return;

    const before = this.currentLine.slice(0, this.cursorPosition);
    const after = this.currentLine.slice(this.cursorPosition);

    // Find start of word
    let pos = this.cursorPosition - 1;
    while (pos > 0 && before[pos] === ' ') pos--;
    while (pos > 0 && before[pos - 1] !== ' ') pos--;

    this.currentLine = before.slice(0, pos) + after;
    const deletedCount = this.cursorPosition - pos;

    // Redraw
    process.stdout.write('\x1b[' + deletedCount + 'D');
    process.stdout.write(after + ' '.repeat(deletedCount));
    process.stdout.write('\x1b[' + (after.length + deletedCount) + 'D');

    this.cursorPosition = pos;
  }

  private navigateHistory(direction: 'up' | 'down', promptText: string): void {
    if (this.commandHistory.length === 0) return;

    if (direction === 'up') {
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        this.replaceCurrentLine(this.commandHistory[this.commandHistory.length - 1 - this.historyIndex], promptText);
      }
    } else {
      if (this.historyIndex > -1) {
        this.historyIndex--;
        if (this.historyIndex === -1) {
          this.replaceCurrentLine('', promptText);
        } else {
          this.replaceCurrentLine(this.commandHistory[this.commandHistory.length - 1 - this.historyIndex], promptText);
        }
      }
    }
  }

  private replaceCurrentLine(newText: string, promptText: string): void {
    // Clear current line
    this.clearLine(promptText);

    // Set new text
    this.currentLine = newText;
    this.cursorPosition = newText.length;

    // Display new text
    process.stdout.write(newText);
  }

  private autocomplete(promptText: string): void {
    if (!this.currentLine.startsWith('/')) return;

    const currentInput = this.currentLine.slice(1);
    const matches = this.availableCommands.filter(cmd =>
      cmd.toLowerCase().startsWith(currentInput.toLowerCase())
    );

    if (matches.length === 1) {
      // Single match - complete
      const completed = '/' + matches[0];
      this.replaceCurrentLine(completed, promptText);
    } else if (matches.length > 1) {
      // Multiple matches - show options
      const commonPrefix = this.getCommonPrefix(matches);
      if (commonPrefix.length > currentInput.length) {
        this.replaceCurrentLine('/' + commonPrefix, promptText);
      } else {
        // Show suggestions
        process.stdout.write('\n' + chalk.dim('  ' + matches.join('  ')) + '\n');
        process.stdout.write(promptText + this.currentLine);
      }
    }
  }

  private getCommonPrefix(strings: string[]): string {
    if (strings.length === 0) return '';
    if (strings.length === 1) return strings[0];

    const first = strings[0];
    let commonLength = first.length;

    for (let i = 1; i < strings.length; i++) {
      const current = strings[i];
      let j = 0;
      while (j < Math.min(commonLength, current.length) &&
             first[j].toLowerCase() === current[j].toLowerCase()) {
        j++;
      }
      commonLength = j;
    }

    return first.slice(0, commonLength);
  }

  private addToHistory(text: string): void {
    if (text.trim() && text !== this.commandHistory[this.commandHistory.length - 1]) {
      this.commandHistory.push(text);
      // Keep last 100 commands
      if (this.commandHistory.length > 100) {
        this.commandHistory.shift();
      }
    }
    this.historyIndex = -1;
  }

  getHistory(): string[] {
    return [...this.commandHistory];
  }

  clearHistory(): void {
    this.commandHistory = [];
    this.historyIndex = -1;
  }
}
