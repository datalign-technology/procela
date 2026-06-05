import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import config from '../config';
import { AuthenticatedRequest, authenticateToken, authorize } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people, computeAccessibleOrgs, isActive as isPersonActive } from './people';
import { organizations } from './organizations';
import { saveStore } from '../lib/persistence';
import { validatePassword } from '../lib/password-policy';
import { mintResetToken, consumeResetToken, RESET_TOKEN_TTL_MS } from '../services/reset-tokens';
import { peekFlow } from '../services/pending-oidc-flows';
import { sendPasswordResetEmail, isConfigured as isMailConfigured } from '../services/mail.service';
import {
  getAuthProvider,
  getAuthConfig,
  updateAuthConfig,
  getOidcProvider,
  listOidcProviders,
  upsertOidcProvider,
  removeOidcProvider,
  hashPassword,
} from '../services/auth-providers';

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ---------------------------------------------------------------------------
// In-memory refresh token store
// ---------------------------------------------------------------------------
// Stores valid refresh token JTIs alongside per-session context the
// logout handler needs:
//   - oidcProviderId / oidcIdToken: present when the session was
//     issued by an OIDC flow. Used to drive RP-initiated logout —
//     we send the user to the IdP's end_session_endpoint with the
//     id_token_hint so the IdP also clears its session, not just
//     Procela's. Without this round-trip, logging out of Procela
//     leaves the user signed in at Microsoft / Okta and a fresh
//     "Sign in with Microsoft" click silently logs them back in.
// In production this would be backed by Redis or a database table.
// ---------------------------------------------------------------------------
interface RefreshTokenContext {
  oidcProviderId?: string;
  oidcIdToken?: string;
}
const validRefreshTokens = new Map<string, RefreshTokenContext>();

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const IS_DEV = (process.env.NODE_ENV || 'development') !== 'production';
const ACCESS_TOKEN_EXPIRY = IS_DEV ? '8h' : '15m';
const ACCESS_TOKEN_EXPIRY_SECONDS = IS_DEV ? 8 * 60 * 60 : 15 * 60;
const REFRESH_TOKEN_EXPIRY = '8h';

interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  orgId: string;
  role: string;
  type: 'access';
}

interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}

function createAccessToken(user: {
  sub: string;
  email: string;
  name: string;
  role: string;
  orgId?: string;
}): string {
  const payload: AccessTokenPayload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    orgId: user.orgId || DEV_ORG_ID,
    role: user.role,
    type: 'access',
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function createRefreshToken(sub: string, context: RefreshTokenContext = {}): { token: string; jti: string } {
  const jti = uuid();
  const payload: RefreshTokenPayload = { sub, type: 'refresh', jti };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: REFRESH_TOKEN_EXPIRY });
  validRefreshTokens.set(jti, context);
  return { token, jti };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();

// Login: 5 attempts per minute per (IP, email) pair, with a wider
// 20-per-hour ceiling. Keyed on both axes so spreading attempts
// across emails from one IP still throttles, and so a shared NAT'd
// IP doesn't lock out a whole office because of one bad actor.
const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyBy: (req) => `${req.ip || 'noip'}:${(req.body?.email || '').toLowerCase()}`,
  label: 'login',
});
const loginHourLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 20,
  keyBy: (req) => `${req.ip || 'noip'}:${(req.body?.email || '').toLowerCase()}`,
  label: 'login_hour',
});

// Password change / forgot: 10 per hour per user. Forgot-password
// keyed on email only so a user can't be locked out by someone
// spamming reset requests from random IPs against their address.
const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  keyBy: (req) => `${(req as AuthenticatedRequest).user?.sub || req.ip || 'anon'}`,
  label: 'password_change',
});
const forgotLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  keyBy: (req) => `forgot:${(req.body?.email || '').toLowerCase()}`,
  label: 'password_forgot',
});


/**
 * POST /api/v1/auth/login
 *
 * Uses the active auth provider to authenticate the user.
 *
 * Dev mode:  accepts { email, name, role? } -> returns accessToken + refreshToken.
 * OIDC mode: returns { loginUrl } for redirect-based authentication.
 */
router.post('/login', loginLimiter, loginHourLimiter, async (req: Request, res: Response) => {
  try {
    const provider = getAuthProvider();

    // ── OIDC redirect flow ──
    if (provider.type === 'oidc') {
      // providerId on the request selects which configured OIDC
      // provider to drive. Missing → use the first configured one.
      // Frontend passes it from the SSO button click; callers without
      // the multi-IdP UI get backward-compatible single-provider
      // behaviour.
      const providerId: string = req.body.providerId || 'default';
      const oidc = getOidcProvider(providerId) || getOidcProvider();
      if (!oidc || !oidc.isConfigured) {
        res.status(503).json({
          success: false,
          error: `OIDC provider "${providerId}" is not configured.`,
        });
        return;
      }

      // redirectUri is where the IdP will send the browser after
      // authentication. Defaults to /api/v1/auth/callback on the same
      // origin; the IdP must have this URL registered. returnTo is
      // where the frontend should land once a Procela session is
      // issued — preserved across the round-trip via the flow store.
      const redirectUri = req.body.redirectUri
        || `${req.protocol}://${req.get('host')}/api/v1/auth/callback`;
      const returnTo = req.body.returnTo || '/';

      try {
        const { loginUrl } = await oidc.startLogin({
          providerId,
          redirectUri,
          returnTo,
        });
        auditService.log(DEV_ORG_ID, null, 'Auth', 'login', 'OIDC_LOGIN_REDIRECT', null, { providerId, redirectUri });
        res.json({ success: true, data: { loginUrl, provider: 'oidc', providerId } });
      } catch (err: any) {
        // Discovery failures (bad issuer, network) end up here. Surface
        // a clean message so an admin can spot a misconfig.
        logger.warn({ err: err?.message, providerId }, 'OIDC login start failed');
        res.status(503).json({ success: false, error: err?.message || 'Failed to start OIDC flow' });
      }
      return;
    }

    // ── Dev / direct credential flow ──
    const result = await provider.validateCredentials(req.body);

    if (!result.success || !result.user) {
      auditService.log(DEV_ORG_ID, null, 'Auth', 'login', 'LOGIN_FAILED', null, {
        email: req.body.email,
        error: result.error || 'Unknown error',
      });
      res.status(401).json({ success: false, error: result.error || 'Authentication failed' });
      return;
    }

    const user = result.user;

    // Resolve user's org and role from people records (if they exist)
    const personRecord = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase());
    const resolvedOrgId = personRecord?.orgIds?.[0] || DEV_ORG_ID;
    const resolvedRole = personRecord?.role || user.role;

    // Defensive: if no person record and submitted name looks like a password
    // (contains digits + special chars, no spaces), fall back to email prefix.
    // This prevents autofilled passwords from landing in the display name.
    const looksLikePassword = user.name && /[!@#$%^&*()_+=<>?{}[\]|\\:;"']/.test(user.name) && !/\s/.test(user.name);
    const fallbackName = user.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const resolvedName = personRecord?.name || (looksLikePassword ? fallbackName : user.name) || fallbackName;

    const accessToken = createAccessToken({
      ...user,
      name: resolvedName,
      orgId: resolvedOrgId,
      role: resolvedRole,
    });
    const refresh = createRefreshToken(user.sub);

    auditService.log(resolvedOrgId, user.sub, 'Auth', 'login', 'LOGIN_SUCCESS', null, {
      email: user.email,
      provider: provider.type,
      resolvedOrg: resolvedOrgId,
      resolvedRole,
    });
    logger.info({ email: user.email, provider: provider.type, orgId: resolvedOrgId, role: resolvedRole }, 'Login successful');

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken: refresh.token,
        expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
        // True when the local credential was set by an admin / the
        // dev→local migration and must be rotated before normal use.
        // The frontend should redirect to a forced-change-password
        // flow when this is true; the session is still issued so the
        // change-password endpoint is reachable.
        passwordMustChange: !!personRecord?.passwordMustChange,
        user: {
          sub: user.sub,
          email: user.email,
          name: resolvedName,
          orgId: resolvedOrgId,
          role: resolvedRole,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, 'Login error');
    res.status(500).json({ success: false, error: 'Internal authentication error' });
  }
});

/**
 * GET /api/v1/auth/callback
 *
 * The OIDC redirect target. The IdP sends ?code=…&state=… here (or
 * ?error=…&error_description=… on user-cancel). We exchange the code
 * for tokens, validate the id_token, find or just-in-time-provision
 * the Person record, issue Procela JWTs, and redirect the browser
 * back to the frontend with the tokens in the URL fragment.
 *
 * URL fragments are not sent in subsequent HTTP requests and don't
 * appear in proxy / CDN access logs, so they're a safer carrier for
 * short-lived tokens than query strings. The frontend's
 * /oidc-complete route reads the fragment and stores via authStore.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  // FRONTEND_URL defaults to the same origin as the API call. In a
  // typical deployment the frontend and API share a domain via a
  // reverse proxy; if not, set APP_URL in the env to the frontend's
  // origin so redirects land on the right host.
  const frontendBase = (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const errorRedirect = (msg: string) =>
    res.redirect(`${frontendBase}/login?error=${encodeURIComponent(msg)}`);

  if (error) {
    auditService.log(DEV_ORG_ID, null, 'Auth', 'oidc', 'OIDC_CALLBACK_ERROR', null, {
      error: String(error),
      description: String(error_description || ''),
    });
    return errorRedirect(String(error_description || error));
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    return errorRedirect('Missing code or state on OIDC callback');
  }

  try {
    // Peek the pending flow to find which configured OIDC provider
    // this state was minted from. Multi-IdP installs need the right
    // provider's clientId / clientSecret / issuer for the token
    // exchange and JWKS verification. completeCallback() consumes
    // the flow after this peek.
    const flow = peekFlow(state);
    if (!flow) {
      return errorRedirect('Invalid or expired state — the OIDC flow has timed out, please sign in again');
    }
    const oidc = getOidcProvider(flow.providerId) || getOidcProvider();
    if (!oidc) {
      return errorRedirect(`OIDC provider "${flow.providerId}" is no longer configured`);
    }
    const { user, returnTo, idToken } = await oidc.completeCallback({ code, state });

    // Find-or-just-in-time-provision. Treat the IdP's email as the
    // identity key — when a Person with that email exists, attach the
    // session to them (preserves orgIds, role, name overrides). When
    // not, create a minimal Person assigned to the dev org with the
    // IdP-supplied role (VIEWER unless the IdP emitted a known role
    // claim). Admins can move them to the right org later.
    let person = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase());

    // Deactivated users can't sign in via OIDC either. We let the
    // IdP do the heavy auth lift and then reject — surface a generic
    // "Your account is not active" rather than something that leaks
    // org membership.
    if (person && !isPersonActive(person)) {
      auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'oidc', 'OIDC_DEACTIVATED_LOGIN_BLOCKED', null, {
        email: person.email, idpSub: user.sub,
      });
      return errorRedirect('Your Procela account is not active. Contact an administrator.');
    }

    let provisioned = false;
    if (!person) {
      const now = new Date().toISOString();
      person = {
        id: uuid(),
        orgIds: [DEV_ORG_ID],
        accessibleOrgIds: [DEV_ORG_ID],
        name: user.name,
        email: user.email,
        role: user.role,
        title: '',
        skillIds: [],
        createdAt: now,
        updatedAt: now,
      };
      people.push(person);
      saveStore('people', people);
      provisioned = true;
    }

    const orgId = person.orgIds[0] || DEV_ORG_ID;
    const role = person.role || user.role;
    const accessToken = createAccessToken({
      sub: person.id, email: person.email, name: person.name, role, orgId,
    });
    // Capture the OIDC providerId + id_token on the refresh-token
    // entry so /auth/logout can drive RP-initiated logout. The
    // id_token is verified, contains no Procela secret, and is only
    // valid as a logout hint for this specific IdP session — safe
    // to hold for the refresh-token lifetime.
    const refresh = createRefreshToken(person.id, {
      oidcProviderId: flow.providerId,
      oidcIdToken: idToken,
    });

    auditService.log(orgId, person.id, 'Auth', 'oidc', 'OIDC_CALLBACK_SUCCESS', null, {
      email: person.email,
      provisioned,
      idpSub: user.sub,
    });
    logger.info({ personId: person.id, provisioned }, 'OIDC login successful');

    // Tokens travel in the URL fragment — not the query string —
    // so they don't get captured by proxy / CDN access logs and
    // don't reach the backend on subsequent requests. The frontend
    // /oidc-complete route reads the fragment immediately and then
    // replaces the URL via history.replaceState so the tokens don't
    // sit in the address bar.
    const params = new URLSearchParams({
      accessToken,
      refreshToken: refresh.token,
      expiresIn: String(ACCESS_TOKEN_EXPIRY_SECONDS),
      returnTo,
    });
    return res.redirect(`${frontendBase}/oidc-complete#${params.toString()}`);
  } catch (err: any) {
    auditService.log(DEV_ORG_ID, null, 'Auth', 'oidc', 'OIDC_CALLBACK_FAILED', null, {
      error: err?.message || String(err),
    });
    logger.warn({ err: err?.message }, 'OIDC callback failed');
    return errorRedirect(err?.message || 'OIDC callback failed');
  }
});

/**
 * POST /api/v1/auth/refresh
 *
 * Accepts { refreshToken } and returns a new access token.
 * The refresh token itself is not rotated (single-use revocation via logout).
 */
router.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ success: false, error: 'refreshToken is required' });
    return;
  }

  try {
    const decoded = jwt.verify(refreshToken, config.jwtSecret) as RefreshTokenPayload;

    if (decoded.type !== 'refresh') {
      res.status(401).json({ success: false, error: 'Invalid token type' });
      return;
    }

    if (!validRefreshTokens.has(decoded.jti)) {
      auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'refresh', 'REFRESH_REVOKED', null, {
        jti: decoded.jti,
      });
      res.status(401).json({ success: false, error: 'Refresh token has been revoked' });
      return;
    }

    // Mint a new access token.  We need the user details — for dev mode we
    // re-derive them from the sub claim.  In production the refresh token
    // would be looked up in a session store that holds the full user record.
    const accessToken = jwt.sign(
      { sub: decoded.sub, type: 'access' } as any,
      config.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY },
    );

    auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'refresh', 'TOKEN_REFRESHED', null, null);
    logger.debug({ sub: decoded.sub }, 'Token refreshed');

    res.json({ success: true, data: { accessToken, expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS } });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  }
});

/**
 * POST /api/v1/auth/logout
 *
 * Accepts { refreshToken } and invalidates it so it can no longer be
 * used to obtain new access tokens. When the session was originally
 * issued by an OIDC flow AND the IdP advertises an end_session_endpoint,
 * the response carries a `logoutUrl` the frontend should redirect to —
 * that's the RP-initiated logout per the OIDC spec. Without that
 * round-trip, the IdP still considers the user signed in and a fresh
 * "Sign in" click silently logs them back in.
 */
router.post('/logout', (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ success: false, error: 'refreshToken is required' });
    return;
  }

  try {
    const decoded = jwt.verify(refreshToken, config.jwtSecret) as RefreshTokenPayload;

    if (decoded.type !== 'refresh') {
      res.status(400).json({ success: false, error: 'Invalid token type' });
      return;
    }

    // Pull the session context BEFORE deleting so we can build the
    // RP-initiated logout URL with the original id_token.
    const ctx = validRefreshTokens.get(decoded.jti) || {};
    const wasValid = validRefreshTokens.delete(decoded.jti);

    let logoutUrl: string | null = null;
    if (ctx.oidcProviderId && ctx.oidcIdToken) {
      const oidc = getOidcProvider(ctx.oidcProviderId);
      if (oidc) {
        const postLogoutRedirectUri = (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '') + '/login';
        logoutUrl = oidc.buildLogoutUrl({
          idToken: ctx.oidcIdToken,
          postLogoutRedirectUri,
        });
      }
    }

    auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'logout', 'LOGOUT', null, {
      jti: decoded.jti,
      wasValid,
      rpInitiated: !!logoutUrl,
      oidcProviderId: ctx.oidcProviderId || null,
    });
    logger.info({ sub: decoded.sub, rpInitiated: !!logoutUrl }, 'User logged out');

    res.json({
      success: true,
      data: {
        message: 'Logged out successfully',
        ...(logoutUrl ? { logoutUrl } : {}),
      },
    });
  } catch {
    // Even if the token is expired/invalid, treat as a successful logout —
    // the token is unusable regardless.
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  }
});

/**
 * GET /api/v1/auth/me
 *
 * Returns the current user from the JWT access token.
 * Requires authentication.
 */
router.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    data: req.user,
  });
});

/**
 * GET /api/v1/auth/providers
 *
 * Returns available auth providers and current active provider.
 * Public endpoint (no auth required).
 */
router.get('/providers', (req: Request, res: Response) => {
  const authCfg = getAuthConfig();
  const allOidc = listOidcProviders();

  // When the caller knows the user's email (e.g. a "what's your work
  // address?" prompt on the login page), scope the OIDC list to
  // providers whose allowedEmailDomains either match or are empty
  // (global). When no email hint is provided, show every configured
  // OIDC provider — the user picks.
  const emailHint = String(req.query.emailHint || '').toLowerCase();
  const domain = emailHint.includes('@') ? emailHint.split('@')[1] : '';
  const oidcForUser = allOidc.filter((p) => {
    if (!p.allowedEmailDomains || p.allowedEmailDomains.length === 0) return true;
    return p.allowedEmailDomains.map((d) => d.toLowerCase()).includes(domain);
  });

  const oidcButtons = oidcForUser.map((p) => ({
    id: p.id,
    name: p.displayName,
    type: 'oidc',
    enabled: authCfg.provider === 'oidc' && p.isConfigured,
  }));

  res.json({
    success: true,
    data: {
      current: authCfg.provider,
      currentName: authCfg.providerName,
      providers: [
        ...oidcButtons,
        {
          id: 'local',
          name: 'Local credentials',
          type: 'local',
          enabled: authCfg.provider === 'local',
        },
        {
          id: 'dev',
          name: 'Dev Mode',
          type: 'dev',
          enabled: authCfg.provider === 'dev',
        },
      ],
      // Keep the old shape for backward compatibility
      available: [
        { type: 'dev', name: 'Development', description: 'Email-based dev login (no IdP required)' },
        { type: 'local', name: 'Local credentials', description: 'Email + password, stored in Procela as Argon2 hashes', configured: true },
        { type: 'oidc', name: 'OIDC', description: 'OpenID Connect (Azure AD, Okta, etc.)', configured: authCfg.oidcConfigured },
        { type: 'saml', name: 'SAML', description: 'SAML 2.0 (coming soon)', configured: false },
      ],
    },
  });
});

/**
 * GET /api/v1/auth/config
 *
 * Returns auth configuration status (no secrets exposed).
 * Public endpoint.
 */
router.get('/config', (_req: Request, res: Response) => {
  const authCfg = getAuthConfig();
  // Legacy: the first OIDC provider gets surfaced as issuerUrl /
  // clientId for back-compat with single-IdP frontends. The full
  // list lives under oidcProviders.
  const first = getOidcProvider();
  const firstPub = first?.getPublicConfig();
  res.json({
    success: true,
    data: {
      provider: authCfg.provider,
      providerName: authCfg.providerName,
      oidcConfigured: authCfg.oidcConfigured,
      issuerUrl: firstPub?.issuer || '',
      clientId: firstPub?.clientId || '',
      oidcProviders: listOidcProviders(),
    },
  });
});

/**
 * POST /api/v1/auth/oidc-providers
 * PUT  /api/v1/auth/oidc-providers/:id
 *
 * Upsert an OIDC provider for multi-IdP installs. Admin-only. Body:
 *   { id, displayName, issuer, clientId, clientSecret, allowedEmailDomains? }
 *
 * id is the stable handle the frontend passes as providerId on
 * /auth/login (and matches the entry in /auth/providers). clientSecret
 * is never echoed back; updates are write-only.
 */
router.post('/oidc-providers', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  (req: AuthenticatedRequest, res: Response) => {
    const { id, displayName, issuer, clientId, clientSecret, allowedEmailDomains } = req.body;
    if (!id || !displayName || !issuer || !clientId || !clientSecret) {
      res.status(400).json({ success: false, error: 'id, displayName, issuer, clientId, clientSecret are required' });
      return;
    }
    upsertOidcProvider({
      id, displayName, issuer, clientId, clientSecret,
      ...(Array.isArray(allowedEmailDomains) ? { allowedEmailDomains } : {}),
    });
    auditService.log(DEV_ORG_ID, req.user?.sub || null, 'Auth', 'oidc', 'OIDC_PROVIDER_UPSERTED', null, {
      id, displayName, issuer,
    });
    res.json({ success: true, data: { id, displayName, issuer } });
  });

router.delete('/oidc-providers/:id', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id);
    const removed = removeOidcProvider(id);
    if (!removed) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }
    auditService.log(DEV_ORG_ID, req.user?.sub || null, 'Auth', 'oidc', 'OIDC_PROVIDER_REMOVED', null, { id });
    res.json({ success: true });
  });

/**
 * PUT /api/v1/auth/config
 *
 * Update auth provider configuration at runtime.
 * Accepts { provider?, oidcIssuer?, oidcClientId? }.
 * Secrets (clientSecret) are never returned in the response.
 */
router.put('/config', (req: Request, res: Response) => {
  const { provider, oidcIssuer, oidcClientId } = req.body;

  const validProviders = ['dev', 'local', 'oidc', 'saml'];
  if (provider && !validProviders.includes(provider)) {
    res.status(400).json({
      success: false,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    });
    return;
  }

  updateAuthConfig({ provider, oidcIssuer, oidcClientId });

  const authCfg = getAuthConfig();
  auditService.log(DEV_ORG_ID, null, 'Auth', 'config', 'AUTH_CONFIG_UPDATED', null, {
    provider: authCfg.provider,
    oidcConfigured: authCfg.oidcConfigured,
  });
  logger.info({ provider: authCfg.provider }, 'Auth config updated');

  res.json({
    success: true,
    data: {
      provider: authCfg.provider,
      providerName: authCfg.providerName,
      oidcConfigured: authCfg.oidcConfigured,
    },
  });
});

// ---------------------------------------------------------------------------
// Local-provider password management
// ---------------------------------------------------------------------------
// Three routes work together:
//   /password               authenticated user changes their own password
//   /password/admin-reset   admin sets a password for another user
//   /password/forgot        anyone requests a reset (email-driven)
//
// All three:
//   - Hash via Argon2id (never store plain text, never log it).
//   - Run the new password through validatePassword() — same rules
//     wherever a password is set.
//   - Write an audit entry with actor + target + action; never the
//     password itself.
//   - Return 204 No Content on success (no token, no echo, no leak).
//
// Routes are wired regardless of the active provider so an admin can
// pre-stage Local credentials while still using Dev for login.
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/auth/password
 * Body: { currentPassword, newPassword }
 *
 * Authenticated user changes their own password. Requires the current
 * password as a re-auth step (matches the bank / GitHub pattern —
 * sensitive change inside an active session still needs a fresh proof
 * of knowledge).
 */
router.post('/password', authenticateToken, passwordChangeLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    return;
  }

  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }

  const person = people.find((p) => p.id === userId);
  if (!person) {
    res.status(404).json({ success: false, error: 'No person record found for the current user' });
    return;
  }

  // No local password set yet — block. This is intentionally an
  // explicit failure rather than treating it as "first set" so the
  // initial credential always goes through the admin migration or
  // the forgot-password path (both of which audit-log a setup
  // event). Letting any authenticated session silently create a
  // first password would be a privilege-escalation hole if the
  // session itself was issued by a different provider.
  if (!person.passwordHash) {
    res.status(409).json({
      success: false,
      error: 'No local password is set for this account. Ask an admin to set one or use the password-reset flow.',
    });
    return;
  }

  let ok = false;
  try { ok = await argon2.verify(person.passwordHash, currentPassword); } catch { /* */ }
  if (!ok) {
    auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'password', 'PASSWORD_CHANGE_FAILED', null, { reason: 'wrong_current' });
    res.status(401).json({ success: false, error: 'Current password is incorrect' });
    return;
  }

  const valid = validatePassword(newPassword);
  if (!valid.valid) {
    res.status(400).json({ success: false, error: valid.error });
    return;
  }

  person.passwordHash = await hashPassword(newPassword);
  person.passwordUpdatedAt = new Date().toISOString();
  person.passwordMustChange = false;
  person.updatedAt = person.passwordUpdatedAt;
  saveStore('people', people);

  auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'password', 'PASSWORD_CHANGED', null, { self: true });
  logger.info({ personId: person.id }, 'User changed their password');

  res.status(204).end();
});

/**
 * POST /api/v1/auth/password/admin-reset
 * Body: { personId, newPassword, requireChangeOnNextLogin? }
 *
 * Org Admin or Super Admin sets a password for another user. Skips
 * the current-password check because the admin is using their own
 * authenticated session as the authorization proof. The target user's
 * passwordMustChange flag is set to true by default so the next login
 * forces a self-reset — the admin should never know the user's
 * working password.
 */
router.post('/password/admin-reset', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { personId, newPassword, requireChangeOnNextLogin = true } = req.body;

    if (!personId || !newPassword) {
      res.status(400).json({ success: false, error: 'personId and newPassword are required' });
      return;
    }

    const target = people.find((p) => p.id === personId);
    if (!target) {
      res.status(404).json({ success: false, error: 'Person not found' });
      return;
    }

    const valid = validatePassword(newPassword);
    if (!valid.valid) {
      res.status(400).json({ success: false, error: valid.error });
      return;
    }

    target.passwordHash = await hashPassword(newPassword);
    target.passwordUpdatedAt = new Date().toISOString();
    target.passwordMustChange = requireChangeOnNextLogin !== false;
    target.updatedAt = target.passwordUpdatedAt;
    saveStore('people', people);

    auditService.log(target.orgIds[0] || DEV_ORG_ID, req.user?.sub || null, 'Auth', 'password', 'PASSWORD_ADMIN_RESET', null, {
      targetPersonId: target.id,
      targetEmail: target.email,
      requireChangeOnNextLogin: target.passwordMustChange,
    });
    logger.info({ adminId: req.user?.sub, targetId: target.id }, 'Admin reset password');

    res.status(204).end();
  });

/**
 * POST /api/v1/auth/password/forgot
 * Body: { email }
 *
 * Anyone may request a reset. Always returns 204 — never confirms
 * whether the email exists (prevents enumeration). When the email
 * matches a real person, a single-use reset token is minted and
 * either delivered by email (production) or returned to the dev
 * audit log so an admin can hand it over out-of-band.
 *
 * Token redemption: POST /auth/password/reset with { token, newPassword }.
 */
router.post('/password/forgot', forgotLimiter, async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ success: false, error: 'email is required' });
    return;
  }

  const person = people.find((p) => p.email.toLowerCase() === email.toLowerCase());
  const mailReady = isMailConfigured();

  if (person) {
    const token = mintResetToken(person.id);
    const ttlMinutes = Math.round(RESET_TOKEN_TTL_MS / 60_000);

    // Try email delivery first when SMTP is configured. Audit entry
    // records whether the send actually succeeded so a misconfigured
    // production env shows up in reports.
    let delivered = false;
    if (mailReady) {
      delivered = await sendPasswordResetEmail({
        to: person.email,
        name: person.name,
        token,
        ttlMinutes,
      });
    }

    auditService.log(person.orgIds[0] || DEV_ORG_ID, null, 'Auth', 'password', 'PASSWORD_RESET_REQUESTED', null, {
      targetPersonId: person.id,
      targetEmail: person.email,
      deliveryChannel: delivered ? 'email' : 'audit',
      // Include the plaintext token in the audit entry only when SMTP
      // delivery did not happen (dev mode, or a production env where
      // SMTP failed). When the email goes out, the token leaves with
      // it and shouldn't be re-exposed via the audit feed.
      ...(!delivered ? { resetTokenDev: token } : {}),
    });
    logger.info({
      personId: person.id,
      ttlMs: RESET_TOKEN_TTL_MS,
      delivered,
    }, 'Password reset token minted');
  } else {
    // Always log the request — even for unknown emails — so brute
    // enumeration via this endpoint shows up as a pattern.
    logger.info({ email }, 'Password reset requested for unknown email');
  }

  // Uniform response regardless of whether the email matched.
  res.status(204).end();
});

/**
 * POST /api/v1/auth/password/reset
 * Body: { token, newPassword }
 *
 * Consumes a forgot-password token and sets a new password.
 * Single-use: the token is deleted on first read whether the new
 * password validates or not. The reset clears passwordMustChange
 * because the user has just demonstrated control of the recovery
 * channel and is choosing their own password.
 *
 * Uniform 400 for "invalid or expired token" so a caller can't
 * distinguish between "token never existed" and "token consumed
 * already" — both are equivalently terminal.
 */
router.post('/password/reset', forgotLimiter, async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    res.status(400).json({ success: false, error: 'token and newPassword are required' });
    return;
  }

  const personId = consumeResetToken(token);
  if (!personId) {
    res.status(400).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  const valid = validatePassword(newPassword);
  if (!valid.valid) {
    res.status(400).json({ success: false, error: valid.error });
    return;
  }

  const person = people.find((p) => p.id === personId);
  if (!person) {
    // The token was minted for a person that no longer exists.
    // Treat as terminal — log so the orphan token shows up but
    // return the uniform "invalid" response.
    logger.warn({ personId }, 'Reset token bound to missing person');
    res.status(400).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  person.passwordHash = await hashPassword(newPassword);
  person.passwordUpdatedAt = new Date().toISOString();
  person.passwordMustChange = false;
  person.updatedAt = person.passwordUpdatedAt;
  saveStore('people', people);

  auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'password', 'PASSWORD_RESET_CONSUMED', null, {
    targetPersonId: person.id,
  });
  logger.info({ personId: person.id }, 'Password reset via token');

  res.status(204).end();
});

/**
 * POST /api/v1/auth/migrate-to-local
 * Body: { generateTempPasswords?: boolean }
 *
 * One-time admin action that moves an org from Dev to Local auth.
 * Generates a strong one-time password for every Person without a
 * passwordHash, hashes it, and returns the plaintext temp passwords
 * ONCE in the response. Marks every generated password as
 * must-change so users are forced to set their own on first login.
 *
 * After this runs, the admin should switch the active auth provider
 * to 'local' via PUT /auth/config and distribute the temp passwords
 * out-of-band (printed sheets, secure messaging, etc).
 */
router.post('/migrate-to-local', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  async (req: AuthenticatedRequest, res: Response) => {
    const targets = people.filter((p) => !p.passwordHash);

    const temp: Array<{ personId: string; email: string; name: string; tempPassword: string }> = [];
    for (const p of targets) {
      // 16 chars from a URL-safe alphabet — far above the policy
      // minimum, easy to copy/paste, no characters that get mangled
      // by terminals or Word's autocorrect.
      const tempPassword = generateTempPassword(16);
      p.passwordHash = await hashPassword(tempPassword);
      p.passwordUpdatedAt = new Date().toISOString();
      p.passwordMustChange = true;
      p.updatedAt = p.passwordUpdatedAt;
      temp.push({ personId: p.id, email: p.email, name: p.name, tempPassword });
    }
    saveStore('people', people);

    auditService.log(DEV_ORG_ID, req.user?.sub || null, 'Auth', 'migrate', 'MIGRATED_TO_LOCAL', null, {
      count: targets.length,
    });
    logger.info({ adminId: req.user?.sub, count: targets.length }, 'Migrated people to local auth');

    res.json({
      success: true,
      data: {
        count: temp.length,
        message: temp.length === 0
          ? 'All people already have local credentials — nothing to migrate.'
          : `Generated temporary passwords for ${temp.length} people. Distribute these out-of-band; every recipient is required to change their password on first login. The plaintext values are shown ONCE and never stored.`,
        tempPasswords: temp,
      },
    });
  });

function generateTempPassword(length: number): string {
  // URL-safe alphabet — no ambiguous chars (0/O, 1/l/I), no chars
  // that need shell-escaping when distributed via copy/paste.
  // Uses crypto.randomInt (CSPRNG) rather than Math.random so the
  // generated value is not predictable from a wall-clock seed.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789-_';
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    out.push(alphabet[randomInt(0, alphabet.length)]);
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Accessible organizations for the current user
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/auth/accessible-orgs
 *
 * Returns the orgs the current user can "work in", based on:
 * 1. Role-based computed access (from org assignment + role)
 * 2. Explicit grants (accessibleOrgIds on the person record)
 *
 * Rules:
 * - SUPER_ADMIN: all company + division orgs
 * - ORG_ADMIN at Company: company + all descendant working-level orgs
 * - ORG_ADMIN at Division: division + all descendant working-level orgs
 * - Other roles at Company: company + direct child divisions
 * - Other roles at Division: that division only
 * - Dept/Team/Unit: parent division or company
 * - Explicit grants: always added on top of computed access
 * - No people record: all orgs (dev fallback)
 */
router.get('/accessible-orgs', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }

  const WORKING_LEVELS = ['company', 'division'];

  // Find the user's people record by email
  const person = people.find((p) => p.email.toLowerCase() === (user.email || '').toLowerCase());

  if (!person) {
    // No people record — dev fallback, show all working-level orgs (deduplicated by name+type)
    const all = organizations.filter((o) => WORKING_LEVELS.includes(o.type));
    const seen = new Set<string>();
    const deduped = all.filter((o) => {
      const key = `${o.name.toLowerCase()}|${o.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    res.json({ success: true, data: deduped.map((o) => ({ id: o.id, name: o.name, type: o.type, parentId: o.parentId ?? null })) });
    return;
  }

  const accessible = computeAccessibleOrgs(person);
  res.json({ success: true, data: accessible });
});

export default router;
