// Report-folders repository — JSON store in dev, Prisma against Postgres when
// DATABASE_URL is set. Mirrors reports.repo.ts.

import type { StoredReportFolder } from '../routes/report-folders';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonReportFoldersRepository(store: StoredReportFolder[]): Repository<StoredReportFolder> {
  return jsonRepository<StoredReportFolder>(store, () => saveStore('reportFolders', store));
}

type PrismaFolderRow = {
  id: string;
  orgId: string;
  name: string;
  ownerId: string | null;
  kind: string;
  shared: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaReportFolderDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaFolderRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaFolderRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaFolderRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaFolderRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaFolderRow>;
}

function fromPrisma(r: PrismaFolderRow): StoredReportFolder {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    ownerId: r.ownerId ?? null,
    kind: r.kind === 'system' ? 'system' : 'user',
    shared: !!r.shared,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredReportFolder>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.ownerId !== undefined) d.ownerId = row.ownerId ?? null;
  if (row.kind !== undefined) d.kind = row.kind;
  if (row.shared !== undefined) d.shared = row.shared;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaReportFoldersRepository(
  clientFactory: () => { reportFolder: PrismaReportFolderDelegate } = getPrisma as unknown as () => { reportFolder: PrismaReportFolderDelegate },
): Repository<StoredReportFolder> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.reportFolder.findMany({ where: { orgId: filter.orgId } })
        : await client.reportFolder.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.reportFolder.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.reportFolder.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.reportFolder.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.reportFolder.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getReportFoldersRepository(store: StoredReportFolder[]): Repository<StoredReportFolder> {
  return hasDatabase()
    ? prismaReportFoldersRepository()
    : jsonReportFoldersRepository(store);
}
