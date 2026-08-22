import { Router, Request, Response } from 'express';
import { auditService } from '../services/audit.service';
import { emitCsv } from '../lib/csv';
import { people } from './people';
import { systems } from './systems';
import { dataAssets } from './data-assets';
import { processNodes } from './process-catalog';
import { comments } from './comments';
import { getPeopleRepository } from '../db/people.repo';
import { getSystemsRepository } from '../db/systems.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getCommentsRepository } from '../db/comments.repo';

// Lazy repo accessors — the raw imported arrays above are empty in
// Postgres mode, so the name-resolution helpers must read through the
// repositories instead. Each handler pre-lists the stores it needs into
// id→row Maps (see buildNameMaps) and passes them into the helpers, so a
// helper called per-row never touches the repos in a loop.
let _peopleRepo: ReturnType<typeof getPeopleRepository> | null = null;
const peopleRepo = () => (_peopleRepo ??= getPeopleRepository(people));
let _systemsRepo: ReturnType<typeof getSystemsRepository> | null = null;
const systemsRepo = () => (_systemsRepo ??= getSystemsRepository(systems));
let _dataAssetsRepo: ReturnType<typeof getDataAssetsRepository> | null = null;
const dataAssetsRepo = () => (_dataAssetsRepo ??= getDataAssetsRepository(dataAssets));
let _processNodesRepo: ReturnType<typeof getProcessNodesRepository> | null = null;
const processNodesRepo = () => (_processNodesRepo ??= getProcessNodesRepository(processNodes));
let _commentsRepo: ReturnType<typeof getCommentsRepository> | null = null;
const commentsRepo = () => (_commentsRepo ??= getCommentsRepository(comments));

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

/** Id→row lookup maps for the stores the name resolvers need. Built once
 *  per request from the repositories so name resolution is correct in
 *  Postgres mode (where the raw arrays are empty) without a per-row read. */
interface NameMaps {
  systems: Map<string, { name?: string }>;
  dataAssets: Map<string, { name?: string }>;
  people: Map<string, { name?: string }>;
  processNodes: Map<string, { name?: string }>;
  comments: Map<string, { entityType: string; entityId: string }>;
}

/** Pre-list the stores the audit feed enriches against into id→row Maps.
 *  Called once per handler; the Maps are passed into the per-row helpers. */
async function buildNameMaps(): Promise<NameMaps> {
  const [allSystems, allDataAssets, allPeople, allProcessNodes, allComments] = await Promise.all([
    systemsRepo().list(),
    dataAssetsRepo().list(),
    peopleRepo().list(),
    processNodesRepo().list(),
    commentsRepo().list(),
  ]);
  return {
    systems: new Map(allSystems.map((s) => [s.id, s])),
    dataAssets: new Map(allDataAssets.map((a) => [a.id, a])),
    people: new Map(allPeople.map((p) => [p.id, p])),
    processNodes: new Map(allProcessNodes.map((n) => [n.id, n])),
    comments: new Map(allComments.map((c) => [c.id, c])),
  };
}

/** Resolve a display name for an audited entity. Returns null if we
 *  can't find a record (e.g. the entity was deleted, or the type is
 *  one we don't have a dedicated store for). */
function entityName(entityType: string, entityId: string, maps: NameMaps): string | null {
  switch (entityType.toLowerCase()) {
    case 'system':         return maps.systems.get(entityId)?.name ?? null;
    case 'dataasset':      return maps.dataAssets.get(entityId)?.name ?? null;
    case 'person':         return maps.people.get(entityId)?.name ?? null;
    case 'processnode':    return maps.processNodes.get(entityId)?.name ?? null;
    case 'comment': {
      // For comment events, return the parent entity's name so the feed
      // shows what was discussed, not the comment id.
      const c = maps.comments.get(entityId);
      if (!c) return null;
      const parentName = entityName(c.entityType, c.entityId, maps);
      return parentName ? `comment on ${parentName}` : `comment on ${c.entityType}`;
    }
    default:               return null;
  }
}

function userName(userId: string | null, peopleMap: NameMaps['people']): string | null {
  if (!userId) return null;
  return peopleMap.get(userId)?.name ?? null;
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
  const maps = await buildNameMaps();
  const enriched = entries.map((e) => ({
    ...e,
    entityName: entityName(e.entityType, e.entityId, maps),
    userName: userName(e.userId, maps.people),
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

  const maps = await buildNameMaps();
  const headers = ['timestamp', 'orgId', 'userId', 'userName', 'entityType', 'entityId', 'entityName', 'action', 'entryHash'];
  const rows = entries.map((e) => [
    e.timestamp,
    e.orgId || '',
    e.userId || '',
    userName(e.userId, maps.people) || '',
    e.entityType,
    e.entityId,
    entityName(e.entityType, e.entityId, maps) || '',
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
