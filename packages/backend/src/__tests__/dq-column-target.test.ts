// runRuleNow must measure the PHYSICAL column the rule targets (resolved from
// the rule's DataAssetColumn), not the single asset-level sourceColumn. With
// two NOT_NULL rules on two different columns of the same LOCAL file, each must
// score its own column independently.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataQualityRouter = require('../routes/data-quality').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets, dataAssetBindings, dataAssetColumns } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataQualityRules } = require('../routes/data-quality');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connections } = require('../routes/connections');

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

describe('DQ per-column execution', () => {
  let server: http.Server;
  let port: number;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procela-dqcol-'));
  const csvPath = path.join(tmpDir, 'invoices.csv');
  const assetId = 'dqcol-asset';
  const connId = 'dqcol-conn';
  const now = new Date().toISOString();
  const emailColId = 'dqcol-col-email';
  const statusColId = 'dqcol-col-status';

  before(async () => {
    // email has one empty cell (row 3) → 83%; status is always present → 100%.
    fs.writeFileSync(csvPath, [
      'id,email,status',
      '1,alice@example.com,active',
      '2,bob@example.com,active',
      '3,,inactive',
      '4,dan@example.com,active',
      '5,eve@example.com,retired',
      '6,carol@example.com,active',
    ].join('\n'));

    connections.push({
      id: connId, orgId: 'dqcol-org', systemId: '',
      name: 'Invoices CSV', connectionType: 'FILE_STORAGE',
      config: { storageType: 'LOCAL', localFilePath: csvPath, originalFileName: 'invoices.csv' },
      credentials: {}, status: 'UNTESTED', lastTestedAt: null, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
    dataAssets.push({
      id: assetId, orgId: 'dqcol-org', name: 'Billing Records', description: '',
      systemId: '', owner: '', steward: '', governanceTier: 'SILVER', healthScore: 0,
      // Deliberately set the legacy asset-level sourceColumn to 'email' so a
      // regression (measuring asset.sourceColumn) would score BOTH rules 83%.
      sourceConnectionId: connId, sourceAsset: 'invoices.csv', sourceColumn: 'email',
      createdAt: now, updatedAt: now,
    });
    dataAssetBindings.push({
      id: 'dqcol-binding', orgId: 'dqcol-org', dataAssetId: assetId, connectionId: connId,
      sourceAsset: 'invoices.csv', sourceColumn: 'email', sourceColumns: ['email', 'status'],
      isPrimary: true, createdAt: now, updatedAt: now,
    });
    dataAssetColumns.push(
      { id: emailColId, dataAssetId: assetId, columnName: 'email', sourceConnectionId: connId, sourceAsset: 'invoices.csv', sourceColumn: 'email', createdAt: now, updatedAt: now },
      { id: statusColId, dataAssetId: assetId, columnName: 'status', sourceConnectionId: connId, sourceAsset: 'invoices.csv', sourceColumn: 'status', createdAt: now, updatedAt: now },
    );

    const app = express();
    app.use(express.json());
    app.use('/data-quality', dataQualityRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    for (const [store, id] of [[connections, connId], [dataAssets, assetId], [dataAssetBindings, 'dqcol-binding']] as const) {
      const i = store.findIndex((x: any) => x.id === id);
      if (i !== -1) store.splice(i, 1);
    }
    for (let i = dataAssetColumns.length - 1; i >= 0; i--) if (dataAssetColumns[i].dataAssetId === assetId) dataAssetColumns.splice(i, 1);
    for (let i = dataQualityRules.length - 1; i >= 0; i--) if (dataQualityRules[i].dataAssetId === assetId) dataQualityRules.splice(i, 1);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('measures each rule against its own target column', async () => {
    const mk = (columnId: string, name: string) => request(port, 'POST', '/data-quality', {
      dataAssetId: assetId, columnId, name, dimension: 'COMPLETENESS', ruleType: 'NOT_NULL', threshold: 95, weight: 5,
    });
    const emailRule = (await mk(emailColId, 'email not null')).body.data;
    const statusRule = (await mk(statusColId, 'status not null')).body.data;

    const emailRun = await request(port, 'POST', `/data-quality/${emailRule.id}/run`);
    const statusRun = await request(port, 'POST', `/data-quality/${statusRule.id}/run`);

    // Real (non-simulated) measurement against the LOCAL file.
    assert.strictEqual(emailRun.body.data.simulated, false);
    assert.strictEqual(statusRun.body.data.simulated, false);
    // email has one empty cell → 83%; status is complete → 100%. If execution
    // regressed to asset.sourceColumn ('email'), status would wrongly read 83%.
    assert.strictEqual(emailRun.body.data.passRate, 83);
    assert.strictEqual(statusRun.body.data.passRate, 100);
  });

  it('PUT re-targets a rule to a different column and syncs columnName', async () => {
    // Start asset-level (no column), then target it via PUT.
    const created = (await request(port, 'POST', '/data-quality', {
      dataAssetId: assetId, name: 'retarget me', dimension: 'COMPLETENESS', ruleType: 'NOT_NULL', threshold: 95,
    })).body.data;
    assert.strictEqual(created.columnId, undefined);

    const put = await request(port, 'PUT', `/data-quality/${created.id}`, { columnId: statusColId });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.data.columnId, statusColId);
    assert.strictEqual(put.body.data.columnName, 'status');

    // It now measures the status column (100%), proving the re-target took.
    const run = await request(port, 'POST', `/data-quality/${created.id}/run`);
    assert.strictEqual(run.body.data.passRate, 100);

    // Clearing the column returns it to asset-level.
    const cleared = await request(port, 'PUT', `/data-quality/${created.id}`, { columnId: '' });
    assert.strictEqual(cleared.body.data.columnId, undefined);
    assert.strictEqual(cleared.body.data.columnName, undefined);
  });
});
