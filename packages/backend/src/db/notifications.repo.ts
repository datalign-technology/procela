// Notification repository — scalar-only per-entity migration. Follows
// the shape of db/mappings.repo.ts (no relations to include).
//
// A notification is a fire-and-forget row: created once, read/deleted
// later. There's no updatedAt column — the JSON store never carried
// one, and toggling `read` writes back the same row without touching
// a timestamp (the JSON path's mtime is the only "when was this
// touched" signal today).

import type { StoredNotification } from '../routes/notifications';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonNotificationsRepository(store: StoredNotification[]): Repository<StoredNotification> {
  return jsonRepository<StoredNotification>(store, () => saveStore('notifications', store));
}

// ── Postgres path ──

type PrismaNotificationRow = {
  id: string;
  orgId: string;
  userId: string | null;
  // Prisma-generated union type — kept as string here so the
  // repository doesn't need Prisma's generated types (which only
  // exist post `prisma generate`).
  type: string;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: Date;
};

export interface PrismaNotificationDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaNotificationRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaNotificationRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaNotificationRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaNotificationRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaNotificationRow>;
}

function fromPrisma(r: PrismaNotificationRow): StoredNotification {
  return {
    id: r.id,
    orgId: r.orgId,
    userId: r.userId,
    type: r.type as StoredNotification['type'],
    title: r.title,
    message: r.message,
    link: r.link,
    read: r.read,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredNotification>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.userId !== undefined) data.userId = row.userId;
  if (row.type !== undefined) data.type = row.type;
  if (row.title !== undefined) data.title = row.title;
  if (row.message !== undefined) data.message = row.message;
  if (row.link !== undefined) data.link = row.link;
  if (row.read !== undefined) data.read = row.read;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

export function prismaNotificationsRepository(
  clientFactory: () => { notification: PrismaNotificationDelegate } = getPrisma as unknown as () => { notification: PrismaNotificationDelegate },
): Repository<StoredNotification> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.notification.findMany({ where: { orgId: filter.orgId } })
        : await client.notification.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.notification.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.notification.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.notification.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.notification.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

// ── Factory ──

/**
 * Pick the right Notification repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getNotificationsRepository(store: StoredNotification[]): Repository<StoredNotification> {
  return hasDatabase()
    ? prismaNotificationsRepository()
    : jsonNotificationsRepository(store);
}
