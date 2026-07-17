// Agent repository — agents are the non-human governance actors
// (AI, service accounts, pipelines). Unlike almost every other entity,
// scope isn't a scalar `orgId` but a native Postgres String[] of
// `orgIds` — an agent can belong to several orgs. The list filter
// therefore has to check membership rather than equality on both the
// JSON and Prisma paths.

import type { StoredAgent } from '../routes/agents';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonAgentsRepository(store: StoredAgent[]): Repository<StoredAgent> {
  const base = jsonRepository<StoredAgent & { orgId?: string }>(
    store as unknown as (StoredAgent & { orgId?: string })[],
    () => saveStore('agents', store),
  );
  return {
    ...base,
    async list(filter) {
      if (filter?.orgId) {
        const orgId = filter.orgId;
        return store.filter((a) => Array.isArray(a.orgIds) && a.orgIds.includes(orgId));
      }
      return [...store];
    },
  };
}

// ── Postgres path ──

type PrismaAgentRow = {
  id: string;
  orgIds: string[];
  name: string;
  agentType: string;
  description: string;
  provider: string;
  status: string;
  ownerPersonId: string | null;
  skillIds: string[];
  instructions: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaAgentDelegate {
  findMany(arg?: { where?: Record<string, unknown> }): Promise<PrismaAgentRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaAgentRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaAgentRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaAgentRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaAgentRow>;
}

function fromPrisma(r: PrismaAgentRow): StoredAgent {
  return {
    id: r.id,
    orgIds: r.orgIds ?? [],
    name: r.name,
    agentType: r.agentType as StoredAgent['agentType'],
    description: r.description ?? '',
    provider: r.provider ?? '',
    status: r.status as StoredAgent['status'],
    ownerPersonId: r.ownerPersonId ?? '',
    skillIds: r.skillIds ?? [],
    instructions: r.instructions ?? '',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredAgent>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgIds !== undefined) d.orgIds = row.orgIds;
  if (row.name !== undefined) d.name = row.name;
  if (row.agentType !== undefined) d.agentType = row.agentType;
  if (row.description !== undefined) d.description = row.description ?? '';
  if (row.provider !== undefined) d.provider = row.provider ?? '';
  if (row.status !== undefined) d.status = row.status;
  if (row.ownerPersonId !== undefined) d.ownerPersonId = row.ownerPersonId || null;
  if (row.skillIds !== undefined) d.skillIds = row.skillIds;
  if (row.instructions !== undefined) d.instructions = row.instructions ?? '';
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaAgentsRepository(
  clientFactory: () => { agent: PrismaAgentDelegate } = getPrisma as unknown as () => { agent: PrismaAgentDelegate },
): Repository<StoredAgent> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.agent.findMany({ where: { orgIds: { has: filter.orgId } } })
        : await client.agent.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.agent.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.agent.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.agent.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.agent.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getAgentsRepository(store: StoredAgent[]): Repository<StoredAgent> {
  return hasDatabase()
    ? prismaAgentsRepository()
    : jsonAgentsRepository(store);
}
