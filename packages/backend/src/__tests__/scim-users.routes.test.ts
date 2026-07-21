// HTTP coverage for the SCIM /Users endpoints after their Postgres-cutover
// conversion to the people repository (PR 3b). The subsystem had no route
// tests; this exercises the create/read/list/patch/delete contract end-to-end
// through the repository (JSON path — no DATABASE_URL in CI).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

import { people } from '../routes/people';
import { scimGroups } from '../services/scim-groups';
import { useStoreIsolation } from './_helpers/store-isolation';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const scimRouter = require('../routes/scim').default;

const TOKEN = 'test-scim-token';

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
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

describe('SCIM /Users routes (repository-backed)', () => {
  useStoreIsolation({ file: 'people', memory: people }, { file: 'scim-groups', memory: scimGroups });

  let server: http.Server;
  let port: number;

  before(async () => {
    process.env.SCIM_BEARER_TOKEN = TOKEN;
    const app = express();
    app.use(express.json());
    app.use('/scim/v2', scimRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('creates a user, then reads it back by id', async () => {
    const created = await request(port, 'POST', '/scim/v2/Users', {
      userName: 'ada@example.com',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
      emails: [{ value: 'ada@example.com', primary: true }],
    });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.userName ?? created.body.emails?.[0]?.value, 'ada@example.com');
    const id = created.body.id;

    const got = await request(port, 'GET', `/scim/v2/Users/${id}`);
    assert.strictEqual(got.status, 200);
    assert.strictEqual(got.body.id, id);
  });

  it('rejects a duplicate email with 409', async () => {
    await request(port, 'POST', '/scim/v2/Users', {
      userName: 'grace@example.com', emails: [{ value: 'grace@example.com' }],
    });
    const dupe = await request(port, 'POST', '/scim/v2/Users', {
      userName: 'grace@example.com', emails: [{ value: 'grace@example.com' }],
    });
    assert.strictEqual(dupe.status, 409);
  });

  it('lists created users', async () => {
    await request(port, 'POST', '/scim/v2/Users', {
      userName: 'alan@example.com', emails: [{ value: 'alan@example.com' }],
    });
    const list = await request(port, 'GET', '/scim/v2/Users');
    assert.strictEqual(list.status, 200);
    assert.ok(list.body.totalResults >= 1);
    assert.ok(list.body.Resources.some((r: any) => r.userName === 'alan@example.com'
      || r.emails?.some((e: any) => e.value === 'alan@example.com')));
  });

  it('PATCH active=false deactivates; DELETE removes', async () => {
    const created = await request(port, 'POST', '/scim/v2/Users', {
      userName: 'edsger@example.com', emails: [{ value: 'edsger@example.com' }],
    });
    const id = created.body.id;

    const patched = await request(port, 'PATCH', `/scim/v2/Users/${id}`, {
      Operations: [{ op: 'replace', value: { active: false } }],
    });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(patched.body.active, false);

    const del = await request(port, 'DELETE', `/scim/v2/Users/${id}`);
    assert.strictEqual(del.status, 204);
    const gone = await request(port, 'GET', `/scim/v2/Users/${id}`);
    assert.strictEqual(gone.status, 404);
  });
});
