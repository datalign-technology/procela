// Connection repository — admin-side saved connection profiles.
// `config` and `credentials` are JSON blobs. System links live in the
// connectionSystemLinks join table (see routes/connections); a
// connection row carries no direct system reference.

import type { ConnectionProfile } from '../routes/connections';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonConnectionsRepository(store: ConnectionProfile[]): Repository<ConnectionProfile> {
  return jsonRepository<ConnectionProfile>(store, () => saveStore('connections', store));
}

// ── Postgres path ──

type PrismaConnectionRow = {
  id: string;
  orgId: string;
  name: string;
  connectionType: string;
  config: unknown;
  credentials: unknown;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaConnectionDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaConnectionRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaConnectionRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaConnectionRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaConnectionRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaConnectionRow>;
}

function fromPrisma(r: PrismaConnectionRow): ConnectionProfile {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    connectionType: r.connectionType as ConnectionProfile['connectionType'],
    config: (r.config ?? {}) as ConnectionProfile['config'],
    credentials: (r.credentials ?? {}) as ConnectionProfile['credentials'],
    status: r.status as ConnectionProfile['status'],
    lastTestedAt: r.lastTestedAt,
    lastTestResult: r.lastTestResult,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<ConnectionProfile>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.connectionType !== undefined) d.connectionType = row.connectionType;
  if (row.config !== undefined) d.config = row.config;
  if (row.credentials !== undefined) d.credentials = row.credentials;
  if (row.status !== undefined) d.status = row.status;
  if (row.lastTestedAt !== undefined) d.lastTestedAt = row.lastTestedAt;
  if (row.lastTestResult !== undefined) d.lastTestResult = row.lastTestResult;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaConnectionsRepository(
  clientFactory: () => { connection: PrismaConnectionDelegate } =
    getPrisma as unknown as () => { connection: PrismaConnectionDelegate },
): Repository<ConnectionProfile> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.connection.findMany({ where: { orgId: filter.orgId } })
        : await client.connection.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.connection.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.connection.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.connection.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.connection.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getConnectionsRepository(store: ConnectionProfile[]): Repository<ConnectionProfile> {
  return hasDatabase()
    ? prismaConnectionsRepository()
    : jsonConnectionsRepository(store);
}
