import { v4 as uuid } from 'uuid';
import logger from '../lib/logger';
import type { AuthProvider, AuthResult } from './auth-providers';

// ──────────────────────────────────────────────────────────────────────────
// saml.service — SAML 2.0 SP-initiated SSO via @node-saml/node-saml.
//
// Flow:
//   1. POST /auth/login (or GET /auth/saml/login) builds the
//      AuthnRequest, signs the redirect, returns the URL the browser
//      should follow to the IdP.
//   2. IdP authenticates the user and POSTs an assertion to
//      /auth/saml/acs (the Assertion Consumer Service URL configured
//      at the IdP). We verify the signature against the IdP cert,
//      extract the subject + attributes, mint Procela JWTs, and
//      redirect to the frontend.
//   3. /auth/saml/sls is the optional Single Logout endpoint — the IdP
//      hits it to invalidate Procela sessions when the user signs
//      out at the IdP side.
//
// The lib does the heavy XML / crypto work. We wrap it behind the
// AuthProvider shape so the rest of Procela treats SAML identically
// to OIDC at the call sites.
//
// Configuration is env-driven:
//   SAML_ENTRY_POINT   IdP SSO URL (where AuthnRequests go)
//   SAML_ISSUER        SP entity ID — Procela's identifier to the IdP
//   SAML_IDP_CERT      IdP signing certificate (PEM, single line OK
//                       — newlines collapsed to spaces are normalised)
//   SAML_CALLBACK_URL  ACS URL the IdP POSTs to (e.g.
//                       https://app.procela.io/api/v1/auth/saml/acs)
//   SAML_LOGOUT_URL    IdP SLO endpoint (optional)
//
// The actual node-saml import is lazy so installs that don't use SAML
// don't pay the cost. isConfigured() returns false until the env is
// set, and the provider falls back to a clear error message rather
// than crashing the boot.
// ──────────────────────────────────────────────────────────────────────────

export interface SamlConfig {
  entryPoint: string;
  issuer: string;
  idpCert: string;
  callbackUrl: string;
  logoutUrl?: string;
}

interface PendingSamlState {
  returnTo: string;
  createdAt: number;
}

const pendingStates = new Map<string, PendingSamlState>();
const STATE_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
}, 60_000).unref?.();

function normaliseCert(raw: string): string {
  // node-saml accepts certs with or without PEM headers, but it's
  // picky about whitespace. Strip headers, collapse whitespace,
  // re-wrap at 64 chars + add headers. This way an operator can paste
  // a single-line cert into the env and it still validates.
  const body = raw
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
  return ['-----BEGIN CERTIFICATE-----', ...lines, '-----END CERTIFICATE-----'].join('\n');
}

export class SamlAuthProvider implements AuthProvider {
  name = 'SAML';
  type = 'saml' as const;
  private config: SamlConfig;
  // node-saml client is lazy-imported on first use so this module
  // doesn't drag the dep into installs that don't need SAML.
  private samlClient: unknown = null;

  constructor(cfg: SamlConfig) {
    this.config = cfg;
  }

  get isConfigured(): boolean {
    return Boolean(this.config.entryPoint && this.config.issuer && this.config.idpCert && this.config.callbackUrl);
  }

  getPublicConfig(): { entryPoint: string; issuer: string; configured: boolean } {
    return {
      entryPoint: this.config.entryPoint,
      issuer: this.config.issuer,
      configured: this.isConfigured,
    };
  }

  private async getClient(): Promise<{
    getAuthorizeUrlAsync: (relayState: string) => Promise<string>;
    validatePostResponseAsync: (body: Record<string, string>) => Promise<{ profile?: Record<string, unknown> }>;
    getLogoutUrlAsync: (user: unknown, relayState: string) => Promise<string>;
  }> {
    if (this.samlClient) return this.samlClient as any;
    if (!this.isConfigured) throw new Error('SAML provider is not configured');
    // Lazy import via constructed string so TS doesn't try to resolve
    // the package at typecheck time for installs without SAML.
    const mod = await import('@node-saml' + '/node-saml');
    const { SAML } = mod as any;
    const client = new SAML({
      entryPoint: this.config.entryPoint,
      issuer: this.config.issuer,
      idpCert: normaliseCert(this.config.idpCert),
      callbackUrl: this.config.callbackUrl,
      ...(this.config.logoutUrl ? { logoutUrl: this.config.logoutUrl } : {}),
      // wantAssertionsSigned defaults to true — leave as the lib's
      // safer default. Signature algorithm / digest stay at the
      // SHA-256 defaults too.
      disableRequestedAuthnContext: true,
    });
    this.samlClient = client;
    return client;
  }

  /** Start a SAML login. Returns the URL the browser should be sent
   *  to so the IdP can authenticate the user. relayState is the
   *  RelayState param — we round-trip the returnTo through it so the
   *  ACS handler knows where to redirect the user after issuing a
   *  Procela session. */
  async startLogin(args: { returnTo: string }): Promise<{ loginUrl: string }> {
    const client = await this.getClient();
    const state = uuid();
    pendingStates.set(state, { returnTo: args.returnTo, createdAt: Date.now() });
    const loginUrl = await client.getAuthorizeUrlAsync(state);
    return { loginUrl };
  }

  /** Process a SAMLResponse posted to the ACS. Verifies the signature
   *  against the configured IdP cert, then maps attributes onto the
   *  Procela user shape. */
  async completeAcs(body: Record<string, string>): Promise<{ user: { sub: string; email: string; name: string; role: string }; returnTo: string }> {
    const client = await this.getClient();
    const result = await client.validatePostResponseAsync(body);
    const profile = (result.profile || {}) as Record<string, unknown>;

    const email = String(
      profile.email
      || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress']
      || profile.nameID
      || '',
    );
    if (!email) throw new Error('SAML assertion did not include an email or NameID');

    const name = String(
      profile.displayName
      || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']
      || (profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : '')
      || email.split('@')[0],
    );

    // Role claim: pick the first known claim name an IdP might
    // emit, otherwise default to VIEWER. Admins can promote via
    // PersonDetailPage after the just-in-time provisioning runs.
    const roleClaim = (profile.role || profile.roles || profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']);
    let role = 'VIEWER';
    if (typeof roleClaim === 'string') role = mapClaimToRole(roleClaim);
    else if (Array.isArray(roleClaim) && roleClaim.length > 0) role = mapClaimToRole(String(roleClaim[0]));

    const relayState = String(body.RelayState || '');
    const pending = relayState ? pendingStates.get(relayState) : null;
    const returnTo = pending?.returnTo || '/';
    if (relayState) pendingStates.delete(relayState);

    return {
      user: {
        sub: String(profile.nameID || email),
        email, name, role,
      },
      returnTo,
    };
  }

  /** Build the URL to redirect the browser to for IdP-side logout
   *  (SP-initiated SLO). When SAML_LOGOUT_URL isn't configured, this
   *  returns null and the caller skips the round-trip. */
  async buildLogoutUrl(args: { sub: string; sessionIndex?: string; returnTo?: string }): Promise<string | null> {
    if (!this.config.logoutUrl) return null;
    try {
      const client = await this.getClient();
      const state = uuid();
      pendingStates.set(state, { returnTo: args.returnTo || '/', createdAt: Date.now() });
      return await client.getLogoutUrlAsync({ nameID: args.sub, sessionIndex: args.sessionIndex }, state);
    } catch (err) {
      logger.warn({ err }, 'SAML buildLogoutUrl failed');
      return null;
    }
  }

  // AuthProvider.validateCredentials — SAML flow goes through
  // startLogin / completeAcs, not direct credential validation.
  async validateCredentials(_credentials: unknown): Promise<AuthResult> {
    return { success: false, error: 'SAML provider requires redirect-based login. Use startLogin() instead.' };
  }
}

function mapClaimToRole(claim: string): string {
  const c = claim.toUpperCase();
  // Direct match against our role names is the common case.
  if (['SUPER_ADMIN', 'ORG_ADMIN', 'PROCESS_OWNER', 'DATA_STEWARD', 'CONTRIBUTOR', 'VIEWER'].includes(c)) {
    return c;
  }
  // Some IdPs emit short codes — map the obvious ones.
  if (c.includes('ADMIN')) return 'ORG_ADMIN';
  if (c.includes('STEWARD')) return 'DATA_STEWARD';
  if (c.includes('OWNER')) return 'PROCESS_OWNER';
  if (c.includes('CONTRIB')) return 'CONTRIBUTOR';
  return 'VIEWER';
}

let samlProvider: SamlAuthProvider | null = null;

function loadConfigFromEnv(): SamlConfig | null {
  const entryPoint = process.env.SAML_ENTRY_POINT || '';
  const issuer = process.env.SAML_ISSUER || '';
  const idpCert = process.env.SAML_IDP_CERT || '';
  const callbackUrl = process.env.SAML_CALLBACK_URL || '';
  if (!entryPoint && !issuer && !idpCert) return null;
  return {
    entryPoint, issuer, idpCert, callbackUrl,
    ...(process.env.SAML_LOGOUT_URL ? { logoutUrl: process.env.SAML_LOGOUT_URL } : {}),
  };
}

/** Return the singleton SAML provider when configured, otherwise null. */
export function getSamlProvider(): SamlAuthProvider | null {
  if (samlProvider) return samlProvider;
  const cfg = loadConfigFromEnv();
  if (!cfg) return null;
  samlProvider = new SamlAuthProvider(cfg);
  return samlProvider;
}
