// Oracle source adapter. Discovers tables and views in the configured
// schemas (owners), reads approximate row counts (all_tables.num_rows,
// the optimizer-stats estimate — like Postgres's n_live_tup), a
// freshness proxy (last_analyzed), and table comments. Columns come
// from all_tab_columns.
//
// Uses oracledb in thin mode — pure JavaScript, no Oracle Instant
// Client required in the image. Returns a flat list of ReportedAsset
// rows; no data values cross the wire, only catalog metadata.

import oracledb from 'oracledb';
import type { OracleSource, ReportedAsset } from './types';
import { rowToAsset, attachColumns, type RawCatalogRow, type RawColumnRow } from './discovery';

/** Parse an `oracle://user:pass@host:port/service` connection string into
 *  the { user, password, connectString } shape oracledb.getConnection
 *  wants. The path segment is the service name (or SID); port defaults
 *  to 1521. Pure — unit-testable without a database. */
export function parseOracleConnectionString(cs: string): { user: string; password: string; connectString: string } {
  let u: URL;
  try {
    u = new URL(cs);
  } catch {
    throw new Error(`invalid Oracle connectionString (expected oracle://user:pass@host:port/service): ${cs}`);
  }
  const service = u.pathname.replace(/^\//, '');
  const port = u.port || '1521';
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    connectString: `${u.hostname}:${port}/${service}`,
  };
}

/** Build the owner (schema) filter + its bind variables. An explicit
 *  list is uppercased (Oracle owners are uppercase) and bound as
 *  :s0, :s1, …; an empty list defaults to the connecting user's own
 *  schema (`owner = USER`). Pure — bind-parameterised so a hostile
 *  schema name can't inject. */
export function oracleOwnerFilter(schemas?: string[]): { clause: string; binds: Record<string, string> } {
  if (schemas && schemas.length > 0) {
    const binds: Record<string, string> = {};
    const names = schemas.map((s, i) => {
      binds[`s${i}`] = s.toUpperCase();
      return `:s${i}`;
    });
    return { clause: `owner IN (${names.join(', ')})`, binds };
  }
  return { clause: 'owner = USER', binds: {} };
}

/** Scan one Oracle source. Opens a thin-mode connection, runs a catalog
 *  query (tables ∪ views) and a column query, closes. Errors propagate
 *  so the caller writes the SCAN_FAILED event. */
export async function scanOracle(source: OracleSource): Promise<ReportedAsset[]> {
  const { user, password, connectString } = parseOracleConnectionString(source.connectionString);
  const { clause, binds } = oracleOwnerFilter(source.schemas);
  const conn = await oracledb.getConnection({ user, password, connectString });
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  try {
    // Quoted lowercase aliases so oracledb returns keys that match the
    // shared RawCatalogRow shape (schema/name/kind/row_count/…).
    const tablesSql = `
      SELECT owner AS "schema", table_name AS "name", 'r' AS "kind",
             COALESCE(num_rows, 0) AS "row_count", last_analyzed AS "last_activity",
             (SELECT comments FROM all_tab_comments c
               WHERE c.owner = t.owner AND c.table_name = t.table_name) AS "description"
      FROM all_tables t
      WHERE ${clause}
      UNION ALL
      SELECT owner AS "schema", view_name AS "name", 'v' AS "kind",
             0 AS "row_count", CAST(NULL AS DATE) AS "last_activity",
             (SELECT comments FROM all_tab_comments c
               WHERE c.owner = v.owner AND c.table_name = v.view_name) AS "description"
      FROM all_views v
      WHERE ${clause}
      ORDER BY "schema", "name"
    `;
    const tRes = await conn.execute(tablesSql, binds, opts);
    const assets = ((tRes.rows || []) as RawCatalogRow[]).map((r) =>
      rowToAsset(r, 'Oracle', source.systemId));

    const colsSql = `
      SELECT owner AS "schema", table_name AS "table", column_name AS "column",
             data_type AS "data_type", nullable AS "is_nullable", column_id AS "ordinal"
      FROM all_tab_columns
      WHERE ${clause}
      ORDER BY owner, table_name, column_id
    `;
    const cRes = await conn.execute(colsSql, binds, opts);
    attachColumns(assets, (cRes.rows || []) as RawColumnRow[]);
    return assets;
  } finally {
    await conn.close();
  }
}
