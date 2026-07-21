import { Router, Request, Response } from 'express';
import { AuthenticatedRequest, authenticateToken, authorize } from '../middleware/auth';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people } from './people';
import { saveStore } from '../lib/persistence';
import { startBackgroundSweep } from '../lib/background-timer';
import {
  generateEnrollment,
  verifyToken as verifyTotpToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
} from '../services/mfa.service';
import { consumePendingMfa } from '../services/pending-mfa';
import { encryptSecret, decryptSecret } from '../services/crypto.service';
import {
  DEV_ORG_ID,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  createAccessToken,
  createRefreshToken,
  fingerprintFromRequest,
  loginLimiter,
} from './auth';

const router = Router();

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

startBackgroundSweep(() => {
  const now = Date.now();
  for (const [k, v] of pendingEnrollments) {
    if (v.expiresAt < now) pendingEnrollments.delete(k);
  }
}, 60_000);

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
  const refresh = await createRefreshToken(person.id, fingerprintFromRequest(req));
  const accessToken = createAccessToken({
    sub: person.id, email: person.email, name: person.name, role: person.role, orgId,
    sessionJti: refresh.jti,
  });

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

export const mfaRouter = router;
