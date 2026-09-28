// Service-principal issuance API — create / list / revoke over real HTTP,
// with RBAC (admin-only) and the round-trip that a minted token authenticates
// an MCP session and a revoked one no longer does.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import jwt from 'jsonwebtoken';
import { sign } from '../services/jwt-signer';
import { authenticateToken } from '../middleware/auth';
import servicePrincipalsRouter, { mintServiceToken, type StoredServicePrincipal } from '../routes/service-principals';
import { servicePrincipals } from '../routes/service-principals';
import { createSession } from '../mcp/identity';
import config from '../config';

const ORG = 'sp-routes-org';
const adminTok = sign({ sub: 'admin-1', email: 'admin@sp.test', orgId: ORG, role: 'ORG_ADMIN', type: 'access' }, { expiresIn: '5m' });
const viewerTok = sign({ sub: 'viewer-1', email: 'viewer@sp.test', orgId: ORG, role: 'VIEWER', type: 'access' }, { expiresIn: '5m' });

let url = '';
let server: Server;

const api = (path: string, method: string, tok: string, body?: unknown) =>
  fetch(url + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

// res.json() is typed `unknown` under this tsconfig — parse to a loose shape.
const parse = async (r: Awaited<ReturnType<typeof fetch>>): Promise<{ data: any }> => (await r.json()) as { data: any };

describe('service-principals API', () => {
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/service-principals', authenticateToken, servicePrincipalsRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    for (let i = servicePrincipals.length - 1; i >= 0; i--) {
      if (servicePrincipals[i].orgId === ORG) servicePrincipals.splice(i, 1);
    }
  });

  it('a non-admin (Viewer) cannot mint a token', async () => {
    const res = await api('/api/v1/service-principals', 'POST', viewerTok, { orgId: ORG, label: 'nope' });
    assert.strictEqual(res.status, 403);
  });

  it('an admin mints a token (returned once) that authenticates an MCP session', async () => {
    const res = await api('/api/v1/service-principals', 'POST', adminTok, { orgId: ORG, label: 'Claude Desktop', role: 'VIEWER' });
    assert.strictEqual(res.status, 201);
    const { data } = await parse(res);
    assert.ok(data.token, 'token returned once');
    assert.strictEqual(data.role, 'VIEWER');
    assert.strictEqual(data.active, true);

    // The minted token builds a service session scoped to the grant org.
    const session = await createSession(data.token);
    assert.strictEqual(session.user.type, 'service');
    assert.strictEqual(session.defaultOrgId, ORG);
    assert.strictEqual(session.resolveOrg(undefined), ORG);
  });

  it('list omits the secret and shows the grant', async () => {
    await api('/api/v1/service-principals', 'POST', adminTok, { orgId: ORG, label: 'For listing' });
    const res = await api(`/api/v1/service-principals?orgId=${ORG}`, 'GET', adminTok);
    assert.strictEqual(res.status, 200);
    const { data } = await parse(res);
    assert.ok(data.length >= 1);
    for (const g of data) {
      assert.strictEqual((g as { token?: string }).token, undefined, 'never leaks the token');
      assert.ok('tokenPrefix' in g);
    }
  });

  it('defaults an unspecified role to VIEWER and rejects a bad role', async () => {
    const ok = await api('/api/v1/service-principals', 'POST', adminTok, { orgId: ORG, label: 'defaulted' });
    assert.strictEqual((await parse(ok)).data.role, 'VIEWER');
    const bad = await api('/api/v1/service-principals', 'POST', adminTok, { orgId: ORG, label: 'bad', role: 'SUPER_ADMIN' });
    assert.strictEqual(bad.status, 400);
  });

  it('revoking a token stops it authenticating', async () => {
    const created = await parse(await api('/api/v1/service-principals', 'POST', adminTok, { orgId: ORG, label: 'to revoke' }));
    const token = created.data.token;
    const id = created.data.id;
    // Works before revocation.
    await assert.doesNotReject(() => createSession(token));
    // Revoke.
    const del = await api(`/api/v1/service-principals/${id}`, 'DELETE', adminTok);
    assert.strictEqual(del.status, 200);
    assert.strictEqual((await parse(del)).data.active, false);
    // No longer authenticates.
    await assert.rejects(() => createSession(token), /revoked or not recognized/);
  });

  it('a non-admin cannot revoke', async () => {
    const created = await parse(await api('/api/v1/service-principals', 'POST', adminTok, { orgId: ORG, label: 'guarded' }));
    const res = await api(`/api/v1/service-principals/${created.data.id}`, 'DELETE', viewerTok);
    assert.strictEqual(res.status, 403);
  });
});

describe('service token TTL is configurable (MCP_SERVICE_TOKEN_TTL)', () => {
  const mutable = config as { mcpServiceTokenTtl: string };
  const original = mutable.mcpServiceTokenTtl;
  const grant: StoredServicePrincipal = {
    id: 'ttl-grant', orgId: ORG, label: 'ttl', role: 'VIEWER', createdBy: null,
    tokenPrefix: null, lastUsedAt: null, revokedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const lifetimeSeconds = (token: string): number => {
    const d = jwt.decode(token) as { iat: number; exp: number };
    return d.exp - d.iat;
  };
  after(() => { mutable.mcpServiceTokenTtl = original; });

  it('defaults to 365 days', () => {
    mutable.mcpServiceTokenTtl = '365d';
    assert.strictEqual(lifetimeSeconds(mintServiceToken(grant)), 365 * 24 * 60 * 60);
  });

  it('honours a duration-string override', () => {
    mutable.mcpServiceTokenTtl = '30d';
    assert.strictEqual(lifetimeSeconds(mintServiceToken(grant)), 30 * 24 * 60 * 60);
  });

  it('reads a bare-number override as SECONDS (not milliseconds)', () => {
    mutable.mcpServiceTokenTtl = '3600';
    assert.strictEqual(lifetimeSeconds(mintServiceToken(grant)), 3600);
  });
});
