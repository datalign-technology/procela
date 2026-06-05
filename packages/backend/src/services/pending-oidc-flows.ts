import { randomBytes, createHash } from 'crypto';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// pending-oidc-flows — in-memory store for OIDC authorization-code flows
// in flight.
//
// When the user clicks "Sign in with Microsoft" the backend mints a
// state + nonce + PKCE code_verifier, stashes them here keyed by the
// state value, and redirects the browser to the IdP. When the IdP
// redirects back with ?code=…&state=…, the callback handler looks up
// the state to recover the verifier and nonce, then deletes the entry
// — each flow is single-use.
//
// State + nonce + PKCE are the three things that defend the flow:
//   - state          ties the callback to the original /login request
//                    (CSRF: an attacker can't trick a logged-out user
//                    into completing a flow on their account because
//                    they don't know the state value).
//   - nonce          ties the eventually-issued id_token to this
//                    request (binds the IdP's signed assertion to the
//                    browser that started the flow; replays of an
//                    intercepted id_token to a different session
//                    fail).
//   - code_verifier  PKCE — even if an attacker intercepts the auth
//                    code (e.g. by reading the browser history of a
//                    shared device), they can't redeem it without the
//                    verifier, which never leaves the server.
//
// Production should swap the Map for Redis so the store survives a
// restart between /login and /callback and works across instances.
// The exported functions are the only surface; the underlying store
// is swappable without touching call sites.
// ──────────────────────────────────────────────────────────────────────────

export interface PendingFlow {
  /** Caller-supplied identifier of which OIDC provider this flow is
   *  for (e.g. "microsoft", "okta"). Lets the callback handler look
   *  up the right config when an org has more than one IdP. */
  providerId: string;
  /** PKCE code_verifier — random 43–128 char URL-safe string. Sent
   *  to the token endpoint to redeem the auth code. */
  codeVerifier: string;
  /** nonce — random string sent to the IdP in the auth URL and
   *  required to be present (and matching) in the returned id_token. */
  nonce: string;
  /** redirect_uri that was passed to the IdP. Must be repeated
   *  verbatim at the token endpoint or the IdP rejects the redeem. */
  redirectUri: string;
  /** Where the frontend should land after a successful callback.
   *  Lets the original /login request preserve "return to this URL
   *  after sign-in" intent. */
  returnTo: string;
  /** Millisecond expiry — flows that age out without completion get
   *  swept. Ten minutes is generous for the round-trip-through-IdP
   *  case where the user has to type a password + click MFA. */
  expiresAt: number;
}

const FLOW_TTL_MS = 10 * 60 * 1000;
const flows = new Map<string, PendingFlow>();

const sweep = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [state, flow] of flows) {
    if (flow.expiresAt < now) {
      flows.delete(state);
      removed++;
    }
  }
  if (removed > 0) logger.debug({ removed }, 'Swept expired pending OIDC flows');
}, 60_000);
sweep.unref?.();

/** Generate a URL-safe random string of the given byte length encoded
 *  as base64url. 32 bytes = 256 bits of entropy. */
function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/** PKCE: code_challenge = BASE64URL(SHA-256(code_verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function mintFlow(args: {
  providerId: string;
  redirectUri: string;
  returnTo: string;
}): { state: string; nonce: string; codeVerifier: string } {
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(64); // 64 bytes → 86 base64url chars
  flows.set(state, {
    providerId: args.providerId,
    codeVerifier,
    nonce,
    redirectUri: args.redirectUri,
    returnTo: args.returnTo,
    expiresAt: Date.now() + FLOW_TTL_MS,
  });
  return { state, nonce, codeVerifier };
}

/** Consume the flow (single-use). Returns null if the state is unknown
 *  or expired. The entry is removed whether the consumer succeeds or
 *  fails — there's no path that keeps a state alive for retry. */
export function consumeFlow(state: string): PendingFlow | null {
  const flow = flows.get(state);
  flows.delete(state);
  if (!flow) return null;
  if (flow.expiresAt < Date.now()) return null;
  return flow;
}

/** Test helper. Not exported via any production path. */
export function _clearAllForTesting(): void {
  flows.clear();
}
