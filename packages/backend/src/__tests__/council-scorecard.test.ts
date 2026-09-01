// Council Scorecard: derive computes per-division measures + an enterprise
// rollup from live data; save is gated to editors (admin OR CDO/DGL).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const councilRouter = require('../routes/council-scorecard').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { councilScorecards } = require('../routes/council-scorecard');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceExceptions } = require('../routes/governance-exceptions');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { damaRoles } = require('../routes/dama-roles');

const P = 'csc-';
function req(port: number, method: string, path: string, body?: unknown, user?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    if (user) headers['x-test-user'] = JSON.stringify(user);
    const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let c = ''; res.on('data', (d) => { c += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: c ? JSON.parse(c) : null }); } catch { resolve({ status: res.statusCode || 0, body: c }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

describe('Council Scorecard', () => {
  let server: http.Server; let port: number;
  const parent = P + 'ent', divA = P + 'divA', divB = P + 'divB', divC = P + 'divC';
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();

  before(async () => {
    const app = express();
    app.use(express.json());
    // Fake auth: read x-test-user header into req.user.
    app.use((r: any, _res, next) => { const h = r.headers['x-test-user']; if (h) r.user = JSON.parse(h); next(); });
    app.use('/council-scorecard', councilRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    organizations.push(
      { id: parent, parentId: null, name: 'Enterprise', type: 'company', industry: '', description: '', headCount: 0 },
      { id: divA, parentId: parent, name: 'Division A', type: 'division', industry: '', description: '', headCount: 0 },
      { id: divB, parentId: parent, name: 'Division B', type: 'division', industry: '', description: '', headCount: 0 },
      // Division C: empty — no domains, assets, issues, or exceptions.
      { id: divC, parentId: parent, name: 'Division C', type: 'division', industry: '', description: '', headCount: 0 },
    );
    // Division A: 2 tier-1 domains, both owned → coverage 100. 1 asset classified of 2 → 50%.
    dataDomains.push(
      { id: P + 'd1', orgId: divA, name: 'D1', description: '', ownerId: 'p1', stewardIds: [], dataAssetIds: [], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
      { id: P + 'd2', orgId: divA, name: 'D2', description: '', ownerId: 'p1', stewardIds: [], dataAssetIds: [], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
      // Division B: 2 tier-1 domains, 1 owned → coverage 50.
      { id: P + 'd3', orgId: divB, name: 'D3', description: '', ownerId: 'p1', stewardIds: [], dataAssetIds: [], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
      { id: P + 'd4', orgId: divB, name: 'D4', description: '', ownerId: null, stewardIds: [], dataAssetIds: [], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
    );
    dataAssets.push(
      { id: P + 'a1', orgId: divA, name: 'A1', description: '', governanceTier: 'BRONZE', healthScore: 0, sensitivityTags: ['PII'], createdAt: now, updatedAt: now },
      { id: P + 'a2', orgId: divA, name: 'A2', description: '', governanceTier: 'BRONZE', healthScore: 0, createdAt: now, updatedAt: now },
    );
    // One exception past expiry in Division B.
    governanceExceptions.push({ id: P + 'e1', orgId: divB, title: 'Waiver', status: 'ACTIVE', grantedAt: old, expiresAt: old, createdAt: old, updatedAt: old });
    // A CDO person for role-gating test.
    people.push({ id: P + 'cdo', name: 'Dana CDO', email: 'dana.cdo@example.com', role: 'VIEWER', createdAt: now, updatedAt: now } as any);
    damaRoles.push({ id: P + 'r1', personId: P + 'cdo', roleType: 'CDO', scopeType: 'ORG', scopeId: parent } as any);
  });

  after(async () => {
    for (const store of [organizations, dataDomains, dataAssets, governanceExceptions, councilScorecards, people, damaRoles]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const row = store[i];
        if ((row.id && String(row.id).startsWith(P)) || row.orgId === parent || row.orgId === divA || row.orgId === divB) store.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('derives per-division measures and an enterprise rollup', async () => {
    const res = await req(port, 'GET', `/council-scorecard/derive?orgId=${parent}`, undefined, { id: 'u', role: 'ORG_ADMIN', email: 'a@x.com' });
    assert.strictEqual(res.status, 200);
    const d = res.body.data;
    const a = d.divisions.find((r: any) => r.orgId === divA);
    const b = d.divisions.find((r: any) => r.orgId === divB);
    assert.strictEqual(a.coverage, 100);          // 2 of 2 tier-1 owned
    assert.strictEqual(a.classification, 50);      // 1 of 2 assets classified
    assert.strictEqual(b.coverage, 50);            // 1 of 2 tier-1 owned
    assert.strictEqual(b.exceptions, 1);           // one past-expiry exception
    // Enterprise rollup = union of both divisions: 3 of 4 tier-1 owned = 75.
    assert.strictEqual(d.enterprise.coverage, 75);
    assert.strictEqual(d.enterprise.exceptions, 1);
    assert.strictEqual(d.canEdit, true);           // ORG_ADMIN can edit
    assert.ok(d.narrative.whatMoved && d.narrative.forCouncil);
  });

  it('reports a neutral "No data" status for an empty division', async () => {
    const res = await req(port, 'GET', `/council-scorecard/derive?orgId=${parent}`, undefined, { id: 'u', role: 'ORG_ADMIN', email: 'a@x.com' });
    const c = res.body.data.divisions.find((r: any) => r.orgId === divC);
    assert.strictEqual(c.coverage, null);        // no tier-1 domains
    assert.strictEqual(c.classification, null);  // no assets
    assert.strictEqual(c.openIssues, 0);
    assert.strictEqual(c.exceptions, 0);
    assert.strictEqual(c.status, 'No data');     // neutral, not "Behind"
  });

  it('lets a CDO edit but blocks a plain viewer', async () => {
    const cdo = { id: P + 'cdo', role: 'VIEWER', email: 'dana.cdo@example.com' };
    const viewer = { id: 'v', role: 'VIEWER', email: 'nobody@example.com' };
    const derive = (await req(port, 'GET', `/council-scorecard/derive?orgId=${parent}`, undefined, viewer)).body.data;
    assert.strictEqual(derive.canEdit, false);

    const blocked = await req(port, 'POST', '/council-scorecard', { orgId: parent }, viewer);
    assert.strictEqual(blocked.status, 403);

    const saved = await req(port, 'POST', '/council-scorecard', { orgId: parent, overrides: { [`${divA}.coverage`]: 82 }, narrative: { whatMoved: 'x' } }, cdo);
    assert.strictEqual(saved.status, 201);
    assert.strictEqual(saved.body.data.overrides[`${divA}.coverage`], 82);

    const list = await req(port, 'GET', `/council-scorecard?orgId=${parent}`, undefined, cdo);
    assert.strictEqual(list.body.data.length, 1);
    assert.strictEqual(list.body.data[0].createdBy, P + 'cdo');
  });
});
