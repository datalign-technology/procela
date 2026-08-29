import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { requireAiEnabled } from '../middleware/ai-enabled';
import { filterByOrgScope, getCachedOrgList } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { people } from './people';
import { dataAssets } from './data-assets';
import { aiService } from '../services/ai.service';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { getPeopleRepository } from '../db/people.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { hasDatabase } from '../db/prisma';

export interface StoredDataDomain {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;       // personId of the Data Owner
  stewardIds: string[];          // personIds of Data Stewards
  dataAssetIds: string[];
  scopeDefinition?: string;
  // Business-criticality tier. TIER_1 = the domains the council watches most
  // closely; drives the Council Scorecard's tier-1 coverage measure. null =
  // unclassified. Valid values mirror the CriticalityTier enum.
  criticality?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const dataDomains: StoredDataDomain[] = loadStore<StoredDataDomain>('dataDomains');
registerStore('dataDomains', dataDomains);

const dataDomainsRepo = getDataDomainsRepository(dataDomains);

// people.ts and data-assets.ts both value-import `dataDomains` from this
// module, so this module can be evaluated as a side-effect of loading one of
// them — at which point their `people` / `dataAssets` bindings are still in
// the temporal dead zone. Reading either at module-init time (to construct a
// repo) throws mid-cycle and, under the test loader, hangs. Build these repos
// lazily instead: by the time any handler runs, both modules are fully
// initialised.
let _peopleRepo: ReturnType<typeof getPeopleRepository> | null = null;
const peopleRepo = () => (_peopleRepo ??= getPeopleRepository(people));
let _dataAssetsRepo: ReturnType<typeof getDataAssetsRepository> | null = null;
const dataAssetsRepo = () => (_dataAssetsRepo ??= getDataAssetsRepository(dataAssets));

// Migrate legacy statuses to DRAFT. JSON mode only — in Postgres mode the
// persisted rows already carry the canonical status shape.
if (!hasDatabase()) {
  const legacy = new Set(['PROPOSED', 'UNDER_REVIEW', 'APPROVED']);
  let migrated = 0;
  for (const d of dataDomains) {
    if (legacy.has(d.status)) { d.status = 'DRAFT'; migrated++; }
  }
  if (migrated > 0) saveStore('dataDomains', dataDomains);
}

const VALID_STATUSES = ['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED'];
const VALID_CRITICALITY = ['TIER_1', 'TIER_2', 'TIER_3', 'TIER_4'];
const SIMPLE_TRANSITIONS: Record<string, string[]> = {
  DRAFT:      ['ACTIVE'],
  ACTIVE:     ['DRAFT', 'DEPRECATED'],
  DEPRECATED: ['DRAFT'],
};
const ADVANCED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['PROPOSED'],
  PROPOSED:     ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED:     ['ACTIVE', 'DRAFT'],
  ACTIVE:       ['DRAFT', 'DEPRECATED'],
  DEPRECATED:   ['DRAFT'],
};
const SIMPLE_LOCKED = new Set(['ACTIVE', 'DEPRECATED']);
const ADVANCED_LOCKED = new Set(['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED']);

function enrichDomain(
  domain: StoredDataDomain,
  allPeople: typeof people,
  allAssets: typeof dataAssets,
) {
  const owner = domain.ownerId ? allPeople.find((p) => p.id === domain.ownerId) : null;
  const stewards = domain.stewardIds
    .map((sid) => allPeople.find((p) => p.id === sid))
    .filter(Boolean)
    .map((p) => ({ id: p!.id, name: p!.name }));
  const assets = domain.dataAssetIds
    .map((aid) => allAssets.find((a) => a.id === aid))
    .filter(Boolean)
    .map((a) => ({ id: a!.id, name: a!.name }));

  return {
    ...domain,
    ownerName: owner?.name || null,
    stewards,
    assets,
  };
}

const router = Router();

/** DELETE /api/v1/data-domains/all — delete all data domains */
/**
 * POST /api/v1/data-domains/generate
 *
 * Uses the AI service to suggest data domains for a given industry.
 * Returns the suggestions without committing them — the frontend shows
 * a preview and the user picks which to keep.
 */
router.post('/generate', requireAiEnabled, async (req: Request, res: Response) => {
  const { industry } = req.body;
  if (!industry || typeof industry !== 'string') {
    res.status(400).json({ success: false, error: 'industry is required' });
    return;
  }
  try {
    const suggestions = await aiService.generateDataDomains(industry);
    // The shared extractJson helper always returns a parsed value; we
    // still want a friendly error when the AI returned a *valid* but
    // wrong-shaped response (e.g. `{ items: [...] }` instead of the
    // top-level array we asked for). Tolerate both shapes here so a
    // single quirky generation doesn't bubble up as "no suggestions".
    let domains: Array<unknown> = [];
    if (Array.isArray(suggestions)) {
      domains = suggestions;
    } else if (suggestions && typeof suggestions === 'object') {
      const obj = suggestions as Record<string, unknown>;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) { domains = v; break; }
      }
    }
    if (domains.length === 0) {
      logger.warn({ industry, suggestions }, 'Domain generation returned no array');
      res.status(502).json({
        success: false,
        error: 'The AI response did not contain a list of domains. Try again — Claude occasionally returns prose; a retry usually fixes it.',
      });
      return;
    }
    res.json({ success: true, data: domains });
  } catch (err: any) {
    // Surface the raw model response when available so the UI can show
    // what came back instead of just "failed".
    const message = err?.message || 'AI generation failed';
    const raw = err?.rawResponse as string | undefined;
    logger.error({ err, industry, raw }, 'Data domain generation failed');
    res.status(500).json({
      success: false,
      error: message,
      ...(raw ? { rawSnippet: raw.slice(0, 300) } : {}),
    });
  }
});

router.delete('/all', async (_req: Request, res: Response) => {
  const all = await dataDomainsRepo.list();
  const count = all.length;
  for (const d of all) {
    await dataDomainsRepo.delete(d.id);
  }
  auditService.log('system', null, 'DataDomain', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all data domains');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-domains — list all (support ?orgId= filter) */
router.get('/', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const [allDomains, allPeople, allAssets] = await Promise.all([
    dataDomainsRepo.list(),
    peopleRepo().list(),
    dataAssetsRepo().list(),
  ]);
  const filtered = filterByOrgScope(allDomains, orgId as string | undefined);
  const enriched = filtered.map((d) => enrichDomain(d, allPeople, allAssets));
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-domains/summary — coverage stats */
router.get('/summary', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(await dataDomainsRepo.list(), orgId as string | undefined);

  const total = filtered.length;
  const governed = filtered.filter((d) => d.ownerId).length;
  const ungoverned = total - governed;
  const totalAssetsInDomains = new Set(filtered.flatMap((d) => d.dataAssetIds)).size;

  res.json({
    success: true,
    data: { total, governed, ungoverned, totalAssetsInDomains },
  });
});

/** GET /api/v1/data-domains/:id — single domain with enriched data */
router.get('/:id', async (req: Request, res: Response) => {
  const [domain, allPeople, allAssets] = await Promise.all([
    dataDomainsRepo.get(String(req.params.id)),
    peopleRepo().list(),
    dataAssetsRepo().list(),
  ]);
  if (!domain) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }
  res.json({ success: true, data: enrichDomain(domain, allPeople, allAssets) });
});

/**
 * Scope Definition was merged into Description (they overlapped — both
 * describe "what this domain is"). Fold any incoming scopeDefinition into
 * description so nothing is lost: both present → two paragraphs; one → that
 * one; neither → undefined. Callers write the result to `description` and
 * stop persisting `scopeDefinition` (the column is kept but deprecated).
 */
function combineDescription(description?: string | null, scopeDefinition?: string | null): string | undefined {
  const d = (description || '').trim();
  const s = (scopeDefinition || '').trim();
  if (d && s) return d === s ? d : `${d}\n\n${s}`;
  return d || s || undefined;
}

/** POST /api/v1/data-domains — create */
router.post('/', async (req: Request, res: Response) => {
  const { name, description, orgId, status, scopeDefinition } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }

  const duplicate = (await dataDomainsRepo.list()).find(
    (d) => d.orgId === orgId && d.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (duplicate) {
    res.status(409).json({ success: false, error: `A data domain named "${name}" already exists in this organization` });
    return;
  }

  const now = new Date().toISOString();
  const domain: StoredDataDomain = {
    id: uuid(),
    orgId,
    name,
    // Scope Definition merged into Description.
    description: combineDescription(description, scopeDefinition) || '',
    ownerId: null,
    stewardIds: [],
    dataAssetIds: [],
    criticality: VALID_CRITICALITY.includes(req.body?.criticality) ? req.body.criticality : undefined,
    status: status && VALID_STATUSES.includes(status) ? status : 'DRAFT',
    createdAt: now,
    updatedAt: now,
  };
  await dataDomainsRepo.create(domain);
  const [allPeople, allAssets] = await Promise.all([peopleRepo().list(), dataAssetsRepo().list()]);
  res.status(201).json({ success: true, data: enrichDomain(domain, allPeople, allAssets) });
});

/** PUT /api/v1/data-domains/:id — update fields */
router.put('/:id', async (req: Request, res: Response) => {
  const domain = await dataDomainsRepo.get(String(req.params.id));
  if (!domain) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }

  const { name, description, ownerId, stewardIds, dataAssetIds, status, scopeDefinition } = req.body;

  const hasFieldEdits = name !== undefined || description !== undefined
    || ownerId !== undefined || stewardIds !== undefined || scopeDefinition !== undefined;
  const domainOrg = getCachedOrgList().find((o) => o.id === domain.orgId) as any;
  const isAdvanced = domainOrg?.statusMode === 'advanced';
  const lockedSet = isAdvanced ? ADVANCED_LOCKED : SIMPLE_LOCKED;
  const transitionMap = isAdvanced ? ADVANCED_TRANSITIONS : SIMPLE_TRANSITIONS;
  if (hasFieldEdits && lockedSet.has(domain.status)) {
    res.status(403).json({
      success: false,
      error: `Cannot edit "${domain.name}" — it is currently ${domain.status.replace('_', ' ')}. Change its status to Draft first.`,
    });
    return;
  }

  if (name !== undefined) domain.name = name;
  if (description !== undefined) domain.description = description;
  if (ownerId !== undefined) domain.ownerId = ownerId || null;
  if (stewardIds !== undefined && Array.isArray(stewardIds)) domain.stewardIds = stewardIds;
  if (dataAssetIds !== undefined && Array.isArray(dataAssetIds)) domain.dataAssetIds = dataAssetIds;
  if (req.body?.criticality !== undefined) {
    domain.criticality = VALID_CRITICALITY.includes(req.body.criticality) ? req.body.criticality : undefined;
  }
  // Scope Definition merged into Description: fold any incoming value in.
  if (scopeDefinition !== undefined) {
    domain.description = combineDescription(domain.description, scopeDefinition) || '';
  }

  // Validate status transition
  if (status !== undefined && status !== domain.status) {
    const allowed = transitionMap[domain.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        success: false,
        error: `Cannot transition from ${domain.status.replace('_', ' ')} to ${status.replace('_', ' ')}. Valid transitions: ${allowed.map((s: string) => s.replace('_', ' ')).join(', ') || 'none'}.`,
      });
      return;
    }
    domain.status = status;
  }

  domain.updatedAt = new Date().toISOString();
  await dataDomainsRepo.update(domain.id, domain);

  const [allPeople, allAssets] = await Promise.all([peopleRepo().list(), dataAssetsRepo().list()]);
  res.json({ success: true, data: enrichDomain(domain, allPeople, allAssets) });
});

/** GET /api/v1/data-domains/:id/impact — preview what would be affected by deleting this domain */
router.get('/:id/impact', async (req: Request, res: Response) => {
  const domain = await dataDomainsRepo.get(String(req.params.id));
  if (!domain) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }

  res.json({
    success: true,
    data: {
      assets: domain.dataAssetIds.length,
      stewards: domain.stewardIds.length,
    },
  });
});

/** DELETE /api/v1/data-domains/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = await dataDomainsRepo.get(String(req.params.id));
  if (!removed) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }
  await dataDomainsRepo.delete(removed.id);
  res.status(204).send();
});

/**
 * PATCH /api/v1/data-domains/bulk
 *
 * Body: { ids: string[], updates: { ownerId?, status? } }
 *
 * Applies the same partial update to every domain in `ids`. Unknown ids and
 * domains where the requested status transition is not allowed are skipped
 * (per-id reasons returned in the response). Locked-status edits to other
 * fields are also skipped to mirror the single-update endpoint's rules.
 */
router.patch('/bulk', async (req: Request, res: Response) => {
  const { ids, updates } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ success: false, error: 'ids must be a non-empty array' });
    return;
  }
  if (!updates || typeof updates !== 'object') {
    res.status(400).json({ success: false, error: 'updates object is required' });
    return;
  }

  const now = new Date().toISOString();
  let updated = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const id of ids) {
    const domain = await dataDomainsRepo.get(String(id));
    if (!domain) { skipped.push({ id, reason: 'not found' }); continue; }

    const domainOrg = getCachedOrgList().find((o) => o.id === domain.orgId) as any;
    const isAdvanced = domainOrg?.statusMode === 'advanced';
    const lockedSet = isAdvanced ? ADVANCED_LOCKED : SIMPLE_LOCKED;
    const transitionMap = isAdvanced ? ADVANCED_TRANSITIONS : SIMPLE_TRANSITIONS;

    const wantsFieldEdit = updates.ownerId !== undefined;
    if (wantsFieldEdit && lockedSet.has(domain.status)) {
      skipped.push({ id, reason: `locked in ${domain.status}` });
      continue;
    }

    if (updates.status !== undefined && updates.status !== domain.status) {
      const allowed = transitionMap[domain.status] || [];
      if (!allowed.includes(updates.status)) {
        skipped.push({ id, reason: `cannot transition ${domain.status} → ${updates.status}` });
        continue;
      }
      domain.status = updates.status;
    }
    if (updates.ownerId !== undefined) domain.ownerId = updates.ownerId || null;

    domain.updatedAt = now;
    await dataDomainsRepo.update(domain.id, domain);
    auditService.log('system', domain.orgId, 'DataDomain', domain.id, 'BULK_UPDATE', null, domain);
    updated++;
  }

  logger.info({ updated, skipped: skipped.length }, 'Bulk-updated data domains');
  res.json({ success: true, updated, skipped });
});

/**
 * POST /api/v1/data-domains/bulk-delete
 *
 * Body: { ids: string[] }
 */
router.post('/bulk-delete', async (req: Request, res: Response) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ success: false, error: 'ids must be a non-empty array' });
    return;
  }
  const idSet = new Set(ids);
  const removed = (await dataDomainsRepo.list()).filter((d) => idSet.has(d.id));
  for (const r of removed) {
    auditService.log('system', r.orgId, 'DataDomain', r.id, 'DELETE', r, null);
    await dataDomainsRepo.delete(r.id);
  }
  logger.info({ count: removed.length }, 'Bulk-deleted data domains');
  res.json({ success: true, deleted: removed.length });
});

export default router;
