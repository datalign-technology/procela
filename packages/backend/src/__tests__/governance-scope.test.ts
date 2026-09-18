// The governance-scope resolver turns a program's anchors (value streams /
// data domains / systems) into the concrete in-scope id sets by cascading down
// the catalog hierarchies. Empty anchors ⇒ null (govern everything).

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveProgramScope, computeScopeCoverage } from '../lib/governance-scope';

// A small catalog:
//   value stream vs1 → process p1 → activity a1 (runs on sysA)
//   value stream vs2 → process p2                     (unrelated)
//   domain dom1 (asset1@sysB) → sub-domain dom1a (asset2)
//   domain dom2 (asset3)                              (unrelated)
//   asset4 sits in sysA but no domain
const catalog = {
  nodes: [
    { id: 'vs1', parentId: null, systemIds: [] },
    { id: 'p1', parentId: 'vs1', systemIds: [] },
    { id: 'a1', parentId: 'p1', systemIds: ['sysA'] },
    { id: 'vs2', parentId: null, systemIds: [] },
    { id: 'p2', parentId: 'vs2', systemIds: [] },
  ],
  domains: [
    { id: 'dom1', parentDomainId: null, dataAssetIds: ['asset1'] },
    { id: 'dom1a', parentDomainId: 'dom1', dataAssetIds: ['asset2'] },
    { id: 'dom2', parentDomainId: null, dataAssetIds: ['asset3'] },
  ],
  assets: [
    { id: 'asset1', systemId: 'sysB' },
    { id: 'asset2', systemId: null },
    { id: 'asset3', systemId: null },
    { id: 'asset4', systemId: 'sysA' },
  ],
};

const sorted = (s: Set<string>) => [...s].sort();

describe('resolveProgramScope', () => {
  it('returns null when no anchors are set (govern everything)', () => {
    assert.equal(resolveProgramScope(null, catalog), null);
    assert.equal(resolveProgramScope({}, catalog), null);
    assert.equal(resolveProgramScope({ systemIds: [], domainIds: [], valueStreamIds: [] }, catalog), null);
  });

  it('cascades a value stream to its descendant process nodes', () => {
    const r = resolveProgramScope({ valueStreamIds: ['vs1'] }, catalog)!;
    assert.deepEqual(sorted(r.nodeIds), ['a1', 'p1', 'vs1']);
    // The unrelated stream is not pulled in.
    assert.ok(!r.nodeIds.has('vs2') && !r.nodeIds.has('p2'));
    // The system that a1 runs on is derived into scope…
    assert.deepEqual(sorted(r.systemIds), ['sysA']);
    // …but assets that merely sit in that system are NOT auto-pulled (bounded).
    assert.equal(r.assetIds.size, 0);
    assert.equal(r.domainIds.size, 0);
  });

  it('cascades a domain to its sub-domains and their assets', () => {
    const r = resolveProgramScope({ domainIds: ['dom1'] }, catalog)!;
    assert.deepEqual(sorted(r.domainIds), ['dom1', 'dom1a']);
    assert.deepEqual(sorted(r.assetIds), ['asset1', 'asset2']);
    // The system holding an in-scope asset is derived into scope.
    assert.deepEqual(sorted(r.systemIds), ['sysB']);
    assert.equal(r.nodeIds.size, 0);
  });

  it('anchors a system to its assets and the nodes that run on it', () => {
    const r = resolveProgramScope({ systemIds: ['sysA'] }, catalog)!;
    assert.deepEqual(sorted(r.systemIds), ['sysA']);
    assert.deepEqual(sorted(r.assetIds), ['asset4']);
    assert.deepEqual(sorted(r.nodeIds), ['a1']);
    assert.equal(r.domainIds.size, 0);
  });

  it('unions across anchor types and ignores unknown / blank ids', () => {
    const r = resolveProgramScope({ valueStreamIds: ['vs1', 'nope', ''], domainIds: ['dom2'] }, catalog)!;
    assert.ok(r.nodeIds.has('a1'));
    assert.deepEqual(sorted(r.domainIds), ['dom2']);
    assert.deepEqual(sorted(r.assetIds), ['asset3']);
  });
});

describe('computeScopeCoverage', () => {
  // Scope the domain dom1 → assets asset1, asset2 are in scope.
  const resolved = resolveProgramScope({ domainIds: ['dom1'] }, catalog)!;

  it('reports mapped / governed / owned share of in-scope assets', () => {
    const assets = [
      { id: 'asset1', governanceTier: 'GOLD', ownerPersonId: 'p1' },   // governed + owned
      { id: 'asset2', governanceTier: 'BRONZE', owner: null },          // neither
      { id: 'asset4', governanceTier: 'GOLD', ownerPersonId: 'p9' },   // out of scope — ignored
    ];
    const mappedAssetIds = new Set(['asset1']); // asset1 mapped, asset2 not
    const c = computeScopeCoverage(resolved, { assets, mappedAssetIds });
    assert.equal(c.assets, 2, 'only the two in-scope assets count');
    assert.deepEqual(c.mapped, { covered: 1, total: 2, pct: 50 });
    assert.deepEqual(c.governed, { covered: 1, total: 2, pct: 50 });
    assert.deepEqual(c.owned, { covered: 1, total: 2, pct: 50 });
  });

  it('is zero-safe when no in-scope assets carry the trait', () => {
    const c = computeScopeCoverage(resolved, { assets: [], mappedAssetIds: new Set() });
    assert.deepEqual(c, {
      assets: 0,
      mapped: { covered: 0, total: 0, pct: 0 },
      governed: { covered: 0, total: 0, pct: 0 },
      owned: { covered: 0, total: 0, pct: 0 },
    });
  });
});
