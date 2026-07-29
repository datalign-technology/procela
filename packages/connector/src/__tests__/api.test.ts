import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { pairClaim, heartbeat, report } from '../api';
import type { ConnectorConfig } from '../types';

const cfg = (over: Partial<ConnectorConfig> = {}): ConnectorConfig => ({
  procelaUrl: 'https://api.procela.io/api/v1',
  heartbeatSeconds: 60,
  scanSeconds: 1800,
  sources: [],
  agentVersion: 'procela-connector/test',
  ...over,
});

interface Captured { url: string; init: RequestInit }
let calls: Captured[] = [];
const realFetch = globalThis.fetch;

function stubFetch(response: { ok?: boolean; json?: unknown }): void {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: response.ok ?? true,
      json: async () => response.json ?? {},
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('api — pairClaim', () => {
  it('POSTs the code + agentVersion to /connectors/pair/claim and returns the parsed body', async () => {
    stubFetch({ json: { success: true, data: { connectorId: 'c1', token: 'pct_abc' } } });
    const res = await pairClaim(cfg(), '12345678');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.procela.io/api/v1/connectors/pair/claim');
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.match(String((calls[0].init.headers as Record<string, string>)['Content-Type']), /application\/json/);
    const body = JSON.parse(String(calls[0].init.body));
    assert.strictEqual(body.code, '12345678');
    assert.strictEqual(body.agentVersion, 'procela-connector/test');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.token, 'pct_abc');
  });
});

describe('api — heartbeat', () => {
  it('returns false without calling fetch when there is no token', async () => {
    stubFetch({ ok: true });
    const ok = await heartbeat(cfg({ token: undefined }));
    assert.strictEqual(ok, false);
    assert.strictEqual(calls.length, 0);
  });

  it('POSTs with a Bearer token and reports success on res.ok', async () => {
    stubFetch({ ok: true });
    const ok = await heartbeat(cfg({ token: 'pct_abc' }));
    assert.strictEqual(ok, true);
    assert.strictEqual(calls[0].url, 'https://api.procela.io/api/v1/connectors/heartbeat');
    assert.strictEqual((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer pct_abc');
  });

  it('reports failure on a non-ok response', async () => {
    stubFetch({ ok: false });
    assert.strictEqual(await heartbeat(cfg({ token: 'pct_abc' })), false);
  });
});

describe('api — report', () => {
  it('short-circuits without a token', async () => {
    stubFetch({ ok: true });
    const res = await report(cfg({ token: undefined }), [{ name: 'public.t' }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'no token');
    assert.strictEqual(calls.length, 0);
  });

  it('POSTs { assets } with the Bearer token and returns upsert counts', async () => {
    stubFetch({ json: { success: true, data: { created: 2, updated: 1, total: 3 } } });
    const assets = [{ name: 'public.orders', rowCount: 10 }];
    const res = await report(cfg({ token: 'pct_abc' }), assets);
    assert.strictEqual(calls[0].url, 'https://api.procela.io/api/v1/connectors/report');
    assert.strictEqual((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer pct_abc');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)).assets, assets);
    assert.strictEqual(res.data?.created, 2);
  });
});

describe('api — url joining', () => {
  it('collapses a trailing slash on the base URL', async () => {
    stubFetch({ ok: true });
    await heartbeat(cfg({ procelaUrl: 'https://api.procela.io/api/v1/', token: 't' }));
    assert.strictEqual(calls[0].url, 'https://api.procela.io/api/v1/connectors/heartbeat');
  });
});
