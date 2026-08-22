// Reports are an any-authenticated surface (no role gate at the mount), so a
// per-record owner check is what stops one user editing or deleting another
// user's report — including a shared 'org'-visibility one. This covers that
// check on PUT and DELETE.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const reportsRouter = require('../routes/reports').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reports } = require('../routes/reports');

// The acting user for the next request — an injecting middleware puts it on
// req.user.sub, mirroring what authenticateToken does in the real app.
let actingUser: string | null = null;

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

describe('reports — owner-scoped edit/delete', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-report-';
  const ownedId = PREFIX + 'owned';
  const ownerlessId = PREFIX + 'ownerless';

  const seed = (id: string, ownerId: string | null) => {
    const now = new Date().toISOString();
    reports.push({
      id, orgId: PREFIX + 'org', name: 'R', description: '', ownerId,
      visibility: 'org', definition: { entity: 'processNodes', columns: [], filters: [] },
      createdAt: now, updatedAt: now,
    });
  };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = actingUser ? { sub: actingUser } : undefined; next(); });
    app.use('/reports', reportsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    for (let i = reports.length - 1; i >= 0; i--) if (String(reports[i].id).startsWith(PREFIX)) reports.splice(i, 1);
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    for (let i = reports.length - 1; i >= 0; i--) if (String(reports[i].id).startsWith(PREFIX)) reports.splice(i, 1);
    seed(ownedId, 'user-a');
    seed(ownerlessId, null);
    actingUser = null;
  });

  it('403s a non-owner editing another user\'s report', async () => {
    actingUser = 'user-b';
    const res = await request(port, 'PUT', `/reports/${ownedId}`, { name: 'hijacked' });
    assert.strictEqual(res.status, 403);
  });

  it('403s a non-owner deleting another user\'s report', async () => {
    actingUser = 'user-b';
    const res = await request(port, 'DELETE', `/reports/${ownedId}`);
    assert.strictEqual(res.status, 403);
  });

  it('lets the owner edit and delete their own report', async () => {
    actingUser = 'user-a';
    const put = await request(port, 'PUT', `/reports/${ownedId}`, { name: 'renamed' });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.data.name, 'renamed');
    const del = await request(port, 'DELETE', `/reports/${ownedId}`);
    assert.strictEqual(del.status, 204);
  });

  it('leaves an ownerless report editable by anyone (no owner to scope to)', async () => {
    actingUser = 'user-b';
    const res = await request(port, 'PUT', `/reports/${ownerlessId}`, { name: 'ok' });
    assert.strictEqual(res.status, 200);
  });
});
