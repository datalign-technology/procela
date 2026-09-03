// HTTP coverage for the Business Capability level — the grouping tier ABOVE
// Data Domain (Business Capability -> Data Domain -> Sub-Domain). Mounts both
// the business-capabilities and data-domains routers and exercises the
// cross-entity behaviour: grouping a domain under a capability, the enriched
// name/count on both sides, the sub-domain inheritance guard, and the
// un-group-on-delete cascade. Runs against the JSON store (no DATABASE_URL);
// a unique orgId per run keeps it isolated from any persisted state.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const capabilitiesRouter = require('../routes/business-capabilities').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const domainsRouter = require('../routes/data-domains').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { aiService } = require('../services/ai.service');

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

describe('Business Capabilities (grouping level above Data Domain)', () => {
  let server: http.Server;
  let port: number;
  const orgId = `bc-test-${Date.now()}`;
  const originalGenerate = aiService.generateBusinessCapabilities?.bind(aiService);

  before(async () => {
    aiService.generateBusinessCapabilities = async (_industry: string) => [
      { name: 'Customer Management', description: 'Groups the customer domains.' },
      { name: 'Operations', description: 'Groups the operational domains.' },
    ];
    const app = express();
    app.use(express.json());
    app.use('/business-capabilities', capabilitiesRouter);
    app.use('/data-domains', domainsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    if (originalGenerate) aiService.generateBusinessCapabilities = originalGenerate;
    await new Promise<void>((r) => server.close(() => r()));
  });

  let capId = '';
  let domainId = '';

  it('creates a business capability with an auto-suggested code', async () => {
    const res = await request(port, 'POST', '/business-capabilities', { orgId, name: 'Customer Management' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.name, 'Customer Management');
    assert.ok(res.body.data.code, 'code auto-suggested');
    assert.strictEqual(res.body.data.domainCount, 0, 'no domains yet');
    capId = res.body.data.id;
  });

  it('rejects a duplicate capability name in the same org', async () => {
    const res = await request(port, 'POST', '/business-capabilities', { orgId, name: 'Customer Management' });
    assert.strictEqual(res.status, 409);
  });

  it('groups a top-level domain under the capability', async () => {
    const res = await request(port, 'POST', '/data-domains', { orgId, name: 'Customer Accounts', businessCapabilityId: capId });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.businessCapabilityId, capId);
    assert.strictEqual(res.body.data.businessCapabilityName, 'Customer Management', 'enriched capability name on the domain');
    domainId = res.body.data.id;
  });

  it('reports the domain on the capability (domainCount + domains[])', async () => {
    const res = await request(port, 'GET', `/business-capabilities/${capId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.domainCount, 1);
    assert.deepStrictEqual(res.body.data.domains.map((d: any) => d.name), ['Customer Accounts']);
  });

  it('rejects a capability from a different org', async () => {
    const other = await request(port, 'POST', '/business-capabilities', { orgId: `${orgId}-other`, name: 'Customer Management' });
    const res = await request(port, 'POST', '/data-domains', { orgId, name: 'Cross Org Domain', businessCapabilityId: other.body.data.id });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /different organization/i);
  });

  it('refuses to set a capability on a sub-domain (it inherits the parent\'s)', async () => {
    // Make a sub-domain under the grouped domain, then try to give it its own capability.
    const sub = await request(port, 'POST', '/data-domains', { orgId, name: 'Billing', parentDomainId: domainId });
    assert.strictEqual(sub.status, 201);
    const res = await request(port, 'PUT', `/data-domains/${sub.body.data.id}`, { businessCapabilityId: capId });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /inherits its capability/i);
    // But it still shows the inherited capability name (from its parent).
    const got = await request(port, 'GET', `/data-domains/${sub.body.data.id}`);
    assert.strictEqual(got.body.data.businessCapabilityName, 'Customer Management', 'sub-domain inherits parent capability');
  });

  it('un-groups its domains when the capability is deleted', async () => {
    const del = await request(port, 'DELETE', `/business-capabilities/${capId}`);
    assert.strictEqual(del.status, 204);
    const got = await request(port, 'GET', `/data-domains/${domainId}`);
    assert.strictEqual(got.status, 200);
    assert.ok(!got.body.data.businessCapabilityId, 'domain re-homed to ungrouped');
    assert.strictEqual(got.body.data.businessCapabilityName, null);
  });

  it('generates capability suggestions (preview, no commit)', async () => {
    const res = await request(port, 'POST', '/business-capabilities/generate', { industry: 'Utilities' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.length, 2);
    assert.strictEqual(res.body.data[0].name, 'Customer Management');
  });
});
