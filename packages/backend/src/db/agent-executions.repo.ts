// AgentExecution repository — one row per run of an agent against an
// activity. Scalar-only shape; the AI draft output is stored inline as
// Text on the row.

import type { StoredAgentExecution } from '../routes/agent-executions';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonAgentExecutionsRepository(store: StoredAgentExecution[]): Repository<StoredAgentExecution> {
  return jsonRepository<StoredAgentExecution>(store, () => saveStore('agentExecutions', store));
}

// ── Postgres path ──

type PrismaAgentExecutionRow = {
  id: string;
  orgId: string;
  agentId: string;
  agentName: string;
  activityId: string;
  activityName: string;
  roleType: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  output: string;
  error: string | null;
  durationMs: number | null;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  promotedDocumentId: string | null;
  createdAt: Date;
};

export interface PrismaAgentExecutionDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaAgentExecutionRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaAgentExecutionRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaAgentExecutionRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaAgentExecutionRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaAgentExecutionRow>;
}

function fromPrisma(r: PrismaAgentExecutionRow): StoredAgentExecution {
  return {
    id: r.id,
    orgId: r.orgId,
    agentId: r.agentId,
    agentName: r.agentName,
    activityId: r.activityId,
    activityName: r.activityName,
    roleType: r.roleType,
    status: r.status as StoredAgentExecution['status'],
    startedAt: r.startedAt,
    completedAt: r.completedAt ?? null,
    output: r.output ?? '',
    error: r.error ?? null,
    durationMs: r.durationMs ?? null,
    reviewStatus: r.reviewStatus as StoredAgentExecution['reviewStatus'],
    reviewedBy: r.reviewedBy ?? null,
    reviewedAt: r.reviewedAt ?? null,
    promotedDocumentId: r.promotedDocumentId ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredAgentExecution>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.agentId !== undefined) d.agentId = row.agentId;
  if (row.agentName !== undefined) d.agentName = row.agentName;
  if (row.activityId !== undefined) d.activityId = row.activityId;
  if (row.activityName !== undefined) d.activityName = row.activityName;
  if (row.roleType !== undefined) d.roleType = row.roleType;
  if (row.status !== undefined) d.status = row.status;
  if (row.startedAt !== undefined) d.startedAt = row.startedAt;
  if (row.completedAt !== undefined) d.completedAt = row.completedAt ?? null;
  if (row.output !== undefined) d.output = row.output ?? '';
  if (row.error !== undefined) d.error = row.error ?? null;
  if (row.durationMs !== undefined) d.durationMs = row.durationMs ?? null;
  if (row.reviewStatus !== undefined) d.reviewStatus = row.reviewStatus;
  if (row.reviewedBy !== undefined) d.reviewedBy = row.reviewedBy ?? null;
  if (row.reviewedAt !== undefined) d.reviewedAt = row.reviewedAt ?? null;
  if (row.promotedDocumentId !== undefined) d.promotedDocumentId = row.promotedDocumentId ?? null;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaAgentExecutionsRepository(
  clientFactory: () => { agentExecution: PrismaAgentExecutionDelegate } = getPrisma as unknown as () => { agentExecution: PrismaAgentExecutionDelegate },
): Repository<StoredAgentExecution> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.agentExecution.findMany({ where: { orgId: filter.orgId } })
        : await client.agentExecution.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.agentExecution.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.agentExecution.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.agentExecution.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.agentExecution.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getAgentExecutionsRepository(store: StoredAgentExecution[]): Repository<StoredAgentExecution> {
  return hasDatabase()
    ? prismaAgentExecutionsRepository()
    : jsonAgentExecutionsRepository(store);
}
