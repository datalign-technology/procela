import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// The rate-limit module reads config.redisUrl + REDIS_CONNECT_TIMEOUT_MS
// at import time. Set both BEFORE the require so the helper's timeout
// is short enough to keep the test suite snappy. Using require() here
// instead of top-level await because tsx's CJS output doesn't support
// the latter.
process.env.REDIS_URL = 'redis://127.0.0.1:1';  // port 1 — guaranteed unused
process.env.REDIS_CONNECT_TIMEOUT_MS = '500';   // 500ms — gives the in-test attempt a tight ceiling

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rateLimit, _resetRateLimitForTesting } =
  require('../middleware/rate-limit') as typeof import('../middleware/rate-limit');

async function startApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/login', rateLimit({ windowMs: 60_000, max: 100, label: 'test_login' }));
  app.post('/login', (_req, res) => { res.json({ ok: true }); });
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

describe('rate-limit — Redis fail-fast', () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => { app = await startApp(); });
  after(async () => { await app.close(); });
  beforeEach(() => { _resetRateLimitForTesting(); });

  it('falls through to in-memory within REDIS_CONNECT_TIMEOUT_MS when Redis is unreachable', async () => {
    // The first request triggers the lazy Redis connect. Without the
    // fail-fast guard this would sit on the TCP retry budget (~20s
    // on Windows) before falling through. With the guard, the whole
    // request — including the timed-out Redis connect plus the
    // in-memory increment + response — should complete in well under
    // a couple of seconds.
    const start = Date.now();
    const res = await fetch(`${app.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@x.io' }),
    });
    const elapsed = Date.now() - start;

    assert.strictEqual(res.status, 200);
    // Generous ceiling: the connect timeout is 500ms; add the
    // request-overhead headroom and we should still be well under 3s.
    // The OLD code without the guard would hang for 20-30s on
    // Windows or fail in <100ms on Linux — both fail this assertion
    // if regressed (Windows hangs, Linux falls under the ceiling
    // anyway because the kernel refuses immediately).
    assert.ok(elapsed < 3_000, `request took ${elapsed}ms — Redis fail-fast guard regressed?`);
  });

  it('subsequent requests skip the Redis connect entirely (redisAttempted latch)', async () => {
    // Warm-up — primes the redisAttempted latch.
    await fetch(`${app.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@x.io' }),
    });

    // Second call must NOT re-attempt the connect. We verify by
    // bounding the duration tightly — well below the connect timeout.
    const start = Date.now();
    const res = await fetch(`${app.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@x.io' }),
    });
    const elapsed = Date.now() - start;

    assert.strictEqual(res.status, 200);
    assert.ok(elapsed < 200, `second request took ${elapsed}ms — connect not skipped after first attempt`);
  });
});
