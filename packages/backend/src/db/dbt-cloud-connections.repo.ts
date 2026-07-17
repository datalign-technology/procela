// DbtCloudConnection repository — dbt Cloud pairing rows with a JSONB
// `lastSummary` payload the reconciler writes after every refresh.

import type { DbtCloudConnection } from '../routes/dbt-cloud-connections';
import type { DbtImportSummary } from '../routes/data-lineage';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonDbtCloudConnectionsRepository(store: DbtCloudConnection[]): Repository<DbtCloudConnection> {
  return jsonRepository<DbtCloudConnection>(store, () => saveStore('dbtCloudConnections', store));
}

// ── Postgres path ──

type PrismaDbtCloudConnectionRow = {
  id: string;
  orgId: string;
  name: string;
  host: string;
  accountId: string;
  jobId: string;
  token: string;
  lastRunAt: string | null;
  lastStatus: string;
  lastError: string | null;
  lastSummary: unknown;
  pollFrequency: string;
  nextPollAt: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaDbtCloudConnectionDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaDbtCloudConnectionRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaDbtCloudConnectionRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDbtCloudConnectionRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDbtCloudConnectionRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDbtCloudConnectionRow>;
}

function fromPrisma(r: PrismaDbtCloudConnectionRow): DbtCloudConnection {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    host: r.host,
    accountId: r.accountId,
    jobId: r.jobId,
    token: r.token,
    lastRunAt: r.lastRunAt ?? null,
    lastStatus: r.lastStatus as DbtCloudConnection['lastStatus'],
    lastError: r.lastError ?? null,
    lastSummary: (r.lastSummary ?? null) as DbtImportSummary | null,
    pollFrequency: r.pollFrequency as DbtCloudConnection['pollFrequency'],
    nextPollAt: r.nextPollAt ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<DbtCloudConnection>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.host !== undefined) d.host = row.host;
  if (row.accountId !== undefined) d.accountId = row.accountId;
  if (row.jobId !== undefined) d.jobId = row.jobId;
  if (row.token !== undefined) d.token = row.token;
  if (row.lastRunAt !== undefined) d.lastRunAt = row.lastRunAt ?? null;
  if (row.lastStatus !== undefined) d.lastStatus = row.lastStatus;
  if (row.lastError !== undefined) d.lastError = row.lastError ?? null;
  if (row.lastSummary !== undefined) d.lastSummary = row.lastSummary ?? null;
  if (row.pollFrequency !== undefined) d.pollFrequency = row.pollFrequency;
  if (row.nextPollAt !== undefined) d.nextPollAt = row.nextPollAt ?? null;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaDbtCloudConnectionsRepository(
  clientFactory: () => { dbtCloudConnection: PrismaDbtCloudConnectionDelegate } = getPrisma as unknown as () => { dbtCloudConnection: PrismaDbtCloudConnectionDelegate },
): Repository<DbtCloudConnection> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.dbtCloudConnection.findMany({ where: { orgId: filter.orgId } })
        : await client.dbtCloudConnection.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.dbtCloudConnection.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.dbtCloudConnection.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.dbtCloudConnection.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.dbtCloudConnection.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getDbtCloudConnectionsRepository(store: DbtCloudConnection[]): Repository<DbtCloudConnection> {
  return hasDatabase()
    ? prismaDbtCloudConnectionsRepository()
    : jsonDbtCloudConnectionsRepository(store);
}
