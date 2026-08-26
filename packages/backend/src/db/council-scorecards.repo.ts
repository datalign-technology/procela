// CouncilScorecard repository — dual JSON/Postgres path. Stores three JSON
// blobs (derived / overrides / narrative) plus scalar metadata. Mirrors the
// MaturitySnapshot repo shape.

import type { StoredCouncilScorecard } from '../routes/council-scorecard';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonCouncilScorecardsRepository(store: StoredCouncilScorecard[]): Repository<StoredCouncilScorecard> {
  return jsonRepository<StoredCouncilScorecard>(store, () => saveStore('councilScorecards', store));
}

type PrismaRow = {
  id: string;
  orgId: string;
  period: string;
  status: string;
  createdBy: string | null;
  derived: unknown;
  overrides: unknown;
  narrative: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaCouncilScorecardDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaRow>;
}

function fromPrisma(r: PrismaRow): StoredCouncilScorecard {
  return {
    id: r.id,
    orgId: r.orgId,
    period: r.period,
    status: r.status,
    ...(r.createdBy ? { createdBy: r.createdBy } : {}),
    derived: (r.derived as StoredCouncilScorecard['derived']) || ({} as StoredCouncilScorecard['derived']),
    overrides: (r.overrides as Record<string, unknown>) || {},
    narrative: (r.narrative as StoredCouncilScorecard['narrative']) || {},
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredCouncilScorecard>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.period !== undefined) d.period = row.period;
  if (row.status !== undefined) d.status = row.status;
  if (row.createdBy !== undefined) d.createdBy = row.createdBy || null;
  if (row.derived !== undefined) d.derived = row.derived as unknown;
  if (row.overrides !== undefined) d.overrides = row.overrides as unknown;
  if (row.narrative !== undefined) d.narrative = row.narrative as unknown;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaCouncilScorecardsRepository(
  clientFactory: () => { councilScorecard: PrismaCouncilScorecardDelegate } = getPrisma as unknown as () => { councilScorecard: PrismaCouncilScorecardDelegate },
): Repository<StoredCouncilScorecard> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.councilScorecard.findMany({ where: { orgId: filter.orgId } })
        : await client.councilScorecard.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.councilScorecard.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.councilScorecard.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.councilScorecard.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.councilScorecard.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getCouncilScorecardsRepository(store: StoredCouncilScorecard[]): Repository<StoredCouncilScorecard> {
  return hasDatabase()
    ? prismaCouncilScorecardsRepository()
    : jsonCouncilScorecardsRepository(store);
}
