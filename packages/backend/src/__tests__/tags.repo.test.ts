import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonTagsRepository,
  prismaTagsRepository,
  type PrismaTagDelegate,
} from '../db/tags.repo';
import type { StoredTag } from '../routes/tags';

const make = (over: Partial<StoredTag> = {}): StoredTag => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  entityType: 'DataAsset',
  entityId: 'a1',
  tag: 'pii',
  createdBy: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonTagsRepository', () => {
  let store: StoredTag[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonTagsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonTagsRepository(store);
    assert.strictEqual(await repo.update('gone', { tag: 'x' }), null);
  });
});

describe('prismaTagsRepository', () => {
  function delegate(over: Partial<PrismaTagDelegate> = {}): PrismaTagDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps prisma row → StoredTag', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', entityType: 'DataAsset', entityId: 'x', tag: 'pii',
        createdBy: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaTagsRepository(() => ({ tag: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].tag, 'pii');
    assert.strictEqual(rows[0].createdAt, '2026-07-15T00:00:00.000Z');
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaTagsRepository(() => ({ tag: d }));
    assert.strictEqual(await repo.update('gone', { tag: 'x' }), null);
  });
});
