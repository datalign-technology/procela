// The Active/Deprecated status lock guards a domain's core FIELDS (name,
// description, owner, stewards, scope) — you must return it to Draft to edit
// those. It must NOT block a data-asset membership change (dataAssetIds is not
// a locked field), and a save that merely re-sends unchanged owner/stewards
// alongside the asset change must not be mistaken for a field edit. Regression
// for the Governance Details panel saving nothing (403) on an Active domain.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataDomainsRouter = require('../routes/data-domains').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');

const orgId = 'test-domlock-org';

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => { let c = ''; res.on('data', (d) => { c += d; }); res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: c ? JSON.parse(c) : null }); } catch { resolve({ status: res.statusCode || 0, body: c }); } }); },
    );
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

describe('data-domain status lock vs asset membership', () => {
  let server: http.Server; let port: number; let id: string;
  const sweep = () => { for (let i = dataDomains.length - 1; i >= 0; i--) if (dataDomains[i].orgId === orgId) dataDomains.splice(i, 1); };

  before(async () => {
    sweep();
    const app = express(); app.use(express.json()); app.use('/data-domains', dataDomainsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    const c = await request(port, 'POST', '/data-domains', { orgId, name: 'Lock Test Domain' });
    assert.equal(c.status, 201);
    id = c.body.data.id;
    // Force the domain Active (a locked status in simple mode).
    const stored = dataDomains.find((d: any) => d.id === id);
    stored.status = 'ACTIVE';
  });

  after(async () => { sweep(); await new Promise<void>((r) => server.close(() => r())); });

  it('lets you change data-asset membership on an Active domain (owner/stewards unchanged)', async () => {
    const stored = dataDomains.find((d: any) => d.id === id);
    const res = await request(port, 'PUT', `/data-domains/${id}`, {
      ownerId: stored.ownerId || null,          // re-sent unchanged
      stewardIds: stored.stewardIds || [],       // re-sent unchanged
      dataAssetIds: ['asset-1', 'asset-2'],      // the actual change
    });
    assert.equal(res.status, 200, 'asset-only save must succeed on an Active domain');
    assert.deepEqual(dataDomains.find((d: any) => d.id === id).dataAssetIds, ['asset-1', 'asset-2']);
  });

  it('still refuses an actual locked-field edit on an Active domain', async () => {
    const res = await request(port, 'PUT', `/data-domains/${id}`, { name: 'Renamed While Active' });
    assert.equal(res.status, 403, 'renaming an Active domain is refused until it returns to Draft');
    assert.equal(dataDomains.find((d: any) => d.id === id).name, 'Lock Test Domain');
  });
});
