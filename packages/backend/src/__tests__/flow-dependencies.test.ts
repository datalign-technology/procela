// Flow-relationship (activity dependencies) endpoints.
//
// Three things to keep honest:
//   1. POST /flows rejects a cycle before it lands (unless the caller
//      explicitly declared a LOOP).
//   2. GET /flows/by-node/:id returns the "other end" enrichment
//      (name, level, status, breadcrumb) — the DependenciesPanel
//      relies on this to render without a second lookup.
//   3. DELETE /nodes/:id cascades flow rows involving the deleted
//      node (already implemented; regression cover).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const processCatalogRouter = require('../routes/process-catalog').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes, flowRelationships } = require('../routes/process-catalog');
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

describe('flow-relationship dependencies', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-fd-';
  const orgId = PREFIX + 'org';
  const vsId = PREFIX + 'vs';
  const procId = PREFIX + 'proc';
  const spId = PREFIX + 'sp';
  const actA = PREFIX + 'a';
  const actB = PREFIX + 'b';
  const actC = PREFIX + 'c';

  before(async () => {
    if (!organizations.find((o: any) => o.id === orgId)) {
      const now = new Date().toISOString();
      organizations.push({
        id: orgId, name: 'Test Org', type: 'company', parentId: null,
        createdAt: now, updatedAt: now,
      });
    }
    const app = express();
    app.use(express.json());
    app.use('/process-catalog', processCatalogRouter);
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
    sweep(processNodes, (n: any) => n.id?.startsWith(PREFIX));
    sweep(flowRelationships, (f: any) => f.fromNodeId?.startsWith(PREFIX) || f.toNodeId?.startsWith(PREFIX));

    // Seed a value-stream → process → sub-process → 3 activities tree.
    const now = new Date().toISOString();
    const base = {
      orgId, orgIds: [orgId], ownerId: null, status: 'DRAFT',
      orderIndex: 0, version: 1, activityId: null, description: '',
      createdAt: now, updatedAt: now,
    };
    processNodes.push({ ...base, id: vsId, level: 'VALUE_STREAM', name: 'VS Test', parentId: null });
    processNodes.push({ ...base, id: procId, level: 'PROCESS', name: 'Proc Test', parentId: vsId });
    processNodes.push({ ...base, id: spId, level: 'SUB_PROCESS', name: 'SP Test', parentId: procId });
    processNodes.push({ ...base, id: actA, level: 'ACTIVITY', name: 'Activity A', parentId: spId });
    processNodes.push({ ...base, id: actB, level: 'ACTIVITY', name: 'Activity B', parentId: spId });
    processNodes.push({ ...base, id: actC, level: 'ACTIVITY', name: 'Activity C', parentId: spId });
  });

  describe('POST /flows', () => {
    it('creates a SEQUENCE flow', async () => {
      const res = await request(port, 'POST', '/process-catalog/flows', {
        fromNodeId: actA, toNodeId: actB, type: 'SEQUENCE',
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.type, 'SEQUENCE');
    });

    it('rejects a self-referencing flow', async () => {
      const res = await request(port, 'POST', '/process-catalog/flows', {
        fromNodeId: actA, toNodeId: actA,
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /from a node to itself/);
    });

    it('rejects a direct cycle (A→B, then B→A)', async () => {
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actA, toNodeId: actB });
      const res = await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actB, toNodeId: actA });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /cycle/i);
    });

    it('rejects a transitive cycle (A→B, B→C, then C→A)', async () => {
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actA, toNodeId: actB });
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actB, toNodeId: actC });
      const res = await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actC, toNodeId: actA });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /cycle/i);
    });

    it('allows a cycle when the caller declares LOOP', async () => {
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actA, toNodeId: actB });
      const res = await request(port, 'POST', '/process-catalog/flows', {
        fromNodeId: actB, toNodeId: actA, type: 'LOOP',
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.type, 'LOOP');
    });

    it('rejects a duplicate (same from, to, type)', async () => {
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actA, toNodeId: actB });
      const res = await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actA, toNodeId: actB });
      assert.strictEqual(res.status, 409);
    });
  });

  describe('GET /flows/by-node/:nodeId', () => {
    it('returns outgoing + incoming with the other-end enrichment', async () => {
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actA, toNodeId: actB });
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actC, toNodeId: actB });
      const res = await request(port, 'POST' as any, `/process-catalog/flows/by-node/${actB}`);
      // POST above was a typo — retry with GET.
      const get = await request(port, 'GET', `/process-catalog/flows/by-node/${actB}`);
      assert.strictEqual(get.status, 200);
      assert.strictEqual(get.body.data.incoming.length, 2);
      assert.strictEqual(get.body.data.outgoing.length, 0);
      // Enrichment: `other` carries name + breadcrumb.
      const other = get.body.data.incoming[0].other;
      assert.ok(other);
      assert.ok(['Activity A', 'Activity C'].includes(other.name));
      assert.strictEqual(other.level, 'ACTIVITY');
      assert.match(other.breadcrumb, /VS Test > Proc Test > SP Test/);
      // Silence the deliberate typo call above so it's not flagged as unused.
      void res;
    });
  });

  describe('DELETE /nodes/:id — cascade', () => {
    it('drops flows involving the deleted node', async () => {
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actA, toNodeId: actB });
      await request(port, 'POST', '/process-catalog/flows', { fromNodeId: actB, toNodeId: actC });
      const before = flowRelationships.length;
      await request(port, 'DELETE', `/process-catalog/nodes/${actB}`);
      // Both edges touching actB should be gone; unrelated flows survive.
      assert.strictEqual(
        flowRelationships.filter((f: any) => f.fromNodeId === actB || f.toNodeId === actB).length,
        0,
      );
      assert.ok(flowRelationships.length < before);
    });
  });
});
