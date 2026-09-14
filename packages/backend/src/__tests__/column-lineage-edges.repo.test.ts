import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonColumnLineageEdgesRepository,
  prismaColumnLineageEdgesRepository,
  type PrismaColumnLineageEdgeDelegate,
} from '../db/column-lineage-edges.repo';
import type { ColumnLineageEdge } from '../routes/data-lineage';

const make = (over: Partial<ColumnLineageEdge> = {}): ColumnLineageEdge => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  sourceColumnId: 'sc1',
  targetColumnId: 'tc1',
  source: 'sql',
  lastSeenAt: '2026-09-14T00:00:00.000Z',
  createdAt: '2026-09-14T00:00:00.000Z',
  ...over,
});

describe('jsonColumnLineageEdgesRepository', () => {
  let store: ColumnLineageEdge[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonColumnLineageEdgesRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('create preserves sourceRef and update patches lastSeenAt', async () => {
    const repo = jsonColumnLineageEdgesRepository(store);
    await repo.create(make({ id: 'e1', sourceRef: 'sqlcol:sc1->tc1' }));
    await repo.update('e1', { lastSeenAt: '2026-10-01T00:00:00.000Z' });
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows[0].sourceRef, 'sqlcol:sc1->tc1');
    assert.strictEqual(rows[0].lastSeenAt, '2026-10-01T00:00:00.000Z');
  });

  it('delete returns false when row missing', async () => {
    const repo = jsonColumnLineageEdgesRepository(store);
    assert.strictEqual(await repo.delete('gone'), false);
  });
});

describe('prismaColumnLineageEdgesRepository', () => {
  function delegate(over: Partial<PrismaColumnLineageEdgeDelegate> = {}): PrismaColumnLineageEdgeDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list drops sourceRef when null and maps source through', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'e1', orgId: 'o1', sourceColumnId: 'sc1', targetColumnId: 'tc1',
        source: 'manual', sourceRef: null, lastSeenAt: '2026-09-14T00:00:00.000Z',
        createdAt: new Date('2026-09-14T00:00:00.000Z'),
      }],
    });
    const repo = prismaColumnLineageEdgesRepository(() => ({ columnLineageEdge: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].sourceRef, undefined);
    assert.strictEqual(rows[0].source, 'manual');
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => { const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e; },
    });
    const repo = prismaColumnLineageEdgesRepository(() => ({ columnLineageEdge: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
