// Snowflake query-history fetch for auto-lineage (phase 2).
//
// Reads write-shaped statements from SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY so
// the SQL-lineage engine can derive table-to-table edges from what actually ran
// in the warehouse. Reuses the SnowflakeSourceRequest + connection pattern from
// snowflake-introspect. The QUERY_HISTORY view lives in the SNOWFLAKE database
// and is fully qualified here, so the connection's current database doesn't
// matter — but the role must carry IMPORTED PRIVILEGES on SNOWFLAKE (a fetch
// failure surfaces loudly rather than silently returning nothing).
//
// buildQueryHistorySql is PURE (no driver) so it unit-tests without
// snowflake-sdk; only fetchSnowflakeQueryHistory opens a real connection.

import type { SnowflakeSourceRequest } from './snowflake-introspect';

const CONNECT_TIMEOUT_MS = 20_000;

export interface QueryHistoryOptions {
  /** Look-back window in days (1–365, default 7). */
  days?: number;
  /** Max statements to pull (1–10000, default 1000). */
  limit?: number;
}

export interface QueryHistoryRow {
  queryText: string;
  database?: string;
  schema?: string;
}

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 1000;
const MAX_DAYS = 365;
const MAX_LIMIT = 10_000;

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}

/**
 * Build the ACCOUNT_USAGE.QUERY_HISTORY query. `days` and `limit` are the only
 * interpolated values and are clamped to safe integer ranges (never bound
 * params — Snowflake doesn't accept binds inside DATEADD's interval or LIMIT).
 * Restricts to successful, write-shaped statements — the ones that carry
 * lineage. Columns are aliased to lower-case so the driver returns predictable
 * keys.
 */
export function buildQueryHistorySql(opts: QueryHistoryOptions = {}): string {
  const days = clampInt(opts.days, DEFAULT_DAYS, 1, MAX_DAYS);
  const limit = clampInt(opts.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  return (
    `SELECT query_text AS "query_text", database_name AS "database_name", schema_name AS "schema_name" ` +
    `FROM snowflake.account_usage.query_history ` +
    `WHERE execution_status = 'SUCCESS' ` +
    `AND start_time >= DATEADD(day, -${days}, CURRENT_TIMESTAMP()) ` +
    `AND query_type IN ('INSERT','CREATE_TABLE_AS_SELECT','MERGE','UPDATE','DELETE','CREATE_VIEW','CREATE_MATERIALIZED_VIEW') ` +
    `ORDER BY start_time DESC ` +
    `LIMIT ${limit}`
  );
}

/**
 * Fetch recent write statements from a live Snowflake account. Throws on
 * connection / auth / query failure (fail-loud). snowflake-sdk is imported
 * lazily so this module — and buildQueryHistorySql — load without it.
 */
export async function fetchSnowflakeQueryHistory(
  req: SnowflakeSourceRequest,
  opts: QueryHistoryOptions = {},
): Promise<QueryHistoryRow[]> {
  if (!req.account) throw new Error('Snowflake source is missing an account');
  if (!req.username) throw new Error('Snowflake source is missing a username');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ns: any = await import('snowflake-sdk');
  const snowflake = ns.default ?? ns;
  const connection = snowflake.createConnection({
    account: req.account,
    username: req.username,
    password: req.password,
    warehouse: req.warehouse,
    database: req.database,
    role: req.role,
    timeout: CONNECT_TIMEOUT_MS,
    application: 'Procela',
  });

  await new Promise<void>((resolve, reject) => {
    connection.connect((err: unknown) => (err ? reject(err) : resolve()));
  });

  const run = (sqlText: string): Promise<Array<Record<string, unknown>>> =>
    new Promise((resolve, reject) => {
      connection.execute({
        sqlText,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        complete: (err: unknown, _stmt: unknown, rows: Array<Record<string, unknown>>) => {
          if (err) return reject(err);
          resolve(rows || []);
        },
      });
    });

  try {
    const rows = await run(buildQueryHistorySql(opts));
    return rows
      .map((r) => ({
        queryText: String(r['query_text'] ?? ''),
        database: r['database_name'] ? String(r['database_name']) : undefined,
        schema: r['schema_name'] ? String(r['schema_name']) : undefined,
      }))
      .filter((r) => r.queryText.trim().length > 0);
  } finally {
    await new Promise<void>((resolve) => {
      try { connection.destroy(() => resolve()); } catch { resolve(); }
    });
  }
}
