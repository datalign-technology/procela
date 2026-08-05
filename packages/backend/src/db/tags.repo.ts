// Tags repository — scalar row (entityType + entityId) that joins to
// whatever it hangs off. Immutable-ish: only createdAt is tracked,
// there is no updatedAt column.

import type { StoredTag } from '../routes/tags';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonTagsRepository(store: StoredTag[]): Repository<StoredTag> {
  return jsonRepository<StoredTag>(store, () => saveStore('tags', store));
}

type PrismaTagRow = {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  tag: string;
  createdBy: string | null;
  createdAt: Date;
};

export interface PrismaTagDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaTagRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaTagRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaTagRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaTagRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaTagRow>;
}

function fromPrisma(r: PrismaTagRow): StoredTag {
  return {
    id: r.id,
    orgId: r.orgId,
    entityType: r.entityType,
    entityId: r.entityId,
    tag: r.tag,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredTag>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.entityType !== undefined) d.entityType = row.entityType;
  if (row.entityId !== undefined) d.entityId = row.entityId;
  if (row.tag !== undefined) d.tag = row.tag;
  if (row.createdBy !== undefined) d.createdBy = row.createdBy;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaTagsRepository(
  clientFactory: () => { tag: PrismaTagDelegate } = getPrisma as unknown as () => { tag: PrismaTagDelegate },
): Repository<StoredTag> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.tag.findMany({ where: { orgId: filter.orgId } })
        : await client.tag.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.tag.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.tag.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        const updated = await client.tag.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.tag.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getTagsRepository(store: StoredTag[]): Repository<StoredTag> {
  return hasDatabase()
    ? prismaTagsRepository()
    : jsonTagsRepository(store);
}
