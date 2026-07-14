// Per-org AI call budgeting. Cover the enforcement math (bucket
// rollover, per-hour + per-day ceilings, disabled-mode passthrough)
// and the middleware's 429 shape.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  checkAndRecord,
  statusFor,
  isEnabled,
  getConfiguredLimits,
  _resetForTesting,
  pruneStaleBuckets,
} from '../services/ai-usage';

const ORG = 'test-usage-org';

// Save + restore the env keys the module reads, so an earlier test's
// env swap doesn't leak into later cases.
const KEYS = ['AI_MAX_CALLS_PER_ORG_PER_HOUR', 'AI_MAX_CALLS_PER_ORG_PER_DAY', 'AI_COST_CONTROLS_ENABLED', 'NODE_ENV'] as const;
const savedEnv: Record<string, string | undefined> = {};

describe('ai-usage', () => {
  beforeEach(() => {
    for (const k of KEYS) savedEnv[k] = process.env[k];
    _resetForTesting();
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    _resetForTesting();
  });

  it('permits calls up to the per-hour ceiling then rejects with reason=hour', () => {
    process.env.AI_MAX_CALLS_PER_ORG_PER_HOUR = '3';
    process.env.AI_MAX_CALLS_PER_ORG_PER_DAY = '100';
    const t = Date.parse('2026-07-14T12:00:00Z');
    for (let i = 0; i < 3; i++) {
      const r = checkAndRecord(ORG, t);
      assert.strictEqual(r.allowed, true, `call ${i + 1} of 3`);
    }
    const denied = checkAndRecord(ORG, t);
    assert.strictEqual(denied.allowed, false);
    assert.strictEqual(denied.reason, 'hour');
    assert.strictEqual(denied.status.hourCount, 3);
    assert.strictEqual(denied.status.hourLimit, 3);
  });

  it('rolls the hour bucket over when the wall clock crosses the hour', () => {
    process.env.AI_MAX_CALLS_PER_ORG_PER_HOUR = '2';
    process.env.AI_MAX_CALLS_PER_ORG_PER_DAY = '100';
    const t1 = Date.parse('2026-07-14T12:30:00Z');
    assert.strictEqual(checkAndRecord(ORG, t1).allowed, true);
    assert.strictEqual(checkAndRecord(ORG, t1).allowed, true);
    assert.strictEqual(checkAndRecord(ORG, t1).allowed, false);
    // Advance past 13:00 — hour bucket rolls, day bucket keeps counting.
    const t2 = Date.parse('2026-07-14T13:00:01Z');
    const r = checkAndRecord(ORG, t2);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.status.hourCount, 1, 'hour count reset');
    assert.strictEqual(r.status.dayCount, 3, 'day count carried');
  });

  it('rejects with reason=day when the daily ceiling is hit', () => {
    process.env.AI_MAX_CALLS_PER_ORG_PER_HOUR = '100';
    process.env.AI_MAX_CALLS_PER_ORG_PER_DAY = '4';
    const t = Date.parse('2026-07-14T00:00:00Z');
    for (let i = 0; i < 4; i++) assert.strictEqual(checkAndRecord(ORG, t).allowed, true);
    const denied = checkAndRecord(ORG, t);
    assert.strictEqual(denied.allowed, false);
    assert.strictEqual(denied.reason, 'day');
  });

  it('statusFor is a read — does not increment', () => {
    const t = Date.parse('2026-07-14T00:00:00Z');
    checkAndRecord(ORG, t);
    const before = statusFor(ORG, t).hourCount;
    statusFor(ORG, t);
    statusFor(ORG, t);
    assert.strictEqual(statusFor(ORG, t).hourCount, before);
  });

  it('isEnabled defaults to production-on, dev-off; explicit env wins', () => {
    delete process.env.AI_COST_CONTROLS_ENABLED;
    process.env.NODE_ENV = 'production';
    assert.strictEqual(isEnabled(), true);
    process.env.NODE_ENV = 'development';
    assert.strictEqual(isEnabled(), false);
    process.env.AI_COST_CONTROLS_ENABLED = '1';
    assert.strictEqual(isEnabled(), true);
    process.env.AI_COST_CONTROLS_ENABLED = '0';
    process.env.NODE_ENV = 'production';
    assert.strictEqual(isEnabled(), false);
  });

  it('exposes limits from env with sensible defaults', () => {
    process.env.AI_MAX_CALLS_PER_ORG_PER_HOUR = '10';
    process.env.AI_MAX_CALLS_PER_ORG_PER_DAY = '50';
    assert.deepStrictEqual(getConfiguredLimits(), { maxCallsPerHour: 10, maxCallsPerDay: 50 });
    delete process.env.AI_MAX_CALLS_PER_ORG_PER_HOUR;
    delete process.env.AI_MAX_CALLS_PER_ORG_PER_DAY;
    assert.deepStrictEqual(getConfiguredLimits(), { maxCallsPerHour: 60, maxCallsPerDay: 500 });
  });

  it('pruneStaleBuckets drops orgs unused for >7 days', () => {
    const now = Date.parse('2026-07-14T00:00:00Z');
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    checkAndRecord('recent', now);
    checkAndRecord('ancient', eightDaysAgo);
    const pruned = pruneStaleBuckets(now);
    assert.strictEqual(pruned, 1);
    // The pruned org's next call starts a fresh counter.
    const r = checkAndRecord('ancient', now);
    assert.strictEqual(r.status.hourCount, 1);
  });
});
