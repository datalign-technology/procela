// Measured data-quality over a direct-connect database. Turns one rule into a
// single aggregate query, runs it through the live driver layer, and returns a
// MEASURED RuleRunResult (simulated: false) that feeds real asset health — the
// direct-connect equivalent of the on-prem connector's push path.
//
// Only the pushdown-safe rule types are measurable this way; REGEX_MATCH and
// CUSTOM return null so the caller falls back to the file / simulated path.

import { fetchDbRows, SUPPORTED_DB_SOURCE_TYPES } from '../lib/db-source';
import type { DbSourceType } from '../lib/db-source';
import { buildDqAggregateSql } from '../lib/db-source/dq-sql';
import type { RuleRunResult, RuleType, RuleParameters } from './dq-engine';

export interface DbRuleSubject {
  dbType?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  username?: string;
  password?: string;
  /** Physical table (optionally schema.table). */
  table?: string;
  /** Physical column. */
  column?: string;
}

/** True when a rule against this subject can be measured over a live database:
 *  a supported engine, the host/database/credentials a scan needs, a table +
 *  column to target, and a DB-measurable rule type. */
export function canMeasureOverDb(ruleType: RuleType, s: DbRuleSubject): boolean {
  const dbType = String(s.dbType || '').toUpperCase() as DbSourceType;
  return (
    SUPPORTED_DB_SOURCE_TYPES.includes(dbType) &&
    !!s.host && !!s.database && !!s.username && !!s.table && !!s.column &&
    buildDqAggregateSql(dbType, { table: s.table, column: s.column, ruleType, parameters: {} }) !== null
  );
}

/**
 * Measure one rule against a live database. Returns a measured RuleRunResult,
 * or null when the rule can't be measured this way (unsupported type, missing
 * params, or missing connection detail) so the caller uses the simulated path.
 * Throws on a real execution failure (bad host / auth / permission) — the
 * caller decides whether to surface or fall back.
 */
export async function measureRuleOverDb(
  ruleType: RuleType,
  params: RuleParameters,
  s: DbRuleSubject,
): Promise<RuleRunResult | null> {
  const dbType = String(s.dbType || '').toUpperCase() as DbSourceType;
  if (!SUPPORTED_DB_SOURCE_TYPES.includes(dbType)) return null;
  if (!s.host || !s.database || !s.username || !s.table || !s.column) return null;

  const built = buildDqAggregateSql(dbType, { table: s.table, column: s.column, ruleType, parameters: params });
  if (!built) return null;

  const rows = await fetchDbRows({
    dbType,
    host: s.host,
    port: s.port,
    database: s.database,
    schema: s.schema,
    username: s.username,
    password: s.password,
    query: built.sql,
    params: built.params,
  });

  const row = rows[0] || {};
  const num = (k: string) => Number(row[k] ?? row[k.toUpperCase()] ?? 0) || 0;
  const total = num('total');
  const passCount = num('passes');
  const failCount = Math.max(0, total - passCount);
  const passRate = total === 0 ? 100 : Math.round((passCount * 100) / total);

  return {
    ranAt: new Date().toISOString(),
    simulated: false,
    totalRows: total,
    passCount,
    failCount,
    passRate,
    failureSamples: [],
    message: `${passCount}/${total} rows passed (measured against ${s.database})`,
  };
}
