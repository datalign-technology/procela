// System repository — sixth per-entity migration. New patterns:
//
//   - Multiple named Person FKs on one row (ownerPersonId,
//     deputyOwnerId, stewardId) — each pointing at the same Person
//     table under distinct Prisma relations. The schema handles this
//     via `@relation("SystemOwner")` / `@relation("SystemDeputyOwner")`
//     / `@relation("SystemSteward")` on the Person side.
//   - JSONB integrations[] alongside a free-text integrationPoints —
//     keeps the structured/unstructured pair the JSON store already
//     carries.
//   - custodianIds M2M via a new SystemCustodian join table — same
//     delete-all + createMany rewrite pattern.
//   - Field rename: schema.ownerId → ownerPersonId to match the
//     JSON store's field name.

import type { StoredSystem, SystemIntegration } from '../routes/systems';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonSystemsRepository(store: StoredSystem[]): Repository<StoredSystem> {
  return jsonRepository<StoredSystem>(store, () => saveStore('systems', store));
}

// ── Postgres path ──

type PrismaSystemRow = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  systemType: string | null;
  businessCriticality: string | null;
  vendor: string | null;
  integrationPoints: string | null;
  integrations: unknown;
  connectivity: string | null;
  ownerPersonId: string | null;
  deputyOwnerId: string | null;
  stewardId: string | null;
  createdAt: Date;
  updatedAt: Date;
  custodians?: Array<{ personId: string }>;
};

export interface PrismaSystemDelegate {
  findMany(arg?: {
    where?: { orgId?: string };
    include?: { custodians?: boolean };
  }): Promise<PrismaSystemRow[]>;
  findUnique(arg: {
    where: { id: string };
    include?: { custodians?: boolean };
  }): Promise<PrismaSystemRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaSystemRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaSystemRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaSystemRow>;
}

function fromPrisma(r: PrismaSystemRow): StoredSystem {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description ?? '',
    systemType: r.systemType ?? '',
    ...(r.businessCriticality
      ? { businessCriticality: r.businessCriticality as StoredSystem['businessCriticality'] }
      : {}),
    ...(r.vendor ? { vendor: r.vendor } : {}),
    ...(r.integrationPoints ? { integrationPoints: r.integrationPoints } : {}),
    ...(r.integrations
      ? { integrations: r.integrations as SystemIntegration[] }
      : {}),
    ...(r.connectivity
      ? { connectivity: r.connectivity as StoredSystem['connectivity'] }
      : {}),
    ...(r.ownerPersonId ? { ownerPersonId: r.ownerPersonId } : {}),
    ...(r.deputyOwnerId ? { deputyOwnerId: r.deputyOwnerId } : {}),
    ...(r.custodians && r.custodians.length > 0
      ? { custodianIds: r.custodians.map((c) => c.personId) }
      : {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredSystem>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.name !== undefined) data.name = row.name;
  if (row.description !== undefined) data.description = row.description || null;
  if (row.systemType !== undefined) data.systemType = row.systemType || null;
  if (row.businessCriticality !== undefined) data.businessCriticality = row.businessCriticality ?? null;
  if (row.vendor !== undefined) data.vendor = row.vendor ?? null;
  if (row.integrationPoints !== undefined) data.integrationPoints = row.integrationPoints ?? null;
  if (row.integrations !== undefined) data.integrations = row.integrations ?? null;
  if (row.connectivity !== undefined) data.connectivity = row.connectivity ?? null;
  if (row.ownerPersonId !== undefined) data.ownerPersonId = row.ownerPersonId ?? null;
  if (row.deputyOwnerId !== undefined) data.deputyOwnerId = row.deputyOwnerId ?? null;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  // updatedAt is Prisma-managed via @updatedAt. custodianIds is
  // handled by the join-table rewrite in update(), not here.
  return data;
}

const includeRelations = { custodians: true } as const;

export function prismaSystemsRepository(
  clientFactory: () => { system: PrismaSystemDelegate } = getPrisma as unknown as () => { system: PrismaSystemDelegate },
): Repository<StoredSystem> {
  return {
    async list(filter) {
      const client = clientFactory();
      const where = filter?.orgId ? { orgId: filter.orgId } : undefined;
      const rows = await client.system.findMany({
        ...(where ? { where } : {}),
        include: includeRelations,
      });
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.system.findUnique({ where: { id }, include: includeRelations });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.system.create({ data: toPrismaData(row) });
      if (row.custodianIds && row.custodianIds.length > 0) {
        await this.update(created.id, { custodianIds: row.custodianIds });
      }
      const fresh = await this.get(created.id);
      return fresh ?? fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const scalarData = toPrismaData(patch);
        if (Object.keys(scalarData).length > 0) {
          await client.system.update({ where: { id }, data: scalarData });
        }
        if (patch.custodianIds !== undefined) {
          const c = client as unknown as {
            systemCustodian: {
              deleteMany(arg: { where: { systemId: string } }): Promise<{ count: number }>;
              createMany(arg: { data: Array<{ systemId: string; personId: string }> }): Promise<{ count: number }>;
            };
          };
          await c.systemCustodian.deleteMany({ where: { systemId: id } });
          if (patch.custodianIds.length > 0) {
            await c.systemCustodian.createMany({
              data: patch.custodianIds.map((personId) => ({ systemId: id, personId })),
            });
          }
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
        await client.system.delete({ where: { id } });
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
 * Pick the right System repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getSystemsRepository(store: StoredSystem[]): Repository<StoredSystem> {
  return hasDatabase()
    ? prismaSystemsRepository()
    : jsonSystemsRepository(store);
}
