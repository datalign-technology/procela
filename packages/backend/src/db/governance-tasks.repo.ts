// GovernanceTask repository — scalar-only per-entity migration.
// Follows the shape of db/mappings.repo.ts. The row carries an
// extended status vocabulary (DRAFT / OPEN / IN_PROGRESS /
// PENDING_REVIEW / PENDING_APPROVAL / COMPLETED / REJECTED /
// CANCELLED) plus taskType / automationMode / priority — all typed
// as String on the schema side so a customer can extend the vocab
// without a migration.

import type { StoredGovernanceTask } from '../routes/governance-tasks';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonGovernanceTasksRepository(store: StoredGovernanceTask[]): Repository<StoredGovernanceTask> {
  return jsonRepository<StoredGovernanceTask>(store, () => saveStore('governanceTasks', store));
}

// ── Postgres path ──

type PrismaTaskRow = {
  id: string;
  orgId: string;
  title: string;
  description: string;
  taskType: string;
  status: string;
  priority: string;
  automationMode: string;
  assigneeId: string | null;
  dueDate: Date | null;
  linkedObjectType: string | null;
  linkedObjectId: string | null;
  createdBy: string | null;
  completedAt: Date | null;
  overdueNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGovernanceTaskDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaTaskRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaTaskRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaTaskRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaTaskRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaTaskRow>;
}

function fromPrisma(r: PrismaTaskRow): StoredGovernanceTask {
  return {
    id: r.id,
    orgId: r.orgId,
    title: r.title,
    description: r.description,
    taskType: r.taskType as StoredGovernanceTask['taskType'],
    status: r.status as StoredGovernanceTask['status'],
    priority: r.priority as StoredGovernanceTask['priority'],
    automationMode: r.automationMode as StoredGovernanceTask['automationMode'],
    assigneeId: r.assigneeId,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    linkedObjectType: r.linkedObjectType,
    linkedObjectId: r.linkedObjectId,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    // Optional field on the Stored type — only include when non-null so
    // rows created before overdue-sweep landed round-trip unchanged.
    ...(r.overdueNotifiedAt !== null ? { overdueNotifiedAt: r.overdueNotifiedAt.toISOString() } : {}),
  };
}

function toPrismaData(row: Partial<StoredGovernanceTask>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.title !== undefined) data.title = row.title;
  if (row.description !== undefined) data.description = row.description;
  if (row.taskType !== undefined) data.taskType = row.taskType;
  if (row.status !== undefined) data.status = row.status;
  if (row.priority !== undefined) data.priority = row.priority;
  if (row.automationMode !== undefined) data.automationMode = row.automationMode;
  if (row.assigneeId !== undefined) data.assigneeId = row.assigneeId;
  if (row.dueDate !== undefined) data.dueDate = row.dueDate ? new Date(row.dueDate) : null;
  if (row.linkedObjectType !== undefined) data.linkedObjectType = row.linkedObjectType;
  if (row.linkedObjectId !== undefined) data.linkedObjectId = row.linkedObjectId;
  if (row.createdBy !== undefined) data.createdBy = row.createdBy;
  if (row.completedAt !== undefined) data.completedAt = row.completedAt ? new Date(row.completedAt) : null;
  if (row.overdueNotifiedAt !== undefined) {
    data.overdueNotifiedAt = row.overdueNotifiedAt ? new Date(row.overdueNotifiedAt) : null;
  }
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  // updatedAt is Prisma-managed.
  return data;
}

export function prismaGovernanceTasksRepository(
  clientFactory: () => { governanceTask: PrismaGovernanceTaskDelegate } = getPrisma as unknown as () => { governanceTask: PrismaGovernanceTaskDelegate },
): Repository<StoredGovernanceTask> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.governanceTask.findMany({ where: { orgId: filter.orgId } })
        : await client.governanceTask.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.governanceTask.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.governanceTask.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        const updated = await client.governanceTask.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.governanceTask.delete({ where: { id } });
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
 * Pick the right GovernanceTask repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getGovernanceTasksRepository(store: StoredGovernanceTask[]): Repository<StoredGovernanceTask> {
  return hasDatabase()
    ? prismaGovernanceTasksRepository()
    : jsonGovernanceTasksRepository(store);
}
