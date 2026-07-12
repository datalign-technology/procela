// GET /data-assets/:id/impact — "what breaks if this asset changes?"
//
// Cover:
//   1. Empty case — orphaned asset returns summary zeros, empty
//      activities + people lists.
//   2. One activity consumes the asset — activities has one row, its
//      responsible + owner both appear in the notify list with the
//      right role labels.
//   3. Domain owner + steward always show up in the notify list.
//   4. De-dup: a person who's both a domain steward AND responsible on
//      an activity appears once, with both roles.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
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

describe('GET /data-assets/:id/impact', () => {
  let server: http.Server;
  let port: number;
  const P = 'test-imp-';
  const orgId = P + 'org';
  const assetId = P + 'asset';
  const orphanId = P + 'orphan';
  const owner = P + 'owner';
  const responsible = P + 'responsible';
  const domainOwner = P + 'domain-owner';
  const domainSteward = P + 'domain-steward';
  const vsId = P + 'vs';
  const procId = P + 'proc';
  const spId = P + 'sp';
  const actId = P + 'act';
  const domainId = P + 'domain';
  const mapId = P + 'map';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/data-assets', dataAssetsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(dataAssets, (a: any) => a.id?.startsWith(P));
    sweep(people, (p: any) => p.id?.startsWith(P));
    sweep(dataDomains, (d: any) => d.id?.startsWith(P));
    sweep(processNodes, (n: any) => n.id?.startsWith(P));
    sweep(mappings, (m: any) => m.id?.startsWith(P));
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(dataAssets, (a: any) => a.id?.startsWith(P));
    sweep(people, (p: any) => p.id?.startsWith(P));
    sweep(dataDomains, (d: any) => d.id?.startsWith(P));
    sweep(processNodes, (n: any) => n.id?.startsWith(P));
    sweep(mappings, (m: any) => m.id?.startsWith(P));

    const now = new Date().toISOString();
    people.push(
      { id: owner, orgIds: [orgId], accessibleOrgIds: [orgId], name: 'Owner Person', email: 'owner@e.com', role: 'EDITOR', title: '', skillIds: [], active: true, createdAt: now, updatedAt: now },
      { id: responsible, orgIds: [orgId], accessibleOrgIds: [orgId], name: 'Responsible Person', email: 'r@e.com', role: 'CONTRIBUTOR', title: '', skillIds: [], active: true, createdAt: now, updatedAt: now },
      { id: domainOwner, orgIds: [orgId], accessibleOrgIds: [orgId], name: 'Domain Owner', email: 'do@e.com', role: 'EDITOR', title: '', skillIds: [], active: true, createdAt: now, updatedAt: now },
      { id: domainSteward, orgIds: [orgId], accessibleOrgIds: [orgId], name: 'Dual Role Person', email: 'ds@e.com', role: 'CONTRIBUTOR', title: '', skillIds: [], active: true, createdAt: now, updatedAt: now },
    );
    dataAssets.push(
      { id: assetId, orgId, name: 'Test Asset', description: '', systemId: '', owner: '', ownerPersonId: null, stewardIds: [], governanceTier: 'BRONZE', healthScore: 50, createdAt: now, updatedAt: now },
      { id: orphanId, orgId, name: 'Orphan', description: '', systemId: '', owner: '', ownerPersonId: null, stewardIds: [], governanceTier: 'BRONZE', healthScore: 0, createdAt: now, updatedAt: now },
    );
  });

  it('returns zero-count summary for an asset with no mappings and no domain', async () => {
    const res = await request(port, 'GET', `/data-assets/${orphanId}/impact`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.summary.activityCount, 0);
    assert.strictEqual(res.body.data.summary.processCount, 0);
    assert.strictEqual(res.body.data.summary.valueStreamCount, 0);
    assert.strictEqual(res.body.data.summary.peopleCount, 0);
    assert.deepStrictEqual(res.body.data.activities, []);
    assert.deepStrictEqual(res.body.data.people, []);
    assert.strictEqual(res.body.data.domain, null);
  });

  it('returns 404 for an unknown asset', async () => {
    const res = await request(port, 'GET', '/data-assets/no-such-id/impact');
    assert.strictEqual(res.status, 404);
  });

  it('surfaces affected activity with owner + responsible in the notify list', async () => {
    const now = new Date().toISOString();
    const base = { orgId, orgIds: [orgId], ownerId: null as string | null, status: 'ACTIVE', orderIndex: 0, version: 1, activityId: null, description: '', createdAt: now, updatedAt: now };
    processNodes.push({ ...base, id: vsId, level: 'VALUE_STREAM', name: 'VS', parentId: null });
    processNodes.push({ ...base, id: procId, level: 'PROCESS', name: 'Proc', parentId: vsId });
    processNodes.push({ ...base, id: spId, level: 'SUB_PROCESS', name: 'SP', parentId: procId });
    processNodes.push({ ...base, id: actId, level: 'ACTIVITY', name: 'The Activity', parentId: spId, ownerId: owner, responsiblePersonId: responsible });
    mappings.push({ id: mapId, orgId, processStepId: actId, dataAssetId: assetId, linkType: 'INPUT', notes: '', aiSuggested: false, userOverridden: false, createdAt: now, updatedAt: now });

    const res = await request(port, 'GET', `/data-assets/${assetId}/impact`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.summary.activityCount, 1);
    assert.strictEqual(res.body.data.summary.processCount, 1);
    assert.strictEqual(res.body.data.summary.valueStreamCount, 1);
    // Owner + Responsible both land in the notify list.
    assert.strictEqual(res.body.data.summary.peopleCount, 2);
    const names = res.body.data.people.map((p: any) => p.name).sort();
    assert.deepStrictEqual(names, ['Owner Person', 'Responsible Person']);
    // Activity row carries the breadcrumb.
    assert.match(res.body.data.activities[0].breadcrumb, /VS > Proc > SP > The Activity/);
  });

  it('adds domain owner + stewards to the notify list', async () => {
    dataDomains.push({
      id: domainId, orgId, name: 'Test Domain', description: '',
      ownerId: domainOwner, stewardIds: [domainSteward],
      dataAssetIds: [assetId], status: 'ACTIVE',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const res = await request(port, 'GET', `/data-assets/${assetId}/impact`);
    assert.strictEqual(res.status, 200);
    const names = res.body.data.people.map((p: any) => p.name).sort();
    assert.ok(names.includes('Domain Owner'));
    assert.ok(names.includes('Dual Role Person'));
    assert.strictEqual(res.body.data.domain.name, 'Test Domain');
  });

  it('de-dupes a person who holds multiple roles into one row with combined labels', async () => {
    const now = new Date().toISOString();
    const base = { orgId, orgIds: [orgId], ownerId: null as string | null, status: 'ACTIVE', orderIndex: 0, version: 1, activityId: null, description: '', createdAt: now, updatedAt: now };
    processNodes.push({ ...base, id: vsId, level: 'VALUE_STREAM', name: 'VS', parentId: null });
    processNodes.push({ ...base, id: procId, level: 'PROCESS', name: 'Proc', parentId: vsId });
    processNodes.push({ ...base, id: spId, level: 'SUB_PROCESS', name: 'SP', parentId: procId });
    // The same person is Responsible on the activity AND the steward
    // on the domain. Should show up once with two roles.
    processNodes.push({ ...base, id: actId, level: 'ACTIVITY', name: 'Dual Activity', parentId: spId, ownerId: null, responsiblePersonId: domainSteward });
    mappings.push({ id: mapId, orgId, processStepId: actId, dataAssetId: assetId, linkType: 'INPUT', notes: '', aiSuggested: false, userOverridden: false, createdAt: now, updatedAt: now });
    dataDomains.push({
      id: domainId, orgId, name: 'Test Domain', description: '',
      ownerId: null, stewardIds: [domainSteward],
      dataAssetIds: [assetId], status: 'ACTIVE',
      createdAt: now, updatedAt: now,
    });

    const res = await request(port, 'GET', `/data-assets/${assetId}/impact`);
    assert.strictEqual(res.status, 200);
    const dual = res.body.data.people.find((p: any) => p.name === 'Dual Role Person');
    assert.ok(dual, 'expected the dual-role person in the notify list');
    // Two role labels: steward on the domain + responsible on the activity.
    assert.ok(dual.roles.some((r: string) => /Domain steward/.test(r)));
    assert.ok(dual.roles.some((r: string) => /Responsible/.test(r)));
    // One row per person — the dual role person should appear once.
    assert.strictEqual(res.body.data.people.filter((p: any) => p.name === 'Dual Role Person').length, 1);
  });
});
