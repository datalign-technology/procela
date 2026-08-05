import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonSopsRepository,
  prismaSopsRepository,
  type PrismaSopDelegate,
} from '../db/sops.repo';
import type { StoredSop } from '../routes/sops';

const make = (over: Partial<StoredSop> = {}): StoredSop => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  code: 'SOP-001',
  title: 't',
  purpose: '',
  category: 'OTHER' as StoredSop['category'],
  applicableRoles: [],
  triggerEvent: '',
  steps: [],
  status: 'DRAFT' as StoredSop['status'],
  version: 1,
  ownerPersonId: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonSopsRepository', () => {
  let store: StoredSop[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonSopsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonSopsRepository(store);
    assert.strictEqual(await repo.update('gone', { title: 'x' }), null);
  });
});

describe('prismaSopsRepository', () => {
  function delegate(over: Partial<PrismaSopDelegate> = {}): PrismaSopDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps prisma row → StoredSop with nulls and JSON round-trip', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', code: 'SOP-001', title: 't', purpose: '',
        category: 'OTHER', applicableRoles: ['STEWARD'], triggerEvent: '',
        steps: [{ order: 1, title: 's', description: '', estimatedMinutes: 5 }],
        status: 'DRAFT', version: 1, ownerPersonId: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaSopsRepository(() => ({ sop: d }));
    const rows = await repo.list();
    assert.deepStrictEqual(rows[0].applicableRoles, ['STEWARD']);
    assert.strictEqual(rows[0].steps.length, 1);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaSopsRepository(() => ({ sop: d }));
    assert.strictEqual(await repo.update('gone', { title: 'x' }), null);
  });
});
