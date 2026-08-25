// rollupAssetHealth — the asset-health rollup that excludes SIMULATED rule
// runs so a fabricated pass rate can't become the asset's real, app-wide
// healthScore. Returns null when there's nothing measured to base it on.

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { rollupAssetHealth } from '../services/dq-engine';

const measured = (currentScore: number, weight = 5) => ({ currentScore, weight, lastRun: { simulated: false } });
const simulated = (currentScore: number, weight = 5) => ({ currentScore, weight, lastRun: { simulated: true } });
const neverRun = (currentScore: number, weight = 5) => ({ currentScore, weight, lastRun: null });

describe('rollupAssetHealth', () => {
  it('averages measured rules by weight', () => {
    const r = rollupAssetHealth([measured(90, 1), measured(70, 3)]);
    assert.strictEqual(r.health, 75); // (90*1 + 70*3) / 4 = 75
    assert.strictEqual(r.measuredCount, 2);
    assert.strictEqual(r.simulatedCount, 0);
  });

  it('ignores simulated rules entirely — they never move health', () => {
    const r = rollupAssetHealth([measured(80, 1), simulated(100, 9)]);
    assert.strictEqual(r.health, 80); // simulated 100 excluded despite huge weight
    assert.strictEqual(r.measuredCount, 1);
    assert.strictEqual(r.simulatedCount, 1);
  });

  it('returns null when every rule is simulated (leave existing health untouched)', () => {
    const r = rollupAssetHealth([simulated(95), simulated(88)]);
    assert.strictEqual(r.health, null);
    assert.strictEqual(r.measuredCount, 0);
    assert.strictEqual(r.simulatedCount, 2);
  });

  it('returns null for rules that never ran', () => {
    assert.strictEqual(rollupAssetHealth([neverRun(90)]).health, null);
  });

  it('returns null for an empty rule set', () => {
    const r = rollupAssetHealth([]);
    assert.strictEqual(r.health, null);
    assert.strictEqual(r.simulatedCount, 0);
  });
});
