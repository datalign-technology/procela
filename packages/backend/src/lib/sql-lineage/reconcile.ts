// SQL-lineage reconcile engine (auto-lineage, phase 2).
//
// Given a batch of SQL statements (from a warehouse's query history), parse each
// to table-to-table lineage, resolve the tables to EXISTING Procela DataAssets
// by name, and reconcile the resulting edges into the AssetLineageEdge store
// with `source: 'sql'` — the same idempotent upsert-then-prune-by-sourceRef
// lifecycle the dbt importer uses, so dbt and sql edges never clobber each other.
//
// Link-only by design: unlike the dbt importer, this does NOT create assets for
// unmatched table names. Query history references whatever a warehouse ran;
// minting an asset per raw table name would spam the catalog. Refs that don't
// resolve to a governed asset are counted and skipped, so lineage stays tied to
// the catalog. Side-effect-free except through the injected edge store, which
// makes it unit-testable with a fake.

import { v4 as uuid } from 'uuid';
import type { AssetLineageEdge } from '../../routes/data-lineage';
import { parseSqlLineage, type TableRef } from './parse';

/** One statement to attribute, with the session's default catalog/schema so
 *  unqualified table names resolve the same way the warehouse resolved them. */
export interface SqlStatement {
  sql: string;
  defaultCatalog?: string;
  defaultSchema?: string;
}

/** The minimum an asset must expose to be a lineage endpoint. */
export interface AssetLite {
  id: string;
  name: string;
}

/** The slice of the edge repository this engine needs — the real
 *  Repository<AssetLineageEdge> satisfies it structurally, and a test can pass
 *  a trivial fake. */
export interface EdgeStore {
  list(filter?: { orgId?: string }): Promise<AssetLineageEdge[]>;
  create(row: AssetLineageEdge): Promise<AssetLineageEdge>;
  update(id: string, patch: Partial<AssetLineageEdge>): Promise<AssetLineageEdge | null>;
  delete(id: string): Promise<boolean>;
}

export interface ReconcileSqlLineageInput {
  orgId: string;
  statements: SqlStatement[];
  /** The org's existing DataAssets — the only tables edges can attach to. */
  assets: AssetLite[];
  edges: EdgeStore;
  /** Injectable clock for deterministic tests. */
  now?: string;
}

export interface SqlLineageSummary {
  /** Statements that produced any target or source (i.e. were understood). */
  statementsParsed: number;
  edgesCreated: number;
  edgesTouched: number;
  edgesRemoved: number;
  /** Distinct table refs that named no governed asset (skipped). */
  unresolvedRefs: number;
}

function refKey(ref: TableRef): string {
  return `${ref.catalog ?? ''}.${ref.schema ?? ''}.${ref.name}`.toLowerCase();
}

/** Resolve a parsed table ref to an existing asset id by name, trying the most
 *  qualified form first. Assets are commonly named `schema.table` (the dbt
 *  importer's convention) or bare `table`, so we try both plus the fully
 *  qualified `catalog.schema.table`. */
export function makeResolver(assets: AssetLite[]): (ref: TableRef) => string | null {
  const byName = new Map<string, string>();
  for (const a of assets) {
    const k = a.name.trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, a.id); // first wins on duplicate names
  }
  return (ref: TableRef): string | null => {
    const candidates: string[] = [];
    if (ref.catalog && ref.schema) candidates.push(`${ref.catalog}.${ref.schema}.${ref.name}`);
    if (ref.schema) candidates.push(`${ref.schema}.${ref.name}`);
    candidates.push(ref.name);
    for (const c of candidates) {
      const hit = byName.get(c.trim().toLowerCase());
      if (hit) return hit;
    }
    return null;
  };
}

/**
 * Reconcile SQL-derived lineage edges for one org. Idempotent: re-running with
 * the same statements refreshes `lastSeenAt`; edges no longer produced by any
 * statement in the batch are pruned (scoped to `source: 'sql'`, so dbt and
 * manual edges are untouched).
 */
export async function reconcileSqlLineage(input: ReconcileSqlLineageInput): Promise<SqlLineageSummary> {
  const { orgId, statements, assets, edges } = input;
  const now = input.now ?? new Date().toISOString();
  const resolve = makeResolver(assets);

  const existing = (await edges.list()).filter((e) => e.orgId === orgId && e.source === 'sql');
  const byRef = new Map<string, AssetLineageEdge>();
  for (const e of existing) if (e.sourceRef) byRef.set(e.sourceRef, e);

  const declaredKeys = new Set<string>();
  const unresolved = new Set<string>();
  let statementsParsed = 0;
  let edgesCreated = 0;
  let edgesTouched = 0;

  for (const st of statements) {
    const parsed = parseSqlLineage(st.sql, {
      defaultCatalog: st.defaultCatalog,
      defaultSchema: st.defaultSchema,
      dialect: 'snowflake',
    });
    if (parsed.target || parsed.sources.length > 0) statementsParsed++;
    if (!parsed.target) continue;

    const targetId = resolve(parsed.target);
    if (!targetId) { unresolved.add(refKey(parsed.target)); continue; }

    for (const src of parsed.sources) {
      const sourceId = resolve(src);
      if (!sourceId) { unresolved.add(refKey(src)); continue; }
      if (sourceId === targetId) continue;
      const ref = `sql:${sourceId}->${targetId}`;
      if (declaredKeys.has(ref)) continue;
      declaredKeys.add(ref);

      const found = byRef.get(ref);
      if (found) {
        await edges.update(found.id, { lastSeenAt: now, sourceAssetId: sourceId, targetAssetId: targetId });
        edgesTouched++;
      } else {
        await edges.create({
          id: uuid(),
          orgId,
          sourceAssetId: sourceId,
          targetAssetId: targetId,
          source: 'sql',
          sourceRef: ref,
          lastSeenAt: now,
          createdAt: now,
        });
        edgesCreated++;
      }
    }
  }

  // Prune sql edges no longer produced by any statement in this batch.
  let edgesRemoved = 0;
  for (const e of existing) {
    if (!e.sourceRef || !declaredKeys.has(e.sourceRef)) {
      await edges.delete(e.id);
      edgesRemoved++;
    }
  }

  return { statementsParsed, edgesCreated, edgesTouched, edgesRemoved, unresolvedRefs: unresolved.size };
}
