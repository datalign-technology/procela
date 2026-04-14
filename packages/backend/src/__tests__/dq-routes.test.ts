import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// The route only imports config lazily through jwt; no env plumbing needed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataQualityRouter = require('../routes/data-quality').default;

// ── Minimal HTTP helper ──

function request(port: number, method: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode || 0, body: body ? JSON.parse(body) : null }); }
          catch { resolve({ status: res.statusCode || 0, body }); }
        });
      },
    );
    req.on('error', reject);
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
});
