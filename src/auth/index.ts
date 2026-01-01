// Authentication Manager with Windows WAM (primary) and Device Code Flow (fallback)

import { DeviceCodeCredential } from '@azure/identity';
import { TokenCache } from './token-cache.js';
import type { AuthConfig, AuthProvider, AuthToken } from './types.js';
import type { TokenCredential, AccessToken } from '@azure/identity';

// Try to use Windows WAM via BrokerCredential
async function tryCreateBrokerCredential(config: AuthConfig): Promise<TokenCredential | null> {
  // Only attempt on Windows
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    // Dynamic import - may not be available
    const { InteractiveBrowserCredential } = await import('@azure/identity');

    // Use interactive browser with broker enabled (WAM on Windows)
    // Note: @azure/identity-broker adds WAM support to existing credentials
    const credential = new InteractiveBrowserCredential({
      clientId: config.clientId,
      tenantId: config.tenantId,
      // When identity-broker is installed, this enables WAM
      brokerOptions: {
        enabled: true,
        parentWindowHandle: undefined, // Use default
      } as any,
    });

    return credential;
  } catch (error) {
    // BrokerCredential not available
    return null;
  }
}

function createDeviceCodeCredential(config: AuthConfig): DeviceCodeCredential {
  return new DeviceCodeCredential({
    clientId: config.clientId,
    tenantId: config.tenantId,
    userPromptCallback: (info) => {
      console.log('\n🔐 Authentication Required');
      console.log('━'.repeat(50));
      console.log(`1. Open your browser and go to: ${info.verificationUri}`);
      console.log(`2. Enter this code: ${info.userCode}`);
      console.log('━'.repeat(50));
      console.log('Waiting for authentication...\n');
    },
  });
}

export class AuthManager implements AuthProvider {
  private primaryCredential: TokenCredential | null = null;
  private fallbackCredential: DeviceCodeCredential;
  private tokenCache: TokenCache;
  private config: AuthConfig;
  private initialized: boolean = false;

  constructor(config: AuthConfig) {
    this.config = config;
    this.tokenCache = new TokenCache(config.cacheLocation);
    this.fallbackCredential = createDeviceCodeCredential(config);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Try to set up Windows WAM as primary auth
    this.primaryCredential = await tryCreateBrokerCredential(this.config);

    if (this.primaryCredential) {
      console.log('Using Windows integrated authentication');
    }

    this.initialized = true;
  }

  async getToken(): Promise<AuthToken> {
    await this.initialize();

    // Check cache first
    const cachedToken = await this.tokenCache.getToken();
    if (cachedToken && !this.isTokenExpired(cachedToken)) {
      return cachedToken;
    }

    // Try primary credential (WAM) first, fall back to device code
    let tokenResponse: AccessToken | null = null;
    let usedPrimary = false;

    if (this.primaryCredential) {
      try {
        tokenResponse = await this.primaryCredential.getToken(this.config.scopes);
        usedPrimary = true;
      } catch (error) {
        // WAM failed, will try fallback
        console.log('Windows auth unavailable, using device code flow...');
      }
    }

    // Fall back to device code if primary failed or unavailable
    if (!tokenResponse) {
      try {
        tokenResponse = await this.fallbackCredential.getToken(this.config.scopes);
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Authentication failed: ${error.message}`);
        }
        throw error;
      }
    }

    if (!tokenResponse) {
      throw new Error('Failed to acquire token');
    }

    // Extract account info if available
    const accountInfo = this.extractAccountInfo(tokenResponse);

    const token: AuthToken = {
      accessToken: tokenResponse.token,
      expiresOn: tokenResponse.expiresOnTimestamp
        ? new Date(tokenResponse.expiresOnTimestamp)
        : new Date(Date.now() + 3600000),
      account: accountInfo,
    };

    // Cache the new token
    await this.tokenCache.saveToken(token);

    return token;
  }

  private extractAccountInfo(tokenResponse: AccessToken): { username: string; name: string } {
    // Try to decode JWT to get account info
    try {
      const tokenParts = tokenResponse.token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf-8'));

        // Debug: print token claims
        if (process.env.DEBUG_TOKEN) {
          console.log('\n[DEBUG] Token claims:');
          console.log('  aud:', payload.aud);
          console.log('  scp:', payload.scp);
          console.log('  roles:', payload.roles);
          console.log('  iss:', payload.iss);
        }

        return {
          username: payload.upn || payload.preferred_username || payload.email || 'user',
          name: payload.name || payload.given_name || 'User',
        };
      }
    } catch {
      // Token parsing failed
    }

    return { username: 'user', name: 'User' };
  }

  private isTokenExpired(token: AuthToken): boolean {
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return token.expiresOn.getTime() - Date.now() < bufferMs;
  }

  async clearCache(): Promise<void> {
    await this.tokenCache.clear();
  }

  get credential(): TokenCredential {
    return this.primaryCredential || this.fallbackCredential;
  }
}
