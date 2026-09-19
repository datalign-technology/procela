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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governancePrograms } = require('../routes/governance-program');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceIssues } = require('../routes/governance-issues');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');

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
        if ((row.id && String(row.id).startsWith(P)) || row.orgId === parent || row.orgId === divA || row.orgId === divB || row.orgId === divC) store.splice(i, 1);
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
    // All four thresholds ship in one payload so the UI labels can't drift.
    assert.deepStrictEqual(d.targets, { coverage: 80, classification: 70, openIssues: 0, exceptions: 0, openIssuesDays: 30 });
  });

  it('honours per-tenant scorecard targets when set on the scoped org', async () => {
    const admin = { id: 'u', role: 'ORG_ADMIN', email: 'a@x.com' };
    // Division A on its own: coverage 100, classification 50, 0 issues/exceptions.
    // Under the default classification target (70) that's "Behind"; lower the
    // bar to 40 on divA and it should read "On track".
    const before = (await req(port, 'GET', `/council-scorecard/derive?orgId=${divA}`, undefined, admin)).body.data;
    assert.strictEqual(before.targets.classification, 70);
    assert.strictEqual(before.enterprise.status, 'Behind');

    const orgA = organizations.find((o: { id: string }) => o.id === divA)!;
    (orgA as { scorecardTargets?: unknown }).scorecardTargets = { coverage: 80, classification: 40, openIssues: 0, exceptions: 0, openIssuesDays: 30 };
    try {
      const after = (await req(port, 'GET', `/council-scorecard/derive?orgId=${divA}`, undefined, admin)).body.data;
      assert.strictEqual(after.targets.classification, 40);   // custom target shipped in payload
      assert.strictEqual(after.enterprise.status, 'On track'); // 50 >= 40 now clears the bar
    } finally {
      delete (orgA as { scorecardTargets?: unknown }).scorecardTargets;
    }
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

  it('replaces a same-period snapshot in place with replaceId, else stacks a new one', async () => {
    // Save against the empty divC so counts are isolated from the other
    // suites' saves (tests share the in-memory store and may interleave).
    const admin = { id: 'u', role: 'ORG_ADMIN', email: 'a@x.com' };
    const count = async () => (await req(port, 'GET', `/council-scorecard?orgId=${divC}`, undefined, admin)).body.data.length;

    // First save — a brand-new version.
    const first = await req(port, 'POST', '/council-scorecard', { orgId: divC, narrative: { whatMoved: 'v1' } }, admin);
    assert.strictEqual(first.status, 201);
    const idA = first.body.data.id;
    assert.strictEqual(await count(), 1);

    // Replace it — same id kept, list count unchanged, content refreshed.
    const replaced = await req(port, 'POST', '/council-scorecard', { orgId: divC, replaceId: idA, narrative: { whatMoved: 'v2' } }, admin);
    assert.strictEqual(replaced.status, 200);
    assert.strictEqual(replaced.body.data.id, idA);
    assert.strictEqual(replaced.body.data.narrative.whatMoved, 'v2');
    assert.strictEqual(await count(), 1);

    // Save again without replaceId — a new, additional version.
    const second = await req(port, 'POST', '/council-scorecard', { orgId: divC, narrative: { whatMoved: 'v3' } }, admin);
    assert.strictEqual(second.status, 201);
    assert.notStrictEqual(second.body.data.id, idA);
    assert.strictEqual(await count(), 2);

    // Replacing a version that belongs to another org is rejected.
    const badReplace = await req(port, 'POST', '/council-scorecard', { orgId: parent, replaceId: idA }, admin);
    assert.strictEqual(badReplace.status, 404);
  });
});

// The governed lens narrows the measures to the entities the program governs
// (its resolved scope), and stamps every scorecard with the scope version so a
// saved snapshot records the basis it was measured against.
describe('Council Scorecard — governed lens', () => {
  let server: http.Server; let port: number;
  const L = 'lscp-';
  const parent = L + 'ent', divA = L + 'divA', noProg = L + 'noprog';
  const dG = L + 'dG', dU = L + 'dU', aG = L + 'aG', aU = L + 'aU';
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
  const changedAt = '2026-09-01T00:00:00.000Z';
  const admin = { id: 'u', role: 'ORG_ADMIN', email: 'a@x.com' };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((r: any, _res, next) => { const h = r.headers['x-test-user']; if (h) r.user = JSON.parse(h); next(); });
    app.use('/council-scorecard', councilRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    organizations.push(
      { id: parent, parentId: null, name: 'Enterprise', type: 'company', industry: '', description: '', headCount: 0 },
      { id: divA, parentId: parent, name: 'Division A', type: 'division', industry: '', description: '', headCount: 0 },
      { id: noProg, parentId: null, name: 'No-Program Co', type: 'company', industry: '', description: '', headCount: 0 },
    );
    // Two tier-1 domains under divA: dG is governed (owned + in scope), dU is
    // out of scope (and unowned). aG is dG's asset (classified); aU is a stray
    // out-of-scope asset (unclassified).
    dataDomains.push(
      { id: dG, orgId: divA, name: 'Governed', description: '', ownerId: 'p1', stewardIds: [], dataAssetIds: [aG], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
      { id: dU, orgId: divA, name: 'Ungoverned', description: '', ownerId: null, stewardIds: [], dataAssetIds: [aU], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
    );
    dataAssets.push(
      { id: aG, orgId: divA, name: 'AG', description: '', governanceTier: 'GOLD', healthScore: 0, sensitivityTags: ['PII'], createdAt: now, updatedAt: now },
      { id: aU, orgId: divA, name: 'AU', description: '', governanceTier: 'BRONZE', healthScore: 0, createdAt: now, updatedAt: now },
    );
    // One open (>30d) issue on each asset — the out-of-scope one drops away
    // under the governed lens because its asset isn't in scope.
    governanceIssues.push(
      { id: L + 'iG', orgId: divA, status: 'OPEN', createdAt: old, domainId: dG, dataAssetId: aG } as any,
      { id: L + 'iU', orgId: divA, status: 'OPEN', createdAt: old, domainId: dU, dataAssetId: aU } as any,
    );
    // A past-expiry exception on divA — org-level, so it stays counted under
    // both lenses (exceptions carry no entity link to scope by).
    governanceExceptions.push({ id: L + 'e1', orgId: divA, title: 'Waiver', status: 'ACTIVE', grantedAt: old, expiresAt: old, createdAt: old, updatedAt: old } as any);
    // The program governs only dG (⇒ dG + aG in scope), at scope version 3.
    governancePrograms.push({
      id: L + 'prog', orgId: parent, name: 'P',
      scope: { inScope: '', outOfScope: '', boundaries: '', constraints: '', systemIds: [], domainIds: [dG], valueStreamIds: [], includeIds: [], excludeIds: [] },
      scopeVersion: 3, scopeChangedAt: changedAt,
    } as any);
  });

  after(async () => {
    for (const store of [organizations, dataDomains, dataAssets, governanceIssues, governanceExceptions, governancePrograms, councilScorecards]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const row = store[i];
        if ((row.id && String(row.id).startsWith(L)) || row.orgId === parent || row.orgId === divA || row.orgId === noProg) store.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('all lens (default): counts every entity, stamps the scope version but does not narrow', async () => {
    const d = (await req(port, 'GET', `/council-scorecard/derive?orgId=${parent}`, undefined, admin)).body.data;
    // Both tier-1 domains counted; only one owned ⇒ 50%. Both assets; one
    // classified ⇒ 50%. Both open issues counted.
    assert.strictEqual(d.enterprise.coverage, 50);
    assert.strictEqual(d.enterprise.classification, 50);
    assert.strictEqual(d.enterprise.openIssues, 2);
    assert.strictEqual(d.scope.lens, 'all');
    assert.strictEqual(d.scope.applied, false);
    assert.strictEqual(d.scope.version, 3);      // stamped regardless of lens
    assert.strictEqual(d.scope.changedAt, changedAt);
  });

  it('governed lens: narrows to the governed entities and marks the scope applied', async () => {
    const d = (await req(port, 'GET', `/council-scorecard/derive?orgId=${parent}&lens=governed`, undefined, admin)).body.data;
    // Only dG (owned) ⇒ 100%. Only aG (classified) ⇒ 100%. Only iG's asset is
    // in scope ⇒ 1 open issue.
    assert.strictEqual(d.enterprise.coverage, 100);
    assert.strictEqual(d.enterprise.classification, 100);
    assert.strictEqual(d.enterprise.openIssues, 1);
    // Exceptions are org-level, so the past-expiry waiver still counts.
    assert.strictEqual(d.enterprise.exceptions, 1);
    assert.strictEqual(d.scope.lens, 'governed');
    assert.strictEqual(d.scope.applied, true);
    assert.strictEqual(d.scope.version, 3);
  });

  it('governed lens with no program defined is a safe no-op (govern everything)', async () => {
    const d = (await req(port, 'GET', `/council-scorecard/derive?orgId=${noProg}&lens=governed`, undefined, admin)).body.data;
    assert.strictEqual(d.scope.lens, 'governed');
    assert.strictEqual(d.scope.applied, false);   // nothing to narrow
    assert.strictEqual(d.scope.version, null);     // no program ⇒ no version
  });

  it('a snapshot saved under the governed lens stores governed numbers + the scope version', async () => {
    const saved = await req(port, 'POST', '/council-scorecard', { orgId: parent, lens: 'governed', narrative: { whatMoved: 'g' } }, admin);
    assert.strictEqual(saved.status, 201);
    assert.strictEqual(saved.body.data.derived.scope.applied, true);
    assert.strictEqual(saved.body.data.derived.scope.version, 3);
    assert.strictEqual(saved.body.data.derived.enterprise.coverage, 100);
  });
});

// Value drivers (ROI Phase 1): leading indicators derived from the catalog —
// ownership coverage, an "open risk" proxy that trends down, and remediation
// velocity (issues resolved in 30d + mean days-to-resolve).
describe('Council Scorecard — value drivers', () => {
  let server: http.Server; let port: number;
  const V = 'vd-';
  const org = V + 'org';
  const admin = { id: 'u', role: 'ORG_ADMIN', email: 'a@x.com' };
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((r: any, _res, next) => { const h = r.headers['x-test-user']; if (h) r.user = JSON.parse(h); next(); });
    app.use('/council-scorecard', councilRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    organizations.push({ id: org, parentId: null, name: 'VD Co', type: 'company', industry: '', description: '', headCount: 0 });
    // 2 tier-1 domains: one owned (holds the classified asset), one not.
    dataDomains.push(
      { id: V + 'dO', orgId: org, name: 'Owned', description: '', ownerId: 'p1', stewardIds: [], dataAssetIds: [V + 'aC'], criticality: 'TIER_1', status: 'ACTIVE', createdAt: iso(now), updatedAt: iso(now) },
      { id: V + 'dU', orgId: org, name: 'Unowned', description: '', ownerId: null, stewardIds: [], dataAssetIds: [], criticality: 'TIER_1', status: 'ACTIVE', createdAt: iso(now), updatedAt: iso(now) },
    );
    // A value stream (ROI Phase 3): Billing → one activity, which maps to both
    // the classified+owned asset (aC) and the unclassified one (aU).
    processNodes.push(
      { id: V + 'vs', orgId: org, orgIds: [org], parentId: null, level: 'VALUE_STREAM', name: 'Billing', description: '', activityId: 'VS-9001', status: 'ACTIVE', orderIndex: 0, ownerId: null, version: 1 },
      { id: V + 'act', orgId: org, orgIds: [org], parentId: V + 'vs', level: 'ACTIVITY', name: 'Meter read', description: '', activityId: 'AC-9001', status: 'ACTIVE', orderIndex: 0, ownerId: null, version: 1 },
    );
    mappings.push(
      { id: V + 'm1', orgId: org, processStepId: V + 'act', dataAssetId: V + 'aC', linkType: 'USES', notes: '', aiSuggested: false, userOverridden: false, createdBy: 'u', createdAt: iso(now), updatedAt: iso(now) },
      { id: V + 'm2', orgId: org, processStepId: V + 'act', dataAssetId: V + 'aU', linkType: 'USES', notes: '', aiSuggested: false, userOverridden: false, createdBy: 'u', createdAt: iso(now), updatedAt: iso(now) },
    );
    // 2 assets: one classified + owned, one neither.
    dataAssets.push(
      { id: V + 'aC', orgId: org, name: 'AC', description: '', governanceTier: 'GOLD', healthScore: 0, ownerPersonId: 'p1', sensitivityTags: ['PII'], createdAt: iso(now), updatedAt: iso(now) },
      { id: V + 'aU', orgId: org, name: 'AU', description: '', governanceTier: 'BRONZE', healthScore: 0, createdAt: iso(now), updatedAt: iso(now) },
    );
    // One past-expiry exception.
    governanceExceptions.push({ id: V + 'e1', orgId: org, title: 'W', status: 'ACTIVE', grantedAt: iso(now - 45 * 864e5), expiresAt: iso(now - 10 * 864e5), createdAt: iso(now - 45 * 864e5), updatedAt: iso(now) });
    // One resolved issue (created 7d ago, closed 2d ago ⇒ 5-day cycle) + one open.
    governanceIssues.push(
      { id: V + 'iR', orgId: org, status: 'RESOLVED', createdAt: iso(now - 7 * 864e5), closedAt: iso(now - 2 * 864e5) } as any,
      { id: V + 'iO', orgId: org, status: 'OPEN', createdAt: iso(now - 3 * 864e5), closedAt: null } as any,
    );
  });

  after(async () => {
    for (const store of [organizations, dataDomains, dataAssets, governanceExceptions, governanceIssues, councilScorecards, processNodes, mappings]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const row = store[i];
        if ((row.id && String(row.id).startsWith(V)) || row.orgId === org) store.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('reports ownership coverage, an open-risk proxy, and remediation velocity', async () => {
    const d = (await req(port, 'GET', `/council-scorecard/derive?orgId=${org}`, undefined, admin)).body.data;
    const vd = d.valueDrivers;
    // 1 of 2 domains + 1 of 2 assets owned ⇒ 2/4 = 50%.
    assert.deepStrictEqual(vd.ownership, { covered: 2, total: 4, pct: 50 });
    // 1 past-expiry exception + 1 unowned tier-1 domain + 1 unclassified asset.
    assert.strictEqual(vd.openRisk, 3);
    // The resolved issue closed 2 days ago; the open one does not count.
    assert.strictEqual(vd.resolvedLast30, 1);
    // Created 7d ago, closed 2d ago ⇒ 5 days.
    assert.strictEqual(vd.avgResolutionDays, 5);

    // ROI Phase 2 — with no value model set, the estimate is present but
    // unconfigured and every figure is zero (Procela invents nothing).
    assert.strictEqual(d.roi.configured, false);
    assert.strictEqual(d.roi.annualValue, 0);
    assert.strictEqual(d.roi.valueAtRisk, 0);
  });

  it('monetizes the drivers with the tenant value model (ROI Phase 2)', async () => {
    // Set the org's own dollar assumptions. In JSON test mode getCachedOrgList
    // returns the live array, so mutating the row is immediately visible.
    const row = organizations.find((o: { id: string }) => o.id === org)!;
    (row as any).roiModel = { currency: 'USD', riskCostPerItem: 1000, resolutionValuePerIssue: 5000, ownershipValuePerEntity: 2000 };
    try {
      const d = (await req(port, 'GET', `/council-scorecard/derive?orgId=${org}`, undefined, admin)).body.data;
      const roi = d.roi;
      assert.strictEqual(roi.configured, true);
      assert.strictEqual(roi.currency, 'USD');
      // 2 owned entities × $2,000 = $4,000 standing ownership value.
      assert.strictEqual(roi.ownershipValue, 4000);
      // 1 resolved last-30 × $5,000 = $5,000/mo ⇒ ×12 = $60,000 annualized.
      assert.strictEqual(roi.resolutionValueMonthly, 5000);
      assert.strictEqual(roi.resolutionValueAnnualized, 60000);
      // Annual value = ownership + annualized resolution (risk is separate).
      assert.strictEqual(roi.annualValue, 64000);
      // 3 open-risk items × $1,000 = $3,000 exposure being worked down.
      assert.strictEqual(roi.valueAtRisk, 3000);

      // ROI Phase 3 — attribution to the Billing value stream. Its activity
      // maps aC (owned+classified) and aU (unowned+unclassified); domain dO
      // holds aC, so dO attributes too.
      assert.strictEqual(roi.byValueStream.length, 1);
      const vs = roi.byValueStream[0];
      assert.strictEqual(vs.name, 'Billing');
      assert.strictEqual(vs.assets, 2);
      // Owned entities: domain dO + asset aC = 2 × $2,000 = $4,000.
      assert.strictEqual(vs.ownershipValue, 4000);
      assert.strictEqual(vs.annualValue, 4000);
      // Attributable open risk: 1 unclassified asset (aU) × $1,000 = $1,000
      // (dO is owned, so no tier-1-unowned; exceptions aren't attributed).
      assert.strictEqual(vs.valueAtRisk, 1000);
    } finally {
      delete (row as any).roiModel;
    }
  });

  it('leaves the value-stream breakdown empty when no model is set', async () => {
    const d = (await req(port, 'GET', `/council-scorecard/derive?orgId=${org}`, undefined, admin)).body.data;
    assert.strictEqual(d.roi.configured, false);
    assert.deepStrictEqual(d.roi.byValueStream, []);
  });
});
