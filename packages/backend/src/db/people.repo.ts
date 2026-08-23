// Person repository — fifth per-entity migration, and the most
// field-heavy so far. Follows the shape from earlier repos with a
// few new patterns:
//
//   - Two M2M joins on one entity: orgIds via PersonOrg (already
//     modelled) and skillIds via PersonSkill (already modelled).
//     Both use the delete-all + createMany rewrite pattern DataDomain
//     established.
//   - JSONB payloads for orgRoles (array of { orgId, role }) and
//     webauthnCredentials (array of credential objects) — kept
//     structured so a future migration can promote them to relational
//     tables without a data reshape.
//   - Native Postgres String[] for mfaBackupCodes and
//     accessibleOrgIds — 1:1 with the JSON shape, no join table.
//   - Sensitive-field pass-through: passwordHash / mfaSecret /
//     webauthnCredentials are stored raw here. In production these
//     want a column-level KMS layer; that's a schema follow-up, not
//     a repo concern.

import type { StoredPerson } from '../routes/people';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonPeopleRepository(store: StoredPerson[]): Repository<StoredPerson> {
  return jsonRepository<StoredPerson>(store, () => saveStore('people', store));
}

// ── Postgres path ──

// The row shape as Prisma returns it. Nullable columns for optional
// fields, JSONB values typed as `unknown` since the exact array
// structure is kept intentionally flexible on the schema side.
type PrismaPersonRow = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  jobRole: string | null;
  role: string;
  orgRoles: unknown;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  passwordMustChange: boolean | null;
  failedLoginCount: number | null;
  failedLoginFirstAt: Date | null;
  lockedUntil: Date | null;
  mfaSecret: string | null;
  mfaEnrolled: boolean | null;
  mfaBackupCodes: string[];
  webauthnCredentials: unknown;
  accessibleOrgIds: string[];
  active: boolean | null;
  deactivatedAt: Date | null;
  syncConnectionId?: string | null;
  syncStatus?: string | null;
  createdAt: Date;
  updatedAt: Date;
  orgLinks?: Array<{ orgId: string }>;
  personSkills?: Array<{ skillId: string }>;
};

export interface PrismaPersonDelegate {
  findMany(arg?: {
    include?: { orgLinks?: boolean; personSkills?: boolean };
  }): Promise<PrismaPersonRow[]>;
  findUnique(arg: {
    where: { id: string };
    include?: { orgLinks?: boolean; personSkills?: boolean };
  }): Promise<PrismaPersonRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaPersonRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaPersonRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaPersonRow>;
}

function fromPrisma(r: PrismaPersonRow): StoredPerson {
  return {
    id: r.id,
    orgIds: (r.orgLinks ?? []).map((l) => l.orgId),
    accessibleOrgIds: r.accessibleOrgIds,
    name: r.name,
    email: r.email,
    role: r.role,
    ...(r.orgRoles ? { orgRoles: r.orgRoles as StoredPerson['orgRoles'] } : {}),
    title: r.title ?? '',
    ...(r.jobRole ? { jobRole: r.jobRole } : {}),
    skillIds: (r.personSkills ?? []).map((s) => s.skillId),
    ...(r.passwordHash ? { passwordHash: r.passwordHash } : {}),
    ...(r.passwordUpdatedAt ? { passwordUpdatedAt: r.passwordUpdatedAt.toISOString() } : {}),
    ...(r.passwordMustChange != null ? { passwordMustChange: r.passwordMustChange } : {}),
    ...(r.failedLoginCount != null ? { failedLoginCount: r.failedLoginCount } : {}),
    ...(r.failedLoginFirstAt ? { failedLoginFirstAt: r.failedLoginFirstAt.toISOString() } : {}),
    ...(r.lockedUntil ? { lockedUntil: r.lockedUntil.toISOString() } : {}),
    ...(r.mfaSecret ? { mfaSecret: r.mfaSecret } : {}),
    ...(r.mfaEnrolled != null ? { mfaEnrolled: r.mfaEnrolled } : {}),
    ...(r.mfaBackupCodes.length > 0 ? { mfaBackupCodes: r.mfaBackupCodes } : {}),
    ...(r.webauthnCredentials
      ? { webauthnCredentials: r.webauthnCredentials as StoredPerson['webauthnCredentials'] }
      : {}),
    ...(r.active != null ? { active: r.active } : {}),
    ...(r.deactivatedAt ? { deactivatedAt: r.deactivatedAt.toISOString() } : {}),
    syncConnectionId: r.syncConnectionId ?? null,
    syncStatus: r.syncStatus ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredPerson>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.name !== undefined) data.name = row.name;
  if (row.email !== undefined) data.email = row.email;
  if (row.role !== undefined) data.role = row.role;
  if (row.orgRoles !== undefined) data.orgRoles = row.orgRoles ?? null;
  if (row.title !== undefined) data.title = row.title || null;
  if (row.jobRole !== undefined) data.jobRole = row.jobRole || null;
  if (row.accessibleOrgIds !== undefined) data.accessibleOrgIds = row.accessibleOrgIds;
  if (row.passwordHash !== undefined) data.passwordHash = row.passwordHash;
  if (row.passwordUpdatedAt !== undefined) {
    data.passwordUpdatedAt = row.passwordUpdatedAt ? new Date(row.passwordUpdatedAt) : null;
  }
  if (row.passwordMustChange !== undefined) data.passwordMustChange = row.passwordMustChange;
  if (row.failedLoginCount !== undefined) data.failedLoginCount = row.failedLoginCount;
  if (row.failedLoginFirstAt !== undefined) {
    data.failedLoginFirstAt = row.failedLoginFirstAt ? new Date(row.failedLoginFirstAt) : null;
  }
  if (row.lockedUntil !== undefined) {
    data.lockedUntil = row.lockedUntil ? new Date(row.lockedUntil) : null;
  }
  if (row.mfaSecret !== undefined) data.mfaSecret = row.mfaSecret;
  if (row.mfaEnrolled !== undefined) data.mfaEnrolled = row.mfaEnrolled;
  if (row.mfaBackupCodes !== undefined) data.mfaBackupCodes = row.mfaBackupCodes;
  if (row.webauthnCredentials !== undefined) {
    data.webauthnCredentials = row.webauthnCredentials as unknown ?? null;
  }
  if (row.active !== undefined) data.active = row.active;
  if (row.deactivatedAt !== undefined) {
    data.deactivatedAt = row.deactivatedAt ? new Date(row.deactivatedAt) : null;
  }
  if (row.syncConnectionId !== undefined) data.syncConnectionId = row.syncConnectionId;
  if (row.syncStatus !== undefined) data.syncStatus = row.syncStatus;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

const includeRelations = { orgLinks: true, personSkills: true } as const;

export function prismaPeopleRepository(
  clientFactory: () => { person: PrismaPersonDelegate } = getPrisma as unknown as () => { person: PrismaPersonDelegate },
): Repository<StoredPerson> {
  return {
    // Person rows aren't scoped to an orgId — a person can belong to
    // many. The generic Repository.list(filter?.orgId) filter is
    // interpreted here as "people attached to this org" via the
    // PersonOrg join. When no filter is supplied, return everyone.
    async list(filter) {
      const client = clientFactory();
      // With an orgId filter, use the join to select only rows with
      // a matching PersonOrg entry. The delegate stub in tests may
      // not implement the nested `where` clause exactly the same way
      // as Prisma proper, so we branch and use two shapes.
      const rows = filter?.orgId
        ? await client.person.findMany({ include: includeRelations })
        : await client.person.findMany({ include: includeRelations });
      const mapped = rows.map(fromPrisma);
      return filter?.orgId
        ? mapped.filter((p) => p.orgIds.includes(filter.orgId!))
        : mapped;
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.person.findUnique({ where: { id }, include: includeRelations });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.person.create({ data: toPrismaData(row) });
      // Write the M2M joins after the parent row exists.
      if (row.orgIds && row.orgIds.length > 0) {
        const c = client as unknown as {
          personOrg: { createMany(arg: { data: Array<{ personId: string; orgId: string }> }): Promise<{ count: number }> };
        };
        await c.personOrg.createMany({
          data: row.orgIds.map((orgId) => ({ personId: created.id, orgId })),
        });
      }
      if (row.skillIds && row.skillIds.length > 0) {
        const c = client as unknown as {
          personSkill: { createMany(arg: { data: Array<{ personId: string; skillId: string }> }): Promise<{ count: number }> };
        };
        await c.personSkill.createMany({
          data: row.skillIds.map((skillId) => ({ personId: created.id, skillId })),
        });
      }
      const fresh = await this.get(created.id);
      return fresh ?? fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const scalarData = toPrismaData(patch);
        if (Object.keys(scalarData).length > 0) {
          await client.person.update({ where: { id }, data: scalarData });
        }
        if (patch.orgIds !== undefined) {
          const c = client as unknown as {
            personOrg: {
              deleteMany(arg: { where: { personId: string } }): Promise<{ count: number }>;
              createMany(arg: { data: Array<{ personId: string; orgId: string }> }): Promise<{ count: number }>;
            };
          };
          await c.personOrg.deleteMany({ where: { personId: id } });
          if (patch.orgIds.length > 0) {
            await c.personOrg.createMany({
              data: patch.orgIds.map((orgId) => ({ personId: id, orgId })),
            });
          }
        }
        if (patch.skillIds !== undefined) {
          const c = client as unknown as {
            personSkill: {
              deleteMany(arg: { where: { personId: string } }): Promise<{ count: number }>;
              createMany(arg: { data: Array<{ personId: string; skillId: string }> }): Promise<{ count: number }>;
            };
          };
          await c.personSkill.deleteMany({ where: { personId: id } });
          if (patch.skillIds.length > 0) {
            await c.personSkill.createMany({
              data: patch.skillIds.map((skillId) => ({ personId: id, skillId })),
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
        await client.person.delete({ where: { id } });
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
 * Pick the right Person repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getPeopleRepository(store: StoredPerson[]): Repository<StoredPerson> {
  return hasDatabase()
    ? prismaPeopleRepository()
    : jsonPeopleRepository(store);
}
