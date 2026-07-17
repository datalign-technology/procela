// SavedView repository — filters column is JSON (opaque per-page
// snapshot). Round-tripped as-is.

import type { StoredView } from '../routes/saved-views';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonSavedViewsRepository(store: StoredView[]): Repository<StoredView> {
  return jsonRepository<StoredView>(store, () => saveStore('savedViews', store));
}

type PrismaSavedViewRow = {
  id: string;
  orgId: string;
  pageKey: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  isShared: boolean;
  filters: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaSavedViewDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaSavedViewRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaSavedViewRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaSavedViewRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaSavedViewRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaSavedViewRow>;
}

function fromPrisma(r: PrismaSavedViewRow): StoredView {
  return {
    id: r.id,
    orgId: r.orgId,
    pageKey: r.pageKey,
    name: r.name,
    ownerId: r.ownerId ?? null,
    ownerName: r.ownerName ?? null,
    isShared: r.isShared,
    filters: (r.filters ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredView>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.pageKey !== undefined) d.pageKey = row.pageKey;
  if (row.name !== undefined) d.name = row.name;
  if (row.ownerId !== undefined) d.ownerId = row.ownerId ?? null;
  if (row.ownerName !== undefined) d.ownerName = row.ownerName ?? null;
  if (row.isShared !== undefined) d.isShared = row.isShared;
  if (row.filters !== undefined) d.filters = row.filters;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaSavedViewsRepository(
  clientFactory: () => { savedView: PrismaSavedViewDelegate } = getPrisma as unknown as () => { savedView: PrismaSavedViewDelegate },
): Repository<StoredView> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.savedView.findMany({ where: { orgId: filter.orgId } })
        : await client.savedView.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.savedView.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.savedView.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.savedView.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.savedView.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getSavedViewsRepository(store: StoredView[]): Repository<StoredView> {
  return hasDatabase()
    ? prismaSavedViewsRepository()
    : jsonSavedViewsRepository(store);
}
