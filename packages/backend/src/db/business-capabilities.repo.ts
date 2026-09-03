// BusinessCapability repository — follows the DataDomain adapter pattern
// (db/data-domains.repo.ts). A capability is the grouping level ABOVE a data
// domain (Business Capability -> Data Domain -> Sub-Domain).
//
// Notes vs DataDomain:
//   - No stewards join — a capability carries a single accountable owner.
//   - dataDomainIds is the reverse of DataDomain.businessCapabilityId. The
//     Prisma mapper computes it via `include: { dataDomains }` and collects
//     the ids; on write we ignore any incoming value and let the DataDomain
//     repository own the FK on its side (same rule DataDomain uses for its
//     dataAssetIds).

import type { StoredBusinessCapability } from '../routes/business-capabilities';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonBusinessCapabilitiesRepository(store: StoredBusinessCapability[]): Repository<StoredBusinessCapability> {
  return jsonRepository<StoredBusinessCapability>(store, () => saveStore('businessCapabilities', store));
}

// ── Postgres path ──

type PrismaCapabilityRow = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  code?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  dataDomains?: Array<{ id: string }>;
};

export interface PrismaCapabilityDelegate {
  findMany(arg?: {
    where?: { orgId?: string };
    include?: { dataDomains?: { select?: { id?: boolean } } };
  }): Promise<PrismaCapabilityRow[]>;
  findUnique(arg: {
    where: { id: string };
    include?: { dataDomains?: { select?: { id?: boolean } } };
  }): Promise<PrismaCapabilityRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaCapabilityRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaCapabilityRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaCapabilityRow>;
}

function fromPrisma(r: PrismaCapabilityRow): StoredBusinessCapability {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description ?? '',
    ownerId: r.ownerId,
    dataDomainIds: (r.dataDomains ?? []).map((d) => d.id),
    ...(r.code ? { code: r.code } : {}),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Scalar-only payload — dataDomains are owned by the DataDomain side and
// skipped here.
function toPrismaData(row: Partial<StoredBusinessCapability>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.name !== undefined) data.name = row.name;
  if (row.description !== undefined) data.description = row.description || null;
  if (row.ownerId !== undefined) data.ownerId = row.ownerId;
  if (row.code !== undefined) data.code = row.code || null;
  if (row.status !== undefined) data.status = row.status;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  // updatedAt is Prisma-managed via @updatedAt; never forward inbound values.
  return data;
}

const includeRelations = {
  dataDomains: { select: { id: true } },
} as const;

export function prismaBusinessCapabilitiesRepository(
  clientFactory: () => { businessCapability: PrismaCapabilityDelegate } = getPrisma as unknown as () => { businessCapability: PrismaCapabilityDelegate },
): Repository<StoredBusinessCapability> {
  return {
    async list(filter) {
      const client = clientFactory();
      const where = filter?.orgId ? { orgId: filter.orgId } : undefined;
      const rows = await client.businessCapability.findMany({
        ...(where ? { where } : {}),
        include: includeRelations,
      });
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.businessCapability.findUnique({
        where: { id },
        include: includeRelations,
      });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.businessCapability.create({ data: toPrismaData(row) });
      const fresh = await this.get(created.id);
      return fresh ?? fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const scalarData = toPrismaData(patch);
        if (Object.keys(scalarData).length > 0) {
          await client.businessCapability.update({ where: { id }, data: scalarData });
        }
        return await this.get(id);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.businessCapability.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

// ── Factory ──

export function getBusinessCapabilitiesRepository(store: StoredBusinessCapability[]): Repository<StoredBusinessCapability> {
  return hasDatabase()
    ? prismaBusinessCapabilitiesRepository()
    : jsonBusinessCapabilitiesRepository(store);
}
