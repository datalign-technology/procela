import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonAssetLineageEdgesRepository,
  prismaAssetLineageEdgesRepository,
  type PrismaAssetLineageEdgeDelegate,
} from '../db/asset-lineage-edges.repo';
import type { AssetLineageEdge } from '../routes/data-lineage';

const make = (over: Partial<AssetLineageEdge> = {}): AssetLineageEdge => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  sourceAssetId: 's1',
  targetAssetId: 't1',
  source: 'dbt',
  lastSeenAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonAssetLineageEdgesRepository', () => {
  let store: AssetLineageEdge[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonAssetLineageEdgesRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('delete returns false when row missing', async () => {
    const repo = jsonAssetLineageEdgesRepository(store);
    assert.strictEqual(await repo.delete('gone'), false);
  });

  it('create preserves optional sourceRef', async () => {
    const repo = jsonAssetLineageEdgesRepository(store);
    await repo.create(make({ id: 'e1', sourceRef: 'model.foo.bar' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows[0].sourceRef, 'model.foo.bar');
  });
});

describe('prismaAssetLineageEdgesRepository', () => {
  function delegate(over: Partial<PrismaAssetLineageEdgeDelegate> = {}): PrismaAssetLineageEdgeDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list drops sourceRef when null', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'e1', orgId: 'o1', sourceAssetId: 's1', targetAssetId: 't1',
        source: 'manual', sourceRef: null, lastSeenAt: '2026-07-15T00:00:00.000Z',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaAssetLineageEdgesRepository(() => ({ assetLineageEdge: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].sourceRef, undefined);
    assert.strictEqual(rows[0].source, 'manual');
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaAssetLineageEdgesRepository(() => ({ assetLineageEdge: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
