// Data-domain name/code uniqueness rules:
//   - a domain NAME is unique among its siblings (same org + same parent),
//     NOT globally — so "Billing" can sit under two different parents, and a
//     sub-domain can share a name with an unrelated top-level domain.
//   - the structured CODE is the global handle: unique across the whole org.
// Exercised end-to-end against the JSON store, on create and on update.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataDomainsRouter = require('../routes/data-domains').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');

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

describe('data-domain name/code uniqueness', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-uniq-';
  const orgId = PREFIX + 'org';
  const otherOrgId = PREFIX + 'org2';

  const sweep = (arr: any[], pred: (r: any) => boolean) => { for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1); };

  before(async () => {
    sweep(dataDomains, (d: any) => d.orgId === orgId || d.orgId === otherOrgId);
    const app = express();
    app.use(express.json());
    app.use('/data-domains', dataDomainsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    sweep(dataDomains, (d: any) => d.orgId === orgId || d.orgId === otherOrgId);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('rejects a duplicate top-level name in the same org, but allows it in another org', async () => {
    const a = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Customer', orgId });
    assert.strictEqual(a.status, 201);

    const dup = await request(port, 'POST', '/data-domains', { name: PREFIX + 'customer', orgId });
    assert.strictEqual(dup.status, 409, 'case-insensitive duplicate top-level name should be rejected');
    assert.match(dup.body.error, /top level/i);

    const otherOrg = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Customer', orgId: otherOrgId });
    assert.strictEqual(otherOrg.status, 201, 'same name in a different org is fine');
  });

  it('allows the same sub-domain name under two different parents', async () => {
    const p1 = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Sales', orgId });
    const p2 = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Finance', orgId });
    assert.strictEqual(p1.status, 201);
    assert.strictEqual(p2.status, 201);

    const s1 = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Billing', orgId, parentDomainId: p1.body.data.id });
    const s2 = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Billing', orgId, parentDomainId: p2.body.data.id });
    assert.strictEqual(s1.status, 201, 'Billing under Sales');
    assert.strictEqual(s2.status, 201, 'Billing under Finance — same name, different parent, allowed');
    assert.notStrictEqual(s1.body.data.code, s2.body.data.code, 'auto-suggested codes stay distinct');
  });

  it('rejects two siblings with the same name under one parent', async () => {
    const parent = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Ops', orgId });
    const first = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Grid', orgId, parentDomainId: parent.body.data.id });
    assert.strictEqual(first.status, 201);
    const dupSibling = await request(port, 'POST', '/data-domains', { name: PREFIX + 'grid', orgId, parentDomainId: parent.body.data.id });
    assert.strictEqual(dupSibling.status, 409, 'a duplicate sibling name is rejected');
    assert.match(dupSibling.body.error, /parent domain/i);
  });

  it('rejects a duplicate user-supplied code across the whole org', async () => {
    const a = await request(port, 'POST', '/data-domains', { name: PREFIX + 'CodeA', orgId, code: 'ZTAKEN' });
    assert.strictEqual(a.status, 201);
    assert.strictEqual(a.body.data.code, 'ZTAKEN');

    const clash = await request(port, 'POST', '/data-domains', { name: PREFIX + 'CodeB', orgId, code: 'ztaken' });
    assert.strictEqual(clash.status, 409, 'a code already used in the org is rejected (case-insensitive)');
    assert.match(clash.body.error, /code/i);
  });

  it('rejects a rename that collides with a sibling, but allows an unrelated rename', async () => {
    const parent = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Cat', orgId });
    const alpha = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Alpha', orgId, parentDomainId: parent.body.data.id });
    const beta = await request(port, 'POST', '/data-domains', { name: PREFIX + 'Beta', orgId, parentDomainId: parent.body.data.id });
    assert.strictEqual(alpha.status, 201);
    assert.strictEqual(beta.status, 201);

    const collide = await request(port, 'PUT', `/data-domains/${beta.body.data.id}`, { name: PREFIX + 'Alpha' });
    assert.strictEqual(collide.status, 409, 'renaming Beta to Alpha (a sibling) is rejected');

    // Beta was NOT mutated by the rejected update.
    const betaAfter = await request(port, 'GET', `/data-domains/${beta.body.data.id}`);
    assert.strictEqual(betaAfter.body.data.name, PREFIX + 'Beta');

    const ok = await request(port, 'PUT', `/data-domains/${beta.body.data.id}`, { name: PREFIX + 'Gamma' });
    assert.strictEqual(ok.status, 200, 'an unused name is accepted');
    assert.strictEqual(ok.body.data.name, PREFIX + 'Gamma');
  });
});
