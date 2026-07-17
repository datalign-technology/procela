import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonProcessVersionsRepository,
  prismaProcessVersionsRepository,
  type PrismaProcessVersionDelegate,
} from '../db/process-versions.repo';
import type { ProcessVersion, ProcessNode } from '../routes/process-catalog';

const snapshot = (): ProcessNode => ({
  id: 'n1',
  parentId: null,
  level: 'ACTIVITY',
  name: 'do the thing',
  description: '',
  activityId: null,
  status: 'DRAFT',
  orderIndex: 0,
  orgId: 'o1',
  orgIds: ['o1'],
  ownerId: null,
  version: 1,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
});

const make = (over: Partial<ProcessVersion> = {}): ProcessVersion => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  nodeId: 'n1',
  version: 1,
  snapshot: snapshot(),
  changedBy: null,
  changedAt: '2026-07-15T00:00:00.000Z',
  status: 'DRAFT',
  note: '',
  ...over,
});

describe('jsonProcessVersionsRepository', () => {
  let store: ProcessVersion[];
  beforeEach(() => { store = []; });

  it('list returns all rows and ignores orgId filter', async () => {
    const repo = jsonProcessVersionsRepository(store);
    store.push(make({ id: 'a' }), make({ id: 'b' }));
    const all = await repo.list();
    assert.deepStrictEqual(all.map((r) => r.id), ['a', 'b']);
    const filtered = await repo.list({ orgId: 'anything' });
    assert.deepStrictEqual(filtered.map((r) => r.id), ['a', 'b']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonProcessVersionsRepository(store);
    assert.strictEqual(await repo.update('gone', { note: 'x' }), null);
  });
});

describe('prismaProcessVersionsRepository', () => {
  function delegate(over: Partial<PrismaProcessVersionDelegate> = {}): PrismaProcessVersionDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list casts snapshot JSON to ProcessNode', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', nodeId: 'n1', version: 2,
        snapshot: snapshot(),
        changedBy: null, changedAt: '2026-07-15T00:00:00.000Z',
        status: 'ACTIVE', note: 'bumped',
      }],
    });
    const repo = prismaProcessVersionsRepository(() => ({ processVersion: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].snapshot.name, 'do the thing');
    assert.strictEqual(rows[0].note, 'bumped');
    assert.strictEqual(rows[0].changedBy, null);
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaProcessVersionsRepository(() => ({ processVersion: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
