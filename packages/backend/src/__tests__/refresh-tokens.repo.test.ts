import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonRefreshTokensRepository,
  prismaRefreshTokensRepository,
  type StoredRefreshToken,
  type PrismaRefreshTokenDelegate,
} from '../db/refresh-tokens.repo';
import { useStoreIsolation } from './_helpers/store-isolation';

describe('jsonRefreshTokensRepository', () => {
  useStoreIsolation({ file: 'refreshTokens' });
  let store: StoredRefreshToken[];
  beforeEach(() => { store = []; });

  it('upsert adds by jti, then replaces in place', async () => {
    const repo = jsonRefreshTokensRepository(store);
    await repo.upsert({ jti: 'j1', personId: 'p1', lastUsedAt: 'a' });
    await repo.upsert({ jti: 'j1', personId: 'p1', lastUsedAt: 'b' });
    assert.strictEqual(store.length, 1);
    assert.strictEqual((await repo.get('j1'))?.lastUsedAt, 'b');
  });

  it('remove revokes; missing jti returns false', async () => {
    const repo = jsonRefreshTokensRepository(store);
    await repo.upsert({ jti: 'j1' });
    assert.strictEqual(await repo.remove('j1'), true);
    assert.strictEqual(await repo.get('j1'), null);
    assert.strictEqual(await repo.remove('j1'), false);
  });
});

describe('prismaRefreshTokensRepository', () => {
  function delegate(over: Partial<PrismaRefreshTokenDelegate> = {}): PrismaRefreshTokenDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      upsert: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list drops null columns to undefined', async () => {
    const d = delegate({
      findMany: async () => [{
        jti: 'j1', personId: 'p1', oidcProviderId: null, oidcIdToken: null,
        samlNameID: null, samlSessionIndex: null, ip: null, userAgent: null,
        createdAt: '2026-07-20T00:00:00.000Z', lastUsedAt: null,
      }],
    });
    const repo = prismaRefreshTokensRepository(() => ({ refreshToken: d }));
    const [row] = await repo.list();
    assert.strictEqual(row.personId, 'p1');
    assert.strictEqual(row.createdAt, '2026-07-20T00:00:00.000Z');
    assert.ok(!('oidcProviderId' in row));
    assert.ok(!('lastUsedAt' in row));
  });

  it('upsert keys on jti; remove returns false on P2025', async () => {
    let where: unknown = null;
    const d = delegate({
      upsert: async (arg) => { where = arg.where; return { jti: 'j1' } as never; },
      delete: async () => { const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e; },
    });
    const repo = prismaRefreshTokensRepository(() => ({ refreshToken: d }));
    await repo.upsert({ jti: 'j1', personId: 'p1' });
    assert.deepStrictEqual(where, { jti: 'j1' });
    assert.strictEqual(await repo.remove('j1'), false);
  });
});
