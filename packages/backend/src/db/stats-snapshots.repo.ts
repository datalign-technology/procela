// StatsSnapshot repository — weekly dashboard-stats captures that feed
// the Dashboard sparkline widgets (coverage %, average health, gap
// count over time). Plain scalar row, no JSON blobs. Mirrors the
// GapSnapshot repo shape (db/gap-snapshots.repo.ts) so it reads
// Postgres in DB mode and the in-memory JSON array otherwise.

import type { StatsSnapshot } from '../routes/dashboard';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonStatsSnapshotsRepository(store: StatsSnapshot[]): Repository<StatsSnapshot> {
  return jsonRepository<StatsSnapshot>(store, () => saveStore('statsSnapshots', store));
}

// ── Postgres path ──
// The `statsSnapshot` Prisma model is added alongside the DB migration
// that turns on Postgres mode for this store; in JSON/test mode this
// path is never reached (hasDatabase() is false).

type PrismaStatsSnapshotRow = {
  id: string;
  orgId: string;
  capturedAt: string;
  coverage: number;
  avgHealth: number;
  gaps: number;
  dataAssets: number;
  mappings: number;
};

export interface PrismaStatsSnapshotDelegate {
  findMany(arg?: { where?: { orgId?: string }; orderBy?: { capturedAt: 'asc' | 'desc' } }): Promise<PrismaStatsSnapshotRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaStatsSnapshotRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaStatsSnapshotRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaStatsSnapshotRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaStatsSnapshotRow>;
}

function fromPrisma(r: PrismaStatsSnapshotRow): StatsSnapshot {
  return {
    id: r.id,
    orgId: r.orgId,
    capturedAt: r.capturedAt,
    coverage: r.coverage,
    avgHealth: r.avgHealth,
    gaps: r.gaps,
    dataAssets: r.dataAssets,
    mappings: r.mappings,
  };
}

function toPrismaData(row: Partial<StatsSnapshot>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.capturedAt !== undefined) d.capturedAt = row.capturedAt;
  if (row.coverage !== undefined) d.coverage = row.coverage;
  if (row.avgHealth !== undefined) d.avgHealth = row.avgHealth;
  if (row.gaps !== undefined) d.gaps = row.gaps;
  if (row.dataAssets !== undefined) d.dataAssets = row.dataAssets;
  if (row.mappings !== undefined) d.mappings = row.mappings;
  return d;
}

export function prismaStatsSnapshotsRepository(
  clientFactory: () => { statsSnapshot: PrismaStatsSnapshotDelegate } = getPrisma as unknown as () => { statsSnapshot: PrismaStatsSnapshotDelegate },
): Repository<StatsSnapshot> {
  return {
    async list(filter) {
      const client = clientFactory();
      // Order by capturedAt so the list is oldest→newest (the JSON path
      // is array/push order); the trends endpoint sorts again defensively.
      const orderBy = { capturedAt: 'asc' as const };
      const rows = filter?.orgId
        ? await client.statsSnapshot.findMany({ where: { orgId: filter.orgId }, orderBy })
        : await client.statsSnapshot.findMany({ orderBy });
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.statsSnapshot.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.statsSnapshot.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.statsSnapshot.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.statsSnapshot.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getStatsSnapshotsRepository(store: StatsSnapshot[]): Repository<StatsSnapshot> {
  return hasDatabase()
    ? prismaStatsSnapshotsRepository()
    : jsonStatsSnapshotsRepository(store);
}
