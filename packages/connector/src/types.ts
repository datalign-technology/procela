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
   *  supports only Postgres. */
  sources: PostgresSource[];
  /** Agent self-reported version string. */
  agentVersion?: string;
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

export interface ReportedAsset {
  name: string;
  systemId?: string;
  description?: string;
  rowCount?: number;
  lastWriteAt?: string;
}

export interface PairClaimResponse {
  success: boolean;
  data?: { connectorId: string; token: string };
  error?: string;
}

export interface ReportResponse {
  success: boolean;
  data?: { created: number; updated: number; total: number };
  error?: string;
}
