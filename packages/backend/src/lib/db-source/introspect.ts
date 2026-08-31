// Cloud-side schema introspection for direct-connect DATABASE connections.
//
// This is the real-discovery path: instead of returning illustrative sample
// assets, it runs engine-specific catalog SQL through the same driver layer
// the live sync uses (fetchDbRows with a raw `query`), then groups the flat
// rows into { name, type, columns } assets the Connections UI can import.
//
// The SQL builders and the grouping are kept PURE (no driver, no live DB) so
// they unit-test without pg / mysql2 / mssql / oracledb — mirroring the split
// in sql.ts. Only discoverDbSchema() touches a real connection.

import { fetchDbRows } from './index';
import type { DbSourceRequest, DbSourceType, SourceRow } from './types';

/** Bound the catalog scan so a huge schema can't return an unbounded payload. */
export const MAX_DISCOVERED_TABLES = 2000;
export const MAX_DISCOVERED_COLUMNS = 20000;

export interface DiscoveredAsset {
  name: string;
  type: 'TABLE' | 'VIEW';
  columns: string[];
}

/** Default catalog scope per engine when the connection didn't set a schema.
 *  MySQL has no schema separate from the database, so the caller passes the
 *  database name as the scope. */
export function defaultSchema(dbType: DbSourceType, database: string): string {
  switch (dbType) {
    case 'POSTGRESQL': return 'public';
    case 'SQLSERVER': return 'dbo';
    case 'MYSQL': return database;
    case 'ORACLE': return ''; // resolved to the connecting user below
  }
}

/** Single-quote-escape a value for safe inclusion in a SQL string literal.
 *  The catalog filters compare against a string literal (schema/owner name),
 *  not an identifier, so doubling embedded quotes is the injection boundary. */
export function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build the table/view list query for a schema. Returns rows of
 * (table_name, table_type). Bounded by MAX_DISCOVERED_TABLES.
 */
export function buildTableListSql(dbType: DbSourceType, schema: string): string {
  const s = escapeLiteral(schema);
  switch (dbType) {
    case 'POSTGRESQL':
    case 'MYSQL':
      return `SELECT table_name, table_type FROM information_schema.tables `
        + `WHERE table_schema = '${s}' AND table_type IN ('BASE TABLE', 'VIEW') `
        + `ORDER BY table_name LIMIT ${MAX_DISCOVERED_TABLES}`;
    case 'SQLSERVER':
      return `SELECT TOP (${MAX_DISCOVERED_TABLES}) table_name, table_type FROM information_schema.tables `
        + `WHERE table_schema = '${s}' AND table_type IN ('BASE TABLE', 'VIEW') `
        + `ORDER BY table_name`;
    case 'ORACLE': {
      // Oracle has no information_schema; all_tables / all_views split the two
      // object kinds. owner defaults to the connecting user when unset.
      const owner = s ? `UPPER('${s}')` : 'USER';
      return `SELECT table_name, 'BASE TABLE' AS table_type FROM all_tables WHERE owner = ${owner} `
        + `UNION ALL SELECT view_name AS table_name, 'VIEW' AS table_type FROM all_views WHERE owner = ${owner} `
        + `ORDER BY table_name FETCH FIRST ${MAX_DISCOVERED_TABLES} ROWS ONLY`;
    }
  }
}

/**
 * Build the column list query for a schema. Returns rows of
 * (table_name, column_name, ordinal_position). Bounded by MAX_DISCOVERED_COLUMNS.
 */
export function buildColumnListSql(dbType: DbSourceType, schema: string): string {
  const s = escapeLiteral(schema);
  switch (dbType) {
    case 'POSTGRESQL':
    case 'MYSQL':
      return `SELECT table_name, column_name, ordinal_position FROM information_schema.columns `
        + `WHERE table_schema = '${s}' ORDER BY table_name, ordinal_position LIMIT ${MAX_DISCOVERED_COLUMNS}`;
    case 'SQLSERVER':
      return `SELECT TOP (${MAX_DISCOVERED_COLUMNS}) table_name, column_name, ordinal_position FROM information_schema.columns `
        + `WHERE table_schema = '${s}' ORDER BY table_name, ordinal_position`;
    case 'ORACLE': {
      const owner = s ? `UPPER('${s}')` : 'USER';
      return `SELECT table_name, column_name, column_id AS ordinal_position FROM all_tab_columns `
        + `WHERE owner = ${owner} ORDER BY table_name, column_id FETCH FIRST ${MAX_DISCOVERED_COLUMNS} ROWS ONLY`;
    }
  }
}

/** Read a field from a normalized row case-insensitively — Postgres lower-cases
 *  unquoted aliases while Oracle upper-cases them. */
export function pickField(row: SourceRow, key: string): string {
  if (row[key] !== undefined) return row[key];
  if (row[key.toUpperCase()] !== undefined) return row[key.toUpperCase()];
  if (row[key.toLowerCase()] !== undefined) return row[key.toLowerCase()];
  return '';
}

/**
 * Group flat catalog rows into assets. Pure: the driver runs the two queries,
 * this turns them into the { name, type, columns } shape. Column rows whose
 * table isn't in the table list are ignored (a view/table filtered out above).
 */
export function groupAssets(tableRows: SourceRow[], columnRows: SourceRow[]): DiscoveredAsset[] {
  const assets = new Map<string, DiscoveredAsset>();
  for (const r of tableRows) {
    const name = pickField(r, 'table_name');
    if (!name) continue;
    const rawType = pickField(r, 'table_type').toUpperCase();
    assets.set(name, { name, type: rawType.includes('VIEW') ? 'VIEW' : 'TABLE', columns: [] });
  }
  for (const r of columnRows) {
    const table = pickField(r, 'table_name');
    const column = pickField(r, 'column_name');
    if (!table || !column) continue;
    const asset = assets.get(table);
    if (asset) asset.columns.push(column);
  }
  return [...assets.values()];
}

/**
 * Run real schema introspection against a live database and return the
 * discovered assets. Throws on connection / auth / query failure so the caller
 * can surface a real error (fail-loud — never a silent fallback to samples).
 */
export async function discoverDbSchema(req: DbSourceRequest): Promise<DiscoveredAsset[]> {
  const schema = (req.schema && req.schema.trim()) || defaultSchema(req.dbType, req.database);
  const tableRows = await fetchDbRows({ ...req, table: undefined, query: buildTableListSql(req.dbType, schema) });
  const columnRows = await fetchDbRows({ ...req, table: undefined, query: buildColumnListSql(req.dbType, schema) });
  return groupAssets(tableRows, columnRows);
}
