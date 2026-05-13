import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';
import { auditService } from '../services/audit.service';
import { reconcileDbtManifest, DbtImportSummary } from './data-lineage';

// ═══════════════════════════════════════════════════════════════════════════
// DBT CLOUD CONNECTIONS
//
// A saved configuration for fetching the latest manifest.json from dbt
// Cloud and feeding it through the existing manifest reconciler. v1 is
// manual-trigger only - the user hits "Refresh now" and Procela pulls
// the artifact for the most recent successful run of the configured
// job. Scheduled polling can stack on this without changing the data
// model.
//
// Token storage: plain text in the JSON store. That's acceptable for
// the prototype but explicitly flagged on the API response and in the
// commit so the production migration replaces this with a secret
// reference (env var, AWS Secrets Manager, etc).
// ═══════════════════════════════════════════════════════════════════════════

export interface DbtCloudConnection {
  id: string;
  orgId: string;
  name: string;
  /** dbt Cloud API host. Defaults to "cloud.getdbt.com"; customers on
   *  single-tenant deployments override this with their own subdomain. */
  host: string;
  accountId: string;
  jobId: string;
  /** API token. Prototype-only storage; see file header. */
  token: string;
  lastRunAt: string | null;
  lastStatus: 'NEVER' | 'SUCCESS' | 'ERROR';
  lastError: string | null;
  lastSummary: DbtImportSummary | null;
  /** Polling cadence. NEVER (default) = manual-trigger only; the rest
   *  schedule an auto-refresh on the scheduler tick. */
  pollFrequency: 'NEVER' | 'HOURLY' | 'DAILY' | 'WEEKLY';
  /** When the next scheduled poll is due. Null when pollFrequency is
   *  NEVER. Updated after every successful refresh; failures advance
   *  it by the cadence too so a broken connection doesn't hammer the
   *  upstream API. */
  nextPollAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const dbtCloudConnections: DbtCloudConnection[] =
  loadStore<DbtCloudConnection>('dbtCloudConnections');

// Migrate v1 records that lack the polling fields. Defaults to NEVER so
// existing connections aren't surprise-polled after the upgrade.
let migratedDbtCloud = false;
for (const c of dbtCloudConnections) {
  if (c.pollFrequency === undefined) { (c as any).pollFrequency = 'NEVER'; migratedDbtCloud = true; }
  if (c.nextPollAt === undefined) { (c as any).nextPollAt = null; migratedDbtCloud = true; }
}
if (migratedDbtCloud) saveStore('dbtCloudConnections', dbtCloudConnections);

const VALID_POLL_FREQUENCIES = ['NEVER', 'HOURLY', 'DAILY', 'WEEKLY'] as const;
type PollFrequency = typeof VALID_POLL_FREQUENCIES[number];

/** Scheduler interval. Also the "first poll" delay after schedule-on - a
 *  freshly-scheduled connection runs almost immediately rather than
 *  waiting a full cadence. */
const POLL_TICK_MS = 60 * 1000;

/** Roll the nextPollAt timestamp forward by one cadence. Mirrors the
 *  computeNextRunAt helper used for scheduled DQ rules. */
function computeNextPollAt(freq: PollFrequency, from: Date = new Date()): string | null {
  if (freq === 'NEVER') return null;
  const ms =
    freq === 'HOURLY' ? 60 * 60 * 1000 :
    freq === 'DAILY'  ? 24 * 60 * 60 * 1000 :
    freq === 'WEEKLY' ? 7 * 24 * 60 * 60 * 1000 :
    0;
  return new Date(from.getTime() + ms).toISOString();
}

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const router = Router();

// ── Helpers ─────────────────────────────────────────────────────────────

/** Don't ship the bearer token back in normal reads. The create/edit
 *  flow takes the token in the request body; the rest of the app gets
 *  a `hasToken: boolean` so the UI can show a "Reset token" affordance
 *  without leaking the value. */
function publicShape(c: DbtCloudConnection): Omit<DbtCloudConnection, 'token'> & { hasToken: boolean } {
  const { token, ...rest } = c;
  return { ...rest, hasToken: !!token };
}

function requireConn(req: Request, res: Response): DbtCloudConnection | null {
  const c = dbtCloudConnections.find((x) => x.id === req.params.id);
  if (!c) { res.status(404).json({ success: false, error: 'dbt Cloud connection not found' }); return null; }
  return c;
}

// ── Routes ──────────────────────────────────────────────────────────────

/** GET /api/v1/dbt-cloud-connections?orgId= */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query as Record<string, string | undefined>;
  const filtered = orgId ? dbtCloudConnections.filter((c) => c.orgId === orgId) : dbtCloudConnections;
  res.json({ success: true, data: filtered.map(publicShape) });
});

/** POST /api/v1/dbt-cloud-connections */
router.post('/', (req: Request, res: Response) => {
  const { orgId, name, host, accountId, jobId, token, pollFrequency } = req.body as Partial<DbtCloudConnection>;
  if (!name || !accountId || !jobId || !token) {
    res.status(400).json({ success: false, error: 'name, accountId, jobId, and token are required' });
    return;
  }
  const resolvedFrequency: PollFrequency = (pollFrequency && VALID_POLL_FREQUENCIES.includes(pollFrequency))
    ? pollFrequency : 'NEVER';
  const now = new Date();
  const conn: DbtCloudConnection = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    name: name.trim(),
    host: (host || 'cloud.getdbt.com').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    accountId: String(accountId),
    jobId: String(jobId),
    token,
    lastRunAt: null,
    lastStatus: 'NEVER',
    lastError: null,
    lastSummary: null,
    pollFrequency: resolvedFrequency,
    // Set the first poll to now-ish (one tick out) so a scheduled
    // connection runs almost immediately the first time, rather than
    // waiting a full cadence.
    nextPollAt: resolvedFrequency === 'NEVER' ? null : new Date(now.getTime() + POLL_TICK_MS).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  dbtCloudConnections.push(conn);
  saveStore('dbtCloudConnections', dbtCloudConnections);
  res.status(201).json({ success: true, data: publicShape(conn) });
});

/** PATCH /api/v1/dbt-cloud-connections/:id */
router.patch('/:id', (req: Request, res: Response) => {
  const conn = requireConn(req, res);
  if (!conn) return;
  const { name, host, accountId, jobId, token, pollFrequency } = req.body as Partial<DbtCloudConnection>;
  if (name !== undefined) conn.name = name.trim();
  if (host !== undefined) conn.host = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (accountId !== undefined) conn.accountId = String(accountId);
  if (jobId !== undefined) conn.jobId = String(jobId);
  if (token !== undefined && token) conn.token = token;   // empty string = keep existing
  if (pollFrequency !== undefined && VALID_POLL_FREQUENCIES.includes(pollFrequency)) {
    const switchingToScheduled = pollFrequency !== 'NEVER' && conn.pollFrequency !== pollFrequency;
    conn.pollFrequency = pollFrequency;
    if (pollFrequency === 'NEVER') {
      conn.nextPollAt = null;
    } else if (switchingToScheduled || !conn.nextPollAt) {
      // Schedule the first run shortly so users see the new cadence
      // take effect without waiting a full interval.
      conn.nextPollAt = new Date(Date.now() + POLL_TICK_MS).toISOString();
    }
  }
  conn.updatedAt = new Date().toISOString();
  saveStore('dbtCloudConnections', dbtCloudConnections);
  res.json({ success: true, data: publicShape(conn) });
});

/** DELETE /api/v1/dbt-cloud-connections/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = dbtCloudConnections.findIndex((c) => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'not found' }); return; }
  dbtCloudConnections.splice(idx, 1);
  saveStore('dbtCloudConnections', dbtCloudConnections);
  res.status(204).send();
});

/** POST /api/v1/dbt-cloud-connections/:id/refresh
 *
 *  Pull the latest successful-run manifest for the configured job and
 *  feed it through the same reconciler the manual upload uses. The
 *  connection's lastRunAt / lastStatus / lastError fields get updated
 *  whether the run succeeds or fails so the UI can surface what
 *  happened on the next poll. */
router.post('/:id/refresh', async (req: Request, res: Response) => {
  const conn = requireConn(req, res);
  if (!conn) return;
  const result = await performRefresh(conn, (req as any).user?.sub || null, 'manual');
  if (result.ok) {
    res.json({ success: true, summary: result.summary, runId: result.runId });
  } else {
    res.status(502).json({ success: false, error: result.error });
  }
});

/** Run the manifest fetch + reconcile cycle for a single connection.
 *  Shared between the manual /refresh endpoint and the scheduler tick;
 *  updates lastRunAt / lastStatus / lastError / lastSummary on the
 *  connection in both success and failure paths, and rolls nextPollAt
 *  forward on success (failure paths advance it too so the scheduler
 *  doesn't tight-loop a permanently-broken connection).
 *
 *  Trigger is logged for the audit trail and to make scheduler vs
 *  manual runs distinguishable in the activity feed. */
async function performRefresh(
  conn: DbtCloudConnection,
  actorUserId: string | null,
  trigger: 'manual' | 'scheduled',
): Promise<
  | { ok: true; summary: DbtImportSummary; runId: number }
  | { ok: false; error: string }
> {
  try {
    const runsUrl =
      `https://${conn.host}/api/v2/accounts/${conn.accountId}/runs/`
      + `?job_definition_id=${conn.jobId}`
      + `&status=10`                  // 10 = Success
      + `&order_by=-id&limit=1`;
    const runsRes = await fetch(runsUrl, {
      headers: { Authorization: `Token ${conn.token}`, Accept: 'application/json' },
    });
    if (!runsRes.ok) {
      throw new Error(`dbt Cloud /runs returned ${runsRes.status}: ${await runsRes.text()}`);
    }
    const runsJson = await runsRes.json() as { data?: Array<{ id: number }> };
    const runId = runsJson.data?.[0]?.id;
    if (!runId) throw new Error('No successful runs found for this job.');

    const manifestUrl =
      `https://${conn.host}/api/v2/accounts/${conn.accountId}/runs/${runId}/artifacts/manifest.json`;
    const manifestRes = await fetch(manifestUrl, {
      headers: { Authorization: `Token ${conn.token}`, Accept: 'application/json' },
    });
    if (!manifestRes.ok) {
      throw new Error(`Manifest fetch returned ${manifestRes.status}: ${await manifestRes.text()}`);
    }
    const manifest = await manifestRes.json() as Parameters<typeof reconcileDbtManifest>[0];

    const summary = reconcileDbtManifest(manifest, conn.orgId, actorUserId);
    const now = new Date();
    conn.lastRunAt = now.toISOString();
    conn.lastStatus = 'SUCCESS';
    conn.lastError = null;
    conn.lastSummary = summary;
    conn.nextPollAt = computeNextPollAt(conn.pollFrequency, now);
    conn.updatedAt = conn.lastRunAt;
    saveStore('dbtCloudConnections', dbtCloudConnections);

    auditService.log(
      conn.orgId, actorUserId,
      'DbtCloudConnection', conn.id, 'REFRESH',
      null,
      { runId, summary, trigger },
    );
    logger.info({ connId: conn.id, runId, summary, trigger }, 'dbt Cloud refresh complete');
    return { ok: true, summary, runId };
  } catch (e: any) {
    const now = new Date();
    const msg = e?.message || String(e);
    conn.lastRunAt = now.toISOString();
    conn.lastStatus = 'ERROR';
    conn.lastError = msg;
    // Even on failure, advance nextPollAt so the scheduler doesn't
    // re-hit a broken endpoint every tick. Users can hit Refresh now
    // manually for immediate retries.
    conn.nextPollAt = computeNextPollAt(conn.pollFrequency, now);
    conn.updatedAt = conn.lastRunAt;
    saveStore('dbtCloudConnections', dbtCloudConnections);
    logger.error({ connId: conn.id, err: msg, trigger }, 'dbt Cloud refresh failed');
    return { ok: false, error: msg };
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────
//
// Same shape as the data-quality scheduler: tick every minute, run any
// connection whose nextPollAt has passed (or is null for a freshly-
// scheduled one). Errors are caught per connection so one broken
// upstream doesn't stop the others. Unref'd so test processes aren't
// pinned alive by the scheduler when nothing else is running.

let scheduling = false;
async function tickPollScheduler(): Promise<void> {
  if (scheduling) return;  // skip if the previous tick is still in flight
  scheduling = true;
  try {
    const now = new Date();
    for (const conn of dbtCloudConnections) {
      if (!conn.pollFrequency || conn.pollFrequency === 'NEVER') continue;
      const due = !conn.nextPollAt || new Date(conn.nextPollAt) <= now;
      if (!due) continue;
      try { await performRefresh(conn, null, 'scheduled'); }
      catch (err) { logger.error({ err, connId: conn.id }, 'Scheduled dbt Cloud refresh failed'); }
    }
  } finally {
    scheduling = false;
  }
}
const pollSchedulerHandle = setInterval(() => { void tickPollScheduler(); }, POLL_TICK_MS);
if (typeof pollSchedulerHandle.unref === 'function') pollSchedulerHandle.unref();

export default router;
