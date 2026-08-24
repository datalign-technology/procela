// Regression test for #420: when an unrestricted (dev / super-admin bootstrap)
// user creates a top-level organization, they must be provisioned as a real
// Person member of it. Without this the dev auth provider mints an org-less
// ghost identity, the created org has no owner, and the creator can't
// consistently scope to the org they just made.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';

import config from '../config';
import { authenticateToken } from '../middleware/auth';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const organizationsRouter = require('../routes/organizations').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');

function request(
  port: number, method: string, path: string,
  opts: { body?: unknown; bearer?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (opts.body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data!));
    }
    if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`;
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

function mintJwt(email: string, role: string): string {
  return jwt.sign(
    { sub: 'dev-' + email, email, name: email.split('@')[0], orgId: '', role, type: 'access' },
    config.jwtSecret, { expiresIn: '1h' },
  );
}

describe('org bootstrap ownership (#420)', () => {
  let server: http.Server;
  let port: number;
  const orgsSnapshot: any[] = [];
  const peopleSnapshot: any[] = [];

  before(async () => {
    orgsSnapshot.push(...organizations);
    peopleSnapshot.push(...people);
    // Start from an empty world — mirrors a fresh dev DB with no people/orgs.
    organizations.length = 0;
    people.length = 0;

    const app = express();
    app.use(express.json());
    app.use('/api/v1/organizations', authenticateToken, organizationsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    organizations.length = 0;
    organizations.push(...orgsSnapshot);
    people.length = 0;
    people.push(...peopleSnapshot);
  });

  it('provisions a ghost dev user as an ORG_ADMIN member of the top-level org they create', async () => {
    const token = mintJwt('chad@example.test', 'ORG_ADMIN');
    const res = await request(port, 'POST', '/api/v1/organizations', {
      body: { name: 'Kissimmee Utility Authority', type: 'company' },
      bearer: token,
    });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const newOrgId = res.body.data.id;
    assert.ok(newOrgId, 'org should be created');

    const person = people.find((p: any) => p.email === 'chad@example.test');
    assert.ok(person, 'the creator should now have a Person record');
    assert.deepStrictEqual(person.orgIds, [newOrgId], 'Person should be a member of the new org');
    assert.strictEqual(person.role, 'ORG_ADMIN', 'creator keeps ORG_ADMIN');
  });

  it('appends membership (and preserves role) for an existing user creating another top-level org', async () => {
    // A SUPER_ADMIN stays unrestricted, so they can create multiple top-level
    // orgs — exercising the "existing Person, append membership" branch.
    const token = mintJwt('super@example.test', 'SUPER_ADMIN');
    const r1 = await request(port, 'POST', '/api/v1/organizations', {
      body: { name: 'Alpha Co', type: 'company' }, bearer: token,
    });
    assert.strictEqual(r1.status, 201, JSON.stringify(r1.body));
    const r2 = await request(port, 'POST', '/api/v1/organizations', {
      body: { name: 'Beta Co', type: 'company' }, bearer: token,
    });
    assert.strictEqual(r2.status, 201, JSON.stringify(r2.body));

    const rows = people.filter((p: any) => p.email === 'super@example.test');
    assert.strictEqual(rows.length, 1, 'exactly one Person — never duplicated');
    assert.strictEqual(rows[0].role, 'SUPER_ADMIN', 'role preserved, not downgraded');
    assert.deepStrictEqual(
      [...rows[0].orgIds].sort(),
      [r1.body.data.id, r2.body.data.id].sort(),
      'member of both created orgs',
    );
  });
});
