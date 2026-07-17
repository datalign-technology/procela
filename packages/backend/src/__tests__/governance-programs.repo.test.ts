import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonGovernanceProgramsRepository,
  prismaGovernanceProgramsRepository,
  type PrismaGovernanceProgramDelegate,
} from '../db/governance-programs.repo';
import type { StoredGovernanceProgram } from '../routes/governance-program';

const make = (over: Partial<StoredGovernanceProgram> = {}): StoredGovernanceProgram => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Program',
  scope: { inScope: '', outOfScope: '', boundaries: '', constraints: '' },
  principles: { vision: '', principles: [], decisionRights: '', operatingModel: '' },
  targetStartDate: null,
  targetLaunchDate: null,
  status: 'PLANNING',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonGovernanceProgramsRepository', () => {
  let store: StoredGovernanceProgram[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonGovernanceProgramsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonGovernanceProgramsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });

  it('create then get round-trips', async () => {
    const repo = jsonGovernanceProgramsRepository(store);
    await repo.create(make({ id: 'c', name: 'Named' }));
    const got = await repo.get('c');
    assert.strictEqual(got?.name, 'Named');
  });
});

describe('prismaGovernanceProgramsRepository', () => {
  function delegate(over: Partial<PrismaGovernanceProgramDelegate> = {}): PrismaGovernanceProgramDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps JSON columns through', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', name: 'Prog',
        scope: { inScope: 'A', outOfScope: 'B', boundaries: 'C', constraints: 'D' },
        principles: { vision: 'V', principles: ['x'], decisionRights: 'R', operatingModel: 'CENTRALIZED' },
        targetStartDate: null, targetLaunchDate: null, status: 'ACTIVE',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaGovernanceProgramsRepository(() => ({ governanceProgram: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].scope.inScope, 'A');
    assert.deepStrictEqual(rows[0].principles.principles, ['x']);
    assert.strictEqual(rows[0].status, 'ACTIVE');
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaGovernanceProgramsRepository(() => ({ governanceProgram: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaGovernanceProgramsRepository(() => ({ governanceProgram: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
