import jwt, { type Algorithm, type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { createPublicKey, type JsonWebKey } from 'crypto';
import config from '../config';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// jwt-signer — one module that owns the sign / verify boundary.
//
// Two modes:
//   * HS256 — symmetric secret. Every party who verifies must know
//     the secret. Fine for a single-node dev / test setup.
//   * RS256 — asymmetric RSA. The backend signs with its private
//     key; anyone can verify with the public key, which is also
//     published at /api/v1/auth/jwks.json. Real production auth
//     should be here.
//
// Callers just call `sign(payload, {expiresIn})` and `verify(token)`
// — they don't need to know which algorithm is active. The mode is
// resolved from config at import time. A production boot with
// HS256 still active is loudly warned in warnOnMissingProdConfig
// (index.ts) so the operator knows to upgrade.
// ──────────────────────────────────────────────────────────────────────────

type ResolvedAlgorithm = 'HS256' | 'RS256';

interface SignerState {
  algorithm: ResolvedAlgorithm;
  signingKey: string;
  verifyingKey: string;
  kid: string | null;
  jwks: { keys: JsonWebKey[] } | null;
}

function resolveState(): SignerState {
  const requested = (config.jwtAlgorithm || '').toUpperCase();
  const hasRsaPair = !!config.jwtPrivateKey && !!config.jwtPublicKey;
  // Explicit HS256 overrides the auto-upgrade even when PEMs are
  // present — useful for a rolling rotation where the new PEMs are
  // installed but signing hasn't switched yet.
  const wantRs256 = (requested === 'RS256') || (requested !== 'HS256' && hasRsaPair);
  if (wantRs256) {
    if (!hasRsaPair) {
      // Requested RS256 explicitly but no PEMs — fail fast rather
      // than silently downgrading to HS256 and misleading the
      // operator.
      throw new Error('JWT_ALGORITHM=RS256 requires JWT_PRIVATE_KEY + JWT_PUBLIC_KEY');
    }
    let jwks: { keys: JsonWebKey[] } | null = null;
    try {
      const pubKey = createPublicKey(config.jwtPublicKey);
      const jwk = pubKey.export({ format: 'jwk' }) as JsonWebKey;
      jwks = { keys: [{ ...jwk, kid: config.jwtKid, alg: 'RS256', use: 'sig' } as JsonWebKey] };
    } catch (err) {
      throw new Error(`JWT_PUBLIC_KEY is not a valid PEM: ${(err as Error).message}`);
    }
    logger.info({ kid: config.jwtKid }, 'JWT: signing with RS256 (asymmetric)');
    return {
      algorithm: 'RS256',
      signingKey: config.jwtPrivateKey,
      verifyingKey: config.jwtPublicKey,
      kid: config.jwtKid,
      jwks,
    };
  }
  logger.info('JWT: signing with HS256 (symmetric — set JWT_PRIVATE_KEY + JWT_PUBLIC_KEY for RS256)');
  return {
    algorithm: 'HS256',
    signingKey: config.jwtSecret,
    verifyingKey: config.jwtSecret,
    kid: null,
    jwks: null,
  };
}

let _state: SignerState | null = null;
function state(): SignerState {
  if (!_state) _state = resolveState();
  return _state;
}

/** Sign a token. `expiresIn` accepts anything jsonwebtoken accepts
 *  ('1h', '15m', 3600, etc.). */
export function sign(payload: object, options: { expiresIn: SignOptions['expiresIn'] }): string {
  const s = state();
  const opts: SignOptions = {
    algorithm: s.algorithm as Algorithm,
    expiresIn: options.expiresIn,
    ...(s.kid ? { keyid: s.kid } : {}),
  };
  return jwt.sign(payload, s.signingKey, opts);
}

/** Verify a token. Throws jsonwebtoken's own errors on failure. */
export function verify<T = unknown>(token: string): T {
  const s = state();
  const opts: VerifyOptions = { algorithms: [s.algorithm as Algorithm] };
  return jwt.verify(token, s.verifyingKey, opts) as T;
}

/** Return the JWKS to publish at /auth/jwks.json, or null when
 *  running in HS256 mode (there's no public key to share). */
export function getJwks(): { keys: JsonWebKey[] } | null {
  return state().jwks;
}

/** The active algorithm, useful for readiness checks + warnings. */
export function currentAlgorithm(): ResolvedAlgorithm {
  return state().algorithm;
}

/** Reset the memoised state — tests only. */
export function _resetForTesting(): void {
  _state = null;
}
