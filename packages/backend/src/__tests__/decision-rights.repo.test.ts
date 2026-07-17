import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDecisionRightsRepository,
  prismaDecisionRightsRepository,
  type PrismaDecisionRightDelegate,
} from '../db/decision-rights.repo';
import type { StoredDecisionRight } from '../routes/decision-rights';

const make = (over: Partial<StoredDecisionRight> = {}): StoredDecisionRight => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  decision: 'Approve X',
  category: 'POLICY',
  description: 'desc',
  decider: null,
  deciderType: 'ROLE',
  recommends: [],
  approves: [],
  informed: [],
  escalationPath: '',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDecisionRightsRepository', () => {
  let store: StoredDecisionRight[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonDecisionRightsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update patches fields', async () => {
    const repo = jsonDecisionRightsRepository(store);
    await repo.create(make({ id: 'a' }));
    const patched = await repo.update('a', { decision: 'renamed' });
    assert.strictEqual(patched?.decision, 'renamed');
  });

  it('delete returns false when missing', async () => {
    const repo = jsonDecisionRightsRepository(store);
    assert.strictEqual(await repo.delete('gone'), false);
  });
});

describe('prismaDecisionRightsRepository', () => {
  function delegate(over: Partial<PrismaDecisionRightDelegate> = {}): PrismaDecisionRightDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps arrays and null decider through', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', decision: 'Do X', category: 'ACCESS',
        description: 'desc', decider: null, deciderType: 'ROLE',
        recommends: ['a'], approves: ['b'], informed: [], escalationPath: '',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaDecisionRightsRepository(() => ({ decisionRight: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].decider, null);
    assert.deepStrictEqual(rows[0].recommends, ['a']);
    assert.deepStrictEqual(rows[0].approves, ['b']);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaDecisionRightsRepository(() => ({ decisionRight: d }));
    assert.strictEqual(await repo.update('gone', { decision: 'x' }), null);
  });
});
