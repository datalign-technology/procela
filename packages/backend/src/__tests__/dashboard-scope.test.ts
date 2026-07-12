// GET /api/v1/dashboard/stats — org scope handling.
//
// Pins the fix that dashboards now use filterByOrgScope, so a
// division-scope query sees:
//   - company-level items rolling DOWN (ancestor visibility)
//   - team-level items rolling UP (descendant visibility)
//   - division's own items
//
// Before the fix, every dashboard filter was a strict `orgId === oid`
// and missed both roll-downs and roll-ups — the exact bug the tech-
// debt sweep flagged.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dashboardRouter = require('../routes/dashboard').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');

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

describe('GET /dashboard/stats — org scope', () => {
  let server: http.Server;
  let port: number;

  const P = 'test-dash-';
  const companyId = P + 'company';
  const divisionId = P + 'division';
  const teamId = P + 'team';

  const companyAssetId = P + 'a-company';
  const divisionAssetId = P + 'a-division';
  const teamAssetId = P + 'a-team';

  const now = new Date().toISOString();

  before(async () => {
    const app = express();
    app.use('/dashboard', dashboardRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(organizations, (o) => o.id?.startsWith(P));
    sweep(dataAssets, (a) => a.id?.startsWith(P));
    sweep(processNodes, (n) => n.id?.startsWith(P));
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(organizations, (o) => o.id?.startsWith(P));
    sweep(dataAssets, (a) => a.id?.startsWith(P));
    sweep(processNodes, (n) => n.id?.startsWith(P));

    organizations.push(
      { id: companyId, parentId: null, name: 'Test Co', type: 'company', industry: '', description: '', headCount: 0 },
      { id: divisionId, parentId: companyId, name: 'Test Div', type: 'division', industry: '', description: '', headCount: 0 },
      { id: teamId, parentId: divisionId, name: 'Test Team', type: 'team', industry: '', description: '', headCount: 0 },
    );

    const asset = (id: string, orgId: string, name: string) => ({
      id, orgId, name, description: '', systemId: '',
      owner: '', ownerPersonId: null, stewardIds: [],
      governanceTier: 'BRONZE', healthScore: 50,
      createdAt: now, updatedAt: now,
    });
    dataAssets.push(
      asset(companyAssetId, companyId, 'Company asset'),
      asset(divisionAssetId, divisionId, 'Division asset'),
      asset(teamAssetId, teamId, 'Team asset'),
    );
  });

  it('company-scope sees company + division + team assets (roll-up)', async () => {
    const res = await request(port, `/dashboard/stats?orgId=${companyId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.dataAssets, 3);
  });

  it('division-scope sees company (roll-down) + division + team (roll-up) — 3 assets', async () => {
    const res = await request(port, `/dashboard/stats?orgId=${divisionId}`);
    assert.strictEqual(res.status, 200);
    // Regression guard: pre-fix this was 1 (strict-equality only counted
    // the division's own asset). With filterByOrgScope it's 3.
    assert.strictEqual(res.body.data.dataAssets, 3);
  });

  it('team-scope sees company (roll-down) + division (roll-down) + team — 3 assets', async () => {
    const res = await request(port, `/dashboard/stats?orgId=${teamId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.dataAssets, 3);
  });
});
