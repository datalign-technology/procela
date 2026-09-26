// Report folders drive a report's audience: a report in a shared folder (the
// system Public folder, or a user folder toggled shared) is org-visible; a
// report in a personal folder — or no folder — is private to its owner. This
// covers the folder CRUD, the Public folder's immutability, and the
// folder-derived access filtering on the reports list.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

/* eslint-disable @typescript-eslint/no-var-requires */
const reportsRouter = require('../routes/reports').default;
const { reports } = require('../routes/reports');
const reportFoldersRouter = require('../routes/report-folders').default;
const { reportFolders } = require('../routes/report-folders');
/* eslint-enable @typescript-eslint/no-var-requires */

let actingUser: { sub: string; role?: string } | null = null;

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

const ORG = 'test-rf-org';

describe('report folders + folder-driven sharing', () => {
  let server: http.Server;
  let port: number;

  const cleanup = () => {
    for (let i = reports.length - 1; i >= 0; i--) if (reports[i].orgId === ORG) reports.splice(i, 1);
    for (let i = reportFolders.length - 1; i >= 0; i--) if (reportFolders[i].orgId === ORG) reportFolders.splice(i, 1);
  };

  const seedReport = (id: string, ownerId: string | null, over: Record<string, unknown> = {}) => {
    const now = new Date().toISOString();
    reports.push({
      id, orgId: ORG, name: id, description: '', ownerId, folderId: null,
      visibility: 'private', definition: { entity: 'processNodes', columns: [], filters: [] },
      createdAt: now, updatedAt: now, ...over,
    });
  };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = actingUser || undefined; next(); });
    app.use('/report-folders', reportFoldersRouter);
    app.use('/reports', reportsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => { cleanup(); await new Promise<void>((r) => server.close(() => r())); });
  beforeEach(() => { cleanup(); actingUser = { sub: 'user-a' }; });

  const publicFolderId = async (): Promise<string> => {
    const res = await request(port, 'GET', `/report-folders?orgId=${ORG}`);
    return res.body.data.find((f: any) => f.kind === 'system').id;
  };

  it('ensures exactly one shared system Public folder, idempotently', async () => {
    await request(port, 'GET', `/report-folders?orgId=${ORG}`);
    const res = await request(port, 'GET', `/report-folders?orgId=${ORG}`);
    const systems = res.body.data.filter((f: any) => f.kind === 'system');
    assert.strictEqual(systems.length, 1);
    assert.strictEqual(systems[0].name, 'Public');
    assert.strictEqual(systems[0].shared, true);
  });

  it('creates a user folder; the Public folder is immutable', async () => {
    const created = await request(port, 'POST', '/report-folders', { orgId: ORG, name: 'Compliance' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.shared, false);
    assert.strictEqual(created.body.data.kind, 'user');

    const pub = await publicFolderId();
    const patch = await request(port, 'PATCH', `/report-folders/${pub}`, { name: 'Renamed' });
    assert.strictEqual(patch.status, 403);
    const del = await request(port, 'DELETE', `/report-folders/${pub}`);
    assert.strictEqual(del.status, 403);
  });

  it('hides a private report from a non-owner but shows a Public one', async () => {
    const pub = await publicFolderId();
    seedReport('rf-private', 'user-a');                    // owner-only
    seedReport('rf-public', 'user-a', { folderId: pub });  // shared via Public

    actingUser = { sub: 'user-b' };
    const list = await request(port, 'GET', `/reports?orgId=${ORG}`);
    const ids = list.body.data.map((r: any) => r.id);
    assert.ok(!ids.includes('rf-private'), 'non-owner must not see a private report');
    assert.ok(ids.includes('rf-public'), 'everyone sees a report in the Public folder');

    actingUser = { sub: 'user-a' };
    const own = await request(port, 'GET', `/reports?orgId=${ORG}`);
    assert.ok(own.body.data.map((r: any) => r.id).includes('rf-private'), 'owner sees their own private report');
  });

  it('backfills a legacy org-visible report (no folder) into Public', async () => {
    seedReport('rf-legacy', 'user-a', { visibility: 'org', folderId: null });
    actingUser = { sub: 'user-b' };
    const list = await request(port, 'GET', `/reports?orgId=${ORG}`);
    const row = list.body.data.find((r: any) => r.id === 'rf-legacy');
    assert.ok(row, 'legacy org report is visible to other users after backfill');
    const pub = await publicFolderId();
    assert.strictEqual(reports.find((r: any) => r.id === 'rf-legacy').folderId, pub);
  });

  it('moving a report to Public shares it; back to no folder makes it private again', async () => {
    const pub = await publicFolderId();
    seedReport('rf-move', 'user-a');
    // share it
    let put = await request(port, 'PUT', `/reports/rf-move`, { folderId: pub });
    assert.strictEqual(put.body.data.visibility, 'org');
    actingUser = { sub: 'user-b' };
    let list = await request(port, 'GET', `/reports?orgId=${ORG}`);
    assert.ok(list.body.data.map((r: any) => r.id).includes('rf-move'));
    // un-share it (owner moves it out)
    actingUser = { sub: 'user-a' };
    put = await request(port, 'PUT', `/reports/rf-move`, { folderId: null });
    assert.strictEqual(put.body.data.visibility, 'private');
    actingUser = { sub: 'user-b' };
    list = await request(port, 'GET', `/reports?orgId=${ORG}`);
    assert.ok(!list.body.data.map((r: any) => r.id).includes('rf-move'));
  });

  it('folds duplicate Public folders into one and repoints their reports', async () => {
    const now = new Date().toISOString();
    // Simulate a past race: two system Public folders. The earliest is canonical.
    reportFolders.push({ id: 'pub-old', orgId: ORG, name: 'Public', ownerId: null, kind: 'system', shared: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: now });
    reportFolders.push({ id: 'pub-dup', orgId: ORG, name: 'Public', ownerId: null, kind: 'system', shared: true, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: now });
    seedReport('rf-in-dup', 'user-a', { folderId: 'pub-dup', visibility: 'org' });

    const res = await request(port, 'GET', `/report-folders?orgId=${ORG}`);
    const systems = res.body.data.filter((f: any) => f.kind === 'system');
    assert.strictEqual(systems.length, 1, 'duplicate Public folders collapse to one');
    assert.strictEqual(systems[0].id, 'pub-old', 'the earliest Public folder is canonical');
    assert.strictEqual(reportFolders.find((f: any) => f.id === 'pub-dup'), undefined, 'the duplicate is deleted');
    assert.strictEqual(reports.find((r: any) => r.id === 'rf-in-dup').folderId, 'pub-old', 'its report is repointed, not left dangling');
  });

  it('lets an admin move another user\'s report into a folder', async () => {
    const pub = await publicFolderId();
    seedReport('rf-owned', 'owner-x'); // private, owned by someone else
    actingUser = { sub: 'admin-y', role: 'ORG_ADMIN' };
    const put = await request(port, 'PUT', '/reports/rf-owned', { folderId: pub });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.data.visibility, 'org', 'moving into Public shares it');
    assert.strictEqual(reports.find((r: any) => r.id === 'rf-owned').folderId, pub);
  });

  it('still blocks a non-admin non-owner from modifying a report', async () => {
    seedReport('rf-owned2', 'owner-x');
    actingUser = { sub: 'stranger' };
    const put = await request(port, 'PUT', '/reports/rf-owned2', { name: 'hax' });
    assert.strictEqual(put.status, 403);
  });

  it('orders user folders by orderIndex (Public pinned first); a reorder PATCH re-sorts them', async () => {
    await request(port, 'POST', '/report-folders', { orgId: ORG, name: 'Alpha' });
    await request(port, 'POST', '/report-folders', { orgId: ORG, name: 'Bravo' });
    await request(port, 'POST', '/report-folders', { orgId: ORG, name: 'Charlie' });

    const names = async () => (await request(port, 'GET', `/report-folders?orgId=${ORG}`)).body.data.map((f: any) => f.name);
    // Created in order ⇒ appended: Public first, then Alpha, Bravo, Charlie.
    assert.deepStrictEqual(await names(), ['Public', 'Alpha', 'Bravo', 'Charlie']);

    // Move Charlie to the front of the user folders (orderIndex 0), Alpha/Bravo after.
    const list = (await request(port, 'GET', `/report-folders?orgId=${ORG}`)).body.data.filter((f: any) => f.kind === 'user');
    const byName = (n: string) => list.find((f: any) => f.name === n).id;
    await request(port, 'PATCH', `/report-folders/${byName('Charlie')}`, { orderIndex: 0 });
    await request(port, 'PATCH', `/report-folders/${byName('Alpha')}`, { orderIndex: 1 });
    await request(port, 'PATCH', `/report-folders/${byName('Bravo')}`, { orderIndex: 2 });
    assert.deepStrictEqual(await names(), ['Public', 'Charlie', 'Alpha', 'Bravo']);
  });

  it('lets a non-owner reorder (orderIndex) but not rename another user\'s folder', async () => {
    const created = await request(port, 'POST', '/report-folders', { orgId: ORG, name: 'Owned', shared: true });
    const id = created.body.data.id;
    actingUser = { sub: 'someone-else' };
    // Reorder is positional — allowed for anyone who can see the folder.
    const reorder = await request(port, 'PATCH', `/report-folders/${id}`, { orderIndex: 9 });
    assert.strictEqual(reorder.status, 200);
    assert.strictEqual(reorder.body.data.orderIndex, 9);
    // Content edits stay owner-only.
    const rename = await request(port, 'PATCH', `/report-folders/${id}`, { name: 'Hijacked' });
    assert.strictEqual(rename.status, 403);
  });
});
