import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDataLineageLinksRepository,
  prismaDataLineageLinksRepository,
  type PrismaDataLineageLinkDelegate,
} from '../db/data-lineage-links.repo';
import type { DataLineageLink } from '../routes/data-lineage';

const make = (over: Partial<DataLineageLink> = {}): DataLineageLink => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  sourceSystemId: 's1',
  targetSystemId: 's2',
  dataAssetId: null,
  description: '',
  flowType: 'ETL',
  frequency: 'DAILY',
  status: 'ACTIVE',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDataLineageLinksRepository', () => {
  let store: DataLineageLink[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonDataLineageLinksRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonDataLineageLinksRepository(store);
    assert.strictEqual(await repo.update('gone', { description: 'x' }), null);
  });
});

describe('prismaDataLineageLinksRepository', () => {
  function delegate(over: Partial<PrismaDataLineageLinkDelegate> = {}): PrismaDataLineageLinkDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps null dataAssetId through', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', sourceSystemId: 's1', targetSystemId: 's2',
        dataAssetId: null, description: 'desc', flowType: 'API',
        frequency: 'REAL_TIME', status: 'ACTIVE',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaDataLineageLinksRepository(() => ({ dataLineageLink: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].dataAssetId, null);
    assert.strictEqual(rows[0].flowType, 'API');
    assert.strictEqual(rows[0].frequency, 'REAL_TIME');
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaDataLineageLinksRepository(() => ({ dataLineageLink: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
