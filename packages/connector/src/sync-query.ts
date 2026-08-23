// Pure SELECT construction + row normalization for agent-push sync jobs.
// Mirrors the backend's lib/db-source/sql.ts (the two packages don't share
// code) so a table-scan built here is identical to a direct-connect one: the
// same identifier validation closes the injection boundary, the same LIMIT vs
// SQL Server TOP dialect, and the same string coercion of cell values.

export type SyncEngine = 'POSTGRESQL' | 'MYSQL' | 'SQLSERVER';

export const DEFAULT_ROW_LIMIT = 1000;
export const MAX_ROW_LIMIT = 50_000;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function assertIdentifier(kind: string, value: string): string {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid ${kind} identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

export function clampLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_ROW_LIMIT;
  return Math.max(1, Math.min(MAX_ROW_LIMIT, Math.floor(limit)));
}

function quoteIdent(engine: SyncEngine, ident: string): string {
  switch (engine) {
    case 'POSTGRESQL': return `"${ident}"`;
    case 'MYSQL': return `\`${ident}\``;
    case 'SQLSERVER': return `[${ident}]`;
  }
}

function qualifiedName(engine: SyncEngine, schema: string | undefined, table: string): string {
  const t = quoteIdent(engine, assertIdentifier('table', table));
  if (schema && schema.trim()) {
    return `${quoteIdent(engine, assertIdentifier('schema', schema))}.${t}`;
  }
  return t;
}

export interface SelectSpec {
  schema?: string;
  table?: string;
  query?: string;
  limit?: number;
}

/** Build the SELECT for a job. A raw `query` is returned verbatim (trusted
 *  admin SQL). Otherwise a `SELECT * FROM <table>` with the engine's row cap. */
export function buildSelectSql(engine: SyncEngine, spec: SelectSpec): string {
  const raw = spec.query?.trim();
  if (raw) return raw;

  if (!spec.table || !spec.table.trim()) {
    throw new Error('sync job has neither a table nor a query');
  }
  const target = qualifiedName(engine, spec.schema, spec.table.trim());
  const n = clampLimit(spec.limit);
  if (engine === 'SQLSERVER') return `SELECT TOP (${n}) * FROM ${target}`;
  return `SELECT * FROM ${target} LIMIT ${n}`;
}

/** Coerce one engine cell to the string shape the backend sync engine
 *  consumes (null/undefined → '', Date → ISO, Buffer/object → text). */
export function normalizeValue(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function normalizeRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  return out;
}
