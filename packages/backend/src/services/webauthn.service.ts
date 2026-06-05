import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  GenerateRegistrationOptionsOpts,
  GenerateAuthenticationOptionsOpts,
} from '@simplewebauthn/server';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// webauthn.service — WebAuthn / FIDO2 enrollment and authentication.
//
// Hardware-key (or platform-key) second-factor support layered on top
// of the existing TOTP / backup-code path. A user can register many
// credentials (a YubiKey + their phone fingerprint + a laptop's Touch
// ID); either WebAuthn OR TOTP satisfies the MFA gate at login. Users
// can configure both for redundancy.
//
// Relying party (RP) identifier is the registrable domain — for
// localhost dev that's "localhost"; for production it's whatever the
// browser sees on window.location.hostname. The origin (full URL with
// scheme/port) is also validated on every assertion.
//
// Library: @simplewebauthn/server v13 + companion @simplewebauthn/browser
// on the frontend. Standard, MIT-licensed, well-maintained.
// ──────────────────────────────────────────────────────────────────────────

export interface StoredCredential {
  id: string;             // internal handle (uuid)
  credentialID: string;   // base64url
  publicKey: string;      // base64url
  counter: number;
  transports?: string[];
  label: string;
  createdAt: string;
}

interface RpConfig {
  /** Registrable domain — "localhost" for dev, "procela.io" for prod. */
  rpID: string;
  /** Human-visible name shown in the OS / browser prompt. */
  rpName: string;
  /** Full origin (scheme + host + port). The browser includes this in
   *  clientDataJSON; mismatches fail verification. Production may
   *  list multiple origins (apex domain + www); the verify function
   *  accepts string or string[]. */
  expectedOrigin: string;
}

function readRpConfig(req?: { protocol?: string; host?: string }): RpConfig {
  const appUrl = process.env.APP_URL || '';
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      return {
        rpID: u.hostname,
        rpName: 'Procela',
        expectedOrigin: u.origin,
      };
    } catch { /* fall through */ }
  }
  // Dev fallback — derive from the inbound request when no APP_URL set.
  const proto = req?.protocol || 'http';
  const host = req?.host || 'localhost:5173';
  const hostname = host.split(':')[0];
  return {
    rpID: hostname,
    rpName: 'Procela',
    expectedOrigin: `${proto}://${host}`,
  };
}

// ── Registration ──

export async function buildRegistrationOptions(args: {
  personId: string;
  personEmail: string;
  personName: string;
  existingCredentials: StoredCredential[];
  req: { protocol: string; host: string };
}): Promise<{ options: ReturnType<typeof generateRegistrationOptions> extends Promise<infer T> ? T : never; rpID: string }> {
  const rp = readRpConfig(args.req);
  const opts: GenerateRegistrationOptionsOpts = {
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: args.personEmail,
    userDisplayName: args.personName,
    // userID must be stable and binary; we pass the Procela personId
    // as UTF-8 bytes so the IdP correlates across re-registrations.
    userID: new TextEncoder().encode(args.personId),
    attestationType: 'none',
    excludeCredentials: args.existingCredentials.map((c) => ({
      id: c.credentialID,
      transports: c.transports as any,
    })),
    authenticatorSelection: {
      // Don't require resident keys — most external authenticators
      // (YubiKey 5, Titan) don't have the storage for a discoverable
      // credential and would error. Users get a username field at
      // login either way (we don't do passwordless yet).
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257], // ES256, RS256 — broadest support
  };
  const options = await generateRegistrationOptions(opts);
  return { options, rpID: rp.rpID };
}

export async function completeRegistration(args: {
  response: any;       // RegistrationResponseJSON from the browser
  expectedChallenge: string;
  req: { protocol: string; host: string };
}): Promise<{ verified: boolean; credential?: Omit<StoredCredential, 'id' | 'label' | 'createdAt'> }> {
  const rp = readRpConfig(args.req);
  const verification = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: rp.expectedOrigin,
    expectedRPID: rp.rpID,
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }
  const ri = verification.registrationInfo;
  const cred = ri.credential;
  return {
    verified: true,
    credential: {
      // @simplewebauthn returns the credentialID + publicKey as
      // Uint8Array; convert to base64url for stable JSON storage.
      credentialID: cred.id,
      publicKey: Buffer.from(cred.publicKey).toString('base64url'),
      counter: cred.counter,
      transports: cred.transports as any,
    },
  };
}

// ── Authentication ──

export async function buildAuthenticationOptions(args: {
  allowCredentials: StoredCredential[];
  req: { protocol: string; host: string };
}): Promise<ReturnType<typeof generateAuthenticationOptions> extends Promise<infer T> ? T : never> {
  const rp = readRpConfig(args.req);
  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: rp.rpID,
    userVerification: 'preferred',
    allowCredentials: args.allowCredentials.map((c) => ({
      id: c.credentialID,
      transports: c.transports as any,
    })),
  };
  return generateAuthenticationOptions(opts);
}

export async function completeAuthentication(args: {
  response: any; // AuthenticationResponseJSON
  expectedChallenge: string;
  credential: StoredCredential;
  req: { protocol: string; host: string };
}): Promise<{ verified: boolean; newCounter?: number }> {
  const rp = readRpConfig(args.req);
  try {
    const verification = await verifyAuthenticationResponse({
      response: args.response,
      expectedChallenge: args.expectedChallenge,
      expectedOrigin: rp.expectedOrigin,
      expectedRPID: rp.rpID,
      credential: {
        id: args.credential.credentialID,
        publicKey: Buffer.from(args.credential.publicKey, 'base64url'),
        counter: args.credential.counter,
        transports: args.credential.transports as any,
      },
      requireUserVerification: false,
    });
    if (!verification.verified) return { verified: false };
    return { verified: true, newCounter: verification.authenticationInfo.newCounter };
  } catch (err) {
    logger.warn({ err }, 'WebAuthn assertion verification failed');
    return { verified: false };
  }
}

// ── Pending challenges ──
// Short-lived store mapping a challenge to its context — either an
// enrollment in progress (personId) or an authentication in progress
// (mfaToken for the login gate). Single-use; sweep on expiry.
interface PendingChallenge {
  challenge: string;
  context: { kind: 'register'; personId: string } | { kind: 'authenticate'; personId: string };
  expiresAt: number;
}
const challenges = new Map<string, PendingChallenge>();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expiresAt < now) challenges.delete(k);
}, 60_000);
sweep.unref?.();

export function stashChallenge(challenge: string, context: PendingChallenge['context']): void {
  challenges.set(challenge, {
    challenge, context, expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

export function consumeChallenge(challenge: string): PendingChallenge | null {
  const entry = challenges.get(challenge);
  challenges.delete(challenge);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}
