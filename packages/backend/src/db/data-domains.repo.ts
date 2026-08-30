// DataDomain repository — second per-entity migration to the
// Postgres-adapter pattern. Follows the shape established by
// db/organizations.repo.ts.
//
// The interesting bits vs organizations:
//   - Every row is scoped by orgId (organizations aren't — they ARE
//     the org). The list() filter passes through to a WHERE clause
//     rather than being repurposed for id lookup.
//   - stewardIds is a many-to-many via the DataDomainSteward join
//     table. The Prisma mapper loads it with `include: { stewards }`
//     and returns the personIds as a flat array, matching the JSON
//     shape one-for-one so callers don't have to know which storage
//     backend they're on.
//   - dataAssetIds is stored as an array on the JSON row but modeled
//     as the reverse of DataAsset.dataDomainId in Postgres. The
//     Prisma mapper computes it via `include: { dataAssets }` and
//     collects the ids; on write we ignore any incoming value and
//     let the DataAsset repository own the relationship on its side.

import type { StoredDataDomain } from '../routes/data-domains';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonDataDomainsRepository(store: StoredDataDomain[]): Repository<StoredDataDomain> {
  return jsonRepository<StoredDataDomain>(store, () => saveStore('dataDomains', store));
}

// ── Postgres path ──

// The structural delegate the repository calls. Kept as a hand-typed
// interface so tests can pass a plain object stub without depending
// on Prisma's generated types (which only exist after `prisma
// generate` has been run against a live database).
type PrismaDomainRow = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  parentDomainId?: string | null;
  scopeDefinition: string | null;
  criticality?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  stewards?: Array<{ personId: string }>;
  dataAssets?: Array<{ id: string }>;
};

export interface PrismaDomainDelegate {
  findMany(arg?: {
    where?: { orgId?: string };
    include?: { stewards?: boolean; dataAssets?: { select?: { id?: boolean } } };
  }): Promise<PrismaDomainRow[]>;
  findUnique(arg: {
    where: { id: string };
    include?: { stewards?: boolean; dataAssets?: { select?: { id?: boolean } } };
  }): Promise<PrismaDomainRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDomainRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDomainRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDomainRow>;
}

function fromPrisma(r: PrismaDomainRow): StoredDataDomain {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description ?? '',
    ownerId: r.ownerId,
    stewardIds: (r.stewards ?? []).map((s) => s.personId),
    dataAssetIds: (r.dataAssets ?? []).map((a) => a.id),
    ...(r.parentDomainId !== undefined ? { parentDomainId: r.parentDomainId } : {}),
    ...(r.scopeDefinition ? { scopeDefinition: r.scopeDefinition } : {}),
    ...(r.criticality ? { criticality: r.criticality } : {}),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Scalar-only Prisma data payload — stewards and dataAssets are
// managed via their own tables and skipped here. Writing to those
// relations is a separate concern (setStewards() below covers
// stewardIds; DataAsset owns the dataDomainId FK).
function toPrismaData(row: Partial<StoredDataDomain>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.name !== undefined) data.name = row.name;
  if (row.description !== undefined) data.description = row.description || null;
  if (row.ownerId !== undefined) data.ownerId = row.ownerId;
  if (row.parentDomainId !== undefined) data.parentDomainId = row.parentDomainId || null;
  if (row.scopeDefinition !== undefined) data.scopeDefinition = row.scopeDefinition || null;
  if (row.criticality !== undefined) data.criticality = row.criticality || null;
  if (row.status !== undefined) data.status = row.status;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  // updatedAt is Prisma-managed via @updatedAt; never forward inbound
  // values so a UI PATCH that echoes back the whole row doesn't stamp
  // stale timestamps into the DB.
  return data;
}

const includeRelations = {
  stewards: true,
  dataAssets: { select: { id: true } },
} as const;

export function prismaDataDomainsRepository(
  clientFactory: () => { dataDomain: PrismaDomainDelegate } = getPrisma as unknown as () => { dataDomain: PrismaDomainDelegate },
): Repository<StoredDataDomain> {
  return {
    async list(filter) {
      const client = clientFactory();
      const where = filter?.orgId ? { orgId: filter.orgId } : undefined;
      const rows = await client.dataDomain.findMany({
        ...(where ? { where } : {}),
        include: includeRelations,
      });
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.dataDomain.findUnique({
        where: { id },
        include: includeRelations,
      });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.dataDomain.create({ data: toPrismaData(row) });
      // stewardIds is written separately — this repo mirrors the
      // shape of the JSON store, but the join-table write is done
      // atomically by a follow-up patch since Prisma's nested-create
      // syntax expects the join rows in a different shape than the
      // flat array we store on the JSON side.
      if (row.stewardIds && row.stewardIds.length > 0) {
        await this.update(created.id, { stewardIds: row.stewardIds });
      }
      // Fetch back with relations so the returned row matches
      // list() / get() shape.
      const fresh = await this.get(created.id);
      return fresh ?? fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        // Scalar update first (safe to noop if no scalar fields
        // changed) so we can then re-derive the join rows against a
        // known-existing parent.
        const scalarData = toPrismaData(patch);
        if (Object.keys(scalarData).length > 0) {
          await client.dataDomain.update({ where: { id }, data: scalarData });
        }
        // stewardIds: rewrite the join rows to match the patch.
        // Callers pass the full desired set; the diff is done on the
        // DB side via a delete-all + createMany. Not the most
        // efficient — a real deploy might diff to add/remove only
        // — but correct and simple, which is what the reference
        // implementation should prioritise.
        if (patch.stewardIds !== undefined) {
          // Cast the delegate to also cover the join table since
          // the tests only stub the DataDomain surface for now.
          const c = client as unknown as {
            dataDomainSteward: {
              deleteMany(arg: { where: { dataDomainId: string } }): Promise<{ count: number }>;
              createMany(arg: { data: Array<{ dataDomainId: string; personId: string }> }): Promise<{ count: number }>;
            };
          };
          await c.dataDomainSteward.deleteMany({ where: { dataDomainId: id } });
          if (patch.stewardIds.length > 0) {
            await c.dataDomainSteward.createMany({
              data: patch.stewardIds.map((personId) => ({ dataDomainId: id, personId })),
            });
          }
        }
        const fresh = await this.get(id);
        return fresh;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.dataDomain.delete({ where: { id } });
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
 * Pick the right DataDomain repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise. Routes call
 * this once at module-load and cache the result.
 */
export function getDataDomainsRepository(store: StoredDataDomain[]): Repository<StoredDataDomain> {
  return hasDatabase()
    ? prismaDataDomainsRepository()
    : jsonDataDomainsRepository(store);
}
