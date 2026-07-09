// Agent responsible-person invariant.
//
// The rule: an agent can only carry status = ACTIVE if it has a
// valid, non-deactivated ownerPersonId. Three enforcement points
// covered here:
//
//   1. POST /agents        — reject ACTIVE without a valid owner
//   2. PUT  /agents/:id    — same on activate; auto-pause on clear
//   3. DELETE /people/:id  — cascade auto-pause on active agents
//   4. POST /people/:id/deactivate — same cascade
//
// The route modules load their in-memory arrays from disk at boot,
// so we seed with a `test-agentinv-` prefix and sweep between each
// test to keep them idempotent.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const agentsRouter = require('../routes/agents').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { agents } = require('../routes/agents');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const peopleRouter = require('../routes/people').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceIssues } = require('../routes/governance-issues');

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

describe('Agent responsible-person invariant', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-agentinv-';
  const orgId = PREFIX + 'org';
  const personId = PREFIX + 'person';
  const agentId = PREFIX + 'agent';

  before(async () => {
    // Seed org so agent create / owner validation passes.
    if (!organizations.find((o: any) => o.id === orgId)) {
      organizations.push({
        id: orgId, name: 'Test Org', type: 'company', parentId: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }

    const app = express();
    app.use(express.json());
    app.use('/agents', agentsRouter);
    app.use('/people', peopleRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    // Sweep any lingering test rows so each test starts clean.
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(agents, (a: any) => a.id.startsWith(PREFIX) || a.name?.startsWith(PREFIX));
    sweep(people, (p: any) => p.id.startsWith(PREFIX) || p.email?.startsWith(PREFIX));
    sweep(governanceIssues, (i: any) => i.linkedAgentId?.startsWith(PREFIX));

    // Reseed the "responsible person" and an ACTIVE, owned agent.
    const now = new Date().toISOString();
    people.push({
      id: personId, orgIds: [orgId], accessibleOrgIds: [orgId],
      name: 'Test Person', email: PREFIX + 'p@example.com',
      role: 'VIEWER', title: '', skillIds: [], active: true,
      createdAt: now, updatedAt: now,
    });
    agents.push({
      id: agentId, orgIds: [orgId], name: PREFIX + 'agent',
      agentType: 'AI', description: '', provider: '',
      status: 'ACTIVE', ownerPersonId: personId,
      skillIds: [], instructions: '',
      createdAt: now, updatedAt: now,
    });
  });

  describe('POST /agents', () => {
    it('rejects ACTIVE with no ownerPersonId', async () => {
      const res = await request(port, 'POST', '/agents', {
        name: PREFIX + 'bare', orgIds: [orgId], agentType: 'AI',
        status: 'ACTIVE',
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /responsible person/i);
    });

    it('rejects ACTIVE with an unknown ownerPersonId', async () => {
      const res = await request(port, 'POST', '/agents', {
        name: PREFIX + 'bogus', orgIds: [orgId], agentType: 'AI',
        status: 'ACTIVE', ownerPersonId: 'does-not-exist',
      });
      assert.strictEqual(res.status, 400);
    });

    it('accepts PAUSED without an owner', async () => {
      const res = await request(port, 'POST', '/agents', {
        name: PREFIX + 'paused', orgIds: [orgId], agentType: 'AI',
        status: 'PAUSED',
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.status, 'PAUSED');
    });

    it('accepts ACTIVE with a valid owner', async () => {
      const res = await request(port, 'POST', '/agents', {
        name: PREFIX + 'ok', orgIds: [orgId], agentType: 'AI',
        status: 'ACTIVE', ownerPersonId: personId,
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.status, 'ACTIVE');
    });
  });

  describe('PUT /agents/:id', () => {
    it('rejects a transition to ACTIVE that leaves the owner empty', async () => {
      // Start from PAUSED to isolate the activate path.
      const seed = agents.find((a: any) => a.id === agentId);
      seed.status = 'PAUSED';
      seed.ownerPersonId = '';
      const res = await request(port, 'PUT', `/agents/${agentId}`, {
        status: 'ACTIVE',
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(agents.find((a: any) => a.id === agentId).status, 'PAUSED');
    });

    it('auto-pauses when the owner is cleared on an active agent', async () => {
      const res = await request(port, 'PUT', `/agents/${agentId}`, {
        ownerPersonId: '',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'PAUSED');
      assert.strictEqual(res.body.cascade.autoPaused, true);
      assert.ok(res.body.cascade.issueId, 'expected an ownership issue id in the cascade');
      // Governance issue was opened.
      const issue = governanceIssues.find((i: any) => i.linkedAgentId === agentId);
      assert.ok(issue, 'expected an OWNERSHIP issue linked to the agent');
      assert.strictEqual(issue.issueType, 'OWNERSHIP');
      assert.strictEqual(issue.severity, 'HIGH');
    });

    it('is idempotent — second owner-clear does not open a second issue', async () => {
      await request(port, 'PUT', `/agents/${agentId}`, { ownerPersonId: '' });
      const before = governanceIssues.filter((i: any) => i.linkedAgentId === agentId).length;
      // The agent is now PAUSED with no owner. Simulate a caller
      // touching the record again (e.g. a description edit).
      await request(port, 'PUT', `/agents/${agentId}`, { description: 'still no owner' });
      const after = governanceIssues.filter((i: any) => i.linkedAgentId === agentId).length;
      assert.strictEqual(after, before, 'no duplicate issue on subsequent writes');
    });
  });

  describe('DELETE /people/:id', () => {
    it('auto-pauses active agents owned by the deleted person', async () => {
      const res = await request(port, 'DELETE', `/people/${personId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.cascade.pausedAgents.length, 1);
      assert.strictEqual(res.body.cascade.pausedAgents[0].agentId, agentId);
      const agent = agents.find((a: any) => a.id === agentId);
      assert.strictEqual(agent.status, 'PAUSED');
      assert.strictEqual(agent.ownerPersonId, '', 'dangling owner reference should be cleared');
      const issue = governanceIssues.find((i: any) => i.linkedAgentId === agentId);
      assert.ok(issue);
    });

    it('returns 204 when the deleted person owns no active agents', async () => {
      // Move the agent to PAUSED so the delete has nothing to cascade.
      const seed = agents.find((a: any) => a.id === agentId);
      seed.status = 'PAUSED';
      const res = await request(port, 'DELETE', `/people/${personId}`);
      assert.strictEqual(res.status, 204);
    });
  });

  describe('POST /people/:id/deactivate', () => {
    it('auto-pauses active agents; leaves ownerPersonId so reactivation can restore the pairing', async () => {
      const res = await request(port, 'POST', `/people/${personId}/deactivate`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.cascade.pausedAgents.length, 1);
      const agent = agents.find((a: any) => a.id === agentId);
      assert.strictEqual(agent.status, 'PAUSED');
      assert.strictEqual(agent.ownerPersonId, personId, 'owner ref preserved through deactivate');
    });
  });

  describe('GET /people/:id/impact', () => {
    it('reports the active-agent count so the confirm dialog can warn', async () => {
      const res = await request(port, 'GET', `/people/${personId}/impact`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.activeAgents, 1);
    });
  });
});
