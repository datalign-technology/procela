// Read-only MCP tools — logic, org-authorization, RBAC floor, and audit, tested
// with an injected fake session + fake catalog (no live store needed).

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { buildTools } from '../mcp/tools';
import type { Session } from '../mcp/identity';
import type { OrgCatalog, ResolvedScopeLike } from '../mcp/catalog';
import { McpError, RPC } from '../mcp/protocol';

// ── Fakes ──────────────────────────────────────────────────────────────────
function makeSession() {
  const audited: Array<{ orgId: string; tool: string }> = [];
  let denyOrg: string | null = null;
  let denyPerm: string | null = null;
  const session: Session = {
    user: { sub: 'u1', email: 'a@b.c', orgId: 'org1', role: 'VIEWER' } as Session['user'],
    defaultOrgId: 'org1',
    resolveOrg(arg) {
      const o = typeof arg === 'string' && arg.trim() ? arg.trim() : 'org1';
      if (denyOrg && o === denyOrg) throw new McpError('Not found.', RPC.INVALID_PARAMS);
      return o;
    },
    assertRead(p) { if (denyPerm && p === denyPerm) throw new McpError('denied', RPC.INVALID_REQUEST); },
    assertWrite(p) { if (denyPerm && p === denyPerm) throw new McpError('denied', RPC.INVALID_REQUEST); },
    audit(orgId, tool) { audited.push({ orgId, tool }); },
    auditWrite(orgId, _entityType, _entityId, action) { audited.push({ orgId, tool: action }); },
  };
  return { session, audited, denyOrgFn: (o: string) => { denyOrg = o; }, denyPermFn: (p: string) => { denyPerm = p; } };
}

function fakeCatalog(): OrgCatalog {
  const names: Record<string, string> = { patOwner: 'Pat Owner', xOwner: 'Xavier Own', steward1: 'Sam Steward' };
  const cat = {
    orgId: 'org1',
    nodes: [
      { id: 'vs1', parentId: null, level: 'VALUE_STREAM', name: 'Water Distribution', status: 'ACTIVE', orderIndex: 0, ownerId: 'patOwner' },
      { id: 'p1', parentId: 'vs1', level: 'PROCESS', name: 'Treatment', status: 'DRAFT', orderIndex: 0, ownerId: null },
      { id: 'a1', parentId: 'p1', level: 'ACTIVITY', name: 'Dose chemicals', status: 'DRAFT', orderIndex: 0, ownerId: null },
      { id: 'a2', parentId: 'p1', level: 'ACTIVITY', name: 'Log readings', status: 'DRAFT', orderIndex: 1, ownerId: null },
    ],
    assets: [
      { id: 'as1', name: 'Customer Master', governanceTier: 'GOLD', ownerPersonId: 'xOwner', stewardIds: ['steward1'], healthScore: 90, systemId: 'sy1' },
      { id: 'as2', name: 'Legacy Billing', governanceTier: 'BRONZE', ownerPersonId: null, stewardIds: [], healthScore: 40, systemId: 'sy1' },
    ],
    systems: [{ id: 'sy1', name: 'CIS', ownerPersonId: 'patOwner' }],
    domains: [{ id: 'dm1', name: 'Customer Data', ownerId: 'xOwner', stewardIds: ['steward1'], dataAssetIds: ['as1'] }],
    mappings: [{ id: 'm1', processStepId: 'a1', dataAssetId: 'as1' }],
    nameOf: (id: string | null | undefined) => (id ? names[id] ?? null : null),
    healthOf: (a: { id: string; healthScore: number }) => ({ score: a.healthScore, measured: a.id === 'as1' }),
  };
  return cat as unknown as OrgCatalog;
}

function tools(scope: ResolvedScopeLike | null = null) {
  const { session, audited, denyOrgFn, denyPermFn } = makeSession();
  const list = buildTools({ session, loadCatalog: async () => fakeCatalog(), resolveScope: async () => scope });
  const byName = Object.fromEntries(list.map((t) => [t.name, t]));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await byName[name].handler(args);
    return { res, data: JSON.parse(res.content[0].text) };
  };
  return { byName, call, audited, denyOrgFn, denyPermFn };
}

// ── Tests ────────────────────────────────────────────────────────────────
describe('read-only MCP tools', () => {
  it('registers the expected v1 tool set', () => {
    const names = tools().byName;
    assert.deepStrictEqual(Object.keys(names).sort(), [
      'asset_health', 'find_processes_using_asset', 'get_owner', 'governance_scope',
      'list_gaps', 'list_value_streams', 'search_catalog',
    ]);
  });

  it('list_value_streams returns a nested hierarchy with owners, and audits', async () => {
    const t = tools();
    const { data } = await t.call('list_value_streams');
    assert.strictEqual(data.valueStreams[0].name, 'Water Distribution');
    assert.strictEqual(data.valueStreams[0].owner, 'Pat Owner');
    assert.strictEqual(data.valueStreams[0].children[0].name, 'Treatment');
    assert.strictEqual(data.valueStreams[0].children[0].children.length, 2);
    assert.deepStrictEqual(t.audited, [{ orgId: 'org1', tool: 'list_value_streams' }]);
  });

  it('find_processes_using_asset resolves by name and returns the activity path', async () => {
    const { data } = await tools().call('find_processes_using_asset', { assetName: 'customer master' });
    assert.strictEqual(data.asset.id, 'as1');
    assert.strictEqual(data.usedBy.count, 1);
    assert.strictEqual(data.usedBy.items[0].activity.name, 'Dose chemicals');
    assert.deepStrictEqual(data.usedBy.items[0].path, ['Water Distribution', 'Treatment', 'Dose chemicals']);
  });

  it('find_processes_using_asset with no match errors', async () => {
    await assert.rejects(() => tools().call('find_processes_using_asset', { assetName: 'nope' }), /No matching data asset/);
  });

  it('get_owner returns owner + stewards for an asset', async () => {
    const { data } = await tools().call('get_owner', { entityType: 'asset', entityId: 'as1' });
    assert.strictEqual(data.owner.name, 'Xavier Own');
    assert.strictEqual(data.stewards[0].name, 'Sam Steward');
  });

  it('list_gaps computes the right buckets', async () => {
    const { data } = await tools().call('list_gaps');
    assert.deepStrictEqual(data.unmappedActivities.items.map((x: { name: string }) => x.name), ['Log readings']);
    assert.deepStrictEqual(data.ownerlessProcesses.items.map((x: { name: string }) => x.name), ['Treatment']);
    assert.deepStrictEqual(data.orphanAssets.items.map((x: { name: string }) => x.name), ['Legacy Billing']);
    assert.deepStrictEqual(data.ownerlessDomains.items, []);
  });

  it('list_gaps can return a single kind', async () => {
    const { data } = await tools().call('list_gaps', { kind: 'orphanAssets' });
    assert.ok(data.orphanAssets);
    assert.strictEqual(data.unmappedActivities, undefined);
  });

  it('asset_health returns null (not fabricated) when unmeasured', async () => {
    const { data } = await tools().call('asset_health', { assetId: 'as2' });
    assert.strictEqual(data.tier, 'BRONZE');
    assert.strictEqual(data.health, null);
    assert.strictEqual(data.measured, false);
  });

  it('governance_scope with no scope reports the whole catalog governed', async () => {
    const { data } = await tools(null).call('governance_scope');
    assert.strictEqual(data.scopeDefined, false);
    assert.strictEqual(data.governed.assets, 2);
    assert.strictEqual(data.governed.valueStreams, 1);
  });

  it('governance_scope with a scope splits governed vs connected-not-governed', async () => {
    const scope = { nodeIds: new Set(['vs1']), domainIds: new Set(['dm1']), assetIds: new Set(['as1']), systemIds: new Set(['sy1']) };
    const { data } = await tools(scope).call('governance_scope');
    assert.strictEqual(data.scopeDefined, true);
    assert.strictEqual(data.governed.assets.items[0].name, 'Customer Master');
    assert.strictEqual(data.connectedNotGoverned.assets.items[0].name, 'Legacy Billing');
  });

  it('search_catalog matches by name across types', async () => {
    const { data } = await tools().call('search_catalog', { query: 'billing' });
    assert.strictEqual(data.results.items[0].type, 'asset');
    assert.strictEqual(data.results.items[0].name, 'Legacy Billing');
  });

  // ── Isolation & RBAC ──────────────────────────────────────────────────
  it('a cross-tenant orgId is refused as not-found (never revealed)', async () => {
    const t = tools();
    t.denyOrgFn('org2');
    await assert.rejects(() => t.call('list_value_streams', { orgId: 'org2' }), (e: Error) => {
      assert.match(e.message, /Not found/);
      return true;
    });
  });

  it('a role without the read permission is refused', async () => {
    const t = tools();
    t.denyPermFn('process:read');
    await assert.rejects(() => t.call('list_value_streams'), /cannot|denied/);
  });
});
