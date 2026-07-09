// Change-management review workflow (statusMode === 'review').
//
// Verifies the state machine + accountability plumbing:
//   - DRAFT → PENDING_REVIEW records the submitter + timestamp + comment
//   - PENDING_REVIEW → ACTIVE records the reviewer + timestamp
//   - PENDING_REVIEW → DRAFT clears review metadata (new cycle)
//   - Segregation of duties: submitter cannot approve their own change
//     but can withdraw it (→ DRAFT allowed by same person)
//   - Illegal transitions (skip PENDING_REVIEW) rejected
//
// User identity is threaded via req.user.sub. We fake a middleware
// that reads a header so tests can act as different people.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const processCatalogRouter = require('../routes/process-catalog').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');

function request(port: number, method: string, path: string, body?: unknown, actorId?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: {
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {}),
          ...(actorId ? { 'x-test-actor': actorId } : {}),
        },
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

describe('review workflow — DRAFT → PENDING_REVIEW → ACTIVE', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-review-';
  const orgId = PREFIX + 'org';
  const vsId = PREFIX + 'vs';
  const procId = PREFIX + 'proc';
  const spId = PREFIX + 'sp';
  const actId = PREFIX + 'act';
  const submitter = PREFIX + 'alice';
  const reviewer = PREFIX + 'bob';

  before(async () => {
    if (!organizations.find((o: any) => o.id === orgId)) {
      const now = new Date().toISOString();
      organizations.push({
        id: orgId, name: 'Test Org', type: 'company', parentId: null,
        statusMode: 'review',
        createdAt: now, updatedAt: now,
      });
    } else {
      const org = organizations.find((o: any) => o.id === orgId);
      org.statusMode = 'review';
    }
    const app = express();
    app.use(express.json());
    // Fake auth middleware — reads x-test-actor and populates req.user.sub
    // so the route's identity checks fire with a known identity.
    app.use((req: any, _res, next) => {
      const actor = req.headers['x-test-actor'];
      if (actor) req.user = { sub: actor };
      next();
    });
    app.use('/process-catalog', processCatalogRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(processNodes, (n: any) => n.id?.startsWith(PREFIX));

    const now = new Date().toISOString();
    const base = {
      orgId, orgIds: [orgId], ownerId: null, status: 'DRAFT',
      orderIndex: 0, version: 1, activityId: null, description: '',
      createdAt: now, updatedAt: now,
    };
    processNodes.push({ ...base, id: vsId, level: 'VALUE_STREAM', name: 'VS', parentId: null });
    processNodes.push({ ...base, id: procId, level: 'PROCESS', name: 'Proc', parentId: vsId });
    processNodes.push({ ...base, id: spId, level: 'SUB_PROCESS', name: 'SP', parentId: procId });
    processNodes.push({ ...base, id: actId, level: 'ACTIVITY', name: 'Act', parentId: spId });
  });

  it('DRAFT → PENDING_REVIEW records submitter, timestamp, and comment', async () => {
    const res = await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'PENDING_REVIEW', reviewComment: 'Adding weather feed dependency.' },
      submitter);
    assert.strictEqual(res.status, 200);
    const node = processNodes.find((n: any) => n.id === actId);
    assert.strictEqual(node.status, 'PENDING_REVIEW');
    assert.strictEqual(node.submittedBy, submitter);
    assert.ok(node.submittedAt);
    assert.strictEqual(node.reviewComment, 'Adding weather feed dependency.');
    assert.strictEqual(node.reviewedBy, undefined);
  });

  it('rejects DRAFT → ACTIVE (must go through PENDING_REVIEW)', async () => {
    const res = await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'ACTIVE' },
      submitter);
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Cannot transition/);
  });

  it('reviewer approves — PENDING_REVIEW → ACTIVE records reviewer', async () => {
    await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'PENDING_REVIEW' },
      submitter);
    const res = await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'ACTIVE', reviewComment: 'Looks good.' },
      reviewer);
    assert.strictEqual(res.status, 200);
    const node = processNodes.find((n: any) => n.id === actId);
    assert.strictEqual(node.status, 'ACTIVE');
    assert.strictEqual(node.reviewedBy, reviewer);
    assert.ok(node.reviewedAt);
    assert.strictEqual(node.reviewComment, 'Looks good.');
  });

  it('segregation of duties — submitter cannot approve their own change', async () => {
    await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'PENDING_REVIEW' },
      submitter);
    const res = await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'ACTIVE' },
      submitter);
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /submitter cannot approve/);
    // Node stays PENDING_REVIEW.
    assert.strictEqual(
      processNodes.find((n: any) => n.id === actId).status,
      'PENDING_REVIEW',
    );
  });

  it('submitter can withdraw their own change — PENDING_REVIEW → DRAFT allowed', async () => {
    await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'PENDING_REVIEW' },
      submitter);
    const res = await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'DRAFT', reviewComment: 'Withdrawn — needs more work' },
      submitter);
    assert.strictEqual(res.status, 200);
    const node = processNodes.find((n: any) => n.id === actId);
    // PENDING_REVIEW → DRAFT tracks the acting person as reviewer
    // (they made the last decision on the item), then clears the
    // metadata below when the row is subsequently reactivated.
    assert.strictEqual(node.status, 'DRAFT');
    assert.strictEqual(node.reviewedBy, submitter);
  });

  it('reviewer requests changes — PENDING_REVIEW → DRAFT records reviewer + comment', async () => {
    await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'PENDING_REVIEW' },
      submitter);
    const res = await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'DRAFT', reviewComment: 'Add success measure before resubmitting' },
      reviewer);
    assert.strictEqual(res.status, 200);
    const node = processNodes.find((n: any) => n.id === actId);
    assert.strictEqual(node.status, 'DRAFT');
    assert.strictEqual(node.reviewedBy, reviewer);
    assert.strictEqual(node.reviewComment, 'Add success measure before resubmitting');
  });

  it('resubmitting after rejection clears the prior reviewer metadata', async () => {
    // Submit, reject, resubmit — the fresh cycle should not carry the
    // earlier reviewer's approval note.
    await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'PENDING_REVIEW' }, submitter);
    await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'DRAFT', reviewComment: 'Nope' }, reviewer);
    await request(port, 'PUT', `/process-catalog/nodes/${actId}`,
      { status: 'PENDING_REVIEW', reviewComment: 'Second pass, addressed feedback' }, submitter);
    const node = processNodes.find((n: any) => n.id === actId);
    assert.strictEqual(node.submittedBy, submitter);
    assert.strictEqual(node.reviewedBy, undefined, 'prior reviewer decision cleared on fresh submission');
    assert.strictEqual(node.reviewComment, 'Second pass, addressed feedback');
  });
});
