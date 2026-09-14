// SQL → table-to-table lineage parser (auto-lineage, phase 1).
//
// Given one SQL statement (as it appears in a warehouse's query history), this
// extracts the WRITE target and the READ sources — the coarse table-to-table
// lineage that later phases resolve to Procela DataAssets and persist as
// AssetLineageEdge rows (source: 'sql'), the same shape the dbt importer writes.
//
// It is deliberately vendor-neutral and side-effect-free: SQL text in, table
// refs out. Two extraction paths:
//   • AST    — node-sql-parser's tableList, used when the statement parses.
//              Accurate classification of target vs source and subquery nesting.
//   • heuristic — a regex fallback for statements node-sql-parser rejects
//              (notably MERGE) or warehouse-specific syntax. Comments and string
//              literals are neutralized first so a "FROM" inside a string can't
//              masquerade as a source.
// Both paths exclude CTE names from sources and apply the caller's default
// catalog/schema to unqualified refs so downstream asset resolution has the
// fullest name available.

import { Parser } from 'node-sql-parser';

export interface TableRef {
  catalog?: string;
  schema?: string;
  name: string;
}

export interface SqlLineageResult {
  /** The table written by the statement, or null for a read-only statement
   *  (a bare SELECT) or one with no resolvable target. No target → no edge. */
  target: TableRef | null;
  /** Distinct tables read, excluding CTE names and the target itself. */
  sources: TableRef[];
  /** Which path produced the result — for observability + tests. */
  method: 'ast' | 'heuristic' | 'none';
}

export interface ParseOptions {
  /** Applied to refs that name no catalog (Snowflake database). */
  defaultCatalog?: string;
  /** Applied to refs that name no schema. */
  defaultSchema?: string;
  /** node-sql-parser dialect to try first (default: snowflake, then postgresql). */
  dialect?: string;
}

const _parser = new Parser();

function unquote(id: string): string {
  const t = id.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === '`' && t.endsWith('`')) || (t[0] === '[' && t.endsWith(']')))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Strip comments and blank the contents of string literals, so the heuristic
 *  and CTE scanners can't be fooled by SQL keywords appearing inside them. */
function neutralize(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // block comments
    .replace(/--[^\n]*/g, ' ')               // line comments (-- …)
    .replace(/(^|\s)\/\/[^\n]*/g, '$1 ')      // Snowflake // line comments
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''");  // single-quoted string literals
}

/** CTE names declared anywhere in the statement (`WITH x AS (`, `, y AS (`).
 *  Case-folded. Used to keep CTE references out of the source list. */
function cteNames(neutralSql: string): Set<string> {
  const names = new Set<string>();
  const re = /(?:\bwith\b|,)\s+("?[A-Za-z_][\w$]*"?|`[^`]+`|\[[^\]]+\])\s+as\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(neutralSql)) !== null) names.add(unquote(m[1]).toLowerCase());
  return names;
}

/** Build a TableRef from a dotted name (`a`, `a.b`, `a.b.c`), last part = table. */
function refFromDotted(raw: string): TableRef | null {
  const parts = raw.split('.').map((p) => unquote(p)).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const name = parts[parts.length - 1];
  if (!name) return null;
  if (parts.length >= 3) return { catalog: parts[parts.length - 3], schema: parts[parts.length - 2], name };
  if (parts.length === 2) return { schema: parts[0], name };
  return { name };
}

/** Build a TableRef from node-sql-parser's `db::table` halves, where `db` may be
 *  null, `schema`, or `catalog.schema`. */
function refFromParts(dbPart: string | null, table: string): TableRef | null {
  const name = unquote(table);
  if (!name) return null;
  if (!dbPart || dbPart === 'null') return { name };
  const parts = dbPart.split('.').map((p) => unquote(p)).filter((p) => p.length > 0);
  if (parts.length >= 2) return { catalog: parts[parts.length - 2], schema: parts[parts.length - 1], name };
  if (parts.length === 1) return { schema: parts[0], name };
  return { name };
}

function applyDefaults(ref: TableRef, opts: ParseOptions): TableRef {
  return {
    catalog: ref.catalog ?? opts.defaultCatalog,
    schema: ref.schema ?? opts.defaultSchema,
    name: ref.name,
  };
}

function keyOf(ref: TableRef): string {
  return [ref.catalog ?? '', ref.schema ?? '', ref.name].map((s) => s.toLowerCase()).join('.');
}

/** Dedup, drop the target, apply defaults. */
function finalizeSources(raw: TableRef[], target: TableRef | null, ctes: Set<string>, opts: ParseOptions): TableRef[] {
  const targetKey = target ? keyOf(applyDefaults(target, opts)) : null;
  const seen = new Set<string>();
  const out: TableRef[] = [];
  for (const r of raw) {
    // A CTE reference is unqualified and matches a declared CTE name.
    if (!r.catalog && !r.schema && ctes.has(r.name.toLowerCase())) continue;
    const withDefaults = applyDefaults(r, opts);
    const k = keyOf(withDefaults);
    if (k === targetKey) continue; // self-reference (e.g. INSERT INTO t SELECT FROM t)
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(withDefaults);
  }
  return out;
}

const WRITE_OPS = new Set(['insert', 'update', 'delete', 'replace', 'create']);

/** AST path: node-sql-parser tableList → target + sources. Returns null if the
 *  statement doesn't parse under any tried dialect. */
function parseViaAst(sql: string, ctes: Set<string>, opts: ParseOptions): SqlLineageResult | null {
  const dialects = [opts.dialect ?? 'snowflake', 'postgresql', 'transactsql'];
  let list: string[] | null = null;
  for (const database of dialects) {
    try {
      list = _parser.tableList(sql, { database });
      break;
    } catch {
      /* try next dialect */
    }
  }
  if (!list) return null;

  let target: TableRef | null = null;
  const sources: TableRef[] = [];
  for (const entry of list) {
    // format: `${op}::${db}::${table}` — db may itself contain a dot.
    const firstSep = entry.indexOf('::');
    const lastSep = entry.lastIndexOf('::');
    if (firstSep < 0 || lastSep === firstSep) continue;
    const op = entry.slice(0, firstSep).toLowerCase();
    const dbPart = entry.slice(firstSep + 2, lastSep);
    const table = entry.slice(lastSep + 2);
    const ref = refFromParts(dbPart, table);
    if (!ref) continue;
    if (op === 'select') sources.push(ref);
    else if (WRITE_OPS.has(op) && !target) target = ref;
  }

  return {
    target: target ? applyDefaults(target, opts) : null,
    sources: finalizeSources(sources, target, ctes, opts),
    method: 'ast',
  };
}

const IDENT = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)';
const REF = `${IDENT}(?:\\.${IDENT}){0,2}`;

const TARGET_PATTERNS: RegExp[] = [
  new RegExp(`\\binsert\\s+(?:overwrite\\s+)?into\\s+(${REF})`, 'i'),
  new RegExp(`\\binsert\\s+overwrite\\s+(?:table\\s+)?(${REF})`, 'i'),
  new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:transient\\s+|temp(?:orary)?\\s+|global\\s+|local\\s+|volatile\\s+|external\\s+|secure\\s+)*(?:table|view|materialized\\s+view)\\s+(?:if\\s+not\\s+exists\\s+)?(${REF})`, 'i'),
  new RegExp(`\\bmerge\\s+into\\s+(${REF})`, 'i'),
  new RegExp(`\\bupdate\\s+(${REF})`, 'i'),
  new RegExp(`\\bdelete\\s+from\\s+(${REF})`, 'i'),
];

/** Heuristic path: regex over neutralized SQL. Catches MERGE and statements
 *  node-sql-parser can't parse. */
function parseViaHeuristic(neutralSql: string, ctes: Set<string>, opts: ParseOptions): SqlLineageResult {
  let target: TableRef | null = null;
  for (const re of TARGET_PATTERNS) {
    const m = re.exec(neutralSql);
    if (m) { target = refFromDotted(m[1]); break; }
  }

  const sources: TableRef[] = [];
  // FROM / JOIN clauses (also covers subqueries anywhere in the text).
  const fromJoin = new RegExp(`\\b(?:from|join)\\s+(${REF})`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = fromJoin.exec(neutralSql)) !== null) {
    const ref = refFromDotted(m[1]);
    if (ref) sources.push(ref);
  }
  // MERGE ... USING <table> (JOIN ... USING (cols) is excluded by the `(` guard).
  const usingRe = new RegExp(`\\busing\\s+(${REF})(?!\\s*\\()`, 'gi');
  while ((m = usingRe.exec(neutralSql)) !== null) {
    const ref = refFromDotted(m[1]);
    if (ref) sources.push(ref);
  }

  return {
    target: target ? applyDefaults(target, opts) : null,
    sources: finalizeSources(sources, target, ctes, opts),
    method: 'heuristic',
  };
}

/**
 * Extract table-to-table lineage from a single SQL statement.
 *
 * Returns `{ target, sources, method }`. A read-only statement (bare SELECT) or
 * unparseable input yields `target: null` and no meaningful sources → the caller
 * produces no edge. Never throws.
 */
export function parseSqlLineage(sql: string, opts: ParseOptions = {}): SqlLineageResult {
  if (!sql || !sql.trim()) return { target: null, sources: [], method: 'none' };
  const neutral = neutralize(sql);
  const ctes = cteNames(neutral);

  // Prefer the AST when the statement parses cleanly; fall back to the regex
  // heuristic (MERGE, dialect-specific syntax, etc.).
  const ast = parseViaAst(sql, ctes, opts);
  if (ast && (ast.target || ast.sources.length > 0)) return ast;

  const heuristic = parseViaHeuristic(neutral, ctes, opts);
  if (heuristic.target || heuristic.sources.length > 0) return heuristic;

  return { target: null, sources: [], method: 'none' };
}
