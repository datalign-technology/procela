// Postgres source adapter. Discovers tables and views in the
// configured schemas, fetches each one's approximate row count
// (n_live_tup from pg_stat_user_tables — exact-count COUNT(*) on
// big tables is too expensive for a routine scan), and the last-
// vacuum/analyze timestamp as a freshness proxy.
//
// Returns a flat list of ReportedAsset rows the connector ships to
// Procela's /connectors/report endpoint. No data values cross the
// wire — only catalog metadata.

import { Client } from 'pg';
import type { PostgresSource, ReportedAsset } from './types';

const DEFAULT_SCHEMA_FILTER = `'public'`;

/** Scan one Postgres source. Opens a fresh connection, runs two
 *  queries (catalog + stats), closes. Errors propagate so the
 *  caller can write the SCAN_FAILED event. */
export async function scanPostgres(source: PostgresSource): Promise<ReportedAsset[]> {
  const client = new Client({ connectionString: source.connectionString });
  await client.connect();
  try {
    const schemaList = (source.schemas && source.schemas.length > 0)
      ? source.schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')
      : DEFAULT_SCHEMA_FILTER;

    // Tables + views with their description and column count. Joins
    // pg_class to pg_namespace to filter by schema name and to the
    // stats view for freshness signals. obj_description() is the
    // canonical way to pull table comments.
    const sql = `
      SELECT
        n.nspname        AS schema,
        c.relname        AS name,
        c.relkind        AS kind,
        COALESCE(s.n_live_tup, 0) AS row_count,
        GREATEST(
          COALESCE(s.last_autoanalyze, 'epoch'),
          COALESCE(s.last_analyze,     'epoch'),
          COALESCE(s.last_vacuum,      'epoch'),
          COALESCE(s.last_autovacuum,  'epoch')
        )                                AS last_activity,
        obj_description(c.oid, 'pg_class') AS description
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relkind IN ('r', 'v', 'm')           -- regular table, view, materialized view
        AND n.nspname IN (${schemaList})
      ORDER BY n.nspname, c.relname
    `;
    const res = await client.query(sql);

    return res.rows.map((r): ReportedAsset => {
      // We use "schema.table" as the canonical asset name so two
      // tables with the same name in different schemas don't
      // collide on upsert.
      const name = `${r.schema}.${r.name}`;
      // last_activity is epoch when nothing has ever vacuumed —
      // treat that as "no signal" rather than a 1970 timestamp.
      const lastActivity: Date | null = r.last_activity instanceof Date
        ? r.last_activity
        : new Date(r.last_activity);
      const hasSignal = lastActivity && lastActivity.getFullYear() > 1971;
      return {
        name,
        systemId: source.systemId,
        description: r.description || `Postgres ${r.kind === 'v' ? 'view' : r.kind === 'm' ? 'materialized view' : 'table'} ${name}`,
        rowCount: Number(r.row_count) || 0,
        lastWriteAt: hasSignal ? lastActivity!.toISOString() : undefined,
      };
    });
  } finally {
    await client.end();
  }
}
