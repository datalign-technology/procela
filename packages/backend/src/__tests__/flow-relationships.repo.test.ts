// FlowRelationship repository — JSON + stubbed Prisma. The row has
// no top-level orgId (see the header comment in the repo file), so
// filter-by-org is a post-map join on the Prisma path.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonFlowRelationshipsRepository,
  prismaFlowRelationshipsRepository,
  type PrismaFlowRelationshipDelegate,
} from '../db/flow-relationships.repo';
import type { FlowRelationship } from '../routes/process-catalog';

const makeFlow = (over: Partial<FlowRelationship> = {}): FlowRelationship => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  fromNodeId: 'n-1',
  toNodeId: 'n-2',
  type: 'SEQUENCE',
  label: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonFlowRelationshipsRepository', () => {
  let store: FlowRelationship[];
  beforeEach(() => { store = []; });

  it('list returns every row — orgId filter is a no-op since rows carry no orgId', async () => {
    const repo = jsonFlowRelationshipsRepository(store);
    store.push(makeFlow({ id: 'a' }), makeFlow({ id: 'b' }));
    const rows = await repo.list({ orgId: 'o1' });
    // The orgId filter is intentionally not applied on the JSON path.
    assert.strictEqual(rows.length, 2);
  });

  it('round-trips CONDITIONAL flow with label', async () => {
    const repo = jsonFlowRelationshipsRepository(store);
    await repo.create(makeFlow({
      id: 'f1', type: 'CONDITIONAL', label: 'high-usage',
    }));
    const got = await repo.get('f1');
    assert.strictEqual(got?.type, 'CONDITIONAL');
    assert.strictEqual(got?.label, 'high-usage');
  });
});

describe('prismaFlowRelationshipsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaFlowRelationshipDelegate> = {}): PrismaFlowRelationshipDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list with orgId filter post-maps via fromNode.orgId include', async () => {
    const captured: { arg?: unknown } = {};
    const delegate = makeDelegate({
      findMany: async (arg) => {
        captured.arg = arg;
        return [
          { id: 'f1', fromNodeId: 'n-1', toNodeId: 'n-2', type: 'SEQUENCE',
            label: null, createdAt: new Date('2026-07-15T00:00:00.000Z'),
            fromNode: { orgId: 'o1' } },
          { id: 'f2', fromNodeId: 'n-3', toNodeId: 'n-4', type: 'SEQUENCE',
            label: null, createdAt: new Date('2026-07-15T00:00:00.000Z'),
            fromNode: { orgId: 'o2' } },
        ];
      },
    });
    const repo = prismaFlowRelationshipsRepository(() => ({ flowRelationship: delegate }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['f1']);
    const arg = captured.arg as { include?: { fromNode?: { select?: { orgId?: boolean } } } };
    assert.strictEqual(arg.include?.fromNode?.select?.orgId, true);
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaFlowRelationshipsRepository(() => ({ flowRelationship: delegate }));
    assert.strictEqual(await repo.update('gone', { label: 'x' }), null);
  });
});
