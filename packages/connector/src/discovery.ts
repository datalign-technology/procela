// Pure, database-free discovery helpers shared by every source
// adapter (postgres / mysql / sqlserver). Kept out of the driver
// modules so unit tests can exercise the mapping logic without
// pulling in pg / mysql2 / mssql (and without a live database).
//
// The three adapters each run engine-specific catalog SQL, then
// normalise every row into the same { schema, name, kind,
// row_count, last_activity, description } shape and hand it here.

import type { ReportedAsset, ReportedColumn } from './types';

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

// ── Column-level discovery ────────────────────────────────────────────────
// All three engines expose a SQL-standard information_schema.columns
// view, so the adapters normalise a column row into this common shape
// and hand it here — same pattern as the table-level RawCatalogRow.

/** A normalised column row from information_schema.columns. */
export interface RawColumnRow {
  schema: string;
  table: string;
  column: string;
  data_type: string | null;
  /** information_schema returns 'YES' / 'NO'; some drivers hand back a
   *  boolean or 1/0 — normalizeNullable copes with all three. */
  is_nullable: string | boolean | number | null;
  ordinal: number | string | null;
}

/** Normalise the assorted is_nullable representations to a boolean.
 *  'YES' / true / 1 => nullable; 'NO' / false / 0 / null => not. */
export function normalizeNullable(v: string | boolean | number | null | undefined): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.trim().toUpperCase() === 'YES' || v.trim() === '1';
  return false;
}

/** Map a raw column row to a ReportedColumn (name + type only, never
 *  values). `ordinal` and `dataType` are dropped when absent so the
 *  payload stays lean. */
export function columnToReported(r: RawColumnRow): ReportedColumn {
  const ordinal = r.ordinal == null ? undefined : Number(r.ordinal);
  return {
    name: r.column,
    dataType: r.data_type || undefined,
    nullable: normalizeNullable(r.is_nullable),
    ...(ordinal !== undefined && !Number.isNaN(ordinal) ? { ordinal } : {}),
  };
}

/** Attach discovered columns to their assets, grouping the flat column
 *  rows by "schema.table" (the asset identity). Columns whose table has
 *  no matching asset are ignored. Returns the same asset array for
 *  chaining. Pure — the adapters run the two queries, then call this. */
export function attachColumns(assets: ReportedAsset[], columnRows: RawColumnRow[]): ReportedAsset[] {
  const byTable = new Map<string, ReportedColumn[]>();
  for (const r of columnRows) {
    const key = assetName(r.schema, r.table);
    const list = byTable.get(key) || [];
    list.push(columnToReported(r));
    byTable.set(key, list);
  }
  for (const a of assets) {
    const cols = byTable.get(a.name);
    if (cols && cols.length > 0) {
      cols.sort((x, y) => (x.ordinal ?? 0) - (y.ordinal ?? 0));
      a.columns = cols;
    }
  }
  return assets;
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
