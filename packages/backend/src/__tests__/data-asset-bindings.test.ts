import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const connectionsRouter = require('../routes/connections').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets, dataAssetBindings, getPrimaryBinding } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connections } = require('../routes/connections');

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) }
          : {},
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

describe('DataAssetBinding routes', () => {
  let server: http.Server;
  let port: number;
  const seededAssetId = 'test-asset-bindings-seed';
  const seededConnId = 'test-conn-bindings-seed';
  const seededConnId2 = 'test-conn-bindings-seed-2';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/data-assets', dataAssetsRouter);
    app.use('/connections', connectionsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    // Seed an asset + two connections so link/unlink/re-point tests are stable.
    const now = new Date().toISOString();
    dataAssets.push({
      id: seededAssetId, orgId: 'test-org',
      name: 'Customer Email', description: 'Business-level email asset',
      systemId: '', owner: '', steward: '',
      governanceTier: 'BRONZE', healthScore: 0,
      createdAt: now, updatedAt: now,
    });
    connections.push({
      id: seededConnId, orgId: 'test-org', systemId: '',
      name: 'Test CSV', connectionType: 'FILE_STORAGE',
      config: { storageType: 'LOCAL', originalFileName: 'customers.csv' },
      credentials: {}, status: 'UNTESTED',
      lastTestedAt: null, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
    connections.push({
      id: seededConnId2, orgId: 'test-org', systemId: '',
      name: 'Test Postgres', connectionType: 'DATABASE',
      config: { dbType: 'POSTGRESQL', host: 'db.example.com' },
      credentials: {}, status: 'UNTESTED',
      lastTestedAt: null, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
  });

  after(async () => {
    // Clean up everything seeded so other tests aren't polluted.
    const ai = dataAssets.findIndex((a: any) => a.id === seededAssetId);
    if (ai !== -1) dataAssets.splice(ai, 1);
    for (const cid of [seededConnId, seededConnId2]) {
      const ci = connections.findIndex((c: any) => c.id === cid);
      if (ci !== -1) connections.splice(ci, 1);
    }
    // Any bindings created by these tests will dangle — purge them.
    for (let i = dataAssetBindings.length - 1; i >= 0; i--) {
      if (dataAssetBindings[i].dataAssetId === seededAssetId) dataAssetBindings.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('POST /:id/bindings creates a binding and marks it primary when it is the first', async () => {
    const res = await request(port, 'POST', `/data-assets/${seededAssetId}/bindings`, {
      connectionId: seededConnId, sourceAsset: 'customers.csv', sourceColumn: 'email',
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.isPrimary, true);
    assert.strictEqual(res.body.data.connectionId, seededConnId);
    assert.strictEqual(res.body.data.sourceColumn, 'email');
  });

  it('GET /:id/bindings returns the asset\u2019s bindings', async () => {
    const res = await request(port, 'GET', `/data-assets/${seededAssetId}/bindings`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].isPrimary, true);
  });

  it('getPrimaryBinding returns the active binding', async () => {
    const b = await getPrimaryBinding(seededAssetId);
    assert.ok(b);
    assert.strictEqual(b.connectionId, seededConnId);
  });

  it('POST a second binding with isPrimary:true demotes the first', async () => {
    const res = await request(port, 'POST', `/data-assets/${seededAssetId}/bindings`, {
      connectionId: seededConnId2, sourceAsset: 'customers', sourceColumn: 'email',
      isPrimary: true,
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.isPrimary, true);
    // The original binding should no longer be primary.
    const list = await request(port, 'GET', `/data-assets/${seededAssetId}/bindings`);
    const primaries = list.body.data.filter((b: any) => b.isPrimary);
    assert.strictEqual(primaries.length, 1);
    assert.strictEqual(primaries[0].connectionId, seededConnId2);
  });

  it('DELETE of a primary binding promotes the remaining one', async () => {
    // Delete the currently-primary binding (second one).
    const list1 = await request(port, 'GET', `/data-assets/${seededAssetId}/bindings`);
    const primary = list1.body.data.find((b: any) => b.isPrimary);
    const res = await request(port, 'DELETE', `/data-assets/${seededAssetId}/bindings/${primary.id}`);
    assert.strictEqual(res.status, 204);
    const list2 = await request(port, 'GET', `/data-assets/${seededAssetId}/bindings`);
    assert.strictEqual(list2.body.data.length, 1);
    assert.strictEqual(list2.body.data[0].isPrimary, true);
    assert.strictEqual(list2.body.data[0].connectionId, seededConnId);
  });

  it('POST rejects a binding against a missing connection', async () => {
    const res = await request(port, 'POST', `/data-assets/${seededAssetId}/bindings`, {
      connectionId: 'does-not-exist', sourceAsset: 'x', sourceColumn: 'y',
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Connection not found/i);
  });

  it('POST requires sourceAsset and connectionId', async () => {
    const a = await request(port, 'POST', `/data-assets/${seededAssetId}/bindings`, { connectionId: seededConnId });
    assert.strictEqual(a.status, 400);
    assert.match(a.body.error, /sourceAsset/);
    const b = await request(port, 'POST', `/data-assets/${seededAssetId}/bindings`, { sourceAsset: 't' });
    assert.strictEqual(b.status, 400);
    assert.match(b.body.error, /connectionId/);
  });

  it('Deleting the connection cascades — its bindings are purged', async () => {
    // There's currently one binding on seededConnId. Delete that connection.
    const del = await request(port, 'DELETE', `/connections/${seededConnId}`);
    assert.strictEqual(del.status, 204);
    const list = await request(port, 'GET', `/data-assets/${seededAssetId}/bindings`);
    assert.strictEqual(list.body.data.length, 0);
  });

  it('Returns 404 for bindings on a non-existent asset', async () => {
    const res = await request(port, 'GET', `/data-assets/no-such-asset/bindings`);
    assert.strictEqual(res.status, 404);
  });
});
