import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';
import * as argon2 from 'argon2';
import config from '../config';
import logger from '../lib/logger';
import { people } from '../routes/people';

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
  type: 'dev' | 'local' | 'oidc' | 'saml';
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
// Local Auth Provider — Procela-owned credentials (email + password)
// ---------------------------------------------------------------------------
// For deployments without an enterprise IdP (small teams, demos,
// air-gapped environments). Credentials live on the Person record as
// an Argon2id hash; plain text is never stored or logged. The
// passwordHash field is stripped from every Person response via
// publicPerson() in the people route.
//
// Failure paths are deliberately uniform: the same error message is
// returned for "user doesn't exist" and "password is wrong", and we
// run a constant-time verify against a dummy hash when no person is
// found so timing doesn't leak existence. Brute-force protection
// belongs at the route layer (rate limiter), not here.
// ---------------------------------------------------------------------------

// Pre-computed dummy hash used for constant-time response when a user
// doesn't exist. Generated once at module load so the cost is paid
// up-front, not per-request. The value is meaningless; the only
// property that matters is that it parses as a valid Argon2 hash.
let DUMMY_HASH = '';
argon2.hash('dummy-password-procela-init', { type: argon2.argon2id })
  .then((h) => { DUMMY_HASH = h; })
  .catch((err) => logger.error({ err }, 'Failed to seed dummy password hash'));

export class LocalAuthProvider implements AuthProvider {
  name = 'Local';
  type = 'local' as const;

  async validateCredentials(credentials: {
    email?: string;
    password?: string;
  }): Promise<AuthResult> {
    const { email, password } = credentials;

    if (!email || !password) {
      return { success: false, error: 'Email and password are required' };
    }

    const person = people.find((p) => p.email.toLowerCase() === email.toLowerCase());

    // Constant-time branch: when the user doesn't exist, burn the
    // same amount of CPU as a real verify so the response time
    // doesn't reveal account existence.
    if (!person?.passwordHash) {
      if (DUMMY_HASH) {
        try { await argon2.verify(DUMMY_HASH, password); } catch { /* */ }
      }
      return { success: false, error: 'Invalid email or password' };
    }

    let ok = false;
    try {
      ok = await argon2.verify(person.passwordHash, password);
    } catch (err) {
      // Hash format error — treat as invalid credentials so a
      // corrupted record doesn't expose itself as different from a
      // wrong password.
      logger.warn({ err, personId: person.id }, 'Argon2 verify error');
      return { success: false, error: 'Invalid email or password' };
    }

    if (!ok) return { success: false, error: 'Invalid email or password' };

    return {
      success: true,
      user: {
        sub: person.id,
        email: person.email,
        name: person.name,
        role: person.role,
      },
    };
  }
}

// Argon2id parameters used for hashing new passwords. Defaults from
// the argon2 package are OWASP-recommended (memoryCost 64 MiB,
// timeCost 3, parallelism 4) — pass explicitly so the values are
// reviewable here rather than hidden behind a library version bump.
export const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTS);
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
type ProviderName = 'dev' | 'local' | 'oidc' | 'saml';
const VALID_PROVIDERS: ProviderName[] = ['dev', 'local', 'oidc', 'saml'];

interface AuthConfig {
  activeProvider: ProviderName;
}

const authConfig: AuthConfig = {
  activeProvider: VALID_PROVIDERS.includes(config.authProvider as ProviderName)
    ? config.authProvider as ProviderName
    : 'dev',
};

const devProvider = new DevAuthProvider();
const localProvider = new LocalAuthProvider();
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
    case 'local':
      return localProvider;
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
  provider?: ProviderName;
  oidcIssuer?: string;
  oidcClientId?: string;
}): void {
  if (update.provider && VALID_PROVIDERS.includes(update.provider)) {
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
