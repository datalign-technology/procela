import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonOidcProvidersRepository,
  prismaOidcProvidersRepository,
  type StoredOidcProvider,
  type PrismaOidcProviderDelegate,
} from '../db/oidc-providers.repo';
import { useStoreIsolation } from './_helpers/store-isolation';

const make = (over: Partial<StoredOidcProvider> = {}): StoredOidcProvider => ({
  id: 'default',
  displayName: 'Single sign-on',
  issuer: 'https://idp.example.com',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  ...over,
});

describe('jsonOidcProvidersRepository', () => {
  useStoreIsolation({ file: 'oidcProviders' });
  let store: StoredOidcProvider[];
  beforeEach(() => { store = []; });

  it('create then get round-trips', async () => {
    const repo = jsonOidcProvidersRepository(store);
    await repo.create(make({ id: 'okta', displayName: 'Okta' }));
    assert.strictEqual((await repo.get('okta'))?.displayName, 'Okta');
  });

  it('update merges; delete removes; update-missing returns null', async () => {
    const repo = jsonOidcProvidersRepository(store);
    await repo.create(make({ id: 'okta' }));
    await repo.update('okta', { clientSecret: 'rotated' });
    assert.strictEqual((await repo.get('okta'))?.clientSecret, 'rotated');
    assert.strictEqual(await repo.delete('okta'), true);
    assert.strictEqual(await repo.update('okta', { issuer: 'x' }), null);
  });
});

describe('prismaOidcProvidersRepository', () => {
  function delegate(over: Partial<PrismaOidcProviderDelegate> = {}): PrismaOidcProviderDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'default', displayName: 'SSO', issuer: 'i', clientId: 'c', clientSecret: 's',
    allowedEmailDomains: [] as string[],
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    ...over,
  });

  it('list maps empty allowedEmailDomains → undefined, non-empty preserved', async () => {
    const d = delegate({
      findMany: async () => [row(), row({ id: 'scoped', allowedEmailDomains: ['acme.com'] })],
    });
    const repo = prismaOidcProvidersRepository(() => ({ oidcProvider: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].allowedEmailDomains, undefined);
    assert.deepStrictEqual(rows[1].allowedEmailDomains, ['acme.com']);
  });

  it('update returns null and delete returns false on P2025', async () => {
    const p2025 = () => { const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e; };
    const repo = prismaOidcProvidersRepository(() => ({
      oidcProvider: delegate({ update: async () => p2025(), delete: async () => p2025() }),
    }));
    assert.strictEqual(await repo.update('gone', { issuer: 'x' }), null);
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
