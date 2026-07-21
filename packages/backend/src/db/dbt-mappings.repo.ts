// dbt mapping repositories — side tables that let dbt re-imports reuse the
// same Procela asset / data-quality rule.
//
// Both use the composite primary key (orgId, dbtUniqueId), so they share one
// generic org-keyed mapping repository rather than the standard {id} entity
// pattern. See docs/POSTGRES_CUTOVER_PLAN.md (PR 1).

import { saveStore } from '../lib/persistence';
import { getPrisma, hasDatabase } from './prisma';

export interface DbtAssetMappingRow {
  orgId: string;
  dbtUniqueId: string;
  assetId: string;
}

export interface DbtTestMappingRow {
  orgId: string;
  dbtUniqueId: string;
  ruleId: string;
}

export interface OrgKeyedMappingRepository<Row> {
  /** All rows, optionally scoped to an org. */
  list(orgId?: string): Promise<Row[]>;
  /** Create or replace the row for a (orgId, dbtUniqueId) pair. */
  upsert(row: Row): Promise<void>;
  /** Remove the row for a pair. Returns true if one was removed. */
  remove(orgId: string, dbtUniqueId: string): Promise<boolean>;
}

type OrgKeyed = { orgId: string; dbtUniqueId: string };

export function jsonOrgKeyedMappingRepository<Row extends OrgKeyed>(
  store: Row[],
  storeName: string,
): OrgKeyedMappingRepository<Row> {
  return {
    async list(orgId) {
      return orgId ? store.filter((r) => r.orgId === orgId) : [...store];
    },
    async upsert(row) {
      const i = store.findIndex((r) => r.orgId === row.orgId && r.dbtUniqueId === row.dbtUniqueId);
      if (i >= 0) store[i] = row;
      else store.push(row);
      saveStore(storeName, store);
    },
    async remove(orgId, dbtUniqueId) {
      const i = store.findIndex((r) => r.orgId === orgId && r.dbtUniqueId === dbtUniqueId);
      if (i < 0) return false;
      store.splice(i, 1);
      saveStore(storeName, store);
      return true;
    },
  };
}

type CompositeWhere = { where: { orgId_dbtUniqueId: { orgId: string; dbtUniqueId: string } } };

export interface PrismaOrgKeyedDelegate<Row> {
  findMany(arg?: { where?: { orgId?: string } }): Promise<Row[]>;
  upsert(arg: CompositeWhere & { create: Row; update: Record<string, unknown> }): Promise<Row>;
  delete(arg: CompositeWhere): Promise<Row>;
}

export function prismaOrgKeyedMappingRepository<Row extends OrgKeyed>(
  delegateFactory: () => PrismaOrgKeyedDelegate<Row>,
): OrgKeyedMappingRepository<Row> {
  return {
    async list(orgId) {
      const d = delegateFactory();
      return orgId ? d.findMany({ where: { orgId } }) : d.findMany();
    },
    async upsert(row) {
      await delegateFactory().upsert({
        where: { orgId_dbtUniqueId: { orgId: row.orgId, dbtUniqueId: row.dbtUniqueId } },
        create: row,
        update: { ...row },
      });
    },
    async remove(orgId, dbtUniqueId) {
      try {
        await delegateFactory().delete({ where: { orgId_dbtUniqueId: { orgId, dbtUniqueId } } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

/**
 * Pick the right dbt-asset-mapping repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getDbtAssetMappingsRepository(
  store: DbtAssetMappingRow[],
): OrgKeyedMappingRepository<DbtAssetMappingRow> {
  return hasDatabase()
    ? prismaOrgKeyedMappingRepository<DbtAssetMappingRow>(
        () =>
          (getPrisma() as unknown as {
            dbtAssetMapping: PrismaOrgKeyedDelegate<DbtAssetMappingRow>;
          }).dbtAssetMapping,
      )
    : jsonOrgKeyedMappingRepository(store, 'dbtAssetMappings');
}

/**
 * Pick the right dbt-test-mapping repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getDbtTestMappingsRepository(
  store: DbtTestMappingRow[],
): OrgKeyedMappingRepository<DbtTestMappingRow> {
  return hasDatabase()
    ? prismaOrgKeyedMappingRepository<DbtTestMappingRow>(
        () =>
          (getPrisma() as unknown as {
            dbtTestMapping: PrismaOrgKeyedDelegate<DbtTestMappingRow>;
          }).dbtTestMapping,
      )
    : jsonOrgKeyedMappingRepository(store, 'dbtTestMappings');
}
