// Notification repository — JSON adapter + stubbed Prisma path.
// Notifications are scalar-only rows with a fire-and-forget lifecycle
// (create, mark-read, delete). No M2M or JSONB payload to exercise.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonNotificationsRepository,
  prismaNotificationsRepository,
  type PrismaNotificationDelegate,
} from '../db/notifications.repo';
import type { StoredNotification } from '../routes/notifications';

const makeNotification = (over: Partial<StoredNotification> = {}): StoredNotification => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  userId: null,
  type: 'INFO',
  title: 'Hello',
  message: 'World',
  link: '/',
  read: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonNotificationsRepository', () => {
  let store: StoredNotification[];

  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonNotificationsRepository(store);
    store.push(
      makeNotification({ id: 'a', orgId: 'o1' }),
      makeNotification({ id: 'b', orgId: 'o2' }),
    );
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, 'a');
  });

  it('round-trips read/unread toggle via update', async () => {
    const repo = jsonNotificationsRepository(store);
    await repo.create(makeNotification({ id: 'n1', read: false }));
    const updated = await repo.update('n1', { read: true });
    assert.strictEqual(updated?.read, true);
    const got = await repo.get('n1');
    assert.strictEqual(got?.read, true);
  });
});

describe('prismaNotificationsRepository (stubbed Prisma)', () => {
  function makeDelegate(overrides: Partial<PrismaNotificationDelegate> = {}): PrismaNotificationDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...overrides,
    };
  }

  it('list maps Prisma row → StoredNotification (dates → ISO, type pass-through)', async () => {
    const captured: { arg?: unknown } = {};
    const delegate = makeDelegate({
      findMany: async (arg) => {
        captured.arg = arg;
        return [{
          id: 'n1', orgId: 'o1', userId: 'u1',
          type: 'WARNING', title: 'Overdue', message: 'A task is overdue',
          link: '/governance-work?tab=tasks', read: false,
          createdAt: new Date('2026-07-15T12:00:00.000Z'),
        }];
      },
    });
    const repo = prismaNotificationsRepository(() => ({ notification: delegate }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].type, 'WARNING');
    assert.strictEqual(rows[0].userId, 'u1');
    assert.strictEqual(rows[0].createdAt, '2026-07-15T12:00:00.000Z');
    assert.deepStrictEqual((captured.arg as { where?: { orgId?: string } }).where, { orgId: 'o1' });
  });

  it('update returns null on P2025', async () => {
    const delegate = makeDelegate({
      update: async () => {
        const err: Error & { code?: string } = new Error('Not found.');
        err.code = 'P2025';
        throw err;
      },
    });
    const repo = prismaNotificationsRepository(() => ({ notification: delegate }));
    assert.strictEqual(await repo.update('gone', { read: true }), null);
  });
});
