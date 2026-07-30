import { describe, it } from 'node:test';
import assert from 'node:assert';

import { withRetry, defaultBackoffMs } from '../retry';

const noSleep = async () => { /* skip real backoff in tests */ };

describe('retry — withRetry', () => {
  it('returns the result on the first attempt when fn succeeds', async () => {
    let calls = 0;
    const out = await withRetry(async () => { calls++; return 'ok'; }, { sleep: noSleep });
    assert.strictEqual(out, 'ok');
    assert.strictEqual(calls, 1);
  });

  it('retries a thrown error and succeeds once it recovers', async () => {
    let calls = 0, sleeps = 0;
    const out = await withRetry(
      async () => { calls++; if (calls < 3) throw new Error('blip'); return calls; },
      { maxAttempts: 5, sleep: async () => { sleeps++; } },
    );
    assert.strictEqual(out, 3, 'third attempt succeeds');
    assert.strictEqual(calls, 3);
    assert.strictEqual(sleeps, 2, 'one backoff between each failed attempt');
  });

  it('rethrows the last error after exhausting maxAttempts', async () => {
    let calls = 0, sleeps = 0;
    await assert.rejects(
      withRetry(
        async () => { calls++; throw new Error(`down ${calls}`); },
        { maxAttempts: 4, sleep: async () => { sleeps++; } },
      ),
      /down 4/,
    );
    assert.strictEqual(calls, 4, 'one call per attempt');
    assert.strictEqual(sleeps, 3, 'no backoff after the final attempt');
  });

  it('does NOT retry a resolved value (a logical failure is returned as-is)', async () => {
    let calls = 0;
    const out = await withRetry(async () => { calls++; return { success: false }; }, { sleep: noSleep });
    assert.deepStrictEqual(out, { success: false });
    assert.strictEqual(calls, 1, 'a resolved value is not a retryable error');
  });

  it('uses the injected backoff schedule', async () => {
    const delays: number[] = [];
    await withRetry(
      async () => { throw new Error('x'); },
      { maxAttempts: 4, sleep: async (ms) => { delays.push(ms); }, backoffMs: (a) => a * 10 },
    ).catch(() => { /* expected */ });
    assert.deepStrictEqual(delays, [10, 20, 30], 'backoff called with attempt-scaled delays, none after the final attempt');
  });

  it('default backoff is capped exponential (0.5s, 1s, 2s, … ≤ 30s)', () => {
    assert.strictEqual(defaultBackoffMs(1), 500);
    assert.strictEqual(defaultBackoffMs(2), 1000);
    assert.strictEqual(defaultBackoffMs(3), 2000);
    assert.strictEqual(defaultBackoffMs(20), 30_000, 'capped at 30s');
  });
});
