import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonConnectorsRepository,
  prismaConnectorsRepository,
  type PrismaConnectorDelegate,
} from '../db/connectors.repo';
import type { StoredConnector } from '../routes/connectors';

const make = (over: Partial<StoredConnector> = {}): StoredConnector => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Edge agent',
  tokenHash: null,
  pairingCode: '00000000',
  pairingCodeExpiresAt: null,
  systemIds: [],
  lastHeartbeatAt: null,
  agentVersion: null,
  status: 'PAIRED',
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonConnectorsRepository', () => {
  let store: StoredConnector[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonConnectorsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update patches status', async () => {
    const repo = jsonConnectorsRepository(store);
    await repo.create(make({ id: 'a', status: 'PAIRED' }));
    const patched = await repo.update('a', { status: 'ONLINE' });
    assert.strictEqual(patched?.status, 'ONLINE');
  });
});

describe('prismaConnectorsRepository', () => {
  function delegate(over: Partial<PrismaConnectorDelegate> = {}): PrismaConnectorDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps null systemIds to empty array', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', name: 'C', tokenHash: null,
        pairingCode: null, pairingCodeExpiresAt: null,
        systemIds: null as unknown as string[],
        lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaConnectorsRepository(() => ({ connector: d }));
    const rows = await repo.list();
    assert.deepStrictEqual(rows[0].systemIds, []);
    assert.strictEqual(rows[0].status, 'PAIRED');
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaConnectorsRepository(() => ({ connector: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
