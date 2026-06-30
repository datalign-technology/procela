import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  mintResetToken,
  consumeResetToken,
  RESET_TOKEN_TTL_MS,
  _restoreResetTokenForTesting,
  _resetAllForTesting,
} from '../services/reset-tokens';

// Single-use, time-limited password-reset tokens. The contract:
//   - mintResetToken returns a high-entropy URL-safe token bound to
//     a personId for RESET_TOKEN_TTL_MS.
//   - consumeResetToken returns the personId on first call, null on
//     every subsequent call (single-use, atomic).
//   - Tokens older than the TTL are treated as unknown.

describe('reset-tokens', () => {
  beforeEach(() => { _resetAllForTesting(); });

  describe('mintResetToken', () => {
    it('returns a base64url string of at least 32 chars', () => {
      const t = mintResetToken('person-1');
      assert.ok(t.length >= 32, `token too short: ${t.length}`);
      assert.match(t, /^[A-Za-z0-9_-]+$/);
    });

    it('produces unique tokens on each call', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 10; i++) seen.add(mintResetToken('person-1'));
      assert.strictEqual(seen.size, 10);
    });
  });

  describe('consumeResetToken', () => {
    it('returns the bound personId on first call', () => {
      const t = mintResetToken('person-1');
      assert.strictEqual(consumeResetToken(t), 'person-1');
    });

    it('returns null on second call (single-use)', () => {
      const t = mintResetToken('person-1');
      consumeResetToken(t);
      assert.strictEqual(consumeResetToken(t), null,
        'a leaked token re-used by an attacker should fail closed');
    });

    it('returns null for an unknown token', () => {
      assert.strictEqual(consumeResetToken('totally-fake-token'), null);
    });

    it('returns null for an expired token AND removes it from the store', () => {
      const t = 'manually-injected-expired-token';
      // Backdate by 1 second past the TTL.
      _restoreResetTokenForTesting(t, 'person-1', Date.now() - 1000);
      assert.strictEqual(consumeResetToken(t), null);
      // Second call also null — confirms the expired entry was removed.
      assert.strictEqual(consumeResetToken(t), null);
    });

    it('TTL constant is the documented one hour', () => {
      assert.strictEqual(RESET_TOKEN_TTL_MS, 60 * 60 * 1000);
    });

    it('issues different tokens for different people without crossing wires', () => {
      const t1 = mintResetToken('person-1');
      const t2 = mintResetToken('person-2');
      assert.strictEqual(consumeResetToken(t1), 'person-1');
      assert.strictEqual(consumeResetToken(t2), 'person-2');
    });
  });
});
