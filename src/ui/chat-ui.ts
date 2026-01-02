// Enhanced chat UI with persistent status and input

import chalk from 'chalk';
import { log } from '../utils/index.js';
import type { CopilotAgent } from '../agent/index.js';
import { Input } from './input.js';
import { StatusBar, getStatusInfo, type StatusInfo } from './status-bar.js';
import { TaskDisplay } from '../cli/ui/task-display.js';
import { MessageQueue } from './message-queue.js';
import { PersistentInput } from './persistent-input.js';
import { SplitScreen } from './split-screen.js';
import { SubAgentDashboard } from './subagent-dashboard.js';
import type { SubAgentManager } from '../agent/subagent.js';
import { BottomBar, type BottomBarConfig } from './bottom-bar.js';
import { OutputManager, type OutputManagerConfig } from './output-manager.js';

export interface ChatUIConfig {
  showStatusBar: boolean;
  showTaskPanel: boolean;
  updateInterval: number; // ms between status updates
  maxMessageLength: number;
  useSplitScreen: boolean; // Enable persistent input with split-screen layout
  usePersistentBottomBar: boolean; // Enable persistent bottom bar with taskbar and input
}

export const DEFAULT_CHAT_UI_CONFIG: ChatUIConfig = {
  showStatusBar: true,
  showTaskPanel: true,
  updateInterval: 1000,
  maxMessageLength: 10000,
  useSplitScreen: false, // Off by default for backwards compatibility
  usePersistentBottomBar: true, // On by default for better UX
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

  // Subagent dashboard
  private subagentDashboard?: SubAgentDashboard;

  // Persistent bottom bar components
  private bottomBar?: BottomBar;
  private outputManager?: OutputManager;
  private resizeHandler?: () => void;

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

    // Initialize persistent bottom bar if enabled
    if (this.config.usePersistentBottomBar) {
      this.bottomBar = new BottomBar({
        height: 3,
        showSeparator: true,
        updateInterval: this.config.updateInterval,
      });
      this.outputManager = new OutputManager(this.bottomBar);
    }
  }

  /**
   * Initialize the UI with an agent
   */
  initialize(agent: CopilotAgent): void {
    this.agent = agent;
    this.taskDisplay.initialize();
    this.isActive = true;

    // Initialize subagent dashboard if subagent manager is available
    const subagentManager = (agent as any).subAgentManager as SubAgentManager;
    if (subagentManager) {
      this.subagentDashboard = new SubAgentDashboard(subagentManager);
      this.subagentDashboard.show();
    }

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

    // Initialize persistent bottom bar if enabled
    if (this.config.usePersistentBottomBar && this.bottomBar && this.outputManager) {
      this.bottomBar.initialize();

      // Set up resize handler
      this.resizeHandler = this.handleResize.bind(this);
      process.stdout.on('resize', this.resizeHandler);
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

    // Hide subagent dashboard
    if (this.subagentDashboard) {
      this.subagentDashboard.hide();
    }

    // Shutdown split-screen if active
    if (this.splitScreen) {
      this.splitScreen.shutdown();
    }

    // Shutdown persistent bottom bar if active
    if (this.bottomBar) {
      this.bottomBar.clear();
    }

    // Remove resize handler
    if (this.resizeHandler) {
      process.stdout.removeListener('resize', this.resizeHandler);
    }
  }

  /**
   * Show the welcome header
   */
  showWelcome(providerInfo: string, directory: string, sessionId?: string, sessionTitle?: string): void {
    const width = process.stdout.columns || 80;

    log.newline();
    log.log(chalk.blue.bold('┌' + '─'.repeat(width - 2) + '┐'));
    log.log(this.padLine(chalk.blue.bold('│ ') + chalk.cyan.bold('🤖 Copilot CLI Agent') + chalk.gray(' v0.1.0'), width, chalk.blue.bold('│')));
    log.log(chalk.blue.bold('├' + '─'.repeat(width - 2) + '┤'));
    log.log(this.padLine(chalk.blue.bold('│ ') + chalk.gray('Provider: ') + chalk.white(providerInfo), width, chalk.blue.bold('│')));
    log.log(this.padLine(chalk.blue.bold('│ ') + chalk.gray('Directory: ') + chalk.white(directory), width, chalk.blue.bold('│')));

    if (sessionId && sessionTitle) {
      log.log(this.padLine(
        chalk.blue.bold('│ ') + chalk.gray('Session: ') + chalk.white(sessionTitle) + chalk.dim(` (${sessionId.slice(0, 8)}...)`),
        width,
        chalk.blue.bold('│')
      ));
    }

    log.log(chalk.blue.bold('└' + '─'.repeat(width - 2) + '┘'));
    log.newline();
    log.log(chalk.dim('💡 Type /help for commands, Ctrl+C to interrupt, /exit to quit'));
    log.newline();
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
        log.log(taskPanel);
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

    // Update bottom bar if enabled
    if (this.config.usePersistentBottomBar && this.bottomBar) {
      const statusInfo = getStatusInfo(this.agent);
      const memoryStore = this.agent.getMemoryStore();
      const tasks = memoryStore.getTasks();
      const activeTask = memoryStore.getActiveTask();

      this.bottomBar.updateStatusInfo(statusInfo);
      this.bottomBar.updateTasks(activeTask || null, tasks);
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
      log.log(chalk.cyan('Assistant:'));
      log.log(message);
      log.newline();
    }
  }

  /**
   * Show a tool execution
   */
  showToolExecution(toolName: string, params?: any): void {
    const paramsStr = params ? chalk.dim(` ${JSON.stringify(params).slice(0, 60)}...`) : '';
    log.log(chalk.blue(`→ ${toolName}`) + paramsStr, chalk.blue);
  }

  /**
   * Show an error message
   */
  showError(error: Error | string, hint?: string): void {
    const message = error instanceof Error ? error.message : error;
    log.error('✗ Error: ' + message);
    if (hint) {
      log.log(hint);
    }
    log.newline();
  }

  /**
   * Show a success message
   */
  showSuccess(message: string): void {
    log.success('✓ ' + message);
    log.newline();
  }

  /**
   * Show an info message
   */
  showInfo(message: string): void {
    log.log(chalk.blue('ℹ ') + message);
    log.newline();
  }

  /**
   * Show a warning message
   */
  showWarning(message: string): void {
    log.warn('⚠ ' + message);
    log.newline();
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
    log.log(chalk.dim('─'.repeat(width)));
  }

  /**
   * Show command help
   */
  showHelp(): void {
    const width = process.stdout.columns || 80;

    log.newline();
    log.log(chalk.bold.blue('📖 Available Commands'));
    log.log(chalk.dim('─'.repeat(width)));
    log.newline();

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
      log.log(`  ${chalk.cyan(cmd.padEnd(15))} ${chalk.gray(desc)}`);
    }

    log.newline();
    log.log(chalk.bold.blue('Plugin Commands'));
    log.log(chalk.dim('─'.repeat(width)));
    log.newline();
    log.log(`  ${chalk.cyan('/ralph-loop'.padEnd(15))} ${chalk.gray('Start autonomous agent loop')}`);
    log.log(`  ${chalk.cyan('/cancel-ralph'.padEnd(15))} ${chalk.gray('Cancel active Ralph loop')}`);
    log.newline();

    log.log(chalk.bold.blue('Keyboard Shortcuts'));
    log.log(chalk.dim('─'.repeat(width)));
    log.newline();
    log.log(`  ${chalk.cyan('↑/↓ arrows'.padEnd(15))} ${chalk.gray('Navigate command history')}`);
    log.log(`  ${chalk.cyan('←/→ arrows'.padEnd(15))} ${chalk.gray('Move cursor in input')}`);
    log.log(`  ${chalk.cyan('Tab'.padEnd(15))} ${chalk.gray('Autocomplete commands')}`);
    log.log(`  ${chalk.cyan('Ctrl+A'.padEnd(15))} ${chalk.gray('Move to start of line')}`);
    log.log(`  ${chalk.cyan('Ctrl+E'.padEnd(15))} ${chalk.gray('Move to end of line')}`);
    log.log(`  ${chalk.cyan('Ctrl+U'.padEnd(15))} ${chalk.gray('Clear line')}`);
    log.log(`  ${chalk.cyan('Ctrl+K'.padEnd(15))} ${chalk.gray('Delete to end of line')}`);
    log.log(`  ${chalk.cyan('Ctrl+W'.padEnd(15))} ${chalk.gray('Delete word backward')}`);
    log.log(`  ${chalk.cyan('Ctrl+C'.padEnd(15))} ${chalk.gray('Interrupt/pause agent')}`);
    log.newline();
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
    if (this.outputManager) {
      // Persistent bottom bar mode: write through output manager
      this.outputManager.write(content);
    } else if (this.splitScreen) {
      // Split-screen mode: write through split screen
      this.splitScreen.writeOutput(content);
    } else {
      // Traditional mode: use log
      log.log(content);
    }
  }

  /**
   * Handle terminal resize
   */
  private handleResize(): void {
    if (this.bottomBar) {
      this.bottomBar.handleResize();
    }
    if (this.outputManager) {
      this.outputManager.handleResize();
    }
  }

  /**
   * Update bottom bar with status info
   */
  updateBottomBarStatus(statusInfo: StatusInfo): void {
    if (this.bottomBar) {
      this.bottomBar.updateStatusInfo(statusInfo);
    }
  }

  /**
   * Update bottom bar with task info
   */
  updateBottomBarTasks(currentTask: any, allTasks: any[]): void {
    if (this.bottomBar) {
      this.bottomBar.updateTasks(currentTask, allTasks);
    }
  }

  /**
   * Update bottom bar input
   */
  updateBottomBarInput(input: string, cursorPosition: number = 0): void {
    if (this.bottomBar) {
      this.bottomBar.updateInput(input, cursorPosition);
    }
  }

  /**
   * Get bottom bar instance (for advanced usage)
   */
  getBottomBar(): BottomBar | undefined {
    return this.bottomBar;
  }

  /**
   * Get output manager instance (for advanced usage)
   */
  getOutputManager(): OutputManager | undefined {
    return this.outputManager;
  }

  /**
   * Check if using persistent bottom bar mode
   */
  isPersistentBottomBarMode(): boolean {
    return this.config.usePersistentBottomBar && this.bottomBar !== undefined;
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
