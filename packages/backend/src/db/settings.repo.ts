// AppSetting repository — a generic global key-value config store.
//
// Backs the former single-row JSON stores (`branding`, `aiSettings`,
// `schedulerState`) that don't fit the standard {id} entity repository.
// Each consumer keeps its own typed value shape; the repository just
// round-trips the value blob under a string key. See
// docs/POSTGRES_CUTOVER_PLAN.md (PR 1).

import { saveStore } from '../lib/persistence';
import { getPrisma, hasDatabase } from './prisma';

/** A row of the JSON-mode `appSettings` store. */
export interface AppSettingRow {
  key: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SettingRepository {
  /** Read a setting's value, or null if the key has never been set. */
  get<T>(key: string): Promise<T | null>;
  /** Create or replace a setting's value. */
  set<T>(key: string, value: T, updatedBy?: string | null): Promise<void>;
}

/** JSON-store implementation over an in-memory `AppSettingRow[]`. */
export function jsonSettingRepository(store: AppSettingRow[]): SettingRepository {
  return {
    async get<T>(key: string): Promise<T | null> {
      const row = store.find((r) => r.key === key);
      return row ? (row.value as T) : null;
    },
    async set<T>(key: string, value: T, updatedBy: string | null = null): Promise<void> {
      const updatedAt = new Date().toISOString();
      const existing = store.find((r) => r.key === key);
      if (existing) {
        existing.value = value;
        existing.updatedAt = updatedAt;
        existing.updatedBy = updatedBy;
      } else {
        store.push({ key, value, updatedAt, updatedBy });
      }
      saveStore('appSettings', store);
    },
  };
}

type PrismaAppSettingRow = { key: string; value: unknown; updatedAt: Date; updatedBy: string | null };

export interface PrismaAppSettingDelegate {
  findUnique(arg: { where: { key: string } }): Promise<PrismaAppSettingRow | null>;
  upsert(arg: {
    where: { key: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<PrismaAppSettingRow>;
}

/** Postgres implementation. `value` maps to a JSONB column. */
export function prismaSettingRepository(
  clientFactory: () => { appSetting: PrismaAppSettingDelegate } =
    getPrisma as unknown as () => { appSetting: PrismaAppSettingDelegate },
): SettingRepository {
  return {
    async get<T>(key: string): Promise<T | null> {
      const row = await clientFactory().appSetting.findUnique({ where: { key } });
      return row ? (row.value as T) : null;
    },
    async set<T>(key: string, value: T, updatedBy: string | null = null): Promise<void> {
      await clientFactory().appSetting.upsert({
        where: { key },
        create: { key, value: value as unknown as object, updatedBy },
        update: { value: value as unknown as object, updatedBy },
      });
    },
  };
}

/**
 * Pick the right setting repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getSettingRepository(store: AppSettingRow[]): SettingRepository {
  return hasDatabase()
    ? prismaSettingRepository()
    : jsonSettingRepository(store);
}
