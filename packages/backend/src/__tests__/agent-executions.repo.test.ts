import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonAgentExecutionsRepository,
  prismaAgentExecutionsRepository,
  type PrismaAgentExecutionDelegate,
} from '../db/agent-executions.repo';
import type { StoredAgentExecution } from '../routes/agent-executions';

const make = (over: Partial<StoredAgentExecution> = {}): StoredAgentExecution => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  agentId: 'ag1',
  agentName: 'A',
  activityId: 'act1',
  activityName: 'Quarterly review',
  roleType: 'DATA_STEWARD',
  status: 'PENDING',
  startedAt: '2026-07-15T00:00:00.000Z',
  completedAt: null,
  output: '',
  error: null,
  durationMs: null,
  reviewStatus: 'PENDING',
  reviewedBy: null,
  reviewedAt: null,
  promotedDocumentId: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonAgentExecutionsRepository', () => {
  let store: StoredAgentExecution[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonAgentExecutionsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonAgentExecutionsRepository(store);
    assert.strictEqual(await repo.update('gone', { status: 'RUNNING' }), null);
  });

  it('captures promotedDocumentId when set', async () => {
    const repo = jsonAgentExecutionsRepository(store);
    await repo.create(make({ id: 'e1', promotedDocumentId: 'doc-1' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows[0].promotedDocumentId, 'doc-1');
  });
});

describe('prismaAgentExecutionsRepository', () => {
  function delegate(over: Partial<PrismaAgentExecutionDelegate> = {}): PrismaAgentExecutionDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps nulls through', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'e1', orgId: 'o1', agentId: 'ag1', agentName: 'A',
        activityId: 'act1', activityName: 'x', roleType: 'DATA_STEWARD',
        status: 'SUCCESS',
        startedAt: '2026-07-15T00:00:00.000Z',
        completedAt: '2026-07-15T00:05:00.000Z',
        output: '## draft', error: null, durationMs: 300000,
        reviewStatus: 'APPROVED', reviewedBy: 'p1',
        reviewedAt: '2026-07-15T00:10:00.000Z',
        promotedDocumentId: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaAgentExecutionsRepository(() => ({ agentExecution: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].status, 'SUCCESS');
    assert.strictEqual(rows[0].promotedDocumentId, null);
    assert.strictEqual(rows[0].durationMs, 300000);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaAgentExecutionsRepository(() => ({ agentExecution: d }));
    assert.strictEqual(await repo.update('gone', { status: 'RUNNING' }), null);
  });
});
