// SQL column-lineage reconcile engine (auto-lineage, phase 4b).
//
// The column-grain companion to reconcile.ts. Given a batch of SQL statements,
// parse each to column-to-column lineage, resolve the (table, column) refs to
// EXISTING Procela DataAssetColumns by name, and reconcile the resulting edges
// into the ColumnLineageEdge store with `source: 'sql'` — the same idempotent
// upsert-then-prune-by-sourceRef lifecycle the table-level engine uses.
//
// Link-only, like the table engine: a column ref that names no governed asset
// column is counted and skipped, never minted. Side-effect-free except through
// the injected edge store, so it unit-tests with a fake.

import { v4 as uuid } from 'uuid';
import type { ColumnLineageEdge } from '../../routes/data-lineage';
import { parseSqlColumnLineage } from './parse-columns';
import { makeResolver, type AssetLite } from './reconcile';
import type { SqlStatement } from './reconcile';

/** The minimum a column must expose to be a lineage endpoint. */
export interface ColumnLite {
  id: string;
  dataAssetId: string;
  columnName: string;
}

export interface ColumnEdgeStore {
  list(filter?: { orgId?: string }): Promise<ColumnLineageEdge[]>;
  create(row: ColumnLineageEdge): Promise<ColumnLineageEdge>;
  update(id: string, patch: Partial<ColumnLineageEdge>): Promise<ColumnLineageEdge | null>;
  delete(id: string): Promise<boolean>;
}

export interface ReconcileSqlColumnLineageInput {
  orgId: string;
  statements: SqlStatement[];
  /** The org's assets (to resolve table refs → asset ids). */
  assets: AssetLite[];
  /** The columns of those assets (to resolve column refs → column ids). */
  columns: ColumnLite[];
  edges: ColumnEdgeStore;
  now?: string;
}

export interface SqlColumnLineageSummary {
  statementsParsed: number;
  edgesCreated: number;
  edgesTouched: number;
  edgesRemoved: number;
  /** Column refs that named no governed column (skipped). */
  unresolvedColumns: number;
}

/**
 * Reconcile SQL-derived column-lineage edges for one org. Idempotent:
 * re-running refreshes `lastSeenAt`; edges no longer produced by any statement
 * in the batch are pruned (scoped to `source: 'sql'`).
 */
export async function reconcileSqlColumnLineage(
  input: ReconcileSqlColumnLineageInput,
): Promise<SqlColumnLineageSummary> {
  const { orgId, statements, assets, columns, edges } = input;
  const now = input.now ?? new Date().toISOString();

  const resolveTable = makeResolver(assets);
  // (assetId, columnName) → columnId. First wins on duplicate names.
  const colByKey = new Map<string, string>();
  const colKey = (assetId: string, columnName: string) => `${assetId}::${columnName.trim().toLowerCase()}`;
  for (const c of columns) {
    const k = colKey(c.dataAssetId, c.columnName);
    if (!colByKey.has(k)) colByKey.set(k, c.id);
  }

  const existing = (await edges.list()).filter((e) => e.orgId === orgId && e.source === 'sql');
  const byRef = new Map<string, ColumnLineageEdge>();
  for (const e of existing) if (e.sourceRef) byRef.set(e.sourceRef, e);

  const declaredKeys = new Set<string>();
  const unresolved = new Set<string>();
  let statementsParsed = 0;
  let edgesCreated = 0;
  let edgesTouched = 0;

  for (const st of statements) {
    const parsed = parseSqlColumnLineage(st.sql, {
      defaultCatalog: st.defaultCatalog,
      defaultSchema: st.defaultSchema,
      dialect: 'snowflake',
    });
    if (parsed.columns.length > 0) statementsParsed++;
    if (!parsed.target) continue;
    const targetAssetId = resolveTable(parsed.target);
    if (!targetAssetId) continue; // target asset ungoverned → table engine already counts it

    for (const colLin of parsed.columns) {
      const targetColumnId = colByKey.get(colKey(targetAssetId, colLin.targetColumn));
      if (!targetColumnId) { unresolved.add(`${targetAssetId}.${colLin.targetColumn.toLowerCase()}`); continue; }

      for (const src of colLin.sources) {
        if (!src.table) { unresolved.add(`?.${src.column.toLowerCase()}`); continue; }
        const sourceAssetId = resolveTable(src.table);
        if (!sourceAssetId) { unresolved.add(`?.${src.column.toLowerCase()}`); continue; }
        const sourceColumnId = colByKey.get(colKey(sourceAssetId, src.column));
        if (!sourceColumnId) { unresolved.add(`${sourceAssetId}.${src.column.toLowerCase()}`); continue; }
        if (sourceColumnId === targetColumnId) continue; // self-reference

        const ref = `sqlcol:${sourceColumnId}->${targetColumnId}`;
        if (declaredKeys.has(ref)) continue;
        declaredKeys.add(ref);

        const found = byRef.get(ref);
        if (found) {
          await edges.update(found.id, { lastSeenAt: now, sourceColumnId, targetColumnId });
          edgesTouched++;
        } else {
          await edges.create({
            id: uuid(),
            orgId,
            sourceColumnId,
            targetColumnId,
            source: 'sql',
            sourceRef: ref,
            lastSeenAt: now,
            createdAt: now,
          });
          edgesCreated++;
        }
      }
    }
  }

  // Prune sql column edges no longer produced by any statement in this batch.
  let edgesRemoved = 0;
  for (const e of existing) {
    if (!e.sourceRef || !declaredKeys.has(e.sourceRef)) {
      await edges.delete(e.id);
      edgesRemoved++;
    }
  }

  return { statementsParsed, edgesCreated, edgesTouched, edgesRemoved, unresolvedColumns: unresolved.size };
}
