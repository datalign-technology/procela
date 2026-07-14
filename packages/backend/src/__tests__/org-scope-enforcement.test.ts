// Middleware-level org-scope enforcement — a non-super-admin who
// names an org outside their accessible-org tree via query, path,
// or body should get 403 before the route handler runs.
//
// This is the fail-closed backstop for punchlist item #4: even if
// a specific route forgot to call filterByOrgScope, the middleware
// rejects the request at the boundary.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

import { authenticateToken } from '../middleware/auth';
import { errorHandler } from '../middleware/errorHandler';
import { sign as signJwt } from '../services/jwt-signer';
import { people } from '../routes/people';
import { organizations } from '../routes/organizations';
import { useStoreIsolation } from './_helpers/store-isolation';

const P = 'test-scope-';
const orgAcme = P + 'org-acme';
const orgAcmeDivision = P + 'org-acme-div';
const orgUmbrella = P + 'org-umbrella';
const personId = P + 'user-restricted';
const superId = P + 'user-super';

function mkToken(overrides: Record<string, unknown>): string {
  return signJwt({
    sub: 'test-sub',
    email: 'user@acme.example',
    orgId: orgAcme,
    role: 'CONTRIBUTOR',
    type: 'access',
    ...overrides,
  }, { expiresIn: '5m' });
}

function get(port: number, path: string, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path,
        headers: token ? { Authorization: `Bearer ${token}` } : {} },
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
    req.end();
  });
}

describe('authenticateToken — org-scope enforcement', () => {
  useStoreIsolation(
    { file: 'organizations', memory: organizations },
    { file: 'people', memory: people },
  );

  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use(express.json());
    // Route that echoes the (validated) query.orgId — proves that
    // the middleware accepts legitimate values through.
    app.get('/echo', authenticateToken, (req, res) => {
      res.json({ success: true, orgId: req.query.orgId ?? null });
    });
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  after(async () => { await new Promise<void>((r) => server.close(() => r())); });

  beforeEach(() => {
    const now = new Date().toISOString();
    organizations.push(
      { id: orgAcme, parentId: null, name: 'Acme', type: 'company', industry: '', description: '', headCount: 0, createdAt: now, updatedAt: now },
      { id: orgAcmeDivision, parentId: orgAcme, name: 'Acme Division', type: 'division', industry: '', description: '', headCount: 0, createdAt: now, updatedAt: now },
      { id: orgUmbrella, parentId: null, name: 'Umbrella', type: 'company', industry: '', description: '', headCount: 0, createdAt: now, updatedAt: now },
    );
    people.push(
      // Restricted user — accessibleOrgIds is Acme (+ its descendants).
      { id: personId, orgIds: [orgAcme], accessibleOrgIds: [orgAcme], name: 'Restricted', email: 'user@acme.example', role: 'CONTRIBUTOR', title: '', skillIds: [], active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      // Super-admin — no restriction.
      { id: superId, orgIds: [orgAcme], accessibleOrgIds: [orgAcme, orgUmbrella], name: 'Root', email: 'root@example', role: 'SUPER_ADMIN', title: '', skillIds: [], active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    );
  });

  it('accepts a request with no orgId', async () => {
    const res = await get(port, '/echo', mkToken({}));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.orgId, null);
  });

  it('accepts an orgId inside the user\'s tree', async () => {
    const res = await get(port, `/echo?orgId=${orgAcme}`, mkToken({}));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.orgId, orgAcme);
  });

  it('accepts a descendant org — the visibility set expands downward', async () => {
    const res = await get(port, `/echo?orgId=${orgAcmeDivision}`, mkToken({}));
    assert.strictEqual(res.status, 200);
  });

  it('rejects a foreign orgId with 403', async () => {
    const res = await get(port, `/echo?orgId=${orgUmbrella}`, mkToken({}));
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Not authorized for orgId/);
  });

  it('rejects a foreign orgId supplied via the scopeOrgId alias', async () => {
    const res = await get(port, `/echo?scopeOrgId=${orgUmbrella}`, mkToken({}));
    assert.strictEqual(res.status, 403);
  });

  it('lets SUPER_ADMIN through for any org', async () => {
    const superToken = signJwt({ sub: superId, email: 'root@example', orgId: orgAcme, role: 'SUPER_ADMIN', type: 'access' }, { expiresIn: '5m' });
    const res = await get(port, `/echo?orgId=${orgUmbrella}`, superToken);
    assert.strictEqual(res.status, 200);
  });

  it('still 401s a request with no token', async () => {
    const res = await get(port, `/echo?orgId=${orgAcme}`);
    assert.strictEqual(res.status, 401);
  });
});
