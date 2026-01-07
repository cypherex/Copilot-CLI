// Configuration management

import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { AuthConfig } from '../auth/types.js';
import type { LLMConfig } from '../llm/types.js';
import { getCopilotCliHomeDir } from './app-paths.js';

// Load .env file
dotenv.config();

export interface AppConfig {
  auth: AuthConfig;
  llm: LLMConfig;
}

function getConfigDir(): string {
  return getCopilotCliHomeDir();
}

function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json');
}

import type { LLMProvider } from '../llm/types.js';

// Provider defaults (inline to avoid circular imports)
const PROVIDER_CONFIGS: Record<LLMProvider, { endpoint: string; apiVersion: string; model?: string; enableThinking?: boolean }> = {
  copilot: {
    endpoint: 'https://graph.microsoft.com',
    apiVersion: 'beta',
    model: undefined,
    enableThinking: false,
  },
  zai: {
    endpoint: 'https://api.z.ai/api/coding/paas/v4',
    apiVersion: 'v1',
    model: 'GLM-4.7',
    enableThinking: true,
  },
  ollama: {
    endpoint: 'http://localhost:11434/v1',
    apiVersion: 'v1',
    model: 'qwen2.5-coder:7b',
    enableThinking: false,
  },
};

function getDefaultProvider(): LLMProvider {
  const envProvider = process.env.LLM_PROVIDER?.toLowerCase();
  if (envProvider === 'zai' || envProvider === 'ollama' || envProvider === 'copilot') {
    return envProvider;
  }
  return 'copilot'; // Default to Copilot
}

function getDefaultConfig(): AppConfig {
  const provider = getDefaultProvider();
  const providerDefaults = PROVIDER_CONFIGS[provider];

  return {
    auth: {
      clientId: process.env.AZURE_CLIENT_ID || '',
      tenantId: process.env.AZURE_TENANT_ID || 'common',
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}`,
      // Copilot Chat API requires these specific delegated permissions
      scopes: [
        'https://graph.microsoft.com/Sites.Read.All',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/People.Read.All',
        'https://graph.microsoft.com/OnlineMeetingTranscript.Read.All',
        'https://graph.microsoft.com/Chat.Read',
        'https://graph.microsoft.com/ChannelMessage.Read.All',
        'https://graph.microsoft.com/ExternalItem.Read.All',
      ],
    },
    llm: {
      provider,
      endpoint: process.env.LLM_ENDPOINT || providerDefaults.endpoint || 'https://graph.microsoft.com',
      apiVersion: providerDefaults.apiVersion || 'beta',
      apiKey: process.env.ZAI_API_KEY || process.env.LLM_API_KEY || undefined,
      model: process.env.LLM_MODEL || providerDefaults.model,
      maxTokens: 120000, // Support modern models like GLM-4.7 with 128k output tokens
      temperature: 0.7,
      streamingEnabled: true,
      enableThinking: providerDefaults.enableThinking ?? false,
    },
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const defaults = getDefaultConfig();

  try {
    const configData = await fs.readFile(getConfigFile(), 'utf-8');
    const fileConfig = JSON.parse(configData);
    return deepMerge(defaults, fileConfig);
  } catch {
    return defaults;
  }
}

export async function saveConfig(config: Partial<AppConfig>): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });

  const currentConfig = await loadConfig();
  const newConfig = deepMerge(currentConfig, config);

  await fs.writeFile(getConfigFile(), JSON.stringify(newConfig, null, 2), 'utf-8');
}

export async function getConfigValue(key: string): Promise<any> {
  const config = await loadConfig();
  const keys = key.split('.');
  let value: any = config;

  for (const k of keys) {
    value = value?.[k];
  }

  return value;
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  const config = await loadConfig() as any;
  const keys = key.split('.');
  let obj = config;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in obj)) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }

  // Try to parse as JSON, otherwise use string
  try {
    obj[keys[keys.length - 1]] = JSON.parse(value);
  } catch {
    obj[keys[keys.length - 1]] = value;
  }

  await saveConfig(config);
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
