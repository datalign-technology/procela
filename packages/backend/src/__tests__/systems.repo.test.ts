// System repository — JSON adapter + stubbed Prisma path. New
// coverage vs earlier repo tests: multiple named Person FK slots
// on one row (ownerPersonId, deputyOwnerId) and JSONB
// integrations alongside a free-text integrationPoints.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonSystemsRepository,
  prismaSystemsRepository,
  type PrismaSystemDelegate,
} from '../db/systems.repo';
import type { StoredSystem } from '../routes/systems';

const makeSystem = (over: Partial<StoredSystem> = {}): StoredSystem => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Salesforce',
  description: '',
  systemType: 'CRM',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonSystemsRepository', () => {
  let store: StoredSystem[];

  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonSystemsRepository(store);
    store.push(
      makeSystem({ id: 'a', orgId: 'o1' }),
      makeSystem({ id: 'b', orgId: 'o2' }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'a');
  });

  it('round-trips integrations JSONB + custodianIds on JSON', async () => {
    const repo = jsonSystemsRepository(store);
    await repo.create(makeSystem({
      id: 's1',
      integrations: [
        { id: 'int-1', targetSystemId: 's-billing', interfaceType: 'REST_API', direction: 'OUTBOUND', frequency: 'HOURLY' },
        { id: 'int-2', targetSystemId: 's-lake', interfaceType: 'FILE_DROP', direction: 'OUTBOUND' },
      ],
      custodianIds: ['p-1', 'p-2'],
    }));
    const round = await repo.get('s1');
    assert.strictEqual(round?.integrations?.length, 2);
    assert.strictEqual(round?.integrations?.[0].interfaceType, 'REST_API');
    assert.deepStrictEqual(round?.custodianIds, ['p-1', 'p-2']);
  });
});

describe('prismaSystemsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaSystemDelegate> = {}): PrismaSystemDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps Prisma row → StoredSystem (JSONB integrations, custodians flattened, three FKs, dates → ISO)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 's1',
        orgId: 'o1',
        name: 'Salesforce',
        description: null,
        systemType: 'CRM',
        businessCriticality: 'HIGH',
        vendor: 'Salesforce Inc.',
        integrationPoints: 'REST + nightly file drops',
        integrations: [
          { id: 'int-1', targetSystemId: 's-billing', interfaceType: 'REST_API', direction: 'OUTBOUND' },
        ],
        connectivity: 'INTEGRATED',
        ownerPersonId: 'p-owner',
        deputyOwnerId: 'p-deputy',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        custodians: [{ personId: 'p-cust-1' }, { personId: 'p-cust-2' }],
      }],
    });
    const repo = prismaSystemsRepository(() => ({ system: delegate }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.description, '');
    assert.strictEqual(r.businessCriticality, 'HIGH');
    assert.strictEqual(r.vendor, 'Salesforce Inc.');
    assert.strictEqual(r.integrationPoints, 'REST + nightly file drops');
    assert.strictEqual(r.integrations?.length, 1);
    assert.strictEqual(r.integrations?.[0].interfaceType, 'REST_API');
    assert.strictEqual(r.connectivity, 'INTEGRATED');
    assert.strictEqual(r.ownerPersonId, 'p-owner');
    assert.strictEqual(r.deputyOwnerId, 'p-deputy');
    assert.deepStrictEqual(r.custodianIds, ['p-cust-1', 'p-cust-2']);
    assert.strictEqual(r.createdAt, '2026-01-01T00:00:00.000Z');
  });

  it('update rewrites custodianIds via delete-all + createMany on the join', async () => {
    let deleteArgs: unknown = null;
    let createArgs: unknown = null;
    const delegate = makeDelegate({
      update: async () => ({
        id: 's1', orgId: 'o1', name: 'x', description: null, systemType: null,
        businessCriticality: null, vendor: null, integrationPoints: null,
        integrations: null, connectivity: null, ownerPersonId: null,
        deputyOwnerId: null,
        createdAt: new Date(), updatedAt: new Date(),
      }),
      findUnique: async () => ({
        id: 's1', orgId: 'o1', name: 'x', description: null, systemType: null,
        businessCriticality: null, vendor: null, integrationPoints: null,
        integrations: null, connectivity: null, ownerPersonId: null,
        deputyOwnerId: null,
        createdAt: new Date(), updatedAt: new Date(),
        custodians: [{ personId: 'p-new' }],
      }),
    });
    const client = {
      system: delegate,
      systemCustodian: {
        deleteMany: async (arg: unknown) => { deleteArgs = arg; return { count: 0 }; },
        createMany: async (arg: unknown) => { createArgs = arg; return { count: 1 }; },
      },
    };
    const repo = prismaSystemsRepository(() => client as unknown as { system: PrismaSystemDelegate });
    const updated = await repo.update('s1', { name: 'x', custodianIds: ['p-new'] });
    assert.ok(updated);
    assert.deepStrictEqual(updated!.custodianIds, ['p-new']);
    assert.deepStrictEqual(deleteArgs, { where: { systemId: 's1' } });
    assert.deepStrictEqual(createArgs, { data: [{ systemId: 's1', personId: 'p-new' }] });
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaSystemsRepository(() => ({ system: delegate }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
