// Comment repository — JSON + stubbed Prisma. Focuses on the
// mentions[] array round-trip, soft-delete state (deletedAt set,
// row preserved), and threading via parentId.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonCommentsRepository,
  prismaCommentsRepository,
  type PrismaCommentDelegate,
} from '../db/comments.repo';
import type { StoredComment } from '../routes/comments';

const makeComment = (over: Partial<StoredComment> = {}): StoredComment => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  entityType: 'DataAsset',
  entityId: 'a-1',
  parentId: null,
  userId: 'p-1',
  userName: 'Casey',
  content: 'ping',
  mentions: [],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

describe('jsonCommentsRepository', () => {
  let store: StoredComment[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonCommentsRepository(store);
    store.push(makeComment({ id: 'a', orgId: 'o1' }), makeComment({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('round-trips mentions[] + threaded reply (parentId set)', async () => {
    const repo = jsonCommentsRepository(store);
    await repo.create(makeComment({ id: 'c-parent', mentions: ['p-2', 'p-3'] }));
    await repo.create(makeComment({ id: 'c-reply', parentId: 'c-parent', content: '+1' }));
    const parent = await repo.get('c-parent');
    const reply = await repo.get('c-reply');
    assert.deepStrictEqual(parent?.mentions, ['p-2', 'p-3']);
    assert.strictEqual(reply?.parentId, 'c-parent');
  });
});

describe('prismaCommentsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaCommentDelegate> = {}): PrismaCommentDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps row → StoredComment (mentions preserved, deletedAt → ISO)', async () => {
    const delegate = makeDelegate({
      findMany: async () => [{
        id: 'c1', orgId: 'o1', entityType: 'DataAsset', entityId: 'a-1',
        parentId: null, userId: 'p-1', userName: 'Casey',
        content: 'ping @Jane', mentions: ['p-jane'],
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T12:00:00.000Z'),
        deletedAt: new Date('2026-07-16T00:00:00.000Z'),
      }],
    });
    const repo = prismaCommentsRepository(() => ({ comment: delegate }));
    const rows = await repo.list();
    const r = rows[0];
    assert.deepStrictEqual(r.mentions, ['p-jane']);
    assert.strictEqual(r.deletedAt, '2026-07-16T00:00:00.000Z');
    assert.strictEqual(r.entityId, 'a-1');
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaCommentsRepository(() => ({ comment: delegate }));
    assert.strictEqual(await repo.update('gone', { content: 'x' }), null);
  });
});
