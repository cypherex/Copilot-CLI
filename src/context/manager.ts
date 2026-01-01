// Context Manager - orchestrates context tracking and usage monitoring

import chalk from 'chalk';
import type { ChatMessage, LLMClient, ToolDefinition } from '../llm/types.js';
import { calculateContextUsage, type ContextUsage } from './token-estimator.js';

export interface ContextManagerConfig {
  // Maximum context window size in tokens
  maxContextTokens: number;

  // Threshold percentage to trigger compression (e.g., 75 = compress at 75% usage)
  compressionThreshold: number;

  // Log events
  verbose: boolean;
}

export interface ContextState {
  usage: ContextUsage;
  lastUpdated?: Date;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  maxContextTokens: 32000, // Conservative default for most models
  compressionThreshold: 75,
  verbose: false,
};

// Model-specific context limits
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'GLM-4.7': 128000,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-4-turbo': 128000,
  'gpt-4o': 128000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'qwen2.5-coder:7b': 32768,
  'qwen2.5-coder:14b': 32768,
  'llama3.1:8b': 131072,
  'deepseek-coder': 16384,
};

export class ContextManager {
  private config: ContextManagerConfig;
  private state: ContextState;
  private llmClient?: LLMClient;

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.state = {
      usage: {
        totalTokens: 0,
        systemTokens: 0,
        conversationTokens: 0,
        toolsTokens: 0,
        percentUsed: 0,
        remainingTokens: this.config.maxContextTokens,
      },
    };
  }

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  setModelContextLimit(model: string): void {
    const limit = MODEL_CONTEXT_LIMITS[model];
    if (limit) {
      this.config.maxContextTokens = limit;
      if (this.config.verbose) {
        console.log(chalk.gray(`Context limit set to ${limit} tokens for ${model}`));
      }
    }
  }

  updateUsage(messages: ChatMessage[], tools: ToolDefinition[] = []): ContextUsage {
    this.state.usage = calculateContextUsage(messages, tools, this.config.maxContextTokens);
    this.state.lastUpdated = new Date();
    return this.state.usage;
  }

  needsCompression(): boolean {
    return this.state.usage.percentUsed >= this.config.compressionThreshold;
  }

  getState(): ContextState {
    return { ...this.state };
  }

  getUsage(): ContextUsage {
    return { ...this.state.usage };
  }

  getUsageSummary(): string {
    const { totalTokens, percentUsed } = this.state.usage;
    const bar = this.createProgressBar(percentUsed);
    const warning = percentUsed > 80 ? '\n⚠️  Approaching token limit - conversation may be trimmed' : '';
    return `${bar} ${Math.round(percentUsed)}% used (${totalTokens}/${this.config.maxContextTokens} tokens)${warning}`;
  }

  private createProgressBar(percent: number): string {
    const width = 20;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;

    let color = chalk.green;
    if (percent > 80) {
      color = chalk.red;
    } else if (percent > 60) {
      color = chalk.yellow;
    }

    return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }

  reset(): void {
    this.state = {
      usage: {
        totalTokens: 0,
        systemTokens: 0,
        conversationTokens: 0,
        toolsTokens: 0,
        percentUsed: 0,
        remainingTokens: this.config.maxContextTokens,
      },
    };
  }
}
