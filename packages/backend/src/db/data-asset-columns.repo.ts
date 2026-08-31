// DataAssetColumn repository — columns describe a Data Asset's schema
// but aren't scoped by org directly; the org is inferred from the
// parent DataAsset. list() ignores the orgId filter and returns
// everything, matching how the JSON store is consumed by
// routes/data-assets.

import type { StoredDataAssetColumn } from '../routes/data-assets';
import { saveStore } from '../lib/persistence';
import { Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonDataAssetColumnsRepository(store: StoredDataAssetColumn[]): Repository<StoredDataAssetColumn> {
  const save = () => saveStore('dataAssetColumns', store);
  return {
    async list() {
      return [...store];
    },
    async get(id) {
      return store.find((r) => r.id === id) ?? null;
    },
    async create(row) {
      store.push(row);
      save();
      return row;
    },
    async update(id, patch) {
      const row = store.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      save();
      return row;
    },
    async delete(id) {
      const idx = store.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      store.splice(idx, 1);
      save();
      return true;
    },
  };
}

// ── Postgres path ──

type PrismaDataAssetColumnRow = {
  id: string;
  dataAssetId: string;
  columnName: string;
  dataType: string | null;
  description: string | null;
  sourceConnectionId: string | null;
  sourceAsset: string | null;
  sourceColumn: string | null;
  isPrimaryKey?: boolean | null;
  keyReferences?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaDataAssetColumnDelegate {
  findMany(arg?: { where?: Record<string, unknown> }): Promise<PrismaDataAssetColumnRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaDataAssetColumnRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDataAssetColumnRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDataAssetColumnRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDataAssetColumnRow>;
}

function fromPrisma(r: PrismaDataAssetColumnRow): StoredDataAssetColumn {
  return {
    id: r.id,
    dataAssetId: r.dataAssetId,
    columnName: r.columnName,
    ...(r.dataType ? { dataType: r.dataType } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...(r.sourceConnectionId ? { sourceConnectionId: r.sourceConnectionId } : {}),
    ...(r.sourceAsset ? { sourceAsset: r.sourceAsset } : {}),
    ...(r.sourceColumn ? { sourceColumn: r.sourceColumn } : {}),
    ...(r.isPrimaryKey ? { isPrimaryKey: true } : {}),
    ...(r.keyReferences ? { references: r.keyReferences } : {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredDataAssetColumn>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.dataAssetId !== undefined) d.dataAssetId = row.dataAssetId;
  if (row.columnName !== undefined) d.columnName = row.columnName;
  if (row.dataType !== undefined) d.dataType = row.dataType || null;
  if (row.description !== undefined) d.description = row.description || null;
  if (row.sourceConnectionId !== undefined) d.sourceConnectionId = row.sourceConnectionId || null;
  if (row.sourceAsset !== undefined) d.sourceAsset = row.sourceAsset || null;
  if (row.sourceColumn !== undefined) d.sourceColumn = row.sourceColumn || null;
  if (row.isPrimaryKey !== undefined) d.isPrimaryKey = !!row.isPrimaryKey;
  if (row.references !== undefined) d.keyReferences = row.references || null;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaDataAssetColumnsRepository(
  clientFactory: () => { dataAssetColumn: PrismaDataAssetColumnDelegate } = getPrisma as unknown as () => { dataAssetColumn: PrismaDataAssetColumnDelegate },
): Repository<StoredDataAssetColumn> {
  return {
    async list() {
      // Columns are not org-scoped at the row level; ignore the filter
      // and return everything, matching the JSON path.
      const client = clientFactory();
      const rows = await client.dataAssetColumn.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.dataAssetColumn.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.dataAssetColumn.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.dataAssetColumn.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.dataAssetColumn.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getDataAssetColumnsRepository(store: StoredDataAssetColumn[]): Repository<StoredDataAssetColumn> {
  return hasDatabase()
    ? prismaDataAssetColumnsRepository()
    : jsonDataAssetColumnsRepository(store);
}
