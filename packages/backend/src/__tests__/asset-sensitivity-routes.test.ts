// Track 3 — AI-driven sensitivity classification.
//
// Two routes:
//   POST /:id/suggest-sensitivity → transient AI response
//   PUT  /:id/sensitivity          → persist accepted tags
//
// The AI call is stubbed so tests exercise the plumbing, not
// Claude — the aiService.suggestAssetSensitivity method is
// covered separately by its unit tests once we add them.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataAssetsRouter = require('../routes/data-assets').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dataAssets, dataAssetColumns } = require('../routes/data-assets');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { aiService } = require('../services/ai.service');

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

describe('/data-assets sensitivity routes', () => {
  let server: http.Server;
  let port: number;
  const PREFIX = 'test-sens-';
  const orgId = PREFIX + 'org';
  const assetId = PREFIX + 'asset';
  const colId = PREFIX + 'col';

  const originalSuggest = aiService.suggestAssetSensitivity.bind(aiService);
  let stubCall: any = null;

  before(async () => {
    // Stub the AI so the tests don't hit Anthropic. Records the
    // context it was called with so we can assert we're feeding
    // the right metadata.
    aiService.suggestAssetSensitivity = async (ctx: any) => {
      stubCall = ctx;
      return [
        { tag: 'PII', confidence: 'HIGH', reason: 'columns include email and phone' },
        { tag: 'CONFIDENTIAL', confidence: 'LOW', reason: 'CRM-adjacent context' },
      ];
    };

    const app = express();
    app.use(express.json());
    app.use('/data-assets', dataAssetsRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    aiService.suggestAssetSensitivity = originalSuggest;
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    // Reset the seeded asset between tests.
    const sweep = (arr: any[], pred: (r: any) => boolean) => {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    };
    sweep(dataAssets,        (a: any) => a.id === assetId);
    sweep(dataAssetColumns,  (c: any) => c.id === colId);
    const now = new Date().toISOString();
    dataAssets.push({
      id: assetId, orgId, name: 'Customer Master', description: 'Master record for accounts',
      systemId: null, ownerPersonId: null, stewardIds: [],
      governanceTier: 'BRONZE', healthScore: 50,
      createdAt: now, updatedAt: now,
    });
    dataAssetColumns.push({
      id: colId, dataAssetId: assetId, columnName: 'email', dataType: 'String',
      description: null, createdAt: now, updatedAt: now,
    });
    stubCall = null;
  });

  describe('POST /:id/suggest-sensitivity', () => {
    it('returns the classifier suggestions and forwards the asset context', async () => {
      const res = await request(port, 'POST', `/data-assets/${assetId}/suggest-sensitivity`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 2);
      assert.strictEqual(res.body.data[0].tag, 'PII');
      assert.strictEqual(res.body.data[0].confidence, 'HIGH');
      // Verify the AI got the right context.
      assert.strictEqual(stubCall.name, 'Customer Master');
      assert.strictEqual(stubCall.description, 'Master record for accounts');
      assert.ok(Array.isArray(stubCall.columns));
      assert.strictEqual(stubCall.columns.length, 1);
      assert.strictEqual(stubCall.columns[0].name, 'email');
    });

    it('404s on unknown asset', async () => {
      const res = await request(port, 'POST', '/data-assets/does-not-exist/suggest-sensitivity');
      assert.strictEqual(res.status, 404);
    });
  });

  describe('PUT /:id/sensitivity', () => {
    it('persists valid tags to the asset', async () => {
      const res = await request(port, 'PUT', `/data-assets/${assetId}/sensitivity`, { tags: ['PII', 'PHI'] });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.data.sensitivityTags, ['PII', 'PHI']);
      const stored = dataAssets.find((a: any) => a.id === assetId);
      assert.deepStrictEqual(stored.sensitivityTags, ['PII', 'PHI']);
    });

    it('dedupes repeated tags', async () => {
      const res = await request(port, 'PUT', `/data-assets/${assetId}/sensitivity`, { tags: ['PII', 'PII', 'PHI'] });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.data.sensitivityTags, ['PII', 'PHI']);
    });

    it('empty array clears the tags back to undefined', async () => {
      // First set some tags.
      await request(port, 'PUT', `/data-assets/${assetId}/sensitivity`, { tags: ['PII'] });
      // Then clear.
      const res = await request(port, 'PUT', `/data-assets/${assetId}/sensitivity`, { tags: [] });
      assert.strictEqual(res.status, 200);
      const stored = dataAssets.find((a: any) => a.id === assetId);
      assert.strictEqual(stored.sensitivityTags, undefined, 'empty array should clear back to untagged');
    });

    it('400s on an unknown tag string', async () => {
      const res = await request(port, 'PUT', `/data-assets/${assetId}/sensitivity`, { tags: ['MADE_UP'] });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /Unknown sensitivity tag/);
    });

    it('400s when tags is missing', async () => {
      const res = await request(port, 'PUT', `/data-assets/${assetId}/sensitivity`, {});
      assert.strictEqual(res.status, 400);
    });

    it('404s on unknown asset', async () => {
      const res = await request(port, 'PUT', '/data-assets/does-not-exist/sensitivity', { tags: [] });
      assert.strictEqual(res.status, 404);
    });
  });
});
