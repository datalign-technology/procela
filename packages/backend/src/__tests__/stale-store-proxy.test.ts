import { describe, it } from 'node:test';
import assert from 'node:assert';

import { instrumentStaleStore } from '../lib/persistence';

// The PR 9 stale-store diagnostic wraps a loadStore array in a Proxy (in
// Postgres mode) that logs one warning on first read. The safety-critical
// property is that the Proxy stays a faithful array — anything else would
// break routes in Postgres mode. (The warning itself is logging-only.)
describe('instrumentStaleStore (PR 9 stale-read proxy)', () => {
  it('is transparent for reads: length, index, find, filter, iteration', () => {
    const p = instrumentStaleStore('t-read', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    assert.ok(Array.isArray(p));
    assert.strictEqual(p.length, 3);
    assert.strictEqual(p[1].id, 'b');
    assert.strictEqual(p.find((x) => x.id === 'c')?.id, 'c');
    assert.deepStrictEqual(p.filter((x) => x.id !== 'b').map((x) => x.id), ['a', 'c']);
    assert.deepStrictEqual([...p].map((x) => x.id), ['a', 'b', 'c']);
    assert.strictEqual(p.some((x) => x.id === 'a'), true);
  });

  it('is transparent for mutations: push, splice', () => {
    const p = instrumentStaleStore('t-mut', [1, 2, 3]);
    p.push(4);
    assert.deepStrictEqual([...p], [1, 2, 3, 4]);
    p.splice(0, 1);
    assert.deepStrictEqual([...p], [2, 3, 4]);
  });
});
