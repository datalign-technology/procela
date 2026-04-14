import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataQualityRouter = require('../routes/data-quality').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataQualityRules } = require('../routes/data-quality');

// ── Minimal HTTP helper ──

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

describe('/data-quality routing', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/data-quality', dataQualityRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('GET /templates is reachable and NOT shadowed by GET /:id', async () => {
    // Regression for a real bug: `/templates` must be declared before
    // `/:id` in the router, otherwise Express matches this as
    // { id: "templates" } and returns 404 "Quality rule not found".
    const res = await request(port, 'GET', '/data-quality/templates?column=email');
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status} with body ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body?.success, true);
    assert.ok(Array.isArray(res.body?.data?.suggested));
    assert.ok(Array.isArray(res.body?.data?.generic));
    // `email` should light up the regex-email template as suggested.
    assert.ok(res.body.data.suggested.some((t: any) => t.id === 'regex-email'));
    // Every template comes back with a `definition` (even without assetId).
    for (const t of [...res.body.data.suggested, ...res.body.data.generic]) {
      assert.ok(t.definition, `template ${t.id} missing definition`);
    }
  });

  it('GET /:id still returns 404 for a non-existent id', async () => {
    const res = await request(port, 'GET', '/data-quality/does-not-exist-id');
    assert.strictEqual(res.status, 404);
  });

  it('POST /:id/run also auto-recomputes the asset healthScore', async () => {
    // Seed an asset directly into the in-memory store (no other route
    // mounted here so we can't go through POST /data-assets). Health
    // starts at 0 — the test verifies it changes after running a rule.
    const now = new Date().toISOString();
    const seedAsset = {
      id: 'test-dq-run-asset',
      orgId: 'test-org',
      name: 'Run-target asset',
      description: '',
      systemId: '',
      owner: '', steward: '',
      governanceTier: 'BRONZE',
      healthScore: 0,
      createdAt: now, updatedAt: now,
    };
    dataAssets.push(seedAsset);

    try {
      // Create a typed rule (NOT_NULL doesn't need params; CUSTOM is
      // overkill here). With no real LOCAL file the engine simulates
      // a deterministic pass rate, which is exactly what we want.
      const create = await request(port, 'POST', '/data-quality', {
        dataAssetId: seedAsset.id,
        name: 'Auto-recompute test',
        ruleType: 'NOT_NULL',
        threshold: 95,
        weight: 5,
      });
      assert.strictEqual(create.status, 201);
      const ruleId = create.body.data.id;

      assert.strictEqual(seedAsset.healthScore, 0, 'health should start at 0');

      const run = await request(port, 'POST', `/data-quality/${ruleId}/run`);
      assert.strictEqual(run.status, 200);
      assert.ok(run.body.data.passRate >= 0 && run.body.data.passRate <= 100);

      // The asset's healthScore should now equal the simulated pass rate
      // because there's exactly one rule, so the weighted average == the
      // pass rate.
      const updatedRule = dataQualityRules.find((r: any) => r.id === ruleId);
      assert.ok(updatedRule, 'rule should exist after run');
      assert.strictEqual(seedAsset.healthScore, updatedRule.currentScore,
        `expected asset.healthScore (${seedAsset.healthScore}) to match rule.currentScore (${updatedRule.currentScore})`);
    } finally {
      // Clean up so the next test run starts fresh.
      const ai = dataAssets.indexOf(seedAsset);
      if (ai !== -1) dataAssets.splice(ai, 1);
      for (let i = dataQualityRules.length - 1; i >= 0; i--) {
        if (dataQualityRules[i].dataAssetId === seedAsset.id) dataQualityRules.splice(i, 1);
      }
    }
  });
});
