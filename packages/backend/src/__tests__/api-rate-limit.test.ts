import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// Keep the limiter on its in-memory backend for the test: point Redis at
// a dead port with a tight connect timeout so the helper downgrades fast
// (same trick as rate-limit-failfast.test).
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.REDIS_CONNECT_TIMEOUT_MS = '500';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rateLimit, _resetRateLimitForTesting } =
  require('../middleware/rate-limit') as typeof import('../middleware/rate-limit');

// Mirror the coarse '/api/v1' backstop wired in index.ts: a per-IP
// ceiling that skips /connectors (machine/agent traffic).
function startApp(max: number): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  const apiLimiter = rateLimit({ windowMs: 60_000, max, keyBy: (req) => req.ip || 'unknown', label: 'api' });
  app.use('/api/v1', (req, res, next) => {
    if (req.path.startsWith('/connectors')) { next(); return; }
    apiLimiter(req, res, next);
  });
  app.get('/api/v1/data-assets', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/v1/connectors/agent', (_req, res) => { res.json({ ok: true }); });
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
    server.on('error', reject);
  });
}

describe('coarse /api/v1 rate limiter', () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => { app = await startApp(3); });
  after(async () => { await app.close(); });
  beforeEach(() => { _resetRateLimitForTesting(); });

  it('429s a protected path once the per-IP ceiling is exceeded', async () => {
    const hit = () => fetch(`${app.url}/api/v1/data-assets`).then((r) => r.status);
    assert.strictEqual(await hit(), 200);
    assert.strictEqual(await hit(), 200);
    assert.strictEqual(await hit(), 200);
    assert.strictEqual(await hit(), 429); // 4th request in the window
  });

  it('never throttles /connectors (machine/agent traffic is exempt)', async () => {
    const hit = () => fetch(`${app.url}/api/v1/connectors/agent`).then((r) => r.status);
    for (let i = 0; i < 6; i++) {
      assert.strictEqual(await hit(), 200);
    }
  });
});
