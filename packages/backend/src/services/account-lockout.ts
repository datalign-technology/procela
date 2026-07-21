import { people, type StoredPerson } from '../routes/people';
import { getPeopleRepository } from '../db/people.repo';

// Persist lockout-state changes through the people repository (Postgres when
// DATABASE_URL is set, the in-memory array otherwise) — see
// docs/POSTGRES_CUTOVER_PLAN.md (PR 3e).
const peopleRepo = getPeopleRepository(people);

// ──────────────────────────────────────────────────────────────────────────
// account-lockout — soft, per-account brute-force protection.
//
// Sits in front of the password verifier as a second line of defence
// behind the IP-keyed rate limiter. The rate limiter throws back at
// the network layer; lockout throws back at the credential layer.
// Together they cover:
//   - distributed credential stuffing from many IPs (lockout catches)
//   - bursts from one IP (rate limiter catches)
//
// Counter resets on a successful login OR after the window passes
// without another failure. Locked accounts auto-unlock when the
// LOCKOUT_DURATION_MS elapses; an admin can also clear the lock via
// the /people/:id/reactivate-style admin route surfaced in the
// Person detail page Security card.
//
// Numbers chosen to be loud enough to trip on a realistic credential-
// stuffing pattern (a few attempts per minute across many emails)
// but quiet enough that a user who fumbles their password three
// times in a row doesn't lock themselves out. Adjust via env if a
// customer's policy needs tighter / looser values.
// ──────────────────────────────────────────────────────────────────────────

const THRESHOLD = parseInt(process.env.LOCKOUT_THRESHOLD || '10', 10);
const WINDOW_MS = parseInt(process.env.LOCKOUT_WINDOW_MS || String(30 * 60 * 1000), 10);
const DURATION_MS = parseInt(process.env.LOCKOUT_DURATION_MS || String(30 * 60 * 1000), 10);

export interface LockoutState {
  /** True when the account is currently locked. */
  locked: boolean;
  /** Seconds until the account auto-unlocks; 0 when not locked. */
  retryAfterSeconds: number;
}

/** Read-only check — does NOT mutate the record. Called by the login
 *  route to short-circuit before running argon2.verify, which is
 *  expensive. */
export function checkLockout(person: StoredPerson): LockoutState {
  if (!person.lockedUntil) return { locked: false, retryAfterSeconds: 0 };
  const until = new Date(person.lockedUntil).getTime();
  if (!Number.isFinite(until)) return { locked: false, retryAfterSeconds: 0 };
  const now = Date.now();
  if (until <= now) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) };
}

/** Call after a failed credential check. Increments the counter and
 *  locks the account when the threshold is crossed inside the window.
 *  Returns the resulting lockout state so the caller can include the
 *  retry-after info in the 401 response. */
export async function recordFailedLogin(person: StoredPerson): Promise<LockoutState> {
  const now = Date.now();
  const windowStart = person.failedLoginFirstAt
    ? new Date(person.failedLoginFirstAt).getTime()
    : 0;
  // Reset window if the previous failure aged out.
  if (!windowStart || now - windowStart > WINDOW_MS) {
    person.failedLoginCount = 1;
    person.failedLoginFirstAt = new Date(now).toISOString();
  } else {
    person.failedLoginCount = (person.failedLoginCount || 0) + 1;
  }
  if (person.failedLoginCount >= THRESHOLD) {
    person.lockedUntil = new Date(now + DURATION_MS).toISOString();
  }
  person.updatedAt = new Date().toISOString();
  await peopleRepo.update(person.id, person);
  return checkLockout(person);
}

/** Call on a successful login — clears the counter and any active lock. */
export async function clearLockout(person: StoredPerson): Promise<void> {
  if (person.failedLoginCount || person.failedLoginFirstAt || person.lockedUntil) {
    person.failedLoginCount = undefined;
    person.failedLoginFirstAt = undefined;
    person.lockedUntil = undefined;
    person.updatedAt = new Date().toISOString();
    await peopleRepo.update(person.id, person);
  }
}

/** Manually clear a lock (admin action). Same as clearLockout but
 *  exposed as a distinct verb so the audit log makes the actor's
 *  intent clear ("admin-unlocked" rather than "succeeded"). */
export async function adminClearLockout(person: StoredPerson): Promise<void> {
  await clearLockout(person);
}
