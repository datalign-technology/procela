// GovernanceGroup repository — JSON + stubbed Prisma. The
// interesting bit here is the JSONB `members` array round-trip
// (person + agent discriminator preserved) and the parent-tree
// nullable field.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGovernanceGroupsRepository,
  prismaGovernanceGroupsRepository,
  type PrismaGovernanceGroupDelegate,
} from '../db/governance-groups.repo';
import type { StoredGovernanceGroup } from '../routes/governance-groups';

const makeGroup = (over: Partial<StoredGovernanceGroup> = {}): StoredGovernanceGroup => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  parentId: null,
  name: 'Data Governance Council',
  type: 'COUNCIL',
  description: '',
  charter: '',
  status: 'ACTIVE',
  members: [],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonGovernanceGroupsRepository', () => {
  let store: StoredGovernanceGroup[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGovernanceGroupsRepository(store);
    store.push(makeGroup({ id: 'a', orgId: 'o1' }), makeGroup({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('round-trips members array with person + agent discriminator', async () => {
    const repo = jsonGovernanceGroupsRepository(store);
    await repo.create(makeGroup({
      id: 'g1',
      members: [
        { personId: 'p-1', agentId: null, groupRole: 'CHAIR', since: '2026-07-15T00:00:00.000Z' },
        { personId: null, agentId: 'a-1', groupRole: 'ADVISOR', since: '2026-07-15T00:00:00.000Z' },
      ],
    }));
    const got = await repo.get('g1');
    assert.strictEqual(got?.members.length, 2);
    assert.strictEqual(got?.members[0].personId, 'p-1');
    assert.strictEqual(got?.members[0].groupRole, 'CHAIR');
    assert.strictEqual(got?.members[1].agentId, 'a-1');
    assert.strictEqual(got?.members[1].groupRole, 'ADVISOR');
  });
});

describe('prismaGovernanceGroupsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaGovernanceGroupDelegate> = {}): PrismaGovernanceGroupDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps row → StoredGovernanceGroup (JSONB members preserved, null → [])', async () => {
    const members = [
      { personId: 'p-1', agentId: null, groupRole: 'CHAIR', since: '2026-07-15T00:00:00.000Z' },
    ];
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'g1', orgId: 'o1', parentId: 'g-parent', name: 'Committee',
        type: 'COMMITTEE', description: 'desc', charter: 'charter body',
        status: 'ACTIVE', members,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T12:00:00.000Z'),
      }],
    });
    const repo = prismaGovernanceGroupsRepository(() => ({ governanceGroup: delegate }));
    const rows = await repo.list();
    const r = rows[0];
    assert.strictEqual(r.parentId, 'g-parent');
    assert.strictEqual(r.type, 'COMMITTEE');
    assert.strictEqual(r.members.length, 1);
    assert.strictEqual(r.members[0].personId, 'p-1');
    assert.strictEqual(r.createdAt, '2026-07-15T00:00:00.000Z');
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaGovernanceGroupsRepository(() => ({ governanceGroup: delegate }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
