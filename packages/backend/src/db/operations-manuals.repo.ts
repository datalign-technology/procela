// OperationsManual repository — the five cadence buckets are native
// String[] arrays; everything else is scalar.

import type { StoredOperationsManual } from '../routes/operations-manuals';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonOperationsManualsRepository(store: StoredOperationsManual[]): Repository<StoredOperationsManual> {
  return jsonRepository<StoredOperationsManual>(store, () => saveStore('operationsManuals', store));
}

type PrismaOperationsManualRow = {
  id: string;
  orgId: string;
  roleType: string;
  label: string;
  purpose: string;
  daily: string[];
  weekly: string[];
  monthly: string[];
  quarterly: string[];
  escalation: string[];
  customContent: string;
  isCustom: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaOperationsManualDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaOperationsManualRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaOperationsManualRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaOperationsManualRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaOperationsManualRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaOperationsManualRow>;
}

function fromPrisma(r: PrismaOperationsManualRow): StoredOperationsManual {
  return {
    id: r.id,
    orgId: r.orgId,
    roleType: r.roleType,
    label: r.label,
    purpose: r.purpose ?? '',
    daily: r.daily ?? [],
    weekly: r.weekly ?? [],
    monthly: r.monthly ?? [],
    quarterly: r.quarterly ?? [],
    escalation: r.escalation ?? [],
    customContent: r.customContent ?? '',
    isCustom: r.isCustom,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredOperationsManual>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.roleType !== undefined) d.roleType = row.roleType;
  if (row.label !== undefined) d.label = row.label;
  if (row.purpose !== undefined) d.purpose = row.purpose;
  if (row.daily !== undefined) d.daily = row.daily;
  if (row.weekly !== undefined) d.weekly = row.weekly;
  if (row.monthly !== undefined) d.monthly = row.monthly;
  if (row.quarterly !== undefined) d.quarterly = row.quarterly;
  if (row.escalation !== undefined) d.escalation = row.escalation;
  if (row.customContent !== undefined) d.customContent = row.customContent;
  if (row.isCustom !== undefined) d.isCustom = row.isCustom;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaOperationsManualsRepository(
  clientFactory: () => { operationsManual: PrismaOperationsManualDelegate } = getPrisma as unknown as () => { operationsManual: PrismaOperationsManualDelegate },
): Repository<StoredOperationsManual> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.operationsManual.findMany({ where: { orgId: filter.orgId } })
        : await client.operationsManual.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.operationsManual.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.operationsManual.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.operationsManual.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.operationsManual.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getOperationsManualsRepository(store: StoredOperationsManual[]): Repository<StoredOperationsManual> {
  return hasDatabase()
    ? prismaOperationsManualsRepository()
    : jsonOperationsManualsRepository(store);
}
