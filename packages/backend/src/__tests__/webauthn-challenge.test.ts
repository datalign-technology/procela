// Tests for services/webauthn.service — flagged in COVERAGE.md as
// Tier 1 (fn cov 26%). Most webauthn helpers depend on a real
// @simplewebauthn/server interaction, but the in-memory challenge
// cache (stashChallenge + consumeChallenge) is pure logic and
// straightforward to lock in.
//
// What this covers:
//   - stash → consume round-trip preserves the context payload
//   - consume is single-use (a second read after consume returns null)
//   - consume returns null for an unknown challenge
//   - an expired entry returns null even when present in the map
//     (verified by reaching into the module's clock via Date mocking)

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

import { stashChallenge, consumeChallenge } from '../services/webauthn.service';

describe('webauthn challenge cache', () => {
  it('round-trips a register context through stash + consume', () => {
    const challenge = 'chal-register-1';
    stashChallenge(challenge, { kind: 'register', personId: 'p-1' });
    const out = consumeChallenge(challenge);
    assert.ok(out, 'consume should return the stashed entry');
    assert.strictEqual(out!.challenge, challenge);
    assert.strictEqual(out!.context.kind, 'register');
    if (out!.context.kind === 'register') {
      assert.strictEqual(out!.context.personId, 'p-1');
    }
  });

  it('round-trips an authenticate context', () => {
    stashChallenge('chal-auth-1', { kind: 'authenticate', personId: 'p-2' });
    const out = consumeChallenge('chal-auth-1');
    assert.ok(out);
    assert.strictEqual(out!.context.kind, 'authenticate');
    if (out!.context.kind === 'authenticate') {
      assert.strictEqual(out!.context.personId, 'p-2');
    }
  });

  it('round-trips a discoverable (passwordless) context', () => {
    stashChallenge('chal-disc-1', { kind: 'discoverable' });
    const out = consumeChallenge('chal-disc-1');
    assert.ok(out);
    assert.strictEqual(out!.context.kind, 'discoverable');
  });

  it('returns null for an unknown challenge', () => {
    assert.strictEqual(consumeChallenge('not-stashed'), null);
  });

  it('is single-use — a second consume returns null', () => {
    stashChallenge('chal-once', { kind: 'discoverable' });
    assert.ok(consumeChallenge('chal-once'));
    assert.strictEqual(consumeChallenge('chal-once'), null);
  });

  it('returns null for an entry whose TTL has elapsed', () => {
    // CHALLENGE_TTL_MS is 5 minutes. Stash now, then push the clock
    // forward by 5 min + 1s so the consume's `expiresAt < Date.now()`
    // branch fires.
    const originalNow = Date.now;
    const t0 = originalNow();
    stashChallenge('chal-expire', { kind: 'discoverable' });
    const mockNow = mock.method(Date, 'now', () => t0 + 5 * 60 * 1000 + 1000);
    try {
      assert.strictEqual(consumeChallenge('chal-expire'), null);
    } finally {
      mockNow.mock.restore();
    }
  });
});
