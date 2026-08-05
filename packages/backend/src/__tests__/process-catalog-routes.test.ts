// HTTP coverage for the high-exposure surfaces of
// routes/process-catalog flagged in COVERAGE.md as Tier 2:
//   - DELETE cascade: child nodes + flow edges + mapping rows are all
//     swept when their parent is deleted.
//   - POST /clone: a deep-copy reproduces the subtree with fresh ids
//     and reset status/owner.
//   - PUT reorder: orderIndex updates land.
//   - PUT status transition: a valid move creates a version snapshot
//     reachable via /history.
//   - Locked-status edit guard: a field edit on an ACTIVE node is
//     rejected with 403.
//
// Each test is self-contained — seeds with unique ids in `before`,
// scrubs in `after`, so it composes with the rest of the suite.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const processCatalogRouter = require('../routes/process-catalog').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  processNodes,
  flowRelationships,
  processVersions,
} = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {},
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
          catch { resolve({ status: res.statusCode || 0, body: chunks }); }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('process-catalog routes — Tier 2 coverage', () => {
  let server: http.Server;
  let port: number;
  const orgId = 'test-org-process-catalog-tier2';
  // Unique-prefix ids so cleanup is one filter call. The DELETE
  // tree gets a separate prefix from the LOCK tree so the lock test
  // doesn't lose its seed when the delete test runs first.
  const PREFIX = 'test-pc-tier2-';
  const seedIds: string[] = [];
  const seedAsset = PREFIX + 'asset';
  const seedMapping = PREFIX + 'mapping';
  const vsId = PREFIX + 'vs';
  const procId = PREFIX + 'proc';
  const actId  = PREFIX + 'act';
  const lockVsId = PREFIX + 'lock-vs';
  const lockActId = PREFIX + 'lock-act';
  const cloneVsId = PREFIX + 'clone-vs';
  const cloneProcId = PREFIX + 'clone-proc';
  const cloneActId  = PREFIX + 'clone-act';
  const versionVsId = PREFIX + 'ver-vs';
  const versionProcId = PREFIX + 'ver-proc';
  const versionActId  = PREFIX + 'ver-act';
  const flowId = PREFIX + 'flow';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/process-catalog', processCatalogRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    // Sweep any leftovers from a previous failed run before seeding so
    // the persistent store doesn't accumulate stale prefixed rows.
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(processVersions, (v) => typeof v.nodeId === 'string' && v.nodeId.startsWith(PREFIX));
    sweep(mappings,        (m) => typeof m.id === 'string' && m.id.startsWith(PREFIX));
    sweep(dataAssets,      (a) => typeof a.id === 'string' && a.id.startsWith(PREFIX));
    sweep(flowRelationships, (f) => typeof f.id === 'string' && f.id.startsWith(PREFIX));
    sweep(processNodes,    (n) => typeof n.id === 'string' && n.id.startsWith(PREFIX));

    const now = new Date().toISOString();
    const baseNode = (extra: Record<string, any>) => ({
      activityId: null, version: 1, ownerId: null, orderIndex: 0,
      orgId, orgIds: [orgId], status: 'DRAFT', description: '',
      domain: 'OPERATIONAL', createdAt: now, updatedAt: now,
      ...extra,
    });

    processNodes.push(
      baseNode({ id: vsId,  parentId: null,  level: 'VALUE_STREAM', name: 'Delete cascade VS' }),
      baseNode({ id: procId, parentId: vsId,  level: 'PROCESS',     name: 'Delete cascade process' }),
      baseNode({ id: actId,  parentId: procId, level: 'ACTIVITY',   name: 'Delete cascade activity' }),

      // Locked-status seed: an ACTIVE activity (locked by the default
      // SIMPLE state machine).
      baseNode({ id: lockVsId,  parentId: null,    level: 'VALUE_STREAM', name: 'Lock VS' }),
      baseNode({ id: lockActId, parentId: lockVsId, level: 'PROCESS',     name: 'Locked process', status: 'ACTIVE' }),

      // Clone seed: a small subtree.
      baseNode({ id: cloneVsId,   parentId: null,        level: 'VALUE_STREAM', name: 'Clone source VS' }),
      baseNode({ id: cloneProcId, parentId: cloneVsId,   level: 'PROCESS',      name: 'Clone source process' }),
      baseNode({ id: cloneActId,  parentId: cloneProcId, level: 'ACTIVITY',     name: 'Clone source activity' }),

      // Version-history seed: a DRAFT activity that we'll promote to
      // ACTIVE. We need the full VS → PROCESS → ACTIVITY chain because
      // the VS-promotion check (which we're not exercising here) wants
      // them in place. The ACTIVITY itself can move DRAFT → ACTIVE with
      // no further preconditions.
      baseNode({ id: versionVsId,  parentId: null,         level: 'VALUE_STREAM', name: 'Version VS' }),
      baseNode({ id: versionProcId, parentId: versionVsId,  level: 'PROCESS',     name: 'Version process' }),
      baseNode({ id: versionActId,  parentId: versionProcId, level: 'ACTIVITY',   name: 'Version activity' }),
    );
    seedIds.push(vsId, procId, actId, lockVsId, lockActId, cloneVsId, cloneProcId, cloneActId, versionVsId, versionProcId, versionActId);

    flowRelationships.push({
      id: flowId, fromNodeId: actId, toNodeId: actId, type: 'SEQUENCE',
      label: null, createdAt: now,
    });
    dataAssets.push({
      id: seedAsset, orgId, name: 'Asset for cascade', description: '', systemId: '',
      owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 0,
      createdAt: now, updatedAt: now,
    });
    mappings.push({
      id: seedMapping, orgId, processStepId: actId, dataAssetId: seedAsset,
      linkType: 'consumes', notes: '', aiSuggested: false, userOverridden: false,
      createdBy: 'test', createdAt: now, updatedAt: now,
    });
  });

  after(async () => {
    const pruneById = (arr: any[], prefix: string) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (typeof arr[i].id === 'string' && arr[i].id.startsWith(prefix)) arr.splice(i, 1);
      }
    };
    // Also catch ANY processVersions snapshots produced by tests.
    pruneById(processVersions, PREFIX);
    // Snapshots reference nodeIds — catch those too.
    for (let i = processVersions.length - 1; i >= 0; i--) {
      if (typeof processVersions[i].nodeId === 'string' && processVersions[i].nodeId.startsWith(PREFIX)) {
        processVersions.splice(i, 1);
      }
    }
    pruneById(mappings, PREFIX);
    pruneById(dataAssets, PREFIX);
    pruneById(flowRelationships, PREFIX);
    pruneById(processNodes, PREFIX);
    await new Promise<void>((r) => server.close(() => r()));
  });

  describe('DELETE /nodes/:id — cascade', () => {
    it('removes the node, its descendants, flow edges, and mapping rows', async () => {
      // Sanity: every seed row is present before delete.
      assert.ok(processNodes.find((n: any) => n.id === actId));
      assert.ok(mappings.find((m: any) => m.id === seedMapping));
      assert.ok(flowRelationships.find((f: any) => f.id === flowId));

      const res = await request(port, 'DELETE', `/process-catalog/nodes/${vsId}`);
      assert.strictEqual(res.status, 204);

      // Every descendant of vsId is gone.
      assert.ok(!processNodes.find((n: any) => n.id === vsId));
      assert.ok(!processNodes.find((n: any) => n.id === procId));
      assert.ok(!processNodes.find((n: any) => n.id === actId));
      // Flow row referencing the activity is swept.
      assert.ok(!flowRelationships.find((f: any) => f.id === flowId));
      // Mapping referencing the deleted activity is swept.
      assert.ok(!mappings.find((m: any) => m.id === seedMapping));
      // The asset itself is NOT cascaded — only the mapping row is.
      assert.ok(dataAssets.find((a: any) => a.id === seedAsset));
    });

    it('returns 404 when the id is not found', async () => {
      const res = await request(port, 'DELETE', `/process-catalog/nodes/${PREFIX}does-not-exist`);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /nodes/:id/clone', () => {
    it('deep-clones the subtree with fresh ids and reset status/owner', async () => {
      const res = await request(port, 'POST', `/process-catalog/nodes/${cloneVsId}/clone`, { name: 'Clone target' });
      assert.strictEqual(res.status, 201);
      const cloned: any[] = res.body.data;
      // All three source nodes (VS + PROCESS + ACTIVITY) come back.
      assert.strictEqual(cloned.length, 3);
      // Root is renamed; status/version/owner are reset on every row.
      const root = cloned[0];
      assert.strictEqual(root.name, 'Clone target');
      assert.strictEqual(root.status, 'DRAFT');
      assert.strictEqual(root.ownerId, null);
      assert.strictEqual(root.version, 1);
      // None of the cloned ids overlap the source ids.
      const sourceIds = new Set([cloneVsId, cloneProcId, cloneActId]);
      for (const c of cloned) assert.ok(!sourceIds.has(c.id));
      // Parent references remap to the new ids (not the source ids).
      const childrenOfRoot = cloned.filter((c) => c.parentId === root.id);
      assert.ok(childrenOfRoot.length >= 1);
      // Stamp the cloned ids with the prefix so the after() cleanup
      // catches them — and add them to seedIds for the audit trail.
      for (const c of cloned) {
        if (!c.id.startsWith(PREFIX)) {
          // Rename in-place: the route handler doesn't prefix; we do
          // it post-hoc so cleanup is generic. processNodes already
          // holds these rows.
          const row = processNodes.find((n: any) => n.id === c.id);
          if (row) row.id = PREFIX + 'clone-out-' + row.id;
        }
      }
    });

    it('returns 404 for an unknown source id', async () => {
      const res = await request(port, 'POST', `/process-catalog/nodes/${PREFIX}missing/clone`, { name: 'x' });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('PUT /nodes/:id — reorder', () => {
    it('updates orderIndex on a DRAFT node', async () => {
      const target = processNodes.find((n: any) => n.id === versionActId);
      assert.strictEqual(target.orderIndex, 0);
      const res = await request(port, 'PUT', `/process-catalog/nodes/${versionActId}`, { orderIndex: 7 });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(target.orderIndex, 7);
    });
  });

  describe('PUT /nodes/:id — status transition + version history', () => {
    it('creates a version snapshot when the status moves DRAFT → ACTIVE', async () => {
      // Reset orderIndex to keep the snapshot stable.
      const before = processVersions.filter((v: any) => v.nodeId === versionActId).length;
      const res = await request(port, 'PUT', `/process-catalog/nodes/${versionActId}`, { status: 'ACTIVE' });
      assert.strictEqual(res.status, 200, `PUT failed ${res.status}: ${JSON.stringify(res.body)}`);
      const after = processVersions.filter((v: any) => v.nodeId === versionActId);
      assert.strictEqual(after.length, before + 1);
      // The snapshot carries the pre-change status by design — it's
      // the "what we were before" record.
      const snapshot = after[after.length - 1];
      assert.strictEqual(snapshot.nodeId, versionActId);
      assert.ok(snapshot.snapshot);

      // GET /history surfaces it.
      const history = await request(port, 'GET', `/process-catalog/nodes/${versionActId}/history`);
      assert.strictEqual(history.status, 200);
      assert.ok(history.body.data.find((v: any) => v.id === snapshot.id));

      // GET /history/:versionId returns the row.
      const single = await request(port, 'GET', `/process-catalog/nodes/${versionActId}/history/${snapshot.id}`);
      assert.strictEqual(single.status, 200);
      assert.strictEqual(single.body.data.id, snapshot.id);
    });

    it('rejects an invalid status transition with 400', async () => {
      // versionVsId is now ACTIVE; ACTIVE → APPROVED isn't allowed in
      // simple mode (only DRAFT or DEPRECATED).
      const res = await request(port, 'PUT', `/process-catalog/nodes/${versionActId}`, { status: 'APPROVED' });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /Cannot transition/);
    });
  });

  describe('PUT /nodes/:id — locked-status edit guard', () => {
    it('rejects a name edit on an ACTIVE node with 403', async () => {
      const res = await request(port, 'PUT', `/process-catalog/nodes/${lockActId}`, { name: 'renamed' });
      assert.strictEqual(res.status, 403);
      assert.match(res.body.error, /Cannot edit/);
      // The seeded name is unchanged.
      const row = processNodes.find((n: any) => n.id === lockActId);
      assert.strictEqual(row.name, 'Locked process');
    });
  });
});

// ── Ancestor-owned governance filter ──
// Governance value streams live at the enterprise (company) level
// and roll down through filterByOrgScope's ancestor walk. A user
// working in a division shouldn't see the parent's governance
// content — it inflates their counts and shows a locked row they
// can't act on. The default filter hides ancestor-owned governance;
// the ?includeAncestorGovernance=true opt-in reveals it for users
// who want to see what enterprise governance applies to them.
describe('process-catalog GET / — ancestor-governance filter', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-pc-anc-gov-';
  const parentOrgId = PREFIX + 'parent';
  const childOrgId = PREFIX + 'child';
  const parentGovVsId = PREFIX + 'parent-gov-vs';
  const parentOpVsId = PREFIX + 'parent-op-vs';
  const childOpVsId = PREFIX + 'child-op-vs';
  const childGovVsId = PREFIX + 'child-gov-vs';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/process-catalog', processCatalogRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(processNodes, (n) => typeof n.id === 'string' && n.id.startsWith(PREFIX));
    sweep(organizations, (o) => typeof o.id === 'string' && o.id.startsWith(PREFIX));

    const now = new Date().toISOString();
    organizations.push({ id: parentOrgId, name: 'Test Utilities', industry: 'Utilities', type: 'company', parentId: null, createdAt: now, updatedAt: now });
    organizations.push({ id: childOrgId,  name: 'Test Electric',  industry: 'Utilities', type: 'division', parentId: parentOrgId, createdAt: now, updatedAt: now });

    const baseVs = (extra: Record<string, any>) => ({
      parentId: null, level: 'VALUE_STREAM', activityId: null, version: 1,
      ownerId: null, orderIndex: 0, status: 'DRAFT', description: '',
      orgIds: [extra.orgId], createdAt: now, updatedAt: now,
      ...extra,
    });
    processNodes.push(baseVs({ id: parentGovVsId, orgId: parentOrgId, name: 'Data Governance Management', domain: 'GOVERNANCE' }));
    processNodes.push(baseVs({ id: parentOpVsId,  orgId: parentOrgId, name: 'Parent Operational VS',      domain: 'OPERATIONAL' }));
    processNodes.push(baseVs({ id: childOpVsId,   orgId: childOrgId,  name: 'Child Operational VS',       domain: 'OPERATIONAL' }));
    processNodes.push(baseVs({ id: childGovVsId,  orgId: childOrgId,  name: 'Division-owned Governance',  domain: 'GOVERNANCE' }));
  });

  after(async () => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(processNodes, (n) => typeof n.id === 'string' && n.id.startsWith(PREFIX));
    sweep(organizations, (o) => typeof o.id === 'string' && o.id.startsWith(PREFIX));
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('hides ancestor-owned governance value streams from the child scope by default', async () => {
    const res = await request(port, 'GET', `/process-catalog?orgId=${childOrgId}`);
    assert.strictEqual(res.status, 200);
    const names = res.body.data.map((n: any) => n.name);
    // Parent's operational VS still shows (it's not governance).
    assert.ok(names.includes('Parent Operational VS'), 'parent operational VS should still appear');
    // Child's own content still shows.
    assert.ok(names.includes('Child Operational VS'), 'child operational VS should appear');
    // Child's OWN governance still shows — only ANCESTOR governance is hidden.
    assert.ok(names.includes('Division-owned Governance'), 'child-owned governance should still appear');
    // The ancestor governance VS is filtered out.
    assert.ok(!names.includes('Data Governance Management'), 'ancestor-owned governance VS should be hidden from the child scope');
    // Header counts reflect the filter.
    assert.strictEqual(res.body.stats.valueStreams, 3, 'value-stream count should exclude ancestor governance');
  });

  it('includes ancestor-owned governance when ?includeAncestorGovernance=true', async () => {
    const res = await request(port, 'GET', `/process-catalog?orgId=${childOrgId}&includeAncestorGovernance=true`);
    assert.strictEqual(res.status, 200);
    const names = res.body.data.map((n: any) => n.name);
    assert.ok(names.includes('Data Governance Management'), 'ancestor governance VS should appear when opted in');
    assert.strictEqual(res.body.stats.valueStreams, 4, 'count should include ancestor governance on opt-in');
  });

  it('does not touch the parent scope — ancestor set is empty at the top', async () => {
    // From the parent scope there ARE no ancestors, so the filter is
    // a no-op: every VS the parent can see (its own + rolled-up
    // child content) renders regardless of domain.
    const res = await request(port, 'GET', `/process-catalog?orgId=${parentOrgId}`);
    assert.strictEqual(res.status, 200);
    const names = res.body.data.map((n: any) => n.name);
    assert.ok(names.includes('Data Governance Management'), 'parent-owned governance shows at parent scope');
    assert.ok(names.includes('Division-owned Governance'), 'child-owned governance rolls up to parent scope');
  });
});
