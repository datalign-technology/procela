// DataLineageLink repository — system-to-system data flow edges.
// Purely scalar row shape. dataAssetId is nullable (edges that aren't
// asset-specific describe the whole flow between two systems).

import type { DataLineageLink } from '../routes/data-lineage';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonDataLineageLinksRepository(
  store: DataLineageLink[],
): Repository<DataLineageLink> {
  return jsonRepository<DataLineageLink>(store, () => saveStore('dataLineageLinks', store));
}

// ── Postgres path ──

type PrismaDataLineageLinkRow = {
  id: string;
  orgId: string;
  sourceSystemId: string;
  targetSystemId: string;
  dataAssetId: string | null;
  description: string;
  flowType: string;
  frequency: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaDataLineageLinkDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaDataLineageLinkRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaDataLineageLinkRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDataLineageLinkRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDataLineageLinkRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDataLineageLinkRow>;
}

function fromPrisma(r: PrismaDataLineageLinkRow): DataLineageLink {
  return {
    id: r.id,
    orgId: r.orgId,
    sourceSystemId: r.sourceSystemId,
    targetSystemId: r.targetSystemId,
    dataAssetId: r.dataAssetId,
    description: r.description ?? '',
    flowType: r.flowType as DataLineageLink['flowType'],
    frequency: r.frequency as DataLineageLink['frequency'],
    status: r.status as DataLineageLink['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<DataLineageLink>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.sourceSystemId !== undefined) d.sourceSystemId = row.sourceSystemId;
  if (row.targetSystemId !== undefined) d.targetSystemId = row.targetSystemId;
  if (row.dataAssetId !== undefined) d.dataAssetId = row.dataAssetId;
  if (row.description !== undefined) d.description = row.description;
  if (row.flowType !== undefined) d.flowType = row.flowType;
  if (row.frequency !== undefined) d.frequency = row.frequency;
  if (row.status !== undefined) d.status = row.status;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaDataLineageLinksRepository(
  clientFactory: () => { dataLineageLink: PrismaDataLineageLinkDelegate } =
    getPrisma as unknown as () => { dataLineageLink: PrismaDataLineageLinkDelegate },
): Repository<DataLineageLink> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.dataLineageLink.findMany({ where: { orgId: filter.orgId } })
        : await client.dataLineageLink.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.dataLineageLink.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.dataLineageLink.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.dataLineageLink.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.dataLineageLink.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getDataLineageLinksRepository(
  store: DataLineageLink[],
): Repository<DataLineageLink> {
  return hasDatabase()
    ? prismaDataLineageLinksRepository()
    : jsonDataLineageLinksRepository(store);
}
