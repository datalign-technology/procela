// Connector-side data-quality execution. Fetches the rule plan the backend
// computed for this connector's assets, turns each rule into ONE aggregate
// query against the local source, runs it, and pushes back only the counts
// (total rows + passing rows) — never any row values. Those counts land as
// MEASURED results (simulated:false) and drive real asset health.
//
// Design notes:
//  - Only the rule types that push down to a single portable aggregate are
//    handled (NOT_NULL / UNIQUE / IN_SET / NUMERIC_RANGE / LENGTH_RANGE); the
//    backend already limits the plan to these. REGEX/CUSTOM stay off-prem.
//  - Identifiers (schema/table/column) are quoted per dialect; rule *values*
//    (allowed set, range bounds) are always bound as parameters — never
//    interpolated — so a rule definition can't inject SQL.
//  - Pass/fail semantics mirror the file engine (dq-engine.ts): a NULL fails
//    every rule except NOT_NULL (where NULL is the failure), and LENGTH treats
//    NULL as length 0.

import { Client } from 'pg';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import oracledb from 'oracledb';

import type { ConnectorConfig, Source, DqPlanEntry, DqResult } from './types';
import { buildMssqlConfig } from './sqlserver';
import { parseOracleConnectionString } from './oracle';
import { resolveSourceSecrets, type SecretResolvers } from './secrets';
import { fetchDqPlan, pushDqResults } from './api';

export type Dialect = 'postgres' | 'mysql' | 'sqlserver' | 'oracle';

export function dialectFor(sourceType: Source['type']): Dialect | null {
  switch (sourceType) {
    case 'postgres': return 'postgres';
    case 'mysql': return 'mysql';
    case 'sqlserver': return 'sqlserver';
    case 'oracle': return 'oracle';
    default: return null; // dbt has no live database to query
  }
}

function quoteId(dialect: Dialect, id: string): string {
  if (dialect === 'mysql') return '`' + id.replace(/`/g, '``') + '`';
  if (dialect === 'sqlserver') return '[' + id.replace(/]/g, ']]') + ']';
  return '"' + id.replace(/"/g, '""') + '"'; // postgres, oracle
}

function qualifiedTable(dialect: Dialect, name: string): string {
  const i = name.indexOf('.');
  if (i < 0) return quoteId(dialect, name);
  return `${quoteId(dialect, name.slice(0, i))}.${quoteId(dialect, name.slice(i + 1))}`;
}

function placeholder(dialect: Dialect, idx: number): string {
  switch (dialect) {
    case 'postgres': return '$' + (idx + 1);
    case 'oracle': return ':' + (idx + 1);
    case 'sqlserver': return '@p' + idx;
    default: return '?'; // mysql
  }
}

const lengthFn = (dialect: Dialect): string => (dialect === 'sqlserver' ? 'LEN' : 'LENGTH');

/**
 * Build the aggregate query for one rule. Returns `{ sql, params }`, or null
 * when the rule's parameters are missing/invalid (the caller skips it). The
 * query always projects two columns: `total` (row count) and `passes` (rows
 * satisfying the rule).
 */
export function buildAggregateQuery(dialect: Dialect, entry: DqPlanEntry): { sql: string; params: unknown[] } | null {
  const col = quoteId(dialect, entry.column);
  const tbl = qualifiedTable(dialect, entry.table);
  const params: unknown[] = [];
  const ph = () => placeholder(dialect, params.length - 1);
  const passes = (cond: string) => `COALESCE(SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0) AS passes`;

  switch (entry.ruleType) {
    case 'NOT_NULL':
      return { sql: `SELECT COUNT(*) AS total, ${passes(`${col} IS NOT NULL`)} FROM ${tbl}`, params };

    case 'UNIQUE':
      // total = all rows; passes = rows whose value appears exactly once
      // (matches the file engine: every row in a duplicate group fails).
      return {
        sql: `SELECT COALESCE(SUM(cnt), 0) AS total, `
          + `COALESCE(SUM(CASE WHEN cnt = 1 THEN 1 ELSE 0 END), 0) AS passes `
          + `FROM (SELECT ${col} AS v, COUNT(*) AS cnt FROM ${tbl} GROUP BY ${col}) g`,
        params,
      };

    case 'IN_SET': {
      const vals = entry.parameters.allowedValues || [];
      if (vals.length === 0) return null;
      const list = vals.map((v) => { params.push(v); return ph(); }).join(', ');
      return { sql: `SELECT COUNT(*) AS total, ${passes(`${col} IN (${list})`)} FROM ${tbl}`, params };
    }

    case 'NUMERIC_RANGE': {
      const parts: string[] = [];
      if (entry.parameters.min !== undefined) { params.push(entry.parameters.min); parts.push(`${col} >= ${ph()}`); }
      if (entry.parameters.max !== undefined) { params.push(entry.parameters.max); parts.push(`${col} <= ${ph()}`); }
      if (parts.length === 0) return null;
      return { sql: `SELECT COUNT(*) AS total, ${passes(parts.join(' AND '))} FROM ${tbl}`, params };
    }

    case 'LENGTH_RANGE': {
      const len = `COALESCE(${lengthFn(dialect)}(${col}), 0)`;
      const parts: string[] = [];
      if (entry.parameters.minLength !== undefined) { params.push(entry.parameters.minLength); parts.push(`${len} >= ${ph()}`); }
      if (entry.parameters.maxLength !== undefined) { params.push(entry.parameters.maxLength); parts.push(`${len} <= ${ph()}`); }
      if (parts.length === 0) return null;
      return { sql: `SELECT COUNT(*) AS total, ${passes(parts.join(' AND '))} FROM ${tbl}`, params };
    }

    default:
      return null;
  }
}

/** Read the { total, passes } pair from a driver row, tolerating case
 *  (Oracle folds unquoted aliases to upper case) and bigint-as-string. */
function readCounts(row: Record<string, unknown> | undefined): { total: number; passes: number } {
  const pick = (a: string, b: string) => Number((row?.[a] ?? row?.[b] ?? 0) as never) || 0;
  return { total: pick('total', 'TOTAL'), passes: pick('passes', 'PASSES') };
}

/** Run one aggregate against a resolved source and return the counts. Opens
 *  and closes a fresh connection per call — DQ runs on the scan cadence, so
 *  the per-rule connection cost is acceptable and keeps the code simple. */
export async function execAggregate(source: Source, sql: string, params: unknown[]): Promise<{ total: number; passes: number }> {
  switch (source.type) {
    case 'postgres': {
      const c = new Client({ connectionString: source.connectionString });
      await c.connect();
      try { const r = await c.query(sql, params); return readCounts(r.rows[0] as Record<string, unknown>); }
      finally { await c.end(); }
    }
    case 'mysql': {
      const c = await mysql.createConnection(source.connectionString);
      try { const [rows] = await c.execute(sql, params as never[]); return readCounts((rows as Record<string, unknown>[])[0]); }
      finally { await c.end(); }
    }
    case 'sqlserver': {
      const pool = new mssql.ConnectionPool(buildMssqlConfig(source.connectionString) as never);
      await pool.connect();
      try {
        const req = pool.request();
        params.forEach((v, i) => req.input('p' + i, v));
        const r = await req.query(sql);
        return readCounts(r.recordset[0] as Record<string, unknown>);
      } finally { await pool.close(); }
    }
    case 'oracle': {
      const { user, password, connectString } = parseOracleConnectionString(source.connectionString);
      const c = await oracledb.getConnection({ user, password, connectString });
      try {
        const r = await c.execute(sql, params as never, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        return readCounts((r.rows as Record<string, unknown>[])[0]);
      } finally { await c.close(); }
    }
    default:
      throw new Error(`DQ not supported for source type ${source.type}`);
  }
}

/** Pick the configured source that owns a plan entry. Matches on the source's
 *  explicit systemId; if none matches and there is exactly one source, it is
 *  unambiguous. Otherwise the rule is left unmeasured (returns null). */
export function pickSource(sources: Source[], systemId: string | null): Source | null {
  if (systemId) {
    const m = sources.find((s) => s.systemId === systemId);
    if (m) return m;
  }
  const live = sources.filter((s) => dialectFor(s.type));
  return live.length === 1 ? live[0] : null;
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/** Injectable seams so the loop is unit-testable without a live database. */
export interface DqDeps {
  fetchPlan: (cfg: ConnectorConfig) => Promise<DqPlanEntry[]>;
  pushResults: (cfg: ConnectorConfig, results: DqResult[]) => Promise<void>;
  exec: (source: Source, sql: string, params: unknown[]) => Promise<{ total: number; passes: number }>;
}

const defaultDeps: DqDeps = {
  fetchPlan: async (cfg) => {
    const res = await fetchDqPlan(cfg);
    return res.success && res.data ? res.data.rules : [];
  },
  pushResults: async (cfg, results) => { await pushDqResults(cfg, results); },
  exec: execAggregate,
};

/**
 * Fetch the rule plan, evaluate each rule against its local source, and push
 * the measured counts back. Best-effort throughout: a single rule's failure
 * (bad column, permission) is logged and skipped, never aborting the batch.
 */
export async function runDqRules(
  cfg: ConnectorConfig,
  log: Logger,
  resolvers: SecretResolvers,
  deps: DqDeps = defaultDeps,
): Promise<void> {
  let plan: DqPlanEntry[];
  try { plan = await deps.fetchPlan(cfg); }
  catch (err) { log('dq: fetch plan failed', { err: (err as Error)?.message || String(err) }); return; }
  if (!plan.length) return;

  // Group the plan by the source that owns each rule so one resolved source
  // serves all of its rules.
  const bySource = new Map<Source, DqPlanEntry[]>();
  for (const entry of plan) {
    const source = pickSource(cfg.sources, entry.systemId);
    if (!source) { log('dq: no source resolves rule — skipping', { ruleId: entry.ruleId, systemId: entry.systemId }); continue; }
    const list = bySource.get(source) || [];
    list.push(entry);
    bySource.set(source, list);
  }

  const results: DqResult[] = [];
  for (const [rawSource, entries] of bySource) {
    let source: Source;
    try { source = resolveSourceSecrets(rawSource, resolvers); }
    catch (err) { log('dq: secret resolve failed — skipping source', { source: rawSource.name, err: (err as Error)?.message || String(err) }); continue; }
    const dialect = dialectFor(source.type);
    if (!dialect) continue;

    for (const entry of entries) {
      const built = buildAggregateQuery(dialect, entry);
      if (!built) { log('dq: rule params unsupported — skipping', { ruleId: entry.ruleId, ruleType: entry.ruleType }); continue; }
      try {
        const { total, passes } = await deps.exec(source, built.sql, built.params);
        results.push({ ruleId: entry.ruleId, totalRows: total, passCount: passes });
      } catch (err) {
        log('dq: rule execution failed — skipping', { ruleId: entry.ruleId, err: (err as Error)?.message || String(err) });
      }
    }
  }

  if (!results.length) return;
  try { await deps.pushResults(cfg, results); log('dq: results pushed', { count: results.length }); }
  catch (err) { log('dq: push results failed', { err: (err as Error)?.message || String(err) }); }
}
