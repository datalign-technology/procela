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
//   - Breached-password screening is the second primary control. A
//     real deployment ships an embedded HIBP-style local wordlist
//     (no network call needed). The stub here matches a small
//     handful of obvious ones so the rule path is testable; the
//     wordlist is meant to be replaced before production.
// ──────────────────────────────────────────────────────────────────────────

export interface PasswordPolicy {
  minLength: number;
  /** Allow blocking a small set of common passwords. Replace the stub
   *  set with an embedded HIBP-derived wordlist for production. */
  blockBreached: boolean;
}

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 12,
  blockBreached: true,
};

// Stub breached-password set. NOT comprehensive — production should
// embed the top ~10k from HIBP / SecLists. Kept small here so the
// repo doesn't carry a wordlist artefact in this commit.
const KNOWN_BREACHED = new Set([
  'password', 'password1', 'password123', 'p@ssword', 'p@ssw0rd',
  'qwerty', 'qwerty123', '12345678', '123456789', '1234567890',
  'iloveyou', 'admin', 'admin123', 'letmein', 'welcome',
  'monkey', 'dragon', 'baseball', 'football', 'starwars',
  'procela', 'procela123', 'procela2025', 'procela2026',
]);

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
