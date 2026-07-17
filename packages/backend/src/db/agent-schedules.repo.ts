// AgentSchedule repository — cadence rows describing when an agent
// should re-run against an activity. All scalar; no JSON or arrays.

import type { StoredAgentSchedule } from '../routes/agent-schedules';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonAgentSchedulesRepository(store: StoredAgentSchedule[]): Repository<StoredAgentSchedule> {
  return jsonRepository<StoredAgentSchedule>(store, () => saveStore('agentSchedules', store));
}

// ── Postgres path ──

type PrismaAgentScheduleRow = {
  id: string;
  orgId: string;
  agentId: string;
  agentName: string;
  activityId: string;
  activityName: string;
  roleType: string;
  frequency: string;
  status: string;
  startAt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  runCount: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaAgentScheduleDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaAgentScheduleRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaAgentScheduleRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaAgentScheduleRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaAgentScheduleRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaAgentScheduleRow>;
}

function fromPrisma(r: PrismaAgentScheduleRow): StoredAgentSchedule {
  return {
    id: r.id,
    orgId: r.orgId,
    agentId: r.agentId,
    agentName: r.agentName,
    activityId: r.activityId,
    activityName: r.activityName,
    roleType: r.roleType,
    frequency: r.frequency as StoredAgentSchedule['frequency'],
    status: r.status as StoredAgentSchedule['status'],
    startAt: r.startAt,
    nextRunAt: r.nextRunAt,
    lastRunAt: r.lastRunAt ?? null,
    runCount: r.runCount,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredAgentSchedule>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.agentId !== undefined) d.agentId = row.agentId;
  if (row.agentName !== undefined) d.agentName = row.agentName;
  if (row.activityId !== undefined) d.activityId = row.activityId;
  if (row.activityName !== undefined) d.activityName = row.activityName;
  if (row.roleType !== undefined) d.roleType = row.roleType;
  if (row.frequency !== undefined) d.frequency = row.frequency;
  if (row.status !== undefined) d.status = row.status;
  if (row.startAt !== undefined) d.startAt = row.startAt;
  if (row.nextRunAt !== undefined) d.nextRunAt = row.nextRunAt;
  if (row.lastRunAt !== undefined) d.lastRunAt = row.lastRunAt ?? null;
  if (row.runCount !== undefined) d.runCount = row.runCount;
  if (row.createdBy !== undefined) d.createdBy = row.createdBy ?? null;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaAgentSchedulesRepository(
  clientFactory: () => { agentSchedule: PrismaAgentScheduleDelegate } = getPrisma as unknown as () => { agentSchedule: PrismaAgentScheduleDelegate },
): Repository<StoredAgentSchedule> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.agentSchedule.findMany({ where: { orgId: filter.orgId } })
        : await client.agentSchedule.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.agentSchedule.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.agentSchedule.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.agentSchedule.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.agentSchedule.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getAgentSchedulesRepository(store: StoredAgentSchedule[]): Repository<StoredAgentSchedule> {
  return hasDatabase()
    ? prismaAgentSchedulesRepository()
    : jsonAgentSchedulesRepository(store);
}
