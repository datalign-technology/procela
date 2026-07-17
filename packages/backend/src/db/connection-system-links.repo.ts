// ConnectionSystemLink repository — connection ↔ system M2M join.
// Rows are only ever created and deleted in practice (no update
// path in the routes), but the standard Repository verbs are all
// implemented for consistency with the rest of the batch.

import type { ConnectionSystemLink } from '../routes/connections';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonConnectionSystemLinksRepository(
  store: ConnectionSystemLink[],
): Repository<ConnectionSystemLink> {
  return jsonRepository<ConnectionSystemLink>(store, () =>
    saveStore('connectionSystemLinks', store),
  );
}

type PrismaConnectionSystemLinkRow = {
  id: string;
  orgId: string;
  connectionId: string;
  systemId: string;
  createdAt: Date;
};

export interface PrismaConnectionSystemLinkDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaConnectionSystemLinkRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaConnectionSystemLinkRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaConnectionSystemLinkRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaConnectionSystemLinkRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaConnectionSystemLinkRow>;
}

function fromPrisma(r: PrismaConnectionSystemLinkRow): ConnectionSystemLink {
  return {
    id: r.id,
    orgId: r.orgId,
    connectionId: r.connectionId,
    systemId: r.systemId,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<ConnectionSystemLink>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.connectionId !== undefined) d.connectionId = row.connectionId;
  if (row.systemId !== undefined) d.systemId = row.systemId;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaConnectionSystemLinksRepository(
  clientFactory: () => { connectionSystemLink: PrismaConnectionSystemLinkDelegate } = getPrisma as unknown as () => { connectionSystemLink: PrismaConnectionSystemLinkDelegate },
): Repository<ConnectionSystemLink> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.connectionSystemLink.findMany({ where: { orgId: filter.orgId } })
        : await client.connectionSystemLink.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.connectionSystemLink.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.connectionSystemLink.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        const updated = await client.connectionSystemLink.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.connectionSystemLink.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getConnectionSystemLinksRepository(
  store: ConnectionSystemLink[],
): Repository<ConnectionSystemLink> {
  return hasDatabase()
    ? prismaConnectionSystemLinksRepository()
    : jsonConnectionSystemLinksRepository(store);
}
