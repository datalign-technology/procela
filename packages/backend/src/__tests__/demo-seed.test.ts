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
    ];
    for (const [arr, name] of stores) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?.id?.startsWith('demo-')) arr.splice(i, 1);
      saveStore(name, arr);
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?.id?.startsWith('demo-')) arr.splice(i, 1);
    };
    for (const s of [organizations, people, systems, agents, dataDomains, dataAssets, processNodes, mappings, governanceTasks, governanceIssues]) sweep(s);
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
