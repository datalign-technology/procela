import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import config from '../config';
import { AuthenticatedRequest, authenticateToken } from '../middleware/auth';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people, computeAccessibleOrgs } from './people';
import { organizations } from './organizations';
import {
  getAuthProvider,
  getAuthConfig,
  updateAuthConfig,
  getOidcProvider,
} from '../services/auth-providers';

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ---------------------------------------------------------------------------
// In-memory refresh token store
// ---------------------------------------------------------------------------
// Stores valid refresh token JTIs.  On logout the JTI is removed so the
// refresh token can no longer be used to mint new access tokens.
// In production this would be backed by Redis or a database table.
// ---------------------------------------------------------------------------
const validRefreshTokens = new Set<string>();

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_EXPIRY = '15m';
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60; // 900 seconds
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

function createRefreshToken(sub: string): { token: string; jti: string } {
  const jti = uuid();
  const payload: RefreshTokenPayload = { sub, type: 'refresh', jti };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: REFRESH_TOKEN_EXPIRY });
  validRefreshTokens.add(jti);
  return { token, jti };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();

/**
 * POST /api/v1/auth/login
 *
 * Uses the active auth provider to authenticate the user.
 *
 * Dev mode:  accepts { email, name, role? } -> returns accessToken + refreshToken.
 * OIDC mode: returns { loginUrl } for redirect-based authentication.
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const provider = getAuthProvider();

    // ── OIDC redirect flow ──
    if (provider.type === 'oidc') {
      const oidc = getOidcProvider();
      if (!oidc.isConfigured) {
        res.status(503).json({
          success: false,
          error: 'OIDC provider is not configured. Set issuer and clientId first.',
        });
        return;
      }

      const redirectUri = req.body.redirectUri || `${req.protocol}://${req.get('host')}/api/v1/auth/callback`;
      const loginUrl = oidc.getLoginUrl(redirectUri);

      auditService.log(DEV_ORG_ID, null, 'Auth', 'login', 'OIDC_LOGIN_REDIRECT', null, { redirectUri });
      res.json({ success: true, data: { loginUrl, provider: 'oidc' } });
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
 * Accepts { refreshToken } and invalidates it so it can no longer be used
 * to obtain new access tokens.
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

    const wasValid = validRefreshTokens.delete(decoded.jti);

    auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'logout', 'LOGOUT', null, {
      jti: decoded.jti,
      wasValid,
    });
    logger.info({ sub: decoded.sub }, 'User logged out');

    res.json({ success: true, data: { message: 'Logged out successfully' } });
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
router.get('/providers', (_req: Request, res: Response) => {
  const authCfg = getAuthConfig();
  const oidcPub = getOidcProvider().getPublicConfig();

  // Determine which specific OIDC provider is configured (Microsoft vs Okta)
  const issuer = oidcPub.issuer || '';
  const isMicrosoft = issuer.includes('microsoftonline.com') || issuer.includes('login.microsoft');
  const isOkta = issuer.includes('okta.com');

  res.json({
    success: true,
    data: {
      current: authCfg.provider,
      currentName: authCfg.providerName,
      providers: [
        {
          id: 'microsoft',
          name: 'Microsoft Entra ID',
          type: 'oidc',
          enabled: authCfg.provider === 'oidc' && authCfg.oidcConfigured && isMicrosoft,
        },
        {
          id: 'okta',
          name: 'Okta',
          type: 'oidc',
          enabled: authCfg.provider === 'oidc' && authCfg.oidcConfigured && isOkta,
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
  const oidcPub = getOidcProvider().getPublicConfig();
  res.json({
    success: true,
    data: {
      provider: authCfg.provider,
      providerName: authCfg.providerName,
      oidcConfigured: authCfg.oidcConfigured,
      issuerUrl: oidcPub.issuer || '',
      clientId: oidcPub.clientId || '',
    },
  });
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

  const validProviders = ['dev', 'oidc', 'saml'];
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
    // No people record — dev fallback, show all working-level orgs
    const all = organizations.filter((o) => WORKING_LEVELS.includes(o.type));
    res.json({ success: true, data: all.map((o) => ({ id: o.id, name: o.name, type: o.type })) });
    return;
  }

  const accessible = computeAccessibleOrgs(person);
  res.json({ success: true, data: accessible });
});

export default router;
