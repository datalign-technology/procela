// DamaRole repository — JSON + stubbed Prisma. The row has no
// top-level orgId (see the repo file header); the list() filter is
// intentionally a no-op. Round-trip focuses on the (personId,
// agentId, agentName) discriminator + the scopeType/scopeId pair.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDamaRolesRepository,
  prismaDamaRolesRepository,
  type PrismaDamaRoleDelegate,
} from '../db/dama-roles.repo';
import type { StoredDamaRole } from '../routes/dama-roles';

const makeRole = (over: Partial<StoredDamaRole> = {}): StoredDamaRole => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  personId: 'p-1',
  agentId: null,
  agentName: null,
  roleType: 'BUSINESS_DATA_STEWARD',
  scopeType: 'ORG',
  scopeId: 'o1',
  since: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDamaRolesRepository', () => {
  let store: StoredDamaRole[];
  beforeEach(() => { store = []; });

  it('list returns every row — orgId filter is a no-op since rows carry no orgId column', async () => {
    const repo = jsonDamaRolesRepository(store);
    store.push(makeRole({ id: 'a' }), makeRole({ id: 'b', scopeId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    // Filter ignored on the JSON path — see repo file header.
    assert.strictEqual(rows.length, 2);
  });

  it('round-trips agent-holder discriminator (personId null, agentId + agentName set)', async () => {
    const repo = jsonDamaRolesRepository(store);
    await repo.create(makeRole({
      id: 'r1', personId: null, agentId: 'a-1', agentName: 'DQ Bot',
      roleType: 'DATA_QUALITY_ANALYST', scopeType: 'DOMAIN', scopeId: 'd-1',
    }));
    const got = await repo.get('r1');
    assert.strictEqual(got?.personId, null);
    assert.strictEqual(got?.agentId, 'a-1');
    assert.strictEqual(got?.agentName, 'DQ Bot');
    assert.strictEqual(got?.scopeType, 'DOMAIN');
  });
});

describe('prismaDamaRolesRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaDamaRoleDelegate> = {}): PrismaDamaRoleDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps row → StoredDamaRole (String scopeType pass-through, dates → ISO)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'r1', personId: 'p-1', agentId: null, agentName: null,
        roleType: 'CDO', scopeType: 'ORG', scopeId: 'o1',
        since: '2026-07-15T00:00:00.000Z',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaDamaRolesRepository(() => ({ damaRole: delegate }));
    const rows = await repo.list();
    const r = rows[0];
    assert.strictEqual(r.roleType, 'CDO');
    assert.strictEqual(r.scopeType, 'ORG');
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
    const repo = prismaDamaRolesRepository(() => ({ damaRole: delegate }));
    assert.strictEqual(await repo.update('gone', { roleType: 'CDO' }), null);
  });
});
