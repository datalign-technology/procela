import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonConnectionsRepository,
  prismaConnectionsRepository,
  type PrismaConnectionDelegate,
} from '../db/connections.repo';
import type { ConnectionProfile } from '../routes/connections';

const make = (over: Partial<ConnectionProfile> = {}): ConnectionProfile => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Prod Postgres',
  connectionType: 'DATABASE',
  config: { dbType: 'POSTGRESQL', host: 'db.internal' },
  credentials: {},
  status: 'UNTESTED',
  lastTestedAt: null,
  lastTestResult: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonConnectionsRepository', () => {
  let store: ConnectionProfile[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonConnectionsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('delete returns true when row present', async () => {
    const repo = jsonConnectionsRepository(store);
    await repo.create(make({ id: 'a' }));
    assert.strictEqual(await repo.delete('a'), true);
  });
});

describe('prismaConnectionsRepository', () => {
  function delegate(over: Partial<PrismaConnectionDelegate> = {}): PrismaConnectionDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps null systemId to undefined and JSON columns through', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', systemId: null, name: 'C',
        connectionType: 'DATABASE',
        config: { host: 'h' }, credentials: {},
        status: 'CONNECTED', lastTestedAt: null, lastTestResult: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaConnectionsRepository(() => ({ connection: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].systemId, undefined);
    assert.strictEqual((rows[0].config as any).host, 'h');
    assert.strictEqual(rows[0].status, 'CONNECTED');
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaConnectionsRepository(() => ({ connection: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
