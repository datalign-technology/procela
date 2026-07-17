import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonAgentsRepository,
  prismaAgentsRepository,
  type PrismaAgentDelegate,
} from '../db/agents.repo';
import type { StoredAgent } from '../routes/agents';

const make = (over: Partial<StoredAgent> = {}): StoredAgent => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgIds: ['o1'],
  name: 'Compliance Agent',
  agentType: 'AI',
  description: '',
  provider: 'Anthropic',
  status: 'ACTIVE',
  ownerPersonId: 'p1',
  skillIds: [],
  instructions: '',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonAgentsRepository', () => {
  let store: StoredAgent[];
  beforeEach(() => { store = []; });

  it('list filters by orgId via orgIds membership', async () => {
    const repo = jsonAgentsRepository(store);
    store.push(make({ id: 'a', orgIds: ['o1', 'o2'] }), make({ id: 'b', orgIds: ['o3'] }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('list with no filter returns all', async () => {
    const repo = jsonAgentsRepository(store);
    store.push(make({ id: 'a' }), make({ id: 'b' }));
    const rows = await repo.list();
    assert.strictEqual(rows.length, 2);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonAgentsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});

describe('prismaAgentsRepository', () => {
  function delegate(over: Partial<PrismaAgentDelegate> = {}): PrismaAgentDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list uses orgIds has filter when orgId given', async () => {
    let seenWhere: unknown = null;
    const d = delegate({
      findMany: async (arg) => {
        seenWhere = arg?.where;
        return [{
          id: 'a1', orgIds: ['o1'], name: 'A', agentType: 'AI',
          description: '', provider: '', status: 'ACTIVE',
          ownerPersonId: null, skillIds: [], instructions: '',
          createdAt: new Date('2026-07-15T00:00:00.000Z'),
          updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        }];
      },
    });
    const repo = prismaAgentsRepository(() => ({ agent: d }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(seenWhere, { orgIds: { has: 'o1' } });
    assert.strictEqual(rows[0].ownerPersonId, '');
    assert.deepStrictEqual(rows[0].skillIds, []);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaAgentsRepository(() => ({ agent: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
