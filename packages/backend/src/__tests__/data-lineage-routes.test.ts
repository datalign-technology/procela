import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataLineageRouter = require('../routes/data-lineage').default;

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

describe('/data-lineage routing', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/data-lineage', dataLineageRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('GET /asset-edges is reachable and NOT shadowed by GET /:id', async () => {
    // Regression for a real bug: `/asset-edges` must be declared before
    // `/:id` in the router, otherwise Express matches this as
    // { id: "asset-edges" } and returns 404 "Lineage link not found".
    // That 404 broke the Data Lineage page's initial load.
    const res = await request(port, 'GET', '/data-lineage/asset-edges');
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status} with body ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body?.success, true);
    assert.ok(Array.isArray(res.body?.data));
  });

  it('GET /visualization is reachable and NOT shadowed by GET /:id', async () => {
    const res = await request(port, 'GET', '/data-lineage/visualization');
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual(res.body?.success, true);
    assert.ok(Array.isArray(res.body?.data?.nodes));
    assert.ok(Array.isArray(res.body?.data?.links));
  });

  it('GET /:id still returns 404 for a non-existent id', async () => {
    const res = await request(port, 'GET', '/data-lineage/does-not-exist-id');
    assert.strictEqual(res.status, 404);
  });
});
