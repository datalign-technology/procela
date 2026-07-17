import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonSyncConnectionsRepository,
  prismaSyncConnectionsRepository,
  type PrismaSyncConnectionDelegate,
} from '../db/sync-connections.repo';
import type { SyncConnection } from '../routes/sync-connections';

const make = (over: Partial<SyncConnection> = {}): SyncConnection => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Nightly org sync',
  targetEntity: 'organizations',
  sourceType: 'CSV_URL',
  connectionId: null,
  config: { url: 'https://example.com/orgs.csv' },
  fieldMapping: { name: 'Name' },
  matchKey: 'name',
  schedule: { enabled: false, intervalMinutes: 60, lastRunAt: null, nextRunAt: null },
  status: 'ACTIVE',
  lastSyncResult: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonSyncConnectionsRepository', () => {
  let store: SyncConnection[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonSyncConnectionsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonSyncConnectionsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});

describe('prismaSyncConnectionsRepository', () => {
  function delegate(over: Partial<PrismaSyncConnectionDelegate> = {}): PrismaSyncConnectionDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps JSON columns and null lastSyncResult', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', name: 'S', targetEntity: 'people',
        sourceType: 'DATABASE', connectionId: null,
        config: { host: 'h' }, fieldMapping: { name: 'n' },
        matchKey: 'email',
        schedule: { enabled: true, intervalMinutes: 30, lastRunAt: null, nextRunAt: null },
        status: 'ACTIVE', lastSyncResult: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaSyncConnectionsRepository(() => ({ syncConnection: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].targetEntity, 'people');
    assert.strictEqual((rows[0].config as any).host, 'h');
    assert.strictEqual(rows[0].lastSyncResult, null);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaSyncConnectionsRepository(() => ({ syncConnection: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
