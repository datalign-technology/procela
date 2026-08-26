import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDataAssetBindingsRepository,
  prismaDataAssetBindingsRepository,
  type PrismaDataAssetBindingDelegate,
} from '../db/data-asset-bindings.repo';
import type { StoredDataAssetBinding } from '../routes/data-assets';

const make = (over: Partial<StoredDataAssetBinding> = {}): StoredDataAssetBinding => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  dataAssetId: 'a1',
  connectionId: 'c1',
  sourceAsset: 'public.customers',
  isPrimary: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDataAssetBindingsRepository', () => {
  let store: StoredDataAssetBinding[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonDataAssetBindingsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonDataAssetBindingsRepository(store);
    assert.strictEqual(await repo.update('gone', { label: 'prod' }), null);
  });

  it('carries optional label + isPrimary', async () => {
    const repo = jsonDataAssetBindingsRepository(store);
    await repo.create(make({ id: 'b1', label: 'prod', isPrimary: true }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows[0].label, 'prod');
    assert.strictEqual(rows[0].isPrimary, true);
  });
});

describe('prismaDataAssetBindingsRepository', () => {
  function delegate(over: Partial<PrismaDataAssetBindingDelegate> = {}): PrismaDataAssetBindingDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list drops nulls for optional cols', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'b1', orgId: 'o1', dataAssetId: 'a1', connectionId: 'c1',
        sourceAsset: 'public.customers', sourceColumn: null, sourceColumns: [], label: null, isPrimary: true,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaDataAssetBindingsRepository(() => ({ dataAssetBinding: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].sourceColumn, undefined);
    assert.strictEqual(rows[0].sourceColumns, undefined);
    assert.strictEqual(rows[0].label, undefined);
    assert.strictEqual(rows[0].isPrimary, true);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaDataAssetBindingsRepository(() => ({ dataAssetBinding: d }));
    assert.strictEqual(await repo.update('gone', { label: 'x' }), null);
  });
});
