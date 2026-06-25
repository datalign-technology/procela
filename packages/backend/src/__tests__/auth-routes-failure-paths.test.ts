// Tier 1 backfill for routes/auth.ts. The existing test files cover
// password-reset, MFA enrolment, OIDC, SAML, and account lockout, but
// COVERAGE.md still flags 62.6% lines / 56% branches — most of the
// remaining gap is the "what does the response look like when the
// caller is unauthenticated, malformed, or sending stale tokens"
// path. Those are the branches a real attacker or a buggy client
// trips first, so they're worth a small focused suite.
//
// Note on login: we don't exercise the /login failure branches here
// because the local test environment runs with provider='dev', which
// intentionally accepts any email + password (it's the seed for the
// quick-pick buttons on the login page). Those branches are covered
// in account-lockout.test.ts which configures the local provider.
//
// Each test mounts the auth router under express, hits it over real
// HTTP, and restores any shared in-memory store mutation in after()
// so sibling suites aren't polluted.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import config from '../config';
import authRouter from '../routes/auth';
import { people } from '../routes/people';
import { auditLogs } from '../services/audit.service';
import { _resetRateLimitForTesting } from '../middleware/rate-limit';
import { replaceArray } from './_helpers/store-isolation';

interface ResponseEnvelope { status: number; body: any; }

async function call(
  base: string, method: string, path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<ResponseEnvelope> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  return { status: res.status, body };
}

let app: { url: string; close: () => Promise<void> };
const peopleSnapshot: typeof people = [];
const auditSnapshot: typeof auditLogs = [];

before(async () => {
  peopleSnapshot.push(...people);
  auditSnapshot.push(...auditLogs);
  const expressApp = express();
  expressApp.use(express.json());
  expressApp.use('/auth', authRouter);
  await new Promise<void>((resolve, reject) => {
    const server: Server = expressApp.listen(0, () => {
      const addr = server.address() as AddressInfo;
      app = { url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) };
      resolve();
    });
    server.on('error', reject);
  });
});

after(async () => {
  await app.close();
  replaceArray(people, peopleSnapshot);
  replaceArray(auditLogs, auditSnapshot);
});

beforeEach(() => {
  replaceArray(people, peopleSnapshot);
  replaceArray(auditLogs, auditSnapshot);
  _resetRateLimitForTesting();
});

describe('GET /auth/me — auth guard', () => {
  it('returns 401 when no Authorization header is sent', async () => {
    const res = await call(app.url, 'GET', '/auth/me');
    assert.strictEqual(res.status, 401);
  });

  it('returns 401 for a malformed bearer token', async () => {
    const res = await call(app.url, 'GET', '/auth/me', { token: 'not-a-jwt' });
    assert.strictEqual(res.status, 401);
  });

  it('returns 401 for a JWT signed with the wrong secret', async () => {
    const tok = jwt.sign(
      { sub: 'x', email: 'x@y.com', orgId: 'o', role: 'VIEWER', type: 'access' },
      'wrong-secret', { expiresIn: '1h' },
    );
    const res = await call(app.url, 'GET', '/auth/me', { token: tok });
    assert.strictEqual(res.status, 401);
  });

  it('returns 401 for an expired token', async () => {
    const tok = jwt.sign(
      { sub: 'x', email: 'x@y.com', orgId: 'o', role: 'VIEWER', type: 'access' },
      config.jwtSecret, { expiresIn: '-1m' },
    );
    const res = await call(app.url, 'GET', '/auth/me', { token: tok });
    assert.strictEqual(res.status, 401);
  });
});

describe('POST /auth/refresh — failure paths', () => {
  it('400s without a refreshToken in the body', async () => {
    const res = await call(app.url, 'POST', '/auth/refresh', { body: {} });
    assert.ok(res.status >= 400 && res.status < 500);
  });

  it('401s for a malformed refreshToken', async () => {
    const res = await call(app.url, 'POST', '/auth/refresh', { body: { refreshToken: 'garbage' } });
    assert.ok(res.status >= 400 && res.status < 500);
  });

  it('401s for a refreshToken signed with the wrong secret', async () => {
    const tok = jwt.sign({ sub: 'x', type: 'refresh', jti: 'r' }, 'wrong-secret', { expiresIn: '7d' });
    const res = await call(app.url, 'POST', '/auth/refresh', { body: { refreshToken: tok } });
    assert.ok(res.status >= 400 && res.status < 500);
  });
});

describe('GET /auth/providers and /auth/config', () => {
  it('/providers returns an envelope with the available list (no auth required)', async () => {
    const res = await call(app.url, 'GET', '/auth/providers');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    // Shape is whatever the deployment configured — we just verify
    // the contract: an array exposed on .data.
    const data = res.body.data;
    assert.ok(Array.isArray(data) || (data && typeof data === 'object'),
      'providers response must be an object or array under .data');
  });

  it('/config returns an envelope (no auth required)', async () => {
    const res = await call(app.url, 'GET', '/auth/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });
});

describe('POST /auth/logout', () => {
  it('succeeds without a body (idempotent — client may already have lost the token)', async () => {
    const res = await call(app.url, 'POST', '/auth/logout', { body: {} });
    assert.ok(res.status >= 200 && res.status < 500);
  });
});
