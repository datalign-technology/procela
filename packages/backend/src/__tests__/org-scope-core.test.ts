import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  visibleOrgScopeIn,
  ancestorOrgIdsIn,
  ownershipLevelIn,
} from '../lib/org-scope';

// Unit coverage for the pure org-scoping core (PR 4). These operate on an
// explicit org list — the same shape the Postgres-mode cache feeds the public
// API — so they validate the cascade logic independent of the data source.
//
//   company ─┬─ divA ─┬─ deptA1
//            │        └─ deptA2
//            └─ divB
const ORGS = [
  { id: 'company', parentId: null, type: 'company' },
  { id: 'divA', parentId: 'company', type: 'division' },
  { id: 'divB', parentId: 'company', type: 'division' },
  { id: 'deptA1', parentId: 'divA', type: 'department' },
  { id: 'deptA2', parentId: 'divA', type: 'department' },
];

describe('visibleOrgScopeIn (bidirectional cascade)', () => {
  it('a division sees itself, its ancestors, and its descendants', () => {
    const scope = visibleOrgScopeIn(ORGS, 'divA');
    assert.deepStrictEqual([...scope!].sort(), ['company', 'deptA1', 'deptA2', 'divA'].sort());
    // Not the sibling division or its subtree.
    assert.strictEqual(scope!.has('divB'), false);
  });

  it('the root company sees the entire tree', () => {
    const scope = visibleOrgScopeIn(ORGS, 'company');
    assert.strictEqual(scope!.size, ORGS.length);
  });

  it('a leaf department sees only its ancestor chain (no siblings)', () => {
    const scope = visibleOrgScopeIn(ORGS, 'deptA1');
    assert.deepStrictEqual([...scope!].sort(), ['company', 'deptA1', 'divA'].sort());
    assert.strictEqual(scope!.has('deptA2'), false);
  });

  it('returns null for a falsy scope (no filter)', () => {
    assert.strictEqual(visibleOrgScopeIn(ORGS, null), null);
    assert.strictEqual(visibleOrgScopeIn(ORGS, undefined), null);
  });

  it('an empty org list still scopes to the requested org itself', () => {
    // Mirrors the cold-cache case: under-inclusive, never over-inclusive.
    const scope = visibleOrgScopeIn([], 'divA');
    assert.deepStrictEqual([...scope!], ['divA']);
  });
});

describe('ancestorOrgIdsIn (strict ancestors only)', () => {
  it('excludes the org itself and all descendants', () => {
    const anc = ancestorOrgIdsIn(ORGS, 'deptA1');
    assert.deepStrictEqual([...anc!].sort(), ['company', 'divA'].sort());
    assert.strictEqual(anc!.has('deptA1'), false);
    assert.strictEqual(anc!.has('deptA2'), false);
  });

  it('is empty for a root org', () => {
    assert.strictEqual(ancestorOrgIdsIn(ORGS, 'company')!.size, 0);
  });
});

describe('ownershipLevelIn', () => {
  it('is true only for company / division types', () => {
    assert.strictEqual(ownershipLevelIn(ORGS, 'company'), true);
    assert.strictEqual(ownershipLevelIn(ORGS, 'divA'), true);
    assert.strictEqual(ownershipLevelIn(ORGS, 'deptA1'), false);
  });

  it('is false for an unknown or falsy org id', () => {
    assert.strictEqual(ownershipLevelIn(ORGS, 'nope'), false);
    assert.strictEqual(ownershipLevelIn(ORGS, null), false);
  });
});
