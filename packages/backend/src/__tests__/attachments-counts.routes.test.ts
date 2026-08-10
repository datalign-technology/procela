// GET /attachments/counts — bulk per-entity attachment counts in one
// round-trip so a caller rendering many entities (the process-catalog tree)
// can show per-node "Attach (n)" badges without one fetch per node.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const attachmentsRouter = require('../routes/attachments').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attachments } = require('../routes/attachments');

function request(port: number, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const PREFIX = 'test-attcount-';
const orgId = PREFIX + 'org';
const otherOrg = PREFIX + 'org2';

describe('GET /attachments/counts', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use('/attachments', attachmentsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    for (let i = attachments.length - 1; i >= 0; i--) {
      if (attachments[i].id?.startsWith(PREFIX)) attachments.splice(i, 1);
    }
    const now = new Date().toISOString();
    const seed = (over: Record<string, unknown>) => attachments.push({
      id: PREFIX + Math.random().toString(36).slice(2), orgId,
      entityType: 'ProcessNode', entityId: 'n1', type: 'URL',
      name: 'ref', description: '', url: 'https://x',
      uploadedBy: null, createdAt: now, updatedAt: now, ...over,
    });
    // n1 → 2, n2 → 1 (ProcessNode, our org)
    seed({ entityId: 'n1' });
    seed({ entityId: 'n1' });
    seed({ entityId: 'n2' });
    // Different entityType — must not leak into a ProcessNode count.
    seed({ entityId: 'n1', entityType: 'DataAsset' });
    // Different org — must not leak when scoped by orgId.
    seed({ entityId: 'n1', orgId: otherOrg });
  });

  it('groups counts by entityId for the given entityType + orgId', async () => {
    const res = await request(port, `/attachments/counts?entityType=ProcessNode&orgId=${orgId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.n1, 2);
    assert.strictEqual(res.body.data.n2, 1);
  });

  it('does not count other entityTypes or other orgs', async () => {
    const res = await request(port, `/attachments/counts?entityType=ProcessNode&orgId=${orgId}`);
    // DataAsset n1 and the other-org n1 are excluded → n1 is 2, not 4.
    assert.strictEqual(res.body.data.n1, 2);
  });

  it('narrows to entityIds when provided; zero-attachment ids are absent', async () => {
    const res = await request(port, `/attachments/counts?entityType=ProcessNode&orgId=${orgId}&entityIds=n2,n3`);
    assert.strictEqual(res.body.data.n2, 1);
    assert.strictEqual(res.body.data.n1, undefined); // filtered out
    assert.strictEqual(res.body.data.n3, undefined); // no attachments
  });

  it('is not captured by the /:id route', async () => {
    const res = await request(port, `/attachments/counts?entityType=ProcessNode&orgId=${orgId}`);
    // A 200 with a counts map proves "counts" reached the counts handler,
    // not GET /:id (which would 404 for a missing "counts" attachment).
    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.body.data, 'object');
  });
});
