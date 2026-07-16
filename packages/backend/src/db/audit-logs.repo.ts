// AuditLog repository — eighth per-entity migration. Scalar-only
// but carries the hash-chain fields (prevHash / entryHash) whose
// integrity the auditService.verifyChain() depends on.
//
// Design note: the Repository interface is CRUD, but audit logs are
// append-only in practice — updates + deletes are used only by the
// GDPR redact-person pass (which rewrites userId + before/after
// scrub across the ledger and re-hashes the chain from the first
// modified row). Both operations are exposed here for parity with
// the other repos, but callers should treat write as `create` only.
//
// The hash-chain is computed application-side by auditService, not
// by the repository. The repo just persists whatever prevHash /
// entryHash the caller supplied. That keeps the hash logic in one
// place (the service) and lets the JSON and Prisma paths share the
// same hash-chain semantics.

import type { AuditLogEntry } from '../services/audit.service';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonAuditLogsRepository(store: AuditLogEntry[]): Repository<AuditLogEntry> {
  return jsonRepository<AuditLogEntry>(store, () => saveStore('auditLogs', store));
}

// ── Postgres path ──

type PrismaAuditRow = {
  id: string;
  orgId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  timestamp: Date;
  prevHash: string | null;
  entryHash: string | null;
};

export interface PrismaAuditDelegate {
  findMany(arg?: {
    where?: { orgId?: string };
    orderBy?: { timestamp?: 'asc' | 'desc' };
  }): Promise<PrismaAuditRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaAuditRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaAuditRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaAuditRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaAuditRow>;
}

function fromPrisma(r: PrismaAuditRow): AuditLogEntry {
  return {
    id: r.id,
    orgId: r.orgId,
    userId: r.userId,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    before: r.before as object | null,
    after: r.after as object | null,
    timestamp: r.timestamp.toISOString(),
    ...(r.prevHash !== null ? { prevHash: r.prevHash } : {}),
    ...(r.entryHash !== null ? { entryHash: r.entryHash } : {}),
  };
}

function toPrismaData(row: Partial<AuditLogEntry>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.userId !== undefined) data.userId = row.userId;
  if (row.entityType !== undefined) data.entityType = row.entityType;
  if (row.entityId !== undefined) data.entityId = row.entityId;
  if (row.action !== undefined) data.action = row.action;
  if (row.before !== undefined) data.before = row.before ?? null;
  if (row.after !== undefined) data.after = row.after ?? null;
  if (row.timestamp !== undefined) data.timestamp = new Date(row.timestamp);
  if (row.prevHash !== undefined) data.prevHash = row.prevHash ?? null;
  if (row.entryHash !== undefined) data.entryHash = row.entryHash ?? null;
  return data;
}

export function prismaAuditLogsRepository(
  clientFactory: () => { auditLog: PrismaAuditDelegate } = getPrisma as unknown as () => { auditLog: PrismaAuditDelegate },
): Repository<AuditLogEntry> {
  return {
    async list(filter) {
      const client = clientFactory();
      // Order by timestamp ascending so a caller iterating the
      // result can walk the hash chain in original insertion order.
      const rows = filter?.orgId
        ? await client.auditLog.findMany({ where: { orgId: filter.orgId }, orderBy: { timestamp: 'asc' } })
        : await client.auditLog.findMany({ orderBy: { timestamp: 'asc' } });
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.auditLog.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.auditLog.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    // Update is used by the GDPR redact-person pass to overwrite
    // userId + before/after and rewrite the tail of the chain. Not
    // for general edits — audit rows are supposed to be immutable.
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.auditLog.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.auditLog.delete({ where: { id } });
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
 * Pick the right AuditLog repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getAuditLogsRepository(store: AuditLogEntry[]): Repository<AuditLogEntry> {
  return hasDatabase()
    ? prismaAuditLogsRepository()
    : jsonAuditLogsRepository(store);
}
