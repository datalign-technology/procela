import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonConnectorEventsRepository,
  prismaConnectorEventsRepository,
  type PrismaConnectorEventDelegate,
} from '../db/connector-events.repo';
import type { StoredConnectorEvent } from '../routes/connectors';

const make = (over: Partial<StoredConnectorEvent> = {}): StoredConnectorEvent => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  connectorId: 'c1',
  orgId: 'o1',
  type: 'HEARTBEAT',
  ts: '2026-07-15T00:00:00.000Z',
  data: {},
  ...over,
});

describe('jsonConnectorEventsRepository', () => {
  let store: StoredConnectorEvent[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonConnectorEventsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('create then get returns row', async () => {
    const repo = jsonConnectorEventsRepository(store);
    await repo.create(make({ id: 'a', type: 'SCAN_STARTED' }));
    const got = await repo.get('a');
    assert.strictEqual(got?.type, 'SCAN_STARTED');
  });
});

describe('prismaConnectorEventsRepository', () => {
  function delegate(over: Partial<PrismaConnectorEventDelegate> = {}): PrismaConnectorEventDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps JSON data through and null data to {}', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', connectorId: 'c1', orgId: 'o1',
        type: 'ASSETS_REPORTED', ts: '2026-07-15T00:00:00.000Z',
        data: { count: 5 },
      }],
    });
    const repo = prismaConnectorEventsRepository(() => ({ connectorEvent: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].type, 'ASSETS_REPORTED');
    assert.strictEqual(rows[0].data.count, 5);
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaConnectorEventsRepository(() => ({ connectorEvent: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
