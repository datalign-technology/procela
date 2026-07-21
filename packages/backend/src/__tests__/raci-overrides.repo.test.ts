import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonRaciOverridesRepository,
  prismaRaciOverridesRepository,
  type RaciOverrideRow,
  type PrismaRaciOverrideDelegate,
} from '../db/raci-overrides.repo';
import { useStoreIsolation } from './_helpers/store-isolation';

describe('jsonRaciOverridesRepository', () => {
  useStoreIsolation({ file: 'raciOverrides' });
  let store: RaciOverrideRow[];
  beforeEach(() => { store = []; });

  it('upsert adds a new pair, then replaces it in place', async () => {
    const repo = jsonRaciOverridesRepository(store);
    await repo.upsert({ nodeId: 'n1', personId: 'p1', value: 'R' });
    await repo.upsert({ nodeId: 'n1', personId: 'p1', value: 'A', reason: 'owner' });
    assert.strictEqual(store.length, 1);
    assert.strictEqual(store[0].value, 'A');
    assert.strictEqual(store[0].reason, 'owner');
  });

  it('remove deletes a pair; missing pair returns false', async () => {
    const repo = jsonRaciOverridesRepository(store);
    await repo.upsert({ nodeId: 'n1', personId: 'p1', value: 'R' });
    assert.strictEqual(await repo.remove('n1', 'p1'), true);
    assert.strictEqual((await repo.list()).length, 0);
    assert.strictEqual(await repo.remove('n1', 'p1'), false);
  });
});

describe('prismaRaciOverridesRepository', () => {
  function delegate(over: Partial<PrismaRaciOverrideDelegate> = {}): PrismaRaciOverrideDelegate {
    return {
      findMany: async () => [],
      upsert: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps null reason → undefined', async () => {
    const d = delegate({
      findMany: async () => [{ nodeId: 'n1', personId: 'p1', value: 'C', reason: null } as unknown as RaciOverrideRow],
    });
    const repo = prismaRaciOverridesRepository(() => ({ raciOverride: d }));
    const [row] = await repo.list();
    assert.strictEqual(row.reason, undefined);
    assert.strictEqual(row.value, 'C');
  });

  it('remove returns false on P2025', async () => {
    const d = delegate({
      delete: async () => { const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e; },
    });
    const repo = prismaRaciOverridesRepository(() => ({ raciOverride: d }));
    assert.strictEqual(await repo.remove('n1', 'p1'), false);
  });

  it('upsert keys on the composite (nodeId, personId)', async () => {
    let where: unknown = null;
    const d = delegate({
      upsert: async (arg) => { where = arg.where; return { nodeId: 'n1', personId: 'p1', value: 'A' }; },
    });
    const repo = prismaRaciOverridesRepository(() => ({ raciOverride: d }));
    await repo.upsert({ nodeId: 'n1', personId: 'p1', value: 'A' });
    assert.deepStrictEqual(where, { nodeId_personId: { nodeId: 'n1', personId: 'p1' } });
  });
});
