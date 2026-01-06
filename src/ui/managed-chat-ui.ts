/**
 * ManagedChatUI - Chat interface using RenderManager for coordinated rendering
 *
 * All screen regions are managed through RenderManager, ensuring no conflicts
 * between different UI components updating simultaneously.
 */

import chalk from 'chalk';
import { RenderManager, createRenderManager, setRenderManager } from './render-manager.js';
import { HeaderRegion, StatusRegion, TaskRegion, InputRegion, SpinnerRegion, OutputRegion } from './regions/index.js';
import type { StatusInfo } from './regions/status-region.js';
import type { TaskInfo } from './regions/task-region.js';

export interface ManagedChatUIConfig {
  showHeader: boolean;
  showStatusBar: boolean;
  showTaskBar: boolean;
  updateInterval: number;
  renderMode: 'screen' | 'scrollback';
}

const DEFAULT_CONFIG: ManagedChatUIConfig = {
  showHeader: true,
  showStatusBar: true,
  showTaskBar: true,
  updateInterval: 1000,
  renderMode: 'screen',
};

/**
 * Chat UI with managed rendering through RenderManager
 */
export class ManagedChatUI {
  private config: ManagedChatUIConfig;
  private renderManager: RenderManager;
  private headerRegion: HeaderRegion;
  private statusRegion: StatusRegion;
  private taskRegion: TaskRegion;
  private inputRegion: InputRegion;
  private spinnerRegion: SpinnerRegion;
  private outputRegion: OutputRegion;
  private updateTimer?: NodeJS.Timeout;
  private isInitialized = false;

  // Input handling
  private inputBuffer = '';
  private inputCursor = 0;
  private inputHistory: string[] = [];
  private historyIndex = -1;
  private inputResolve?: (value: string) => void;

  // Available commands for autocomplete
  private static readonly AVAILABLE_COMMANDS = [
    'help',
    'clear',
    'exit',
    'quit',
    'paste',
    'editor',
    'context',
    'memory',
    'debt',
    'tasks',
    'plugins',
    'sessions',
    'new-session',
    'resume',
    'ralph-loop',
  ];

  constructor(config: Partial<ManagedChatUIConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create render manager
    this.renderManager = createRenderManager({ renderMode: this.config.renderMode });

    // Create regions
    this.headerRegion = new HeaderRegion();
    this.statusRegion = new StatusRegion();
    this.taskRegion = new TaskRegion();
    this.inputRegion = new InputRegion();
    this.spinnerRegion = new SpinnerRegion();
    this.outputRegion = new OutputRegion();
  }

  /**
   * Initialize the UI
   */
  initialize(): void {
    if (this.isInitialized) return;

    // Initialize render manager
    this.renderManager.initialize();

    // Attach regions to render manager
    // Order matters for z-index layering
    this.outputRegion.attach(this.renderManager);

    if (this.config.showHeader) {
      this.headerRegion.attach(this.renderManager);
    }

    if (this.config.showStatusBar) {
      this.statusRegion.attach(this.renderManager);
    }

    if (this.config.showTaskBar) {
      this.taskRegion.attach(this.renderManager);
    }

    this.inputRegion.attach(this.renderManager);
    this.spinnerRegion.attach(this.renderManager);

    // Register input region for cursor positioning
    this.renderManager.setInputRegion('input');

    // Start listening to UI state changes
    this.outputRegion.startListening();

    if (this.config.showHeader) {
      this.headerRegion.startListening();
    }

    if (this.config.showStatusBar) {
      this.statusRegion.startListening();
    }

    if (this.config.showTaskBar) {
      this.taskRegion.startListening();
    }

    // Start update timer
    if (this.config.updateInterval > 0) {
      this.updateTimer = setInterval(() => {
        this.renderManager.forceRender();
      }, this.config.updateInterval);
    }

    this.isInitialized = true;
  }

  /**
   * Shutdown the UI
   */
  shutdown(): void {
    if (!this.isInitialized) return;

    // Stop timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    // Stop listening to state changes
    this.outputRegion.stopListening();
    this.headerRegion.stopListening();
    this.statusRegion.stopListening();
    this.taskRegion.stopListening();

    // Detach regions
    this.statusRegion.detach();
    this.taskRegion.detach();
    this.inputRegion.detach();
    this.spinnerRegion.detach();
    this.outputRegion.detach();
    this.headerRegion.detach();

    // Shutdown render manager
    this.renderManager.shutdown();
    setRenderManager(null);

    this.isInitialized = false;
  }

  // ============================================
  // Output Methods
  // ============================================

  /**
   * Write a line to output
   */
  writeLine(content: string): void {
    this.outputRegion.writeLine(content);
  }

  /**
   * Write user message
   */
  showUserMessage(message: string): void {
    this.outputRegion.writeUserMessage(message);
  }

  /**
   * Write assistant message
   */
  showAssistantMessage(message: string): void {
    this.outputRegion.writeAssistantMessage(message);
  }

  /**
   * Write tool execution
   */
  showToolExecution(toolName: string, params?: string): void {
    this.outputRegion.writeToolExecution(toolName, params);
  }

  /**
   * Write error
   */
  showError(message: string, hint?: string): void {
    this.outputRegion.writeError(message, hint);
  }

  /**
   * Write success
   */
  showSuccess(message: string): void {
    this.outputRegion.writeSuccess(message);
  }

  /**
   * Write warning
   */
  showWarning(message: string): void {
    this.outputRegion.writeWarning(message);
  }

  /**
   * Write info
   */
  showInfo(message: string): void {
    this.outputRegion.writeInfo(message);
  }

  /**
   * Write separator
   */
  showSeparator(): void {
    this.outputRegion.writeSeparator();
  }

  /**
   * Show welcome header
   */
  showWelcome(providerInfo: string, directory: string): void {
    // Kept for API compatibility; prefer the pinned HeaderRegion for UI chrome.
    this.outputRegion.writeInfo(`Provider: ${providerInfo}`);
    this.outputRegion.writeLine(chalk.dim(`  Directory: ${directory}`));
  }

  /**
   * Show help
   */
  showHelp(): void {
    this.outputRegion.writeHeader('📖 Available Commands');

    const commands = [
      { cmd: '/help', desc: 'Show this help message' },
      { cmd: '/paste', desc: 'Open editor for long/multiline input' },
      { cmd: '/clear', desc: 'Clear conversation history' },
      { cmd: '/context', desc: 'Show context/token usage' },
      { cmd: '/memory', desc: 'Show memory status' },
      { cmd: '/tasks', desc: 'Show task list' },
      { cmd: '/exit', desc: 'Exit the chat' },
    ];

    for (const { cmd, desc } of commands) {
      this.outputRegion.writeLine(`  ${chalk.cyan(cmd.padEnd(15))} ${chalk.gray(desc)}`);
    }
    this.outputRegion.writeLine('');
  }

  /**
   * Clear output
   */
  clearOutput(): void {
    this.outputRegion.clear();
  }

  // ============================================
  // Streaming Output
  // ============================================

  /**
   * Start streaming response
   */
  startStreaming(prefix?: string): void {
    this.outputRegion.startStream(prefix || chalk.cyan('Assistant:'));
  }

  /**
   * Stream content
   */
  streamContent(content: string): void {
    this.outputRegion.streamContent(content);
  }

  /**
   * End streaming
   */
  endStreaming(): void {
    this.outputRegion.endStream();
  }

  // ============================================
  // Status Updates
  // ============================================

  /**
   * Update status bar
   */
  updateStatus(info: Partial<StatusInfo>): void {
    this.statusRegion.updateStatus(info);
  }

  /**
   * Update task bar
   */
  updateTasks(currentTask: TaskInfo | null, allTasks: TaskInfo[]): void {
    this.taskRegion.updateTasks(currentTask, allTasks);
  }

  // ============================================
  // Spinner
  // ============================================

  /**
   * Start spinner
   */
  startSpinner(message: string): void {
    this.spinnerRegion.start(message);
  }

  /**
   * Update spinner message
   */
  updateSpinner(message: string): void {
    this.spinnerRegion.updateMessage(message);
  }

  /**
   * Stop spinner with success
   */
  spinnerSucceed(message?: string): void {
    this.spinnerRegion.succeed(message);
  }

  /**
   * Stop spinner with failure
   */
  spinnerFail(message?: string): void {
    this.spinnerRegion.fail(message);
  }

  /**
   * Clear spinner
   */
  clearSpinner(): void {
    this.spinnerRegion.clear();
  }

  // ============================================
  // Input Handling
  // ============================================

  /**
   * Read input from user
   */
  async readInput(): Promise<string> {
    return new Promise((resolve) => {
      this.inputResolve = resolve;
      this.inputBuffer = '';
      this.inputCursor = 0;
      this.historyIndex = -1;
      this.inputRegion.updateInput('', 0);

      // Set up raw mode input
      this.startRawInput();
    });
  }

  private startRawInput(): void {
    if (!process.stdin.isTTY) {
      // Non-TTY mode - just read line
      this.readLineInput();
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (chunk: string) => {
      for (const char of chunk) {
        this.handleInputChar(char, onData);
      }
    };

    process.stdin.on('data', onData);
  }

  private handleInputChar(char: string, cleanupFn: (chunk: string) => void): void {
    // Ctrl+C - cancel/interrupt
    if (char === '\x03') {
      this.finishInput('', cleanupFn);
      return;
    }

    // Ctrl+D - submit
    if (char === '\x04') {
      this.finishInput(this.inputBuffer, cleanupFn);
      return;
    }

    // Enter - submit
    if (char === '\r' || char === '\n') {
      const input = this.inputBuffer.trim();
      if (input) {
        this.inputHistory.push(input);
      }
      this.finishInput(input, cleanupFn);
      return;
    }

    // Backspace
    if (char === '\x7f' || char === '\b') {
      if (this.inputCursor > 0) {
        this.inputBuffer =
          this.inputBuffer.slice(0, this.inputCursor - 1) +
          this.inputBuffer.slice(this.inputCursor);
        this.inputCursor--;
        this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      }
      return;
    }

    // Escape sequences (arrows, etc.)
    if (char === '\x1b') {
      return; // Start of escape sequence - handled with next chars
    }

    // Arrow keys (after escape)
    if (char === '[') {
      return; // Part of escape sequence
    }

    // Up arrow - history
    if (char === 'A' && this.inputBuffer === '') {
      if (this.historyIndex < this.inputHistory.length - 1) {
        this.historyIndex++;
        this.inputBuffer = this.inputHistory[this.inputHistory.length - 1 - this.historyIndex];
        this.inputCursor = this.inputBuffer.length;
        this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      }
      return;
    }

    // Down arrow - history
    if (char === 'B' && this.historyIndex >= 0) {
      this.historyIndex--;
      if (this.historyIndex < 0) {
        this.inputBuffer = '';
      } else {
        this.inputBuffer = this.inputHistory[this.inputHistory.length - 1 - this.historyIndex];
      }
      this.inputCursor = this.inputBuffer.length;
      this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      return;
    }

    // Left arrow
    if (char === 'D') {
      if (this.inputCursor > 0) {
        this.inputCursor--;
        this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      }
      return;
    }

    // Right arrow
    if (char === 'C') {
      if (this.inputCursor < this.inputBuffer.length) {
        this.inputCursor++;
        this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      }
      return;
    }

    // Ctrl+A - beginning of line
    if (char === '\x01') {
      this.inputCursor = 0;
      this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      return;
    }

    // Ctrl+E - end of line
    if (char === '\x05') {
      this.inputCursor = this.inputBuffer.length;
      this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      return;
    }

    // Ctrl+U - clear line
    if (char === '\x15') {
      this.inputBuffer = '';
      this.inputCursor = 0;
      this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      return;
    }

    // Tab - autocomplete
    if (char === '\t') {
      this.handleAutocomplete();
      return;
    }

    // Regular character
    if (char >= ' ') {
      this.inputBuffer =
        this.inputBuffer.slice(0, this.inputCursor) +
        char +
        this.inputBuffer.slice(this.inputCursor);
      this.inputCursor++;
      this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
    }
  }

  private handleAutocomplete(): void {
    // Only autocomplete for commands (starting with /)
    if (!this.inputBuffer.startsWith('/')) return;

    const currentInput = this.inputBuffer.slice(1);
    const matches = ManagedChatUI.AVAILABLE_COMMANDS.filter(cmd =>
      cmd.toLowerCase().startsWith(currentInput.toLowerCase())
    );

    if (matches.length === 1) {
      // Single match - complete
      this.inputBuffer = '/' + matches[0];
      this.inputCursor = this.inputBuffer.length;
      this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
    } else if (matches.length > 1) {
      // Multiple matches - use common prefix
      const commonPrefix = this.getCommonPrefix(matches);
      if (commonPrefix.length > currentInput.length) {
        this.inputBuffer = '/' + commonPrefix;
        this.inputCursor = this.inputBuffer.length;
        this.inputRegion.updateInput(this.inputBuffer, this.inputCursor);
      } else {
        // Show suggestions
        this.outputRegion.writeLine(chalk.dim('  ' + matches.join('  ')));
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

  private finishInput(value: string, cleanupFn: (chunk: string) => void): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeListener('data', cleanupFn);
    process.stdin.pause();

    // Clear input region
    this.inputRegion.clearInput();

    if (this.inputResolve) {
      this.inputResolve(value);
      this.inputResolve = undefined;
    }
  }

  private readLineInput(): void {
    // Fallback for non-TTY
    let data = '';
    const onData = (chunk: string) => {
      data += chunk;
      if (data.includes('\n')) {
        process.stdin.removeListener('data', onData);
        const input = data.split('\n')[0].trim();
        if (this.inputResolve) {
          this.inputResolve(input);
          this.inputResolve = undefined;
        }
      }
    };
    process.stdin.on('data', onData);
  }

  // ============================================
  // Getters
  // ============================================

  getRenderManager(): RenderManager {
    return this.renderManager;
  }

  getOutputRegion(): OutputRegion {
    return this.outputRegion;
  }

  isActive(): boolean {
    return this.isInitialized;
  }
}
