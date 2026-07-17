import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDataAssetColumnsRepository,
  prismaDataAssetColumnsRepository,
  type PrismaDataAssetColumnDelegate,
} from '../db/data-asset-columns.repo';
import type { StoredDataAssetColumn } from '../routes/data-assets';

const make = (over: Partial<StoredDataAssetColumn> = {}): StoredDataAssetColumn => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  dataAssetId: 'a1',
  columnName: 'email',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDataAssetColumnsRepository', () => {
  let store: StoredDataAssetColumn[];
  beforeEach(() => { store = []; });

  it('list returns all rows regardless of orgId filter (no orgId on the row)', async () => {
    const repo = jsonDataAssetColumnsRepository(store);
    store.push(make({ id: 'a' }), make({ id: 'b' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['a', 'b']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonDataAssetColumnsRepository(store);
    assert.strictEqual(await repo.update('gone', { columnName: 'x' }), null);
  });

  it('delete removes a row', async () => {
    const repo = jsonDataAssetColumnsRepository(store);
    await repo.create(make({ id: 'c1' }));
    assert.strictEqual(await repo.delete('c1'), true);
    assert.strictEqual((await repo.list()).length, 0);
  });
});

describe('prismaDataAssetColumnsRepository', () => {
  function delegate(over: Partial<PrismaDataAssetColumnDelegate> = {}): PrismaDataAssetColumnDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps nulls to undefined for optional fields', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'c1', dataAssetId: 'a1', columnName: 'email',
        dataType: null, description: null,
        sourceConnectionId: null, sourceAsset: null, sourceColumn: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaDataAssetColumnsRepository(() => ({ dataAssetColumn: d }));
    const rows = await repo.list({ orgId: 'ignored' });
    assert.strictEqual(rows[0].dataType, undefined);
    assert.strictEqual(rows[0].description, undefined);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaDataAssetColumnsRepository(() => ({ dataAssetColumn: d }));
    assert.strictEqual(await repo.update('gone', { columnName: 'x' }), null);
  });
});
