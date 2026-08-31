// Per-tenant backup: export is scoped to one org subtree, import replaces only
// that scope. Exercises the route end-to-end against the JSON store, proving
// the scoping predicates and the replace/upsert semantics. (The Postgres-mode
// fix — reading/writing through repositories instead of the retired in-memory
// arrays — is structural: every store here is reached via its repository, the
// same call path used in DB mode.)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';

import config from '../config';
import backupRouter from '../routes/backup';
import { organizations } from '../routes/organizations';
import { dataDomains } from '../routes/data-domains';
import { dataAssets } from '../routes/data-assets';
import { people } from '../routes/people';
import { governancePolicies } from '../routes/governance-policies';

const P = 'bkT-';
const A = P + 'A';        // tenant A (company)
const A1 = P + 'A1';      // division under A
const B = P + 'B';        // tenant B (company)

function token(role: string, orgId: string): string {
  return jwt.sign({ sub: P + 'u', email: 't@x.io', orgId, role, type: 'access' }, config.jwtSecret, { expiresIn: '1h' });
}

function request(port: number, method: string, path: string, tok?: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sweep = (arr: any[], pred: (r: any) => boolean) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1); };
const byPrefixId = (r: any) => typeof r?.id === 'string' && r.id.startsWith(P);

describe('per-tenant backup export/import', () => {
  let server: http.Server;
  let port: number;

  const clearFixtures = () => {
    sweep(organizations, byPrefixId); sweep(dataDomains, byPrefixId); sweep(dataAssets, byPrefixId);
    sweep(people, byPrefixId); sweep(governancePolicies, byPrefixId);
  };

  const seed = () => {
    clearFixtures();
    organizations.push(
      { id: A, name: 'Tenant A', parentId: null, type: 'company' } as any,
      { id: A1, name: 'Div A1', parentId: A, type: 'division' } as any,
      { id: B, name: 'Tenant B', parentId: null, type: 'company' } as any,
    );
    dataDomains.push(
      { id: P + 'dA', orgId: A, name: 'Dom A', ownerId: null, stewardIds: [], dataAssetIds: [], status: 'ACTIVE' } as any,
      { id: P + 'dA1', orgId: A1, name: 'Dom A1', ownerId: null, stewardIds: [], dataAssetIds: [], status: 'ACTIVE' } as any,
      { id: P + 'dB', orgId: B, name: 'Dom B', ownerId: null, stewardIds: [], dataAssetIds: [], status: 'ACTIVE' } as any,
    );
    dataAssets.push(
      { id: P + 'aA', orgId: A, name: 'Asset A' } as any,
      { id: P + 'aB', orgId: B, name: 'Asset B' } as any,
    );
    people.push(
      { id: P + 'pA', orgIds: [A], accessibleOrgIds: [A], name: 'Person A', email: 'pa@x.io' } as any,
      { id: P + 'pB', orgIds: [B], accessibleOrgIds: [B], name: 'Person B', email: 'pb@x.io' } as any,
    );
    governancePolicies.push(
      { id: P + 'gpA', orgId: A, code: 'POL-A', name: 'Policy A', description: '', content: '', status: 'ACTIVE' } as any,
      { id: P + 'gpB', orgId: B, code: 'POL-B', name: 'Policy B', description: '', content: '', status: 'ACTIVE' } as any,
    );
  };

  before(async () => {
    seed();
    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/backup', backupRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    clearFixtures();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('requires authentication and admin role', async () => {
    const anon = await request(port, 'GET', `/backup/export?orgId=${A}`);
    assert.strictEqual(anon.status, 401);
    const viewer = await request(port, 'GET', `/backup/export?orgId=${A}`, token('VIEWER', A));
    assert.strictEqual(viewer.status, 403);
  });

  it('exports only the scope org subtree', async () => {
    const res = await request(port, 'GET', `/backup/export?orgId=${A}`, token('SUPER_ADMIN', A));
    assert.strictEqual(res.status, 200);
    const d = res.body.data;
    // A + A1 orgs, not B.
    assert.deepStrictEqual(res.body.scope.orgIds.sort(), [A, A1].sort());
    assert.deepStrictEqual(d.organizations.map((o: any) => o.id).sort(), [A, A1].sort());
    assert.deepStrictEqual(d.dataDomains.map((x: any) => x.id).sort(), [P + 'dA', P + 'dA1'].sort());
    assert.deepStrictEqual(d.dataAssets.map((x: any) => x.id), [P + 'aA']);
    assert.deepStrictEqual(d.people.map((x: any) => x.id), [P + 'pA']);
    assert.deepStrictEqual(d.governancePolicies.map((x: any) => x.id), [P + 'gpA']);
    // Tenant B leaks nowhere.
    assert.ok(!JSON.stringify(d).includes(P + 'dB'));
    assert.ok(!JSON.stringify(d).includes(P + 'aB'));
    assert.ok(!JSON.stringify(d).includes(P + 'gpB'));
  });

  it('round-trips: import restores the scope and leaves other tenants untouched', async () => {
    const exported = (await request(port, 'GET', `/backup/export?orgId=${A}`, token('SUPER_ADMIN', A))).body;

    // Mutate tenant A after the backup: drop a domain, add an out-of-backup one.
    sweep(dataDomains, (r) => r.id === P + 'dA');
    dataDomains.push({ id: P + 'dA-new', orgId: A, name: 'Added After', ownerId: null, stewardIds: [], dataAssetIds: [], status: 'ACTIVE' } as any);

    const imp = await request(port, 'POST', '/backup/import', token('SUPER_ADMIN', A), exported);
    assert.strictEqual(imp.status, 200);
    assert.strictEqual(imp.body.success, true);

    // dA restored, the post-backup addition wiped (replace-mode), B intact.
    assert.ok(dataDomains.find((d) => d.id === P + 'dA'), 'dA restored from backup');
    assert.ok(!dataDomains.find((d) => d.id === P + 'dA-new'), 'out-of-backup row replaced away');
    assert.ok(dataDomains.find((d) => d.id === P + 'dB'), 'other tenant untouched');
  });

  it('blocks a non-super-admin from importing another tenant', async () => {
    const exported = (await request(port, 'GET', `/backup/export?orgId=${A}`, token('SUPER_ADMIN', A))).body;
    // Org admin of tenant B tries to restore tenant A's backup.
    const res = await request(port, 'POST', '/backup/import', token('ORG_ADMIN', B), exported);
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Not authorized/i);
  });
});
