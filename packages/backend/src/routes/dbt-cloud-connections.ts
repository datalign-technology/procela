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
  createdAt: string;
  updatedAt: string;
}

export const dbtCloudConnections: DbtCloudConnection[] =
  loadStore<DbtCloudConnection>('dbtCloudConnections');

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
  const { orgId, name, host, accountId, jobId, token } = req.body as Partial<DbtCloudConnection>;
  if (!name || !accountId || !jobId || !token) {
    res.status(400).json({ success: false, error: 'name, accountId, jobId, and token are required' });
    return;
  }
  const now = new Date().toISOString();
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
    createdAt: now,
    updatedAt: now,
  };
  dbtCloudConnections.push(conn);
  saveStore('dbtCloudConnections', dbtCloudConnections);
  res.status(201).json({ success: true, data: publicShape(conn) });
});

/** PATCH /api/v1/dbt-cloud-connections/:id */
router.patch('/:id', (req: Request, res: Response) => {
  const conn = requireConn(req, res);
  if (!conn) return;
  const { name, host, accountId, jobId, token } = req.body as Partial<DbtCloudConnection>;
  if (name !== undefined) conn.name = name.trim();
  if (host !== undefined) conn.host = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (accountId !== undefined) conn.accountId = String(accountId);
  if (jobId !== undefined) conn.jobId = String(jobId);
  if (token !== undefined && token) conn.token = token;   // empty string = keep existing
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

  try {
    // 1. Find the latest successful run of the configured job.
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

    // 2. Download the manifest artifact for that run.
    const manifestUrl =
      `https://${conn.host}/api/v2/accounts/${conn.accountId}/runs/${runId}/artifacts/manifest.json`;
    const manifestRes = await fetch(manifestUrl, {
      headers: { Authorization: `Token ${conn.token}`, Accept: 'application/json' },
    });
    if (!manifestRes.ok) {
      throw new Error(`Manifest fetch returned ${manifestRes.status}: ${await manifestRes.text()}`);
    }
    // dbt Cloud returns the manifest as JSON we don't validate further;
    // reconcileDbtManifest is the source of truth on shape and will throw
    // on unrecognised structure.
    const manifest = await manifestRes.json() as Parameters<typeof reconcileDbtManifest>[0];

    // 3. Reconcile, recording the summary on the connection itself so
    //    the UI doesn't have to re-derive it on read.
    const summary = reconcileDbtManifest(manifest, conn.orgId, (req as any).user?.sub || null);
    conn.lastRunAt = new Date().toISOString();
    conn.lastStatus = 'SUCCESS';
    conn.lastError = null;
    conn.lastSummary = summary;
    conn.updatedAt = conn.lastRunAt;
    saveStore('dbtCloudConnections', dbtCloudConnections);

    auditService.log(
      conn.orgId,
      (req as any).user?.sub || null,
      'DbtCloudConnection',
      conn.id,
      'REFRESH',
      null,
      { runId, summary },
    );
    logger.info({ connId: conn.id, runId, summary }, 'dbt Cloud refresh complete');
    res.json({ success: true, summary, runId });
  } catch (e: any) {
    conn.lastRunAt = new Date().toISOString();
    conn.lastStatus = 'ERROR';
    conn.lastError = e?.message || String(e);
    conn.updatedAt = conn.lastRunAt;
    saveStore('dbtCloudConnections', dbtCloudConnections);
    logger.error({ connId: conn.id, err: conn.lastError }, 'dbt Cloud refresh failed');
    res.status(502).json({ success: false, error: conn.lastError });
  }
});

export default router;
