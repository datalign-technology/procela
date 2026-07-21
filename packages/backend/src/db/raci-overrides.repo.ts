// RaciOverride repository — manual RACI cell overrides.
//
// Composite primary key (nodeId, personId); no orgId (scope is implied by the
// node). Doesn't fit the standard {id} entity repository, so it exposes the
// verbs its consumer actually uses: list, upsert, remove.
// See docs/POSTGRES_CUTOVER_PLAN.md (PR 1).

import { saveStore } from '../lib/persistence';
import { getPrisma, hasDatabase } from './prisma';

export interface RaciOverrideRow {
  nodeId: string;
  personId: string;
  value: string; // R, A, C, I
  reason?: string;
}

export interface RaciOverridesRepository {
  /** All overrides (consumers filter by node in-memory). */
  list(): Promise<RaciOverrideRow[]>;
  /** Create or replace the override for a (nodeId, personId) pair. */
  upsert(row: RaciOverrideRow): Promise<void>;
  /** Remove the override for a pair. Returns true if one was removed. */
  remove(nodeId: string, personId: string): Promise<boolean>;
}

export function jsonRaciOverridesRepository(store: RaciOverrideRow[]): RaciOverridesRepository {
  return {
    async list() {
      return [...store];
    },
    async upsert(row) {
      const i = store.findIndex((o) => o.nodeId === row.nodeId && o.personId === row.personId);
      if (i >= 0) store[i] = row;
      else store.push(row);
      saveStore('raciOverrides', store);
    },
    async remove(nodeId, personId) {
      const i = store.findIndex((o) => o.nodeId === nodeId && o.personId === personId);
      if (i < 0) return false;
      store.splice(i, 1);
      saveStore('raciOverrides', store);
      return true;
    },
  };
}

type CompositeWhere = { where: { nodeId_personId: { nodeId: string; personId: string } } };

export interface PrismaRaciOverrideDelegate {
  findMany(): Promise<RaciOverrideRow[]>;
  upsert(arg: CompositeWhere & { create: Record<string, unknown>; update: Record<string, unknown> }): Promise<RaciOverrideRow>;
  delete(arg: CompositeWhere): Promise<RaciOverrideRow>;
}

export function prismaRaciOverridesRepository(
  clientFactory: () => { raciOverride: PrismaRaciOverrideDelegate } =
    getPrisma as unknown as () => { raciOverride: PrismaRaciOverrideDelegate },
): RaciOverridesRepository {
  return {
    async list() {
      const rows = await clientFactory().raciOverride.findMany();
      return rows.map((r) => ({
        nodeId: r.nodeId,
        personId: r.personId,
        value: r.value,
        reason: r.reason ?? undefined,
      }));
    },
    async upsert(row) {
      const data: Record<string, unknown> = {
        nodeId: row.nodeId,
        personId: row.personId,
        value: row.value,
        reason: row.reason ?? null,
      };
      await clientFactory().raciOverride.upsert({
        where: { nodeId_personId: { nodeId: row.nodeId, personId: row.personId } },
        create: data,
        update: { value: row.value, reason: row.reason ?? null },
      });
    },
    async remove(nodeId, personId) {
      try {
        await clientFactory().raciOverride.delete({ where: { nodeId_personId: { nodeId, personId } } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

/**
 * Pick the right RaciOverride repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getRaciOverridesRepository(store: RaciOverrideRow[]): RaciOverridesRepository {
  return hasDatabase()
    ? prismaRaciOverridesRepository()
    : jsonRaciOverridesRepository(store);
}
