// SQL → column-to-column lineage parser (auto-lineage, phase 4).
//
// Given one SQL statement, this extracts, for each column the statement writes,
// which upstream column(s) it derives from — the finer-grained companion to the
// table-level parser in parse.ts. Later phases resolve these refs to Procela
// DataAssetColumns and persist them as column-level lineage edges.
//
// Column lineage needs the parse tree (which output expression maps to which
// input columns), so this is AST-only: it uses node-sql-parser's `astify` and
// walks the SELECT projection. Statements the parser can't handle (MERGE,
// vendor-specific syntax) simply yield no column lineage — table-level lineage
// from parse.ts still covers them. `SELECT *` projections are skipped too: the
// output columns can't be enumerated without the source schema.
//
// Side-effect-free and never throws: SQL text in, column refs out.

import { Parser } from 'node-sql-parser';
import type { TableRef, ParseOptions } from './parse';

/** A specific column of a specific table (table unresolved until asset
 *  resolution). `table` is null when the source table couldn't be determined
 *  (e.g. an unqualified column with more than one FROM table). */
export interface ColumnRef {
  table: TableRef | null;
  column: string;
}

/** One written column and the upstream columns feeding it. */
export interface ColumnLineage {
  /** The written (target) column name. */
  targetColumn: string;
  /** Distinct upstream columns the target derives from. */
  sources: ColumnRef[];
}

export interface ColumnLineageResult {
  /** The table written by the statement, or null when none is resolvable. */
  target: TableRef | null;
  /** Per-target-column lineage. Empty for `SELECT *`, computed columns with no
   *  nameable target, or read-only statements. */
  columns: ColumnLineage[];
  method: 'ast' | 'none';
}

const _parser = new Parser();

function unquote(id: string): string {
  const t = (id ?? '').trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === '`' && t.endsWith('`')) || (t[0] === '[' && t.endsWith(']')))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Build a TableRef from node-sql-parser's `db` + `table` halves, where `db`
 *  may be null, `schema`, or `catalog.schema`. Mirrors parse.ts. */
function refFromParts(dbPart: string | null | undefined, table: string): TableRef | null {
  const name = unquote(table);
  if (!name) return null;
  if (!dbPart) return { name };
  const parts = String(dbPart).split('.').map((p) => unquote(p)).filter((p) => p.length > 0);
  if (parts.length >= 2) return { catalog: parts[parts.length - 2], schema: parts[parts.length - 1], name };
  if (parts.length === 1) return { schema: parts[0], name };
  return { name };
}

/** Build a TableRef from a node-sql-parser table/from entry. Newer builds split
 *  a 3-part name into explicit `catalog` + `schema` fields; older ones cram it
 *  into `db` (which may itself be `catalog.schema`). Prefer the explicit fields. */
function refFromEntry(entry: AnyNode): TableRef | null {
  if (!entry || !entry.table) return null;
  const name = unquote(String(entry.table));
  if (!name) return null;
  if (entry.schema || entry.catalog) {
    return {
      ...(entry.catalog ? { catalog: unquote(String(entry.catalog)) } : {}),
      schema: unquote(String(entry.schema ?? '')) || undefined,
      name,
    };
  }
  return refFromParts(entry.db, entry.table);
}

function applyDefaults(ref: TableRef, opts: ParseOptions): TableRef {
  return {
    catalog: ref.catalog ?? opts.defaultCatalog,
    schema: ref.schema ?? opts.defaultSchema,
    name: ref.name,
  };
}

function tableKey(ref: TableRef): string {
  return [ref.catalog ?? '', ref.schema ?? '', ref.name].map((s) => s.toLowerCase()).join('.');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** Recursively collect every column_ref under an expression node, as
 *  { qualifier, column } pairs. Stars are dropped. */
function collectColumnRefs(node: AnyNode, out: Array<{ qualifier: string | null; column: string }>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectColumnRefs(n, out); return; }
  if (node.type === 'column_ref') {
    const column = unquote(String(node.column ?? ''));
    if (column && column !== '*') {
      out.push({ qualifier: node.table ? unquote(String(node.table)) : null, column });
    }
    return;
  }
  // Walk every child value; this covers binary_expr (left/right), aggr_func and
  // function (args), case/when, cast, nested expr_list, and scalar subqueries.
  for (const k of Object.keys(node)) {
    if (k === 'type') continue;
    collectColumnRefs(node[k], out);
  }
}

/** Extract the SELECT body and target table from a parsed statement.
 *  Returns null for shapes that carry no column projection. */
function selectAndTarget(ast: AnyNode): { select: AnyNode; targetTable: AnyNode | null } | null {
  if (!ast || typeof ast !== 'object') return null;
  if (ast.type === 'insert') {
    return { select: ast.values, targetTable: Array.isArray(ast.table) ? ast.table[0] : ast.table };
  }
  if (ast.type === 'create') {
    const select = ast.query_expr ?? ast.query ?? ast.select ?? null;
    if (!select) return null;
    // CTAS carries the target in `table`; CREATE VIEW carries it in `view`.
    const targetTable = Array.isArray(ast.table) ? ast.table[0]
      : ast.view ? { db: ast.view.db, table: ast.view.view }
      : null;
    return { select, targetTable };
  }
  return null;
}

/**
 * Extract column-to-column lineage from a single SQL statement.
 *
 * Returns `{ target, columns, method }`. `columns` is empty when the projection
 * is `SELECT *`, the statement writes nothing, or the parser can't handle it.
 * Never throws.
 */
export function parseSqlColumnLineage(sql: string, opts: ParseOptions = {}): ColumnLineageResult {
  if (!sql || !sql.trim()) return { target: null, columns: [], method: 'none' };

  let ast: AnyNode = null;
  const dialects = [opts.dialect ?? 'snowflake', 'postgresql', 'transactsql'];
  for (const database of dialects) {
    try {
      ast = _parser.astify(sql, { database });
      break;
    } catch { /* try next dialect */ }
  }
  if (!ast) return { target: null, columns: [], method: 'none' };
  if (Array.isArray(ast)) ast = ast[0];

  const st = selectAndTarget(ast);
  if (!st || !st.select || st.select.type !== 'select' || !Array.isArray(st.select.columns)) {
    return { target: null, columns: [], method: 'none' };
  }
  const select = st.select;

  const target = st.targetTable
    ? (() => { const r = refFromEntry(st.targetTable); return r ? applyDefaults(r, opts) : null; })()
    : null;

  // Map FROM/JOIN aliases (and bare table names) → resolved TableRef.
  const aliasToRef = new Map<string, TableRef>();
  const fromRefs: TableRef[] = [];
  for (const f of (select.from ?? [])) {
    if (!f || !f.table) continue; // subquery-derived tables have no .table
    const ref = refFromEntry(f);
    if (!ref) continue;
    const withDefaults = applyDefaults(ref, opts);
    fromRefs.push(withDefaults);
    if (f.as) aliasToRef.set(unquote(String(f.as)).toLowerCase(), withDefaults);
    aliasToRef.set(ref.name.toLowerCase(), withDefaults); // also key by bare table name
  }
  const soleSource = fromRefs.length === 1 ? fromRefs[0] : null;

  // The INSERT column list (positional target names), when present and free of
  // a `*` projection that would break the alignment.
  const insertCols: string[] | null = ast.type === 'insert' && Array.isArray(ast.columns) && ast.columns.length > 0
    ? ast.columns.map((c: unknown) => unquote(String(c)))
    : null;
  const hasStar = select.columns.some((c: AnyNode) => c?.expr?.column === '*' || c?.column === '*');
  const usePositional = insertCols !== null && !hasStar && insertCols.length === select.columns.length;

  const columns: ColumnLineage[] = [];
  select.columns.forEach((col: AnyNode, i: number) => {
    const expr = col?.expr ?? col;
    if (!expr) return;
    if (expr.type === 'column_ref' && expr.column === '*') return; // star: can't enumerate

    // Target column name: positional insert list → alias → bare column name.
    let targetColumn: string | null = usePositional ? insertCols![i] : null;
    if (!targetColumn && col.as) targetColumn = unquote(String(col.as));
    if (!targetColumn && expr.type === 'column_ref' && expr.column && expr.column !== '*') {
      targetColumn = unquote(String(expr.column));
    }
    if (!targetColumn) return; // a computed column with no nameable target

    const refs: Array<{ qualifier: string | null; column: string }> = [];
    collectColumnRefs(expr, refs);

    const seen = new Set<string>();
    const sources: ColumnRef[] = [];
    for (const r of refs) {
      const table = r.qualifier ? (aliasToRef.get(r.qualifier.toLowerCase()) ?? null) : soleSource;
      const key = `${table ? tableKey(table) : ''}::${r.column.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ table, column: r.column });
    }
    if (sources.length === 0) return; // no resolvable upstream columns → no edge

    columns.push({ targetColumn, sources });
  });

  return { target, columns, method: 'ast' };
}
