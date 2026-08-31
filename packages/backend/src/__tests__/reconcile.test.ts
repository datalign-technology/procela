// Phase 3 (A2) reconciliation flow: connection-rooted discovery →
// suggest/confirm against the catalog. Exercised end-to-end against the JSON
// store. A DATABASE connection with no credentials takes the labelled sample-
// asset path (deterministic), so the test needs no live database.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets, dataAssetBindings } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connections } = require('../routes/connections');

const P = 'test-recon-';
const ORG = P + 'org';
const CONN = P + 'conn';

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); } catch { resolve({ status: res.statusCode || 0, body: chunks }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sweep = (arr: any[], pred: (r: any) => boolean) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1); };
const clean = () => {
  sweep(dataAssets, (a) => a.orgId === ORG);
  sweep(dataAssetBindings, (b) => b.orgId === ORG);
  sweep(connections, (c) => c.id === CONN);
};

describe('discovery reconciliation (suggest + confirm)', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    clean();
    // A DATABASE connection with no credentials → sample-asset discovery
    // (customers / orders / products / customer_view), simulated:true.
    connections.push({
      id: CONN, orgId: ORG, name: 'Recon DB', connectionType: 'DATABASE',
      status: 'CONNECTED', config: { host: 'db.example', dbType: 'POSTGRESQL' },
      systemIds: [P + 'sys'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    // An existing business asset the discovered "customers" table should match.
    dataAssets.push({
      id: P + 'asset-cust', orgId: ORG, name: 'Customers', description: 'Customer master',
      systemId: P + 'sys', owner: '', stewardIds: [], governanceTier: 'SILVER',
      healthScore: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const app = express();
    app.use(express.json());
    app.use('/data-assets', dataAssetsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => { clean(); await new Promise<void>((r) => server.close(() => r())); });

  it('suggests an existing asset for a matching table and marks the rest new', async () => {
    const res = await request(port, 'GET', `/data-assets/reconcile/${CONN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.simulated, true);
    const items: any[] = res.body.data.items;
    const customers = items.find((i) => i.sourceAsset === 'customers');
    assert.ok(customers, 'customers table should be discovered');
    assert.strictEqual(customers.status, 'suggested');
    assert.strictEqual(customers.suggestion.dataAssetName, 'Customers');
    assert.ok(customers.suggestion.score >= 40);
    // "orders" has no catalog match → new.
    const orders = items.find((i) => i.sourceAsset === 'orders');
    assert.strictEqual(orders.status, 'new');
  });

  it('links a suggestion and creates a new asset, then reports linked on re-scan', async () => {
    const apply = await request(port, 'POST', `/data-assets/reconcile/${CONN}`, {
      decisions: [
        { sourceAsset: 'customers', action: 'link', dataAssetId: P + 'asset-cust', columns: ['customer_id', 'email'] },
        { sourceAsset: 'orders', action: 'create', columns: ['order_id', 'total_amount'] },
        { sourceAsset: 'products', action: 'skip' },
      ],
    });
    assert.strictEqual(apply.status, 200);
    assert.deepStrictEqual(
      { linked: apply.body.data.linked, created: apply.body.data.created, skipped: apply.body.data.skipped },
      { linked: 1, created: 1, skipped: 1 },
    );

    // The existing asset now has a binding to the connection.
    const custBinding = dataAssetBindings.find((b: any) => b.dataAssetId === P + 'asset-cust' && b.connectionId === CONN);
    assert.ok(custBinding, 'customers should be bound to the connection');
    assert.deepStrictEqual(custBinding.sourceColumns, ['customer_id', 'email']);

    // A new Bronze DISCOVERED asset was created for "orders".
    const created = dataAssets.find((a: any) => a.orgId === ORG && a.sourceAsset === 'orders' && a.origin === 'DISCOVERED');
    assert.ok(created, 'orders should create a new asset');
    assert.strictEqual(created.governanceTier, 'BRONZE');

    // Re-scan: both bound tables now read as linked.
    const res = await request(port, 'GET', `/data-assets/reconcile/${CONN}`);
    const items: any[] = res.body.data.items;
    assert.strictEqual(items.find((i) => i.sourceAsset === 'customers').status, 'linked');
    assert.strictEqual(items.find((i) => i.sourceAsset === 'orders').status, 'linked');
  });
});
