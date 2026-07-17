// DataAssetBinding repository — physical source(s) an asset resolves to
// via a connection profile. Scalar-only shape; the connectionId FK is
// soft (see schema.prisma) so nothing to relation-load here.

import type { StoredDataAssetBinding } from '../routes/data-assets';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonDataAssetBindingsRepository(store: StoredDataAssetBinding[]): Repository<StoredDataAssetBinding> {
  return jsonRepository<StoredDataAssetBinding>(store, () => saveStore('dataAssetBindings', store));
}

// ── Postgres path ──

type PrismaDataAssetBindingRow = {
  id: string;
  orgId: string;
  dataAssetId: string;
  connectionId: string;
  sourceAsset: string;
  sourceColumn: string | null;
  label: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaDataAssetBindingDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaDataAssetBindingRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaDataAssetBindingRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDataAssetBindingRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDataAssetBindingRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDataAssetBindingRow>;
}

function fromPrisma(r: PrismaDataAssetBindingRow): StoredDataAssetBinding {
  return {
    id: r.id,
    orgId: r.orgId,
    dataAssetId: r.dataAssetId,
    connectionId: r.connectionId,
    sourceAsset: r.sourceAsset,
    ...(r.sourceColumn ? { sourceColumn: r.sourceColumn } : {}),
    ...(r.label ? { label: r.label } : {}),
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredDataAssetBinding>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.dataAssetId !== undefined) d.dataAssetId = row.dataAssetId;
  if (row.connectionId !== undefined) d.connectionId = row.connectionId;
  if (row.sourceAsset !== undefined) d.sourceAsset = row.sourceAsset;
  if (row.sourceColumn !== undefined) d.sourceColumn = row.sourceColumn || null;
  if (row.label !== undefined) d.label = row.label || null;
  if (row.isPrimary !== undefined) d.isPrimary = row.isPrimary;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaDataAssetBindingsRepository(
  clientFactory: () => { dataAssetBinding: PrismaDataAssetBindingDelegate } = getPrisma as unknown as () => { dataAssetBinding: PrismaDataAssetBindingDelegate },
): Repository<StoredDataAssetBinding> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.dataAssetBinding.findMany({ where: { orgId: filter.orgId } })
        : await client.dataAssetBinding.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.dataAssetBinding.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.dataAssetBinding.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.dataAssetBinding.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.dataAssetBinding.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getDataAssetBindingsRepository(store: StoredDataAssetBinding[]): Repository<StoredDataAssetBinding> {
  return hasDatabase()
    ? prismaDataAssetBindingsRepository()
    : jsonDataAssetBindingsRepository(store);
}
