// Data asset certification workflow (docs/CERTIFICATION_DESIGN.md).
// Exercises request → approve / reject / revoke with RBAC, the no-owner
// hard guard, segregation of duties, and the reviewer queue.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Private JSON persistence dir so these in-memory seeds never touch the
// shared store (mirrors demo-seed.test.ts).
process.env.PROCELA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'procela-cert-'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { damaRoles } = require('../routes/dama-roles');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceTasks } = require('../routes/governance-tasks');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { notifications } = require('../routes/notifications');

const ORG = 'cert-test-org';

function request(
  port: number, method: string, path: string,
  opts: { body?: unknown; email?: string; role?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(opts.email ? { 'x-test-email': opts.email } : {}),
          ...(opts.role ? { 'x-test-role': opts.role } : {}),
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

describe('Data asset certification workflow', () => {
  let server: http.Server;
  let port: number;
  const ts = new Date().toISOString();
  const ownerId = 'cert-owner';
  const cdoId = 'cert-cdo';
  const otherId = 'cert-other';
  const assetId = 'cert-asset';
  const noOwnerAssetId = 'cert-asset-noowner';
  const domainId = 'cert-domain';

  function resetAsset() {
    const a = dataAssets.find((x: any) => x.id === assetId);
    Object.assign(a, {
      governanceTier: 'SILVER', certificationStatus: 'NONE',
      certificationRequestedById: null, certificationRequestedAt: null,
      certificationReviewedById: null, certificationReviewedAt: null,
      certifiedUntil: null, certificationNote: null,
    });
  }

  before(async () => {
    const app = express();
    app.use(express.json());
    // Fake auth — mints req.user from x-test-email / x-test-role headers.
    app.use((req: any, _res, next) => {
      const email = req.headers['x-test-email'];
      const role = req.headers['x-test-role'] || 'EDITOR';
      req.user = { sub: email || 'dev', role, email };
      next();
    });
    app.use('/data-assets', dataAssetsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    organizations.push({ id: ORG, name: 'Cert Test Co', type: 'company', parentId: null, industry: 'utilities', createdAt: ts, updatedAt: ts });
    people.push(
      { id: ownerId, orgIds: [ORG], accessibleOrgIds: [ORG], name: 'Olivia Owner', email: 'owner@cert.test', role: 'EDITOR', active: true, skillIds: [], createdAt: ts, updatedAt: ts },
      { id: cdoId, orgIds: [ORG], accessibleOrgIds: [ORG], name: 'Cara CDO', email: 'cdo@cert.test', role: 'EDITOR', active: true, skillIds: [], createdAt: ts, updatedAt: ts },
      { id: otherId, orgIds: [ORG], accessibleOrgIds: [ORG], name: 'Nate NotOwner', email: 'other@cert.test', role: 'EDITOR', active: true, skillIds: [], createdAt: ts, updatedAt: ts },
    );
    damaRoles.push({ id: 'cert-role-cdo', personId: cdoId, agentId: null, agentName: null, roleType: 'CDO', scopeType: 'ORG', scopeId: ORG, since: ts, createdAt: ts });
    dataAssets.push(
      { id: assetId, orgId: ORG, name: 'Cert Target', description: 'An asset under certification.', systemId: '', owner: '', ownerPersonId: ownerId, stewardIds: [], governanceTier: 'SILVER', healthScore: 90, certificationStatus: 'NONE', createdAt: ts, updatedAt: ts },
      { id: noOwnerAssetId, orgId: ORG, name: 'Unowned Asset', description: 'No owner assigned.', systemId: '', owner: '', ownerPersonId: null, stewardIds: [], governanceTier: 'BRONZE', healthScore: 20, certificationStatus: 'NONE', createdAt: ts, updatedAt: ts },
    );
    dataDomains.push({ id: domainId, orgId: ORG, code: 'CRT', name: 'Cert Domain', description: '', ownerId: null, stewardIds: [], dataAssetIds: [assetId], status: 'ACTIVE', createdAt: ts, updatedAt: ts });
  });

  after(async () => {
    for (const arr of [dataAssets, people, dataDomains, damaRoles, organizations]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i]?.id || '';
        if (typeof id === 'string' && id.startsWith('cert-')) arr.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('owner can request certification → PENDING_REVIEW', async () => {
    resetAsset();
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test', body: { note: 'Ready for Gold' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.certificationStatus, 'PENDING_REVIEW');
    assert.strictEqual(res.body.data.certificationRequestedById, ownerId);
    assert.strictEqual(res.body.data.certificationNote, 'Ready for Gold');
  });

  it('requesting opens an APPROVAL review task assigned to the reviewer + notifies', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    const task = governanceTasks.find((t: any) => t.linkedObjectType === 'DataAsset' && t.linkedObjectId === assetId && t.taskType === 'APPROVAL' && t.status === 'OPEN');
    assert.ok(task, 'expected an open APPROVAL review task linked to the asset');
    assert.strictEqual(task.assigneeId, cdoId, 'task is assigned to the CDO reviewer (domain has no owner)');
    const note = notifications.find((n: any) => n.link === `/data-assets/${assetId}` && n.type === 'ACTION');
    assert.ok(note, 'expected an ACTION notification to the reviewer');
    assert.strictEqual(note.userId, cdoId);
  });

  it('approving resolves the review task (COMPLETED) + notifies the requester', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    await request(port, 'POST', `/data-assets/${assetId}/certification/approve`, { email: 'cdo@cert.test' });
    const openTask = governanceTasks.find((t: any) => t.linkedObjectId === assetId && t.taskType === 'APPROVAL' && t.status === 'OPEN');
    assert.ok(!openTask, 'the review task should no longer be OPEN');
    const done = governanceTasks.find((t: any) => t.linkedObjectId === assetId && t.taskType === 'APPROVAL' && t.status === 'COMPLETED');
    assert.ok(done, 'the review task should be COMPLETED');
    const note = notifications.find((n: any) => n.link === `/data-assets/${assetId}` && n.userId === ownerId && n.type === 'INFO');
    assert.ok(note, 'requester gets an INFO notification on approval');
  });

  it('rejecting cancels the review task', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    await request(port, 'POST', `/data-assets/${assetId}/certification/reject`, { email: 'cdo@cert.test', body: { note: 'Not yet' } });
    const openTask = governanceTasks.find((t: any) => t.linkedObjectId === assetId && t.taskType === 'APPROVAL' && t.status === 'OPEN');
    assert.ok(!openTask, 'the review task should no longer be OPEN');
    const cancelled = governanceTasks.find((t: any) => t.linkedObjectId === assetId && t.taskType === 'APPROVAL' && t.status === 'CANCELLED');
    assert.ok(cancelled, 'the review task should be CANCELLED');
  });

  it('a non-owner, non-admin cannot request', async () => {
    resetAsset();
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'other@cert.test' });
    assert.strictEqual(res.status, 403);
  });

  it('cannot request certification on an asset with no owner', async () => {
    const res = await request(port, 'POST', `/data-assets/${noOwnerAssetId}/certification/request`, { email: 'super@cert.test', role: 'SUPER_ADMIN' });
    assert.strictEqual(res.status, 422);
    assert.match(res.body.error, /owner/i);
  });

  it('cannot request twice — 409 when not NONE', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    assert.strictEqual(res.status, 409);
  });

  it('a CDO can approve → CERTIFIED, Gold, recert date set', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/approve`, { email: 'cdo@cert.test' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.certificationStatus, 'CERTIFIED');
    assert.strictEqual(res.body.data.governanceTier, 'GOLD');
    assert.strictEqual(res.body.data.certificationReviewedById, cdoId);
    assert.ok(new Date(res.body.data.certifiedUntil).getTime() > Date.now());
  });

  it('segregation of duties — the requester cannot approve, even as admin', async () => {
    resetAsset();
    // An admin requests (allowed), then the same admin tries to approve.
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'admin@cert.test', role: 'SUPER_ADMIN' });
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/approve`, { email: 'admin@cert.test', role: 'SUPER_ADMIN' });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /requester cannot/i);
  });

  it('a non-reviewer cannot approve', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/approve`, { email: 'other@cert.test' });
    assert.strictEqual(res.status, 403);
  });

  it('reject requires a reason and returns to NONE without demoting', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    const noNote = await request(port, 'POST', `/data-assets/${assetId}/certification/reject`, { email: 'cdo@cert.test', body: {} });
    assert.strictEqual(noNote.status, 422);
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/reject`, { email: 'cdo@cert.test', body: { note: 'Health below bar' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.certificationStatus, 'NONE');
    assert.strictEqual(res.body.data.governanceTier, 'SILVER'); // tier unchanged on reject
    assert.strictEqual(res.body.data.certificationNote, 'Health below bar');
  });

  it('revoke a certified asset → NONE, demoted to Silver', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    await request(port, 'POST', `/data-assets/${assetId}/certification/approve`, { email: 'cdo@cert.test' });
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/revoke`, { email: 'cdo@cert.test', body: { note: 'Definition drifted' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.certificationStatus, 'NONE');
    assert.strictEqual(res.body.data.governanceTier, 'SILVER');
    assert.strictEqual(res.body.data.certifiedUntil, null);
  });

  it('revoke 409s when the asset is not certified', async () => {
    resetAsset();
    const res = await request(port, 'POST', `/data-assets/${assetId}/certification/revoke`, { email: 'cdo@cert.test' });
    assert.strictEqual(res.status, 409);
  });

  it('the certification queue lists only PENDING_REVIEW assets in scope', async () => {
    resetAsset();
    await request(port, 'POST', `/data-assets/${assetId}/certification/request`, { email: 'owner@cert.test' });
    const res = await request(port, 'GET', `/data-assets/certification-queue?orgId=${ORG}`, { email: 'cdo@cert.test' });
    assert.strictEqual(res.status, 200);
    const ids = res.body.data.map((a: any) => a.id);
    assert.ok(ids.includes(assetId), 'pending asset is in the queue');
    assert.ok(!ids.includes(noOwnerAssetId), 'a NONE asset is not in the queue');
  });
});
