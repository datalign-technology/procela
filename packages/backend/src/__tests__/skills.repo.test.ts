// Skill repository — JSON adapter + stubbed Prisma path. Scalar-only
// row; the Prisma delegate exercises the P2025 path on update.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonSkillsRepository,
  prismaSkillsRepository,
  type PrismaSkillDelegate,
} from '../db/skills.repo';
import type { StoredSkill } from '../stores/skills';

const makeSkill = (over: Partial<StoredSkill> = {}): StoredSkill => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Data profiling',
  category: 'DATA_QUALITY',
  description: '',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonSkillsRepository', () => {
  let store: StoredSkill[];

  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonSkillsRepository(store);
    store.push(
      makeSkill({ id: 'a', orgId: 'o1' }),
      makeSkill({ id: 'b', orgId: 'o2' }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'a');
  });

  it('round-trips category enum-like string', async () => {
    const repo = jsonSkillsRepository(store);
    await repo.create(makeSkill({ id: 's1', category: 'GOVERNANCE' }));
    const got = await repo.get('s1');
    assert.strictEqual(got?.category, 'GOVERNANCE');
  });
});

describe('prismaSkillsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaSkillDelegate> = {}): PrismaSkillDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps Prisma row → StoredSkill (nulls → "" for description, dates → ISO)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 's1', orgId: 'o1', name: 'ETL', description: null,
        category: 'INTEGRATION',
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
        updatedAt: new Date('2026-07-15T13:00:00.000Z'),
      }],
    });
    const repo = prismaSkillsRepository(() => ({ skill: delegate }));
    const rows = await repo.list();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].description, '');
    assert.strictEqual(rows[0].category, 'INTEGRATION');
    assert.strictEqual(rows[0].createdAt, '2026-07-15T12:00:00.000Z');
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaSkillsRepository(() => ({ skill: delegate }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
