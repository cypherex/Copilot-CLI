// LLM Provider Factory - creates the appropriate client based on configuration

import type { LLMClient, LLMConfig, LLMProvider } from './types.js';
import type { AuthManager } from '../auth/index.js';
import { CopilotClient } from './copilot-client.js';
import { OpenAICompatibleClient } from './openai-compatible-client.js';

// Default configurations for each provider
export const PROVIDER_DEFAULTS: Record<LLMProvider, Partial<LLMConfig>> = {
  copilot: {
    endpoint: 'https://graph.microsoft.com',
    apiVersion: 'beta',
    model: undefined, // Copilot doesn't use model selection
    rateLimitInterval: 100, // Default 100ms minimum between requests
  },
  zai: {
    endpoint: 'https://api.z.ai/api/coding/paas/v4',
    apiVersion: 'v1',
    model: 'GLM-4.7',
    enableThinking: true, // Enable extended thinking for GLM models
    rateLimitInterval: 100, // Default 100ms minimum between requests
  },
  ollama: {
    endpoint: 'http://localhost:11434/v1',
    apiVersion: 'v1',
    model: 'qwen2.5-coder:7b',
    rateLimitInterval: 100, // Default 100ms minimum between requests (can be disabled by setting to 0)
  },
};

export interface CreateClientOptions {
  config: LLMConfig;
  authManager?: AuthManager; // Required for Copilot
}

export function createLLMClient(options: CreateClientOptions): LLMClient {
  const { config, authManager } = options;

  switch (config.provider) {
    case 'copilot':
      if (!authManager) {
        throw new Error('AuthManager is required for Microsoft 365 Copilot provider');
      }
      return new CopilotClient(authManager, config);

    case 'zai':
      if (!config.apiKey) {
        throw new Error('API key is required for Z.ai provider. Set llm.apiKey in config or ZAI_API_KEY environment variable.');
      }
      return new OpenAICompatibleClient(config, 'Z.ai');

    case 'ollama':
      // Ollama doesn't require API key
      return new OpenAICompatibleClient(config, 'Ollama');

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export function getProviderDisplayName(provider: LLMProvider): string {
  switch (provider) {
    case 'copilot':
      return 'Microsoft 365 Copilot';
    case 'zai':
      return 'Z.ai GLM-4.7';
    case 'ollama':
      return 'Ollama (Local)';
    default:
      return provider;
  }
}

export function validateProviderConfig(config: LLMConfig): string[] {
  const errors: string[] = [];

  switch (config.provider) {
    case 'copilot':
      // Copilot validation is handled by AuthManager
      break;

    case 'zai':
      if (!config.apiKey) {
        errors.push('Z.ai requires an API key. Get one at https://z.ai/subscribe');
      }
      if (!config.model) {
        errors.push('Z.ai requires a model name (e.g., GLM-4.7)');
      }
      break;

    case 'ollama':
      if (!config.model) {
        errors.push('Ollama requires a model name (e.g., qwen2.5-coder:7b)');
      }
      break;
  }

  return errors;
}
