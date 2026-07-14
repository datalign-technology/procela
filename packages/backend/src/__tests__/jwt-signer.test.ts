// jwt-signer — HS256 fallback, RS256 upgrade, JWKS shape.
//
// Cover:
//   1. Default mode (no PEMs configured) signs + verifies HS256 and
//      returns no JWKS.
//   2. When JWT_PRIVATE_KEY + JWT_PUBLIC_KEY are set, we sign RS256
//      and publish a JWKS that a third party could use to verify.
//   3. A token signed under one algorithm doesn't verify under the
//      other — the algo header is honoured, not sniffed.
//   4. Explicit JWT_ALGORITHM=HS256 with PEMs still present forces
//      HS256 (rotation safety valve).
//   5. Explicit JWT_ALGORITHM=RS256 without PEMs throws at init
//      instead of silently downgrading.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';

// Grab keys once — RSA gen is slow (~30ms).
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Snapshot + restore the env keys the signer reads. tsx --test runs
// each file in its own worker so the module cache is per-file, but
// we still reset the memoised state between cases via
// `_resetForTesting` so each test's env swap actually takes effect.
const KEYS = ['JWT_ALGORITHM', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'JWT_KID', 'JWT_SECRET'] as const;
const savedEnv: Record<string, string | undefined> = {};

describe('jwt-signer', () => {
  before(() => {
    for (const k of KEYS) savedEnv[k] = process.env[k];
  });
  after(() => {
    for (const k of KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
    // A minimal secret so HS256 mode has something to sign with.
    process.env.JWT_SECRET = 'test-secret-not-the-default';
    // Force config module to be re-read on each require by clearing
    // its cache entry. jwt-signer imports config eagerly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('../services/jwt-signer')];
  });

  it('defaults to HS256 when no PEMs are configured; JWKS is absent', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');
    const token = signer.sign({ sub: 'u1' }, { expiresIn: '5m' });
    const decoded = signer.verify<{ sub: string }>(token);
    assert.strictEqual(decoded.sub, 'u1');
    assert.strictEqual(signer.currentAlgorithm(), 'HS256');
    assert.strictEqual(signer.getJwks(), null);
  });

  it('upgrades to RS256 when both PEMs are set and publishes a JWKS', () => {
    process.env.JWT_PRIVATE_KEY = privateKey;
    process.env.JWT_PUBLIC_KEY = publicKey;
    process.env.JWT_KID = 'test-kid-1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');

    assert.strictEqual(signer.currentAlgorithm(), 'RS256');
    const jwks = signer.getJwks();
    assert.ok(jwks, 'JWKS should be present');
    assert.strictEqual(jwks.keys.length, 1);
    const key = jwks.keys[0] as Record<string, string>;
    assert.strictEqual(key.kid, 'test-kid-1');
    assert.strictEqual(key.alg, 'RS256');
    assert.strictEqual(key.use, 'sig');
    assert.strictEqual(key.kty, 'RSA');

    // Round-trip through the signer, and independently verify with
    // the published public key — mirrors what a downstream service
    // would do with the JWKS.
    const token = signer.sign({ sub: 'u2' }, { expiresIn: '5m' });
    const decodedBySigner = signer.verify<{ sub: string }>(token);
    assert.strictEqual(decodedBySigner.sub, 'u2');
    const decodedByPub = jwt.verify(token, publicKey) as { sub: string };
    assert.strictEqual(decodedByPub.sub, 'u2');
  });

  it('carries the kid in the JWT header when signing RS256', () => {
    process.env.JWT_PRIVATE_KEY = privateKey;
    process.env.JWT_PUBLIC_KEY = publicKey;
    process.env.JWT_KID = 'kid-hdr-check';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');
    const token = signer.sign({ sub: 'u3' }, { expiresIn: '5m' });
    const decoded = jwt.decode(token, { complete: true }) as { header: { kid?: string; alg?: string } };
    assert.strictEqual(decoded.header.kid, 'kid-hdr-check');
    assert.strictEqual(decoded.header.alg, 'RS256');
  });

  it('a token signed under HS256 does not verify under RS256 (and vice versa)', () => {
    // First: sign HS256.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');
    const hsToken = signer.sign({ sub: 'u4' }, { expiresIn: '5m' });

    // Now flip to RS256 by re-requiring with PEMs set.
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('../services/jwt-signer')];
    process.env.JWT_PRIVATE_KEY = privateKey;
    process.env.JWT_PUBLIC_KEY = publicKey;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');
    assert.strictEqual(signer.currentAlgorithm(), 'RS256');

    // RS256 signer refuses to verify the HS256 token.
    assert.throws(() => signer.verify(hsToken));

    // The reverse: sign an RS256 token, flip to HS256, verify fails.
    const rsToken = signer.sign({ sub: 'u5' }, { expiresIn: '5m' });
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('../services/jwt-signer')];
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');
    assert.strictEqual(signer.currentAlgorithm(), 'HS256');
    assert.throws(() => signer.verify(rsToken));
  });

  it('explicit JWT_ALGORITHM=HS256 wins over an available PEM pair', () => {
    process.env.JWT_ALGORITHM = 'HS256';
    process.env.JWT_PRIVATE_KEY = privateKey;
    process.env.JWT_PUBLIC_KEY = publicKey;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');
    assert.strictEqual(signer.currentAlgorithm(), 'HS256');
    assert.strictEqual(signer.getJwks(), null);
  });

  it('explicit JWT_ALGORITHM=RS256 without PEMs throws at init', () => {
    process.env.JWT_ALGORITHM = 'RS256';
    assert.throws(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const signer = require('../services/jwt-signer') as typeof import('../services/jwt-signer');
        signer.currentAlgorithm();
      },
      /JWT_ALGORITHM=RS256 requires JWT_PRIVATE_KEY/,
    );
  });
});
