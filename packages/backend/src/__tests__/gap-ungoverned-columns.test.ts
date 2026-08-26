// Gap detection surfaces "ungoverned bound columns": a column carrying a
// physical source pointer (the asset was bound to it) but with no DQ rule.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const gapRouter = require('../routes/gap-detection').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets, dataAssetColumns } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataQualityRules } = require('../routes/data-quality');

function get(port: number, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let c = ''; res.on('data', (d) => { c += d; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: c ? JSON.parse(c) : null }));
    }).on('error', reject);
  });
}

describe('gap-detection: ungoverned bound columns', () => {
  let server: http.Server;
  let port: number;
  const assetId = 'gapcol-asset';
  const now = new Date().toISOString();

  before(async () => {
    dataAssets.push({
      id: assetId, orgId: 'gapcol-org', name: 'Billing Records', description: '',
      systemId: '', owner: '', steward: '', governanceTier: 'SILVER', healthScore: 0,
      createdAt: now, updatedAt: now,
    });
    // Two bound columns (physical source pointer set); one will get a rule.
    dataAssetColumns.push(
      { id: 'gapcol-amount', dataAssetId: assetId, columnName: 'amount', sourceColumn: 'amount', sourceAsset: 'invoices', createdAt: now, updatedAt: now },
      { id: 'gapcol-status', dataAssetId: assetId, columnName: 'status', sourceColumn: 'status', sourceAsset: 'invoices', createdAt: now, updatedAt: now },
      // An un-bound column (no sourceColumn) must NOT count — it isn't claimed.
      { id: 'gapcol-note', dataAssetId: assetId, columnName: 'note', createdAt: now, updatedAt: now },
    );
    dataQualityRules.push({
      id: 'gapcol-rule', dataAssetId: assetId, columnId: 'gapcol-amount',
      name: 'amount not null', ruleType: 'NOT_NULL', dimension: 'COMPLETENESS',
      threshold: 95, weight: 5, status: 'PASSING', createdAt: now, updatedAt: now,
    });

    const app = express();
    app.use('/gaps', gapRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    const ai = dataAssets.findIndex((a: any) => a.id === assetId);
    if (ai !== -1) dataAssets.splice(ai, 1);
    for (let i = dataAssetColumns.length - 1; i >= 0; i--) if (dataAssetColumns[i].dataAssetId === assetId) dataAssetColumns.splice(i, 1);
    for (let i = dataQualityRules.length - 1; i >= 0; i--) if (dataQualityRules[i].dataAssetId === assetId) dataQualityRules.splice(i, 1);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('flags a bound column with no rule, but not ruled or un-bound columns', async () => {
    const res = await get(port, '/gaps');
    assert.strictEqual(res.status, 200);
    const group = res.body.data.ungovernedColumns.find((g: any) => g.assetId === assetId);
    assert.ok(group, 'asset appears in ungovernedColumns');
    // 'status' is bound but ruleless → flagged. 'amount' has a rule → excluded.
    // 'note' has no source pointer → not a bound column → excluded.
    assert.deepStrictEqual(group.columns, ['status']);
    assert.strictEqual(group.count, 1);
  });
});
