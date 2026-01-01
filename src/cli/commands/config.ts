// Configuration management command

import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, setConfigValue, getConfigValue } from '../../utils/config.js';

function getCachePath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'copilot-cli', 'cache');
  }
  return path.join(os.homedir(), '.copilot-cli', 'cache');
}

export async function configCommand(options: {
  set?: string;
  get?: string;
  list?: boolean;
  clearCache?: boolean;
  verify?: boolean;
}): Promise<void> {
  try {
    // Clear cache option
    if (options.clearCache) {
      const cachePath = getCachePath();
      try {
        await fs.rm(cachePath, { recursive: true, force: true });
        console.log(chalk.green('✓ Token cache cleared successfully'));
        console.log(chalk.gray(`  Removed: ${cachePath}`));
      } catch {
        console.log(chalk.yellow('Cache directory does not exist or already cleared'));
      }
      return;
    }

    // Verify setup option
    if (options.verify) {
      const config = await loadConfig();
      console.log(chalk.bold('\n🔍 Configuration Verification\n'));

      // Show current provider
      const provider = config.llm.provider || 'copilot';
      console.log(chalk.bold('LLM Provider:'), chalk.cyan(provider));
      if (config.llm.model) {
        console.log(chalk.bold('Model:'), chalk.cyan(config.llm.model));
      }
      console.log();

      if (provider === 'copilot') {
        // Check Client ID
        const clientId = config.auth.clientId;
        if (!clientId || clientId === '' || clientId === 'your-client-id-here') {
          console.log(chalk.red('✗ AZURE_CLIENT_ID: Not configured'));
          console.log(chalk.gray('  Set via: .env file or environment variable'));
        } else {
          console.log(chalk.green(`✓ AZURE_CLIENT_ID: ${clientId.slice(0, 8)}...`));
        }

        // Check Tenant ID
        const tenantId = config.auth.tenantId;
        if (tenantId === 'common') {
          console.log(chalk.yellow('⚠ AZURE_TENANT_ID: Using "common" (may need org-specific tenant)'));
        } else if (!tenantId || tenantId === 'your-tenant-id-here') {
          console.log(chalk.red('✗ AZURE_TENANT_ID: Not configured'));
        } else {
          console.log(chalk.green(`✓ AZURE_TENANT_ID: ${tenantId.slice(0, 8)}...`));
        }

        // Check scopes
        console.log(chalk.green(`✓ Scopes configured: ${config.auth.scopes.length} permissions`));

        console.log('\n' + chalk.bold('Required Azure AD Setup:'));
        console.log(chalk.gray('  1. App registration with delegated permissions'));
        console.log(chalk.gray('  2. Admin consent granted for all permissions'));
        console.log(chalk.gray('  3. "Allow public client flows" enabled'));
        console.log(chalk.gray('  4. Microsoft 365 Copilot license assigned'));
        console.log(chalk.gray('\n  See AZURE_SETUP.md for detailed instructions'));

      } else if (provider === 'zai') {
        // Check API Key
        if (config.llm.apiKey) {
          console.log(chalk.green(`✓ API Key: ${config.llm.apiKey.slice(0, 8)}...`));
        } else {
          console.log(chalk.red('✗ API Key: Not configured'));
          console.log(chalk.gray('  Get your key at https://z.ai/subscribe'));
          console.log(chalk.gray('  Set ZAI_API_KEY env var or: copilot-cli config --set llm.apiKey=YOUR_KEY'));
        }
        console.log(chalk.green(`✓ Endpoint: ${config.llm.endpoint}`));

      } else if (provider === 'ollama') {
        console.log(chalk.green(`✓ Endpoint: ${config.llm.endpoint}`));
        console.log(chalk.gray('  Make sure Ollama is running: ollama serve'));
        console.log(chalk.gray(`  Model: ollama pull ${config.llm.model || 'qwen2.5-coder:7b'}`));
      }

      // Check for .env file
      console.log();
      try {
        await fs.access('.env');
        console.log(chalk.green('✓ .env file: Found'));
      } catch {
        console.log(chalk.yellow('⚠ .env file: Not found (using environment variables)'));
      }

      console.log('\n' + chalk.bold('Switch Provider:'));
      console.log(chalk.gray('  copilot-cli config --set llm.provider=zai'));
      console.log(chalk.gray('  copilot-cli config --set llm.provider=ollama'));
      console.log(chalk.gray('  copilot-cli config --set llm.provider=copilot'));
      console.log();
      return;
    }

    if (options.list) {
      const config = await loadConfig();
      console.log(chalk.bold('\nConfiguration:'));
      console.log(JSON.stringify(config, null, 2));
      console.log();
      return;
    }

    if (options.get) {
      const value = await getConfigValue(options.get);
      if (value !== undefined) {
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
      } else {
        console.log(chalk.yellow(`Key not found: ${options.get}`));
      }
      return;
    }

    if (options.set) {
      const eqIndex = options.set.indexOf('=');
      if (eqIndex === -1) {
        console.log(chalk.red('Invalid format. Use: --set key=value'));
        process.exit(1);
      }

      const key = options.set.slice(0, eqIndex);
      const value = options.set.slice(eqIndex + 1);

      await setConfigValue(key, value);
      console.log(chalk.green(`✓ Set ${key} = ${value}`));
      return;
    }

    console.log(chalk.yellow('Use --set, --get, or --list'));
    console.log(chalk.gray('Examples:'));
    console.log(chalk.gray('  copilot-cli config --list'));
    console.log(chalk.gray('  copilot-cli config --get auth.clientId'));
    console.log(chalk.gray('  copilot-cli config --set auth.clientId=YOUR_ID'));
  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
