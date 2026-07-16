// DamaRole repository — scalar-only per-entity migration.
//
// DAMA roles carry no top-level orgId column: an ORG-scoped
// assignment stores the orgId directly in scopeId, and a
// DOMAIN-scoped assignment resolves its orgId through the parent
// DataDomain. Because that lookup depends on the DataDomain store
// (which the repo doesn't reach into directly), the orgId filter is
// intentionally ignored on both the JSON and Prisma paths — callers
// that need an org-scoped list should filter post-list using
// dataDomains as the route module does today. See routes/dama-roles
// `roleOrgId()` for the resolution rule.

import type { StoredDamaRole } from '../routes/dama-roles';
import { saveStore } from '../lib/persistence';
import { Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

// Custom (not jsonRepository helper) so the helper's orgId filter
// — which relies on a top-level orgId column — doesn't zero every
// row out. See file header for why the filter is ignored.
export function jsonDamaRolesRepository(store: StoredDamaRole[]): Repository<StoredDamaRole> {
  const save = () => saveStore('damaRoles', store);
  return {
    async list(_filter) {
      return [...store];
    },
    async get(id) {
      return store.find((r) => r.id === id) ?? null;
    },
    async create(row) {
      store.push(row);
      save();
      return row;
    },
    async update(id, patch) {
      const row = store.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      save();
      return row;
    },
    async delete(id) {
      const idx = store.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      store.splice(idx, 1);
      save();
      return true;
    },
  };
}

// ── Postgres path ──

type PrismaDamaRoleRow = {
  id: string;
  personId: string | null;
  agentId: string | null;
  agentName: string | null;
  roleType: string;
  scopeType: string;
  scopeId: string;
  since: string;
  createdAt: Date;
};

export interface PrismaDamaRoleDelegate {
  findMany(arg?: unknown): Promise<PrismaDamaRoleRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaDamaRoleRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDamaRoleRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDamaRoleRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDamaRoleRow>;
}

function fromPrisma(r: PrismaDamaRoleRow): StoredDamaRole {
  return {
    id: r.id,
    personId: r.personId,
    agentId: r.agentId,
    agentName: r.agentName,
    roleType: r.roleType,
    scopeType: r.scopeType as StoredDamaRole['scopeType'],
    scopeId: r.scopeId,
    since: r.since,
    createdAt: r.createdAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredDamaRole>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.personId !== undefined) data.personId = row.personId;
  if (row.agentId !== undefined) data.agentId = row.agentId;
  if (row.agentName !== undefined) data.agentName = row.agentName;
  if (row.roleType !== undefined) data.roleType = row.roleType;
  if (row.scopeType !== undefined) data.scopeType = row.scopeType;
  if (row.scopeId !== undefined) data.scopeId = row.scopeId;
  if (row.since !== undefined) data.since = row.since;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

export function prismaDamaRolesRepository(
  clientFactory: () => { damaRole: PrismaDamaRoleDelegate } = getPrisma as unknown as () => { damaRole: PrismaDamaRoleDelegate },
): Repository<StoredDamaRole> {
  return {
    async list(_filter) {
      // orgId filter intentionally ignored — see file header.
      const client = clientFactory();
      const rows = await client.damaRole.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.damaRole.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.damaRole.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.damaRole.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.damaRole.delete({ where: { id } });
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
 * Pick the right DamaRole repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getDamaRolesRepository(store: StoredDamaRole[]): Repository<StoredDamaRole> {
  return hasDatabase()
    ? prismaDamaRolesRepository()
    : jsonDamaRolesRepository(store);
}
