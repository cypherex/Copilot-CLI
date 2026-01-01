// Token caching with Windows DPAPI encryption via msal-node-extensions

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { AuthToken } from './types.js';

// Platform-specific cache path
function getDefaultCachePath(): string {
  if (process.platform === 'win32') {
    // Windows: Use %LOCALAPPDATA%
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'copilot-cli', 'cache', 'msal.cache');
  } else {
    // macOS/Linux: Use ~/.copilot-cli
    return path.join(os.homedir(), '.copilot-cli', 'cache', 'msal.cache');
  }
}

export class TokenCache {
  private cachePath: string;
  private persistence: any = null;
  private useDpapi: boolean = false;

  constructor(cacheLocation?: string) {
    this.cachePath = cacheLocation || getDefaultCachePath();
  }

  private async initPersistence(): Promise<void> {
    if (this.persistence !== null) return;

    // Try to use DPAPI on Windows via msal-node-extensions
    if (process.platform === 'win32') {
      try {
        // Dynamic import to handle if package not available
        const {
          DataProtectionScope,
          PersistenceCreator
        } = await import('@azure/msal-node-extensions');

        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });

        this.persistence = await PersistenceCreator.createPersistence({
          cachePath: this.cachePath,
          dataProtectionScope: DataProtectionScope.CurrentUser,
          serviceName: 'copilot-cli',
          accountName: 'token-cache',
        });

        this.useDpapi = true;
        return;
      } catch (error) {
        console.warn('DPAPI encryption unavailable, using fallback storage');
        // Fall through to unencrypted storage
      }
    }

    // Fallback: Plain file storage (with warning)
    this.persistence = {
      save: async (data: string) => {
        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
        await fs.writeFile(this.cachePath, data, 'utf-8');
      },
      load: async (): Promise<string | null> => {
        try {
          return await fs.readFile(this.cachePath, 'utf-8');
        } catch {
          return null;
        }
      },
    };
    this.useDpapi = false;
  }

  async saveToken(token: AuthToken): Promise<void> {
    try {
      await this.initPersistence();

      const data = JSON.stringify({
        accessToken: token.accessToken,
        expiresOn: token.expiresOn.toISOString(),
        account: token.account,
        encrypted: this.useDpapi,
      });

      await this.persistence.save(data);
    } catch (error) {
      console.warn('Failed to cache token:', error);
    }
  }

  async getToken(): Promise<AuthToken | null> {
    try {
      await this.initPersistence();

      const data = await this.persistence.load();
      if (!data) return null;

      const parsed = JSON.parse(data);
      return {
        accessToken: parsed.accessToken,
        expiresOn: new Date(parsed.expiresOn),
        account: parsed.account,
      };
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.cachePath);
    } catch {
      // Cache file doesn't exist, ignore
    }
  }

  isEncrypted(): boolean {
    return this.useDpapi;
  }
}
