// DataAsset repository — proves both paths CRUD the entity. New
// coverage vs the earlier repo tests: native Postgres String[] for
// sensitivityTags, JSONB retentionDuration, and the stewardIds M2M
// rewrite (same pattern DataDomain uses; verified again here so the
// pattern isn't organizations/domains-specific).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDataAssetsRepository,
  prismaDataAssetsRepository,
  type PrismaAssetDelegate,
} from '../db/data-assets.repo';
import type { StoredDataAsset } from '../routes/data-assets';

const makeAsset = (over: Partial<StoredDataAsset> = {}): StoredDataAsset => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Meter Reads',
  description: '',
  systemId: 'sys-1',
  owner: '',
  ownerPersonId: null,
  stewardIds: [],
  governanceTier: 'BRONZE',
  healthScore: 0,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDataAssetsRepository', () => {
  let store: StoredDataAsset[];

  beforeEach(() => {
    store = [];
  });

  it('list filters by orgId', async () => {
    const repo = jsonDataAssetsRepository(store);
    store.push(
      makeAsset({ id: 'a', orgId: 'o1' }),
      makeAsset({ id: 'b', orgId: 'o2' }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'a');
  });

  it('round-trips retentionDuration + sensitivityTags on JSON', async () => {
    const repo = jsonDataAssetsRepository(store);
    await repo.create(makeAsset({
      id: 'a1',
      sensitivityTags: ['PII', 'PCI'],
      retentionDuration: { value: 7, unit: 'YEARS' },
    }));
    const round = await repo.get('a1');
    assert.deepStrictEqual(round?.sensitivityTags, ['PII', 'PCI']);
    assert.deepStrictEqual(round?.retentionDuration, { value: 7, unit: 'YEARS' });
  });
});

describe('prismaDataAssetsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaAssetDelegate> = {}): PrismaAssetDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps Prisma row → StoredDataAsset (String[] passthrough, JSONB retention, stewards flattened, dates → ISO)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'a1',
        orgId: 'o1',
        name: 'Meter Reads',
        description: null,
        systemId: 'sys-1',
        ownerPersonId: 'p-owner',
        dataDomainId: null,
        governanceTier: 'SILVER',
        healthScore: 91,
        healthScoreAt: new Date('2026-07-14T00:00:00.000Z'),
        sensitivityTags: ['PII'],
        dataClassification: 'CONFIDENTIAL',
        dataType: 'OPERATIONAL',
        refreshFrequency: 'REAL_TIME',
        origin: 'DISCOVERED',
        retentionDuration: { value: 7, unit: 'YEARS' },
        retentionReason: 'PUC record retention',
        lastSyncedByConnectorId: 'conn-1',
        lastSyncedAt: new Date('2026-07-15T12:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
        stewards: [{ personId: 'p-steward-a' }, { personId: 'p-steward-b' }],
      }],
    });
    const repo = prismaDataAssetsRepository(() => ({ dataAsset: delegate }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.description, '');                    // null → ''
    assert.deepStrictEqual(r.sensitivityTags, ['PII']);        // String[] passthrough
    assert.deepStrictEqual(r.retentionDuration, { value: 7, unit: 'YEARS' }); // JSONB
    assert.deepStrictEqual(r.stewardIds, ['p-steward-a', 'p-steward-b']); // M2M flatten
    assert.strictEqual(r.governanceTier, 'SILVER');
    assert.strictEqual(r.healthScoreAt, '2026-07-14T00:00:00.000Z');
    assert.strictEqual(r.lastSyncedAt, '2026-07-15T12:00:00.000Z');
  });

  it('update rewrites stewardIds via delete-all + createMany on the join table', async () => {
    let deleteArgs: unknown = null;
    let createArgs: unknown = null;
    const delegate = makeDelegate({
      update: async () => ({
        id: 'a1', orgId: 'o1', name: 'x', description: null, systemId: null,
        ownerPersonId: null, dataDomainId: null, governanceTier: 'BRONZE',
        healthScore: 0, healthScoreAt: null, sensitivityTags: [],
        dataClassification: null, dataType: null,
        refreshFrequency: null, origin: null, retentionDuration: null,
        retentionReason: null, lastSyncedByConnectorId: null, lastSyncedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      }),
      findUnique: async () => ({
        id: 'a1', orgId: 'o1', name: 'x', description: null, systemId: null,
        ownerPersonId: null, dataDomainId: null, governanceTier: 'BRONZE',
        healthScore: 0, healthScoreAt: null, sensitivityTags: [],
        dataClassification: null, dataType: null,
        refreshFrequency: null, origin: null, retentionDuration: null,
        retentionReason: null, lastSyncedByConnectorId: null, lastSyncedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
        stewards: [{ personId: 'p-new' }],
      }),
    });
    const client = {
      dataAsset: delegate,
      dataAssetSteward: {
        deleteMany: async (arg: unknown) => { deleteArgs = arg; return { count: 0 }; },
        createMany: async (arg: unknown) => { createArgs = arg; return { count: 1 }; },
      },
    };
    const repo = prismaDataAssetsRepository(() => client as unknown as { dataAsset: PrismaAssetDelegate });
    const updated = await repo.update('a1', { name: 'x', stewardIds: ['p-new'] });
    assert.ok(updated);
    assert.deepStrictEqual(updated!.stewardIds, ['p-new']);
    assert.deepStrictEqual(deleteArgs, { where: { dataAssetId: 'a1' } });
    assert.deepStrictEqual(createArgs, { data: [{ dataAssetId: 'a1', personId: 'p-new' }] });
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaDataAssetsRepository(() => ({ dataAsset: delegate }));
    const result = await repo.update('gone', { name: 'x' });
    assert.strictEqual(result, null);
  });
});
