// Service-principal grant repository — revocable, org-scoped non-human
// identities an MCP agent authenticates as. The plaintext token is never
// stored (only `tokenPrefix` for display); revocation sets `revokedAt`.
// JSON store in dev / Prisma table (service_principals) when DATABASE_URL is set.

import type { StoredServicePrincipal } from '../routes/service-principals';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonServicePrincipalsRepository(store: StoredServicePrincipal[]): Repository<StoredServicePrincipal> {
  return jsonRepository<StoredServicePrincipal>(store, () => saveStore('servicePrincipals', store));
}

// ── Postgres path ──

type PrismaServicePrincipalRow = {
  id: string;
  orgId: string;
  label: string;
  role: string;
  createdBy: string | null;
  tokenPrefix: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaServicePrincipalDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaServicePrincipalRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaServicePrincipalRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaServicePrincipalRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaServicePrincipalRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaServicePrincipalRow>;
}

function fromPrisma(r: PrismaServicePrincipalRow): StoredServicePrincipal {
  return {
    id: r.id,
    orgId: r.orgId,
    label: r.label,
    role: r.role,
    createdBy: r.createdBy,
    tokenPrefix: r.tokenPrefix,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredServicePrincipal>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.label !== undefined) d.label = row.label;
  if (row.role !== undefined) d.role = row.role;
  if (row.createdBy !== undefined) d.createdBy = row.createdBy;
  if (row.tokenPrefix !== undefined) d.tokenPrefix = row.tokenPrefix;
  if (row.lastUsedAt !== undefined) d.lastUsedAt = row.lastUsedAt;
  if (row.revokedAt !== undefined) d.revokedAt = row.revokedAt;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaServicePrincipalsRepository(
  clientFactory: () => { servicePrincipal: PrismaServicePrincipalDelegate } =
    getPrisma as unknown as () => { servicePrincipal: PrismaServicePrincipalDelegate },
): Repository<StoredServicePrincipal> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.servicePrincipal.findMany({ where: { orgId: filter.orgId } })
        : await client.servicePrincipal.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.servicePrincipal.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.servicePrincipal.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.servicePrincipal.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.servicePrincipal.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getServicePrincipalsRepository(store: StoredServicePrincipal[]): Repository<StoredServicePrincipal> {
  return hasDatabase()
    ? prismaServicePrincipalsRepository()
    : jsonServicePrincipalsRepository(store);
}
