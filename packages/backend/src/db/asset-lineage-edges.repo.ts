// AssetLineageEdge repository — asset-level lineage edges the dbt
// importer writes. Scalar-only shape; sourceRef is a free-form
// provenance string kept as optional so hand-drawn edges (source
// === 'manual') can omit it.

import type { AssetLineageEdge } from '../routes/data-lineage';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonAssetLineageEdgesRepository(store: AssetLineageEdge[]): Repository<AssetLineageEdge> {
  return jsonRepository<AssetLineageEdge>(store, () => saveStore('assetLineageEdges', store));
}

// ── Postgres path ──

type PrismaAssetLineageEdgeRow = {
  id: string;
  orgId: string;
  sourceAssetId: string;
  targetAssetId: string;
  source: string;
  sourceRef: string | null;
  lastSeenAt: string;
  createdAt: Date;
};

export interface PrismaAssetLineageEdgeDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaAssetLineageEdgeRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaAssetLineageEdgeRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaAssetLineageEdgeRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaAssetLineageEdgeRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaAssetLineageEdgeRow>;
}

function fromPrisma(r: PrismaAssetLineageEdgeRow): AssetLineageEdge {
  return {
    id: r.id,
    orgId: r.orgId,
    sourceAssetId: r.sourceAssetId,
    targetAssetId: r.targetAssetId,
    source: r.source as AssetLineageEdge['source'],
    ...(r.sourceRef ? { sourceRef: r.sourceRef } : {}),
    lastSeenAt: r.lastSeenAt,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<AssetLineageEdge>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.sourceAssetId !== undefined) d.sourceAssetId = row.sourceAssetId;
  if (row.targetAssetId !== undefined) d.targetAssetId = row.targetAssetId;
  if (row.source !== undefined) d.source = row.source;
  if (row.sourceRef !== undefined) d.sourceRef = row.sourceRef || null;
  if (row.lastSeenAt !== undefined) d.lastSeenAt = row.lastSeenAt;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaAssetLineageEdgesRepository(
  clientFactory: () => { assetLineageEdge: PrismaAssetLineageEdgeDelegate } = getPrisma as unknown as () => { assetLineageEdge: PrismaAssetLineageEdgeDelegate },
): Repository<AssetLineageEdge> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.assetLineageEdge.findMany({ where: { orgId: filter.orgId } })
        : await client.assetLineageEdge.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.assetLineageEdge.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.assetLineageEdge.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.assetLineageEdge.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.assetLineageEdge.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getAssetLineageEdgesRepository(store: AssetLineageEdge[]): Repository<AssetLineageEdge> {
  return hasDatabase()
    ? prismaAssetLineageEdgesRepository()
    : jsonAssetLineageEdgesRepository(store);
}
