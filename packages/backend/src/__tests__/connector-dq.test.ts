// Connector-side DQ endpoints: GET /connectors/dq-rules + POST
// /connectors/dq-results. The connector runs rules on-prem and pushes
// aggregate counts back; those record as MEASURED results (simulated:false)
// that drive real asset health — and only for the connector's own assets.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { createHash } from 'crypto';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const connectorDqRouter = require('../routes/connector-dq').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connectors } = require('../routes/connectors');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataQualityRules } = require('../routes/data-quality');

function request(
  port: number, method: string, path: string,
  opts: { body?: unknown; bearer?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('connector DQ endpoints', () => {
  let server: http.Server;
  let port: number;
  const orgId = 'test-org-cdq';
  const connectorId = 'test-cdq-connector';
  const otherConnectorId = 'test-cdq-other';
  const assetId = 'test-cdq-asset';
  const ruleId = 'test-cdq-rule';
  const TOKEN = 'pct_cdq_testtoken_abc123';
  const now = new Date().toISOString();

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/connectors', connectorDqRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;

    connectors.push({
      id: connectorId, orgId, name: 'test-cdq', tokenHash: createHash('sha256').update(TOKEN).digest('hex'),
      pairingCode: null, pairingCodeExpiresAt: null, systemIds: ['sys-1'],
      lastHeartbeatAt: now, agentVersion: '1.0.0', status: 'ONLINE', createdAt: now, updatedAt: now,
    });
    // Asset discovered by THIS connector, freshness-only health to start.
    dataAssets.push({
      id: assetId, orgId, name: 'public.customers', description: '', systemId: 'sys-1',
      owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 60,
      lastSyncedByConnectorId: connectorId, createdAt: now, updatedAt: now,
    });
    // A supported, column-targeted, typed rule on that asset.
    dataQualityRules.push({
      id: ruleId, orgId, dataAssetId: assetId, columnName: 'email', dimension: 'COMPLETENESS',
      name: 'email not null', description: '', threshold: 95, currentScore: 0, weight: 5,
      status: 'NOT_MEASURED', lastMeasured: null, ruleType: 'NOT_NULL', parameters: {},
      createdAt: now, updatedAt: now,
    });
  });

  after(async () => {
    const sweep = (arr: any[], pred: (x: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(connectors, (c) => c.orgId === orgId);
    sweep(dataAssets, (a) => a.orgId === orgId);
    sweep(dataQualityRules, (r) => r.orgId === orgId);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('rejects a missing / non-connector token', async () => {
    const noAuth = await request(port, 'GET', '/connectors/dq-rules');
    assert.strictEqual(noAuth.status, 401);
    const badAuth = await request(port, 'GET', '/connectors/dq-rules', { bearer: 'not-a-pct-token' });
    assert.strictEqual(badAuth.status, 401);
  });

  it('GET /dq-rules returns the plan for this connector\'s supported rules', async () => {
    const res = await request(port, 'GET', '/connectors/dq-rules', { bearer: TOKEN });
    assert.strictEqual(res.status, 200);
    const rules = res.body.data.rules;
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].ruleId, ruleId);
    assert.strictEqual(rules[0].table, 'public.customers');
    assert.strictEqual(rules[0].column, 'email');
    assert.strictEqual(rules[0].ruleType, 'NOT_NULL');
    assert.strictEqual(rules[0].systemId, 'sys-1');
  });

  it('POST /dq-results records a MEASURED result and drives real asset health', async () => {
    const res = await request(port, 'POST', '/connectors/dq-results', {
      bearer: TOKEN,
      body: { results: [{ ruleId, totalRows: 100, passCount: 98 }] },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.data, { applied: 1, skipped: 0 });

    const rule = dataQualityRules.find((r: any) => r.id === ruleId);
    assert.strictEqual(rule.lastRun.simulated, false, 'connector result must be measured, not simulated');
    assert.strictEqual(rule.currentScore, 98);
    assert.strictEqual(rule.lastRun.passCount, 98);
    assert.strictEqual(rule.lastRun.failCount, 2);

    // One measured rule (98) → asset health becomes 98, no longer the 60 freshness estimate.
    const asset = dataAssets.find((a: any) => a.id === assetId);
    assert.strictEqual(asset.healthScore, 98);
  });

  it('skips a result whose rule is not on this connector\'s assets', async () => {
    // A rule owned by a different connector's asset.
    const foreignAssetId = 'test-cdq-foreign-asset';
    const foreignRuleId = 'test-cdq-foreign-rule';
    dataAssets.push({
      id: foreignAssetId, orgId, name: 'public.foreign', description: '', systemId: 'sys-2',
      owner: '', stewardIds: [], governanceTier: 'BRONZE', healthScore: 60,
      lastSyncedByConnectorId: otherConnectorId, createdAt: now, updatedAt: now,
    });
    dataQualityRules.push({
      id: foreignRuleId, orgId, dataAssetId: foreignAssetId, columnName: 'x', dimension: 'COMPLETENESS',
      name: 'x', description: '', threshold: 95, currentScore: 0, weight: 5, status: 'NOT_MEASURED',
      lastMeasured: null, ruleType: 'NOT_NULL', parameters: {}, createdAt: now, updatedAt: now,
    });

    const res = await request(port, 'POST', '/connectors/dq-results', {
      bearer: TOKEN,
      body: { results: [{ ruleId: foreignRuleId, totalRows: 10, passCount: 10 }, { ruleId: 'nonexistent', totalRows: 5, passCount: 5 }] },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.data, { applied: 0, skipped: 2 });

    // The foreign asset's health is untouched (still its 60 freshness value).
    const foreign = dataAssets.find((a: any) => a.id === foreignAssetId);
    assert.strictEqual(foreign.healthScore, 60);
  });

  it('rejects a non-array body', async () => {
    const res = await request(port, 'POST', '/connectors/dq-results', { bearer: TOKEN, body: { results: 'nope' } });
    assert.strictEqual(res.status, 400);
  });
});
