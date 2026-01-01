// Proactive Context Monitor
// Warns users about context usage BEFORE they hit limits

import chalk from 'chalk';
import type { ConversationManager } from './conversation.js';

export interface ContextMonitorConfig {
  warningThreshold: number; // Percentage at which to show warning (default: 70)
  criticalThreshold: number; // Percentage at which to show critical warning (default: 85)
  cooldownPeriod: number; // Milliseconds to wait before showing another warning (default: 60000 = 1 min)
}

export interface ContextUsageSnapshot {
  totalTokens: number;
  maxTokens: number;
  percentageUsed: number;
  timestamp: number;
}

const DEFAULT_CONFIG: ContextMonitorConfig = {
  warningThreshold: 70,
  criticalThreshold: 85,
  cooldownPeriod: 60000, // 1 minute
};

export class ProactiveContextMonitor {
  private config: ContextMonitorConfig;
  private lastWarningTime: number = 0;
  private warningCount: number = 0;

  constructor(
    private conversation: ConversationManager,
    config?: Partial<ContextMonitorConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check context usage and display warnings if approaching limits
   * Returns true if warning was shown
   */
  checkAndWarn(options?: { force?: boolean }): boolean {
    const now = Date.now();
    const cooldownPassed = now - this.lastWarningTime >= this.config.cooldownPeriod;

    // Don't warn if in cooldown period (unless forced)
    if (!options?.force && !cooldownPassed && this.warningCount > 0) {
      return false;
    }

    const usage = this.getCurrentUsage();
    const threshold = usage.percentageUsed >= this.config.criticalThreshold
      ? this.config.criticalThreshold
      : this.config.warningThreshold;

    if (usage.percentageUsed >= threshold) {
      this.displayWarning(usage, threshold);
      this.lastWarningTime = now;
      this.warningCount++;
      return true;
    }

    return false;
  }

  /**
   * Get current context usage snapshot
   */
  getCurrentUsage(): ContextUsageSnapshot {
    // Access the ContextManager directly to get numeric usage data
    const contextManager = this.conversation.getContextManager();
    const usage = contextManager.getUsage();
    const maxTokens = usage.remainingTokens + usage.totalTokens || 8000; // Derive max from remaining + total

    return {
      totalTokens: usage.totalTokens,
      maxTokens,
      percentageUsed: usage.percentUsed,
      timestamp: Date.now(),
    };
  }

  /**
   * Display context usage warning
   */
  private displayWarning(usage: ContextUsageSnapshot, threshold: number): void {
    const isCritical = threshold >= this.config.criticalThreshold;
    const icon = isCritical ? '🔴' : '🟡';
    const level = isCritical ? 'CRITICAL' : 'WARNING';

    console.log();
    console.log(chalk.bold[isCritical ? 'red' : 'yellow'](`${icon} [${level}] Context Usage: ${usage.percentageUsed}%`));
    console.log(chalk.gray('   Using ' + this.formatTokens(usage.totalTokens) + ' of ' + this.formatTokens(usage.maxTokens)));
    console.log(chalk.gray('━'.repeat(50)));

    // Draw progress bar
    const barWidth = 40;
    const filled = Math.round((usage.percentageUsed / 100) * barWidth);
    const bar = chalk[isCritical ? 'red' : 'yellow']('█'.repeat(filled)) +
                chalk.gray('░'.repeat(barWidth - filled));
    console.log(`  [${bar}] ${usage.percentageUsed}%`);
    console.log(chalk.gray('━'.repeat(50)));

    // Show suggestions based on context
    const suggestions = this.buildSuggestions(usage);
    if (suggestions.length > 0) {
      console.log(chalk.dim('💡 Suggestions:'));
      for (const suggestion of suggestions) {
        console.log(chalk.dim('   ' + suggestion));
      }
    }

    console.log();
  }

  /**
   * Build context-specific suggestions
   */
  private buildSuggestions(usage: ContextUsageSnapshot): string[] {
    const suggestions: string[] = [];
    const messages = this.conversation.getMessages();

    // Check for excessive context
    if (usage.percentageUsed >= this.config.criticalThreshold) {
      suggestions.push('Consider /clear to start fresh with current context preserved in session');
    }

    // Check for stale messages
    const recentMessages = messages.slice(-10);
    if (messages.length - recentMessages.length > 5) {
      suggestions.push(`${messages.length - recentMessages.length} older messages in history - consider summary`);
    }

    // Check for tool results
    const toolResults = messages.filter(m => m.role === 'tool');
    if (toolResults.length > 3) {
      suggestions.push(`${toolResults.length} tool results - consider /context to review`);
    }

    // Check for assistant messages that could be summarized
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    if (assistantMessages.length > 5) {
      suggestions.push('Consider summarizing completed work to free tokens');
    }

    return suggestions;
  }

  /**
   * Format token count for display
   */
  private formatTokens(count: number): string {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return count.toString();
  }

  /**
   * Reset warning cooldown
   */
  resetCooldown(): void {
    this.lastWarningTime = 0;
  }

  /**
   * Get warning count
   */
  getWarningCount(): number {
    return this.warningCount;
  }

  /**
   * Check if we should display a summary prompt
   */
  shouldPromptSummary(): boolean {
    const usage = this.getCurrentUsage();
    const messages = this.conversation.getMessages();

    // Prompt summary if:
    // - Usage > 60%
    // - More than 8 messages
    // - Haven't warned recently
    const cooldownPassed = Date.now() - this.lastWarningTime >= this.config.cooldownPeriod * 2;

    return usage.percentageUsed > 60 &&
           messages.length > 8 &&
           cooldownPassed;
  }

  /**
   * Display summary prompt
   */
  displaySummaryPrompt(): void {
    console.log();
    console.log(chalk.cyan('📝 Consider summarizing completed work:'));
    console.log(chalk.dim('   This helps preserve important context while freeing tokens.'));
    console.log(chalk.dim('   Say "Summarize progress so far" or /context to review.'));
    console.log();

    this.lastWarningTime = Date.now();
    this.warningCount++;
  }
}
