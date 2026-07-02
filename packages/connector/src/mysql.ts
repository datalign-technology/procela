// MySQL / MariaDB source adapter. Discovers tables and views in
// the configured schemas, reads approximate row counts + last
// update timestamps + table comments from information_schema.
//
// Returns a flat list of ReportedAsset rows the connector ships to
// Procela's /connectors/report endpoint. No data values cross the
// wire — only catalog metadata.

import mysql from 'mysql2/promise';
import type { MysqlSource, ReportedAsset } from './types';

// MySQL's own system schemas — never surface these as user assets.
// `mysql` holds users/privileges/timezones; `sys` is the schema
// object browser layer; `information_schema` and `performance_
// schema` are the introspection views themselves.
const SYSTEM_SCHEMAS = new Set(['mysql', 'sys', 'information_schema', 'performance_schema']);

/** Scan one MySQL source. Opens a single-shot connection, runs one
 *  catalog query, closes. Errors propagate so the caller can write
 *  the SCAN_FAILED event. */
export async function scanMysql(source: MysqlSource): Promise<ReportedAsset[]> {
  // mysql2 accepts a URL directly. Options like ?ssl=true /
  // ?authPlugins= etc. work in the query string. We keep the
  // handshake single-connection (no pool) because scans are
  // infrequent and a pool of one adds no value.
  const conn = await mysql.createConnection(source.connectionString);
  try {
    // Build the schema filter. If the operator provided a list use
    // it verbatim; otherwise exclude the system schemas so a
    // "scan everything" config doesn't dump 400 rows of mysql/sys
    // internals into the catalog.
    const params: Array<string> = [];
    let schemaClause: string;
    if (source.schemas && source.schemas.length > 0) {
      const marks = source.schemas.map(() => '?').join(', ');
      schemaClause = `t.TABLE_SCHEMA IN (${marks})`;
      params.push(...source.schemas);
    } else {
      const marks = Array.from(SYSTEM_SCHEMAS).map(() => '?').join(', ');
      schemaClause = `t.TABLE_SCHEMA NOT IN (${marks})`;
      params.push(...SYSTEM_SCHEMAS);
    }

    // information_schema.tables carries everything we need in one
    // row per object. Two caveats worth naming:
    //
    //  1. TABLE_ROWS on InnoDB is an *estimate* the storage engine
    //     caches — good enough for a governance dashboard, terrible
    //     for exact-count use cases. That's the tradeoff Procela's
    //     Postgres adapter makes with n_live_tup too, so behaviour
    //     stays consistent across sources.
    //
    //  2. UPDATE_TIME is populated for InnoDB tables since 5.7 but
    //     is NULL for views and for older engines that don't track
    //     it. We treat NULL as "no freshness signal" and let the
    //     backend decide the health-score default.
    const sql = `
      SELECT
        t.TABLE_SCHEMA          AS \`schema\`,
        t.TABLE_NAME            AS \`name\`,
        CASE t.TABLE_TYPE
          WHEN 'BASE TABLE' THEN 'r'
          WHEN 'VIEW'       THEN 'v'
          ELSE 'r'
        END                     AS kind,
        COALESCE(t.TABLE_ROWS, 0) AS row_count,
        t.UPDATE_TIME           AS last_activity,
        NULLIF(t.TABLE_COMMENT, '') AS description
      FROM information_schema.tables t
      WHERE ${schemaClause}
        AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
    `;

    const [rows] = await conn.execute(sql, params);
    const records = rows as Array<{
      schema: string;
      name: string;
      kind: string;
      row_count: number | string;
      last_activity: Date | string | null;
      description: string | null;
    }>;

    return records.map((r): ReportedAsset => {
      // "schema.table" — same identity shape as the Postgres and
      // SQL Server adapters so both catalog upserts and the "Data
      // Assets" list look uniform regardless of which source
      // produced them.
      const name = `${r.schema}.${r.name}`;
      const lastActivity: Date | null = r.last_activity == null
        ? null
        : (r.last_activity instanceof Date ? r.last_activity : new Date(r.last_activity));
      const hasSignal = lastActivity !== null && !isNaN(lastActivity.getTime())
        && lastActivity.getFullYear() > 1971;
      return {
        name,
        systemId: source.systemId,
        description: r.description || `MySQL ${r.kind === 'v' ? 'view' : 'table'} ${name}`,
        rowCount: Number(r.row_count) || 0,
        lastWriteAt: hasSignal ? lastActivity!.toISOString() : undefined,
      };
    });
  } finally {
    await conn.end();
  }
}
