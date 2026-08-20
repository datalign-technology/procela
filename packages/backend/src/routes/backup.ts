import { Router, Request, Response } from 'express';
import { saveStore, wipeAllStores } from '../lib/persistence';
import logger from '../lib/logger';
import { authenticateToken, authorize, AuthenticatedRequest } from '../middleware/auth';
import { auditService, auditLogs } from '../services/audit.service';

// Import all in-memory stores
import { processNodes, flowRelationships, processVersions } from './process-catalog';
import { systems } from './systems';
import { dataAssets } from './data-assets';
import { organizations } from './organizations';
import { people } from './people';
import { mappings } from './mappings';
import { governanceGroups } from './governance-groups';
import { damaRoles } from './dama-roles';
import { dataDomains } from './data-domains';
import { tags } from './tags';
import { comments } from './comments';

const router = Router();

// All store definitions: key = JSON field name, value = array reference + persistence name
const STORES: Record<string, { data: any[]; persistName: string }> = {
  organizations:      { data: organizations,      persistName: 'organizations' },
  people:             { data: people,              persistName: 'people' },
  processNodes:       { data: processNodes,        persistName: 'processNodes' },
  flowRelationships:  { data: flowRelationships,   persistName: 'flowRelationships' },
  processVersions:    { data: processVersions,     persistName: 'processVersions' },
  systems:            { data: systems,              persistName: 'systems' },
  dataAssets:         { data: dataAssets,           persistName: 'dataAssets' },
  mappings:           { data: mappings,             persistName: 'mappings' },
  governanceGroups:   { data: governanceGroups,     persistName: 'governanceGroups' },
  damaRoles:          { data: damaRoles,            persistName: 'damaRoles' },
  dataDomains:        { data: dataDomains,          persistName: 'dataDomains' },
  tags:               { data: tags,                 persistName: 'tags' },
  comments:           { data: comments,             persistName: 'comments' },
};

/** GET /api/v1/backup/export — Export all data as a single JSON file */
router.get('/export', (_req: Request, res: Response) => {
  const exportData: Record<string, any[]> = {};
  for (const [key, store] of Object.entries(STORES)) {
    exportData[key] = [...store.data];
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    data: exportData,
  };

  logger.info({ counts: Object.fromEntries(Object.entries(exportData).map(([k, v]) => [k, v.length])) }, 'Exported backup');
  res.json(payload);
});

/** POST /api/v1/backup/import — Import data from a backup JSON file (replaces all data) */
router.post('/import', (req: Request, res: Response) => {
  const body = req.body;

  if (!body || !body.data || typeof body.data !== 'object') {
    res.status(400).json({ success: false, error: 'Invalid backup format: missing "data" field' });
    return;
  }

  const imported: Record<string, number> = {};

  for (const [key, store] of Object.entries(STORES)) {
    const incoming = body.data[key];
    if (Array.isArray(incoming)) {
      // Clear existing data
      store.data.splice(0, store.data.length);
      // Push all imported items
      store.data.push(...incoming);
      // Persist to disk
      saveStore(store.persistName, store.data);
      imported[key] = incoming.length;
    } else {
      imported[key] = 0;
    }
  }

  logger.info({ imported }, 'Imported backup');
  res.json({ success: true, imported });
});

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

/**
 * POST /api/v1/backup/reset-all
 * Body: { confirm: "RESET" }
 *
 * Hard-reset every store on disk AND every registered in-memory
 * array. The closest thing Procela has to a factory reset — the
 * operator gets the same blank slate they'd see after deleting the
 * `.procela-data/` directory and restarting the server.
 *
 * Gates:
 *   - SUPER_ADMIN role only.
 *   - Typed confirmation phrase `RESET` to defend against
 *     muscle-memory triggers. Same defense as the GDPR forget action.
 *
 * Behaviour:
 *   - Every `.procela-data/*.json` file is truncated to `[]`.
 *   - Every registered in-memory store has its array spliced empty.
 *   - The audit log is bootstrapped fresh with a single
 *     ALL_DATA_RESET entry recording the actor + timestamp.
 *   - The frontend should drop the user's local session and route
 *     them back to /login so the onboarding wizard fires on the
 *     next sign-in.
 */
router.post(
  '/reset-all',
  authenticateToken,
  authorize('SUPER_ADMIN'),
  async (req: AuthenticatedRequest, res: Response) => {
    const { confirm } = req.body || {};
    if (confirm !== 'RESET') {
      res.status(400).json({
        success: false,
        error: 'Confirmation phrase did not match. Pass { confirm: "RESET" } to proceed.',
      });
      return;
    }

    // Capture actor before we nuke the audit log so the post-reset
    // entry knows who triggered the wipe.
    const actorId = req.user?.sub || null;
    const actorEmail = req.user?.email || null;
    const beforeCounts = { auditLogs: auditLogs.length };

    const summary = await wipeAllStores();

    // The audit log was just nuked too — record a single bootstrap
    // entry so the reset is auditable. auditService.log re-creates
    // the file and starts a fresh hash chain.
    auditService.log(
      DEV_ORG_ID,
      actorId,
      'System',
      'all',
      'ALL_DATA_RESET',
      beforeCounts,
      { actorEmail, ...summary },
    );

    logger.warn(
      { actorId, actorEmail, summary },
      'All data reset via /backup/reset-all',
    );

    res.json({
      success: true,
      data: {
        filesCleared: summary.filesCleared,
        storesReloaded: summary.storesReloaded.length,
        tablesTruncated: summary.tablesTruncated,
        message: 'Every store has been cleared. Your session will be invalidated; sign out and complete the onboarding wizard to set up a new organization.',
      },
    });
  },
);

export default router;
