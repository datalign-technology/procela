// MaturitySnapshot repository — immutable scorecard snapshots.
// No row-level createdAt/updatedAt — the `timestamp` string is the
// only time signal. `dimensions` is a JSON array of {name, score}.

import type { ScorecardSnapshot } from '../routes/maturity-trends';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonMaturitySnapshotsRepository(
  store: ScorecardSnapshot[],
): Repository<ScorecardSnapshot> {
  return jsonRepository<ScorecardSnapshot>(store, () => saveStore('maturitySnapshots', store));
}

// ── Postgres path ──

type PrismaMaturitySnapshotRow = {
  id: string;
  orgId: string;
  timestamp: string;
  overall: number;
  dimensions: unknown;
};

export interface PrismaMaturitySnapshotDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaMaturitySnapshotRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaMaturitySnapshotRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaMaturitySnapshotRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaMaturitySnapshotRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaMaturitySnapshotRow>;
}

function fromPrisma(r: PrismaMaturitySnapshotRow): ScorecardSnapshot {
  return {
    id: r.id,
    orgId: r.orgId,
    timestamp: r.timestamp,
    overall: r.overall,
    dimensions: (r.dimensions ?? []) as ScorecardSnapshot['dimensions'],
  };
}

function toPrismaData(row: Partial<ScorecardSnapshot>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.timestamp !== undefined) d.timestamp = row.timestamp;
  if (row.overall !== undefined) d.overall = row.overall;
  if (row.dimensions !== undefined) d.dimensions = row.dimensions;
  return d;
}

export function prismaMaturitySnapshotsRepository(
  clientFactory: () => { maturitySnapshot: PrismaMaturitySnapshotDelegate } =
    getPrisma as unknown as () => { maturitySnapshot: PrismaMaturitySnapshotDelegate },
): Repository<ScorecardSnapshot> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.maturitySnapshot.findMany({ where: { orgId: filter.orgId } })
        : await client.maturitySnapshot.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.maturitySnapshot.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.maturitySnapshot.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.maturitySnapshot.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.maturitySnapshot.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getMaturitySnapshotsRepository(
  store: ScorecardSnapshot[],
): Repository<ScorecardSnapshot> {
  return hasDatabase()
    ? prismaMaturitySnapshotsRepository()
    : jsonMaturitySnapshotsRepository(store);
}
