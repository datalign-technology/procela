// Mapping repository — JSON adapter + stubbed Prisma path. Compared
// to earlier repo tests, Mapping's shape is scalar-only (no M2M
// join-table dance) but exercises the multi-optional-FK case
// (dataAssetId / policyId / attachmentId — exactly one set at a time).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonMappingsRepository,
  prismaMappingsRepository,
  type PrismaMappingDelegate,
} from '../db/mappings.repo';
import type { StoredMapping } from '../routes/mappings';

const makeMapping = (over: Partial<StoredMapping> = {}): StoredMapping => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  processStepId: 'step-1',
  dataAssetId: 'asset-1',
  linkType: 'consumes',
  notes: '',
  aiSuggested: false,
  userOverridden: false,
  createdBy: 'p-1',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonMappingsRepository', () => {
  let store: StoredMapping[];

  beforeEach(() => {
    store = [];
  });

  it('list filters by orgId', async () => {
    const repo = jsonMappingsRepository(store);
    store.push(
      makeMapping({ id: 'a', orgId: 'o1' }),
      makeMapping({ id: 'b', orgId: 'o2' }),
      makeMapping({ id: 'c', orgId: 'o1' }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['a', 'c']);
  });

  it('round-trips policyId-only and attachmentId-only variants', async () => {
    const repo = jsonMappingsRepository(store);
    await repo.create(makeMapping({ id: 'm-policy', dataAssetId: undefined, policyId: 'pol-1' }));
    await repo.create(makeMapping({ id: 'm-att', dataAssetId: undefined, attachmentId: 'att-1' }));
    const p = await repo.get('m-policy');
    const a = await repo.get('m-att');
    assert.strictEqual(p?.policyId, 'pol-1');
    assert.strictEqual(p?.dataAssetId, undefined);
    assert.strictEqual(a?.attachmentId, 'att-1');
    assert.strictEqual(a?.policyId, undefined);
  });
});

describe('prismaMappingsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaMappingDelegate> = {}): PrismaMappingDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps a Prisma row → StoredMapping (nulls → undefined for optional FKs, ISO dates)', async () => {
    const captured: { arg?: unknown } = {};
    const delegate = makeDelegate({
      findMany: async (arg) => {
        captured.arg = arg;
        return [{
          id: 'm1',
          orgId: 'o1',
          processStepId: 'step-1',
          dataAssetId: 'asset-1',
          policyId: null,
          attachmentId: null,
          linkType: 'consumes',
          notes: null,
          aiSuggested: true,
          userOverridden: false,
          criticality: 'REQUIRED',
          dataFormat: null,
          sla: null,
          qualityRequirement: null,
          fulfillsExpected: null,
          createdBy: 'p-1',
          createdAt: new Date('2026-07-15T12:00:00.000Z'),
          updatedAt: new Date('2026-07-15T13:00:00.000Z'),
        }];
      },
    });
    const repo = prismaMappingsRepository(() => ({ mapping: delegate }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.dataAssetId, 'asset-1');
    assert.strictEqual(r.policyId, undefined);       // null → undefined for optional FKs
    assert.strictEqual(r.attachmentId, undefined);
    assert.strictEqual(r.notes, '');                  // null → '' for required strings
    assert.strictEqual(r.aiSuggested, true);
    assert.strictEqual(r.criticality, 'REQUIRED');
    assert.strictEqual(r.createdAt, '2026-07-15T12:00:00.000Z');
    assert.deepStrictEqual((captured.arg as { where?: { orgId?: string } }).where, { orgId: 'o1' });
  });

  it('create passes only set fields (undefined values dropped)', async () => {
    let createArg: unknown = null;
    const delegate = makeDelegate({
      create: async (arg) => {
        createArg = arg;
        return {
          id: 'm1', orgId: 'o1', processStepId: 'step-1',
          dataAssetId: 'asset-1', policyId: null, attachmentId: null,
          linkType: 'consumes', notes: null, aiSuggested: false,
          userOverridden: false, criticality: null, dataFormat: null,
          sla: null, qualityRequirement: null, fulfillsExpected: null,
          createdBy: 'p-1', createdAt: new Date(), updatedAt: new Date(),
        };
      },
    });
    const repo = prismaMappingsRepository(() => ({ mapping: delegate }));
    await repo.create({
      id: 'm1', orgId: 'o1', processStepId: 'step-1',
      dataAssetId: 'asset-1', linkType: 'consumes', notes: '',
      aiSuggested: false, userOverridden: false, createdBy: 'p-1',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    });
    const data = (createArg as { data: Record<string, unknown> }).data;
    // policyId + attachmentId weren't supplied so they should NOT be
    // in the Prisma payload (leaving them out lets the DB default
    // NULL kick in instead of overwriting).
    assert.strictEqual('policyId' in data, false);
    assert.strictEqual('attachmentId' in data, false);
    // updatedAt is Prisma-managed; toPrismaData drops it.
    assert.strictEqual('updatedAt' in data, false);
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaMappingsRepository(() => ({ mapping: delegate }));
    const result = await repo.update('gone', { notes: 'x' });
    assert.strictEqual(result, null);
  });
});
