// ColumnLineageEdge repository — column-level lineage edges (one upstream
// column → one downstream column). Scalar-only shape, mirroring
// asset-lineage-edges.repo. sourceRef is a free-form provenance string kept
// optional so hand-drawn edges (source === 'manual') can omit it.

import type { ColumnLineageEdge } from '../routes/data-lineage';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonColumnLineageEdgesRepository(store: ColumnLineageEdge[]): Repository<ColumnLineageEdge> {
  return jsonRepository<ColumnLineageEdge>(store, () => saveStore('columnLineageEdges', store));
}

// ── Postgres path ──

type PrismaColumnLineageEdgeRow = {
  id: string;
  orgId: string;
  sourceColumnId: string;
  targetColumnId: string;
  source: string;
  sourceRef: string | null;
  lastSeenAt: string;
  createdAt: Date;
};

export interface PrismaColumnLineageEdgeDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaColumnLineageEdgeRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaColumnLineageEdgeRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaColumnLineageEdgeRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaColumnLineageEdgeRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaColumnLineageEdgeRow>;
}

function fromPrisma(r: PrismaColumnLineageEdgeRow): ColumnLineageEdge {
  return {
    id: r.id,
    orgId: r.orgId,
    sourceColumnId: r.sourceColumnId,
    targetColumnId: r.targetColumnId,
    source: r.source as ColumnLineageEdge['source'],
    ...(r.sourceRef ? { sourceRef: r.sourceRef } : {}),
    lastSeenAt: r.lastSeenAt,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<ColumnLineageEdge>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.sourceColumnId !== undefined) d.sourceColumnId = row.sourceColumnId;
  if (row.targetColumnId !== undefined) d.targetColumnId = row.targetColumnId;
  if (row.source !== undefined) d.source = row.source;
  if (row.sourceRef !== undefined) d.sourceRef = row.sourceRef || null;
  if (row.lastSeenAt !== undefined) d.lastSeenAt = row.lastSeenAt;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaColumnLineageEdgesRepository(
  clientFactory: () => { columnLineageEdge: PrismaColumnLineageEdgeDelegate } = getPrisma as unknown as () => { columnLineageEdge: PrismaColumnLineageEdgeDelegate },
): Repository<ColumnLineageEdge> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.columnLineageEdge.findMany({ where: { orgId: filter.orgId } })
        : await client.columnLineageEdge.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.columnLineageEdge.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.columnLineageEdge.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.columnLineageEdge.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.columnLineageEdge.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getColumnLineageEdgesRepository(store: ColumnLineageEdge[]): Repository<ColumnLineageEdge> {
  return hasDatabase()
    ? prismaColumnLineageEdgesRepository()
    : jsonColumnLineageEdgesRepository(store);
}
