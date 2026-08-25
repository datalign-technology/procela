// computeDiscoveredAssetHealth — the graded freshness/liveness heuristic
// that replaces the old binary 90/60 connector health signal.

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { computeDiscoveredAssetHealth } from '../lib/asset-health';

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0); // fixed clock
const agoDays = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

describe('computeDiscoveredAssetHealth', () => {
  it('grades freshness by age since last write', () => {
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: agoDays(0.5), nowMs: NOW }), 95);
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: agoDays(3), nowMs: NOW }), 85);
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: agoDays(14), nowMs: NOW }), 70);
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: agoDays(45), nowMs: NOW }), 55);
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: agoDays(200), nowMs: NOW }), 40);
  });

  it('is monotonic — staler never scores higher than fresher', () => {
    const ages = [0, 2, 14, 45, 200];
    const scores = ages.map((d) => computeDiscoveredAssetHealth({ lastWriteAt: agoDays(d), nowMs: NOW }));
    for (let i = 1; i < scores.length; i++) assert.ok(scores[i] <= scores[i - 1]);
  });

  it('returns a neutral 50 when no write time is reported', () => {
    assert.strictEqual(computeDiscoveredAssetHealth({ nowMs: NOW }), 50);
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: null, nowMs: NOW }), 50);
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: 'not-a-date', nowMs: NOW }), 50);
  });

  it('caps an empty table low regardless of freshness', () => {
    // Written seconds ago but zero rows — still a liveness concern.
    assert.strictEqual(computeDiscoveredAssetHealth({ lastWriteAt: agoDays(0), rowCount: 0, nowMs: NOW }), 35);
  });

  it('bumps a table whose row count changed since the last scan', () => {
    const stable = computeDiscoveredAssetHealth({ lastWriteAt: agoDays(3), rowCount: 100, previousRowCount: 100, nowMs: NOW });
    const active = computeDiscoveredAssetHealth({ lastWriteAt: agoDays(3), rowCount: 120, previousRowCount: 100, nowMs: NOW });
    assert.strictEqual(stable, 85);
    assert.strictEqual(active, 90);
  });

  it('never exceeds 100 or drops below 0', () => {
    const hi = computeDiscoveredAssetHealth({ lastWriteAt: agoDays(0), rowCount: 5, previousRowCount: 1, nowMs: NOW });
    assert.ok(hi <= 100);
    const lo = computeDiscoveredAssetHealth({ lastWriteAt: agoDays(9999), rowCount: 0, nowMs: NOW });
    assert.ok(lo >= 0);
  });
});
