import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { isLivenessFresh, checkLiveness, writeLiveness } from '../liveness';

describe('liveness — isLivenessFresh', () => {
  const NOW = 1_000_000;
  it('is fresh within the window', () => {
    assert.strictEqual(isLivenessFresh(NOW - 5_000, NOW, 10_000), true);
    assert.strictEqual(isLivenessFresh(NOW, NOW, 10_000), true);
  });
  it('is stale past the window', () => {
    assert.strictEqual(isLivenessFresh(NOW - 20_000, NOW, 10_000), false);
  });
  it('is at the exact boundary', () => {
    assert.strictEqual(isLivenessFresh(NOW - 10_000, NOW, 10_000), true);
    assert.strictEqual(isLivenessFresh(NOW - 10_001, NOW, 10_000), false);
  });
  it('rejects a non-finite / future-skewed timestamp', () => {
    assert.strictEqual(isLivenessFresh(NaN, NOW, 10_000), false);
    // A timestamp in the future (age < 0) is treated as invalid.
    assert.strictEqual(isLivenessFresh(NOW + 5_000, NOW, 10_000), false);
  });
});

describe('liveness — checkLiveness (round-trip via a temp file)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'procela-liveness-'));
  const file = join(dir, 'alive');
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns false when the file is missing', () => {
    assert.strictEqual(checkLiveness(join(dir, 'nope'), Date.now(), 60_000), false);
  });

  it('returns true right after writeLiveness', () => {
    const now = Date.now();
    writeLiveness(file, now);
    assert.strictEqual(checkLiveness(file, now, 60_000), true);
  });

  it('returns false once the written timestamp is stale', () => {
    const now = Date.now();
    writeLiveness(file, now - 120_000);
    assert.strictEqual(checkLiveness(file, now, 60_000), false);
  });

  it('returns false on unparseable content', () => {
    writeFileSync(file, 'not-a-number', 'utf-8');
    assert.strictEqual(checkLiveness(file, Date.now(), 60_000), false);
  });
});
