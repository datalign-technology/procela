// Shared type shapes for the connector. Mirrors what the backend
// expects on the report endpoint — kept here as a small,
// self-contained set rather than importing from the backend so the
// connector binary doesn't drag the whole API package along.

export interface ConnectorConfig {
  /** Procela base URL — what the connector dials home to.
   *  e.g. https://api.procela.io or http://host.docker.internal:3001/api/v1 */
  procelaUrl: string;
  /** Connector token issued at pairing time. Required for steady-
   *  state operation; for the first run a `pairingCode` is provided
   *  instead and the connector exchanges it for a token. */
  token?: string;
  /** One-time pairing code. After successful exchange the connector
   *  rewrites its config with the resulting token and removes the
   *  pairing code. v1: rewrite is best-effort; the operator can
   *  also paste the token in manually after seeing it in stdout. */
  pairingCode?: string;
  /** Steady-state heartbeat cadence in seconds. */
  heartbeatSeconds: number;
  /** Steady-state scan cadence in seconds. Usually much longer than
   *  heartbeats — a heartbeat is "I'm alive", a scan is "here's
   *  what I see". */
  scanSeconds: number;
  /** Sources to scan. Each entry is one logical data source. v1
   *  supports Postgres and SQL Server; more to follow. */
  sources: Source[];
  /** Agent self-reported version string. */
  agentVersion?: string;
  /** File the loop touches every heartbeat so a container liveness
   *  probe (`--healthcheck`) can tell the agent is progressing. */
  livenessFile?: string;
  /** How stale (seconds) the liveness file may get before the probe
   *  reports unhealthy. Defaults to max(3 × heartbeat, 180s). */
  livenessMaxStaleSeconds?: number;
}

/** Discriminated union of every source shape the connector knows
 *  how to scan. Callers switch on `type`. */
export type Source = PostgresSource | SqlServerSource | MysqlSource | DbtSource | OracleSource;

export interface OracleSource {
  type: 'oracle';
  /** Friendly name shown in logs. */
  name: string;
  /** Connection string in the URL form:
   *    oracle://procela_ro:pw@db.internal:1521/ORCLPDB1
   *  The path segment is the service name (or SID). Runs in oracledb's
   *  thin mode — no Oracle Instant Client required. Stays on-prem in the
   *  config file; never sent to Procela. */
  connectionString: string;
  /** Optional schema (owner) allowlist — case-insensitive, matched
   *  against Oracle's uppercase owners. Empty = scan the connecting
   *  user's own schema (`owner = USER`). */
  schemas?: string[];
  /** Optional explicit Procela systemId this source's assets attach to.
   *  If omitted the connector's first declared system id is used. */
  systemId?: string;
}

export interface DbtSource {
  type: 'dbt';
  /** Friendly name shown in logs. */
  name: string;
  /** Path to a dbt `manifest.json` on disk (produced by `dbt compile`
   *  / `dbt run`). Read locally — no database connection, no network to
   *  dbt. e.g. /project/target/manifest.json */
  manifestPath: string;
  /** Optional explicit Procela systemId this source's assets attach to.
   *  If omitted the connector's first declared system id is used. */
  systemId?: string;
}

export interface PostgresSource {
  type: 'postgres';
  /** Friendly name shown in logs. */
  name: string;
  /** Connection string. Stays on-prem in the config file; never
   *  sent to Procela. */
  connectionString: string;
  /** Optional schema allowlist. Empty = scan public + every non-
   *  system schema. */
  schemas?: string[];
  /** Optional explicit Procela systemId this source's assets get
   *  attached to. If omitted the connector's first declared system
   *  id is used. */
  systemId?: string;
}

export interface MysqlSource {
  type: 'mysql';
  /** Friendly name shown in logs. */
  name: string;
  /** Connection string in the mysql2 URL form:
   *    mysql://procela_ro:pw@db.internal:3306/mydb?ssl=true
   *  Also supported: any options mysql2 accepts on the query
   *  string. Stays on-prem in the config file; never sent to
   *  Procela. */
  connectionString: string;
  /** Optional schema (database) allowlist. Empty = scan every
   *  non-system schema (skips mysql, sys, information_schema,
   *  performance_schema). */
  schemas?: string[];
  /** Optional explicit Procela systemId this source's assets get
   *  attached to. If omitted the connector's first declared system
   *  id is used. */
  systemId?: string;
}

export interface SqlServerSource {
  type: 'sqlserver';
  /** Friendly name shown in logs. */
  name: string;
  /** Connection string in the mssql URL form:
   *    Server=host,port;Database=db;User Id=user;Password=pw;Encrypt=true
   *  or mssql://user:pass@host:1433/database?encrypt=true
   *  Stays on-prem in the config file; never sent to Procela. */
  connectionString: string;
  /** Optional schema allowlist. Empty = scan every non-system schema
   *  in the connected database. */
  schemas?: string[];
  /** Optional explicit Procela systemId this source's assets get
   *  attached to. If omitted the connector's first declared system
   *  id is used. */
  systemId?: string;
}

export interface ReportedColumn {
  /** Column name (unqualified — the parent asset carries schema.table). */
  name: string;
  /** Engine-reported data type, e.g. "integer", "varchar", "timestamp". */
  dataType?: string;
  /** Whether the column accepts NULL. */
  nullable?: boolean;
  /** 1-based position in the table. */
  ordinal?: number;
}

export interface ReportedAsset {
  name: string;
  systemId?: string;
  description?: string;
  rowCount?: number;
  lastWriteAt?: string;
  /** Column-level metadata (names + types only — never values). Omitted
   *  by older agents; the backend upserts them audit-only when present. */
  columns?: ReportedColumn[];
}

export interface PairClaimResponse {
  success: boolean;
  data?: { connectorId: string; token: string };
  error?: string;
}

export interface ReportResponse {
  success: boolean;
  data?: {
    created: number;
    updated: number;
    total: number;
    columnsCreated?: number;
    columnsUpdated?: number;
  };
  error?: string;
}

// ── Agent-push row sync ──────────────────────────────────────────────────
// The backend defines AGENT-mode syncs and hands the connector a job spec;
// the connector runs the query against a local source and pushes the rows
// back. Only catalog/table coordinates + the mapping cross the wire inbound;
// row values only ever flow outbound to Procela.

export interface AgentSyncJob {
  /** SyncConnection id — the push target. */
  id: string;
  name: string;
  /** organizations | people | systems | business-glossary. */
  targetEntity: string;
  matchKey: string;
  fieldMapping: Record<string, string>;
  dbType?: 'POSTGRESQL' | 'MYSQL' | 'SQLSERVER' | 'ORACLE';
  schema?: string;
  table?: string;
  /** Raw SELECT override; when set, table/schema/limit are ignored. */
  query?: string;
  limit?: number;
  /** Which configured source (by `name`) to run against. When absent the
   *  agent uses its first source whose engine matches `dbType`. */
  sourceName?: string;
  intervalMinutes: number;
  nextRunAt: string | null;
}

export interface SyncJobsResponse {
  success: boolean;
  data?: AgentSyncJob[];
  error?: string;
}

export interface SyncPushResponse {
  success: boolean;
  data?: {
    created: number;
    updated: number;
    skipped: number;
    missingFromSource: number;
    errors: number;
    errorMessages: string[];
  };
  error?: string;
}

/** One rule the backend asks the connector to evaluate on its local source. */
export interface DqPlanEntry {
  ruleId: string;
  table: string;   // discovered "schema.table" (or bare table)
  column: string;
  ruleType: 'NOT_NULL' | 'UNIQUE' | 'IN_SET' | 'NUMERIC_RANGE' | 'LENGTH_RANGE';
  parameters: {
    allowedValues?: string[];
    min?: number; max?: number;
    minLength?: number; maxLength?: number;
  };
  systemId: string | null;
}

/** One measured result the connector pushes back — counts only. */
export interface DqResult {
  ruleId: string;
  totalRows: number;
  passCount: number;
}

export interface DqPlanResponse {
  success: boolean;
  data?: { rules: DqPlanEntry[] };
  error?: string;
}

export interface DqResultsResponse {
  success: boolean;
  data?: { applied: number; skipped: number };
  error?: string;
}
