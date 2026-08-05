// FlowRelationship repository — scalar-only per-entity migration.
// Unusual in that the Stored TS type (routes/process-catalog) does
// NOT carry an orgId; the row's org scope is derived from its
// fromNode / toNode, both ProcessNode references which are
// themselves orgId-scoped. The Repository interface still exposes a
// { orgId } filter for uniformity with the other repos — we honour
// it via a post-map filter on the Prisma side (the same "no
// top-level orgId" pattern people.repo.ts uses).

import type { FlowRelationship } from '../routes/process-catalog';
import { saveStore } from '../lib/persistence';
import { Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

// Custom (not jsonRepository helper) because rows have no orgId
// column — the helper's filter would zero every row out. We ignore
// the orgId filter entirely on the JSON path and rely on the caller
// to post-filter using fromNode / toNode as needed.
export function jsonFlowRelationshipsRepository(store: FlowRelationship[]): Repository<FlowRelationship> {
  const save = () => saveStore('flowRelationships', store);
  return {
    async list(_filter) {
      // orgId filter intentionally ignored — see file header.
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

type PrismaFlowRow = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
  label: string | null;
  createdAt: Date;
  // Optional include used by list() when an orgId filter is present so
  // we can post-map to only rows whose fromNode belongs to the org.
  fromNode?: { orgId: string };
};

export interface PrismaFlowRelationshipDelegate {
  findMany(arg?: {
    include?: { fromNode?: { select?: { orgId?: boolean } } };
  }): Promise<PrismaFlowRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaFlowRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaFlowRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaFlowRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaFlowRow>;
}

function fromPrisma(r: PrismaFlowRow): FlowRelationship {
  return {
    id: r.id,
    fromNodeId: r.fromNodeId,
    toNodeId: r.toNodeId,
    type: r.type as FlowRelationship['type'],
    label: r.label,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<FlowRelationship>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.fromNodeId !== undefined) data.fromNodeId = row.fromNodeId;
  if (row.toNodeId !== undefined) data.toNodeId = row.toNodeId;
  if (row.type !== undefined) data.type = row.type;
  if (row.label !== undefined) data.label = row.label;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

export function prismaFlowRelationshipsRepository(
  clientFactory: () => { flowRelationship: PrismaFlowRelationshipDelegate } = getPrisma as unknown as () => { flowRelationship: PrismaFlowRelationshipDelegate },
): Repository<FlowRelationship> {
  return {
    async list(filter) {
      const client = clientFactory();
      // With an orgId filter, ask Prisma to join fromNode so we can
      // post-map filter by node.orgId. Same trick people.repo.ts uses.
      if (filter?.orgId) {
        const rows = await client.flowRelationship.findMany({
          include: { fromNode: { select: { orgId: true } } },
        });
        return rows
          .filter((r) => r.fromNode?.orgId === filter.orgId)
          .map(fromPrisma);
      }
      const rows = await client.flowRelationship.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.flowRelationship.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.flowRelationship.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.flowRelationship.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.flowRelationship.delete({ where: { id } });
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
 * Pick the right FlowRelationship repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getFlowRelationshipsRepository(store: FlowRelationship[]): Repository<FlowRelationship> {
  return hasDatabase()
    ? prismaFlowRelationshipsRepository()
    : jsonFlowRelationshipsRepository(store);
}
