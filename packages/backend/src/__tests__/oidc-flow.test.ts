import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import { people } from '../routes/people';
import { upsertOidcProvider, removeOidcProvider, updateAuthConfig } from '../services/auth-providers';
import { _clearAllForTesting as clearPendingFlows, peekFlow } from '../services/pending-oidc-flows';
import { auditLogs } from '../services/audit.service';
import { _resetRateLimitForTesting } from '../middleware/rate-limit';
import { snapshotStore, restoreStore, replaceArray } from './_helpers/store-isolation';
import { startAuthApp, type TestAppHandle } from './_helpers/test-app';
import { startMockOidcIdp, type MockOidcIdpHandle } from './_helpers/mock-oidc-idp';

// End-to-end OIDC: drives the Authorization Code + PKCE flow over
// real HTTP against a self-hosted mock IdP.
//
//  1. POST /auth/login   →   { loginUrl } pointing at the mock IdP's
//                            /authorize URL with state + code_challenge.
//  2. Mock IdP "authenticates" the user (test fakes this by extracting
//     state from the URL and minting an authorization code).
//  3. GET /auth/callback?code=…&state=…   →   Procela exchanges the
//                            code at the mock IdP's /token, verifies
//                            the id_token against the JWKS, find-or-
//                            provisions the Person, mints Procela JWTs,
//                            and redirects to /oidc-complete with the
//                            tokens in the URL fragment.
//
// Each assertion verifies a specific contract — wire format, security
// gate, or persistence side effect — so a regression in any one piece
// surfaces with a focused failure.

let idp: MockOidcIdpHandle;
let app: TestAppHandle;

const peopleSnap = snapshotStore('people');
const auditSnap = snapshotStore('auditLogs');

before(async () => {
  idp = await startMockOidcIdp();
  upsertOidcProvider({
    id: 'default',
    displayName: 'Mock IdP',
    issuer: idp.url,
    clientId: idp.clientId,
    clientSecret: 'unused-by-mock',
  });
  updateAuthConfig({ provider: 'oidc' });
  app = await startAuthApp();
});

after(async () => {
  removeOidcProvider('default');
  updateAuthConfig({ provider: 'dev' });
  await app.close();
  await idp.close();
  restoreStore(peopleSnap);
  restoreStore(auditSnap);
});

beforeEach(() => {
  clearPendingFlows();
  replaceArray(people, []);
  replaceArray(auditLogs, []);
  // The auth router's /login route is throttled — 5/min and 20/hour
  // per (IP, email). Each test starts from a clean counter so a
  // long suite doesn't trip the limiter halfway through.
  _resetRateLimitForTesting();
});

// Pull `state` out of a `loginUrl` query string so the callback can
// reference it. The provider mints state freshly each flow.
function getState(loginUrl: string): string {
  const u = new URL(loginUrl);
  const s = u.searchParams.get('state');
  if (!s) throw new Error('state missing from loginUrl');
  return s;
}

async function startFlow(opts: { returnTo?: string } = {}): Promise<{ state: string; loginUrl: string }> {
  const res = await fetch(`${app.url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      returnTo: opts.returnTo || '/',
    }),
  });
  // Drain to text first so we can both show it on assertion failure
  // AND parse on success. assert.strictEqual's lazy `message` arg
  // doesn't help here because the await would still consume the body
  // before the comparison runs.
  const bodyText = await res.text();
  assert.strictEqual(res.status, 200, bodyText);
  const json = JSON.parse(bodyText) as { success: boolean; data: { loginUrl: string } };
  assert.strictEqual(json.success, true);
  return { loginUrl: json.data.loginUrl, state: getState(json.data.loginUrl) };
}

describe('OIDC — startLogin (POST /auth/login)', () => {
  it('builds the IdP authorize URL with the canonical query parameters', async () => {
    const { loginUrl } = await startFlow();
    const u = new URL(loginUrl);
    assert.strictEqual(u.origin + u.pathname, `${idp.url}/oauth2/authorize`);
    const q = u.searchParams;
    assert.strictEqual(q.get('response_type'), 'code');
    assert.strictEqual(q.get('client_id'), idp.clientId);
    assert.strictEqual(q.get('scope'), 'openid email profile');
    assert.ok(q.get('state'), 'state present');
    assert.ok(q.get('nonce'), 'nonce present');
    assert.strictEqual(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/, 'PKCE S256 challenge is 43 base64url chars');
    assert.ok(q.get('redirect_uri'), 'redirect_uri present');
  });

  it('records the pending flow keyed by state so the callback can consume it', async () => {
    const { state } = await startFlow({ returnTo: '/dashboard' });
    const flow = peekFlow(state);
    assert.ok(flow, 'flow stored');
    assert.strictEqual(flow.returnTo, '/dashboard');
    assert.ok(flow.codeVerifier, 'PKCE verifier stored');
    assert.ok(flow.nonce, 'nonce stored');
  });

  it('mints distinct state + nonce per call (no replay across flows)', async () => {
    const a = await startFlow();
    const b = await startFlow();
    assert.notStrictEqual(a.state, b.state);
    const aNonce = new URL(a.loginUrl).searchParams.get('nonce');
    const bNonce = new URL(b.loginUrl).searchParams.get('nonce');
    assert.notStrictEqual(aNonce, bNonce);
  });
});

describe('OIDC — callback (GET /auth/callback)', () => {
  it('completes the flow end-to-end: code → tokens → JIT-provisioned Person → fragment-bearing redirect', async () => {
    const { state, loginUrl } = await startFlow({ returnTo: '/dashboard' });
    const idToken = idp.signIdToken({
      sub: 'mock-user-1',
      email: 'alice@example.com',
      name: 'Alice Example',
      nonce: new URL(loginUrl).searchParams.get('nonce'),
    });
    const code = idp.expectCodeExchange(idToken);

    const res = await fetch(
      `${app.url}/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );

    assert.strictEqual(res.status, 302);
    const location = res.headers.get('location') || '';
    // Tokens travel in the URL fragment, not the query string — keeps
    // them out of access logs / referrers.
    const fragment = location.split('#')[1];
    assert.ok(fragment, `redirect missing fragment: ${location}`);
    const params = new URLSearchParams(fragment);
    assert.ok(params.get('accessToken'), 'accessToken in fragment');
    assert.ok(params.get('refreshToken'), 'refreshToken in fragment');
    assert.strictEqual(params.get('returnTo'), '/dashboard');

    // Person was just-in-time provisioned from the id_token claims.
    const person = people.find((p) => p.email === 'alice@example.com');
    assert.ok(person, 'person provisioned');
    assert.strictEqual(person.name, 'Alice Example');

    // Audit log captures the success.
    const successEvents = auditLogs.filter((e) => e.action === 'OIDC_CALLBACK_SUCCESS');
    assert.strictEqual(successEvents.length, 1);
  });

  it('reuses an existing Person when one matches the id_token email', async () => {
    // Seed an existing person with extra fields; OIDC find-or-provision
    // must NOT clobber them.
    people.push({
      id: 'existing-1',
      orgIds: ['o1'],
      accessibleOrgIds: ['o1'],
      name: 'Existing User',
      email: 'existing@example.com',
      role: 'ORG_ADMIN',
      title: 'Director',
      skillIds: ['skill-a'],
      createdAt: new Date(Date.now() - 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 86400_000).toISOString(),
    });

    const { state, loginUrl } = await startFlow();
    const idToken = idp.signIdToken({
      sub: 'idp-sub-789',
      email: 'EXISTING@example.com', // case-insensitive match
      name: 'Different Name',
      nonce: new URL(loginUrl).searchParams.get('nonce'),
    });
    const code = idp.expectCodeExchange(idToken);
    const res = await fetch(
      `${app.url}/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    assert.strictEqual(res.status, 302);

    // No duplicate created.
    assert.strictEqual(
      people.filter((p) => p.email.toLowerCase() === 'existing@example.com').length, 1,
    );
    const person = people.find((p) => p.email === 'existing@example.com')!;
    // Original role + title preserved.
    assert.strictEqual(person.role, 'ORG_ADMIN');
    assert.strictEqual(person.title, 'Director');
  });

  it('refuses an unknown state (replay / forged callback)', async () => {
    const res = await fetch(
      `${app.url}/api/v1/auth/callback?code=any&state=never-minted`,
      { redirect: 'manual' },
    );
    assert.strictEqual(res.status, 302);
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('/login?error='), location);
    assert.ok(decodeURIComponent(location).includes('Invalid or expired state'));
  });

  it('refuses an id_token whose nonce does not match the pending flow', async () => {
    const { state, loginUrl } = await startFlow();
    void loginUrl;
    const idToken = idp.signIdToken({
      sub: 'mock-user-2',
      email: 'bob@example.com',
      nonce: 'TOTALLY-DIFFERENT-NONCE',
    });
    const code = idp.expectCodeExchange(idToken);
    const res = await fetch(
      `${app.url}/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    assert.strictEqual(res.status, 302);
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('/login?error='), location);
    assert.ok(decodeURIComponent(location).includes('nonce'), 'error references nonce');
    // Person NOT provisioned.
    assert.strictEqual(people.find((p) => p.email === 'bob@example.com'), undefined);
  });

  it('refuses an id_token signed with the wrong key (forged token)', async () => {
    const { state, loginUrl } = await startFlow();
    // Hand-craft an unsigned JWT-shaped string. JWKS verification fails.
    const fakeToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2UifQ.eyJpc3MiOiJodHRwOi8vZmFrZSJ9.bm90LWEtcmVhbC1zaWc';
    const code = idp.expectCodeExchange(fakeToken);
    void loginUrl;
    const res = await fetch(
      `${app.url}/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    assert.strictEqual(res.status, 302);
    assert.ok((res.headers.get('location') || '').includes('/login?error='));
  });

  it('refuses an OIDC error response from the IdP (user cancelled)', async () => {
    const { state } = await startFlow();
    const res = await fetch(
      `${app.url}/api/v1/auth/callback?error=access_denied&error_description=User%20cancelled&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    assert.strictEqual(res.status, 302);
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('/login?error=User%20cancelled'), location);
  });
});

describe('OIDC — refresh-token context for RP-initiated logout', () => {
  it('captures the OIDC providerId + id_token on the refresh-token entry', async () => {
    const { state, loginUrl } = await startFlow();
    const idToken = idp.signIdToken({
      sub: 'mock-user-3',
      email: 'carol@example.com',
      name: 'Carol',
      nonce: new URL(loginUrl).searchParams.get('nonce'),
    });
    const code = idp.expectCodeExchange(idToken);
    const cb = await fetch(
      `${app.url}/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    const fragment = (cb.headers.get('location') || '').split('#')[1];
    const refreshToken = new URLSearchParams(fragment).get('refreshToken')!;

    // /auth/logout should return an RP-initiated logoutUrl pointing at
    // the mock IdP's end_session_endpoint with the id_token as hint.
    const logoutRes = await fetch(`${app.url}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    assert.strictEqual(logoutRes.status, 200);
    const body = await logoutRes.json() as { data: { logoutUrl?: string } };
    assert.ok(body.data.logoutUrl, 'RP-initiated logoutUrl present');
    const lu = new URL(body.data.logoutUrl);
    assert.strictEqual(lu.origin + lu.pathname, `${idp.url}/oauth2/end_session`);
    assert.strictEqual(lu.searchParams.get('id_token_hint'), idToken);
  });
});

describe('OIDC — refresh-token rotation after OIDC login', () => {
  it('issues a new refresh token on /auth/refresh and revokes the old one', async () => {
    const { state, loginUrl } = await startFlow();
    const idToken = idp.signIdToken({
      sub: 'mock-user-4',
      email: 'dan@example.com',
      name: 'Dan',
      nonce: new URL(loginUrl).searchParams.get('nonce'),
    });
    const code = idp.expectCodeExchange(idToken);
    const cb = await fetch(
      `${app.url}/api/v1/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    const fragment = (cb.headers.get('location') || '').split('#')[1];
    const firstRefresh = new URLSearchParams(fragment).get('refreshToken')!;

    const r1 = await fetch(`${app.url}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: firstRefresh }),
    });
    assert.strictEqual(r1.status, 200);
    const r1json = await r1.json() as { data: { accessToken: string; refreshToken: string } };
    assert.ok(r1json.data.refreshToken, 'rotation returns a new refresh token');
    assert.notStrictEqual(r1json.data.refreshToken, firstRefresh, 'rotation changes the token');

    // Re-use of the old refresh token must fail closed (single-use).
    const replay = await fetch(`${app.url}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: firstRefresh }),
    });
    assert.strictEqual(replay.status, 401, 'old refresh token must not be reusable after rotation');
  });
});
