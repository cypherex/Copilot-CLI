// Authentication type definitions

export interface AuthConfig {
  clientId: string; // Azure AD app registration ID
  tenantId: string; // Organization tenant ID
  authority: string; // AAD authority URL
  scopes: string[]; // Required Graph API scopes
  cacheLocation?: string; // Token cache path
}

export interface AuthToken {
  accessToken: string;
  expiresOn: Date;
  account: {
    username: string;
    name: string;
  };
}

export interface AuthProvider {
  getToken(): Promise<AuthToken>;
  clearCache(): Promise<void>;
}
