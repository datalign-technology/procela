// HTTP tests for the two Phase 3 endpoints landed in the previous
// commits:
//   GET /api/v1/process-catalog/data-graph
//   GET /api/v1/data-assets/orphans
//
// Both are thin transformations over the shared in-memory stores but
// they shape what the UI sees, so the contract — what fields each row
// carries, what the orgId / governance filters do, what's excluded —
// belongs under test.
//
// Pattern matches data-asset-bindings.test.ts: mount the real routers
// on an ephemeral express server, seed the stores in `before`, scrub
// in `after` so sibling tests see clean state.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const processCatalogRouter = require('../routes/process-catalog').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systems } = require('../routes/systems');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');

function request(port: number, method: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Phase 3 graph + orphan-asset routes', () => {
  let server: http.Server;
  let port: number;

  // A self-contained scenario isolated by a unique orgId so it doesn't
  // collide with other suites that touch these stores.
  const orgId = 'test-org-data-graph';
  const sysId = 'test-sys-data-graph';
  const assetMapped1 = 'test-asset-graph-mapped-1';
  const assetMapped2 = 'test-asset-graph-mapped-2';
  const assetOrphan = 'test-asset-graph-orphan';
  const vsId = 'test-vs-data-graph';
  const procId = 'test-proc-data-graph';
  const govProcId = 'test-gov-proc-data-graph';
  const actOp1 = 'test-act-op-1';
  const actOp2 = 'test-act-op-2';
  const actGov = 'test-act-gov-1';
  const mapping1 = 'test-mapping-1';
  const mapping2 = 'test-mapping-2';
  const mapping3 = 'test-mapping-3';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/process-catalog', processCatalogRouter);
    app.use('/data-assets', dataAssetsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    // Sweep leftovers from a previous failed run — the persisted JSON
    // store rehydrates these into the in-memory arrays on load.
    const seedPrefixes = ['test-sys-data-graph', 'test-asset-graph-', 'test-vs-data-graph', 'test-proc-data-graph', 'test-gov-proc-data-graph', 'test-act-op-', 'test-act-gov-', 'test-mapping-'];
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i].id;
        if (typeof id === 'string' && seedPrefixes.some((p) => id.startsWith(p))) arr.splice(i, 1);
      }
    };
    sweep(mappings); sweep(processNodes); sweep(dataAssets); sweep(systems);

    const now = new Date().toISOString();
    systems.push({
      id: sysId, orgId, name: 'Test ERP', description: 'erp', systemType: 'ERP',
      createdAt: now, updatedAt: now,
    });
    dataAssets.push(
      { id: assetMapped1, orgId, name: 'Billing master', description: 'billing', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'SILVER', healthScore: 0, createdAt: now, updatedAt: now },
      { id: assetMapped2, orgId, name: 'Invoice ledger', description: 'invoice', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'GOLD', healthScore: 0, createdAt: now, updatedAt: now },
      { id: assetOrphan, orgId, name: 'Unused lookup', description: 'orphan', systemId: sysId, owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 0, createdAt: now, updatedAt: now },
    );
    processNodes.push(
      { id: vsId,  parentId: null,  level: 'VALUE_STREAM', name: 'Billing VS', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, createdAt: now, updatedAt: now },
      { id: procId, parentId: vsId, level: 'PROCESS',     name: 'Generate invoice', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'OPERATIONAL', createdAt: now, updatedAt: now },
      { id: actOp1, parentId: procId, level: 'ACTIVITY',  name: 'Post charge',  description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'OPERATIONAL', systemIds: [sysId], createdAt: now, updatedAt: now },
      { id: actOp2, parentId: procId, level: 'ACTIVITY',  name: 'Ledger entry', description: '', activityId: null, status: 'DRAFT', orderIndex: 1, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'OPERATIONAL', systemIds: [sysId], createdAt: now, updatedAt: now },
      { id: govProcId, parentId: vsId, level: 'PROCESS',  name: 'Data governance committee', description: '', activityId: null, status: 'DRAFT', orderIndex: 2, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'GOVERNANCE', createdAt: now, updatedAt: now },
      { id: actGov, parentId: govProcId, level: 'ACTIVITY', name: 'Approve policy', description: '', activityId: null, status: 'DRAFT', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, domain: 'GOVERNANCE', systemIds: [], createdAt: now, updatedAt: now },
    );
    mappings.push(
      { id: mapping1, orgId, processStepId: actOp1, dataAssetId: assetMapped1, linkType: 'consumes', notes: '', aiSuggested: false, userOverridden: false, createdBy: 'test', createdAt: now, updatedAt: now },
      { id: mapping2, orgId, processStepId: actOp1, dataAssetId: assetMapped2, linkType: 'produces', notes: '', aiSuggested: false, userOverridden: false, createdBy: 'test', createdAt: now, updatedAt: now },
      { id: mapping3, orgId, processStepId: actOp2, dataAssetId: assetMapped2, linkType: 'produces', notes: '', aiSuggested: false, userOverridden: false, createdBy: 'test', createdAt: now, updatedAt: now },
    );
  });

  after(async () => {
    const ids = (arr: any[], owned: string[]) => {
      for (let i = arr.length - 1; i >= 0; i--) if (owned.includes(arr[i].id)) arr.splice(i, 1);
    };
    ids(mappings,     [mapping1, mapping2, mapping3]);
    ids(processNodes, [vsId, procId, govProcId, actOp1, actOp2, actGov]);
    ids(dataAssets,   [assetMapped1, assetMapped2, assetOrphan]);
    ids(systems,      [sysId]);
    await new Promise<void>((r) => server.close(() => r()));
  });

  describe('GET /process-catalog/data-graph', () => {
    it('returns the bipartite graph scoped to the requested org', async () => {
      const res = await request(port, 'GET', `/process-catalog/data-graph?orgId=${orgId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const ids = (rows: any[], k: string) => rows.map((r) => r[k]).sort();
      assert.deepStrictEqual(ids(res.body.data.activities, 'id'), [actOp1, actOp2].sort());
      // assetOrphan is excluded because no edge references it; both
      // mapped assets are present.
      assert.deepStrictEqual(ids(res.body.data.assets, 'id'), [assetMapped1, assetMapped2].sort());
      assert.strictEqual(res.body.data.edges.length, 3);
      assert.strictEqual(res.body.data.stats.activityCount, 2);
      assert.strictEqual(res.body.data.stats.assetCount, 2);
      assert.strictEqual(res.body.data.stats.edgeCount, 3);
      assert.strictEqual(res.body.data.stats.mappedActivityCount, 2);
    });

    it('enriches activities with parent process name and assets with system name + tier', async () => {
      const res = await request(port, 'GET', `/process-catalog/data-graph?orgId=${orgId}`);
      const act = res.body.data.activities.find((a: any) => a.id === actOp1);
      assert.strictEqual(act.parentProcessId, procId);
      assert.strictEqual(act.parentProcessName, 'Generate invoice');
      const asset = res.body.data.assets.find((a: any) => a.id === assetMapped1);
      assert.strictEqual(asset.systemId, sysId);
      assert.strictEqual(asset.systemName, 'Test ERP');
      assert.strictEqual(asset.governanceTier, 'SILVER');
    });

    it('excludes governance-domain activities by default', async () => {
      const res = await request(port, 'GET', `/process-catalog/data-graph?orgId=${orgId}`);
      const ids = res.body.data.activities.map((a: any) => a.id);
      assert.ok(!ids.includes(actGov), 'governance activity should be excluded by default');
    });

    it('includes governance activities when includeGovernance=1 is set', async () => {
      const res = await request(port, 'GET', `/process-catalog/data-graph?orgId=${orgId}&includeGovernance=1`);
      const ids = res.body.data.activities.map((a: any) => a.id);
      assert.ok(ids.includes(actGov), 'governance activity should be included with the opt-in flag');
    });
  });

  describe('GET /data-assets/orphans', () => {
    it('returns only the unmapped asset for the scoped org', async () => {
      const res = await request(port, 'GET', `/data-assets/orphans?orgId=${orgId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const ids = res.body.data.map((a: any) => a.id);
      assert.deepStrictEqual(ids, [assetOrphan]);
    });

    it('enriches the orphan row with system name + governance tier', async () => {
      const res = await request(port, 'GET', `/data-assets/orphans?orgId=${orgId}`);
      const orphan = res.body.data[0];
      assert.strictEqual(orphan.name, 'Unused lookup');
      assert.strictEqual(orphan.systemId, sysId);
      assert.strictEqual(orphan.systemName, 'Test ERP');
      assert.strictEqual(orphan.governanceTier, 'BRONZE');
      // Owner field is null when no person is linked.
      assert.strictEqual(orphan.ownerName, null);
    });

    it('omits the orphan once it has at least one mapping', async () => {
      const before = await request(port, 'GET', `/data-assets/orphans?orgId=${orgId}`);
      assert.strictEqual(before.body.data.length, 1);
      const tmpMappingId = 'test-mapping-tmp-orphan-promotion';
      mappings.push({
        id: tmpMappingId, orgId, processStepId: actOp1, dataAssetId: assetOrphan,
        linkType: 'references', notes: '', aiSuggested: false, userOverridden: false,
        createdBy: 'test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      const after = await request(port, 'GET', `/data-assets/orphans?orgId=${orgId}`);
      assert.strictEqual(after.body.data.length, 0);
      // Clean up so other tests in this suite see the orphan again.
      const idx = mappings.findIndex((m: any) => m.id === tmpMappingId);
      if (idx >= 0) mappings.splice(idx, 1);
    });
  });
});
