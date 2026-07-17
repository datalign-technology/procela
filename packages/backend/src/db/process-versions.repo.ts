// ProcessVersion repository — immutable version history for
// ProcessNode rows. `snapshot` is a JSON blob (the ProcessNode at
// the time of the change); round-tripped as-is via a cast on read.
//
// There's no orgId column — a ProcessVersion is scoped through its
// nodeId, and the routes filter by nodeId rather than orgId. The
// Repository interface still accepts an `orgId` filter for
// signature parity with the rest of the batch; it's ignored here.

import type { ProcessVersion, ProcessNode } from '../routes/process-catalog';
import { saveStore } from '../lib/persistence';
import { Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonProcessVersionsRepository(store: ProcessVersion[]): Repository<ProcessVersion> {
  const save = () => saveStore('processVersions', store);
  return {
    async list() {
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

type PrismaProcessVersionRow = {
  id: string;
  nodeId: string;
  version: number;
  snapshot: unknown;
  changedBy: string | null;
  changedAt: string;
  status: string;
  note: string;
};

export interface PrismaProcessVersionDelegate {
  findMany(arg?: { where?: Record<string, unknown> }): Promise<PrismaProcessVersionRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaProcessVersionRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaProcessVersionRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaProcessVersionRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaProcessVersionRow>;
}

function fromPrisma(r: PrismaProcessVersionRow): ProcessVersion {
  return {
    id: r.id,
    nodeId: r.nodeId,
    version: r.version,
    snapshot: (r.snapshot ?? {}) as ProcessNode,
    changedBy: r.changedBy,
    changedAt: r.changedAt,
    status: r.status ?? '',
    note: r.note ?? '',
  };
}

function toPrismaData(row: Partial<ProcessVersion>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.nodeId !== undefined) d.nodeId = row.nodeId;
  if (row.version !== undefined) d.version = row.version;
  if (row.snapshot !== undefined) d.snapshot = row.snapshot;
  if (row.changedBy !== undefined) d.changedBy = row.changedBy;
  if (row.changedAt !== undefined) d.changedAt = row.changedAt;
  if (row.status !== undefined) d.status = row.status;
  if (row.note !== undefined) d.note = row.note;
  return d;
}

export function prismaProcessVersionsRepository(
  clientFactory: () => { processVersion: PrismaProcessVersionDelegate } = getPrisma as unknown as () => { processVersion: PrismaProcessVersionDelegate },
): Repository<ProcessVersion> {
  return {
    async list() {
      // orgId filter intentionally ignored — the ProcessVersion row
      // has no orgId column; scope is derived via its nodeId.
      const client = clientFactory();
      const rows = await client.processVersion.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.processVersion.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.processVersion.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        const updated = await client.processVersion.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.processVersion.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getProcessVersionsRepository(store: ProcessVersion[]): Repository<ProcessVersion> {
  return hasDatabase()
    ? prismaProcessVersionsRepository()
    : jsonProcessVersionsRepository(store);
}
