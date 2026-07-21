import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonOrgKeyedMappingRepository,
  prismaOrgKeyedMappingRepository,
  getDbtTestMappingsRepository,
  type DbtAssetMappingRow,
  type DbtTestMappingRow,
  type PrismaOrgKeyedDelegate,
} from '../db/dbt-mappings.repo';
import { useStoreIsolation } from './_helpers/store-isolation';

describe('jsonOrgKeyedMappingRepository (dbt asset mappings)', () => {
  useStoreIsolation({ file: 'dbtAssetMappings' });
  let store: DbtAssetMappingRow[];
  beforeEach(() => { store = []; });

  it('upsert adds then replaces on the (orgId, dbtUniqueId) key', async () => {
    const repo = jsonOrgKeyedMappingRepository(store, 'dbtAssetMappings');
    await repo.upsert({ orgId: 'o1', dbtUniqueId: 'model.x', assetId: 'a1' });
    await repo.upsert({ orgId: 'o1', dbtUniqueId: 'model.x', assetId: 'a2' });
    assert.strictEqual(store.length, 1);
    assert.strictEqual(store[0].assetId, 'a2');
  });

  it('list filters by orgId', async () => {
    const repo = jsonOrgKeyedMappingRepository(store, 'dbtAssetMappings');
    await repo.upsert({ orgId: 'o1', dbtUniqueId: 'm1', assetId: 'a1' });
    await repo.upsert({ orgId: 'o2', dbtUniqueId: 'm2', assetId: 'a2' });
    assert.deepStrictEqual((await repo.list('o1')).map((r) => r.dbtUniqueId), ['m1']);
    assert.strictEqual((await repo.list()).length, 2);
  });

  it('remove deletes a pair; missing returns false', async () => {
    const repo = jsonOrgKeyedMappingRepository(store, 'dbtAssetMappings');
    await repo.upsert({ orgId: 'o1', dbtUniqueId: 'm1', assetId: 'a1' });
    assert.strictEqual(await repo.remove('o1', 'm1'), true);
    assert.strictEqual(await repo.remove('o1', 'm1'), false);
  });
});

describe('getDbtTestMappingsRepository (JSON mode)', () => {
  useStoreIsolation({ file: 'dbtTestMappings' });

  it('the test-mapping getter shares the same generic behavior', async () => {
    const store: DbtTestMappingRow[] = [];
    const repo = getDbtTestMappingsRepository(store); // JSON: no DATABASE_URL in tests
    await repo.upsert({ orgId: 'o1', dbtUniqueId: 'test.x', ruleId: 'r1' });
    assert.deepStrictEqual((await repo.list('o1')).map((r) => r.ruleId), ['r1']);
  });
});

describe('prismaOrgKeyedMappingRepository', () => {
  function delegate(over: Partial<PrismaOrgKeyedDelegate<DbtAssetMappingRow>> = {}): PrismaOrgKeyedDelegate<DbtAssetMappingRow> {
    return {
      findMany: async () => [],
      upsert: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list scopes to orgId via a where clause', async () => {
    let where: unknown = 'unset';
    const d = delegate({ findMany: async (arg) => { where = arg?.where; return []; } });
    const repo = prismaOrgKeyedMappingRepository<DbtAssetMappingRow>(() => d);
    await repo.list('o1');
    assert.deepStrictEqual(where, { orgId: 'o1' });
  });

  it('remove returns false on P2025', async () => {
    const d = delegate({
      delete: async () => { const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e; },
    });
    const repo = prismaOrgKeyedMappingRepository<DbtAssetMappingRow>(() => d);
    assert.strictEqual(await repo.remove('o1', 'm1'), false);
  });
});
