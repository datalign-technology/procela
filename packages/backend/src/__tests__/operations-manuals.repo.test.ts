import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonOperationsManualsRepository,
  prismaOperationsManualsRepository,
  type PrismaOperationsManualDelegate,
} from '../db/operations-manuals.repo';
import type { StoredOperationsManual } from '../routes/operations-manuals';

const make = (over: Partial<StoredOperationsManual> = {}): StoredOperationsManual => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  roleType: 'STEWARD',
  label: 'Steward manual',
  purpose: '',
  daily: [],
  weekly: [],
  monthly: [],
  quarterly: [],
  escalation: [],
  customContent: '',
  isCustom: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonOperationsManualsRepository', () => {
  let store: StoredOperationsManual[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonOperationsManualsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonOperationsManualsRepository(store);
    assert.strictEqual(await repo.update('gone', { label: 'x' }), null);
  });
});

describe('prismaOperationsManualsRepository', () => {
  function delegate(over: Partial<PrismaOperationsManualDelegate> = {}): PrismaOperationsManualDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps prisma row → Stored, arrays default to []', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', roleType: 'STEWARD', label: 'x', purpose: '',
        daily: ['check schedule'], weekly: [], monthly: [], quarterly: [], escalation: [],
        customContent: '', isCustom: false,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaOperationsManualsRepository(() => ({ operationsManual: d }));
    const rows = await repo.list();
    assert.deepStrictEqual(rows[0].daily, ['check schedule']);
    assert.deepStrictEqual(rows[0].weekly, []);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaOperationsManualsRepository(() => ({ operationsManual: d }));
    assert.strictEqual(await repo.update('gone', { label: 'x' }), null);
  });
});
