import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDbtCloudConnectionsRepository,
  prismaDbtCloudConnectionsRepository,
  type PrismaDbtCloudConnectionDelegate,
} from '../db/dbt-cloud-connections.repo';
import type { DbtCloudConnection } from '../routes/dbt-cloud-connections';

const make = (over: Partial<DbtCloudConnection> = {}): DbtCloudConnection => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'prod dbt',
  host: 'cloud.getdbt.com',
  accountId: '1',
  jobId: '2',
  token: 't',
  lastRunAt: null,
  lastStatus: 'NEVER',
  lastError: null,
  lastSummary: null,
  pollFrequency: 'NEVER',
  nextPollAt: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDbtCloudConnectionsRepository', () => {
  let store: DbtCloudConnection[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonDbtCloudConnectionsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonDbtCloudConnectionsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });

  it('round-trips lastSummary as JSONB', async () => {
    const repo = jsonDbtCloudConnectionsRepository(store);
    await repo.create(make({
      id: 'c1',
      lastSummary: {
        assetsCreated: 1, assetsMatched: 2, edgesCreated: 3, edgesTouched: 4,
        edgesRemoved: 0, dqRulesCreated: 5, dqRulesTouched: 6, dqRulesRemoved: 0,
      },
    }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows[0].lastSummary?.edgesCreated, 3);
  });
});

describe('prismaDbtCloudConnectionsRepository', () => {
  function delegate(over: Partial<PrismaDbtCloudConnectionDelegate> = {}): PrismaDbtCloudConnectionDelegate {
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
        id: 'c1', orgId: 'o1', name: 'p', host: 'h',
        accountId: '1', jobId: '2', token: 't',
        lastRunAt: null, lastStatus: 'NEVER',
        lastError: null, lastSummary: null,
        pollFrequency: 'DAILY', nextPollAt: '2026-07-16',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaDbtCloudConnectionsRepository(() => ({ dbtCloudConnection: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].lastSummary, null);
    assert.strictEqual(rows[0].nextPollAt, '2026-07-16');
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaDbtCloudConnectionsRepository(() => ({ dbtCloudConnection: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
