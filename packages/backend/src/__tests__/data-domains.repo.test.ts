// DataDomain repository — proves both the JSON adapter and the
// Prisma path present the same CRUD surface. Follows the shape of
// __tests__/repository.test.ts (organizations).
//
// The Prisma path is exercised with a stubbed delegate rather than a
// live Postgres so this runs on every CI build. Live-DB validation
// is documented in docs/POSTGRES.md.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDataDomainsRepository,
  prismaDataDomainsRepository,
  type PrismaDomainDelegate,
} from '../db/data-domains.repo';
import type { StoredDataDomain } from '../routes/data-domains';

const makeDomain = (over: Partial<StoredDataDomain> = {}): StoredDataDomain => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Customer Data',
  description: '',
  ownerId: null,
  stewardIds: [],
  dataAssetIds: [],
  status: 'DRAFT',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDataDomainsRepository', () => {
  let store: StoredDataDomain[];

  beforeEach(() => {
    store = [];
  });

  it('list filters by orgId and returns a fresh array', async () => {
    const repo = jsonDataDomainsRepository(store);
    store.push(
      makeDomain({ id: 'a', orgId: 'o1' }),
      makeDomain({ id: 'b', orgId: 'o2' }),
      makeDomain({ id: 'c', orgId: 'o1' }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['a', 'c']);
  });

  it('create/update/delete round-trip', async () => {
    const repo = jsonDataDomainsRepository(store);
    const created = await repo.create(makeDomain({ id: 'd1', name: 'Ops' }));
    assert.strictEqual(created.name, 'Ops');
    const updated = await repo.update('d1', { name: 'Operations' });
    assert.strictEqual(updated?.name, 'Operations');
    assert.strictEqual(await repo.delete('d1'), true);
    assert.strictEqual(await repo.get('d1'), null);
  });
});

describe('prismaDataDomainsRepository (stubbed Prisma)', () => {
  // A minimal stub — only the methods we call. Captures arg shapes
  // so we can assert the repository is passing the right where clauses
  // and include specs.
  function makeDelegate(overrides: Partial<PrismaDomainDelegate> = {}): PrismaDomainDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps Prisma rows into StoredDataDomain (dates → ISO, nulls → empty, stewards + assets flattened)', async () => {
    const captured: { arg?: unknown } = {};
    const delegate = makeDelegate({
      findMany: async (arg) => {
        captured.arg = arg;
        return [{
          id: 'd1',
          orgId: 'o1',
          name: 'Customer',
          description: null,
          ownerId: 'p-owner',
          scopeDefinition: null,
          status: 'DRAFT',
          createdAt: new Date('2026-07-15T12:00:00.000Z'),
          updatedAt: new Date('2026-07-15T13:00:00.000Z'),
          stewards: [{ personId: 'p1' }, { personId: 'p2' }],
          dataAssets: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
        }];
      },
    });
    const repo = prismaDataDomainsRepository(() => ({ dataDomain: delegate }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].description, '');
    assert.deepStrictEqual(rows[0].stewardIds, ['p1', 'p2']);
    assert.deepStrictEqual(rows[0].dataAssetIds, ['a1', 'a2', 'a3']);
    assert.strictEqual(rows[0].createdAt, '2026-07-15T12:00:00.000Z');
    // Verify the include spec + orgId filter reached Prisma.
    const arg = captured.arg as {
      where?: { orgId?: string };
      include?: { stewards?: boolean; dataAssets?: { select?: { id?: boolean } } };
    };
    assert.strictEqual(arg.where?.orgId, 'o1');
    assert.strictEqual(arg.include?.stewards, true);
    assert.strictEqual(arg.include?.dataAssets?.select?.id, true);
  });

  it('list without filter omits the where clause', async () => {
    const captured: { arg?: unknown } = {};
    const delegate = makeDelegate({
      findMany: async (arg) => { captured.arg = arg; return []; },
    });
    const repo = prismaDataDomainsRepository(() => ({ dataDomain: delegate }));
    await repo.list();
    const arg = captured.arg as { where?: unknown; include?: unknown };
    assert.strictEqual(arg.where, undefined, 'no orgId filter → no where');
    assert.ok(arg.include, 'include still passed');
  });

  it('update returns null on P2025 (record not found)', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Record to update not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaDataDomainsRepository(() => ({ dataDomain: delegate }));
    const result = await repo.update('gone', { name: 'x' });
    assert.strictEqual(result, null);
  });

  it('update rewrites stewardIds via join-table delete-all + createMany', async () => {
    let scalarUpdateArgs: unknown = null;
    let stewardDeleteArgs: unknown = null;
    let stewardCreateArgs: unknown = null;
    const delegate = makeDelegate({
      update: async (arg) => {
        scalarUpdateArgs = arg;
        // Return the updated row shape so get() below has something
        // to work with. We route through findUnique() next.
        return {
          id: 'd1', orgId: 'o1', name: 'Ops', description: null,
          ownerId: null, scopeDefinition: null, status: 'DRAFT',
          createdAt: new Date(), updatedAt: new Date(),
        };
      },
      findUnique: async () => ({
        id: 'd1', orgId: 'o1', name: 'Ops', description: null,
        ownerId: null, scopeDefinition: null, status: 'DRAFT',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        stewards: [{ personId: 'new-1' }, { personId: 'new-2' }],
        dataAssets: [],
      }),
    });
    // Extend the client so the repository can reach the join-table
    // delegate. The repo hits `client.dataDomainSteward.*` — supply
    // that under a plain object.
    const client = {
      dataDomain: delegate,
      dataDomainSteward: {
        deleteMany: async (arg: unknown) => { stewardDeleteArgs = arg; return { count: 0 }; },
        createMany: async (arg: unknown) => { stewardCreateArgs = arg; return { count: 2 }; },
      },
    };
    const repo = prismaDataDomainsRepository(() => client as unknown as { dataDomain: PrismaDomainDelegate });
    const updated = await repo.update('d1', { name: 'Ops', stewardIds: ['new-1', 'new-2'] });
    assert.ok(updated);
    assert.deepStrictEqual(updated!.stewardIds, ['new-1', 'new-2']);
    // Scalar update fired with the name change but not the stewardIds
    // (which are not a scalar column).
    assert.deepStrictEqual((scalarUpdateArgs as { data?: Record<string, unknown> }).data, { name: 'Ops' });
    // Join rewrite: delete-all then createMany the new set.
    assert.deepStrictEqual(stewardDeleteArgs, { where: { dataDomainId: 'd1' } });
    assert.deepStrictEqual(stewardCreateArgs, {
      data: [
        { dataDomainId: 'd1', personId: 'new-1' },
        { dataDomainId: 'd1', personId: 'new-2' },
      ],
    });
  });

  it('delete returns false on P2025', async () => {
    const delegate = makeDelegate({
      delete: async () => {
        const err: Error & { code?: string } = new Error('Record to delete not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaDataDomainsRepository(() => ({ dataDomain: delegate }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
