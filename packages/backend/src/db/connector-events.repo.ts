// ConnectorEvent repository — append-only agent activity records.
// No createdAt/updatedAt on the row itself — the agent-supplied `ts`
// string is the sole timestamp. `data` is a JSON blob (payload counts,
// durations, error strings).

import type { StoredConnectorEvent } from '../routes/connectors';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonConnectorEventsRepository(
  store: StoredConnectorEvent[],
): Repository<StoredConnectorEvent> {
  return jsonRepository<StoredConnectorEvent>(store, () => saveStore('connectorEvents', store));
}

// ── Postgres path ──

type PrismaConnectorEventRow = {
  id: string;
  connectorId: string;
  orgId: string;
  type: string;
  ts: string;
  data: unknown;
};

export interface PrismaConnectorEventDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaConnectorEventRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaConnectorEventRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaConnectorEventRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaConnectorEventRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaConnectorEventRow>;
}

function fromPrisma(r: PrismaConnectorEventRow): StoredConnectorEvent {
  return {
    id: r.id,
    connectorId: r.connectorId,
    orgId: r.orgId,
    type: r.type as StoredConnectorEvent['type'],
    ts: r.ts,
    data: (r.data ?? {}) as Record<string, any>,
  };
}

function toPrismaData(row: Partial<StoredConnectorEvent>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.connectorId !== undefined) d.connectorId = row.connectorId;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.type !== undefined) d.type = row.type;
  if (row.ts !== undefined) d.ts = row.ts;
  if (row.data !== undefined) d.data = row.data;
  return d;
}

export function prismaConnectorEventsRepository(
  clientFactory: () => { connectorEvent: PrismaConnectorEventDelegate } =
    getPrisma as unknown as () => { connectorEvent: PrismaConnectorEventDelegate },
): Repository<StoredConnectorEvent> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.connectorEvent.findMany({ where: { orgId: filter.orgId } })
        : await client.connectorEvent.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.connectorEvent.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.connectorEvent.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.connectorEvent.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.connectorEvent.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getConnectorEventsRepository(
  store: StoredConnectorEvent[],
): Repository<StoredConnectorEvent> {
  return hasDatabase()
    ? prismaConnectorEventsRepository()
    : jsonConnectorEventsRepository(store);
}
