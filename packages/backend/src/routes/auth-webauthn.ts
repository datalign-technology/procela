import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { AuthenticatedRequest, authenticateToken, authorize } from '../middleware/auth';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people, isActive as isPersonActive } from './people';
import { saveStore } from '../lib/persistence';
import { mintPendingMfa, consumePendingMfa } from '../services/pending-mfa';
import {
  buildRegistrationOptions, completeRegistration,
  buildAuthenticationOptions, buildDiscoverableAuthenticationOptions, completeAuthentication,
  stashChallenge, consumeChallenge,
} from '../services/webauthn.service';
import {
  DEV_ORG_ID,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  createAccessToken,
  createRefreshToken,
  fingerprintFromRequest,
  loginLimiter,
} from './auth';

const router = Router();

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
  const refresh = await createRefreshToken(person.id, fingerprintFromRequest(req));
  const accessToken = createAccessToken({
    sub: person.id, email: person.email, name: person.name, role: person.role, orgId,
    sessionJti: refresh.jti,
  });

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
    const refresh = await createRefreshToken(person.id, fingerprintFromRequest(req));
    const accessToken = createAccessToken({
      sub: person.id, email: person.email, name: person.name, role: person.role, orgId,
      sessionJti: refresh.jti,
    });

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

export const webauthnRouter = router;
