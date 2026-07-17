// Connector repository — registered edge/agent connectors. `systemIds`
// is a String[] on Postgres; everything else is scalar. The plaintext
// token is never stored — only its sha256 hash lives here.

import type { StoredConnector } from '../routes/connectors';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonConnectorsRepository(store: StoredConnector[]): Repository<StoredConnector> {
  return jsonRepository<StoredConnector>(store, () => saveStore('connectors', store));
}

// ── Postgres path ──

type PrismaConnectorRow = {
  id: string;
  orgId: string;
  name: string;
  tokenHash: string | null;
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  systemIds: string[];
  lastHeartbeatAt: string | null;
  agentVersion: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaConnectorDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaConnectorRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaConnectorRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaConnectorRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaConnectorRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaConnectorRow>;
}

function fromPrisma(r: PrismaConnectorRow): StoredConnector {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    tokenHash: r.tokenHash,
    pairingCode: r.pairingCode,
    pairingCodeExpiresAt: r.pairingCodeExpiresAt,
    systemIds: r.systemIds ?? [],
    lastHeartbeatAt: r.lastHeartbeatAt,
    agentVersion: r.agentVersion,
    status: r.status as StoredConnector['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredConnector>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.tokenHash !== undefined) d.tokenHash = row.tokenHash;
  if (row.pairingCode !== undefined) d.pairingCode = row.pairingCode;
  if (row.pairingCodeExpiresAt !== undefined) d.pairingCodeExpiresAt = row.pairingCodeExpiresAt;
  if (row.systemIds !== undefined) d.systemIds = row.systemIds;
  if (row.lastHeartbeatAt !== undefined) d.lastHeartbeatAt = row.lastHeartbeatAt;
  if (row.agentVersion !== undefined) d.agentVersion = row.agentVersion;
  if (row.status !== undefined) d.status = row.status;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaConnectorsRepository(
  clientFactory: () => { connector: PrismaConnectorDelegate } =
    getPrisma as unknown as () => { connector: PrismaConnectorDelegate },
): Repository<StoredConnector> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.connector.findMany({ where: { orgId: filter.orgId } })
        : await client.connector.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.connector.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.connector.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.connector.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.connector.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getConnectorsRepository(store: StoredConnector[]): Repository<StoredConnector> {
  return hasDatabase()
    ? prismaConnectorsRepository()
    : jsonConnectorsRepository(store);
}
