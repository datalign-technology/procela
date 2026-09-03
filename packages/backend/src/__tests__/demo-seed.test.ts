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
import os from 'os';
import path from 'path';
import fs from 'fs';

// Isolate this suite's JSON persistence into a private temp directory.
// The demo-seed endpoint persists real rows to disk; the default
// `.procela-data` is shared by every test file (node --test runs files
// in parallel processes off the same cwd), so those writes could race a
// count-sensitive route suite that loads the same store mid-seed. Point
// this process at its own dir before the first require pulls in the
// persistence module. ESM evaluates the imports above first, so `fs` is
// ready and this runs before the requires below.
process.env.PROCELA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'procela-demo-seed-'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const adminRouter = require('../routes/admin').default;
// Demo ids are deterministic UUIDs (see demoId in the service) — require it
// AFTER PROCELA_DATA_DIR is set so persistence loads against the temp dir.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { demoId, DEMO_ID_SENTINEL } = require('../services/demo-seed.service');
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
const { businessCapabilities } = require('../routes/business-capabilities');
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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governancePolicies } = require('../routes/governance-policies');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceControls } = require('../routes/governance-controls');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governanceGroups } = require('../routes/governance-groups');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { governancePrograms } = require('../routes/governance-program');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decisionRights } = require('../routes/decision-rights');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { skills } = require('../routes/skills');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { damaRoles } = require('../routes/dama-roles');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { raciOverrides } = require('../routes/dashboard');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sops } = require('../routes/sops');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { glossaryTerms } = require('../routes/business-glossary');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { operationsManuals } = require('../routes/operations-manuals');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataLineageLinks, assetLineageEdges } = require('../routes/data-lineage');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { maturitySnapshots } = require('../routes/maturity-trends');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { gapSnapshots } = require('../services/digest.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { agentSchedules } = require('../routes/agent-schedules');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { agentExecutions } = require('../routes/agent-executions');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { comments } = require('../routes/comments');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { tags } = require('../routes/tags');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attachments } = require('../routes/attachments');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { reports } = require('../routes/reports');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { analysisReports } = require('../routes/analysis-reports');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { savedViews } = require('../routes/saved-views');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssetColumns, dataAssetBindings } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connections } = require('../routes/connections');

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
      [businessCapabilities, 'businessCapabilities'],
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
      [governancePolicies, 'governancePolicies'],
      [governanceControls, 'governanceControls'],
      [governanceGroups, 'governanceGroups'],
      [governancePrograms, 'governancePrograms'],
      [decisionRights, 'decisionRights'],
      [skills, 'skills'],
      [damaRoles, 'damaRoles'],
      [sops, 'sops'],
      [glossaryTerms, 'glossaryTerms'],
      [operationsManuals, 'operationsManuals'],
      [dataLineageLinks, 'dataLineageLinks'],
      [assetLineageEdges, 'assetLineageEdges'],
      [maturitySnapshots, 'maturitySnapshots'],
      [gapSnapshots, 'gapSnapshots'],
      [agentSchedules, 'agentSchedules'],
      [agentExecutions, 'agentExecutions'],
      [comments, 'comments'],
      [tags, 'tags'],
      [attachments, 'attachments'],
      [reports, 'reports'],
      [analysisReports, 'analysisReports'],
      [savedViews, 'savedViews'],
      [dataAssetColumns, 'dataAssetColumns'],
      [dataAssetBindings, 'dataAssetBindings'],
      [connections, 'connections'],
    ];
    for (const [arr, name] of stores) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?.id?.startsWith(DEMO_ID_SENTINEL)) arr.splice(i, 1);
      saveStore(name, arr);
    }
    for (let i = raciOverrides.length - 1; i >= 0; i--) if (raciOverrides[i]?.nodeId?.startsWith(DEMO_ID_SENTINEL)) raciOverrides.splice(i, 1);
    saveStore('raciOverrides', raciOverrides);
    // AI cache doesn't carry a `demo-` id field — clean the two
    // known demo-owned entries by industry key.
    const demoKeys = new Set([
      'utilities|tidewater electric', 'utilities|tidewater water',
      'defense & shipbuilding|ship construction', 'defense & shipbuilding|fleet sustainment',
    ]);
    for (let i = aiTemplateCache.length - 1; i >= 0; i--) {
      if (demoKeys.has(aiTemplateCache[i]?.industry)) aiTemplateCache.splice(i, 1);
    }
    saveStore('aiTemplateCache', aiTemplateCache);
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?.id?.startsWith(DEMO_ID_SENTINEL)) arr.splice(i, 1);
    };
    for (const s of [organizations, people, systems, agents, dataDomains, dataAssets, processNodes, mappings, governanceTasks, governanceIssues, dataQualityRules, connectors, connectorEvents, calendarEvents, governancePolicies, governanceControls, governanceGroups, governancePrograms, decisionRights, skills, damaRoles, sops, glossaryTerms, operationsManuals, dataLineageLinks, assetLineageEdges, maturitySnapshots, gapSnapshots, agentSchedules, agentExecutions, comments, tags, attachments, reports, analysisReports, savedViews, dataAssetColumns, dataAssetBindings, connections]) sweep(s);
    // RACI overrides key on nodeId (no id) — clear demo-prefixed nodes.
    for (let i = raciOverrides.length - 1; i >= 0; i--) if (raciOverrides[i]?.nodeId?.startsWith(DEMO_ID_SENTINEL)) raciOverrides.splice(i, 1);
  });

  it('generates valid, deterministic UUID demo ids (Postgres @db.Uuid safe)', () => {
    // The id columns are @db.Uuid in Postgres, so a non-UUID string id is
    // rejected on insert (JSON mode tolerates any string). Guard the format
    // here so that regression is caught without needing a live database.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const key of ['org-tidewater', 'person-susan-chen', 'skill-dq', 'stats-abc-0', 'mat-def-3']) {
      assert.match(demoId(key), UUID_RE, `${key} → valid UUID`);
    }
    assert.ok(demoId('org-tidewater').startsWith(DEMO_ID_SENTINEL), 'carries the demo sentinel prefix');
    assert.strictEqual(demoId('org-tidewater'), demoId('org-tidewater'), 'deterministic (idempotent reseed)');
    assert.notStrictEqual(demoId('a'), demoId('b'), 'distinct keys → distinct ids');
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

    const demoCount = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL)).length;
    assert.strictEqual(demoCount(organizations), 10, 'orgs');
    assert.strictEqual(demoCount(people), 24, 'people');
    assert.strictEqual(demoCount(systems), 8, 'systems');
    assert.strictEqual(demoCount(agents), 5, 'agents');
    assert.strictEqual(demoCount(businessCapabilities), 3, 'capabilities');
    assert.strictEqual(demoCount(dataDomains), 6, 'domains');
    assert.strictEqual(demoCount(dataAssets), 9, 'assets');
    assert.strictEqual(demoCount(processNodes), 15, 'process nodes');
    assert.strictEqual(demoCount(mappings), 7, 'mappings');
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
    const demoCount = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL)).length;
    // Counts should match the single-seed expectations.
    assert.strictEqual(demoCount(organizations), 10);
    assert.strictEqual(demoCount(people), 24);
    assert.strictEqual(demoCount(dataAssets), 9);
  });

  it('populates Susan Chen persona with tasks + issue', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const susan = people.find((p: any) => p.id === demoId('person-susan-chen'));
    assert.ok(susan, 'Susan should be seeded');
    const susanTasks = governanceTasks.filter((t: any) => t.assigneeId === susan.id);
    assert.ok(susanTasks.length >= 3, `expected 3+ tasks for Susan, got ${susanTasks.length}`);
    const susanIssues = governanceIssues.filter((i: any) => i.assignedTo === susan.id);
    assert.ok(susanIssues.length >= 1, `expected 1+ issues for Susan, got ${susanIssues.length}`);
  });

  it('seeds two DQ rules — one passing, one failing — for the demo tile story', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const rules = dataQualityRules.filter((r: any) => r.id?.startsWith(DEMO_ID_SENTINEL));
    assert.strictEqual(rules.length, 2);
    const passing = rules.find((r: any) => r.status === 'PASSING');
    const failing = rules.find((r: any) => r.status === 'FAILING');
    assert.ok(passing, 'expected a PASSING rule');
    assert.ok(failing, 'expected a FAILING rule');
    // The FAILING rule should target Generation Output — that's the
    // asset the seeded governance issue references, so the demo
    // story stays coherent.
    assert.strictEqual(failing.dataAssetId, demoId('asset-generation-output'));
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
    const conn = connectors.find((c: any) => c.id === demoId('conn-tidewater'));
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
    const meter = dataAssets.find((a: any) => a.id === demoId('asset-meter-reads'));
    assert.ok(meter);
    assert.strictEqual((meter as any).lastSyncedByConnectorId, conn.id);
    assert.ok((meter as any).lastSyncedAt);
  });

  it('seeds a PAIRING connector alongside the ONLINE one', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const online = connectors.find((c: any) => c.id === demoId('conn-tidewater'));
    const pairing = connectors.find((c: any) => c.id === demoId('conn-pairing'));
    assert.ok(online);
    assert.ok(pairing, 'expected the PAIRING connector');
    assert.strictEqual(pairing.tokenHash, null, 'PAIRING connector should not have a claimed token');
    assert.match(String(pairing.pairingCode), /^\d{8}$/, 'pairing code should be 8 digits');
  });

  it('seeds a governance calendar event owned by Susan', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const ev = calendarEvents.find((c: any) => c.id === demoId('cal-dgc'));
    assert.ok(ev);
    assert.strictEqual(ev.cadence, 'WEEKLY');
    assert.ok(Array.isArray(ev.attendees) && ev.attendees.includes(demoId('person-susan-chen')), 'Susan is an attendee');
    assert.ok(new Date(ev.nextOccurrence).getTime() > Date.now());
  });

  it('plants orphan assets not referenced by any mapping', async () => {
    await request(port, 'POST', '/admin/demo-seed', {}, 'SUPER_ADMIN');
    const mappedAssetIds = new Set(mappings.filter((m: any) => m.dataAssetId).map((m: any) => m.dataAssetId));
    const orphanA = dataAssets.find((a: any) => a.id === demoId('asset-legacy-billing'));
    const orphanB = dataAssets.find((a: any) => a.id === demoId('asset-meter-csv'));
    assert.ok(orphanA);
    assert.ok(orphanB);
    assert.strictEqual(mappedAssetIds.has(orphanA.id), false, 'Legacy Billing Extract should be orphaned');
    assert.strictEqual(mappedAssetIds.has(orphanB.id), false, 'Meter CSV Dump should be orphaned');
  });

  // ── Shipbuilding industry profile — parity with utilities ──

  it('rejects an unknown industry with 400', async () => {
    const res = await request(port, 'POST', '/admin/demo-seed', { industry: 'aerospace' }, 'SUPER_ADMIN');
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Unknown industry/);
  });

  it('seeds the shipbuilding profile at the same counts as utilities', async () => {
    const res = await request(port, 'POST', '/admin/demo-seed', { industry: 'shipbuilding' }, 'SUPER_ADMIN');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.persona.name, 'Elena Ruiz');

    const demoCount = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL)).length;
    assert.strictEqual(demoCount(organizations), 10, 'orgs');
    assert.strictEqual(demoCount(people), 24, 'people');
    assert.strictEqual(demoCount(systems), 8, 'systems');
    assert.strictEqual(demoCount(agents), 5, 'agents');
    assert.strictEqual(demoCount(businessCapabilities), 3, 'capabilities');
    assert.strictEqual(demoCount(dataDomains), 6, 'domains');
    assert.strictEqual(demoCount(dataAssets), 9, 'assets');
    assert.strictEqual(demoCount(processNodes), 15, 'process nodes');
    assert.strictEqual(demoCount(mappings), 7, 'mappings');
    assert.strictEqual(demoCount(governanceTasks), 3, 'tasks');
    assert.strictEqual(demoCount(governanceIssues), 1, 'issues');
    assert.strictEqual(demoCount(dataQualityRules), 2, 'DQ rules');
    assert.strictEqual(demoCount(connectors), 2, 'connectors');
    assert.strictEqual(demoCount(connectorEvents), 5, 'connector events');
    assert.strictEqual(demoCount(calendarEvents), 1, 'calendar events');
  });

  it('switching industry replaces the previous tenant — no compounding', async () => {
    // Seed utilities, then shipbuilding: the sweep must clear the
    // utilities rows so only the shipbuilding tenant remains.
    await request(port, 'POST', '/admin/demo-seed', { industry: 'utilities' }, 'SUPER_ADMIN');
    await request(port, 'POST', '/admin/demo-seed', { industry: 'shipbuilding' }, 'SUPER_ADMIN');

    const demoCount = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL)).length;
    assert.strictEqual(demoCount(organizations), 10, 'orgs after switch');
    assert.strictEqual(demoCount(people), 24, 'people after switch');

    // Utilities-only rows should be gone; shipbuilding rows present.
    assert.ok(!people.some((p: any) => p.id === demoId('person-susan-chen')), 'Susan (utilities) cleared');
    assert.ok(people.some((p: any) => p.id === demoId('person-elena-ruiz')), 'Elena (shipbuilding) present');
    // AI cache should hold the shipbuilding keys, not the utilities ones.
    assert.ok(aiTemplateCache.some((c: any) => c.industry === 'defense & shipbuilding|ship construction'));
    assert.ok(!aiTemplateCache.some((c: any) => c.industry === 'utilities|tidewater electric'), 'utilities cache cleared');
  });

  it('shipbuilding plants orphan assets and a failing DQ rule on the same asset as its issue', async () => {
    await request(port, 'POST', '/admin/demo-seed', { industry: 'shipbuilding' }, 'SUPER_ADMIN');
    const mappedAssetIds = new Set(mappings.filter((m: any) => m.dataAssetId).map((m: any) => m.dataAssetId));
    assert.ok(dataAssets.find((a: any) => a.id === demoId('asset-legacy-drawings')));
    assert.ok(dataAssets.find((a: any) => a.id === demoId('asset-nesting-csv')));
    assert.strictEqual(mappedAssetIds.has(demoId('asset-legacy-drawings')), false, 'Legacy Drawing Extract orphaned');
    assert.strictEqual(mappedAssetIds.has(demoId('asset-nesting-csv')), false, 'Nesting CSV Dump orphaned');

    const failing = dataQualityRules.find((r: any) => r.id?.startsWith(DEMO_ID_SENTINEL) && r.status === 'FAILING');
    const issue = governanceIssues.find((i: any) => i.id?.startsWith(DEMO_ID_SENTINEL));
    assert.ok(failing && issue);
    assert.strictEqual(failing.dataAssetId, demoId('asset-weld-records'));
    assert.strictEqual(issue.dataAssetId, demoId('asset-weld-records'), 'issue + failing DQ target one asset');
  });

  // ── Governance depth — seeded for both industries at parity ──

  for (const industry of ['utilities', 'shipbuilding'] as const) {
    it(`seeds governance depth (policies/controls/groups/program/decision rights) for ${industry}`, async () => {
      await request(port, 'POST', '/admin/demo-seed', { industry }, 'SUPER_ADMIN');
      const demo = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL));
      assert.strictEqual(demo(governancePolicies).length, 3, 'policies');
      assert.strictEqual(demo(governanceControls).length, 3, 'controls');
      assert.strictEqual(demo(governanceGroups).length, 2, 'groups');
      assert.strictEqual(demo(governancePrograms).length, 1, 'program');
      assert.strictEqual(demo(decisionRights).length, 2, 'decision rights');

      // Each control points at a seeded policy.
      const policyIds = new Set(demo(governancePolicies).map((p: any) => p.id));
      for (const ctl of demo(governanceControls)) {
        assert.ok(policyIds.has(ctl.policyId), `control ${ctl.id} → a seeded policy`);
      }
      // The stewardship team nests under the council.
      const council = demo(governanceGroups).find((g: any) => g.type === 'COUNCIL');
      const team = demo(governanceGroups).find((g: any) => g.type === 'STEWARDSHIP_TEAM');
      assert.ok(council && team);
      assert.strictEqual(team.parentId, council.id, 'team nests under council');
    });

    it(`seeds people depth (skills, skill assignments, DAMA roles, RACI) for ${industry}`, async () => {
      await request(port, 'POST', '/admin/demo-seed', { industry }, 'SUPER_ADMIN');
      const demo = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL));
      assert.strictEqual(demo(skills).length, 8, 'skills catalog');
      assert.strictEqual(demo(damaRoles).length, 7, 'DAMA roles');

      // Every seeded DAMA role references a seeded skill-independent person
      // and its scope; there should be exactly one CDO (single-holder).
      const cdoRoles = demo(damaRoles).filter((r: any) => r.roleType === 'CDO');
      assert.strictEqual(cdoRoles.length, 1, 'exactly one CDO');

      // Skill assignments land on people as skillIds.
      const withSkills = people.filter((p: any) => p.id?.startsWith(DEMO_ID_SENTINEL) && Array.isArray(p.skillIds) && p.skillIds.length > 0);
      assert.ok(withSkills.length >= 7, `expected 7+ people with skills, got ${withSkills.length}`);
      const skillIds = new Set(demo(skills).map((s: any) => s.id));
      for (const p of withSkills) {
        for (const sidv of p.skillIds) assert.ok(skillIds.has(sidv), `person skill ${sidv} is a seeded skill`);
      }

      // One RACI override on a demo activity.
      const demoRaci = raciOverrides.filter((r: any) => r?.nodeId?.startsWith(DEMO_ID_SENTINEL));
      assert.strictEqual(demoRaci.length, 1, 'one RACI override');
      assert.ok(['R', 'A', 'C', 'I'].includes(demoRaci[0].value));
    });

    it(`seeds docs depth (SOPs, glossary, operations manuals) for ${industry}`, async () => {
      await request(port, 'POST', '/admin/demo-seed', { industry }, 'SUPER_ADMIN');
      const demo = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL));
      assert.strictEqual(demo(sops).length, 3, 'SOPs');
      assert.strictEqual(demo(glossaryTerms).length, 4, 'glossary terms');
      assert.strictEqual(demo(operationsManuals).length, 3, 'operations manuals');

      // SOPs carry ordered steps; glossary has an approved term.
      assert.ok(demo(sops).every((s: any) => Array.isArray(s.steps) && s.steps.length > 0));
      assert.ok(demo(glossaryTerms).some((t: any) => t.status === 'APPROVED'));
    });

    it(`seeds lineage + trend history for ${industry}`, async () => {
      await request(port, 'POST', '/admin/demo-seed', { industry }, 'SUPER_ADMIN');
      const demo = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL));
      assert.strictEqual(demo(dataLineageLinks).length, 3, 'lineage links');
      assert.strictEqual(demo(assetLineageEdges).length, 2, 'asset edges');
      // 6 weekly snapshots per org × 3 orgs.
      assert.strictEqual(demo(maturitySnapshots).length, 18, 'maturity snapshots');
      assert.strictEqual(demo(gapSnapshots).length, 18, 'gap snapshots');

      // Lineage links join two distinct systems; trend history climbs.
      assert.ok(demo(dataLineageLinks).every((l: any) => l.sourceSystemId !== l.targetSystemId));
      const oneOrg = demo(maturitySnapshots).filter((m: any) => m.orgId === demo(maturitySnapshots)[0].orgId).sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
      assert.ok(oneOrg[oneOrg.length - 1].overall > oneOrg[0].overall, 'maturity trend climbs');
    });

    it(`seeds agent operations (schedules + executions) for ${industry}`, async () => {
      await request(port, 'POST', '/admin/demo-seed', { industry }, 'SUPER_ADMIN');
      const demo = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL));
      assert.strictEqual(demo(agentSchedules).length, 2, 'agent schedules');
      assert.strictEqual(demo(agentExecutions).length, 3, 'agent executions');
      // Execution lifecycle: an approved, a pending-review, and a failed run.
      const execs = demo(agentExecutions);
      assert.ok(execs.some((e: any) => e.status === 'SUCCESS' && e.reviewStatus === 'APPROVED'));
      assert.ok(execs.some((e: any) => e.reviewStatus === 'PENDING'));
      assert.ok(execs.some((e: any) => e.status === 'FAILED' && e.error));
    });

    it(`seeds collaboration + reporting + connections for ${industry}`, async () => {
      await request(port, 'POST', '/admin/demo-seed', { industry }, 'SUPER_ADMIN');
      const demo = (arr: any[]) => arr.filter((r) => r?.id?.startsWith(DEMO_ID_SENTINEL));
      assert.strictEqual(demo(connections).length, 1, 'connection');
      assert.strictEqual(demo(dataAssetColumns).length, 4, 'asset columns');
      assert.strictEqual(demo(dataAssetBindings).length, 1, 'asset binding');
      assert.strictEqual(demo(comments).length, 2, 'comments');
      assert.strictEqual(demo(tags).length, 3, 'tags');
      assert.strictEqual(demo(attachments).length, 2, 'attachments');
      assert.strictEqual(demo(reports).length, 2, 'reports');
      assert.strictEqual(demo(analysisReports).length, 1, 'analysis report');
      assert.strictEqual(demo(savedViews).length, 2, 'saved views');

      // Comment thread: a root + a reply pointing at it.
      const root = demo(comments).find((c: any) => c.parentId === null);
      const reply = demo(comments).find((c: any) => c.parentId !== null);
      assert.ok(root && reply && reply.parentId === root.id, 'reply nests under root');
      // Binding points at the seeded connection; a report has an entity+columns.
      assert.strictEqual(demo(dataAssetBindings)[0].connectionId, demo(connections)[0].id);
      assert.ok(demo(reports).every((r: any) => r.definition?.entity && Array.isArray(r.definition.columns)));
    });
  }
});
