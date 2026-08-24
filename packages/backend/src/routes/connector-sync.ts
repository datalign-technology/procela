// Agent-push sync endpoints. These are the connector-authenticated (pct_
// token) counterparts to the user-facing sync-connections routes: an on-prem
// connector pulls the AGENT-mode syncs it owns, runs each query inside the
// customer network, and pushes the resulting rows back here. The heavy lifting
// (ownership checks, upsert, missing-from-source, metadata) lives in
// sync-connections.ts and is shared with the direct-connect path.
//
// Mounted under /api/v1/connectors so the agent's contract is
// /connectors/sync-jobs — same prefix and auth model as /connectors/report.

import { Router, Request, Response } from 'express';
import { requireConnectorToken, recordConnectorEvent, type StoredConnector } from './connectors';
import { listAgentSyncJobs, applyAgentSyncPush } from './sync-connections';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// The request body (rows) is parsed by the app-wide express.json({ limit:
// '2mb' }) before this router runs — comfortably holding a default 1000-row
// batch of business rows. A job that sets a very large `limit` should push in
// chunks; that batching is a future refinement.

/**
 * GET /api/v1/connectors/sync-jobs — the AGENT-mode syncs this connector is
 * responsible for and that are due to run now. The agent polls this each
 * cycle. `?all=1` returns every assigned job regardless of schedule (debug).
 */
router.get('/sync-jobs', requireConnectorToken, asyncHandler(async (req: Request, res: Response) => {
  const connector = (req as Request & { connector: StoredConnector }).connector;
  const onlyDue = req.query.all !== '1';
  const jobs = await listAgentSyncJobs({ id: connector.id, orgId: connector.orgId }, { onlyDue });
  res.json({ success: true, data: jobs });
}));

/**
 * POST /api/v1/connectors/sync-jobs/:id/push — apply the rows the connector
 * read from its local source for one AGENT sync. Body: { rows: [...] }.
 */
router.post('/sync-jobs/:id/push', requireConnectorToken, asyncHandler(async (req: Request, res: Response) => {
  const connector = (req as Request & { connector: StoredConnector }).connector;
  const rows = (req.body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) {
    res.status(400).json({ success: false, error: 'body.rows must be an array' });
    return;
  }

  const outcome = await applyAgentSyncPush(
    String(req.params.id),
    { id: connector.id, orgId: connector.orgId },
    rows as Record<string, string>[],
  );

  switch (outcome.status) {
    case 'not-found':
      res.status(404).json({ success: false, error: 'sync job not found' });
      return;
    case 'forbidden':
      res.status(403).json({ success: false, error: outcome.error });
      return;
    case 'busy':
      res.status(409).json({ success: false, error: 'sync is already running' });
      return;
    case 'config-error':
      res.status(500).json({ success: false, error: outcome.error });
      return;
    case 'ok':
      await recordConnectorEvent(connector.id, connector.orgId, 'SYNC_PUSHED', {
        syncId: req.params.id,
        created: outcome.result.created,
        updated: outcome.result.updated,
        skipped: outcome.result.skipped,
        missingFromSource: outcome.result.missingFromSource,
        errors: outcome.result.errors,
      });
      res.json({ success: true, data: outcome.result });
      return;
  }
}));

export default router;
