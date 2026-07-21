import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import {
  OidcAuthProvider,
  upsertOidcProvider,
  removeOidcProvider,
  updateAuthConfig,
  getOidcProvider,
  getAuthConfig,
  type OidcConfig,
} from '../services/auth-providers';
import { useStoreIsolation } from './_helpers/store-isolation';

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');
function readStore(name: string): any[] {
  const p = path.join(DATA_DIR, `${name}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : [];
}

// Coverage for the Postgres-cutover conversion of auth-providers (PR 3c):
// writes now persist through the OidcProvider / AppSetting repositories while
// the read API stays synchronous over the in-memory instances.
describe('auth-providers persistence (PR 3c)', () => {
  useStoreIsolation({ file: 'oidcProviders' }, { file: 'appSettings' });

  it('OidcAuthProvider.getConfig() returns the full config including clientSecret', () => {
    const cfg: OidcConfig = { id: 'x', displayName: 'X', issuer: 'https://i', clientId: 'c', clientSecret: 's' };
    assert.deepStrictEqual(new OidcAuthProvider(cfg).getConfig(), cfg);
  });

  it('upsertOidcProvider persists config and populates the in-memory instance', async () => {
    const cfg: OidcConfig = {
      id: 'persist-idp', displayName: 'Persisted', issuer: 'https://idp.example.com',
      clientId: 'client-1', clientSecret: 'secret-1',
    };
    await upsertOidcProvider(cfg);

    // In-memory read API sees the live instance.
    assert.strictEqual(getOidcProvider('persist-idp')?.getPublicConfig().id, 'persist-idp');

    // Config (including clientSecret) is persisted to the store.
    const persisted = readStore('oidcProviders').find((r) => r.id === 'persist-idp');
    assert.ok(persisted, 'provider config should be persisted');
    assert.strictEqual(persisted.clientSecret, 'secret-1');
  });

  it('removeOidcProvider clears the instance and the persisted config', async () => {
    const cfg: OidcConfig = {
      id: 'temp-idp', displayName: 'Temp', issuer: 'https://i', clientId: 'c', clientSecret: 's',
    };
    await upsertOidcProvider(cfg);
    const removed = await removeOidcProvider('temp-idp');
    assert.strictEqual(removed, true);
    assert.strictEqual(getOidcProvider('temp-idp'), null);
    assert.strictEqual(readStore('oidcProviders').some((r) => r.id === 'temp-idp'), false);
  });

  it('updateAuthConfig persists the active provider to AppSetting', async () => {
    await updateAuthConfig({ provider: 'local' });
    assert.strictEqual(getAuthConfig().provider, 'local');
    const row = readStore('appSettings').find((r) => r.key === 'authConfig');
    assert.deepStrictEqual(row?.value, { activeProvider: 'local' });
    // Restore the process-wide default so sibling assertions aren't affected.
    await updateAuthConfig({ provider: 'dev' });
  });
});
