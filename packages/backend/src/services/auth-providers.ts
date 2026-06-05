import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import * as argon2 from 'argon2';
import config from '../config';
import logger from '../lib/logger';
import { people, isActive as isPersonActive } from '../routes/people';
import { mintFlow, consumeFlow, pkceChallenge, type PendingFlow } from './pending-oidc-flows';
import { resolveEnvSecretSync } from './crypto.service';

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

    // Deactivated users can't sign in even with a valid password.
    // Treat as "invalid credentials" so an attacker can't distinguish
    // an active account with a wrong password from a deactivated one
    // — both responses look the same.
    if (person && !isPersonActive(person)) {
      if (DUMMY_HASH) {
        try { await argon2.verify(DUMMY_HASH, password); } catch { /* */ }
      }
      return { success: false, error: 'Invalid email or password' };
    }

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
  /** Stable identifier — exposed to the frontend and used as the
   *  providerId on /auth/login. Examples: "microsoft", "okta",
   *  "customer-a-entra". Lower-case + hyphen-separated by convention. */
  id: string;
  /** Display name for the login-page button. */
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Optional. When set, this provider only appears on the login page
   *  for users whose email matches one of these domains. The legacy
   *  "type the providerId" path still works for everyone, but the UI
   *  scoping is how org-level IdP isolation surfaces in the browser
   *  ("@customer-a.com → Customer A SSO only"). */
  allowedEmailDomains?: string[];
}

// Cached OIDC discovery document. Refetched if it ages out so a key
// rotation at the IdP doesn't require a Procela restart.
interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
  end_session_endpoint?: string;
}

interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  /** Common group/role claim names from various IdPs; the callback
   *  handler maps these onto a Procela role. */
  groups?: string[];
  roles?: string[];
}

export class OidcAuthProvider implements AuthProvider {
  name = 'OIDC';
  type = 'oidc' as const;
  private config: OidcConfig;

  // Discovery + JWKS state, cached per provider instance. discoveredAt
  // is the wall-clock time of the last successful fetch; we refresh
  // once an hour so a key rotation at the IdP propagates without a
  // restart.
  private discovery: DiscoveryDoc | null = null;
  private discoveredAt = 0;
  private jwks: jwksClient.JwksClient | null = null;
  private static DISCOVERY_TTL_MS = 60 * 60 * 1000;

  constructor(oidcConfig: OidcConfig) {
    this.config = oidcConfig;
  }

  get isConfigured(): boolean {
    return Boolean(this.config.issuer && this.config.clientId);
  }

  /** Returns a safe view of the config (no secrets). */
  getPublicConfig(): {
    id: string;
    displayName: string;
    issuer: string;
    clientId: string;
    configured: boolean;
    isConfigured: boolean;
    allowedEmailDomains?: string[];
  } {
    return {
      id: this.config.id,
      displayName: this.config.displayName,
      issuer: this.config.issuer,
      clientId: this.config.clientId,
      configured: this.isConfigured,
      isConfigured: this.isConfigured,
      ...(this.config.allowedEmailDomains?.length
        ? { allowedEmailDomains: this.config.allowedEmailDomains }
        : {}),
    };
  }

  /** Whether the given email is allowed to use this provider, based
   *  on the configured allowedEmailDomains. When the list is empty
   *  the provider is global (all emails allowed). */
  isAllowedForEmail(email: string): boolean {
    const domains = this.config.allowedEmailDomains;
    if (!domains || domains.length === 0) return true;
    const domain = (email.split('@')[1] || '').toLowerCase();
    return domains.map((d) => d.toLowerCase()).includes(domain);
  }

  /** Update OIDC config at runtime (e.g. from admin settings endpoint).
   *  Invalidates the cached discovery doc so the next call picks up
   *  the new issuer. */
  updateConfig(partial: Partial<OidcConfig>): void {
    if (partial.issuer !== undefined) this.config.issuer = partial.issuer;
    if (partial.clientId !== undefined) this.config.clientId = partial.clientId;
    if (partial.clientSecret !== undefined) this.config.clientSecret = partial.clientSecret;
    this.discovery = null;
    this.discoveredAt = 0;
    this.jwks = null;
  }

  async validateCredentials(_credentials: any): Promise<AuthResult> {
    // OIDC flow uses getLoginUrl + handleCallback, not direct credential validation.
    return { success: false, error: 'OIDC provider requires redirect-based login. Use startLogin() instead.' };
  }

  /** Fetch + cache the IdP's OIDC discovery document. Returns the
   *  cached copy when fresh; refreshes when stale. Throws on network
   *  or parse failure so callers can surface a meaningful error. */
  private async getDiscovery(): Promise<DiscoveryDoc> {
    const now = Date.now();
    if (this.discovery && now - this.discoveredAt < OidcAuthProvider.DISCOVERY_TTL_MS) {
      return this.discovery;
    }
    const url = `${this.config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} from ${url}`);
    const doc = (await res.json()) as DiscoveryDoc;
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer) {
      throw new Error('OIDC discovery document missing required fields');
    }
    this.discovery = doc;
    this.discoveredAt = now;
    this.jwks = jwksClient({
      jwksUri: doc.jwks_uri,
      cache: true,
      cacheMaxAge: 60 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    logger.info({ issuer: doc.issuer, authEndpoint: doc.authorization_endpoint }, 'OIDC discovery refreshed');
    return doc;
  }

  /** Start an Authorization Code + PKCE flow. Mints a state, nonce,
   *  and PKCE code_verifier; returns the URL the browser should visit
   *  to begin authenticating at the IdP. */
  async startLogin(args: {
    providerId: string;
    redirectUri: string;
    returnTo: string;
  }): Promise<{ loginUrl: string; state: string }> {
    if (!this.isConfigured) {
      throw new Error('OIDC provider is not configured');
    }
    const doc = await this.getDiscovery();

    const { state, nonce, codeVerifier } = mintFlow({
      providerId: args.providerId,
      redirectUri: args.redirectUri,
      returnTo: args.returnTo,
    });
    const codeChallenge = pkceChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: args.redirectUri,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      loginUrl: `${doc.authorization_endpoint}?${params.toString()}`,
      state,
    };
  }

  /** Exchange the authorization code for tokens, validate the id_token
   *  against the cached JWKS, and return the user claims. The caller
   *  is responsible for translating claims into a Procela session
   *  (find-or-provision a Person record, issue Procela JWTs).
   *
   *  Returns the raw id_token (verified) so the caller can stash it
   *  for RP-initiated logout — the id_token_hint sent to the IdP's
   *  end_session_endpoint must be the same id_token that this flow
   *  issued, otherwise the IdP can't correlate the logout with the
   *  session it minted. */
  async completeCallback(args: { code: string; state: string }): Promise<{
    user: { sub: string; email: string; name: string; role: string };
    returnTo: string;
    raw: IdTokenClaims;
    idToken: string;
  }> {
    if (!this.isConfigured) throw new Error('OIDC provider is not configured');

    const flow = consumeFlow(args.state);
    if (!flow) throw new Error('Invalid or expired state — the OIDC flow has timed out, please sign in again');

    const doc = await this.getDiscovery();

    // ── Exchange code for tokens ──
    const tokenRes = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        redirect_uri: flow.redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code_verifier: flow.codeVerifier,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      logger.warn({ status: tokenRes.status, body: body.slice(0, 200) }, 'OIDC token exchange failed');
      throw new Error(`Token exchange failed (${tokenRes.status})`);
    }

    const tokenJson = await tokenRes.json() as { id_token?: string; access_token?: string };
    if (!tokenJson.id_token) throw new Error('Token response missing id_token');

    // ── Validate id_token ──
    const claims = await this.verifyIdToken(tokenJson.id_token, flow);

    const role = roleFromClaims(claims);
    const email = (claims.email || claims.preferred_username || '').toLowerCase();
    if (!email) throw new Error('id_token has no email or preferred_username claim');

    const displayName = claims.name
      || (claims.given_name && claims.family_name ? `${claims.given_name} ${claims.family_name}` : null)
      || claims.preferred_username
      || email.split('@')[0];

    return {
      user: {
        sub: claims.sub,
        email,
        name: displayName,
        role,
      },
      returnTo: flow.returnTo,
      raw: claims,
      idToken: tokenJson.id_token,
    };
  }

  /** Build the RP-initiated logout URL per the OIDC spec. Returns
   *  null when the IdP doesn't advertise an end_session_endpoint
   *  (older or non-conformant providers) — caller should fall back
   *  to just clearing the local session. */
  buildLogoutUrl(args: { idToken: string; postLogoutRedirectUri: string }): string | null {
    if (!this.discovery || !this.discovery.end_session_endpoint) return null;
    const params = new URLSearchParams({
      id_token_hint: args.idToken,
      post_logout_redirect_uri: args.postLogoutRedirectUri,
      client_id: this.config.clientId,
    });
    return `${this.discovery.end_session_endpoint}?${params.toString()}`;
  }

  /** Cryptographically verify an id_token against the IdP's JWKS,
   *  plus check iss / aud / exp / nonce. Throws on any failure. */
  private async verifyIdToken(idToken: string, flow: PendingFlow): Promise<IdTokenClaims> {
    if (!this.jwks) throw new Error('JWKS client not initialised — call getDiscovery() first');
    const jwksRef = this.jwks;

    const claims = await new Promise<IdTokenClaims>((resolve, reject) => {
      jwt.verify(
        idToken,
        (header, callback) => {
          if (!header.kid) return callback(new Error('id_token header missing kid'));
          jwksRef.getSigningKey(header.kid, (err, key) => {
            if (err) return callback(err);
            const signingKey = key?.getPublicKey();
            if (!signingKey) return callback(new Error('JWKS returned no signing key'));
            callback(null, signingKey);
          });
        },
        {
          algorithms: ['RS256', 'RS384', 'RS512', 'ES256'],
          // Accept either the discovery-doc issuer or the configured
          // issuer URL — Microsoft Entra in particular often differs.
          issuer: [this.discovery!.issuer, this.config.issuer.replace(/\/$/, '')],
          audience: this.config.clientId,
        },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded as IdTokenClaims);
        },
      );
    });

    // jsonwebtoken handles iss/aud/exp; nonce is application-level so
    // we check it ourselves. A missing or mismatching nonce indicates
    // a replay or a confused-deputy attack.
    if (claims.nonce !== flow.nonce) {
      throw new Error('id_token nonce mismatch');
    }
    return claims;
  }
}

/** Map IdP-supplied claims to a Procela role. The default is the
 *  least-privileged role; an admin can promote later. Customers that
 *  want IdP-driven role assignment can configure their IdP to emit
 *  a `roles` or `groups` claim containing one of Procela's role names. */
function roleFromClaims(claims: IdTokenClaims): string {
  const candidates = [
    ...(claims.roles ?? []),
    ...(claims.groups ?? []),
  ].map((s) => String(s).toUpperCase());
  const known = ['SUPER_ADMIN', 'ORG_ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER'];
  for (const r of known) {
    if (candidates.includes(r)) return r;
  }
  return 'VIEWER';
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

// Multi-IdP registry. Procela can be configured with many OIDC
// providers simultaneously — Entra for one customer, Okta for
// another, a generic OIDC for a third. Each carries its own id +
// display name + issuer + credentials + optional allowed-email-domains
// for org-level scoping.
//
// Bootstrap from env: OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET
// produce a single "default" provider for backward compatibility.
// Additional providers are added at runtime via updateAuthConfig().
// In production the right home for the per-provider config is the
// orgs / branding store; this commit keeps it in process memory so
// the wire-up is observable without a schema change.
const oidcProviders = new Map<string, OidcAuthProvider>();

function loadInitialOidcProviders(): void {
  const issuer = process.env.OIDC_ISSUER || '';
  const clientId = process.env.OIDC_CLIENT_ID || '';
  // OIDC_CLIENT_SECRET supports either plaintext or an enc:v1:…
  // envelope encrypted with the local KMS key. resolveEnvSecretSync
  // decrypts transparently when the envelope is present, otherwise
  // returns the value unchanged.
  const clientSecret = resolveEnvSecretSync(process.env.OIDC_CLIENT_SECRET);
  if (issuer || clientId) {
    // Default provider — id "default" since we can't reliably guess
    // whether the IdP is Microsoft / Okta / generic from env alone.
    // Admin can rename via updateOidcProvider() once configured.
    oidcProviders.set('default', new OidcAuthProvider({
      id: 'default',
      displayName: 'Single sign-on',
      issuer,
      clientId,
      clientSecret,
    }));
  }
}
loadInitialOidcProviders();

/**
 * Returns the currently active auth provider based on configuration.
 * For OIDC, returns the first configured provider — useful for the
 * dev / local / saml branches that only have one slot. OIDC callers
 * that need a specific provider should use getOidcProvider(id).
 */
export function getAuthProvider(): AuthProvider {
  switch (authConfig.activeProvider) {
    case 'local':
      return localProvider;
    case 'oidc': {
      const first = oidcProviders.values().next().value;
      if (first) return first;
      logger.warn('OIDC provider selected but none configured; falling back to dev provider');
      return devProvider;
    }
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
    oidcConfigured: oidcProviders.size > 0
      && Array.from(oidcProviders.values()).some((p) => p.isConfigured),
  };
}

/** Update the active provider and/or OIDC settings at runtime.
 *  Accepts a single-provider update for backwards compatibility; use
 *  upsertOidcProvider() for multi-IdP management. */
export function updateAuthConfig(update: {
  provider?: ProviderName;
  oidcIssuer?: string;
  oidcClientId?: string;
}): void {
  if (update.provider && VALID_PROVIDERS.includes(update.provider)) {
    authConfig.activeProvider = update.provider;
  }
  if (update.oidcIssuer !== undefined || update.oidcClientId !== undefined) {
    // Backwards-compat: when only issuer/clientId are provided,
    // update the "default" provider (or create it if it didn't exist).
    const existing = oidcProviders.get('default');
    if (existing) {
      existing.updateConfig({
        issuer: update.oidcIssuer,
        clientId: update.oidcClientId,
      });
    } else if (update.oidcIssuer || update.oidcClientId) {
      oidcProviders.set('default', new OidcAuthProvider({
        id: 'default',
        displayName: 'Single sign-on',
        issuer: update.oidcIssuer || '',
        clientId: update.oidcClientId || '',
        clientSecret: '',
      }));
    }
  }
}

/** Add or replace an OIDC provider by id. Used by the multi-IdP admin
 *  flow — the same call serves "configure Entra for the first time"
 *  and "rotate the Okta client secret". */
export function upsertOidcProvider(cfg: OidcConfig): void {
  if (!cfg.id) throw new Error('OIDC provider id is required');
  oidcProviders.set(cfg.id, new OidcAuthProvider(cfg));
  logger.info({ id: cfg.id, displayName: cfg.displayName }, 'OIDC provider upserted');
}

export function removeOidcProvider(id: string): boolean {
  return oidcProviders.delete(id);
}

/** Direct access to a specific OIDC provider. */
export function getOidcProvider(id?: string): OidcAuthProvider | null {
  if (id) return oidcProviders.get(id) || null;
  const first = oidcProviders.values().next().value;
  return first || null;
}

/** List all configured OIDC providers. The returned array is safe to
 *  expose to the frontend — no secrets, just the public config
 *  (id, displayName, issuer, isConfigured, allowedEmailDomains). */
export function listOidcProviders(): Array<{
  id: string;
  displayName: string;
  issuer: string;
  isConfigured: boolean;
  allowedEmailDomains?: string[];
}> {
  return Array.from(oidcProviders.values()).map((p) => p.getPublicConfig());
}
