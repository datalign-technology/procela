// SyncConnection repository — recurring-import job configs.
// config / fieldMapping / schedule / lastSyncResult are all JSON on
// the Postgres side so the source vocabulary stays extensible.

import type { SyncConnection } from '../routes/sync-connections';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonSyncConnectionsRepository(store: SyncConnection[]): Repository<SyncConnection> {
  return jsonRepository<SyncConnection>(store, () => saveStore('syncConnections', store));
}

// ── Postgres path ──

type PrismaSyncConnectionRow = {
  id: string;
  orgId: string;
  name: string;
  targetEntity: string;
  sourceType: string;
  connectionId: string | null;
  config: unknown;
  fieldMapping: unknown;
  matchKey: string;
  schedule: unknown;
  status: string;
  lastSyncResult: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaSyncConnectionDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaSyncConnectionRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaSyncConnectionRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaSyncConnectionRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaSyncConnectionRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaSyncConnectionRow>;
}

function fromPrisma(r: PrismaSyncConnectionRow): SyncConnection {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    targetEntity: r.targetEntity as SyncConnection['targetEntity'],
    sourceType: r.sourceType as SyncConnection['sourceType'],
    connectionId: r.connectionId,
    config: (r.config ?? {}) as SyncConnection['config'],
    fieldMapping: (r.fieldMapping ?? {}) as SyncConnection['fieldMapping'],
    matchKey: r.matchKey,
    schedule: (r.schedule ?? {
      enabled: false, intervalMinutes: 0, lastRunAt: null, nextRunAt: null,
    }) as SyncConnection['schedule'],
    status: r.status as SyncConnection['status'],
    lastSyncResult: (r.lastSyncResult ?? null) as SyncConnection['lastSyncResult'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<SyncConnection>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.targetEntity !== undefined) d.targetEntity = row.targetEntity;
  if (row.sourceType !== undefined) d.sourceType = row.sourceType;
  if (row.connectionId !== undefined) d.connectionId = row.connectionId;
  if (row.config !== undefined) d.config = row.config;
  if (row.fieldMapping !== undefined) d.fieldMapping = row.fieldMapping;
  if (row.matchKey !== undefined) d.matchKey = row.matchKey;
  if (row.schedule !== undefined) d.schedule = row.schedule;
  if (row.status !== undefined) d.status = row.status;
  if (row.lastSyncResult !== undefined) d.lastSyncResult = row.lastSyncResult;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaSyncConnectionsRepository(
  clientFactory: () => { syncConnection: PrismaSyncConnectionDelegate } =
    getPrisma as unknown as () => { syncConnection: PrismaSyncConnectionDelegate },
): Repository<SyncConnection> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.syncConnection.findMany({ where: { orgId: filter.orgId } })
        : await client.syncConnection.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.syncConnection.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.syncConnection.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.syncConnection.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.syncConnection.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getSyncConnectionsRepository(store: SyncConnection[]): Repository<SyncConnection> {
  return hasDatabase()
    ? prismaSyncConnectionsRepository()
    : jsonSyncConnectionsRepository(store);
}
