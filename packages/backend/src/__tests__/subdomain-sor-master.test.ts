// Canonical-EDM feature slice: sub-domain nesting, master/reference
// governance signal on a domain, and the system-of-record gap.
//
// Exercises the route plumbing end-to-end against the JSON store:
//   - POST /data-domains with parentDomainId (nesting, one level deep)
//   - GET  /data-domains/:id enrichment (parentDomainName, subDomainCount,
//     containsMasterData, suggestedCriticality)
//   - PUT  /data-domains/:id parent validation (self, two-level)
//   - DELETE re-homes sub-domains to top-level
//   - GET  /gap-detection surfaces copies-without-SOR

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataDomainsRouter = require('../routes/data-domains').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gapRouter = require('../routes/gap-detection').default;

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {} },
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

describe('sub-domains, master-data signal, SOR gap', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-edm-';
  const orgId = PREFIX + 'org';

  const sweep = (arr: any[], pred: (r: any) => boolean) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1); };

  before(async () => {
    // Clear any rows left by a prior aborted run — the JSON store persists to
    // disk, so a mid-run failure can leave this org's fixtures behind.
    sweep(dataDomains, (d: any) => d.orgId === orgId);
    sweep(dataAssets, (a: any) => (a.name || '').startsWith(PREFIX));

    const app = express();
    app.use(express.json());
    app.use('/data-domains', dataDomainsRouter);
    app.use('/data-assets', dataAssetsRouter);
    app.use('/gap-detection', gapRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    sweep(dataDomains, (d: any) => d.orgId === orgId);
    sweep(dataAssets, (a: any) => (a.name || '').startsWith(PREFIX));
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('nests a sub-domain under a parent, one level deep', async () => {
    const parent = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Manufacturing', orgId });
    assert.strictEqual(parent.status, 201);
    const parentId = parent.body.data.id;

    const child = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Welding', orgId, parentDomainId: parentId });
    assert.strictEqual(child.status, 201);
    assert.strictEqual(child.body.data.parentDomainId, parentId);
    assert.strictEqual(child.body.data.parentDomainName, PREFIX + 'Manufacturing');

    // Parent enrichment reports the child count.
    const parentAfter = await request(port, 'GET', `/data-domains/${parentId}`);
    assert.strictEqual(parentAfter.body.data.subDomainCount, 1);

    // A third level is rejected — nesting under the sub-domain is blocked.
    const grandchild = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Weld QA', orgId, parentDomainId: child.body.data.id });
    assert.strictEqual(grandchild.status, 400);
    assert.match(grandchild.body.error, /one level deep/i);
  });

  it('rejects self-parenting on update', async () => {
    const d = await request(port, 'POST', '/data-domains', { name: PREFIX + 'SelfPar', orgId });
    const id = d.body.data.id;
    const res = await request(port, 'PUT', `/data-domains/${id}`, { parentDomainId: id });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /own parent/i);
  });

  it('re-homes sub-domains to top-level when the parent is deleted', async () => {
    const parent = await request(port, 'POST', '/data-domains', { name: PREFIX + 'DelParent', orgId });
    const parentId = parent.body.data.id;
    const child = await request(port, 'POST', '/data-domains', { name: PREFIX + 'DelChild', orgId, parentDomainId: parentId });
    const childId = child.body.data.id;

    const del = await request(port, 'DELETE', `/data-domains/${parentId}`);
    assert.strictEqual(del.status, 204);

    const childAfter = await request(port, 'GET', `/data-domains/${childId}`);
    assert.strictEqual(childAfter.body.data.parentDomainId, null);
  });

  it('flags a domain holding master data as suggested Tier-1', async () => {
    const dom = await request(port, 'POST', '/data-domains', { name: PREFIX + 'MasterDom', orgId });
    const domId = dom.body.data.id;
    const asset = await request(port, 'POST', '/data-assets', { name: PREFIX + 'Material Master', dataType: 'MASTER' });
    const assetId = asset.body.data.id;
    await request(port, 'PUT', `/data-domains/${domId}`, { dataAssetIds: [assetId] });

    const enriched = await request(port, 'GET', `/data-domains/${domId}`);
    assert.strictEqual(enriched.body.data.containsMasterData, true);
    assert.strictEqual(enriched.body.data.suggestedCriticality, 'TIER_1');
  });

  it('surfaces same-named copies across systems with no declared SOR', async () => {
    const name = PREFIX + 'Customer Master Copies';
    const a = await request(port, 'POST', '/data-assets', { name, systemId: PREFIX + 'sysA' });
    const b = await request(port, 'POST', '/data-assets', { name, systemId: PREFIX + 'sysB' });
    const aId = a.body.data.id;

    const gaps1 = await request(port, 'GET', '/gap-detection');
    const found = (gaps1.body.data.copiesWithoutSor || []).find((g: any) => g.name === name);
    assert.ok(found, 'expected the copy group to appear as a SOR gap');
    assert.strictEqual(found.systemCount, 2);

    // Declaring one copy the system of record clears the gap.
    await request(port, 'PUT', `/data-assets/${aId}`, { isSystemOfRecord: true });
    const gaps2 = await request(port, 'GET', '/gap-detection');
    const stillThere = (gaps2.body.data.copiesWithoutSor || []).find((g: any) => g.name === name);
    assert.strictEqual(stillThere, undefined, 'gap should clear once a SOR is declared');
    void b;
  });
});
