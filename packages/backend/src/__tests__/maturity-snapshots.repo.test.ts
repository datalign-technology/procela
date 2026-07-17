import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonMaturitySnapshotsRepository,
  prismaMaturitySnapshotsRepository,
  type PrismaMaturitySnapshotDelegate,
} from '../db/maturity-snapshots.repo';
import type { ScorecardSnapshot } from '../routes/maturity-trends';

const make = (over: Partial<ScorecardSnapshot> = {}): ScorecardSnapshot => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  timestamp: '2026-07-15T00:00:00.000Z',
  overall: 3.5,
  dimensions: [],
  ...over,
});

describe('jsonMaturitySnapshotsRepository', () => {
  let store: ScorecardSnapshot[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonMaturitySnapshotsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('create round-trips dimensions', async () => {
    const repo = jsonMaturitySnapshotsRepository(store);
    await repo.create(make({ id: 'a', dimensions: [{ name: 'D1', score: 4 }] }));
    const got = await repo.get('a');
    assert.strictEqual(got?.dimensions[0].name, 'D1');
  });
});

describe('prismaMaturitySnapshotsRepository', () => {
  function delegate(over: Partial<PrismaMaturitySnapshotDelegate> = {}): PrismaMaturitySnapshotDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps JSON dimensions through', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', timestamp: '2026-07-15T00:00:00.000Z',
        overall: 2.5, dimensions: [{ name: 'Governance', score: 3 }],
      }],
    });
    const repo = prismaMaturitySnapshotsRepository(() => ({ maturitySnapshot: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].overall, 2.5);
    assert.deepStrictEqual(rows[0].dimensions, [{ name: 'Governance', score: 3 }]);
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaMaturitySnapshotsRepository(() => ({ maturitySnapshot: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
