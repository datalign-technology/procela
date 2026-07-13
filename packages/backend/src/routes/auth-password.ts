import { Router, Request, Response } from 'express';
import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { AuthenticatedRequest, authenticateToken, authorize } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { people } from './people';
import { saveStore } from '../lib/persistence';
import { validatePassword } from '../lib/password-policy';
import { mintResetToken, consumeResetToken, RESET_TOKEN_TTL_MS } from '../services/reset-tokens';
import { sendPasswordResetEmail, isConfigured as isMailConfigured } from '../services/mail.service';
import { hashPassword } from '../services/auth-providers';
import { DEV_ORG_ID } from './auth';

const router = Router();

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

export const passwordRouter = router;
