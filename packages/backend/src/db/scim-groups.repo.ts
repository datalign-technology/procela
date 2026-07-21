// ScimGroup repository — SCIM 2.0 groups (IdP-provisioned).
//
// Fits the standard {id} entity pattern. `members` is a JSON array
// round-tripped as-is. There is no orgId — SCIM groups are directory-global,
// so `list()` ignores any orgId filter. See docs/POSTGRES_CUTOVER_PLAN.md (PR 1).

import type { StoredScimGroup, ScimGroupMember } from '../services/scim-groups';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonScimGroupsRepository(store: StoredScimGroup[]): Repository<StoredScimGroup> {
  return jsonRepository<StoredScimGroup>(store, () => saveStore('scim-groups', store));
}

type PrismaScimGroupRow = {
  id: string;
  displayName: string;
  externalId: string | null;
  members: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaScimGroupDelegate {
  findMany(): Promise<PrismaScimGroupRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaScimGroupRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaScimGroupRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaScimGroupRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaScimGroupRow>;
}

function fromPrisma(r: PrismaScimGroupRow): StoredScimGroup {
  return {
    id: r.id,
    displayName: r.displayName,
    externalId: r.externalId ?? undefined,
    members: (r.members ?? []) as ScimGroupMember[],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredScimGroup>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.displayName !== undefined) d.displayName = row.displayName;
  if (row.externalId !== undefined) d.externalId = row.externalId ?? null;
  if (row.members !== undefined) d.members = row.members as unknown as object;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaScimGroupsRepository(
  clientFactory: () => { scimGroup: PrismaScimGroupDelegate } =
    getPrisma as unknown as () => { scimGroup: PrismaScimGroupDelegate },
): Repository<StoredScimGroup> {
  return {
    async list() {
      const rows = await clientFactory().scimGroup.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const row = await clientFactory().scimGroup.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const created = await clientFactory().scimGroup.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await clientFactory().scimGroup.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      try {
        await clientFactory().scimGroup.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

/**
 * Pick the right ScimGroup repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getScimGroupsRepository(store: StoredScimGroup[]): Repository<StoredScimGroup> {
  return hasDatabase()
    ? prismaScimGroupsRepository()
    : jsonScimGroupsRepository(store);
}
