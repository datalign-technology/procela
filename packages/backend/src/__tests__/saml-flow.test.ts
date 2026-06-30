import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';

import { people } from '../routes/people';
import { updateAuthConfig } from '../services/auth-providers';
import { auditLogs } from '../services/audit.service';
import { _setSamlProviderForTesting } from '../services/saml.service';
import { _resetRateLimitForTesting } from '../middleware/rate-limit';
import { snapshotStore, restoreStore, replaceArray } from './_helpers/store-isolation';
import { startAuthApp, type TestAppHandle } from './_helpers/test-app';
import { startMockSamlIdp, type MockSamlIdpHandle } from './_helpers/mock-saml-idp';

// End-to-end SAML 2.0: drives the SP-initiated flow over real HTTP
// against a self-hosted mock IdP. SAML's IdP-side authentication
// happens out-of-band in real deployments, so the test stops at:
//
//   1. POST /auth/login   →   { loginUrl } pointing at the mock IdP's
//                              SSO URL with a SAML AuthnRequest.
//   2. (IdP authenticates the user — skipped in tests; the helper
//      builds a signed assertion directly.)
//   3. POST /auth/saml/acs  with a signed SAMLResponse  →  Procela
//                              validates the signature against the
//                              configured IdP cert, finds-or-provisions
//                              the Person, mints Procela JWTs, and
//                              redirects to /oidc-complete with the
//                              tokens in the URL fragment.
//
// Each assertion verifies a specific security gate or wire-format
// contract so a regression surfaces with a focused failure.

let idp: MockSamlIdpHandle;
let app: TestAppHandle;

const peopleSnap = snapshotStore('people');
const auditSnap = snapshotStore('auditLogs');

// SAML config constants — the mock IdP and SP use these to validate
// audience / issuer / recipient.
const SP_ENTITY_ID = 'procela-test-sp';
const IDP_ENTITY_ID = 'mock-saml-idp.test';

before(async () => {
  idp = await startMockSamlIdp();
  app = await startAuthApp();
  _setSamlProviderForTesting({
    entryPoint: 'https://mock-saml-idp.test/sso',
    issuer: SP_ENTITY_ID,
    idpCert: idp.certificatePem,
    callbackUrl: `${app.url}/api/v1/auth/saml/acs`,
    logoutUrl: 'https://mock-saml-idp.test/slo',
  });
  updateAuthConfig({ provider: 'saml' });
});

after(async () => {
  _setSamlProviderForTesting(null);
  updateAuthConfig({ provider: 'dev' });
  await app.close();
  restoreStore(peopleSnap);
  restoreStore(auditSnap);
});

beforeEach(() => {
  replaceArray(people, []);
  replaceArray(auditLogs, []);
  _resetRateLimitForTesting();
});

async function postAcs(samlResponseB64: string, relayState?: string): Promise<Response> {
  const body = new URLSearchParams({ SAMLResponse: samlResponseB64 });
  if (relayState) body.set('RelayState', relayState);
  return fetch(`${app.url}/api/v1/auth/saml/acs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
}

function buildResponse(overrides: Partial<Parameters<MockSamlIdpHandle['buildSamlResponse']>[0]> = {}): string {
  return idp.buildSamlResponse({
    issuer: IDP_ENTITY_ID,
    audience: SP_ENTITY_ID,
    recipient: `${app.url}/api/v1/auth/saml/acs`,
    nameID: 'alice@example.com',
    attributes: {
      email: 'alice@example.com',
      displayName: 'Alice Example',
    },
    ...overrides,
  });
}

describe('SAML — startLogin (POST /auth/login)', () => {
  it('returns a loginUrl pointing at the IdP SSO endpoint with a SAMLRequest', async () => {
    const res = await fetch(`${app.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo: '/dashboard' }),
    });
    const bodyText = await res.text();
    assert.strictEqual(res.status, 200, bodyText);
    const json = JSON.parse(bodyText) as { success: boolean; data: { loginUrl: string; provider: string } };
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.data.provider, 'saml');
    const u = new URL(json.data.loginUrl);
    assert.strictEqual(u.origin + u.pathname, 'https://mock-saml-idp.test/sso');
    assert.ok(u.searchParams.get('SAMLRequest'), 'SAMLRequest parameter present');
    assert.ok(u.searchParams.get('RelayState'), 'RelayState carries the returnTo handle');
  });

  it('emits an audit entry recording the login redirect', async () => {
    await fetch(`${app.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo: '/' }),
    });
    assert.strictEqual(
      auditLogs.filter((e) => e.action === 'SAML_LOGIN_REDIRECT').length, 1,
    );
  });
});

describe('SAML — ACS happy path (POST /auth/saml/acs)', () => {
  it('verifies the signed assertion, provisions the Person, and redirects with tokens in the fragment', async () => {
    const res = await postAcs(buildResponse());
    const bodyText = await res.text();
    assert.strictEqual(res.status, 302, bodyText);
    const location = res.headers.get('location') || '';
    const fragment = location.split('#')[1];
    assert.ok(fragment, `redirect missing fragment: ${location}`);
    const params = new URLSearchParams(fragment);
    assert.ok(params.get('accessToken'), 'accessToken in fragment');
    assert.ok(params.get('refreshToken'), 'refreshToken in fragment');
    // Person was just-in-time provisioned.
    const person = people.find((p) => p.email === 'alice@example.com');
    assert.ok(person, 'person provisioned from assertion');
    assert.strictEqual(person.name, 'Alice Example');
    // Audit entry written.
    assert.strictEqual(
      auditLogs.filter((e) => e.action === 'SAML_LOGIN_SUCCESS').length, 1,
    );
  });

  it('round-trips the RelayState returnTo through the redirect', async () => {
    // POST /auth/login mints a RelayState that carries returnTo. We
    // can replicate that flow by extracting RelayState from the login
    // URL and posting it back.
    const loginRes = await fetch(`${app.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo: '/governance' }),
    });
    const loginJson = await loginRes.json() as { data: { loginUrl: string } };
    const relayState = new URL(loginJson.data.loginUrl).searchParams.get('RelayState')!;

    const res = await postAcs(buildResponse(), relayState);
    assert.strictEqual(res.status, 302);
    const fragment = (res.headers.get('location') || '').split('#')[1];
    assert.strictEqual(new URLSearchParams(fragment).get('returnTo'), '/governance');
  });

  it('reuses an existing Person when one matches the assertion email', async () => {
    people.push({
      id: 'existing-saml-1',
      orgIds: ['o1'],
      accessibleOrgIds: ['o1'],
      name: 'Existing SAML',
      email: 'existing-saml@example.com',
      role: 'ORG_ADMIN',
      title: 'CDO',
      skillIds: [],
      createdAt: new Date(Date.now() - 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 86400_000).toISOString(),
    });

    const res = await postAcs(buildResponse({
      nameID: 'existing-saml@example.com',
      attributes: { email: 'EXISTING-SAML@example.com', displayName: 'Different Name' },
    }));
    assert.strictEqual(res.status, 302);
    // Single record, original role + title preserved.
    const matches = people.filter((p) => p.email.toLowerCase() === 'existing-saml@example.com');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].role, 'ORG_ADMIN');
    assert.strictEqual(matches[0].title, 'CDO');
  });

  it('maps a role attribute onto the Procela role for new users', async () => {
    const res = await postAcs(buildResponse({
      nameID: 'role-test@example.com',
      attributes: {
        email: 'role-test@example.com',
        displayName: 'Role Test',
        role: 'ADMIN',
      },
    }));
    assert.strictEqual(res.status, 302);
    const person = people.find((p) => p.email === 'role-test@example.com');
    assert.ok(person);
    // mapClaimToRole rewrites 'ADMIN' → 'ORG_ADMIN'.
    assert.strictEqual(person.role, 'ORG_ADMIN');
  });

  it('captures NameID + SessionIndex on the refresh-token context for SLO', async () => {
    const sessionIndex = '_sess-' + Math.random().toString(36).slice(2);
    const res = await postAcs(buildResponse({
      nameID: 'slo-test@example.com',
      sessionIndex,
      attributes: { email: 'slo-test@example.com', displayName: 'SLO Test' },
    }));
    const fragment = (res.headers.get('location') || '').split('#')[1];
    const refreshToken = new URLSearchParams(fragment).get('refreshToken')!;

    // /auth/logout should drive SP-initiated SLO with the NameID hint.
    const logoutRes = await fetch(`${app.url}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    assert.strictEqual(logoutRes.status, 200);
    const body = await logoutRes.json() as { data: { logoutUrl?: string } };
    assert.ok(body.data.logoutUrl, 'SP-initiated SLO URL present');
    const lu = new URL(body.data.logoutUrl);
    assert.strictEqual(lu.origin + lu.pathname, 'https://mock-saml-idp.test/slo');
    assert.ok(lu.searchParams.get('SAMLRequest'), 'LogoutRequest in URL');
  });
});

describe('SAML — ACS error paths', () => {
  it('rejects an assertion signed with the wrong key', async () => {
    // Generate a separate keypair; sign the assertion with that
    // instead of the one Procela trusts.
    const otherIdp = await startMockSamlIdp();
    const res = await postAcs(buildResponse({
      signWith: {
        privateKeyPem: otherIdp.privateKeyPem,
        certificatePem: otherIdp.certificatePem,
      },
    }));
    // node-saml redirects to /login?error=… on validation failure.
    assert.strictEqual(res.status, 302);
    assert.ok((res.headers.get('location') || '').includes('/login?error='));
    // Person NOT provisioned.
    assert.strictEqual(people.find((p) => p.email === 'alice@example.com'), undefined);
    // Audit entry records the failure.
    assert.ok(auditLogs.some((e) => e.action === 'SAML_ACS_FAILED'));
  });

  it('rejects an assertion with a mismatched Audience', async () => {
    const res = await postAcs(buildResponse({ audience: 'someone-else-entity' }));
    assert.strictEqual(res.status, 302);
    assert.ok((res.headers.get('location') || '').includes('/login?error='));
    assert.strictEqual(people.length, 0);
  });

  it('rejects an expired assertion (NotOnOrAfter in the past)', async () => {
    const res = await postAcs(buildResponse({
      notBefore: new Date(Date.now() - 10 * 60_000),
      notOnOrAfter: new Date(Date.now() - 5 * 60_000),
    }));
    assert.strictEqual(res.status, 302);
    assert.ok((res.headers.get('location') || '').includes('/login?error='));
    assert.strictEqual(people.length, 0);
  });

  // Note: node-saml does NOT validate SubjectConfirmationData.Recipient
  // against the SP callback URL by default — replay protection relies
  // on Audience + signature verification. A misconfigured IdP could in
  // theory let an assertion bound for one SP be replayed elsewhere; the
  // Audience check is the primary defence. Tracked upstream at
  // node-saml#234 — if a future version adds Recipient validation this
  // file should grow a positive test for it.

  it('rejects a deactivated Person trying to sign in', async () => {
    people.push({
      id: 'deactivated-1',
      orgIds: ['o1'],
      accessibleOrgIds: ['o1'],
      name: 'Deactivated User',
      email: 'deact@example.com',
      role: 'VIEWER',
      title: '',
      skillIds: [],
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await postAcs(buildResponse({
      nameID: 'deact@example.com',
      attributes: { email: 'deact@example.com', displayName: 'Deact' },
    }));
    assert.strictEqual(res.status, 302);
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('/login?error='));
    assert.ok(decodeURIComponent(location).includes('not active'));
    assert.ok(auditLogs.some((e) => e.action === 'SAML_DEACTIVATED_LOGIN_BLOCKED'));
  });
});

describe('SAML — metadata + IdP-initiated SLO', () => {
  it('publishes SP metadata at /auth/saml/metadata', async () => {
    const res = await fetch(`${app.url}/api/v1/auth/saml/metadata`);
    const xml = await res.text();
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /xml/);
    assert.ok(xml.includes(`entityID="${SP_ENTITY_ID}"`));
    assert.ok(xml.includes('AssertionConsumerService'));
    assert.ok(xml.includes('SingleLogoutService'));
  });
});
