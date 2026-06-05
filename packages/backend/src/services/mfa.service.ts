import {
  generateSecret, generate, verify, generateURI,
  NobleCryptoPlugin, ScureBase32Plugin,
} from 'otplib';
import { randomBytes, randomInt } from 'crypto';
import * as argon2 from 'argon2';
import qrcode from 'qrcode';

// otplib v13 takes crypto + base32 plugins on every call. Constructed
// once at module init so we don't re-instantiate per request.
const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

// ──────────────────────────────────────────────────────────────────────────
// mfa.service — TOTP enrollment + verification + backup codes.
//
// Uses otplib (functional API in v13+) for RFC 6238 TOTP — the same
// algorithm Google Authenticator / Authy / 1Password implement.
// Parameters chosen here: 30-second step, 6-digit codes, SHA-1 HMAC
// (the de facto standard the authenticator apps assume). Verify
// accepts the previous and next step in addition to the current to
// cover ~30s of clock skew in either direction.
//
// Backup codes: 10 codes generated per enrollment, displayed once,
// stored as Argon2 hashes so a database leak doesn't reveal them.
// Each is single-use — verifyBackupCode() returns the index of the
// used hash so the caller can splice it out of the array.
//
// Why not store the TOTP secret as a hash: HMAC needs the original
// bytes. Production should encrypt the secret at the column level
// via the same KMS that wraps DB credentials.
// ──────────────────────────────────────────────────────────────────────────

const TOTP_STEP = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // accept ±1 step (~30s) of clock skew

const ISSUER = 'Procela';

export interface MfaEnrollment {
  /** Base32-encoded secret. Stored verbatim on StoredPerson.mfaSecret;
   *  shown to the user once during enrollment for manual entry. */
  secret: string;
  /** otpauth:// URI — the QR-code payload. Authenticator apps scan
   *  this directly. */
  uri: string;
  /** PNG data URL of the QR code. The frontend sets this as <img src>. */
  qrDataUrl: string;
}

/** Generate a fresh secret + matching QR code for the user to scan.
 *  Does NOT persist the secret — the caller writes it to the user
 *  record only after verifyToken() succeeds against a user-supplied
 *  code (proves the user actually has the authenticator set up). */
export async function generateEnrollment(accountEmail: string): Promise<MfaEnrollment> {
  const secret = generateSecret({ length: 20, crypto, base32 }); // 160-bit, RFC 4226 §4
  const uri = generateURI({
    secret,
    label: accountEmail,
    issuer: ISSUER,
    algorithm: 'sha1',
    digits: TOTP_DIGITS,
    period: TOTP_STEP,
  });
  const qrDataUrl = await qrcode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return { secret, uri, qrDataUrl };
}

/** Verify a 6-digit code against a stored secret. Returns true on
 *  match within the ±1 step window. Returns false silently on
 *  mismatch (callers turn that into a "invalid code" error). */
export async function verifyToken(secret: string, code: string): Promise<boolean> {
  if (!secret || !code) return false;
  // otplib throws on malformed input — treat any throw as a failed
  // verify so a "999999" doesn't crash the route.
  try {
    const result = await verify({
      token: code.trim(),
      secret,
      digits: TOTP_DIGITS,
      period: TOTP_STEP,
      // epochTolerance is in seconds. window=1 step = ±30s.
      epochTolerance: TOTP_WINDOW * TOTP_STEP,
      crypto,
      base32,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/** Generate a current TOTP code for the secret. Used by tests; not
 *  invoked at runtime. */
export async function generateCurrentToken(secret: string): Promise<string> {
  return generate({ secret, digits: TOTP_DIGITS, period: TOTP_STEP, crypto, base32 });
}

// ── Backup codes ──

/** Number of backup codes generated per enrollment. 10 is the de
 *  facto industry standard (GitHub, AWS, Google all use 10). */
export const BACKUP_CODE_COUNT = 10;

/** Length of each backup code in characters. 10 chars from a 32-char
 *  alphabet = ~50 bits of entropy. Above the 40-bit floor for
 *  short-lived one-time use, well below the typing-pain threshold. */
const BACKUP_CODE_LENGTH = 10;

// URL/typewriter-friendly alphabet: no ambiguous chars (0/O, 1/l/I),
// no special chars that need escaping. Matches the temp-password
// alphabet used by the local-credential migration.
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateOneBackupCode(): string {
  const out: string[] = [];
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    out.push(BACKUP_CODE_ALPHABET[randomInt(0, BACKUP_CODE_ALPHABET.length)]);
  }
  // Insert a hyphen halfway through for readability when the user
  // jots one down on paper. Comparison strips hyphens, so users can
  // type it either way.
  return out.slice(0, 5).join('') + '-' + out.slice(5).join('');
}

export function generateBackupCodes(): string[] {
  const out: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) out.push(generateOneBackupCode());
  return out;
}

export async function hashBackupCode(plain: string): Promise<string> {
  return argon2.hash(normalizeBackupCode(plain), { type: argon2.argon2id });
}

export async function hashBackupCodes(plain: string[]): Promise<string[]> {
  return Promise.all(plain.map(hashBackupCode));
}

/** Check a user-supplied code against the stored hashes. Returns
 *  the index of the matching hash on success so the caller can
 *  splice it out (single-use). Returns -1 on no match. */
export async function verifyBackupCode(hashes: string[], plain: string): Promise<number> {
  const normalized = normalizeBackupCode(plain);
  if (!normalized) return -1;
  for (let i = 0; i < hashes.length; i++) {
    try {
      const ok = await argon2.verify(hashes[i], normalized);
      if (ok) return i;
    } catch { /* malformed hash — skip */ }
  }
  return -1;
}

function normalizeBackupCode(s: string): string {
  // Strip whitespace, hyphens, and lowercase letters (we store
  // uppercase). The dashes-for-readability and case-tolerance combine
  // to let users type the code however it's most convenient.
  return s.replace(/[\s-]/g, '').toUpperCase();
}

// ── MFA-pending session token ──
// Short-lived JWT issued after a successful password check, before
// the TOTP gate. Verified by the /mfa/login-verify route to identify
// the user without re-prompting the password. Five-minute lifetime
// is enough to dig out the authenticator app and type a code; short
// enough that a stolen mfaToken doesn't sit usable forever.
export const MFA_TOKEN_TTL_SECONDS = 5 * 60;

/** Generate a small random token (not a JWT — opaque server-side
 *  reference, valid only for one /mfa/login-verify call). Returned
 *  alongside the personId in the pending store. */
export function mintOpaqueMfaToken(): string {
  return randomBytes(24).toString('base64url');
}
