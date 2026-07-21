import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import { people, type StoredPerson } from '../routes/people';
import {
  checkLockout,
  recordFailedLogin,
  clearLockout,
  adminClearLockout,
} from '../services/account-lockout';
import { replaceArray, useStoreIsolation } from './_helpers/store-isolation';

// Tests use a controlled `people` array (snapshot/restore around the
// suite) so persistence side effects don't clobber developer data.
// THRESHOLD is hard-coded at 10 from the env default — these tests
// don't override it, they walk the boundary.

const THRESHOLD = 10;

function makePerson(overrides: Partial<StoredPerson> = {}): StoredPerson {
  const now = new Date().toISOString();
  return {
    id: 'test-person-1',
    orgIds: ['test-org-1'],
    accessibleOrgIds: ['test-org-1'],
    name: 'Test User',
    email: 'test@example.com',
    role: 'VIEWER',
    title: '',
    skillIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('account-lockout', () => {
  // Start every test with a known single-row people array. The
  // mutating helpers in account-lockout call saveStore('people',
  // people) — useStoreIsolation ensures the persisted file only
  // contains test fixtures, never real users, and swaps the row in
  // through beforeEach.
  useStoreIsolation({ file: 'people', memory: people });
  beforeEach(() => { replaceArray(people, [makePerson()]); });

  describe('checkLockout', () => {
    it('reports not-locked when lockedUntil is absent', async () => {
      const p = people[0];
      assert.deepStrictEqual(checkLockout(p), { locked: false, retryAfterSeconds: 0 });
    });

    it('reports not-locked when lockedUntil is in the past', async () => {
      const p = people[0];
      p.lockedUntil = new Date(Date.now() - 60_000).toISOString();
      assert.strictEqual(checkLockout(p).locked, false);
    });

    it('reports locked with retry-after when lockedUntil is in the future', async () => {
      const p = people[0];
      p.lockedUntil = new Date(Date.now() + 60_000).toISOString();
      const state = checkLockout(p);
      assert.strictEqual(state.locked, true);
      assert.ok(state.retryAfterSeconds > 0 && state.retryAfterSeconds <= 60);
    });

    it('reports not-locked for a non-finite lockedUntil', async () => {
      const p = people[0];
      p.lockedUntil = 'definitely-not-an-iso-date';
      assert.strictEqual(checkLockout(p).locked, false);
    });
  });

  describe('recordFailedLogin', () => {
    it('starts the counter at 1 on first failure', async () => {
      const p = people[0];
      await recordFailedLogin(p);
      assert.strictEqual(p.failedLoginCount, 1);
      assert.ok(p.failedLoginFirstAt);
      assert.strictEqual(p.lockedUntil, undefined);
    });

    it('increments the counter on subsequent failures inside the window', async () => {
      const p = people[0];
      for (let i = 0; i < 5; i++) await recordFailedLogin(p);
      assert.strictEqual(p.failedLoginCount, 5);
    });

    it('does NOT lock the account before the threshold', async () => {
      const p = people[0];
      for (let i = 0; i < THRESHOLD - 1; i++) await recordFailedLogin(p);
      assert.strictEqual(checkLockout(p).locked, false);
    });

    it('locks the account on the THRESHOLD-th failure', async () => {
      const p = people[0];
      for (let i = 0; i < THRESHOLD; i++) await recordFailedLogin(p);
      const state = checkLockout(p);
      assert.strictEqual(state.locked, true);
      assert.ok(p.lockedUntil, 'lockedUntil should be set');
      // Returned state matches checkLockout's read.
      assert.strictEqual(
        (await recordFailedLogin(p)).locked, true,
        'subsequent failure still reports locked',
      );
    });

    it('returns the resulting lockout state for the caller to surface', async () => {
      const p = people[0];
      for (let i = 0; i < THRESHOLD - 1; i++) await recordFailedLogin(p);
      const final = await recordFailedLogin(p);
      assert.strictEqual(final.locked, true);
      assert.ok(final.retryAfterSeconds > 0);
    });

    it('resets the window when the previous failure aged out', async () => {
      const p = people[0];
      // First failure happened a long time ago — older than WINDOW_MS.
      p.failedLoginCount = 5;
      p.failedLoginFirstAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      await recordFailedLogin(p);
      // Counter restarts at 1.
      assert.strictEqual(p.failedLoginCount, 1);
      // Window timestamp re-stamped to now.
      const stamp = new Date(p.failedLoginFirstAt!).getTime();
      assert.ok(Math.abs(stamp - Date.now()) < 5_000, 'firstAt should re-stamp to now');
    });
  });

  describe('clearLockout', () => {
    it('wipes the counter, window start, and lock timestamp', async () => {
      const p = people[0];
      p.failedLoginCount = 7;
      p.failedLoginFirstAt = new Date().toISOString();
      p.lockedUntil = new Date(Date.now() + 60_000).toISOString();

      await clearLockout(p);
      assert.strictEqual(p.failedLoginCount, undefined);
      assert.strictEqual(p.failedLoginFirstAt, undefined);
      assert.strictEqual(p.lockedUntil, undefined);
    });

    it('is a no-op when nothing is set (does not bump updatedAt)', async () => {
      const p = people[0];
      const updatedAtBefore = p.updatedAt;
      // Brief sleep so any spurious updatedAt write would differ.
      const t0 = Date.now();
      while (Date.now() - t0 < 2) { /* spin */ }
      await clearLockout(p);
      assert.strictEqual(p.updatedAt, updatedAtBefore);
    });
  });

  describe('adminClearLockout', () => {
    it('clears state the same way as clearLockout', async () => {
      const p = people[0];
      p.failedLoginCount = 10;
      p.failedLoginFirstAt = new Date().toISOString();
      p.lockedUntil = new Date(Date.now() + 60_000).toISOString();

      await adminClearLockout(p);
      assert.strictEqual(p.failedLoginCount, undefined);
      assert.strictEqual(p.lockedUntil, undefined);
      assert.strictEqual(checkLockout(p).locked, false);
    });
  });
});
