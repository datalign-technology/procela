import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { startAuthApp, type TestAppHandle } from './_helpers/test-app';
import { people } from '../routes/people';
import { useStoreIsolation } from './_helpers/store-isolation';

// End-to-end coverage for the refresh-token / session endpoints after their
// Postgres-cutover conversion to the RefreshToken repository (PR 3d). The
// /sessions endpoints had no tests; /refresh rotation is exercised here too.
// Runs against the dev auth provider (default in tests) over real HTTP.

async function call(
  url: string,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${url}/api/v1/auth${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(url: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await call(url, 'POST', '/login', { body: { email: 'ada@example.com', name: 'Ada' } });
  assert.strictEqual(res.status, 200, 'dev login should succeed');
  return { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
}

describe('refresh-token / session endpoints (repository-backed)', () => {
  useStoreIsolation({ file: 'refreshTokens', memory: [] }, { file: 'people', memory: people });

  let app: TestAppHandle;
  before(async () => { app = await startAuthApp(); });
  after(async () => { await app.close(); });

  it('GET /sessions lists the session; DELETE /sessions/:jti revokes it', async () => {
    const { accessToken } = await login(app.url);

    const listed = await call(app.url, 'GET', '/sessions', { token: accessToken });
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.body.data.length, 1);
    const session = listed.body.data[0];
    assert.strictEqual(session.current, true);
    assert.ok(session.jti);

    const revoked = await call(app.url, 'DELETE', `/sessions/${session.jti}`, { token: accessToken });
    assert.strictEqual(revoked.status, 204);

    const after = await call(app.url, 'GET', '/sessions', { token: accessToken });
    assert.strictEqual(after.body.data.length, 0);
  });

  it('POST /refresh rotates the token and revokes the old one', async () => {
    const { refreshToken } = await login(app.url);

    const first = await call(app.url, 'POST', '/refresh', { body: { refreshToken } });
    assert.strictEqual(first.status, 200);
    assert.ok(first.body.data.refreshToken);
    assert.notStrictEqual(first.body.data.refreshToken, refreshToken);

    // Re-using the now-rotated refresh token must be rejected.
    const reuse = await call(app.url, 'POST', '/refresh', { body: { refreshToken } });
    assert.strictEqual(reuse.status, 401);
  });

  it('DELETE /sessions revokes every session for the user', async () => {
    const { accessToken } = await login(app.url);
    await login(app.url); // a second device/session for the same dev user

    const all = await call(app.url, 'DELETE', '/sessions', { token: accessToken });
    assert.strictEqual(all.status, 200);
    assert.ok(all.body.data.revoked >= 1);

    const after = await call(app.url, 'GET', '/sessions', { token: accessToken });
    assert.strictEqual(after.body.data.length, 0);
  });
});
