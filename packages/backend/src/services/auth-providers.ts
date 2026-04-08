import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';
import config from '../config';
import logger from '../lib/logger';

// ---------------------------------------------------------------------------
// Auth Provider Abstraction
// ---------------------------------------------------------------------------

export interface AuthResult {
  success: boolean;
  user?: { sub: string; email: string; name: string; role: string };
  error?: string;
}

export interface AuthProvider {
  name: string;
  type: 'dev' | 'oidc' | 'saml';
  validateCredentials(credentials: any): Promise<AuthResult>;
  getLoginUrl?(redirectUri: string): string;
  handleCallback?(code: string, redirectUri: string): Promise<AuthResult>;
}

// ---------------------------------------------------------------------------
// Dev Auth Provider
// ---------------------------------------------------------------------------
// Works exactly like the existing login: accepts { email, name, role? } and
// returns a user object.  No external identity provider required.
// ---------------------------------------------------------------------------

export class DevAuthProvider implements AuthProvider {
  name = 'Development';
  type = 'dev' as const;

  async validateCredentials(credentials: {
    email?: string;
    name?: string;
    role?: string;
  }): Promise<AuthResult> {
    const { email, name, role } = credentials;

    if (!email) {
      return { success: false, error: 'Email is required' };
    }

    return {
      success: true,
      user: {
        sub: uuid(),
        email,
        name: name || email,
        role: role || 'ORG_ADMIN',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// OIDC Auth Provider (placeholder)
// ---------------------------------------------------------------------------
// Stores configuration (issuer, clientId, clientSecret) but returns
// "OIDC not configured" until a real OIDC library is integrated.
//
// Integration points for a real OIDC implementation:
//   1. getLoginUrl()   — build the authorization URL using the issuer's
//                         .well-known/openid-configuration discovery endpoint.
//   2. handleCallback() — exchange the authorization code for tokens,
//                          validate the id_token, and extract user claims.
//   3. validateCredentials() — not typically used for OIDC (the flow goes
//                               through getLoginUrl → handleCallback instead).
// ---------------------------------------------------------------------------

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export class OidcAuthProvider implements AuthProvider {
  name = 'OIDC';
  type = 'oidc' as const;
  private config: OidcConfig;

  constructor(oidcConfig: OidcConfig) {
    this.config = oidcConfig;
  }

  get isConfigured(): boolean {
    return Boolean(this.config.issuer && this.config.clientId);
  }

  /** Returns a safe view of the config (no secrets). */
  getPublicConfig(): { issuer: string; clientId: string; configured: boolean } {
    return {
      issuer: this.config.issuer,
      clientId: this.config.clientId,
      configured: this.isConfigured,
    };
  }

  /** Update OIDC config at runtime (e.g. from admin settings endpoint). */
  updateConfig(partial: Partial<OidcConfig>): void {
    if (partial.issuer !== undefined) this.config.issuer = partial.issuer;
    if (partial.clientId !== undefined) this.config.clientId = partial.clientId;
    if (partial.clientSecret !== undefined) this.config.clientSecret = partial.clientSecret;
  }

  async validateCredentials(_credentials: any): Promise<AuthResult> {
    // OIDC flow uses getLoginUrl + handleCallback, not direct credential validation.
    return { success: false, error: 'OIDC provider requires redirect-based login. Use getLoginUrl() instead.' };
  }

  getLoginUrl(redirectUri: string): string {
    if (!this.isConfigured) {
      // Return an error indicator — the route layer should check isConfigured first.
      return '';
    }

    // TODO: Replace with real OIDC authorization URL construction.
    // Real implementation would:
    //   1. Fetch ${this.config.issuer}/.well-known/openid-configuration
    //   2. Extract the authorization_endpoint
    //   3. Build URL with: response_type=code, client_id, redirect_uri, scope=openid email profile, state, nonce
    //
    // Example:
    //   const authEndpoint = discoveryDoc.authorization_endpoint;
    //   return `${authEndpoint}?response_type=code&client_id=${this.config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid%20email%20profile&state=${state}`;

    return `${this.config.issuer}/authorize?client_id=${this.config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile`;
  }

  async handleCallback(_code: string, _redirectUri: string): Promise<AuthResult> {
    if (!this.isConfigured) {
      return { success: false, error: 'OIDC not configured' };
    }

    // TODO: Replace with real OIDC token exchange.
    // Real implementation would:
    //   1. POST to the token_endpoint with grant_type=authorization_code, code, redirect_uri, client_id, client_secret
    //   2. Validate the returned id_token (signature, issuer, audience, expiry)
    //   3. Extract user claims (sub, email, name) from the id_token
    //   4. Return AuthResult with the user info
    //
    // Example:
    //   const tokenResponse = await fetch(tokenEndpoint, { method: 'POST', body: ... });
    //   const { id_token, access_token } = await tokenResponse.json();
    //   const claims = jwt.decode(id_token);
    //   return { success: true, user: { sub: claims.sub, email: claims.email, name: claims.name, role: 'VIEWER' } };

    return { success: false, error: 'OIDC not configured — callback handling not yet implemented' };
  }
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

// In-memory mutable auth configuration. The active provider can be changed
// at runtime via the PUT /api/v1/auth/config endpoint.
interface AuthConfig {
  activeProvider: 'dev' | 'oidc' | 'saml';
}

const authConfig: AuthConfig = {
  activeProvider: (config.authProvider === 'dev' || config.authProvider === 'oidc' || config.authProvider === 'saml')
    ? config.authProvider as 'dev' | 'oidc' | 'saml'
    : 'dev',
};

const devProvider = new DevAuthProvider();
const oidcProvider = new OidcAuthProvider({
  issuer: process.env.OIDC_ISSUER || '',
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
});

/**
 * Returns the currently active auth provider based on configuration.
 */
export function getAuthProvider(): AuthProvider {
  switch (authConfig.activeProvider) {
    case 'oidc':
      return oidcProvider;
    case 'saml':
      // SAML not yet implemented — fall back to dev with a warning
      logger.warn('SAML provider requested but not implemented; falling back to dev provider');
      return devProvider;
    case 'dev':
    default:
      return devProvider;
  }
}

/** Get the current auth config (safe to expose — no secrets). */
export function getAuthConfig(): {
  provider: string;
  providerName: string;
  oidcConfigured: boolean;
} {
  const provider = getAuthProvider();
  return {
    provider: authConfig.activeProvider,
    providerName: provider.name,
    oidcConfigured: oidcProvider.isConfigured,
  };
}

/** Update the active provider and/or OIDC settings at runtime. */
export function updateAuthConfig(update: {
  provider?: 'dev' | 'oidc' | 'saml';
  oidcIssuer?: string;
  oidcClientId?: string;
}): void {
  if (update.provider) {
    authConfig.activeProvider = update.provider;
  }
  if (update.oidcIssuer !== undefined || update.oidcClientId !== undefined) {
    oidcProvider.updateConfig({
      issuer: update.oidcIssuer,
      clientId: update.oidcClientId,
    });
  }
}

/** Direct access to the OIDC provider (used by auth routes). */
export function getOidcProvider(): OidcAuthProvider {
  return oidcProvider;
}
