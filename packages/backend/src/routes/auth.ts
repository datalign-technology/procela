import { Router, Request, Response } from 'express';
import { sign as signJwt, verify as verifyJwt, getJwks, currentAlgorithm } from '../services/jwt-signer';
import { v4 as uuid } from 'uuid';
import config from '../config';
import { AuthenticatedRequest, authenticateToken, authorize } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people, computeAccessibleOrgs, isActive as isPersonActive, getRoleForOrg } from './people';
import { organizations } from './organizations';
import { loadStore } from '../lib/persistence';
import { getRefreshTokensRepository, type StoredRefreshToken } from '../db/refresh-tokens.repo';
import { getPeopleRepository } from '../db/people.repo';
import { peekFlow } from '../services/pending-oidc-flows';
import { checkLockout, recordFailedLogin, clearLockout, adminClearLockout } from '../services/account-lockout';
import {
  isCaptchaRequired, recordLoginFailure, clearLoginFailures,
  verifyCaptchaToken, getCaptchaSiteKey,
} from '../services/login-challenge';
import { mintPendingMfa } from '../services/pending-mfa';
import { encryptSecret } from '../services/crypto.service';
import {
  getAuthProvider,
  getAuthConfig,
  updateAuthConfig,
  getOidcProvider,
  listOidcProviders,
  upsertOidcProvider,
  removeOidcProvider,
} from '../services/auth-providers';

export const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

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
  /** SAML NameID + SessionIndex captured at ACS time so
   *  IdP-initiated SLO can match a LogoutRequest to the right local
   *  refresh-token entries, and so /auth/logout can drive
   *  SP-initiated SLO with the right session hint. */
  samlNameID?: string;
  samlSessionIndex?: string;
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
// Refresh-token / session store. Postgres when DATABASE_URL is set, the
// in-memory `refreshTokens` array (JSON) otherwise — replaces the former
// in-memory Map so sessions survive a restart and span instances. PR 3d.
const refreshTokens = loadStore<StoredRefreshToken>('refreshTokens');
const refreshTokensRepo = getRefreshTokensRepository(refreshTokens);
// People reads/writes go through the repository (Postgres when DATABASE_URL is
// set, the in-memory `people` array otherwise) — PR 3e.
const peopleRepo = getPeopleRepository(people);

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

const IS_DEV = (process.env.NODE_ENV || 'development') !== 'production';
const ACCESS_TOKEN_EXPIRY = IS_DEV ? '8h' : '15m';
export const ACCESS_TOKEN_EXPIRY_SECONDS = IS_DEV ? 8 * 60 * 60 : 15 * 60;
const REFRESH_TOKEN_EXPIRY = '8h';

interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  orgId: string;
  role: string;
  type: 'access';
  /** Refresh-token jti this access token was minted alongside. Lets
   *  /auth/sessions tag the row representing the caller's own device
   *  with current=true so the UI can label it. Optional because
   *  legacy tokens minted before the field existed still verify. */
  sjti?: string;
}

interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}

export function createAccessToken(user: {
  sub: string;
  email: string;
  name: string;
  role: string;
  orgId?: string;
  sessionJti?: string;
}): string {
  const payload: AccessTokenPayload = {
    sub: user.sub,
    email: user.email,
    name: user.name,
    orgId: user.orgId || DEV_ORG_ID,
    role: user.role,
    type: 'access',
    ...(user.sessionJti ? { sjti: user.sessionJti } : {}),
  };
  return signJwt(payload, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/** Capture the IP + User-Agent fingerprint from a request — fed
 *  into createRefreshToken so /auth/refresh can detect a
 *  significantly different origin and revoke the token. */
export function fingerprintFromRequest(req: Request): { ip?: string; userAgent?: string } {
  return {
    ip: req.ip || undefined,
    userAgent: (req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined),
  };
}

export async function createRefreshToken(sub: string, context: RefreshTokenContext = {}): Promise<{ token: string; jti: string }> {
  const jti = uuid();
  const payload: RefreshTokenPayload = { sub, type: 'refresh', jti };
  const token = signJwt(payload, { expiresIn: REFRESH_TOKEN_EXPIRY });
  const now = new Date().toISOString();
  await refreshTokensRepo.upsert({
    jti,
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
export function sessionFingerprintMatches(ctx: RefreshTokenContext, req: Request): boolean {
  if (!ctx.ip && !ctx.userAgent) return true; // legacy session
  const ua = String(req.headers['user-agent'] || '');
  if (ctx.userAgent && ctx.userAgent !== ua) return false;
  if (ctx.ip) {
    const reqIp = req.ip || '';
    if (!ipsInSameSubnet(ctx.ip, reqIp)) return false;
  }
  return true;
}

export function ipsInSameSubnet(a: string, b: string): boolean {
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
export const loginLimiter = rateLimit({
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
      const preflight = (await peopleRepo.list()).find((p) => p.email.toLowerCase() === String(req.body.email).toLowerCase());
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
        ? (await peopleRepo.list()).find((p) => p.email.toLowerCase() === String(req.body.email).toLowerCase())
        : null;
      if (matched && provider.type === 'local') {
        const after = await recordFailedLogin(matched);
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
    const personRecord = (await peopleRepo.list()).find((p) => p.email.toLowerCase() === user.email.toLowerCase());
    const resolvedOrgId = personRecord?.orgIds?.[0] || DEV_ORG_ID;
    const resolvedRole = personRecord
      ? getRoleForOrg(personRecord, resolvedOrgId)
      : user.role;

    // Successful credential check resets the lockout counter +
    // unlocks the account if it had been locked by an earlier burst.
    if (personRecord && provider.type === "local") await clearLockout(personRecord);
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

    // Mint refresh first so we can stamp its jti onto the access
    // token — /auth/sessions uses that to tag the caller's own row.
    const refresh = await createRefreshToken(user.sub, fingerprintFromRequest(req));
    const accessToken = createAccessToken({
      ...user,
      name: resolvedName,
      orgId: resolvedOrgId,
      role: resolvedRole,
      sessionJti: refresh.jti,
    });

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
    let person = (await peopleRepo.list()).find((p) => p.email.toLowerCase() === user.email.toLowerCase());

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
      await peopleRepo.create(person);
      provisioned = true;
    }

    const orgId = person.orgIds[0] || DEV_ORG_ID;
    const role = getRoleForOrg(person, orgId) || user.role;
    // Capture the OIDC providerId + id_token on the refresh-token
    // entry so /auth/logout can drive RP-initiated logout. The
    // id_token is verified, contains no Procela secret, and is only
    // valid as a logout hint for this specific IdP session — safe
    // to hold for the refresh-token lifetime.
    const refresh = await createRefreshToken(person.id, {
      oidcProviderId: flow.providerId,
      oidcIdToken: idToken,
      ...fingerprintFromRequest(req),
    });
    const accessToken = createAccessToken({
      sub: person.id, email: person.email, name: person.name, role, orgId,
      sessionJti: refresh.jti,
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
    const { user, returnTo, nameID, sessionIndex } = await samlProv.completeAcs(req.body as Record<string, string>);

    // Find-or-just-in-time-provision — same shape as OIDC.
    let person = (await peopleRepo.list()).find((p) => p.email.toLowerCase() === user.email.toLowerCase());
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
      await peopleRepo.create(person);
      provisioned = true;
    }

    const orgId = person.orgIds[0] || DEV_ORG_ID;
    const role = getRoleForOrg(person, orgId) || user.role;
    const refresh = await createRefreshToken(person.id, {
      samlNameID: nameID,
      ...(sessionIndex ? { samlSessionIndex: sessionIndex } : {}),
      ...fingerprintFromRequest(req),
    });
    const accessToken = createAccessToken({
      sub: person.id, email: person.email, name: person.name, role, orgId,
      sessionJti: refresh.jti,
    });

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
 * GET /api/v1/auth/saml/sls
 *
 * Single Logout Service endpoint — handles IdP-initiated SLO. The
 * IdP sends a signed LogoutRequest here when the user signs out at
 * the IdP side and the IdP wants every connected SP to invalidate
 * its own session. We verify the signature, look up the local
 * refresh-token entries by SAML NameID, revoke them, and send a
 * signed LogoutResponse back to the IdP.
 *
 * Both Redirect-binding (GET with SAMLRequest in the query) and
 * POST-binding (POST with SAMLRequest in the body) are supported
 * — node-saml's validateRedirectAsync handles both via its
 * `originalQuery` parameter.
 */
const handleSamlSls = async (req: Request, res: Response): Promise<void> => {
  const frontendBase = (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSamlProvider } = require('../services/saml.service') as typeof import('../services/saml.service');
    const samlProv = getSamlProvider();
    if (!samlProv || !samlProv.isConfigured) {
      res.status(503).type('text/plain').send('SAML provider is not configured');
      return;
    }

    // node-saml expects the raw query string for signature validation
    // (the signature was computed over the URL-encoded parameters as
    // they arrived). For POST-binding requests, hand it the body
    // serialised the same way.
    const rawQuery = req.method === 'GET'
      ? (req.url.split('?')[1] || '')
      : new URLSearchParams(req.body as Record<string, string>).toString();
    const params = req.method === 'GET'
      ? (req.query as Record<string, string>)
      : (req.body as Record<string, string>);

    const { nameID } = await samlProv.validateIdpLogoutRequest(params, rawQuery);

    // Revoke every refresh token whose SAML NameID matches. A single
    // browser session typically has one entry, but a user who logged
    // in on multiple devices through the same IdP has one entry per
    // device — all of them go.
    let revoked = 0;
    for (const ctx of await refreshTokensRepo.list()) {
      if (ctx.samlNameID === nameID) {
        await refreshTokensRepo.remove(ctx.jti);
        revoked++;
        auditService.log(DEV_ORG_ID, ctx.personId || null, 'Auth', 'saml', 'SAML_SLO_REVOKED', null, { jti: ctx.jti, nameID });
      }
    }

    // Build the LogoutResponse URL the IdP expects, redirect the
    // browser there. Without SAML_LOGOUT_URL we can't build the URL
    // so just redirect the user to the login page locally — the
    // refresh-token revocation already did its job, the IdP just
    // won't see a confirmation.
    const relayState = String(params.RelayState || '');
    const responseUrl = await samlProv.buildLogoutResponseUrl(nameID, relayState);
    if (responseUrl) {
      res.redirect(responseUrl);
    } else {
      res.redirect(`${frontendBase}/login`);
    }
    logger.info({ nameID, revoked }, 'SAML SLO processed');
  } catch (err: any) {
    auditService.log(DEV_ORG_ID, null, 'Auth', 'saml', 'SAML_SLO_FAILED', null, {
      error: err?.message || String(err),
    });
    logger.warn({ err: err?.message }, 'SAML SLO failed');
    res.redirect(`${frontendBase}/login?error=${encodeURIComponent('SAML logout failed')}`);
  }
};
router.get('/saml/sls', handleSamlSls);
router.post('/saml/sls', handleSamlSls);

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
  const base = (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const acsUrl = `${base}/api/v1/auth/saml/acs`;
  const slsUrl = `${base}/api/v1/auth/saml/sls`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${pub.issuer}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="false" WantAssertionsSigned="true">
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${slsUrl}"/>
    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${slsUrl}"/>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
  res.type('application/xml').send(xml);
});

/**
 * POST /api/v1/auth/refresh
 *
 * Accepts { refreshToken } and returns BOTH a new access token AND a
 * rotated refresh token. Rotation closes the window on a stolen
 * refresh token — once the legitimate client uses one, the previous
 * jti is revoked, so any concurrent use of the old token from an
 * attacker fails closed. The frontend must replace its stored
 * refreshToken on every successful refresh.
 *
 * Detection of token reuse: if the incoming jti isn't in the
 * refresh-token store, it's either expired (auto-cleaned) or already
 * rotated. Either way we 401 — the second case is the suspicious one
 * and the audit entry surfaces it so a SOC can investigate.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ success: false, error: 'refreshToken is required' });
    return;
  }

  try {
    const decoded = verifyJwt<RefreshTokenPayload>(refreshToken);

    if (decoded.type !== 'refresh') {
      res.status(401).json({ success: false, error: 'Invalid token type' });
      return;
    }

    const ctx = await refreshTokensRepo.get(decoded.jti);
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
      await refreshTokensRepo.remove(decoded.jti);
      auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'refresh', 'REFRESH_BINDING_MISMATCH', null, {
        jti: decoded.jti,
        ip: req.ip,
        ua: req.headers['user-agent'],
      });
      res.status(401).json({ success: false, error: 'Session origin mismatch — please sign in again' });
      return;
    }

    // ── Rotation ──
    // Revoke the incoming jti and mint a fresh refresh token bound to
    // the same session context (provider id, original mint timestamp,
    // fingerprint). Preserving createdAt lets the Active Sessions page
    // keep showing "Signed in 3 days ago" rather than resetting on
    // every refresh.
    const newRefresh = await createRefreshToken(decoded.sub, {
      oidcProviderId: ctx.oidcProviderId,
      oidcIdToken: ctx.oidcIdToken,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    // Overwrite the auto-set createdAt with the original so the
    // session timeline doesn't reset on every refresh.
    if (ctx.createdAt) {
      const rotatedCtx = await refreshTokensRepo.get(newRefresh.jti);
      if (rotatedCtx) {
        rotatedCtx.createdAt = ctx.createdAt;
        await refreshTokensRepo.upsert(rotatedCtx);
      }
    }
    await refreshTokensRepo.remove(decoded.jti);

    // Re-derive the user details from the people store so the access
    // token reflects current role + name. The old refresh path
    // re-issued from the sub claim alone, which drifted whenever a
    // role changed mid-session.
    const person = await peopleRepo.get(decoded.sub);
    const orgId = person?.orgIds[0] || DEV_ORG_ID;
    const role = person ? getRoleForOrg(person, orgId) : 'VIEWER';
    const accessToken = createAccessToken({
      sub: decoded.sub,
      email: person?.email || '',
      name: person?.name || '',
      role,
      orgId,
      sessionJti: newRefresh.jti,
    });

    auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'refresh', 'TOKEN_REFRESHED', null, {
      oldJti: decoded.jti, newJti: newRefresh.jti,
    });
    logger.debug({ sub: decoded.sub, oldJti: decoded.jti, newJti: newRefresh.jti }, 'Refresh token rotated');

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefresh.token,
        expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      },
    });
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
router.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ success: false, error: 'refreshToken is required' });
    return;
  }

  try {
    const decoded = verifyJwt<RefreshTokenPayload>(refreshToken);

    if (decoded.type !== 'refresh') {
      res.status(400).json({ success: false, error: 'Invalid token type' });
      return;
    }

    // Pull the session context BEFORE deleting so we can build the
    // RP / SP-initiated logout URL with the original id_token / nameID.
    const ctx: Partial<StoredRefreshToken> = (await refreshTokensRepo.get(decoded.jti)) ?? {};
    const wasValid = await refreshTokensRepo.remove(decoded.jti);

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
    } else if (ctx.samlNameID) {
      // SP-initiated SAML SLO: ship the user to the IdP's logout
      // endpoint with our nameID hint so the IdP can correlate the
      // logout with its own session record.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getSamlProvider } = require('../services/saml.service') as typeof import('../services/saml.service');
      const samlProv = getSamlProvider();
      if (samlProv) {
        const postLogoutRedirectUri = (config.appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '') + '/login';
        logoutUrl = await samlProv.buildLogoutUrl({
          sub: ctx.samlNameID,
          sessionIndex: ctx.samlSessionIndex,
          returnTo: postLogoutRedirectUri,
        });
      }
    }

    auditService.log(DEV_ORG_ID, decoded.sub, 'Auth', 'logout', 'LOGOUT', null, {
      jti: decoded.jti,
      wasValid,
      rpInitiated: !!logoutUrl,
      oidcProviderId: ctx.oidcProviderId || null,
      samlNameID: ctx.samlNameID || null,
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
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  // Enrich the JWT-decoded user with a few fields the frontend needs
  // but that aren't (and shouldn't be) on the access token. mfaEnrolled
  // + mfaBackupCodesRemaining drive the Settings panel and the
  // "running low — regenerate?" nudge.
  const person = req.user?.sub ? await peopleRepo.get(req.user!.sub) : null;
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
 * GET /api/v1/auth/jwks.json — public JWKS for the current signing
 * key. Returned when the backend runs with RS256; when HS256 is
 * active there's no public key to publish and the endpoint 404s.
 *
 * Consumers (an edge proxy, a data-lake token gate, a downstream
 * microservice) fetch this document to verify Procela-issued JWTs
 * without needing the private key. Standard JWKS format per RFC 7517
 * — an object with a `keys` array of JWK entries carrying `kid`,
 * `alg`, `use`, and the RSA key material.
 */
router.get('/jwks.json', (_req: Request, res: Response) => {
  const jwks = getJwks();
  if (!jwks) {
    res.status(404).json({ success: false, error: `JWKS not available — server signs with ${currentAlgorithm()} (no public key to publish). Set JWT_PRIVATE_KEY + JWT_PUBLIC_KEY to enable RS256.` });
    return;
  }
  // Cache for an hour — key rotations flip JWT_KID and callers
  // observe the new id in the JWT header, then re-fetch.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(jwks);
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
  async (req: AuthenticatedRequest, res: Response) => {
    const { id, displayName, issuer, clientId, clientSecret, allowedEmailDomains } = req.body;
    if (!id || !displayName || !issuer || !clientId || !clientSecret) {
      res.status(400).json({ success: false, error: 'id, displayName, issuer, clientId, clientSecret are required' });
      return;
    }
    await upsertOidcProvider({
      id, displayName, issuer, clientId, clientSecret,
      ...(Array.isArray(allowedEmailDomains) ? { allowedEmailDomains } : {}),
    });
    auditService.log(DEV_ORG_ID, req.user?.sub || null, 'Auth', 'oidc', 'OIDC_PROVIDER_UPSERTED', null, {
      id, displayName, issuer,
    });
    res.json({ success: true, data: { id, displayName, issuer } });
  });

router.delete('/oidc-providers/:id', authenticateToken, authorize('SUPER_ADMIN', 'ORG_ADMIN'),
  async (req: AuthenticatedRequest, res: Response) => {
    const id = String(req.params.id);
    const removed = await removeOidcProvider(id);
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
router.put('/config', async (req: Request, res: Response) => {
  const { provider, oidcIssuer, oidcClientId } = req.body;

  const validProviders = ['dev', 'local', 'oidc', 'saml'];
  if (provider && !validProviders.includes(provider)) {
    res.status(400).json({
      success: false,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    });
    return;
  }

  await updateAuthConfig({ provider, oidcIssuer, oidcClientId });

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
// Password management + MFA/TOTP + WebAuthn
// ---------------------------------------------------------------------------
// Handlers live in ./auth-password.ts, ./auth-mfa.ts, and
// ./auth-webauthn.ts. Mounted here so the paths stay /password/…,
// /mfa/…, /mfa/webauthn/…, and /webauthn/discoverable/… under the
// same /api/v1/auth prefix as the rest of this router. The imports
// are deferred via require() because those files import shared
// helpers (loginLimiter, createAccessToken, …) from this file — a
// static top-level import would trigger the circular load before
// those `export const` bindings are initialised.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { passwordRouter } = require('./auth-password') as typeof import('./auth-password');
router.use(passwordRouter);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mfaRouter } = require('./auth-mfa') as typeof import('./auth-mfa');
router.use(mfaRouter);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { webauthnRouter } = require('./auth-webauthn') as typeof import('./auth-webauthn');
router.use(webauthnRouter);

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

router.get('/sessions', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  // sjti is the refresh-token jti minted alongside the access token
  // the caller is using right now. Match against each session row so
  // the UI can label one as "This device".
  const currentJti = (req.user as { sjti?: string } | undefined)?.sjti;
  const sessions: Array<Record<string, unknown>> = [];
  for (const ctx of await refreshTokensRepo.list()) {
    if (ctx.personId !== userId) continue;
    sessions.push({
      jti: ctx.jti,
      createdAt: ctx.createdAt || null,
      lastUsedAt: ctx.lastUsedAt || null,
      ip: ctx.ip || null,
      userAgent: ctx.userAgent || null,
      provider: ctx.oidcProviderId ? 'oidc' : 'local',
      current: ctx.jti === currentJti,
    });
  }
  sessions.sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
  res.json({ success: true, data: sessions });
});

router.delete('/sessions/:jti', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const jti = String(req.params.jti);
  const ctx = await refreshTokensRepo.get(jti);
  if (!ctx || ctx.personId !== userId) {
    res.status(404).json({ success: false, error: 'Session not found' });
    return;
  }
  await refreshTokensRepo.remove(jti);
  auditService.log(DEV_ORG_ID, userId, 'Auth', 'session', 'SESSION_REVOKED_SELF', null, { jti });
  res.status(204).end();
});

router.delete('/sessions', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  let revoked = 0;
  for (const ctx of await refreshTokensRepo.list()) {
    if (ctx.personId === userId) {
      await refreshTokensRepo.remove(ctx.jti);
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
router.post('/switch-org', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
  const { orgId } = req.body || {};
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  const person = await peopleRepo.get(userId);
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
  // Preserve the existing session jti — switching orgs doesn't open
  // a new session, it re-stamps the access token within the same
  // refresh-token lifecycle. /auth/sessions will keep tagging the
  // same row as current.
  const accessToken = createAccessToken({
    sub: person.id, email: person.email, name: person.name, role, orgId,
    sessionJti: (req.user as { sjti?: string } | undefined)?.sjti,
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
  async (req: AuthenticatedRequest, res: Response) => {
    const { personId } = req.body || {};
    if (!personId) { res.status(400).json({ success: false, error: 'personId is required' }); return; }
    const target = await peopleRepo.get(personId);
    if (!target) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
    await adminClearLockout(target);
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
router.get('/accessible-orgs', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }

  const WORKING_LEVELS = ['company', 'division'];

  // Find the user's people record by email
  const person = (await peopleRepo.list()).find((p) => p.email.toLowerCase() === (user.email || '').toLowerCase());

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
