// GovernanceException repository — scalar-only dual JSON/Postgres path,
// mirroring the GovernancePolicy repo. Dates are stored as ISO strings to
// match the JSON store.

import type { StoredGovernanceException } from '../routes/governance-exceptions';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonGovernanceExceptionsRepository(store: StoredGovernanceException[]): Repository<StoredGovernanceException> {
  return jsonRepository<StoredGovernanceException>(store, () => saveStore('governanceExceptions', store));
}

type PrismaExceptionRow = {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  policyId: string | null;
  ownerId: string | null;
  reason: string | null;
  status: string;
  grantedAt: string;
  expiresAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGovernanceExceptionDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaExceptionRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaExceptionRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaExceptionRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaExceptionRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaExceptionRow>;
}

function fromPrisma(r: PrismaExceptionRow): StoredGovernanceException {
  return {
    id: r.id,
    orgId: r.orgId,
    title: r.title,
    ...(r.description ? { description: r.description } : {}),
    ...(r.policyId ? { policyId: r.policyId } : {}),
    ...(r.ownerId ? { ownerId: r.ownerId } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
    status: (r.status as StoredGovernanceException['status']) || 'ACTIVE',
    grantedAt: r.grantedAt,
    expiresAt: r.expiresAt,
    ...(r.createdBy ? { createdBy: r.createdBy } : {}),
    ...(r.updatedBy ? { updatedBy: r.updatedBy } : {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredGovernanceException>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.title !== undefined) d.title = row.title;
  if (row.description !== undefined) d.description = row.description || null;
  if (row.policyId !== undefined) d.policyId = row.policyId || null;
  if (row.ownerId !== undefined) d.ownerId = row.ownerId || null;
  if (row.reason !== undefined) d.reason = row.reason || null;
  if (row.status !== undefined) d.status = row.status;
  if (row.grantedAt !== undefined) d.grantedAt = row.grantedAt;
  if (row.expiresAt !== undefined) d.expiresAt = row.expiresAt;
  if (row.createdBy !== undefined) d.createdBy = row.createdBy || null;
  if (row.updatedBy !== undefined) d.updatedBy = row.updatedBy || null;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaGovernanceExceptionsRepository(
  clientFactory: () => { governanceException: PrismaGovernanceExceptionDelegate } = getPrisma as unknown as () => { governanceException: PrismaGovernanceExceptionDelegate },
): Repository<StoredGovernanceException> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.governanceException.findMany({ where: { orgId: filter.orgId } })
        : await client.governanceException.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.governanceException.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.governanceException.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.governanceException.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.governanceException.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getGovernanceExceptionsRepository(store: StoredGovernanceException[]): Repository<StoredGovernanceException> {
  return hasDatabase()
    ? prismaGovernanceExceptionsRepository()
    : jsonGovernanceExceptionsRepository(store);
}
