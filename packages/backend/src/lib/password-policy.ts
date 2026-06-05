import { readFileSync } from 'fs';
import { join } from 'path';
import logger from './logger';

// ──────────────────────────────────────────────────────────────────────────
// password-policy — validates new passwords against organization rules.
//
// Centralized so the rules can be tuned in one place: the local auth
// provider, the change-password route, the admin-reset route, and the
// migration helper all run new passwords through validate() before
// hashing.
//
// Following NIST 800-63B current guidance, not legacy "must have 1
// uppercase, 1 digit, 1 special" advice:
//
//   - Minimum length is the primary control.
//   - No composition rules (mixed-case / digits / symbols are not
//     required) — they produce predictable patterns that attackers
//     model and slip into wordlists.
//   - No maximum length (Argon2 handles long inputs fine; rejecting
//     "too long" is an anti-pattern).
//   - Breached-password screening is the second primary control. The
//     wordlist is loaded from breached-passwords.txt at startup and
//     can be swapped for a fuller HIBP corpus without code changes.
// ──────────────────────────────────────────────────────────────────────────

export interface PasswordPolicy {
  minLength: number;
  blockBreached: boolean;
}

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 12,
  blockBreached: true,
};

// Load the wordlist once at module init. Stripped of comments and
// blank lines; comparison is case-insensitive.
//
// Path resolution:
//   1. BREACHED_PASSWORDS_FILE env var (absolute or relative to cwd)
//      so production can mount a full HIBP corpus without touching
//      this repo.
//   2. The bundled wordlist next to this module.
function loadBreachedSet(): Set<string> {
  const envPath = process.env.BREACHED_PASSWORDS_FILE;
  const path = envPath || join(__dirname, 'breached-passwords.txt');
  try {
    const raw = readFileSync(path, 'utf-8');
    const entries = raw
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    const set = new Set(entries);
    logger.info({ count: set.size, source: envPath ? 'env' : 'bundled', path }, 'Loaded breached-password wordlist');
    return set;
  } catch (err) {
    // Fail open — log loudly but don't block the boot. An empty set
    // means the policy still enforces minLength; only the breach
    // check is disabled.
    logger.error({ err, path }, 'Failed to load breached-password wordlist — breach screening disabled');
    return new Set();
  }
}

const KNOWN_BREACHED = loadBreachedSet();

export interface ValidationResult {
  valid: boolean;
  /** Single-sentence reason suitable for an error response. Never
   *  echoes the password itself. */
  error?: string;
}

export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_POLICY,
): ValidationResult {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < policy.minLength) {
    return { valid: false, error: `Password must be at least ${policy.minLength} characters` };
  }
  if (policy.blockBreached && KNOWN_BREACHED.has(password.toLowerCase())) {
    return { valid: false, error: 'That password is in a known-breached list — please choose another' };
  }
  return { valid: true };
}
