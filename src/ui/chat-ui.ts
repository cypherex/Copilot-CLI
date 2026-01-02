// Enhanced chat UI with persistent status and input

import chalk from 'chalk';
import type { CopilotAgent } from '../agent/index.js';
import { Input } from './input.js';
import { StatusBar, getStatusInfo, type StatusInfo } from './status-bar.js';
import { TaskDisplay } from '../cli/ui/task-display.js';
import { MessageQueue } from './message-queue.js';
import { PersistentInput } from './persistent-input.js';
import { SplitScreen } from './split-screen.js';

export interface ChatUIConfig {
  showStatusBar: boolean;
  showTaskPanel: boolean;
  updateInterval: number; // ms between status updates
  maxMessageLength: number;
  useSplitScreen: boolean; // Enable persistent input with split-screen layout
}

export const DEFAULT_CHAT_UI_CONFIG: ChatUIConfig = {
  showStatusBar: true,
  showTaskPanel: true,
  updateInterval: 1000,
  maxMessageLength: 10000,
  useSplitScreen: false, // Off by default for backwards compatibility
};

export class ChatUI {
  private config: ChatUIConfig;
  private input: Input;
  private statusBar: StatusBar;
  private taskDisplay: TaskDisplay;
  private updateTimer?: NodeJS.Timeout;
  private agent?: CopilotAgent;
  private isActive = false;

  // Split-screen mode components
  private messageQueue?: MessageQueue;
  private persistentInput?: PersistentInput;
  private splitScreen?: SplitScreen;

  private static AVAILABLE_COMMANDS = [
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
    'cancel-ralph',
  ];

  constructor(config: Partial<ChatUIConfig> = {}) {
    this.config = { ...DEFAULT_CHAT_UI_CONFIG, ...config };
    this.input = new Input(ChatUI.AVAILABLE_COMMANDS);
    this.statusBar = new StatusBar();
    this.taskDisplay = new TaskDisplay(6);

    // Initialize split-screen components if enabled
    if (this.config.useSplitScreen) {
      this.messageQueue = new MessageQueue();
      this.persistentInput = new PersistentInput(this.messageQueue, {
        prompt: chalk.green('You: '),
      });
      this.persistentInput.setCommands(ChatUI.AVAILABLE_COMMANDS);
      this.splitScreen = new SplitScreen(this.messageQueue, this.persistentInput);
    }
  }

  /**
   * Initialize the UI with an agent
   */
  initialize(agent: CopilotAgent): void {
    this.agent = agent;
    this.taskDisplay.initialize();
    this.isActive = true;

    // Start update timer if status bar is enabled
    if (this.config.showStatusBar) {
      this.updateTimer = setInterval(() => {
        this.refreshStatus();
      }, this.config.updateInterval);
    }

    // Initialize split-screen if enabled
    if (this.config.useSplitScreen && this.splitScreen) {
      this.splitScreen.initialize();
    }
  }

  /**
   * Shutdown the UI
   */
  shutdown(): void {
    this.isActive = false;

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    this.statusBar.hide();

    // Shutdown split-screen if active
    if (this.splitScreen) {
      this.splitScreen.shutdown();
    }
  }

  /**
   * Show the welcome header
   */
  showWelcome(providerInfo: string, directory: string, sessionId?: string, sessionTitle?: string): void {
    const width = process.stdout.columns || 80;

    console.log();
    console.log(chalk.blue.bold('┌' + '─'.repeat(width - 2) + '┐'));
    console.log(this.padLine(chalk.blue.bold('│ ') + chalk.cyan.bold('🤖 Copilot CLI Agent') + chalk.gray(' v0.1.0'), width, chalk.blue.bold('│')));
    console.log(chalk.blue.bold('├' + '─'.repeat(width - 2) + '┤'));
    console.log(this.padLine(chalk.blue.bold('│ ') + chalk.gray('Provider: ') + chalk.white(providerInfo), width, chalk.blue.bold('│')));
    console.log(this.padLine(chalk.blue.bold('│ ') + chalk.gray('Directory: ') + chalk.white(directory), width, chalk.blue.bold('│')));

    if (sessionId && sessionTitle) {
      console.log(this.padLine(
        chalk.blue.bold('│ ') + chalk.gray('Session: ') + chalk.white(sessionTitle) + chalk.dim(` (${sessionId.slice(0, 8)}...)`),
        width,
        chalk.blue.bold('│')
      ));
    }

    console.log(chalk.blue.bold('└' + '─'.repeat(width - 2) + '┘'));
    console.log();
    console.log(chalk.dim('💡 Type /help for commands, Ctrl+C to interrupt, /exit to quit'));
    console.log();
  }

  /**
   * Show the status bar and task panel
   */
  showStatusPanel(): void {
    if (!this.agent) return;

    // Show status bar
    if (this.config.showStatusBar) {
      const statusInfo = getStatusInfo(this.agent);
      this.statusBar.show(statusInfo);
    }

    // Show task panel
    if (this.config.showTaskPanel) {
      const memoryStore = this.agent.getMemoryStore();
      const tasks = memoryStore.getTasks();
      this.taskDisplay.updateTasks(tasks);
      const taskPanel = this.taskDisplay.render();
      if (taskPanel) {
        console.log(taskPanel);
      }
    }
  }

  /**
   * Refresh status information
   */
  private refreshStatus(): void {
    if (!this.agent || !this.isActive) return;

    // Update task display
    if (this.config.showTaskPanel) {
      const memoryStore = this.agent.getMemoryStore();
      const tasks = memoryStore.getTasks();
      this.taskDisplay.updateTasks(tasks);
    }
  }

  /**
   * Read user input with enhanced editing
   */
  async readInput(): Promise<string> {
    // Split-screen mode: get from message queue
    if (this.config.useSplitScreen && this.messageQueue) {
      const message = await this.messageQueue.dequeue();
      return message.content;
    }

    // Traditional mode: blocking input
    const prompt = chalk.green('You: ');
    return await this.input.read(prompt);
  }

  /**
   * Check if there are queued messages (split-screen mode only)
   */
  hasQueuedMessages(): boolean {
    if (!this.messageQueue) return false;
    return !this.messageQueue.isEmpty();
  }

  /**
   * Get next queued message without blocking (split-screen mode only)
   */
  pollQueuedMessage(): string | undefined {
    if (!this.messageQueue) return undefined;
    const message = this.messageQueue.poll();
    return message?.content;
  }

  /**
   * Get message queue (for advanced usage)
   */
  getMessageQueue(): MessageQueue | undefined {
    return this.messageQueue;
  }

  /**
   * Show a message from the assistant
   */
  showAssistantMessage(message: string): void {
    const output = chalk.cyan('Assistant:') + '\n' + message + '\n';

    if (this.splitScreen) {
      this.splitScreen.writeOutput(output);
    } else {
      console.log(chalk.cyan('Assistant:'));
      console.log(message);
      console.log();
    }
  }

  /**
   * Show a tool execution
   */
  showToolExecution(toolName: string, params?: any): void {
    const paramsStr = params ? chalk.dim(` ${JSON.stringify(params).slice(0, 60)}...`) : '';
    console.log(chalk.blue(`→ ${toolName}`) + paramsStr);
  }

  /**
   * Show an error message
   */
  showError(error: Error | string, hint?: string): void {
    const message = error instanceof Error ? error.message : error;
    console.log(chalk.red('✗ Error: ') + message);
    if (hint) {
      console.log(hint);
    }
    console.log();
  }

  /**
   * Show a success message
   */
  showSuccess(message: string): void {
    console.log(chalk.green('✓ ') + message);
    console.log();
  }

  /**
   * Show an info message
   */
  showInfo(message: string): void {
    console.log(chalk.blue('ℹ ') + message);
    console.log();
  }

  /**
   * Show a warning message
   */
  showWarning(message: string): void {
    console.log(chalk.yellow('⚠ ') + message);
    console.log();
  }

  /**
   * Show a spinner
   */
  showSpinner(message: string): void {
    process.stdout.write(chalk.gray('⏳ ') + message + '...\r');
  }

  /**
   * Clear the current line
   */
  clearLine(): void {
    process.stdout.write('\x1b[2K\r');
  }

  /**
   * Show a separator
   */
  showSeparator(): void {
    const width = process.stdout.columns || 80;
    console.log(chalk.dim('─'.repeat(width)));
  }

  /**
   * Show command help
   */
  showHelp(): void {
    const width = process.stdout.columns || 80;

    console.log();
    console.log(chalk.bold.blue('📖 Available Commands'));
    console.log(chalk.dim('─'.repeat(width)));
    console.log();

    const commands = [
      { cmd: '/help', desc: 'Show this help message' },
      { cmd: '/paste', desc: 'Open editor for long/multiline input' },
      { cmd: '/clear', desc: 'Clear conversation history' },
      { cmd: '/context', desc: 'Show context/token usage' },
      { cmd: '/memory', desc: 'Show memory status' },
      { cmd: '/debt', desc: 'Show scaffolding debt' },
      { cmd: '/tasks', desc: 'Show task list' },
      { cmd: '/sessions', desc: 'Browse and manage sessions' },
      { cmd: '/new-session', desc: 'Start a fresh session' },
      { cmd: '/resume', desc: 'Resume a paused agent' },
      { cmd: '/plugins', desc: 'List loaded plugins' },
      { cmd: '/exit', desc: 'Exit the chat' },
    ];

    for (const { cmd, desc } of commands) {
      console.log(`  ${chalk.cyan(cmd.padEnd(15))} ${chalk.gray(desc)}`);
    }

    console.log();
    console.log(chalk.bold.blue('Plugin Commands'));
    console.log(chalk.dim('─'.repeat(width)));
    console.log();
    console.log(`  ${chalk.cyan('/ralph-loop'.padEnd(15))} ${chalk.gray('Start autonomous agent loop')}`);
    console.log(`  ${chalk.cyan('/cancel-ralph'.padEnd(15))} ${chalk.gray('Cancel active Ralph loop')}`);
    console.log();

    console.log(chalk.bold.blue('Keyboard Shortcuts'));
    console.log(chalk.dim('─'.repeat(width)));
    console.log();
    console.log(`  ${chalk.cyan('↑/↓ arrows'.padEnd(15))} ${chalk.gray('Navigate command history')}`);
    console.log(`  ${chalk.cyan('←/→ arrows'.padEnd(15))} ${chalk.gray('Move cursor in input')}`);
    console.log(`  ${chalk.cyan('Tab'.padEnd(15))} ${chalk.gray('Autocomplete commands')}`);
    console.log(`  ${chalk.cyan('Ctrl+A'.padEnd(15))} ${chalk.gray('Move to start of line')}`);
    console.log(`  ${chalk.cyan('Ctrl+E'.padEnd(15))} ${chalk.gray('Move to end of line')}`);
    console.log(`  ${chalk.cyan('Ctrl+U'.padEnd(15))} ${chalk.gray('Clear line')}`);
    console.log(`  ${chalk.cyan('Ctrl+K'.padEnd(15))} ${chalk.gray('Delete to end of line')}`);
    console.log(`  ${chalk.cyan('Ctrl+W'.padEnd(15))} ${chalk.gray('Delete word backward')}`);
    console.log(`  ${chalk.cyan('Ctrl+C'.padEnd(15))} ${chalk.gray('Interrupt/pause agent')}`);
    console.log();
  }

  /**
   * Update the status bar in place
   */
  updateStatusBar(): void {
    if (!this.agent || !this.config.showStatusBar) return;

    const statusInfo = getStatusInfo(this.agent);
    this.statusBar.update(statusInfo);
  }

  /**
   * Get compact status for inline display
   */
  getCompactStatus(): string {
    if (!this.agent) return '';
    const statusInfo = getStatusInfo(this.agent);
    return this.statusBar.renderCompact(statusInfo);
  }

  /**
   * Pad a line to a specific width
   */
  private padLine(text: string, width: number, suffix: string = ''): string {
    const plainText = text.replace(/\x1b\[[0-9;]*m/g, '');
    const currentWidth = plainText.length + suffix.length;

    if (currentWidth < width) {
      const padding = ' '.repeat(width - currentWidth);
      return text + padding + suffix;
    }

    return text + suffix;
  }

  /**
   * Clear the screen
   */
  clearScreen(): void {
    process.stdout.write('\x1bc');
  }

  /**
   * Get input history
   */
  getInputHistory(): string[] {
    return this.input.getHistory();
  }

  /**
   * Clear input history
   */
  clearInputHistory(): void {
    this.input.clearHistory();
  }

  /**
   * Write output to either console or split-screen
   */
  private writeOutput(content: string): void {
    if (this.splitScreen) {
      this.splitScreen.writeOutput(content);
    } else {
      console.log(content);
    }
  }

  /**
   * Get split-screen instance (for advanced usage)
   */
  getSplitScreen(): SplitScreen | undefined {
    return this.splitScreen;
  }

  /**
   * Check if using split-screen mode
   */
  isSplitScreenMode(): boolean {
    return this.config.useSplitScreen;
  }
}
