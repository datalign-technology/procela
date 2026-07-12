import { randomBytes } from 'crypto';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// reset-tokens — single-use password-reset token store.
//
// In-memory Map<token, { personId, expiresAt }>; tokens are minted by
// /auth/password/forgot and consumed by /auth/password/reset. A token
// is consumed (deleted) on first use whether the new password validates
// or not, so a leaked token can be used at most once.
//
// Production should swap the in-memory Map for a Redis store so tokens
// survive restarts and work across instances. The exported functions
// are the only surface; the underlying store is swappable without
// touching call sites.
//
// Tokens are 32 bytes from crypto.randomBytes encoded as base64url —
// 256 bits of entropy, URL-safe so they can sit in a reset-link
// query string without escaping.
// ──────────────────────────────────────────────────────────────────────────

interface ResetEntry {
  personId: string;
  expiresAt: number; // ms epoch
}

const tokens = new Map<string, ResetEntry>();

// One hour is long enough to land in a real inbox and click through
// without rushing, short enough that a compromised mailbox doesn't
// give an attacker a stable backdoor.
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Sweep expired tokens periodically so a flood of forgot-password
// requests doesn't grow the Map indefinitely.
import { startBackgroundSweep } from '../lib/background-timer';
startBackgroundSweep(() => {
  const now = Date.now();
  let removed = 0;
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) {
      tokens.delete(token);
      removed++;
    }
  }
  if (removed > 0) logger.debug({ removed }, 'Swept expired reset tokens');
}, 5 * 60 * 1000);

export function mintResetToken(personId: string): string {
  const token = randomBytes(32).toString('base64url');
  tokens.set(token, {
    personId,
    expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
  });
  return token;
}

/** Consume the token (single-use) and return the bound personId, or
 *  null if the token is unknown or expired. The token is always
 *  removed on call, even when invalid/expired — there's no path that
 *  keeps a token alive for a retry. */
export function consumeResetToken(token: string): string | null {
  const entry = tokens.get(token);
  tokens.delete(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.personId;
}

/** Reverse the consume — re-insert a token that was deleted but whose
 *  use turned out to be a no-op (e.g. validation failed before any
 *  state change). Optional; not currently used. Kept for symmetry with
 *  the Redis variant where atomic put-back may be cleaner than a
 *  separate delete+mint. */
export function _restoreResetTokenForTesting(token: string, personId: string, expiresAt: number): void {
  tokens.set(token, { personId, expiresAt });
}

/** Test helper — clears the map. Not exported via index. */
export function _resetAllForTesting(): void {
  tokens.clear();
}
