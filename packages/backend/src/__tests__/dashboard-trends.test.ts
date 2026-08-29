// GET /api/v1/dashboard/trends + POST /api/v1/dashboard/snapshot.
//
// Pins the trends time-series slice that feeds the Dashboard sparkline
// widgets:
//   - snapshot capture is idempotent per calendar day (overwrite, not
//     duplicate)
//   - trends returns points oldest→newest, capped to the most recent 12
//   - the synthesized fallback fires when an org has < 2 real snapshots
//     and lands its newest point on the org's live stats

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dashboardRouter = require('../routes/dashboard').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { statsSnapshots } = require('../routes/dashboard');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataQualityRules } = require('../routes/data-quality');

function request(port: number, method: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
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

describe('dashboard trends + snapshot', () => {
  let server: http.Server;
  let port: number;

  const P = 'test-trends-';
  const orgId = P + 'org';
  const now = new Date().toISOString();

  const sweep = (arr: any[], pred: (r: any) => boolean) => {
    for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
  };
  const sweepAll = () => {
    sweep(organizations, (o) => o.id?.startsWith(P));
    sweep(dataAssets, (a) => a.id?.startsWith(P));
    sweep(processNodes, (n) => n.id?.startsWith(P));
    sweep(mappings, (m) => m.id?.startsWith(P));
    sweep(dataQualityRules, (r) => r.id?.startsWith(P) || r.dataAssetId?.startsWith(P));
    sweep(statsSnapshots, (s) => s.orgId === orgId || s.id?.startsWith(P));
  };

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/dashboard', dashboardRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    sweepAll();
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    sweepAll();
    organizations.push({ id: orgId, parentId: null, name: 'Trends Co', type: 'company', industry: '', description: '', headCount: 0 });

    // One value stream + one activity, one asset, one mapping so the
    // live stats are non-trivial (coverage 100%, health 80).
    processNodes.push(
      { id: P + 'vs', parentId: null, level: 'VALUE_STREAM', name: 'VS', description: '', status: 'ACTIVE', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, createdAt: now, updatedAt: now },
      { id: P + 'act', parentId: P + 'vs', level: 'ACTIVITY', name: 'Act', description: '', status: 'ACTIVE', orderIndex: 0, orgId, orgIds: [orgId], ownerId: null, version: 1, createdAt: now, updatedAt: now },
    );
    dataAssets.push(
      { id: P + 'asset', orgId, name: 'Asset', description: '', systemId: '', owner: '', ownerPersonId: null, stewardIds: [], governanceTier: 'GOLD', healthScore: 80, createdAt: now, updatedAt: now },
    );
    // Health is derived from MEASURED data-quality rules: the asset shows its
    // stored 80 only because a measured (non-simulated) rule backs it. Without
    // one its effective health would be 0.
    dataQualityRules.push(
      { id: P + 'rule', orgId, dataAssetId: P + 'asset', dimension: 'COMPLETENESS', name: 'Not null', description: '', threshold: 80, currentScore: 80, weight: 5, status: 'PASSING', lastMeasured: now, lastRun: { ranAt: now, simulated: false, totalRows: 100, passCount: 80, failCount: 20, passRate: 80, failureSamples: [], message: '' }, createdAt: now, updatedAt: now },
    );
    mappings.push(
      { id: P + 'map', orgId, processStepId: P + 'act', dataAssetId: P + 'asset', linkType: 'INPUT', notes: '', aiSuggested: false, userOverridden: false, createdAt: now, updatedAt: now, createdBy: null },
    );
  });

  it('trends synthesizes a series ending at live stats when there are no real snapshots', async () => {
    const res = await request(port, 'GET', `/dashboard/trends?orgId=${orgId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.synthesized, true);

    const points = res.body.data.points;
    assert.ok(Array.isArray(points));
    assert.ok(points.length >= 2, `expected a multi-point series, got ${points.length}`);

    // Oldest → newest by date.
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i - 1].date <= points[i].date, 'points must be oldest→newest');
    }

    // Newest point lands on the live stats: 1 activity, 1 mapping ⇒
    // coverage 100; one GOLD asset at health 80.
    const last = points[points.length - 1];
    assert.strictEqual(last.coverage, 100);
    assert.strictEqual(last.avgHealth, 80);
    assert.strictEqual(last.dataAssets, 1);
    assert.strictEqual(last.mappings, 1);

    // Every point carries the full numeric shape.
    for (const p of points) {
      for (const k of ['date', 'coverage', 'avgHealth', 'gaps', 'dataAssets', 'mappings']) {
        assert.ok(p[k] !== undefined, `point missing ${k}`);
      }
    }
  });

  it('trends is deterministic for the same org', async () => {
    const a = await request(port, 'GET', `/dashboard/trends?orgId=${orgId}`);
    const b = await request(port, 'GET', `/dashboard/trends?orgId=${orgId}`);
    assert.deepStrictEqual(a.body.data.points, b.body.data.points);
  });

  it('snapshot captures live stats and is idempotent per calendar day', async () => {
    const first = await request(port, 'GET', `/dashboard/trends?orgId=${orgId}`); // synthesized
    assert.strictEqual(first.body.data.synthesized, true);

    const cap1 = await request(port, 'POST', `/dashboard/snapshot?orgId=${orgId}`);
    assert.strictEqual(cap1.status, 200);
    assert.strictEqual(cap1.body.data.orgId, orgId);
    assert.strictEqual(cap1.body.data.coverage, 100);
    assert.strictEqual(cap1.body.data.avgHealth, 80);
    const today = new Date().toISOString().slice(0, 10);
    assert.strictEqual(cap1.body.data.capturedAt, today);

    // Second capture same day overwrites — no duplicate row.
    const cap2 = await request(port, 'POST', `/dashboard/snapshot?orgId=${orgId}`);
    assert.strictEqual(cap2.body.data.id, cap1.body.data.id);
    const rowsForOrg = statsSnapshots.filter((s: any) => s.orgId === orgId);
    assert.strictEqual(rowsForOrg.length, 1, 'idempotent per day — exactly one row');
  });

  it('trends returns real snapshots oldest→newest, capped to 12', async () => {
    // Push 15 real snapshots with shuffled dates; expect the newest 12
    // back in ascending order and synthesized:false.
    const mk = (dayOffset: number, coverage: number): any => ({
      id: `${P}snap-${dayOffset}`,
      orgId,
      capturedAt: new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      coverage,
      avgHealth: 70,
      gaps: 2,
      dataAssets: 3,
      mappings: 3,
    });
    // Insert out of order.
    const offsets = [-5, -14, -2, -20, -8, -1, -30, -11, -3, -17, -6, -25, -9, -12, -4];
    offsets.forEach((o, idx) => statsSnapshots.push(mk(o, idx)));

    const res = await request(port, 'GET', `/dashboard/trends?orgId=${orgId}`);
    assert.strictEqual(res.body.data.synthesized, false);
    const points = res.body.data.points;
    assert.strictEqual(points.length, 12, 'capped to most recent 12');
    for (let i = 1; i < points.length; i++) {
      assert.ok(points[i - 1].date < points[i].date, 'ascending, de-duped dates');
    }
    // The single most-recent snapshot (offset -1) is the last point.
    const newestDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.strictEqual(points[points.length - 1].date, newestDate);
  });
});
