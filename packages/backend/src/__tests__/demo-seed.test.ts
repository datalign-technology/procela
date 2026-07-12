// Demo seed endpoint. Verifies:
//   1. Requires SUPER_ADMIN (403 for anyone else)
//   2. Populates every expected store with sane row counts
//   3. Is idempotent — a second call replaces the first, doesn't
//      compound rows
//   4. Susan Chen persona is present with tasks + issue assigned
//   5. Planted orphan assets aren't referenced by any mapping (so
//      Ask AI's orphan-detection prompt returns them)

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const adminRouter = require('../routes/admin').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { people } = require('../routes/people');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systems } = require('../routes/systems');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { agents } = require('../routes/agents');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataDomains } = require('../routes/data-domains');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { processNodes } = require('../routes/process-catalog');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mappings } = require('../routes/mappings');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceTasks } = require('../routes/governance-tasks');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceIssues } = require('../routes/governance-issues');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataQualityRules } = require('../routes/data-quality');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connectors, connectorEvents } = require('../routes/connectors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { calendarEvents } = require('../routes/governance-calendar');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { aiTemplateCache } = require('../routes/ai');

function request(port: number, method: string, path: string, body?: unknown, role?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: {
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {}),
          ...(role ? { 'x-test-role': role } : {}),
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

describe('demo-seed endpoint', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use(express.json());
    // Fake auth — reads x-test-role and mints a matching req.user.
    app.use((req: any, _res, next) => {
      const role = req.headers['x-test-role'] || 'ORG_ADMIN';
      req.user = { sub: 'test-actor', role, email: 'test@example.com' };
      next();
    });
    app.use('/admin', adminRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    // Sweep any demo rows left over from the last test so we don't
    // leak state into other suites in the same tsx --test run. We
    // sweep IN-MEMORY AND persist the swept state so a later test
    // that reloads the store from disk (each tsx worker gets its
    // own module init) starts clean.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { saveStore } = require('../lib/persistence');
    const stores: Array<[any[], string]> = [
      [organizations, 'organizations'],
      [people, 'people'],
      [systems, 'systems'],
      [agents, 'agents'],
      [dataDomains, 'dataDomains'],
      [dataAssets, 'dataAssets'],
      [processNodes, 'processNodes'],
      [mappings, 'mappings'],
      [governanceTasks, 'governanceTasks'],
      [governanceIssues, 'governanceIssues'],
      [dataQualityRules, 'dataQualityRules'],
      [connectors, 'connectors'],
      [connectorEvents, 'connectorEvents'],
      [calendarEvents, 'calendarEvents'],
    ];
    for (const [arr, name] of stores) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?.id?.startsWith('demo-')) arr.splice(i, 1);
      saveStore(name, arr);
    }
    // AI cache doesn't carry a `demo-` id field — clean the two
    // known demo-owned entries by industry key.
    const demoKeys = new Set(['utilities|tidewater electric', 'utilities|tidewater water']);
    for (let i = aiTemplateCache.length - 1; i >= 0; i--) {
      if (demoKeys.has(aiTemplateCache[i]?.industry)) aiTemplateCache.splice(i, 1);
    }
    saveStore('aiTemplateCache', aiTemplateCache);
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?.id?.startsWith('demo-')) arr.splice(i, 1);
    };
    for (const s of [organizations, people, systems, agents, dataDomains, dataAssets, processNodes, mappings, governanceTasks, governanceIssues, dataQualityRules, connectors, connectorEvents, calendarEvents]) sweep(s);
  });

  it('rejects non-super-admin callers with 403', async () => {
    const res = await request(port, 'POST', '/admin/demo-seed', {}, 'ORG_ADMIN');
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /SUPER_ADMIN/);
  });

  it('seeds every store with the expected row counts', async () => {
    const res = await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.persona.name, 'Susan Chen');

    const demoCount = (arr: any[]) => arr.filter((r) => r?.id?.startsWith('demo-')).length;
    assert.strictEqual(demoCount(organizations), 8, 'orgs');
    assert.strictEqual(demoCount(people), 16, 'people');
    assert.strictEqual(demoCount(systems), 6, 'systems');
    assert.strictEqual(demoCount(agents), 5, 'agents');
    assert.strictEqual(demoCount(dataDomains), 3, 'domains');
    assert.strictEqual(demoCount(dataAssets), 6, 'assets');
    assert.strictEqual(demoCount(processNodes), 7, 'process nodes');
    assert.strictEqual(demoCount(mappings), 4, 'mappings');
    assert.strictEqual(demoCount(governanceTasks), 3, 'tasks');
    assert.strictEqual(demoCount(governanceIssues), 1, 'issues');
    assert.strictEqual(demoCount(dataQualityRules), 2, 'DQ rules');
    assert.strictEqual(demoCount(connectors), 2, 'connectors');
    assert.strictEqual(demoCount(connectorEvents), 5, 'connector events');
    assert.strictEqual(demoCount(calendarEvents), 1, 'calendar events');
  });

  it('is idempotent — second call replaces the first, no row compounding', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const demoCount = (arr: any[]) => arr.filter((r) => r?.id?.startsWith('demo-')).length;
    // Counts should match the single-seed expectations.
    assert.strictEqual(demoCount(organizations), 8);
    assert.strictEqual(demoCount(people), 16);
    assert.strictEqual(demoCount(dataAssets), 6);
  });

  it('populates Susan Chen persona with tasks + issue', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const susan = people.find((p: any) => p.id === 'demo-person-susan-chen');
    assert.ok(susan, 'Susan should be seeded');
    const susanTasks = governanceTasks.filter((t: any) => t.assigneeId === susan.id);
    assert.ok(susanTasks.length >= 3, `expected 3+ tasks for Susan, got ${susanTasks.length}`);
    const susanIssues = governanceIssues.filter((i: any) => i.assignedTo === susan.id);
    assert.ok(susanIssues.length >= 1, `expected 1+ issues for Susan, got ${susanIssues.length}`);
  });

  it('seeds two DQ rules — one passing, one failing — for the demo tile story', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const rules = dataQualityRules.filter((r: any) => r.id?.startsWith('demo-'));
    assert.strictEqual(rules.length, 2);
    const passing = rules.find((r: any) => r.status === 'PASSING');
    const failing = rules.find((r: any) => r.status === 'FAILING');
    assert.ok(passing, 'expected a PASSING rule');
    assert.ok(failing, 'expected a FAILING rule');
    // The FAILING rule should target Generation Output — that's the
    // asset the seeded governance issue references, so the demo
    // story stays coherent.
    assert.strictEqual(failing.dataAssetId, 'demo-asset-generation-output');
  });

  it('pre-warms the AI wand cache for Tidewater Electric + Water', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const electric = aiTemplateCache.find((c: any) => c.industry === 'utilities|tidewater electric');
    const water = aiTemplateCache.find((c: any) => c.industry === 'utilities|tidewater water');
    assert.ok(electric, 'expected pre-warmed cache for Tidewater Electric');
    assert.ok(water, 'expected pre-warmed cache for Tidewater Water');
    assert.ok(Array.isArray(electric.data?.valueStreams));
    assert.ok(electric.data.valueStreams.length >= 2);
    assert.ok(Array.isArray(water.data?.valueStreams));
    assert.ok(water.data.valueStreams.length >= 2);
  });

  it('seeds a paired connector, its events, and wires Meter Reads sync fields', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const conn = connectors.find((c: any) => c.id === 'demo-conn-tidewater');
    assert.ok(conn, 'expected the demo connector');
    assert.strictEqual(conn.status, 'ONLINE');
    assert.strictEqual(conn.agentVersion, '1.2.0');
    assert.ok(conn.systemIds.length >= 2, 'expected connector to cover AMI + warehouse');

    // Events story — at least one PAIRED and one HEARTBEAT.
    const events = connectorEvents.filter((e: any) => e.connectorId === conn.id);
    assert.ok(events.length >= 5);
    assert.ok(events.some((e: any) => e.type === 'PAIRED'));
    assert.ok(events.some((e: any) => e.type === 'HEARTBEAT'));
    assert.ok(events.some((e: any) => e.type === 'ASSETS_REPORTED'));

    // Meter Reads should carry the sync chip fields so the Data Asset
    // detail page reads "Synced N min ago".
    const meter = dataAssets.find((a: any) => a.id === 'demo-asset-meter-reads');
    assert.ok(meter);
    assert.strictEqual((meter as any).lastSyncedByConnectorId, conn.id);
    assert.ok((meter as any).lastSyncedAt);
  });

  it('seeds a PAIRING connector alongside the ONLINE one', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const online = connectors.find((c: any) => c.id === 'demo-conn-tidewater');
    const pairing = connectors.find((c: any) => c.id === 'demo-conn-pairing');
    assert.ok(online);
    assert.ok(pairing, 'expected the PAIRING connector');
    assert.strictEqual(pairing.tokenHash, null, 'PAIRING connector should not have a claimed token');
    assert.match(String(pairing.pairingCode), /^\d{8}$/, 'pairing code should be 8 digits');
  });

  it('seeds a governance calendar event owned by Susan', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const ev = calendarEvents.find((c: any) => c.id === 'demo-cal-dgc');
    assert.ok(ev);
    assert.strictEqual(ev.cadence, 'WEEKLY');
    assert.ok(Array.isArray(ev.attendees) && ev.attendees.includes('demo-person-susan-chen'), 'Susan is an attendee');
    assert.ok(new Date(ev.nextOccurrence).getTime() > Date.now());
  });

  it('plants orphan assets not referenced by any mapping', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const mappedAssetIds = new Set(mappings.filter((m: any) => m.dataAssetId).map((m: any) => m.dataAssetId));
    const orphanA = dataAssets.find((a: any) => a.id === 'demo-asset-legacy-billing');
    const orphanB = dataAssets.find((a: any) => a.id === 'demo-asset-meter-csv');
    assert.ok(orphanA);
    assert.ok(orphanB);
    assert.strictEqual(mappedAssetIds.has(orphanA.id), false, 'Legacy Billing Extract should be orphaned');
    assert.strictEqual(mappedAssetIds.has(orphanB.id), false, 'Meter CSV Dump should be orphaned');
  });
});
