// Audit-log durability — the retry policy behind the Postgres append
// queue. persistAuditEntryWithRetry is exported with injectable create +
// sleep so the backoff/retry behaviour is unit-testable without a real
// database or real timers.

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { persistAuditEntryWithRetry, type AuditLogEntry } from '../services/audit.service';

const entry: AuditLogEntry = {
  id: 'test-entry-1',
  orgId: 'org-1',
  userId: 'user-1',
  entityType: 'Person',
  entityId: 'p1',
  action: 'CREATE',
  before: null,
  after: null,
  timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  prevHash: '',
  entryHash: 'abc',
};

const noSleep = async () => { /* skip real backoff in tests */ };

describe('audit durability — persistAuditEntryWithRetry', () => {
  it('persists on the first attempt when the write succeeds', async () => {
    let calls = 0;
    const ok = await persistAuditEntryWithRetry(async () => { calls++; }, entry, { sleep: noSleep });
    assert.strictEqual(ok, true);
    assert.strictEqual(calls, 1, 'should not retry a successful write');
  });

  it('retries on transient failure and succeeds once the write recovers', async () => {
    let calls = 0;
    let sleeps = 0;
    const ok = await persistAuditEntryWithRetry(
      async () => { calls++; if (calls < 3) throw new Error('transient db blip'); },
      entry,
      { maxAttempts: 6, sleep: async () => { sleeps++; } },
    );
    assert.strictEqual(ok, true, 'should eventually succeed');
    assert.strictEqual(calls, 3, 'two failures then a success');
    assert.strictEqual(sleeps, 2, 'one backoff between each failed attempt');
  });

  it('gives up after maxAttempts when the write never recovers', async () => {
    let calls = 0;
    let sleeps = 0;
    const ok = await persistAuditEntryWithRetry(
      async () => { calls++; throw new Error('db permanently down'); },
      entry,
      { maxAttempts: 4, sleep: async () => { sleeps++; } },
    );
    assert.strictEqual(ok, false, 'should report failure after exhausting retries');
    assert.strictEqual(calls, 4, 'one call per attempt');
    assert.strictEqual(sleeps, 3, 'a backoff between attempts, none after the last');
  });

  it('uses the injected backoff schedule (capped exponential by default is overridable)', async () => {
    const delays: number[] = [];
    await persistAuditEntryWithRetry(
      async () => { throw new Error('down'); },
      entry,
      { maxAttempts: 4, sleep: async (ms) => { delays.push(ms); }, backoffMs: (a) => a * 10 },
    );
    assert.deepStrictEqual(delays, [10, 20, 30], 'backoff called with attempt-scaled delays, none after final attempt');
  });
});
