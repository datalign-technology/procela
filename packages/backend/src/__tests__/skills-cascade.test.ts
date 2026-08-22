// Skills — name-uniqueness on create + rename, and cascade on delete.
//
// Cover:
//   1. POST /skills rejects a duplicate name in the same org (409)
//   2. POST /skills accepts the same name in a different org
//   3. PUT /skills/:id rejects a rename that would collide
//   4. DELETE /skills/:id sweeps the id off people.skillIds,
//      agents.skillIds, and processNodes.requiredSkillIds

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const skillsRouter = require('../routes/skills').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { skills } = require('../routes/skills');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { agents } = require('../routes/agents');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
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

describe('skills — uniqueness + delete cascade', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-skill-';
  const orgA = PREFIX + 'org-a';
  const orgB = PREFIX + 'org-b';
  const personId = PREFIX + 'person';
  const agentId = PREFIX + 'agent';
  const nodeId = PREFIX + 'node';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/skills', skillsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    // Sweep any lingering test rows so this doesn't leak into other
    // suites in the same tsx --test run.
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(skills, (s: any) => s.orgId === orgA || s.orgId === orgB);
    sweep(people, (p: any) => p.id === personId);
    sweep(agents, (a: any) => a.id === agentId);
    sweep(processNodes, (n: any) => n.id === nodeId);
    sweep(organizations, (o: any) => o.id === orgA || o.id === orgB);
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(skills, (s: any) => s.orgId === orgA || s.orgId === orgB);
    sweep(people, (p: any) => p.id === personId);
    sweep(agents, (a: any) => a.id === agentId);
    sweep(processNodes, (n: any) => n.id === nodeId);
    sweep(organizations, (o: any) => o.id === orgA || o.id === orgB);
    // Skills can only be owned at company / division level, and the
    // two test orgs must be in separate hierarchies so filterByOrgScope
    // doesn't pull orgA's skills into orgB's visibility (that would
    // break the "same name in a DIFFERENT org" case).
    const now = new Date().toISOString();
    organizations.push(
      { id: orgA, parentId: null, name: 'Test Org A', type: 'company', industry: '', description: '', headCount: 0, createdAt: now, updatedAt: now },
      { id: orgB, parentId: null, name: 'Test Org B', type: 'company', industry: '', description: '', headCount: 0, createdAt: now, updatedAt: now },
    );
  });

  describe('POST /skills — name uniqueness', () => {
    it('rejects a duplicate name in the same org (409)', async () => {
      const first = await request(port, 'POST', '/skills', { orgId: orgA, name: 'Data Profiling' });
      assert.strictEqual(first.status, 201);
      const second = await request(port, 'POST', '/skills', { orgId: orgA, name: 'Data Profiling' });
      assert.strictEqual(second.status, 409);
      assert.match(second.body.error, /already exists/);
    });

    it('case-insensitive — "data profiling" collides with "Data Profiling"', async () => {
      await request(port, 'POST', '/skills', { orgId: orgA, name: 'Data Profiling' });
      const res = await request(port, 'POST', '/skills', { orgId: orgA, name: 'data profiling' });
      assert.strictEqual(res.status, 409);
    });

    it('accepts the same name in a DIFFERENT org', async () => {
      await request(port, 'POST', '/skills', { orgId: orgA, name: 'Data Profiling' });
      const res = await request(port, 'POST', '/skills', { orgId: orgB, name: 'Data Profiling' });
      assert.strictEqual(res.status, 201);
    });
  });

  describe('PUT /skills/:id — rename collision', () => {
    it('rejects a rename that would collide with a sibling in the same org', async () => {
      const a = await request(port, 'POST', '/skills', { orgId: orgA, name: 'Skill A' });
      const b = await request(port, 'POST', '/skills', { orgId: orgA, name: 'Skill B' });
      const res = await request(port, 'PUT', `/skills/${b.body.data.id}`, { name: 'Skill A' });
      assert.strictEqual(res.status, 409);
      // Sanity — the own-row match on `b` renaming to its own name is fine.
      const noop = await request(port, 'PUT', `/skills/${b.body.data.id}`, { name: 'Skill B' });
      assert.strictEqual(noop.status, 200);
      void a;
    });
  });

  describe('DELETE /skills/:id — cascade', () => {
    it('sweeps the id off every person, agent, and process node that referenced it', async () => {
      const created = await request(port, 'POST', '/skills', { orgId: orgA, name: 'Anomaly Detection' });
      const skillId = created.body.data.id;

      // Wire the skill into one person, one agent, and one process node.
      const now = new Date().toISOString();
      people.push({
        id: personId, orgIds: [orgA], accessibleOrgIds: [orgA],
        name: 'Test Person', email: 'test@ex.com',
        role: 'VIEWER', title: '', skillIds: [skillId, 'other-skill'],
        active: true, createdAt: now, updatedAt: now,
      });
      agents.push({
        id: agentId, orgIds: [orgA], name: 'Test Agent',
        agentType: 'AI', description: '', provider: '', status: 'PAUSED',
        ownerPersonId: '', skillIds: [skillId], instructions: '',
        createdAt: now, updatedAt: now,
      });
      processNodes.push({
        id: nodeId, parentId: null, level: 'ACTIVITY', name: 'Test Activity',
        description: '', activityId: null, status: 'DRAFT', orderIndex: 0,
        orgId: orgA, orgIds: [orgA], ownerId: null, version: 1,
        requiredSkillIds: [skillId, 'other-skill'],
        createdAt: now, updatedAt: now,
      });

      const del = await request(port, 'DELETE', `/skills/${skillId}`);
      assert.strictEqual(del.status, 200);
      assert.strictEqual(del.body.cascade.peopleTouched, 1);
      assert.strictEqual(del.body.cascade.agentsTouched, 1);
      assert.strictEqual(del.body.cascade.nodesTouched, 1);

      // Verify the id is gone from every reference table.
      const p = people.find((x: any) => x.id === personId);
      const a = agents.find((x: any) => x.id === agentId);
      const n = processNodes.find((x: any) => x.id === nodeId);
      assert.deepStrictEqual(p.skillIds, ['other-skill'], 'person should keep other skills');
      assert.deepStrictEqual(a.skillIds, [], 'agent should be emptied');
      assert.deepStrictEqual(n.requiredSkillIds, ['other-skill'], 'node should keep other required skills');
    });

    it('reports zero cascade counts when nothing referenced the skill', async () => {
      const created = await request(port, 'POST', '/skills', { orgId: orgA, name: 'Unused Skill' });
      const del = await request(port, 'DELETE', `/skills/${created.body.data.id}`);
      assert.strictEqual(del.status, 200);
      assert.strictEqual(del.body.cascade.peopleTouched, 0);
      assert.strictEqual(del.body.cascade.agentsTouched, 0);
      assert.strictEqual(del.body.cascade.nodesTouched, 0);
    });

    it('clears requiredSkillIds when the last required skill goes', async () => {
      const created = await request(port, 'POST', '/skills', { orgId: orgA, name: 'Only Skill' });
      const skillId = created.body.data.id;
      const now = new Date().toISOString();
      processNodes.push({
        id: nodeId, parentId: null, level: 'ACTIVITY', name: 'Test',
        description: '', activityId: null, status: 'DRAFT', orderIndex: 0,
        orgId: orgA, orgIds: [orgA], ownerId: null, version: 1,
        requiredSkillIds: [skillId],
        createdAt: now, updatedAt: now,
      });
      await request(port, 'DELETE', `/skills/${skillId}`);
      const n = processNodes.find((x: any) => x.id === nodeId);
      // The deleted id is swept; the node ends with no required skills. The
      // cascade now writes an empty array (not undefined) so the same code
      // path clears the M2M in Postgres mode too.
      assert.deepStrictEqual(n.requiredSkillIds, []);
    });
  });
});
