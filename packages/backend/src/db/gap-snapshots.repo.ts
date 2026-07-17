// GapSnapshot repository — weekly-digest metric captures. `metrics`
// is a JSON blob (the GapMetrics counters computed at snapshot
// time); round-tripped as-is via a cast on read.

import type { GapSnapshot, GapMetrics } from '../services/digest.service';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonGapSnapshotsRepository(store: GapSnapshot[]): Repository<GapSnapshot> {
  return jsonRepository<GapSnapshot>(store, () => saveStore('gapSnapshots', store));
}

type PrismaGapSnapshotRow = {
  id: string;
  orgId: string;
  takenAt: string;
  metrics: unknown;
};

export interface PrismaGapSnapshotDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaGapSnapshotRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaGapSnapshotRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaGapSnapshotRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaGapSnapshotRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaGapSnapshotRow>;
}

function fromPrisma(r: PrismaGapSnapshotRow): GapSnapshot {
  return {
    id: r.id,
    orgId: r.orgId,
    takenAt: r.takenAt,
    metrics: (r.metrics ?? {}) as GapMetrics,
  };
}

function toPrismaData(row: Partial<GapSnapshot>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.takenAt !== undefined) d.takenAt = row.takenAt;
  if (row.metrics !== undefined) d.metrics = row.metrics;
  return d;
}

export function prismaGapSnapshotsRepository(
  clientFactory: () => { gapSnapshot: PrismaGapSnapshotDelegate } = getPrisma as unknown as () => { gapSnapshot: PrismaGapSnapshotDelegate },
): Repository<GapSnapshot> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.gapSnapshot.findMany({ where: { orgId: filter.orgId } })
        : await client.gapSnapshot.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.gapSnapshot.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.gapSnapshot.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        const updated = await client.gapSnapshot.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.gapSnapshot.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getGapSnapshotsRepository(store: GapSnapshot[]): Repository<GapSnapshot> {
  return hasDatabase()
    ? prismaGapSnapshotsRepository()
    : jsonGapSnapshotsRepository(store);
}
