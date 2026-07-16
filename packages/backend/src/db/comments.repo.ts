// Comment repository — scalar row plus a Postgres String[] payload
// for `mentions` (resolved personIds parsed from @-refs at write
// time). Soft-delete semantics live on the Stored type — a deleted
// row keeps its id + threading fields so replies aren't orphaned.

import type { StoredComment } from '../routes/comments';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonCommentsRepository(store: StoredComment[]): Repository<StoredComment> {
  return jsonRepository<StoredComment>(store, () => saveStore('comments', store));
}

// ── Postgres path ──

type PrismaCommentRow = {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  parentId: string | null;
  userId: string | null;
  userName: string;
  content: string;
  mentions: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export interface PrismaCommentDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaCommentRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaCommentRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaCommentRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaCommentRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaCommentRow>;
}

function fromPrisma(r: PrismaCommentRow): StoredComment {
  return {
    id: r.id,
    orgId: r.orgId,
    entityType: r.entityType,
    entityId: r.entityId,
    parentId: r.parentId,
    userId: r.userId,
    userName: r.userName,
    content: r.content,
    mentions: r.mentions,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}

function toPrismaData(row: Partial<StoredComment>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.entityType !== undefined) data.entityType = row.entityType;
  if (row.entityId !== undefined) data.entityId = row.entityId;
  if (row.parentId !== undefined) data.parentId = row.parentId;
  if (row.userId !== undefined) data.userId = row.userId;
  if (row.userName !== undefined) data.userName = row.userName;
  if (row.content !== undefined) data.content = row.content;
  if (row.mentions !== undefined) data.mentions = row.mentions;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  if (row.updatedAt !== undefined) data.updatedAt = new Date(row.updatedAt);
  if (row.deletedAt !== undefined) data.deletedAt = row.deletedAt ? new Date(row.deletedAt) : null;
  return data;
}

export function prismaCommentsRepository(
  clientFactory: () => { comment: PrismaCommentDelegate } = getPrisma as unknown as () => { comment: PrismaCommentDelegate },
): Repository<StoredComment> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.comment.findMany({ where: { orgId: filter.orgId } })
        : await client.comment.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.comment.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.comment.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.comment.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.comment.delete({ where: { id } });
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
 * Pick the right Comment repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getCommentsRepository(store: StoredComment[]): Repository<StoredComment> {
  return hasDatabase()
    ? prismaCommentsRepository()
    : jsonCommentsRepository(store);
}
