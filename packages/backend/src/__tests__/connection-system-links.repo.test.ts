import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonConnectionSystemLinksRepository,
  prismaConnectionSystemLinksRepository,
  type PrismaConnectionSystemLinkDelegate,
} from '../db/connection-system-links.repo';
import type { ConnectionSystemLink } from '../routes/connections';

const make = (over: Partial<ConnectionSystemLink> = {}): ConnectionSystemLink => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  connectionId: 'c1',
  systemId: 's1',
  createdAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonConnectionSystemLinksRepository', () => {
  let store: ConnectionSystemLink[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonConnectionSystemLinksRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('delete returns true when found, false otherwise', async () => {
    const repo = jsonConnectionSystemLinksRepository(store);
    store.push(make({ id: 'a' }));
    assert.strictEqual(await repo.delete('a'), true);
    assert.strictEqual(await repo.delete('gone'), false);
  });
});

describe('prismaConnectionSystemLinksRepository', () => {
  function delegate(over: Partial<PrismaConnectionSystemLinkDelegate> = {}): PrismaConnectionSystemLinkDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps rows through fromPrisma', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', connectionId: 'c1', systemId: 's1',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaConnectionSystemLinksRepository(() => ({ connectionSystemLink: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].connectionId, 'c1');
    assert.strictEqual(rows[0].createdAt, '2026-07-15T00:00:00.000Z');
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaConnectionSystemLinksRepository(() => ({ connectionSystemLink: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
