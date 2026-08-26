// Thin HTTP client wrapping the four Procela endpoints the
// connector cares about: pair/claim, heartbeat, report, plus the
// pair/start an admin invokes from the UI (which the connector
// itself never calls). We use native fetch (Node 20+) so the
// container image stays light — no axios, no node-fetch.

import type {
  ConnectorConfig,
  PairClaimResponse,
  ReportResponse,
  ReportedAsset,
  SyncJobsResponse,
  SyncPushResponse,
  DqPlanResponse,
  DqResult,
  DqResultsResponse,
} from './types';

function url(cfg: ConnectorConfig, path: string): string {
  const base = cfg.procelaUrl.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

/** Exchange a pairing code for a long-lived connector token.
 *  On success, the caller should persist `data.token` to its config
 *  so subsequent runs skip pairing. */
export async function pairClaim(cfg: ConnectorConfig, code: string): Promise<PairClaimResponse> {
  const res = await fetch(url(cfg, '/connectors/pair/claim'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, agentVersion: cfg.agentVersion || 'procela-connector/0.1.0' }),
  });
  return res.json();
}

/** Heartbeat ping — let Procela know we're alive. Returns true on
 *  200, false on anything else so the caller can log + back off. */
export async function heartbeat(cfg: ConnectorConfig): Promise<boolean> {
  if (!cfg.token) return false;
  const res = await fetch(url(cfg, '/connectors/heartbeat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ agentVersion: cfg.agentVersion || 'procela-connector/0.1.0' }),
  });
  return res.ok;
}

/** Ship a snapshot of reported assets. Returns the upsert counts
 *  Procela computed (created vs updated) so the caller can log
 *  meaningfully. */
export async function report(cfg: ConnectorConfig, assets: ReportedAsset[]): Promise<ReportResponse> {
  if (!cfg.token) return { success: false, error: 'no token' };
  const res = await fetch(url(cfg, '/connectors/report'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ assets }),
  });
  return res.json();
}

/** Fetch the AGENT-mode syncs this connector is due to run. Returns the
 *  jobs the backend deems due now (schedule-driven, server-side). */
export async function getSyncJobs(cfg: ConnectorConfig): Promise<SyncJobsResponse> {
  if (!cfg.token) return { success: false, error: 'no token' };
  const res = await fetch(url(cfg, '/connectors/sync-jobs'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`sync-jobs HTTP ${res.status}`);
  return res.json();
}

/** Fetch the DQ rules this connector should evaluate on its local sources. */
export async function fetchDqPlan(cfg: ConnectorConfig): Promise<DqPlanResponse> {
  if (!cfg.token) return { success: false, error: 'no token' };
  const res = await fetch(url(cfg, '/connectors/dq-rules'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`dq-rules HTTP ${res.status}`);
  return res.json();
}

/** Push measured rule results (aggregate counts only) back to Procela. */
export async function pushDqResults(cfg: ConnectorConfig, results: DqResult[]): Promise<DqResultsResponse> {
  if (!cfg.token) return { success: false, error: 'no token' };
  const res = await fetch(url(cfg, '/connectors/dq-results'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ results }),
  });
  if (!res.ok) throw new Error(`dq-results HTTP ${res.status}`);
  return res.json();
}

/** Push the rows read for one sync job. The backend upserts them into the
 *  target entity and advances the sync's schedule. */
export async function pushSyncRows(
  cfg: ConnectorConfig,
  jobId: string,
  rows: Record<string, string>[],
): Promise<SyncPushResponse> {
  if (!cfg.token) return { success: false, error: 'no token' };
  const res = await fetch(url(cfg, `/connectors/sync-jobs/${encodeURIComponent(jobId)}/push`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`sync push HTTP ${res.status}`);
  return res.json();
}
