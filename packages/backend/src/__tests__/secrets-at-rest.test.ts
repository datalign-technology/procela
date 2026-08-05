// At-rest encryption wiring for the two secrets flagged by the GA audit
// (§F): DbtCloudConnection.token and OidcProvider.clientSecret. Proves the
// stored value is an envelope (never plaintext) while the value used at the
// call site is decrypted back.
//
// A deterministic, reversible KMS provider is installed at runtime via
// setKmsProvider, so the test is independent of module-load order and of
// whether MFA_ENCRYPTION_KEY happens to be set in the environment.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypto = require('../services/crypto.service') as typeof import('../services/crypto.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbtRouter = require('../routes/dbt-cloud-connections').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dbtCloudConnections } = require('../routes/dbt-cloud-connections');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const authProviders = require('../services/auth-providers') as typeof import('../services/auth-providers');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadStore } = require('../lib/persistence');

const PREFIX = 'enc:v1:';
const fakeKms = {
  name: 'test-fake-kms',
  async encrypt(p: string): Promise<string> { return PREFIX + Buffer.from(p, 'utf8').toString('base64'); },
  async decrypt(c: string): Promise<string> { return Buffer.from(c.slice(PREFIX.length), 'base64').toString('utf8'); },
};

function request(
  port: number, method: string, path: string, body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(Buffer.byteLength(data)); }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: chunks ? JSON.parse(chunks) : null }); }
        catch { resolve({ status: res.statusCode || 0, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('secrets at rest — dbt token & oidc clientSecret are enveloped', () => {
  let originalProvider: import('../services/crypto.service').KmsProvider;
  let server: http.Server;
  let port: number;

  before(async () => {
    originalProvider = crypto.getKmsProvider();
    crypto.setKmsProvider(fakeKms);
    const app = express();
    app.use(express.json());
    app.use('/dbt', dbtRouter);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    crypto.setKmsProvider(originalProvider);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('dbt Cloud token is encrypted in the store and never returned by the API', async () => {
    const res = await request(port, 'POST', '/dbt', {
      orgId: 'test-kms-org', name: 'KmsConn', accountId: '1', jobId: '2', token: 'dbt-plain-token',
    });
    assert.strictEqual(res.status, 201);
    // Public shape hides the token, exposes only hasToken.
    assert.strictEqual(res.body.data.token, undefined);
    assert.strictEqual(res.body.data.hasToken, true);
    // Stored value is an envelope, not the plaintext — and decrypts back.
    const stored = dbtCloudConnections.find((c: any) => c.orgId === 'test-kms-org' && c.name === 'KmsConn');
    assert.ok(stored, 'connection persisted');
    assert.notStrictEqual(stored.token, 'dbt-plain-token');
    assert.ok(stored.token.startsWith(PREFIX), `token not enveloped: ${stored.token.slice(0, 12)}`);
    assert.strictEqual(await crypto.decryptSecret(stored.token), 'dbt-plain-token');
    // cleanup
    const i = dbtCloudConnections.indexOf(stored);
    if (i >= 0) dbtCloudConnections.splice(i, 1);
  });

  it('oidc clientSecret is encrypted at rest but plaintext in the running provider', async () => {
    const id = 'test-kms-oidc';
    await authProviders.upsertOidcProvider({
      id, displayName: 'Test IdP', issuer: 'https://issuer.example', clientId: 'cid',
      clientSecret: 'oidc-plain-secret',
    });
    // The running provider keeps plaintext — the token exchange needs it.
    assert.strictEqual(authProviders.getOidcProvider(id)?.getConfig().clientSecret, 'oidc-plain-secret');
    // The persisted copy is an envelope that decrypts back.
    const persisted = loadStore('oidcProviders').find((p: any) => p.id === id);
    assert.ok(persisted, 'provider persisted');
    assert.notStrictEqual(persisted.clientSecret, 'oidc-plain-secret');
    assert.ok(persisted.clientSecret.startsWith(PREFIX), 'clientSecret not enveloped');
    assert.strictEqual(await crypto.decryptSecret(persisted.clientSecret), 'oidc-plain-secret');
    await authProviders.removeOidcProvider(id);
  });
});
