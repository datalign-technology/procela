import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonSavedViewsRepository,
  prismaSavedViewsRepository,
  type PrismaSavedViewDelegate,
} from '../db/saved-views.repo';
import type { StoredView } from '../routes/saved-views';

const make = (over: Partial<StoredView> = {}): StoredView => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  pageKey: 'data-assets',
  name: 'My view',
  ownerId: null,
  ownerName: null,
  filters: {},
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonSavedViewsRepository', () => {
  let store: StoredView[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonSavedViewsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonSavedViewsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});

describe('prismaSavedViewsRepository', () => {
  function delegate(over: Partial<PrismaSavedViewDelegate> = {}): PrismaSavedViewDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps prisma row → StoredView with nulls preserved', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', pageKey: 'p', name: 'n',
        ownerId: null, ownerName: null,
        filters: { status: 'ACTIVE' },
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaSavedViewsRepository(() => ({ savedView: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].ownerId, null);
    assert.strictEqual(rows[0].ownerName, null);
    assert.deepStrictEqual(rows[0].filters, { status: 'ACTIVE' });
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaSavedViewsRepository(() => ({ savedView: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
