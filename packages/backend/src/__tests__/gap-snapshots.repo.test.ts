import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGapSnapshotsRepository,
  prismaGapSnapshotsRepository,
  type PrismaGapSnapshotDelegate,
} from '../db/gap-snapshots.repo';
import type { GapSnapshot } from '../services/digest.service';

const make = (over: Partial<GapSnapshot> = {}): GapSnapshot => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  takenAt: '2026-07-15T00:00:00.000Z',
  metrics: {
    activities: 10, mappedActivities: 6, coveragePct: 60,
    orphanAssets: 2, ungovernedAssets: 3, ownerlessItems: 1,
  },
  ...over,
});

describe('jsonGapSnapshotsRepository', () => {
  let store: GapSnapshot[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGapSnapshotsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonGapSnapshotsRepository(store);
    assert.strictEqual(await repo.update('gone', { takenAt: 'x' }), null);
  });
});

describe('prismaGapSnapshotsRepository', () => {
  function delegate(over: Partial<PrismaGapSnapshotDelegate> = {}): PrismaGapSnapshotDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list forwards metrics as-is', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', takenAt: '2026-07-15T00:00:00.000Z',
        metrics: {
          activities: 5, mappedActivities: 3, coveragePct: 60,
          orphanAssets: 1, ungovernedAssets: 0, ownerlessItems: 2,
        },
      }],
    });
    const repo = prismaGapSnapshotsRepository(() => ({ gapSnapshot: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].metrics.activities, 5);
    assert.strictEqual(rows[0].metrics.ownerlessItems, 2);
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaGapSnapshotsRepository(() => ({ gapSnapshot: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
