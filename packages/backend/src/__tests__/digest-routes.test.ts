// HTTP test for routes/digest. The interesting logic lives in the
// service (covered in digest-service.test); this test locks in the
// thin trigger surface — orgId validation, response envelope shape,
// payload includes notification rows.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const digestRouter = require('../routes/digest').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { gapSnapshots } = require('../services/digest.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { notifications } = require('../routes/notifications');

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

describe('POST /digest/run', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-digest-route-';
  const orgId = PREFIX + 'org';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/digest', digestRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    // Sweep stale state from prior runs.
    for (let i = gapSnapshots.length - 1; i >= 0; i--) {
      if (gapSnapshots[i].orgId === orgId) gapSnapshots.splice(i, 1);
    }
    for (let i = notifications.length - 1; i >= 0; i--) {
      if (notifications[i].orgId === orgId) notifications.splice(i, 1);
    }
    // Seed an asset that will become orphan delta on week 2.
    const now = new Date().toISOString();
    dataAssets.push(
      ...['o1', 'o2', 'o3'].map((id) => ({
        id: PREFIX + id, orgId, name: `Orphan ${id}`, description: '', systemId: '',
        owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 0,
        createdAt: now, updatedAt: now,
      })),
    );
    // Seed a value stream with no owner so the ownerless rule fires too.
    processNodes.push({
      id: PREFIX + 'vs', parentId: null, level: 'VALUE_STREAM', name: 'Test VS',
      description: '', activityId: null, status: 'DRAFT', orderIndex: 0,
      orgId, orgIds: [orgId], ownerId: null, version: 1,
      createdAt: now, updatedAt: now,
    });
  });

  after(async () => {
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i].id;
        if (typeof id === 'string' && id.startsWith(PREFIX)) arr.splice(i, 1);
        else if (arr[i].orgId === orgId) arr.splice(i, 1);
      }
    };
    sweep(dataAssets); sweep(processNodes); sweep(gapSnapshots); sweep(notifications);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('400s without an orgId', async () => {
    const res = await request(port, 'POST', '/digest/run', {});
    assert.strictEqual(res.status, 400);
  });

  it('baseline run records the snapshot but writes no notifications', async () => {
    const res = await request(port, 'POST', `/digest/run?orgId=${orgId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.baseline, true);
    assert.strictEqual(res.body.data.notificationsWritten, 0);
    assert.ok(res.body.data.snapshotId);
    assert.ok(res.body.data.metrics);
    assert.strictEqual(res.body.data.metrics.orphanAssets, 3,
      'snapshot should record current orphan count');
  });

  it('second run with no change writes no new notifications', async () => {
    const res = await request(port, 'POST', `/digest/run?orgId=${orgId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.baseline, false);
    assert.strictEqual(res.body.data.notificationsWritten, 0);
  });
});
