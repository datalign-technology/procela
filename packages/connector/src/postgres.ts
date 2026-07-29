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
import { pgSchemaFilter, rowToAsset, attachColumns, type RawCatalogRow, type RawColumnRow } from './discovery';

/** Scan one Postgres source. Opens a fresh connection, runs two
 *  queries (catalog + stats), closes. Errors propagate so the
 *  caller can write the SCAN_FAILED event. */
export async function scanPostgres(source: PostgresSource): Promise<ReportedAsset[]> {
  const client = new Client({ connectionString: source.connectionString });
  await client.connect();
  try {
    const schemaList = pgSchemaFilter(source.schemas);

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

    // "schema.table" identity, freshness signal, and description
    // fallback are shared across all adapters — see ./discovery.
    const assets = res.rows.map((r): ReportedAsset =>
      rowToAsset(r as RawCatalogRow, 'Postgres', source.systemId));

    // Column-level metadata from the SQL-standard information_schema.
    // Names + types only — never values. One extra query for the whole
    // scope; attachColumns groups it back onto the assets.
    const colsSql = `
      SELECT
        table_schema      AS schema,
        table_name        AS "table",
        column_name       AS column,
        data_type         AS data_type,
        is_nullable       AS is_nullable,
        ordinal_position  AS ordinal
      FROM information_schema.columns
      WHERE table_schema IN (${schemaList})
      ORDER BY table_schema, table_name, ordinal_position
    `;
    const colRes = await client.query(colsSql);
    attachColumns(assets, colRes.rows as RawColumnRow[]);
    return assets;
  } finally {
    await client.end();
  }
}
