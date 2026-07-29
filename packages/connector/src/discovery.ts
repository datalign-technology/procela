// Pure, database-free discovery helpers shared by every source
// adapter (postgres / mysql / sqlserver). Kept out of the driver
// modules so unit tests can exercise the mapping logic without
// pulling in pg / mysql2 / mssql (and without a live database).
//
// The three adapters each run engine-specific catalog SQL, then
// normalise every row into the same { schema, name, kind,
// row_count, last_activity, description } shape and hand it here.

import type { ReportedAsset } from './types';

/** Canonical asset identity — "schema.table". Using the qualified
 *  name keeps two same-named objects in different schemas from
 *  colliding on upsert, and makes assets from any engine look
 *  uniform in the Procela catalog. */
export function assetName(schema: string, name: string): string {
  return `${schema}.${name}`;
}

/** Human label for an object-kind code (Postgres relkind-style):
 *  'v' = view, 'm' = materialized view, anything else = table. */
export function kindLabel(kind: string): string {
  return kind === 'v' ? 'view' : kind === 'm' ? 'materialized view' : 'table';
}

/** Normalise a raw last-activity value (Date | ISO string | null)
 *  into an ISO freshness timestamp, or undefined when there's no
 *  real signal. Several engines default a never-written table to
 *  NULL or the epoch, so null / unparseable / <= 1971 all count as
 *  "no signal" rather than a misleading 1970 timestamp. */
export function freshnessSignal(raw: Date | string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  if (d.getUTCFullYear() <= 1971) return undefined;
  return d.toISOString();
}

/** The normalised catalog row shape every adapter produces. */
export interface RawCatalogRow {
  schema: string;
  name: string;
  kind: string;
  row_count: number | string;
  last_activity: Date | string | null;
  description: string | null;
}

/** Map a normalised catalog row to the ReportedAsset the connector
 *  ships to /connectors/report. `engine` is the human label used in
 *  the fallback description ("Postgres", "MySQL", "SQL Server").
 *  Only catalog metadata — never row values. */
export function rowToAsset(r: RawCatalogRow, engine: string, systemId?: string): ReportedAsset {
  const name = assetName(r.schema, r.name);
  return {
    name,
    systemId,
    description: r.description || `${engine} ${kindLabel(r.kind)} ${name}`,
    rowCount: Number(r.row_count) || 0,
    lastWriteAt: freshnessSignal(r.last_activity),
  };
}

/** Build the Postgres schema-list SQL fragment. Postgres has no
 *  array binding for this pg_class catalog query, so schema names
 *  are inlined — each is single-quote-escaped ('' ) to prevent SQL
 *  injection via a hostile schema name in the config. An empty /
 *  omitted list falls back to 'public'. */
export function pgSchemaFilter(schemas?: string[]): string {
  if (!schemas || schemas.length === 0) return `'public'`;
  return schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
}
