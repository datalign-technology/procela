import { Router, Request, Response } from 'express';
import { auditService } from '../services/audit.service';
import { emitCsv } from '../lib/csv';
import { people } from './people';
import { systems } from './systems';
import { dataAssets } from './data-assets';
import { processNodes } from './process-catalog';
import { comments } from './comments';

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG ROUTE
//
// Reads the auditService event stream. Supports filters by org, entity,
// user, and limit. The response is enriched at read time with display
// names (entityName, userName) so the frontend ActivityFeed component
// doesn't have to do per-row joins.
//
// Comments emit audit events too (see comments.ts), so this endpoint is
// the single source of truth for both "activity on this entity" and
// "what did X do recently" views.
// ═══════════════════════════════════════════════════════════════════════════════

const router = Router();

/** Resolve a display name for an audited entity. Returns null if we
 *  can't find a record (e.g. the entity was deleted, or the type is
 *  one we don't have a dedicated store for). */
function entityName(entityType: string, entityId: string): string | null {
  switch (entityType.toLowerCase()) {
    case 'system':         return systems.find((s) => s.id === entityId)?.name ?? null;
    case 'dataasset':      return dataAssets.find((a) => a.id === entityId)?.name ?? null;
    case 'person':         return people.find((p) => p.id === entityId)?.name ?? null;
    case 'processnode':    return processNodes.find((n) => n.id === entityId)?.name ?? null;
    case 'comment': {
      // For comment events, return the parent entity's name so the feed
      // shows what was discussed, not the comment id.
      const c = comments.find((c) => c.id === entityId);
      if (!c) return null;
      const parentName = entityName(c.entityType, c.entityId);
      return parentName ? `comment on ${parentName}` : `comment on ${c.entityType}`;
    }
    default:               return null;
  }
}

function userName(userId: string | null): string | null {
  if (!userId) return null;
  return people.find((p) => p.id === userId)?.name ?? null;
}

/** GET /api/v1/audit — list audit entries with optional filters
 *
 *  Query params:
 *    orgId        - scope to a single organisation
 *    entityType   - filter by entity kind (System, DataAsset, ...)
 *    entityId     - require an exact entity (used with entityType)
 *    userId       - scope to actions taken by one person
 *    limit        - cap result size (default 100)
 */
router.get('/', async (req: Request, res: Response) => {
  const { orgId, entityType, entityId, userId, limit } = req.query as Record<string, string | undefined>;

  let entries = await auditService.getAll(orgId);

  if (entityType && entityId) {
    entries = entries.filter((e) =>
      e.entityType.toLowerCase() === entityType.toLowerCase()
      && e.entityId === entityId);
  } else if (entityType) {
    entries = entries.filter((e) => e.entityType.toLowerCase() === entityType.toLowerCase());
  }
  if (userId) entries = entries.filter((e) => e.userId === userId);

  // Most recent first, capped by limit.
  const max = limit ? Math.max(1, parseInt(limit, 10)) : 100;
  entries = entries
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, max);

  // Enrich with display names so the client doesn't need per-row joins.
  const enriched = entries.map((e) => ({
    ...e,
    entityName: entityName(e.entityType, e.entityId),
    userName: userName(e.userId),
  }));

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/audit/export.csv — full audit log as a downloadable
 *  CSV. The JSON endpoint above caps results at 100 by default for
 *  the in-app feed; this export bypasses that limit so a compliance
 *  reviewer can pull "everything in scope" in one go.
 *
 *  Same filters as the JSON endpoint (orgId / entityType / entityId /
 *  userId). No limit by default — pass ?limit=N if you want one. The
 *  enriched entityName / userName columns are included so the CSV is
 *  human-readable without joining against the catalog. */
router.get('/export.csv', async (req: Request, res: Response) => {
  const { orgId, entityType, entityId, userId, limit } = req.query as Record<string, string | undefined>;
  let entries = await auditService.getAll(orgId);
  if (entityType && entityId) {
    entries = entries.filter((e) =>
      e.entityType.toLowerCase() === entityType.toLowerCase() && e.entityId === entityId);
  } else if (entityType) {
    entries = entries.filter((e) => e.entityType.toLowerCase() === entityType.toLowerCase());
  }
  if (userId) entries = entries.filter((e) => e.userId === userId);
  entries = entries.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (limit) {
    const n = Math.max(1, parseInt(limit, 10));
    if (Number.isFinite(n)) entries = entries.slice(0, n);
  }

  const headers = ['timestamp', 'orgId', 'userId', 'userName', 'entityType', 'entityId', 'entityName', 'action', 'entryHash'];
  const rows = entries.map((e) => [
    e.timestamp,
    e.orgId || '',
    e.userId || '',
    userName(e.userId) || '',
    e.entityType,
    e.entityId,
    entityName(e.entityType, e.entityId) || '',
    e.action,
    (e as any).entryHash || '',
  ]);
  const csv = emitCsv(headers, rows);

  const filename = `procela-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

/** GET /api/v1/audit/verify — walk the hash chain and report integrity.
 *
 *  Each entry holds an entryHash = sha256(prevHash + content). If any
 *  entry has been tampered with, deleted, inserted, or reordered, the
 *  chain breaks at the first bad index. Surface that index + a reason
 *  so an admin can investigate. Legacy entries written before the
 *  chain was added break at position 0 (no hash to verify); that's a
 *  one-time break and doesn't recur once the log rolls forward. */
router.get('/verify', async (_req: Request, res: Response) => {
  const result = await auditService.verifyChain();
  res.json({ success: true, data: result });
});

export default router;
