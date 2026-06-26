import { Router, Request, Response } from 'express';
import { digestForOrg } from '../services/digest.service';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { mappings } from './mappings';
import logger from '../lib/logger';

// ──────────────────────────────────────────────────────────────────────────
// Digest — proactive weekly notifications driven by gap-signal deltas.
//
// The service does the work; this route is just a thin trigger. For
// the prototype that means a manual POST; a scheduled cron caller
// can hit the same endpoint with no service changes.
// ──────────────────────────────────────────────────────────────────────────

const router = Router();

/** POST /api/v1/digest/run?orgId=... — take a fresh gap snapshot for
 *  the org, diff it against the previous one, and write notifications
 *  for every rule that fires. Returns the snapshot id, a baseline
 *  flag (true on the very first run for the org), and the list of
 *  notification rows created. */
router.post('/run', (req: Request, res: Response) => {
  const orgId = (req.query.orgId as string | undefined)?.trim()
    || (req.body?.orgId as string | undefined)?.trim()
    || '';
  if (!orgId) {
    res.status(400).json({ success: false, error: 'orgId is required (query string or body).' });
    return;
  }
  try {
    const result = digestForOrg(orgId, { processNodes, dataAssets, mappings });
    res.json({
      success: true,
      data: {
        snapshotId: result.snapshot.id,
        takenAt: result.snapshot.takenAt,
        metrics: result.snapshot.metrics,
        baseline: result.baseline,
        notificationsWritten: result.notifications.length,
        notifications: result.notifications.map((n) => ({ id: n.id, title: n.title, link: n.link, type: n.type })),
      },
    });
  } catch (err: any) {
    logger.error({ err: err?.message, orgId }, 'Digest run failed');
    res.status(500).json({ success: false, error: err?.message || 'digest failed' });
  }
});

export default router;
