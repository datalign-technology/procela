// Streamable-HTTP MCP transport — exercises the pure `dispatchHttp` core (auth,
// body shape, batch, notifications) with a real signed token, plus the small
// header helpers and the Express router's GET/DELETE/POST wiring via mock
// req/res (no supertest in this workspace).

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { sign } from '../services/jwt-signer';
import { dispatchHttp, bearerToken, unverifiedPrincipal, mcpHttpRouter } from '../mcp/http';

const token = (over: Record<string, unknown> = {}) =>
  sign({ sub: 'u-mcp-http', email: 'mcp@tidewater.test', orgId: 'org-mcp-http', role: 'VIEWER', type: 'access', ...over }, { expiresIn: '5m' });

const auth = (t = token()) => `Bearer ${t}`;
const initMsg = { jsonrpc: '2.0' as const, id: 1, method: 'initialize', params: {} };

describe('MCP HTTP — header helpers', () => {
  it('bearerToken parses a well-formed header and rejects the rest', () => {
    assert.strictEqual(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
    assert.strictEqual(bearerToken('bearer abc'), 'abc'); // case-insensitive scheme
    assert.strictEqual(bearerToken('Basic abc'), null);
    assert.strictEqual(bearerToken(undefined), null);
    assert.strictEqual(bearerToken('Bearer   '), null);
  });

  it('unverifiedPrincipal extracts the token subject without verifying', () => {
    assert.strictEqual(unverifiedPrincipal(auth()), 'u-mcp-http');
    assert.strictEqual(unverifiedPrincipal('Bearer not-a-jwt'), null);
    assert.strictEqual(unverifiedPrincipal(undefined), null);
  });
});

describe('dispatchHttp — auth', () => {
  it('401s a missing Authorization header, with a Bearer challenge', async () => {
    const r = await dispatchHttp({ body: initMsg });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.headers['WWW-Authenticate'], 'Bearer');
    assert.strictEqual((r.json as { error: { code: number } }).error.code, -32600);
  });

  it('401s a malformed Authorization header', async () => {
    const r = await dispatchHttp({ authorization: 'Basic xyz', body: initMsg });
    assert.strictEqual(r.status, 401);
  });

  it('401s an invalid/forged token without leaking the reason', async () => {
    const r = await dispatchHttp({ authorization: 'Bearer a.b.c', body: initMsg });
    assert.strictEqual(r.status, 401);
    assert.match((r.json as { error: { message: string } }).error.message, /Invalid or expired/);
  });
});

describe('dispatchHttp — dispatch', () => {
  it('answers initialize with the protocol version + server info', async () => {
    const r = await dispatchHttp({ authorization: auth(), body: initMsg });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['Content-Type'], 'application/json');
    const body = r.json as { id: number; result: { protocolVersion: string; serverInfo: { name: string } } };
    assert.strictEqual(body.id, 1);
    assert.strictEqual(body.result.protocolVersion, '2024-11-05');
    assert.strictEqual(body.result.serverInfo.name, 'procela-governance');
  });

  it('lists the full v1 tool set over HTTP', async () => {
    const r = await dispatchHttp({ authorization: auth(), body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
    assert.strictEqual(r.status, 200);
    const names = (r.json as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(names, [
      'asset_health', 'find_processes_using_asset', 'get_owner', 'governance_scope',
      'list_gaps', 'list_value_streams', 'search_catalog',
    ]);
  });

  it('returns 202 (no body) for a notification-only request', async () => {
    const r = await dispatchHttp({ authorization: auth(), body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    assert.strictEqual(r.status, 202);
    assert.strictEqual(r.json, undefined);
  });

  it('handles a batch, returning an array of the id-bearing responses', async () => {
    const r = await dispatchHttp({
      authorization: auth(),
      body: [
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' }, // notification → no reply
        { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
      ],
    });
    assert.strictEqual(r.status, 200);
    const arr = r.json as Array<{ id: string }>;
    assert.strictEqual(arr.length, 2);
    assert.deepStrictEqual(arr.map((x) => x.id), ['a', 'b']);
  });

  it('rejects an empty batch with 400', async () => {
    const r = await dispatchHttp({ authorization: auth(), body: [] });
    assert.strictEqual(r.status, 400);
  });

  it('answers a non-JSON-RPC message with an error envelope, not a crash', async () => {
    const r = await dispatchHttp({ authorization: auth(), body: { hello: 'world' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((r.json as { error: { code: number } }).error.code, -32600);
  });
});

// ── Router wiring (mock req/res; no supertest) ──────────────────────────────
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Function }[] } };
function findHandler(method: string, path: string): Function {
  const router = mcpHttpRouter() as unknown as { stack: Layer[] };
  const layer = router.stack.find((l) => l.route?.path === path && l.route?.methods[method]);
  if (!layer?.route) throw new Error(`no ${method} ${path} route`);
  return layer.route.stack[0].handle;
}

function mockRes() {
  const state: { status: number; headers: Record<string, string>; body?: unknown; ended: boolean } =
    { status: 0, headers: {}, ended: false };
  const res = {
    setHeader(k: string, v: string) { state.headers[k] = v; },
    status(code: number) { state.status = code; return res; },
    json(payload: unknown) { state.body = payload; state.ended = true; return res; },
    end() { state.ended = true; return res; },
  };
  return { res, state };
}

describe('mcpHttpRouter — method wiring', () => {
  it('GET returns 405 with an Allow: POST header', async () => {
    const handler = findHandler('get', '/');
    const { res, state } = mockRes();
    await handler({ header: () => undefined }, res);
    assert.strictEqual(state.status, 405);
    assert.strictEqual(state.headers.Allow, 'POST');
  });

  it('DELETE is a 204 no-op (stateless transport)', async () => {
    const handler = findHandler('delete', '/');
    const { res, state } = mockRes();
    await handler({ header: () => undefined }, res);
    assert.strictEqual(state.status, 204);
    assert.strictEqual(state.ended, true);
  });

  it('POST delegates to dispatchHttp and serializes its result', async () => {
    const handler = findHandler('post', '/');
    const { res, state } = mockRes();
    const req = { header: (h: string) => (h.toLowerCase() === 'authorization' ? auth() : undefined), body: initMsg };
    await handler(req, res);
    assert.strictEqual(state.status, 200);
    assert.strictEqual((state.body as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'procela-governance');
  });

  it('POST of a notification ends with 202 and no body', async () => {
    const handler = findHandler('post', '/');
    const { res, state } = mockRes();
    const req = { header: (h: string) => (h.toLowerCase() === 'authorization' ? auth() : undefined), body: { jsonrpc: '2.0', method: 'ping' } };
    await handler(req, res);
    assert.strictEqual(state.status, 202);
    assert.strictEqual(state.body, undefined);
    assert.strictEqual(state.ended, true);
  });
});
