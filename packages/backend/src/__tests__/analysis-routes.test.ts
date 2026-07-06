// Regression coverage for the Analysis cube's pivot counting.
//
// User report: a Systems × Connections pivot where one Systems.csv
// connection is linked to two systems (Systems_1, Systems_2) and
// one asset in Systems_1 is bound to that connection was showing:
//     Systems_1 | Systems.csv | 2   Total 2
//     Systems_2 | Systems.csv | 1   Total 1
//     Total     | Systems.csv | 3
// The (Systems_1, Systems.csv) relationship was counted twice —
// once from the connection↔system link fact, once from the
// data-asset binding that joins through to the same system — and
// the grand total showed a phantom third relationship. The fix
// switched cell counting from raw-fact-sum to distinct-cell-once,
// matching what users read from a pivot table.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const analysisRouter = require('../routes/analysis').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { systems } = require('../routes/systems');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connections, connectionSystemLinks } = require('../routes/connections');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets, dataAssetBindings } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { organizations } = require('../routes/organizations');

function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data!) } : {},
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

describe('analysis /cube — pivot counting', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-analysis-';
  const orgId = PREFIX + 'org';
  const sys1 = PREFIX + 'sys1';
  const sys2 = PREFIX + 'sys2';
  const conn = PREFIX + 'conn';
  const link1 = PREFIX + 'link1';
  const link2 = PREFIX + 'link2';
  const asset1 = PREFIX + 'asset1';
  const binding1 = PREFIX + 'binding1';

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/analysis', analysisRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    // Sweep any leftovers from a previous run so each test is
    // self-contained.
    const sweep = (arr: any[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const id = arr[i].id;
        if (typeof id === 'string' && id.startsWith(PREFIX)) arr.splice(i, 1);
      }
    };
    sweep(systems); sweep(connections); sweep(connectionSystemLinks);
    sweep(dataAssets); sweep(dataAssetBindings); sweep(organizations);
    const now = new Date().toISOString();
    organizations.push({ id: orgId, name: 'Analysis Test Co', industry: 'Utilities', type: 'company', createdAt: now, updatedAt: now });
    systems.push({ id: sys1, orgId, name: 'Systems_1', description: '', systemType: '', createdAt: now, updatedAt: now });
    systems.push({ id: sys2, orgId, name: 'Systems_2', description: '', systemType: '', createdAt: now, updatedAt: now });
    connections.push({
      id: conn, orgId, name: 'Systems.csv',
      connectionType: 'FILE_STORAGE',
      config: { storageType: 'LOCAL', originalFileName: 'Systems.csv' },
      credentials: {},
      status: 'CONNECTED', lastTestedAt: now, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
    connectionSystemLinks.push({ id: link1, orgId, connectionId: conn, systemId: sys1, createdAt: now });
    connectionSystemLinks.push({ id: link2, orgId, connectionId: conn, systemId: sys2, createdAt: now });
  });

  it('Systems × Connections: counts each system-connection pair once even when a binding joins through', async () => {
    // Seed: one asset in Systems_1 bound to the Systems.csv connection.
    // This creates a `binding` fact whose refs include both
    // systems: sys1 AND connections: conn — same (system, connection)
    // pair the sys-conn link fact already emits. Before the fix,
    // the cell counted 2 for that pair; now it counts 1.
    const now = new Date().toISOString();
    dataAssets.push({
      id: asset1, orgId, name: 'Some asset', description: '',
      systemId: sys1, owner: '', stewardIds: [],
      governanceTier: 'BRONZE', healthScore: 50,
      createdAt: now, updatedAt: now,
    });
    dataAssetBindings.push({
      id: binding1, orgId, dataAssetId: asset1, connectionId: conn,
      sourceAsset: 'some_table', isPrimary: true, createdAt: now, updatedAt: now,
    });

    const res = await request(port, 'POST', '/analysis/cube', {
      orgId,
      rowDims: ['systems'],
      colDims: ['connections'],
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    // Row labels come back as an array (one entry per row dim).
    // For a single-dim pivot each row's labels is [systemName].
    const rowTotals: Record<string, number> = {};
    for (const r of res.body.data.rows) {
      rowTotals[r.labels[0]] = r.total;
    }
    assert.strictEqual(rowTotals['Systems_1'], 1, 'Systems_1 should have exactly one connection (Systems.csv), not two');
    assert.strictEqual(rowTotals['Systems_2'], 1, 'Systems_2 should have exactly one connection (Systems.csv)');
    // Grand total = sum of row totals across the 2 rows.
    const grandTotal = Object.values(rowTotals).reduce((a, b) => a + b, 0);
    assert.strictEqual(grandTotal, 2, 'Grand total should be 2 unique system↔connection pairs, not 3');
  });

  it('Systems × Connections without any binding: baseline unchanged', async () => {
    // Without the extra binding fact the sys-conn link facts alone
    // still produce the right totals. Guards against a regression
    // where the fix broke the simple case.
    const res = await request(port, 'POST', '/analysis/cube', {
      orgId,
      rowDims: ['systems'],
      colDims: ['connections'],
    });
    assert.strictEqual(res.status, 200);
    const rowTotals: Record<string, number> = {};
    for (const r of res.body.data.rows) rowTotals[r.labels[0]] = r.total;
    assert.strictEqual(rowTotals['Systems_1'], 1);
    assert.strictEqual(rowTotals['Systems_2'], 1);
    const grandTotal = Object.values(rowTotals).reduce((a, b) => a + b, 0);
    assert.strictEqual(grandTotal, 2);
  });
});
