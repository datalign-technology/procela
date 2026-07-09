import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const agentsRouter = require('../routes/agents').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { agents } = require('../routes/agents');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {},
      },
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

describe('agents routes', () => {
  let server: http.Server;
  let port: number;
  const orgId = 'test-org-agents';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/agents', agentsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    const now = new Date().toISOString();
    organizations.push({
      id: orgId, parentId: null, name: 'Test Org', type: 'company',
      industry: '', description: '', headCount: 0, createdAt: now, updatedAt: now,
    });
  });

  after(async () => {
    const oi = organizations.findIndex((o: any) => o.id === orgId);
    if (oi !== -1) organizations.splice(oi, 1);
    // Drop any agent created under the test org so we don't pollute persistence.
    for (let i = agents.length - 1; i >= 0; i--) {
      if (agents[i].orgIds.includes(orgId)) agents.splice(i, 1);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('POST / creates an agent with defaults', async () => {
    const res = await request(port, 'POST', '/agents', {
      name: 'Daily Billing ETL',
      orgIds: [orgId],
      agentType: 'PIPELINE',
      provider: 'Airflow',
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.agentType, 'PIPELINE');
    // Default is PAUSED — see the responsible-person invariant. An
    // agent can't be created ACTIVE without also assigning an owner.
    assert.strictEqual(res.body.data.status, 'PAUSED');
    assert.deepStrictEqual(res.body.data.orgIds, [orgId]);
  });

  it('POST / rejects a request with no orgIds', async () => {
    const res = await request(port, 'POST', '/agents', { name: 'Orphan', orgIds: [] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /at least one organization/i);
  });

  it('POST / rejects an unknown org', async () => {
    const res = await request(port, 'POST', '/agents', { name: 'X', orgIds: ['nope'] });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /not found/i);
  });

  it('POST / coerces unknown types to OTHER', async () => {
    const res = await request(port, 'POST', '/agents', { name: 'Odd', orgIds: [orgId], agentType: 'MAGIC' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.agentType, 'OTHER');
  });

  it('GET / filters by orgId', async () => {
    const res = await request(port, 'GET', `/agents?orgId=${encodeURIComponent(orgId)}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.every((a: any) => a.orgIds.includes(orgId)));
    assert.ok(Array.isArray(res.body.agentTypes));
    assert.ok(res.body.agentTypes.includes('AI'));
  });

  it('PUT /:id updates mutable fields', async () => {
    const created = await request(port, 'POST', '/agents', { name: 'To Update', orgIds: [orgId] });
    const id = created.body.data.id;
    const res = await request(port, 'PUT', `/agents/${id}`, { description: 'now explained', status: 'PAUSED' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.description, 'now explained');
    assert.strictEqual(res.body.data.status, 'PAUSED');
  });

  it('POST /import accepts CSV with an orgId', async () => {
    const res = await request(port, 'POST', '/agents/import', {
      orgId,
      csv: 'Name,Type,Provider,Description\nNightly Sync,PIPELINE,Airflow,Syncs overnight\nChat Helper,AI,Anthropic,Answers user questions\n',
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.length, 2);
    assert.strictEqual(res.body.data.every((a: any) => a.orgIds.includes(orgId)), true);
  });

  it('DELETE /:id removes the agent', async () => {
    const created = await request(port, 'POST', '/agents', { name: 'Kill Me', orgIds: [orgId] });
    const id = created.body.data.id;
    const del = await request(port, 'DELETE', `/agents/${id}`);
    assert.strictEqual(del.status, 204);
    const get = await request(port, 'GET', `/agents/${id}`);
    assert.strictEqual(get.status, 404);
  });
});
