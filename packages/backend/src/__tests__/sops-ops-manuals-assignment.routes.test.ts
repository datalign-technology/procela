// Layer-2 (per-record "assigned" scoping) wired into the two remaining
// CONTRIBUTOR-writable process-bucket routers: sops and operations-manuals.
//
// Both routers are mounted here WITHOUT authenticateToken (unit-test style);
// a tiny stub middleware injects `req.user` from an `x-test-user` header so
// we can exercise the CONTRIBUTOR-403 path that enforceAssignment gates.
// enforceAssignment passes through when there is no user, so the existing
// no-auth tests for these routers are unaffected.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sopsRouter = require('../routes/sops').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sops } = require('../routes/sops');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const opsRouter = require('../routes/operations-manuals').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { operationsManuals } = require('../routes/operations-manuals');

type User = { sub: string; role: string };

// NB: request paths in these tests use only compile-time-constant ids
// (the PREFIX seeds). We deliberately never interpolate a value read back
// from a response body or from the file-backed module stores into a path —
// CodeQL flags either as tainted data reaching an outbound request
// (js/request-forgery, js/file-access-to-http). "Create-owns" is asserted
// on the POST response; "can edit/delete own" uses a pre-seeded record the
// contributor owns, addressed by its constant id.
function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  user?: User,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    if (user) headers['x-test-user'] = JSON.stringify(user);
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

const PREFIX = 'test-l2-';
const orgId = PREFIX + 'org';
const OWNER = 'person-owner';
const CONTRIB = { sub: 'person-contrib', role: 'CONTRIBUTOR' };
const OTHER_CONTRIB = { sub: 'person-other', role: 'CONTRIBUTOR' };
const EDITOR = { sub: 'person-editor', role: 'EDITOR' };

describe('layer-2 assigned scoping — sops & operations-manuals routes', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const h = req.headers['x-test-user'];
      if (typeof h === 'string') { try { (req as any).user = JSON.parse(h); } catch { /* ignore */ } }
      next();
    });
    app.use('/sops', sopsRouter);
    app.use('/operations-manuals', opsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    // Sweep both the PREFIX seeds and anything created during a test under
    // our (unique) test orgId — POST-created rows get uuid ids and are
    // persisted via saveStore, so without the orgId clause a leaked row
    // survives on disk across runs.
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id?.startsWith(PREFIX) || arr[i].orgId === orgId) arr.splice(i, 1);
      }
    };
    sweep(sops);
    sweep(operationsManuals);
    const now = new Date().toISOString();
    // A SOP owned by someone other than our test contributor…
    sops.push({
      id: PREFIX + 's-owned', orgId, code: 'SOP-900', title: 'Owned SOP',
      purpose: '', category: 'OTHER', applicableRoles: [], triggerEvent: '',
      steps: [], status: 'DRAFT', version: 1, ownerPersonId: OWNER,
      createdAt: now, updatedAt: now,
    });
    // …and one the test contributor owns.
    sops.push({
      id: PREFIX + 's-mine', orgId, code: 'SOP-901', title: 'My SOP',
      purpose: '', category: 'OTHER', applicableRoles: [], triggerEvent: '',
      steps: [], status: 'DRAFT', version: 1, ownerPersonId: CONTRIB.sub,
      createdAt: now, updatedAt: now,
    });
    // A manual owned by someone else…
    operationsManuals.push({
      id: PREFIX + 'm-owned', orgId, roleType: 'CUSTOM', label: 'Owned Manual',
      purpose: '', daily: [], weekly: [], monthly: [], quarterly: [], escalation: [],
      customContent: '', isCustom: true, ownerPersonId: OWNER,
      createdAt: now, updatedAt: now,
    });
    // …and one the test contributor owns.
    operationsManuals.push({
      id: PREFIX + 'm-mine', orgId, roleType: 'CUSTOM', label: 'My Manual',
      purpose: '', daily: [], weekly: [], monthly: [], quarterly: [], escalation: [],
      customContent: '', isCustom: true, ownerPersonId: CONTRIB.sub,
      createdAt: now, updatedAt: now,
    });
  });

  // ── sops ──

  it('sops: CONTRIBUTOR create with no owner becomes the owner', async () => {
    const res = await request(port, 'POST', '/sops', { orgId, title: 'Mine' }, CONTRIB);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.ownerPersonId, CONTRIB.sub);
  });

  it('sops: CONTRIBUTOR can edit a SOP assigned to them', async () => {
    const res = await request(port, 'PUT', `/sops/${PREFIX}s-mine`, { title: 'My SOP v2' }, CONTRIB);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.title, 'My SOP v2');
  });

  it('sops: CONTRIBUTOR is 403 editing a SOP owned by someone else', async () => {
    const res = await request(port, 'PUT', `/sops/${PREFIX}s-owned`, { title: 'hijack' }, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('sops: CONTRIBUTOR is 403 deleting a SOP owned by someone else', async () => {
    const res = await request(port, 'DELETE', `/sops/${PREFIX}s-owned`, undefined, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('sops: EDITOR may edit any SOP (org-wide write, exempt from layer 2)', async () => {
    const res = await request(port, 'PUT', `/sops/${PREFIX}s-owned`, { title: 'edited' }, EDITOR);
    assert.strictEqual(res.status, 200);
  });

  // ── operations-manuals ──

  it('ops-manuals: CONTRIBUTOR create with no owner becomes the owner', async () => {
    const res = await request(port, 'POST', '/operations-manuals', { orgId, label: 'Mine' }, CONTRIB);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.ownerPersonId, CONTRIB.sub);
  });

  it('ops-manuals: CONTRIBUTOR can edit a manual assigned to them', async () => {
    const res = await request(port, 'PUT', `/operations-manuals/${PREFIX}m-mine`, { label: 'My Manual v2' }, CONTRIB);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.label, 'My Manual v2');
  });

  it('ops-manuals: CONTRIBUTOR is 403 editing a manual owned by someone else', async () => {
    const res = await request(port, 'PUT', `/operations-manuals/${PREFIX}m-owned`, { label: 'hijack' }, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('ops-manuals: CONTRIBUTOR is 403 deleting a manual owned by someone else', async () => {
    const res = await request(port, 'DELETE', `/operations-manuals/${PREFIX}m-owned`, undefined, OTHER_CONTRIB);
    assert.strictEqual(res.status, 403);
  });

  it('ops-manuals: EDITOR may edit any manual (org-wide write, exempt from layer 2)', async () => {
    const res = await request(port, 'PUT', `/operations-manuals/${PREFIX}m-owned`, { label: 'edited' }, EDITOR);
    assert.strictEqual(res.status, 200);
  });
});
