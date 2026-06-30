import { mintOpaqueMfaToken, MFA_TOKEN_TTL_SECONDS } from './mfa.service';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// pending-mfa — in-memory store for sessions that have passed the
// password gate but haven't yet cleared the TOTP gate.
//
// Lives between /auth/login (which mints the token on a successful
// password check) and /auth/mfa/login-verify (which consumes it
// after the user supplies a valid TOTP or backup code). Single-use —
// consumeMfaToken() deletes whether the consumer succeeds or fails,
// so a leaked token can be used at most once.
//
// Production should swap the Map for Redis so the store survives a
// process restart between mint and consume and works across instances.
// The exported helpers are the only surface; the underlying store is
// swappable without touching call sites.
// ──────────────────────────────────────────────────────────────────────────

interface PendingMfa {
  /** Procela Person.id — used to look up the user record on consume. */
  personId: string;
  /** Milliseconds epoch. Entries past this expire — leftover tokens
   *  age out so the Map doesn't grow indefinitely. */
  expiresAt: number;
}

const pending = new Map<string, PendingMfa>();

const sweep = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [token, entry] of pending) {
    if (entry.expiresAt < now) {
      pending.delete(token);
      removed++;
    }
  }
  if (removed > 0) logger.debug({ removed }, 'Swept expired pending-MFA tokens');
}, 60_000);
sweep.unref?.();

export function mintPendingMfa(personId: string): string {
  const token = mintOpaqueMfaToken();
  pending.set(token, {
    personId,
    expiresAt: Date.now() + MFA_TOKEN_TTL_SECONDS * 1000,
  });
  return token;
}

/** Single-use lookup. Returns the bound personId on success, null on
 *  any failure (unknown token, expired). The entry is deleted on
 *  every call regardless — there's no path that lets a token be
 *  reused after a wrong code. */
export function consumePendingMfa(token: string): string | null {
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.personId;
}
