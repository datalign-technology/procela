// Repository abstraction — proves both the JSON adapter and the
// organizations repository present the same async CRUD surface
// regardless of the backing store.
//
// The Postgres path (prismaOrganizationsRepository) is exercised by
// stubbing the Prisma delegate so the test doesn't need a live
// Postgres. That's enough to catch method-signature drift, mapping
// bugs (StoredOrg ↔ Prisma row), and error-code translation
// (P2025 → null). A round-trip integration test against a real DB
// lives in the ops runbook — see docs/POSTGRES.md.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { jsonRepository } from '../db/repository';
import type { StoredOrg } from '../routes/organizations';

const makeRow = (over: Partial<StoredOrg> = {}): StoredOrg => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  parentId: null,
  name: 'Test Org',
  type: 'company',
  industry: 'utilities',
  description: '',
  headCount: 0,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonRepository', () => {
  let store: StoredOrg[];
  let saved: number;
  const save = () => { saved++; };

  beforeEach(() => {
    store = [];
    saved = 0;
  });

  it('create appends the row and persists', async () => {
    const repo = jsonRepository<StoredOrg>(store, save);
    const row = makeRow({ id: 'r1' });
    const created = await repo.create(row);
    assert.strictEqual(created, row);
    assert.strictEqual(store.length, 1);
    assert.strictEqual(saved, 1);
  });

  it('list returns a fresh array, not the backing store', async () => {
    const repo = jsonRepository<StoredOrg>(store, save);
    store.push(makeRow({ id: 'a' }), makeRow({ id: 'b' }));
    const rows = await repo.list();
    assert.strictEqual(rows.length, 2);
    // Mutating the result must not affect the store.
    rows.pop();
    assert.strictEqual(store.length, 2);
  });

  it('list filters by orgId when supplied', async () => {
    const repo = jsonRepository<StoredOrg>(store, save);
    store.push(
      makeRow({ id: 'a', orgId: 'o1' } as StoredOrg & { orgId?: string }),
      makeRow({ id: 'b', orgId: 'o2' } as StoredOrg & { orgId?: string }),
      makeRow({ id: 'c', orgId: 'o1' } as StoredOrg & { orgId?: string }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['a', 'c']);
  });

  it('get returns null for a missing id', async () => {
    const repo = jsonRepository<StoredOrg>(store, save);
    assert.strictEqual(await repo.get('nope'), null);
  });

  it('update merges the patch and persists; returns null if missing', async () => {
    const repo = jsonRepository<StoredOrg>(store, save);
    store.push(makeRow({ id: 'r1', name: 'Old' }));
    saved = 0;
    const updated = await repo.update('r1', { name: 'New', description: 'x' });
    assert.ok(updated);
    assert.strictEqual(updated!.name, 'New');
    assert.strictEqual(updated!.description, 'x');
    assert.strictEqual(saved, 1);
    // Missing id → no throw, no save, null result.
    const missing = await repo.update('gone', { name: 'x' });
    assert.strictEqual(missing, null);
    assert.strictEqual(saved, 1);
  });

  it('delete removes the row and persists; returns false if missing', async () => {
    const repo = jsonRepository<StoredOrg>(store, save);
    store.push(makeRow({ id: 'r1' }));
    saved = 0;
    assert.strictEqual(await repo.delete('r1'), true);
    assert.strictEqual(store.length, 0);
    assert.strictEqual(saved, 1);
    assert.strictEqual(await repo.delete('r1'), false);
    assert.strictEqual(saved, 1);
  });
});

describe('prismaOrganizationsRepository (stubbed Prisma)', () => {
  // Instead of hitting a real Postgres, inject a stub delegate that
  // mimics only the organization slice the repository touches. This
  // is enough to catch method-signature drift, mapping bugs
  // (StoredOrg ↔ Prisma row), and error-code translation
  // (P2025 → null). A real DB round-trip is documented in
  // docs/POSTGRES.md.

  it('list translates a Prisma row into StoredOrg (dates → ISO, nulls → empty)', async () => {
    const captured: { findManyArgs?: unknown } = {};
    const delegate = {
      findMany: async (arg?: { where?: { id?: string } }) => {
        captured.findManyArgs = arg;
        return [{
          id: 'r1',
          parentId: null,
          name: 'Stub Org',
          type: 'company',
          industry: null,             // → '' in StoredOrg
          description: 'seeded',
          headCount: 0,
          statusMode: null,
          tenantSlug: null,
          brandDisplayName: null,
          brandGlyph: null,
          ssoButtonLabel: null,
          brandPrimaryColor: null,
          createdAt: new Date('2026-07-15T12:00:00.000Z'),
          updatedAt: new Date('2026-07-15T13:00:00.000Z'),
        }];
      },
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prismaOrganizationsRepository } = require('../db/organizations.repo');
    const repo = prismaOrganizationsRepository(() => ({ organization: delegate }));
    const rows = await repo.list();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'r1');
    assert.strictEqual(rows[0].industry, '');                   // null → ''
    assert.strictEqual(rows[0].createdAt, '2026-07-15T12:00:00.000Z'); // Date → ISO
    assert.strictEqual(captured.findManyArgs, undefined);       // no filter → no where
  });

  it('list with orgId filter passes { where: { id } } to findMany', async () => {
    const captured: { findManyArgs?: { where?: { id?: string } } } = {};
    const delegate = {
      findMany: async (arg?: { where?: { id?: string } }) => {
        captured.findManyArgs = arg;
        return [];
      },
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prismaOrganizationsRepository } = require('../db/organizations.repo');
    const repo = prismaOrganizationsRepository(() => ({ organization: delegate }));
    await repo.list({ orgId: 'target-id' });
    assert.deepStrictEqual(captured.findManyArgs, { where: { id: 'target-id' } });
  });

  it('update returns null when Prisma raises P2025 (record not found)', async () => {
    const delegate = {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => {
        const err: Error & { code?: string } = new Error('Record to update not found.');
        err.code = 'P2025';
        throw err;
      },
      delete: async () => { throw new Error('stub'); },
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prismaOrganizationsRepository } = require('../db/organizations.repo');
    const repo = prismaOrganizationsRepository(() => ({ organization: delegate }));
    const result = await repo.update('gone', { name: 'x' });
    assert.strictEqual(result, null);
  });

  it('delete returns false when Prisma raises P2025', async () => {
    const delegate = {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => {
        const err: Error & { code?: string } = new Error('Record to delete not found.');
        err.code = 'P2025';
        throw err;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prismaOrganizationsRepository } = require('../db/organizations.repo');
    const repo = prismaOrganizationsRepository(() => ({ organization: delegate }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
