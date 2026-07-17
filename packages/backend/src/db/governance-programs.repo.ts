// GovernanceProgram repository — one-per-org program record.
// `scope` and `principles` are JSON blobs on the Postgres side
// so the vocabulary can extend without a migration.

import type { StoredGovernanceProgram } from '../routes/governance-program';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonGovernanceProgramsRepository(
  store: StoredGovernanceProgram[],
): Repository<StoredGovernanceProgram> {
  return jsonRepository<StoredGovernanceProgram>(store, () => saveStore('governancePrograms', store));
}

// ── Postgres path ──

type PrismaGovernanceProgramRow = {
  id: string;
  orgId: string;
  name: string;
  scope: unknown;
  principles: unknown;
  targetStartDate: string | null;
  targetLaunchDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGovernanceProgramDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaGovernanceProgramRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaGovernanceProgramRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaGovernanceProgramRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaGovernanceProgramRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaGovernanceProgramRow>;
}

function fromPrisma(r: PrismaGovernanceProgramRow): StoredGovernanceProgram {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    scope: r.scope as StoredGovernanceProgram['scope'],
    principles: r.principles as StoredGovernanceProgram['principles'],
    targetStartDate: r.targetStartDate,
    targetLaunchDate: r.targetLaunchDate,
    status: r.status as StoredGovernanceProgram['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredGovernanceProgram>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.scope !== undefined) d.scope = row.scope;
  if (row.principles !== undefined) d.principles = row.principles;
  if (row.targetStartDate !== undefined) d.targetStartDate = row.targetStartDate;
  if (row.targetLaunchDate !== undefined) d.targetLaunchDate = row.targetLaunchDate;
  if (row.status !== undefined) d.status = row.status;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaGovernanceProgramsRepository(
  clientFactory: () => { governanceProgram: PrismaGovernanceProgramDelegate } =
    getPrisma as unknown as () => { governanceProgram: PrismaGovernanceProgramDelegate },
): Repository<StoredGovernanceProgram> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.governanceProgram.findMany({ where: { orgId: filter.orgId } })
        : await client.governanceProgram.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.governanceProgram.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.governanceProgram.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.governanceProgram.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.governanceProgram.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getGovernanceProgramsRepository(
  store: StoredGovernanceProgram[],
): Repository<StoredGovernanceProgram> {
  return hasDatabase()
    ? prismaGovernanceProgramsRepository()
    : jsonGovernanceProgramsRepository(store);
}
