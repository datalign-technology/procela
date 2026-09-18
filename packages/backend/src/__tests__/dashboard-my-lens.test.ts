// GET /api/v1/dashboard/my-dashboard — governed lens.
//
// The you-scoped portfolio (my domains + their assets) can be narrowed to the
// entities the org's governance program governs via ?lens=governed. No program
// / an empty scope resolves to null ("govern everything"), so the lens is a
// safe no-op there. Default ('all') counts everything I own.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dashboardRouter = require('../routes/dashboard').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governancePrograms } = require('../routes/governance-program');

function get(port: number, path: string, user: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'x-test-user': JSON.stringify(user) };
    const r = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      let c = ''; res.on('data', (d) => { c += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, body: c ? JSON.parse(c) : null }); } catch { resolve({ status: res.statusCode || 0, body: c }); } });
    });
    r.on('error', reject); r.end();
  });
}

describe('GET /dashboard/my-dashboard — governed lens', () => {
  let server: http.Server; let port: number;
  const P = 'mylens-';
  const org = P + 'org';
  const personId = P + 'p1';
  const email = 'lens.owner@example.com';
  const dG = P + 'dG', dU = P + 'dU', aG = P + 'aG', aU = P + 'aU';
  const now = new Date().toISOString();
  const user = { id: personId, role: 'ORG_ADMIN', email };

  before(async () => {
    const app = express();
    app.use((r: any, _res, next) => { const h = r.headers['x-test-user']; if (h) r.user = JSON.parse(h); next(); });
    app.use('/dashboard', dashboardRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    people.push({ id: personId, orgId: org, name: 'Lens Owner', email, role: 'ORG_ADMIN', createdAt: now, updatedAt: now } as any);
    // Two domains I own: dG is governed (in scope), dU is out of scope. Each
    // holds one asset — aG (Gold, classified), aU (Bronze).
    dataDomains.push(
      { id: dG, orgId: org, name: 'Governed', description: '', ownerId: personId, stewardIds: [], dataAssetIds: [aG], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
      { id: dU, orgId: org, name: 'Ungoverned', description: '', ownerId: personId, stewardIds: [], dataAssetIds: [aU], criticality: 'TIER_1', status: 'ACTIVE', createdAt: now, updatedAt: now },
    );
    dataAssets.push(
      { id: aG, orgId: org, name: 'AG', description: '', governanceTier: 'GOLD', healthScore: 90, ownerPersonId: personId, sensitivityTags: ['PII'], createdAt: now, updatedAt: now },
      { id: aU, orgId: org, name: 'AU', description: '', governanceTier: 'BRONZE', healthScore: 20, createdAt: now, updatedAt: now },
    );
    // The program governs only dG (⇒ dG + aG in scope).
    governancePrograms.push({
      id: P + 'prog', orgId: org, name: 'P',
      scope: { inScope: '', outOfScope: '', boundaries: '', constraints: '', systemIds: [], domainIds: [dG], valueStreamIds: [], includeIds: [], excludeIds: [] },
      scopeVersion: 1, scopeChangedAt: null,
    } as any);
  });

  after(async () => {
    for (const store of [people, dataDomains, dataAssets, governancePrograms]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const row = store[i];
        if ((row.id && String(row.id).startsWith(P)) || row.orgId === org) store.splice(i, 1);
      }
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('all lens (default): counts every domain and asset I own', async () => {
    const res = await get(port, '/dashboard/my-dashboard', user);
    assert.strictEqual(res.status, 200);
    const p = res.body.data.portfolio;
    assert.strictEqual(p.domains, 2);
    assert.strictEqual(p.assets, 2);
    assert.strictEqual(p.tiers.gold, 1);
    assert.strictEqual(p.tiers.bronze, 1);
    assert.strictEqual(res.body.data.myDomains.length, 2);
  });

  it('governed lens: narrows to the domains + assets the program governs', async () => {
    const res = await get(port, `/dashboard/my-dashboard?orgId=${org}&lens=governed`, user);
    assert.strictEqual(res.status, 200);
    const p = res.body.data.portfolio;
    assert.strictEqual(p.domains, 1);       // only the governed domain
    assert.strictEqual(p.assets, 1);        // only its asset
    assert.strictEqual(p.tiers.gold, 1);
    assert.strictEqual(p.tiers.bronze, 0);  // the out-of-scope Bronze asset drops
    assert.strictEqual(res.body.data.myDomains.length, 1);
    assert.strictEqual(res.body.data.myDomains[0].id, dG);
  });

  it('governed lens with no program is a safe no-op (govern everything)', async () => {
    const res = await get(port, `/dashboard/my-dashboard?orgId=${P}absent&lens=governed`, user);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.portfolio.domains, 2);
    assert.strictEqual(res.body.data.portfolio.assets, 2);
  });
});
