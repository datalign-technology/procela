import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../routes/governance-exceptions').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceExceptions, isPastExpiry } = require('../routes/governance-exceptions');

function req(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let c = ''; res.on('data', (d) => { c += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: c ? JSON.parse(c) : null }); } catch { resolve({ status: res.statusCode || 0, body: c }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

describe('Governance Exceptions register', () => {
  let server: http.Server; let port: number;
  const org = 'gex-org';

  before(async () => {
    const app = express(); app.use(express.json());
    app.use((r: any, _res, next) => { r.user = { id: 'u1' }; next(); });
    app.use('/governance-exceptions', router);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  after(async () => {
    for (let i = governanceExceptions.length - 1; i >= 0; i--) if (governanceExceptions[i].orgId === org) governanceExceptions.splice(i, 1);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('isPastExpiry only flags ACTIVE + lapsed', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 1e9).toISOString();
    assert.strictEqual(isPastExpiry({ status: 'ACTIVE', expiresAt: past } as any), true);
    assert.strictEqual(isPastExpiry({ status: 'ACTIVE', expiresAt: future } as any), false);
    assert.strictEqual(isPastExpiry({ status: 'CLOSED', expiresAt: past } as any), false);
  });

  it('creates, flags past-expiry, and closes', async () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    const created = await req(port, 'POST', '/governance-exceptions', { orgId: org, title: 'Legacy waiver', expiresAt: past });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.pastExpiry, true);
    const id = created.body.data.id;

    const list = await req(port, 'GET', `/governance-exceptions?orgId=${org}`);
    assert.strictEqual(list.body.data.length, 1);
    assert.strictEqual(list.body.data[0].pastExpiry, true);

    // Closing it clears the past-expiry flag (no longer a live risk).
    const closed = await req(port, 'PUT', `/governance-exceptions/${id}`, { status: 'CLOSED' });
    assert.strictEqual(closed.body.data.pastExpiry, false);

    // title + expiresAt are required.
    const bad = await req(port, 'POST', '/governance-exceptions', { orgId: org, title: 'x' });
    assert.strictEqual(bad.status, 400);
  });
});
