import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonScimGroupsRepository,
  prismaScimGroupsRepository,
  type PrismaScimGroupDelegate,
} from '../db/scim-groups.repo';
import type { StoredScimGroup } from '../services/scim-groups';
import { useStoreIsolation } from './_helpers/store-isolation';

const make = (over: Partial<StoredScimGroup> = {}): StoredScimGroup => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  displayName: 'Engineers',
  members: [],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonScimGroupsRepository', () => {
  useStoreIsolation({ file: 'scim-groups' });
  let store: StoredScimGroup[];
  beforeEach(() => { store = []; });

  it('create then get round-trips', async () => {
    const repo = jsonScimGroupsRepository(store);
    await repo.create(make({ id: 'g1', displayName: 'Admins' }));
    const got = await repo.get('g1');
    assert.strictEqual(got?.displayName, 'Admins');
  });

  it('update merges a patch; delete removes', async () => {
    const repo = jsonScimGroupsRepository(store);
    await repo.create(make({ id: 'g1' }));
    await repo.update('g1', { displayName: 'Renamed' });
    assert.strictEqual((await repo.get('g1'))?.displayName, 'Renamed');
    assert.strictEqual(await repo.delete('g1'), true);
    assert.strictEqual(await repo.get('g1'), null);
  });

  it('update returns null when the group is missing', async () => {
    const repo = jsonScimGroupsRepository(store);
    assert.strictEqual(await repo.update('gone', { displayName: 'x' }), null);
  });
});

describe('prismaScimGroupsRepository', () => {
  function delegate(over: Partial<PrismaScimGroupDelegate> = {}): PrismaScimGroupDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps a row: null externalId → undefined, members default to []', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'g1', displayName: 'Eng', externalId: null, members: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaScimGroupsRepository(() => ({ scimGroup: d }));
    const [row] = await repo.list();
    assert.strictEqual(row.externalId, undefined);
    assert.deepStrictEqual(row.members, []);
  });

  it('update returns null and delete returns false on P2025', async () => {
    const p2025 = () => { const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e; };
    const repo = prismaScimGroupsRepository(() => ({
      scimGroup: delegate({ update: async () => p2025(), delete: async () => p2025() }),
    }));
    assert.strictEqual(await repo.update('gone', { displayName: 'x' }), null);
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
