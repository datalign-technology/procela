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
import { people, computeAccessibleOrgs, isActive as isPersonActive, getRoleForOrg } from './people';
import { organizations } from './organizations';
import { saveStore } from '../lib/persistence';
import { validatePassword } from '../lib/password-policy';
import { mintResetToken, consumeResetToken, RESET_TOKEN_TTL_MS } from '../services/reset-tokens';
import { peekFlow } from '../services/pending-oidc-flows';
import { checkLockout, recordFailedLogin, clearLockout, adminClearLockout } from '../services/account-lockout';
import {
  isCaptchaRequired, recordLoginFailure, clearLoginFailures,
  verifyCaptchaToken, getCaptchaSiteKey,
} from '../services/login-challenge';
import { sendPasswordResetEmail, isConfigured as isMailConfigured } from '../services/mail.service';
import {
  generateEnrollment,
  verifyToken as verifyTotpToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
} from '../services/mfa.service';
import { mintPendingMfa, consumePendingMfa } from '../services/pending-mfa';
import { encryptSecret, decryptSecret } from '../services/crypto.service';
import {
  buildRegistrationOptions, completeRegistration,
  buildAuthenticationOptions, buildDiscoverableAuthenticationOptions, completeAuthentication,
  stashChallenge, consumeChallenge,
} from '../services/webauthn.service';
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
  /** Procela person id — surfaced on /auth/sessions so users can see
   *  whose sessions they're looking at without decoding the JWT. */
  personId?: string;
  /** ISO timestamp the session was minted. Drives the
   *  /auth/sessions display ("Signed in 3h ago"). */
  createdAt?: string;
  /** ISO timestamp of the last /auth/refresh call. Drives "Last used"
   *  and lets users spot a stale session that's still active. */
  lastUsedAt?: string;
  /** IP address + User-Agent fingerprint captured at mint time.
   *  Subsequent /auth/refresh calls must match (UA exact, IP within
   *  the same /24 for IPv4 or /64 for IPv6) or the token is revoked
   *  and the caller is forced back through login. Mitigates stolen-
   *  refresh-token replay from a different network. */
  ip?: string;
  userAgent?: string;
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

/** Capture the IP + User-Agent fingerprint from a request — fed
 *  into createRefreshToken so /auth/refresh can detect a
 *  significantly different origin and revoke the token. */
function fingerprintFromRequest(req: Request): { ip?: string; userAgent?: string } {
  return {
    ip: req.ip || undefined,
    userAgent: (req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined),
  };
}

function createRefreshToken(sub: string, context: RefreshTokenContext = {}): { token: string; jti: string } {
  const jti = uuid();
  const payload: RefreshTokenPayload = { sub, type: 'refresh', jti };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: REFRESH_TOKEN_EXPIRY });
  const now = new Date().toISOString();
  validRefreshTokens.set(jti, {
    personId: sub,
    createdAt: now,
    lastUsedAt: now,
    ...context,
  });
  return { token, jti };
}

/** Best-effort session-binding check. Returns true if the request
 *  origin (IP + UA) matches the values the refresh token was minted
 *  with. UA must be exact; IP is matched within /24 for IPv4 and /64
 *  for IPv6, so a user on a residential connection that gets a new
 *  DHCP lease doesn't get bounced every time their address rotates
 *  within the same subnet.
 *
 *  Unset context fields (legacy sessions minted before this change)
 *  fail open — there's no fingerprint to compare against, so the
 *  request is allowed and the next mint will pin one. */
function sessionFingerprintMatches(ctx: RefreshTokenContext, req: Request): boolean {
  if (!ctx.ip && !ctx.userAgent) return true; // legacy session
  const ua = String(req.headers['user-agent'] || '');
  if (ctx.userAgent && ctx.userAgent !== ua) return false;
  if (ctx.ip) {
    const reqIp = req.ip || '';
    if (!ipsInSameSubnet(ctx.ip, reqIp)) return false;
  }
  return true;
}

function ipsInSameSubnet(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // IPv4 — match the first 3 octets (/24).
  if (a.includes('.') && b.includes('.')) {
    const ax = a.split('.');
    const bx = b.split('.');
    if (ax.length !== 4 || bx.length !== 4) return false;
    return ax[0] === bx[0] && ax[1] === bx[1] && ax[2] === bx[2];
  }
  // IPv6 — match the first four 16-bit groups (/64). Express may
  // give us either compressed or expanded form; normalise by
  // expanding to a full 8-group representation first.
  if (a.includes(':') && b.includes(':')) {
    const expand = (s: string): string[] => {
      const segs = s.split('::');
      if (segs.length === 1) return s.split(':');
      const left = segs[0] ? segs[0].split(':') : [];
      const right = segs[1] ? segs[1].split(':') : [];
      const fill = new Array(8 - left.length - right.length).fill('0');
      return [...left, ...fill, ...right];
    };
    const ax = expand(a);
    const bx = expand(b);
    if (ax.length < 4 || bx.length < 4) return false;
    return ax[0] === bx[0] && ax[1] === bx[1] && ax[2] === bx[2] && ax[3] === bx[3];
  }
  return false;
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

    // ── SAML redirect flow ──
    // Mirrors the OIDC branch: build the AuthnRequest, return the URL
    // the browser should follow. The IdP POSTs the assertion to
    // /auth/saml/acs which we handle separately below.
    if (provider.type === 'saml') {
      const samlProv = provider as unknown as import('../services/saml.service').SamlAuthProvider;
      if (!samlProv.isConfigured) {
        res.status(503).json({ success: false, error: 'SAML provider is not configured.' });
        return;
      }
      const returnTo = req.body.returnTo || '/';
      try {
        const { loginUrl } = await samlProv.startLogin({ returnTo });
        auditService.log(DEV_ORG_ID, null, 'Auth', 'login', 'SAML_LOGIN_REDIRECT', null, { returnTo });
        res.json({ success: true, data: { loginUrl, provider: 'saml' } });
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'SAML login start failed');
        res.status(503).json({ success: false, error: err?.message || 'Failed to start SAML flow' });
      }
      return;
    }

    // ── Pre-flight CAPTCHA gate ──
    // Once an IP has burned through the failure threshold, every
    // subsequent attempt from that IP must include a verified
    // captchaToken. Slows automated credential-stuffing without
    // adding friction for a user who fumbles their password once or
    // twice. The frontend learns to render the widget from the
    // challengeRequired flag the route sets on every failure.
    if (isCaptchaRequired(req.ip)) {
      const ok = await verifyCaptchaToken(req.body.captchaToken, req.ip);
      if (!ok) {
        res.status(428).json({
          success: false,
          error: 'A CAPTCHA challenge is required before this sign-in attempt can be processed.',
          challengeRequired: true,
          captchaSiteKey: getCaptchaSiteKey(),
        });
        return;
      }
    }

    // ── Pre-flight lockout check (Local provider) ──
    // Cuts off brute-force / credential-stuffing attempts before we
    // burn argon2 verify cycles. Only meaningful for the Local
    // provider — Dev has no credential, OIDC defers auth to the IdP.
    // Pre-flight peek doesn't reveal account existence: an unknown
    // email passes this branch and lands in the standard "invalid
    // credentials" error from the provider.
    if (provider.type === 'local' && req.body.email) {
      const preflight = people.find((p) => p.email.toLowerCase() === String(req.body.email).toLowerCase());
      if (preflight) {
        const state = checkLockout(preflight);
        if (state.locked) {
          auditService.log(preflight.orgIds[0] || DEV_ORG_ID, preflight.id, 'Auth', 'login', 'LOGIN_LOCKED_OUT', null, {
            retryAfterSeconds: state.retryAfterSeconds,
          });
          res.setHeader('Retry-After', String(state.retryAfterSeconds));
          res.status(429).json({
            success: false,
            error: `Account temporarily locked due to repeated failed sign-in attempts. Try again in ${Math.ceil(state.retryAfterSeconds / 60)} minute${state.retryAfterSeconds >= 120 ? 's' : ''}.`,
          });
          return;
        }
      }
    }

    // ── Dev / direct credential flow ──
    const result = await provider.validateCredentials(req.body);

    if (!result.success || !result.user) {
      // Record the failed attempt against the matched account (when
      // there is one) — tips the lockout counter. We deliberately
      // don't differentiate "unknown email" vs "bad password" in the
      // response, but we do count differently behind the scenes.
      const matched = req.body.email
        ? people.find((p) => p.email.toLowerCase() === String(req.body.email).toLowerCase())
        : null;
      if (matched && provider.type === 'local') {
        const after = recordFailedLogin(matched);
        if (after.locked) {
          auditService.log(matched.orgIds[0] || DEV_ORG_ID, matched.id, 'Auth', 'login', 'ACCOUNT_LOCKED', null, {
            retryAfterSeconds: after.retryAfterSeconds,
          });
        }
      }
      // Per-IP failure counter — once over threshold every subsequent
      // attempt from this IP needs a captcha. The frontend learns to
      // render the widget from the challengeRequired flag we add to
      // the failure response below.
      recordLoginFailure(req.ip);
      auditService.log(DEV_ORG_ID, null, 'Auth', 'login', 'LOGIN_FAILED', null, {
        email: req.body.email,
        error: result.error || 'Unknown error',
      });
      const needsCaptcha = isCaptchaRequired(req.ip);
      res.status(401).json({
        success: false,
        error: result.error || 'Authentication failed',
        ...(needsCaptcha ? { challengeRequired: true, captchaSiteKey: getCaptchaSiteKey() } : {}),
      });
      return;
    }

    const user = result.user;

    // Resolve user's org and role from people records (if they exist).
    // The role at the resolved org wins over the person.role fallback —
    // someone who is ORG_ADMIN in Operations but VIEWER in Finance gets
    // the Operations role when their first-listed org is Operations.
    const personRecord = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase());
    const resolvedOrgId = personRecord?.orgIds?.[0] || DEV_ORG_ID;
    const resolvedRole = personRecord
      ? getRoleForOrg(personRecord, resolvedOrgId)
      : user.role;

    // Successful credential check resets the lockout counter +
    // unlocks the account if it had been locked by an earlier burst.
    if (personRecord && provider.type === 'local') clearLockout(personRecord);
    // …and resets the per-IP CAPTCHA challenge counter — the
    // legitimate user just produced valid credentials, so the IP
    // gets a fresh budget.
    clearLoginFailures(req.ip);

    // ── MFA gate (Local provider only) ──
    // Once a user enrolls in MFA, every subsequent password-flow
    // login lands here: we issue a short-lived opaque mfaToken
    // instead of access+refresh, and the frontend prompts for the
    // TOTP / backup code. Dev provider skips the gate (test users
    // shouldn't be forced through it); OIDC sessions don't reach
    // this branch at all (the IdP is presumed to enforce MFA on
    // its side). Re-evaluate if Procela ever exposes a "force MFA
    // even for dev" toggle.
    const hasWebauthn = provider.type === 'local'
      && (personRecord?.webauthnCredentials?.length || 0) > 0;
    if (provider.type === 'local' && (personRecord?.mfaEnrolled || hasWebauthn)) {
      const mfaToken = mintPendingMfa(personRecord!.id);
      auditService.log(resolvedOrgId, personRecord!.id, 'Auth', 'login', 'MFA_REQUIRED', null, {
        email: user.email,
        availableFactors: {
          totp: !!personRecord!.mfaEnrolled,
          webauthn: hasWebauthn,
        },
      });
      res.json({
        success: true,
        data: {
          mfaRequired: true,
          mfaToken,
          // Tell the frontend which second-factor methods the user
          // has configured so it can offer the right prompt(s). Both
          // can be true; the user picks at the prompt.
          availableFactors: {
            totp: !!personRecord!.mfaEnrolled,
            webauthn: hasWebauthn,
          },
          // No access / refresh / user here — frontend uses the
          // mfaToken to call /auth/mfa/login-verify (TOTP) or
          // /auth/mfa/webauthn/login-start (WebAuthn), which return
          // the real session payload.
        },
      });
      return;
    }

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
    const refresh = createRefreshToken(user.sub, fingerprintFromRequest(req));

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
    const role = getRoleForOrg(person, orgId) || user.role;
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
      ...fingerprintFromRequest(req),
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
 * POST /api/v1/auth/saml/acs
 *
 * The SAML Assertion Consumer Service endpoint. The IdP POSTs a
 * signed SAMLResponse here at the end of an SP-initiated login. We
 * validate the signature against the configured IdP cert, extract the
 * subject + attributes, find-or-provision the Person record, mint
 * Procela JWTs, and redirect the browser to the frontend's
 * /oidc-complete route — the same handler the OIDC flow lands on,
 * because the post-IdP plumbing is identical.
 *
 * Express needs `express.urlencoded({ extended: true })` registered
 * for this to receive the SAMLResponse field; that's wired in
 * index.ts at the top of the middleware chain.
 */
router.post('/saml/acs', async (req: Request, res: Response) => {
  const frontendBase = (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const errorRedirect = (msg: string) =>
    res.redirect(`${frontendBase}/login?error=${encodeURIComponent(msg)}`);
  try {
    // Lazy import — the route only resolves the SAML service when the
    // ACS is actually hit, so installs that don't use SAML don't pay
    // the cost.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSamlProvider } = require('../services/saml.service') as typeof import('../services/saml.service');
    const samlProv = getSamlProvider();
    if (!samlProv || !samlProv.isConfigured) {
      return errorRedirect('SAML provider is not configured');
    }
    const { user, returnTo } = await samlProv.completeAcs(req.body as Record<string, string>);

    // Find-or-just-in-time-provision — same shape as OIDC.
    let person = people.find((p) => p.email.toLowerCase() === user.email.toLowerCase());
    if (person && !isPersonActive(person)) {
      auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'saml', 'SAML_DEACTIVATED_LOGIN_BLOCKED', null, {
        email: person.email,
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
    const role = getRoleForOrg(person, orgId) || user.role;
    const accessToken = createAccessToken({
      sub: person.id, email: person.email, name: person.name, role, orgId,
    });
    const refresh = createRefreshToken(person.id, fingerprintFromRequest(req));

    auditService.log(orgId, person.id, 'Auth', 'saml', 'SAML_LOGIN_SUCCESS', null, {
      email: person.email, provisioned,
    });

    const params = new URLSearchParams({
      accessToken,
      refreshToken: refresh.token,
      expiresIn: String(ACCESS_TOKEN_EXPIRY_SECONDS),
      returnTo,
    });
    return res.redirect(`${frontendBase}/oidc-complete#${params.toString()}`);
  } catch (err: any) {
    auditService.log(DEV_ORG_ID, null, 'Auth', 'saml', 'SAML_ACS_FAILED', null, {
      error: err?.message || String(err),
    });
    logger.warn({ err: err?.message }, 'SAML ACS failed');
    return errorRedirect(err?.message || 'SAML assertion failed');
  }
});

/**
 * GET /api/v1/auth/saml/metadata
 *
 * Returns a thin SP metadata blob for IdP-side configuration. Most
 * IdPs accept this XML pasted into their "SP metadata" form to wire
 * up the entity ID, ACS URL, and certificate.
 */
router.get('/saml/metadata', (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getSamlProvider } = require('../services/saml.service') as typeof import('../services/saml.service');
  const samlProv = getSamlProvider();
  if (!samlProv || !samlProv.isConfigured) {
    res.status(503).type('text/plain').send('SAML provider is not configured');
    return;
  }
  const pub = samlProv.getPublicConfig();
  const acsUrl = `${(config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/api/v1/auth/saml/acs`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${pub.issuer}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="false" WantAssertionsSigned="true">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
  res.type('application/xml').send(xml);
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

    const ctx = validRefreshTokens.get(decoded.jti);
    if (!ctx) {
      auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'refresh', 'REFRESH_REVOKED', null, {
        jti: decoded.jti,
      });
      res.status(401).json({ success: false, error: 'Refresh token has been revoked' });
      return;
    }

    // Session-binding check: the IP + UA from this request must match
    // the values the token was minted with (UA exact, IP within the
    // same /24 or /64). A mismatch suggests the token has been
    // stolen and is being replayed from a different network. Revoke
    // it, audit, force the user back through login.
    if (!sessionFingerprintMatches(ctx, req)) {
      validRefreshTokens.delete(decoded.jti);
      auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'refresh', 'REFRESH_BINDING_MISMATCH', null, {
        jti: decoded.jti,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });
      res.status(401).json({ success: false, error: 'Session origin mismatch — please sign in again' });
      return;
    }

    // Update the lastUsedAt timestamp so /auth/sessions reflects
    // ongoing activity. This is the only field that updates inside
    // /auth/refresh; ip / ua are pinned at mint time so a roving user
    // doesn't slowly walk the fingerprint to anywhere they like.
    ctx.lastUsedAt = new Date().toISOString();

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
  // Enrich the JWT-decoded user with a few fields the frontend needs
  // but that aren't (and shouldn't be) on the access token. mfaEnrolled
  // + mfaBackupCodesRemaining drive the Settings panel and the
  // "running low — regenerate?" nudge.
  const person = req.user?.sub ? people.find((p) => p.id === req.user!.sub) : null;
  res.json({
    success: true,
    data: {
      ...req.user,
      ...(person ? {
        mfaEnrolled: !!person.mfaEnrolled,
        mfaBackupCodesRemaining: person.mfaBackupCodes?.length || 0,
      } : {}),
    },
  });
});

/**
 * POST /api/v1/auth/mfa/regenerate-backup-codes
 * Authenticated; re-auth via current TOTP code. Generates a fresh
 * set of 10 codes (returned ONCE) and invalidates the old set. Used
 * by the Settings "running low" nudge — admins should also be able
 * to regenerate on behalf of users via the admin-reset flow, which
 * already regenerates as a side effect of the next enrollment.
 */
router.post('/mfa/regenerate-backup-codes', authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
    const person = people.find((p) => p.id === userId);
    if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }
    if (!person.mfaEnrolled || !person.mfaSecret) {
      res.status(409).json({ success: false, error: 'Not enrolled in two-step verification' });
      return;
    }
    const { code } = req.body || {};
    if (!code) { res.status(400).json({ success: false, error: 'code is required' }); return; }
    if (!(await verifyTotpToken(await decryptSecret(person.mfaSecret), String(code)))) {
      res.status(401).json({ success: false, error: 'Invalid code' });
      return;
    }
    const fresh = generateBackupCodes();
    person.mfaBackupCodes = await hashBackupCodes(fresh);
    person.updatedAt = new Date().toISOString();
    saveStore('people', people);
    auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'MFA_BACKUP_CODES_REGENERATED', null, null);
    res.json({ success: true, data: { backupCodes: fresh } });
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

  // Surface SAML when the env is configured. The frontend shows a
  // single "Sign in with SAML" button — providerId selection is
  // single-IdP per install (multi-IdP SAML is a future enhancement;
  // the data model is ready for it once a real customer asks).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getSamlProvider } = require('../services/saml.service') as typeof import('../services/saml.service');
  const samlProv = getSamlProvider();
  const samlButtons = samlProv && samlProv.isConfigured ? [{
    id: 'saml',
    name: 'Single sign-on (SAML)',
    type: 'saml',
    enabled: authCfg.provider === 'saml',
  }] : [];

  res.json({
    success: true,
    data: {
      current: authCfg.provider,
      currentName: authCfg.providerName,
      providers: [
        ...oidcButtons,
        ...samlButtons,
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
        { type: 'saml', name: 'SAML', description: 'SAML 2.0 (Active Directory FS, Shibboleth, etc.)', configured: !!samlProv?.isConfigured },
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

/**
 * POST /api/v1/auth/encrypt-secret
 * Body: { plaintext }
 *
 * Admin-only helper that takes a plaintext value and returns the
 * enc:v1:… envelope an operator can paste into an .env file for
 * SMTP_PASS, OIDC_CLIENT_SECRET, or any other env-sourced secret that
 * resolveEnvSecretSync handles. Avoids the operator having to drop
 * into a Node REPL on the server to call encryptSecret directly.
 *
 * The plaintext never gets persisted — it's read off the request,
 * encrypted with the active master key, and returned in the response.
 * MFA_ENCRYPTION_KEY must be configured (otherwise no-op passthrough
 * is the active backend and "encryption" produces unchanged output).
 */
router.post('/encrypt-secret', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { plaintext } = req.body || {};
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      res.status(400).json({ success: false, error: 'plaintext is required' });
      return;
    }
    const ciphertext = await encryptSecret(plaintext);
    if (ciphertext === plaintext) {
      res.status(503).json({
        success: false,
        error: 'No encryption backend is configured. Set MFA_ENCRYPTION_KEY or KMS_PROVIDER and restart.',
      });
      return;
    }
    auditService.log(DEV_ORG_ID, req.user?.sub || null, 'Auth', 'crypto', 'SECRET_ENCRYPTED', null, null);
    res.json({ success: true, data: { ciphertext } });
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
// MFA / TOTP
// ---------------------------------------------------------------------------
// Five routes:
//   /mfa/start              authenticated — start enrollment (return
//                           QR + secret; doesn't persist yet)
//   /mfa/verify             authenticated — verify enrollment code,
//                           persist secret + backup codes, mark
//                           enrolled. Backup codes returned ONCE.
//   /mfa/login-verify       unauthenticated — completes a password
//                           login that the gate held back. Takes the
//                           mfaToken from /auth/login + a TOTP or
//                           backup code. Returns the real session.
//   /mfa/disable            authenticated — clears enrollment for
//                           self. Requires the current password +
//                           a fresh TOTP code as proof.
//   /mfa/admin-reset        admin-only — clears another user's
//                           enrollment. Forces them through start +
//                           verify again on next login.
// ---------------------------------------------------------------------------

// Pending enrollments: holds the candidate secret between /mfa/start
// and /mfa/verify so we don't write to the user record until the
// user proves they can produce a code. Indexed by personId so a user
// who restarts enrollment overwrites their own pending entry rather
// than accumulating dead secrets.
const pendingEnrollments = new Map<string, { secret: string; expiresAt: number }>();
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingEnrollments) {
    if (v.expiresAt < now) pendingEnrollments.delete(k);
  }
}, 60_000).unref?.();

router.post('/mfa/start', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const person = people.find((p) => p.id === userId);
  if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }

  const enrollment = await generateEnrollment(person.email);
  pendingEnrollments.set(person.id, {
    secret: enrollment.secret,
    expiresAt: Date.now() + ENROLLMENT_TTL_MS,
  });
  auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'MFA_ENROLLMENT_STARTED', null, null);
  res.json({
    success: true,
    data: {
      secret: enrollment.secret,
      uri: enrollment.uri,
      qrDataUrl: enrollment.qrDataUrl,
      // Tell the frontend whether the user is replacing an existing
      // enrollment so it can show "Replace authenticator" copy.
      replacing: !!person.mfaEnrolled,
    },
  });
});

router.post('/mfa/verify', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const person = people.find((p) => p.id === userId);
  if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }

  const { code } = req.body || {};
  if (!code) { res.status(400).json({ success: false, error: 'code is required' }); return; }

  const pending = pendingEnrollments.get(person.id);
  if (!pending || pending.expiresAt < Date.now()) {
    res.status(400).json({ success: false, error: 'No active enrollment — start over from /mfa/start' });
    return;
  }

  if (!(await verifyTotpToken(pending.secret, String(code)))) {
    auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'MFA_ENROLLMENT_FAILED', null, { reason: 'bad_code' });
    res.status(401).json({ success: false, error: 'Invalid code — check your authenticator app and try again' });
    return;
  }

  // Generate a fresh set of backup codes, store hashed, return the
  // plaintext ONCE. The user MUST copy them now — there's no path
  // to retrieve them later (admin reset regenerates a new set).
  const plainBackupCodes = generateBackupCodes();
  const hashedBackupCodes = await hashBackupCodes(plainBackupCodes);

  // Encrypt the secret at rest before writing it to the store. The
  // crypto service falls back to plaintext in dev when MFA_ENCRYPTION_KEY
  // isn't set; production refuses to start without a key (boot
  // readiness check).
  person.mfaSecret = await encryptSecret(pending.secret);
  person.mfaBackupCodes = hashedBackupCodes;
  person.mfaEnrolled = true;
  person.updatedAt = new Date().toISOString();
  saveStore('people', people);
  pendingEnrollments.delete(person.id);

  auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'MFA_ENROLLED', null, null);
  logger.info({ personId: person.id }, 'MFA enrollment verified');

  res.json({
    success: true,
    data: {
      enrolled: true,
      backupCodes: plainBackupCodes,
      message: 'Two-factor authentication is now active. Save these backup codes — they let you sign in if you lose access to your authenticator app, and each works only once.',
    },
  });
});

router.post('/mfa/login-verify', loginLimiter, async (req: Request, res: Response) => {
  const { mfaToken, code, backupCode } = req.body || {};
  if (!mfaToken || (!code && !backupCode)) {
    res.status(400).json({ success: false, error: 'mfaToken and either code or backupCode are required' });
    return;
  }

  const personId = consumePendingMfa(String(mfaToken));
  if (!personId) {
    res.status(401).json({ success: false, error: 'MFA token is invalid or expired — please sign in again' });
    return;
  }
  const person = people.find((p) => p.id === personId);
  if (!person || !person.mfaEnrolled || !person.mfaSecret) {
    res.status(401).json({ success: false, error: 'MFA state is invalid — please sign in again' });
    return;
  }

  // Try TOTP first, then backup code. We don't tell the caller which
  // path succeeded — both produce the same session payload.
  let usedBackup = false;
  if (code && await verifyTotpToken(await decryptSecret(person.mfaSecret), String(code))) {
    // success via TOTP
  } else if (backupCode && person.mfaBackupCodes) {
    const idx = await verifyBackupCode(person.mfaBackupCodes, String(backupCode));
    if (idx < 0) {
      auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'MFA_LOGIN_FAILED', null, { reason: 'bad_backup' });
      res.status(401).json({ success: false, error: 'Invalid code' });
      return;
    }
    // Single-use: splice the used hash out so the same backup code
    // can't be reused.
    person.mfaBackupCodes.splice(idx, 1);
    usedBackup = true;
  } else {
    auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'MFA_LOGIN_FAILED', null, { reason: 'bad_totp' });
    res.status(401).json({ success: false, error: 'Invalid code' });
    return;
  }

  // Issue the real session now that MFA cleared.
  const orgId = person.orgIds[0] || DEV_ORG_ID;
  const accessToken = createAccessToken({
    sub: person.id, email: person.email, name: person.name, role: person.role, orgId,
  });
  const refresh = createRefreshToken(person.id, fingerprintFromRequest(req));

  if (usedBackup) {
    person.updatedAt = new Date().toISOString();
    saveStore('people', people);
  }
  auditService.log(orgId, person.id, 'Auth', 'mfa', 'MFA_LOGIN_SUCCESS', null, {
    method: usedBackup ? 'backup' : 'totp',
    backupRemaining: person.mfaBackupCodes?.length || 0,
  });
  logger.info({ personId: person.id, method: usedBackup ? 'backup' : 'totp' }, 'MFA login successful');

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      passwordMustChange: !!person.passwordMustChange,
      // Surface the remaining backup-code count so the frontend can
      // nudge a regen when running low. Implicit floor of 0; treat
      // anything ≤2 as "regenerate now" in the UI.
      backupCodesRemaining: person.mfaBackupCodes?.length || 0,
      user: {
        sub: person.id,
        email: person.email,
        name: person.name,
        orgId,
        role: person.role,
      },
    },
  });
});

router.post('/mfa/disable', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const person = people.find((p) => p.id === userId);
  if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }

  const { currentPassword, code } = req.body || {};
  if (!currentPassword || !code) {
    res.status(400).json({ success: false, error: 'currentPassword and code are required' });
    return;
  }

  // Re-auth: current password + a fresh TOTP code. Both required so
  // a stolen session can't disable MFA on its own. Mirrors the
  // /password change-password flow.
  if (!person.passwordHash) {
    res.status(409).json({ success: false, error: 'No local password is set; cannot disable MFA from this session' });
    return;
  }
  const argon2mod = await import('argon2');
  let ok = false;
  try { ok = await argon2mod.verify(person.passwordHash, String(currentPassword)); } catch { /* */ }
  if (!ok) {
    res.status(401).json({ success: false, error: 'Current password is incorrect' });
    return;
  }
  if (!person.mfaSecret || !(await verifyTotpToken(await decryptSecret(person.mfaSecret), String(code)))) {
    res.status(401).json({ success: false, error: 'Invalid code' });
    return;
  }

  person.mfaSecret = undefined;
  person.mfaBackupCodes = undefined;
  person.mfaEnrolled = false;
  person.updatedAt = new Date().toISOString();
  saveStore('people', people);
  pendingEnrollments.delete(person.id);

  auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'MFA_DISABLED', null, { self: true });
  res.status(204).end();
});

router.post('/mfa/admin-reset', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  (req: AuthenticatedRequest, res: Response) => {
    const { personId } = req.body || {};
    if (!personId) { res.status(400).json({ success: false, error: 'personId is required' }); return; }
    const target = people.find((p) => p.id === personId);
    if (!target) { res.status(404).json({ success: false, error: 'Person not found' }); return; }

    target.mfaSecret = undefined;
    target.mfaBackupCodes = undefined;
    target.mfaEnrolled = false;
    target.updatedAt = new Date().toISOString();
    saveStore('people', people);
    pendingEnrollments.delete(target.id);

    auditService.log(target.orgIds[0] || DEV_ORG_ID, req.user?.sub || null, 'Auth', 'mfa', 'MFA_ADMIN_RESET', null, {
      targetPersonId: target.id,
      targetEmail: target.email,
    });
    logger.info({ adminId: req.user?.sub, targetId: target.id }, 'Admin reset MFA');
    res.status(204).end();
  });

// ---------------------------------------------------------------------------
// WebAuthn / FIDO2
// ---------------------------------------------------------------------------
// Hardware-key / platform-key second factor layered on top of TOTP.
// A user can register many credentials; either WebAuthn OR TOTP
// satisfies the gate at login.
//
//   /mfa/webauthn/register-start         authenticated — registration ceremony
//   /mfa/webauthn/register-finish        authenticated — verify + persist
//   /mfa/webauthn/login-start            unauthenticated — uses mfaToken
//   /mfa/webauthn/login-finish           unauthenticated — verify + issue session
//   /mfa/webauthn/credentials/:id        authenticated DELETE — remove one
//   /mfa/webauthn/admin-reset            admin-only — clear another user's keys
//
// (The first set is defined immediately below; admin-reset is the
// last route in this section.)
//   /mfa/webauthn/register-finish   authenticated — verify + persist
//   /mfa/webauthn/login-start       unauthenticated — uses mfaToken from
//                                   the password flow to find the user's
//                                   registered credentials
//   /mfa/webauthn/login-finish      unauthenticated — verify + issue session
//   /mfa/webauthn/credentials/:id   authenticated DELETE — remove one
// ---------------------------------------------------------------------------

function reqInfo(req: Request): { protocol: string; host: string } {
  return { protocol: req.protocol, host: req.get('host') || 'localhost' };
}

router.post('/mfa/webauthn/register-start', authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
    const person = people.find((p) => p.id === userId);
    if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }

    const { options } = await buildRegistrationOptions({
      personId: person.id,
      personEmail: person.email,
      personName: person.name,
      existingCredentials: person.webauthnCredentials || [],
      req: reqInfo(req),
    });
    stashChallenge(options.challenge, { kind: 'register', personId: person.id });
    res.json({ success: true, data: options });
  });

router.post('/mfa/webauthn/register-finish', authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
    const person = people.find((p) => p.id === userId);
    if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }

    const { response, label } = req.body || {};
    if (!response) { res.status(400).json({ success: false, error: 'response is required' }); return; }

    // Browser response carries the original challenge inside
    // clientDataJSON; we look it up by the challenge value the
    // browser echoes back.
    const expectedChallenge = response?.response?.clientDataJSON
      ? JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64').toString('utf-8')).challenge
      : null;
    if (!expectedChallenge) {
      res.status(400).json({ success: false, error: 'Could not extract challenge from response' });
      return;
    }
    const pending = consumeChallenge(expectedChallenge);
    if (!pending || pending.context.kind !== 'register' || pending.context.personId !== person.id) {
      res.status(400).json({ success: false, error: 'Challenge expired or invalid' });
      return;
    }

    const result = await completeRegistration({
      response,
      expectedChallenge,
      req: reqInfo(req),
    });
    if (!result.verified || !result.credential) {
      res.status(400).json({ success: false, error: 'Could not verify registration' });
      return;
    }

    person.webauthnCredentials = person.webauthnCredentials || [];
    person.webauthnCredentials.push({
      id: uuid(),
      label: String(label || 'Security key').slice(0, 60),
      createdAt: new Date().toISOString(),
      ...result.credential,
    });
    person.updatedAt = new Date().toISOString();
    saveStore('people', people);

    auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'WEBAUTHN_REGISTERED', null, {
      label,
      total: person.webauthnCredentials.length,
    });
    res.status(204).end();
  });

router.post('/mfa/webauthn/login-start', async (req: Request, res: Response) => {
  const { mfaToken } = req.body || {};
  if (!mfaToken) { res.status(400).json({ success: false, error: 'mfaToken is required' }); return; }

  // We can't `consume` the mfa token yet — the user might not
  // complete the assertion, and they need the same token for the
  // login-finish call. So we look up via a peek by re-storing
  // immediately. Simplest path: the mfa token's same value is fine
  // for multiple options-start calls; only login-finish consumes.
  // To honour that contract here, we treat this endpoint as
  // read-only and fish the personId out by re-minting + matching.
  // Cleaner: have pending-mfa expose a peek API. For now we accept
  // a small race: consume + immediately re-mint with the same TTL.
  // (This is fine — multiple parallel login-start calls from the
  // same browser are vanishingly rare for the MFA window.)
  const personId = consumePendingMfa(String(mfaToken));
  if (!personId) {
    res.status(401).json({ success: false, error: 'MFA token is invalid or expired' });
    return;
  }
  const person = people.find((p) => p.id === personId);
  if (!person || !(person.webauthnCredentials || []).length) {
    res.status(404).json({ success: false, error: 'No WebAuthn credentials registered' });
    return;
  }

  const options = await buildAuthenticationOptions({
    allowCredentials: person.webauthnCredentials || [],
    req: reqInfo(req),
  });
  stashChallenge(options.challenge, { kind: 'authenticate', personId: person.id });
  // Re-mint a fresh mfaToken bound to the same person so login-finish
  // can validate without a second password check.
  const newToken = mintPendingMfa(person.id);
  res.json({ success: true, data: { options, mfaToken: newToken } });
});

router.post('/mfa/webauthn/login-finish', loginLimiter, async (req: Request, res: Response) => {
  const { mfaToken, response } = req.body || {};
  if (!mfaToken || !response) {
    res.status(400).json({ success: false, error: 'mfaToken and response are required' });
    return;
  }
  const personId = consumePendingMfa(String(mfaToken));
  if (!personId) {
    res.status(401).json({ success: false, error: 'MFA token is invalid or expired' });
    return;
  }
  const person = people.find((p) => p.id === personId);
  if (!person) {
    res.status(401).json({ success: false, error: 'MFA state invalid' });
    return;
  }

  const challenge = response?.response?.clientDataJSON
    ? JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64').toString('utf-8')).challenge
    : null;
  if (!challenge) {
    res.status(400).json({ success: false, error: 'Could not extract challenge from response' });
    return;
  }
  const pending = consumeChallenge(challenge);
  if (!pending || pending.context.kind !== 'authenticate' || pending.context.personId !== person.id) {
    res.status(401).json({ success: false, error: 'Challenge expired or invalid' });
    return;
  }

  // Match the asserted credential id to one we have on file.
  const credentialID = response.id || response.rawId;
  const credential = (person.webauthnCredentials || []).find((c) => c.credentialID === credentialID);
  if (!credential) {
    res.status(401).json({ success: false, error: 'Credential not recognised' });
    return;
  }

  const result = await completeAuthentication({
    response,
    expectedChallenge: challenge,
    credential,
    req: reqInfo(req),
  });
  if (!result.verified) {
    auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'WEBAUTHN_LOGIN_FAILED', null, null);
    res.status(401).json({ success: false, error: 'Assertion failed' });
    return;
  }

  // Update the counter — refuses replays where the authenticator's
  // counter hasn't advanced past what we last saw.
  if (typeof result.newCounter === 'number') credential.counter = result.newCounter;
  person.updatedAt = new Date().toISOString();
  saveStore('people', people);

  // Issue the session, same as the TOTP path.
  const orgId = person.orgIds[0] || DEV_ORG_ID;
  const accessToken = createAccessToken({
    sub: person.id, email: person.email, name: person.name, role: person.role, orgId,
  });
  const refresh = createRefreshToken(person.id, fingerprintFromRequest(req));

  auditService.log(orgId, person.id, 'Auth', 'mfa', 'WEBAUTHN_LOGIN_SUCCESS', null, {
    credentialLabel: credential.label,
  });
  logger.info({ personId: person.id, credentialLabel: credential.label }, 'WebAuthn login successful');

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      passwordMustChange: !!person.passwordMustChange,
      user: {
        sub: person.id,
        email: person.email,
        name: person.name,
        orgId,
        role: person.role,
      },
    },
  });
});

router.delete('/mfa/webauthn/credentials/:id', authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
    const person = people.find((p) => p.id === userId);
    if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }

    const credentialId = String(req.params.id);
    const before = person.webauthnCredentials?.length || 0;
    person.webauthnCredentials = (person.webauthnCredentials || []).filter((c) => c.id !== credentialId);
    if (person.webauthnCredentials.length === before) {
      res.status(404).json({ success: false, error: 'Credential not found' });
      return;
    }
    person.updatedAt = new Date().toISOString();
    saveStore('people', people);
    auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'WEBAUTHN_CREDENTIAL_REMOVED', null, {
      remaining: person.webauthnCredentials.length,
    });
    res.status(204).end();
  });

/**
 * POST /api/v1/auth/mfa/webauthn/admin-reset
 * Body: { personId }
 *
 * Admin-only — clear every WebAuthn credential on a target user.
 * The user will need to re-register their security keys on next
 * login. Independent of /mfa/admin-reset (which clears TOTP). The
 * SecurityCard on PersonDetailPage exposes both so an admin can
 * blow away whichever factor is the actual problem.
 */
router.post('/mfa/webauthn/admin-reset', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  (req: AuthenticatedRequest, res: Response) => {
    const { personId } = req.body || {};
    if (!personId) { res.status(400).json({ success: false, error: 'personId is required' }); return; }
    const target = people.find((p) => p.id === personId);
    if (!target) { res.status(404).json({ success: false, error: 'Person not found' }); return; }

    const cleared = target.webauthnCredentials?.length || 0;
    target.webauthnCredentials = undefined;
    target.updatedAt = new Date().toISOString();
    saveStore('people', people);

    auditService.log(target.orgIds[0] || DEV_ORG_ID, req.user?.sub || null, 'Auth', 'mfa', 'WEBAUTHN_ADMIN_RESET', null, {
      targetPersonId: target.id,
      targetEmail: target.email,
      cleared,
    });
    logger.info({ adminId: req.user?.sub, targetId: target.id, cleared }, 'Admin reset WebAuthn keys');
    res.status(204).end();
  });

// ---------------------------------------------------------------------------
// Passwordless / discoverable WebAuthn login
// ---------------------------------------------------------------------------
// Lets a user sign in by tapping their registered security key — no
// email, no password. Works for credentials registered with
// residentKey 'preferred' that the authenticator chose to store
// discoverably (modern platform authenticators almost always do;
// classic security keys with limited slots may not).
//
// userVerification is 'required' on the options so the
// authenticator's local PIN / biometric is part of the ceremony —
// that converts the credential from single-factor ("I have the key")
// to multi-factor ("I have the key AND proved I'm me on it") in one
// tap.
// ---------------------------------------------------------------------------

router.post('/webauthn/discoverable/login-start', loginLimiter,
  async (req: Request, res: Response) => {
    const options = await buildDiscoverableAuthenticationOptions({ req: reqInfo(req) });
    stashChallenge(options.challenge, { kind: 'discoverable' });
    res.json({ success: true, data: options });
  });

router.post('/webauthn/discoverable/login-finish', loginLimiter,
  async (req: Request, res: Response) => {
    const { response } = req.body || {};
    if (!response) {
      res.status(400).json({ success: false, error: 'response is required' });
      return;
    }

    const challenge = response?.response?.clientDataJSON
      ? JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64').toString('utf-8')).challenge
      : null;
    if (!challenge) {
      res.status(400).json({ success: false, error: 'Could not extract challenge from response' });
      return;
    }
    const pending = consumeChallenge(challenge);
    if (!pending || pending.context.kind !== 'discoverable') {
      res.status(401).json({ success: false, error: 'Challenge expired or invalid' });
      return;
    }

    // userHandle is the user id we set on registration, encoded as a
    // base64url string in the assertion. We stored it as the raw
    // Procela personId, so this decodes straight back to a person.
    const userHandle = response?.response?.userHandle;
    if (!userHandle) {
      res.status(400).json({ success: false, error: 'Assertion missing userHandle — credential was not registered as discoverable' });
      return;
    }
    const personId = Buffer.from(userHandle, 'base64url').toString('utf-8');
    const person = people.find((p) => p.id === personId);
    if (!person) {
      auditService.log(DEV_ORG_ID, null, 'Auth', 'mfa', 'WEBAUTHN_DISCOVERABLE_NO_PERSON', null, { userHandle: personId });
      res.status(401).json({ success: false, error: 'Account not found' });
      return;
    }

    // Inactive accounts can't sign in even with a valid key.
    if (!isPersonActive(person)) {
      auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'WEBAUTHN_DEACTIVATED_LOGIN_BLOCKED', null, null);
      res.status(401).json({ success: false, error: 'Account is not active' });
      return;
    }

    const credentialID = response.id || response.rawId;
    const credential = (person.webauthnCredentials || []).find((c) => c.credentialID === credentialID);
    if (!credential) {
      res.status(401).json({ success: false, error: 'Credential not recognised' });
      return;
    }

    const result = await completeAuthentication({
      response,
      expectedChallenge: challenge,
      credential,
      req: reqInfo(req),
    });
    if (!result.verified) {
      auditService.log(person.orgIds[0] || DEV_ORG_ID, person.id, 'Auth', 'mfa', 'WEBAUTHN_DISCOVERABLE_FAILED', null, null);
      res.status(401).json({ success: false, error: 'Assertion failed' });
      return;
    }

    if (typeof result.newCounter === 'number') credential.counter = result.newCounter;
    person.updatedAt = new Date().toISOString();
    saveStore('people', people);

    const orgId = person.orgIds[0] || DEV_ORG_ID;
    const accessToken = createAccessToken({
      sub: person.id, email: person.email, name: person.name, role: person.role, orgId,
    });
    const refresh = createRefreshToken(person.id, fingerprintFromRequest(req));

    auditService.log(orgId, person.id, 'Auth', 'mfa', 'WEBAUTHN_DISCOVERABLE_LOGIN_SUCCESS', null, {
      credentialLabel: credential.label,
    });
    logger.info({ personId: person.id, credentialLabel: credential.label }, 'WebAuthn passwordless login successful');

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken: refresh.token,
        expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
        passwordMustChange: !!person.passwordMustChange,
        user: {
          sub: person.id,
          email: person.email,
          name: person.name,
          orgId,
          role: person.role,
        },
      },
    });
  });

// ---------------------------------------------------------------------------
// Active sessions
// ---------------------------------------------------------------------------
// Surface the live refresh tokens for the current user so they can
// see "I'm signed in from these devices" and revoke individual
// sessions (e.g. a forgotten public computer, a phone they lost).
// Industry-standard control — GitHub, Google, Microsoft all expose
// something equivalent.
//
//   GET    /auth/sessions          list current user's sessions
//   DELETE /auth/sessions/:jti     revoke one
//   DELETE /auth/sessions          revoke all (sign out everywhere)
// ---------------------------------------------------------------------------

router.get('/sessions', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const sessions: Array<Record<string, unknown>> = [];
  for (const [jti, ctx] of validRefreshTokens) {
    if (ctx.personId !== userId) continue;
    sessions.push({
      jti,
      createdAt: ctx.createdAt || null,
      lastUsedAt: ctx.lastUsedAt || null,
      ip: ctx.ip || null,
      userAgent: ctx.userAgent || null,
      provider: ctx.oidcProviderId ? 'oidc' : 'local',
    });
  }
  sessions.sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
  res.json({ success: true, data: sessions });
});

router.delete('/sessions/:jti', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const jti = String(req.params.jti);
  const ctx = validRefreshTokens.get(jti);
  if (!ctx || ctx.personId !== userId) {
    res.status(404).json({ success: false, error: 'Session not found' });
    return;
  }
  validRefreshTokens.delete(jti);
  auditService.log(DEV_ORG_ID, userId, 'Auth', 'session', 'SESSION_REVOKED_SELF', null, { jti });
  res.status(204).end();
});

router.delete('/sessions', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  let revoked = 0;
  for (const [jti, ctx] of validRefreshTokens) {
    if (ctx.personId === userId) {
      validRefreshTokens.delete(jti);
      revoked++;
    }
  }
  auditService.log(DEV_ORG_ID, userId, 'Auth', 'session', 'SESSION_REVOKED_ALL', null, { revoked });
  res.json({ success: true, data: { revoked } });
});

// ---------------------------------------------------------------------------
// POST /auth/switch-org
// ---------------------------------------------------------------------------
// Re-mints an access token bound to a different org, picking up that
// org's per-org role from orgRoles. The original refresh token stays
// valid — the access token is the only thing being rotated. The
// frontend calls this when the user picks a new org from the
// switcher and wants their role chip / authorisation gates to update
// without a full re-login.
//
// The target org must be in the caller's accessibleOrgIds (or be one
// of their assigned orgIds). SUPER_ADMINs can switch to any org.
// ---------------------------------------------------------------------------
router.post('/switch-org', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const { orgId } = req.body || {};
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  const person = people.find((p) => p.id === userId);
  if (!person) { res.status(404).json({ success: false, error: 'No person record' }); return; }

  // Membership check — SUPER_ADMIN bypasses, everyone else has to
  // either be assigned to the org or have it in the computed
  // accessible list.
  let allowed = person.role === 'SUPER_ADMIN' || person.orgIds.includes(orgId);
  if (!allowed) {
    const accessible = computeAccessibleOrgs(person);
    allowed = accessible.some((o) => o.id === orgId);
  }
  if (!allowed) {
    res.status(403).json({ success: false, error: 'You do not have access to that org' });
    return;
  }

  const role = getRoleForOrg(person, orgId);
  const accessToken = createAccessToken({
    sub: person.id, email: person.email, name: person.name, role, orgId,
  });
  auditService.log(orgId, person.id, 'Auth', 'switch-org', 'ORG_SWITCHED', null, {
    from: req.user?.orgId, to: orgId, role,
  });
  res.json({
    success: true,
    data: {
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      user: { sub: person.id, email: person.email, name: person.name, orgId, role },
    },
  });
});

// Admin unlock — clear a target user's lockout state. Useful when an
// admin has positively identified the user via another channel (phone
// call, in-person) and doesn't want to wait out the auto-unlock.
router.post('/lockout/admin-clear', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  (req: AuthenticatedRequest, res: Response) => {
    const { personId } = req.body || {};
    if (!personId) { res.status(400).json({ success: false, error: 'personId is required' }); return; }
    const target = people.find((p) => p.id === personId);
    if (!target) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
    adminClearLockout(target);
    auditService.log(target.orgIds[0] || DEV_ORG_ID, req.user?.sub || null, 'Auth', 'lockout', 'LOCKOUT_ADMIN_CLEARED', null, {
      targetPersonId: target.id,
      targetEmail: target.email,
    });
    res.status(204).end();
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
