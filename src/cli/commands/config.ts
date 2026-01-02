// Configuration management command

import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, setConfigValue, getConfigValue } from '../../utils/config.js';
import { log } from '../../utils/index.js';

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
        log.info(chalk.green('✓ Token cache cleared successfully'));
        log.info(chalk.gray(`  Removed: ${cachePath}`));
      } catch {
        log.info(chalk.yellow('Cache directory does not exist or already cleared'));
      }
      return;
    }

    // Verify setup option
    if (options.verify) {
      const config = await loadConfig();
      log.info(chalk.bold('\n🔍 Configuration Verification\n'));

      // Show current provider
      const provider = config.llm.provider || 'copilot';
      log.info(chalk.bold('LLM Provider:') + ' ' + chalk.cyan(provider));
      if (config.llm.model) {
        log.info(chalk.bold('Model:') + ' ' + chalk.cyan(config.llm.model));
      }
      log.newline();

      if (provider === 'copilot') {
        // Check Client ID
        const clientId = config.auth.clientId;
        if (!clientId || clientId === '' || clientId === 'your-client-id-here') {
          log.info(chalk.red('✗ AZURE_CLIENT_ID: Not configured'));
          log.info(chalk.gray('  Set via: .env file or environment variable'));
        } else {
          log.info(chalk.green(`✓ AZURE_CLIENT_ID: ${clientId.slice(0, 8)}...`));
        }

        // Check Tenant ID
        const tenantId = config.auth.tenantId;
        if (tenantId === 'common') {
          log.info(chalk.yellow('⚠ AZURE_TENANT_ID: Using "common" (may need org-specific tenant)'));
        } else if (!tenantId || tenantId === 'your-tenant-id-here') {
          log.info(chalk.red('✗ AZURE_TENANT_ID: Not configured'));
        } else {
          log.info(chalk.green(`✓ AZURE_TENANT_ID: ${tenantId.slice(0, 8)}...`));
        }

        // Check scopes
        log.info(chalk.green(`✓ Scopes configured: ${config.auth.scopes.length} permissions`));

        log.info('\n' + chalk.bold('Required Azure AD Setup:'));
        log.info(chalk.gray('  1. App registration with delegated permissions'));
        log.info(chalk.gray('  2. Admin consent granted for all permissions'));
        log.info(chalk.gray('  3. "Allow public client flows" enabled'));
        log.info(chalk.gray('  4. Microsoft 365 Copilot license assigned'));
        log.info(chalk.gray('\n  See AZURE_SETUP.md for detailed instructions'));

      } else if (provider === 'zai') {
        // Check API Key
        if (config.llm.apiKey) {
          log.info(chalk.green(`✓ API Key: ${config.llm.apiKey.slice(0, 8)}...`));
        } else {
          log.info(chalk.red('✗ API Key: Not configured'));
          log.info(chalk.gray('  Get your key at https://z.ai/subscribe'));
          log.info(chalk.gray('  Set ZAI_API_KEY env var or: copilot-cli config --set llm.apiKey=YOUR_KEY'));
        }
        log.info(chalk.green(`✓ Endpoint: ${config.llm.endpoint}`));

      } else if (provider === 'ollama') {
        log.info(chalk.green(`✓ Endpoint: ${config.llm.endpoint}`));
        log.info(chalk.gray('  Make sure Ollama is running: ollama serve'));
        log.info(chalk.gray(`  Model: ollama pull ${config.llm.model || 'qwen2.5-coder:7b'}`));
      }

      // Check for .env file
      log.newline();
      try {
        await fs.access('.env');
        log.info(chalk.green('✓ .env file: Found'));
      } catch {
        log.info(chalk.yellow('⚠ .env file: Not found (using environment variables)'));
      }

      log.info('\n' + chalk.bold('Switch Provider:'));
      log.info(chalk.gray('  copilot-cli config --set llm.provider=zai'));
      log.info(chalk.gray('  copilot-cli config --set llm.provider=ollama'));
      log.info(chalk.gray('  copilot-cli config --set llm.provider=copilot'));
      log.newline();
      return;
    }

    if (options.list) {
      const config = await loadConfig();
      log.info(chalk.bold('\nConfiguration:'));
      log.info(JSON.stringify(config, null, 2));
      log.newline();
      return;
    }

    if (options.get) {
      const value = await getConfigValue(options.get);
      if (value !== undefined) {
        log.info(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
      } else {
        log.info(chalk.yellow(`Key not found: ${options.get}`));
      }
      return;
    }

    if (options.set) {
      const eqIndex = options.set.indexOf('=');
      if (eqIndex === -1) {
        log.info(chalk.red('Invalid format. Use: --set key=value'));
        process.exit(1);
      }

      const key = options.set.slice(0, eqIndex);
      const value = options.set.slice(eqIndex + 1);

      await setConfigValue(key, value);
      log.info(chalk.green(`✓ Set ${key} = ${value}`));
      return;
    }

    log.info(chalk.yellow('Use --set, --get, or --list'));
    log.info(chalk.gray('Examples:'));
    log.info(chalk.gray('  copilot-cli config --list'));
    log.info(chalk.gray('  copilot-cli config --get auth.clientId'));
    log.info(chalk.gray('  copilot-cli config --set auth.clientId=YOUR_ID'));
  } catch (error) {
    log.error(chalk.red('Error:') + ' ' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
