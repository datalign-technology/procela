// GovernanceGroup repository — scalar row plus a JSONB `members`
// payload. The members list carries a (personId | agentId,
// groupRole, since) discriminator per row; storing it as JSONB keeps
// the JSON / Postgres paths shape-identical without a per-member
// join table (rows are only ever read as a set today; promoting the
// members list to a table can wait until it's queried in-place).

import type { StoredGovernanceGroup, GroupMember } from '../routes/governance-groups';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonGovernanceGroupsRepository(store: StoredGovernanceGroup[]): Repository<StoredGovernanceGroup> {
  return jsonRepository<StoredGovernanceGroup>(store, () => saveStore('governanceGroups', store));
}

// ── Postgres path ──

type PrismaGroupRow = {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  type: string;
  description: string;
  charter: string;
  status: string;
  members: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGovernanceGroupDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaGroupRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaGroupRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaGroupRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaGroupRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaGroupRow>;
}

function fromPrisma(r: PrismaGroupRow): StoredGovernanceGroup {
  return {
    id: r.id,
    orgId: r.orgId,
    parentId: r.parentId,
    name: r.name,
    type: r.type,
    description: r.description,
    charter: r.charter,
    status: r.status as StoredGovernanceGroup['status'],
    members: (r.members as GroupMember[] | null) ?? [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredGovernanceGroup>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.parentId !== undefined) data.parentId = row.parentId;
  if (row.name !== undefined) data.name = row.name;
  if (row.type !== undefined) data.type = row.type;
  if (row.description !== undefined) data.description = row.description;
  if (row.charter !== undefined) data.charter = row.charter;
  if (row.status !== undefined) data.status = row.status;
  if (row.members !== undefined) data.members = row.members as unknown;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

export function prismaGovernanceGroupsRepository(
  clientFactory: () => { governanceGroup: PrismaGovernanceGroupDelegate } = getPrisma as unknown as () => { governanceGroup: PrismaGovernanceGroupDelegate },
): Repository<StoredGovernanceGroup> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.governanceGroup.findMany({ where: { orgId: filter.orgId } })
        : await client.governanceGroup.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.governanceGroup.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.governanceGroup.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.governanceGroup.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.governanceGroup.delete({ where: { id } });
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
 * Pick the right GovernanceGroup repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getGovernanceGroupsRepository(store: StoredGovernanceGroup[]): Repository<StoredGovernanceGroup> {
  return hasDatabase()
    ? prismaGovernanceGroupsRepository()
    : jsonGovernanceGroupsRepository(store);
}
