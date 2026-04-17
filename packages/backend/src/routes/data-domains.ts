import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { people } from './people';
import { dataAssets } from './data-assets';
import { aiService } from '../services/ai.service';

export interface StoredDataDomain {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;       // personId of the Data Owner
  stewardIds: string[];          // personIds of Data Stewards
  dataAssetIds: string[];
  scopeDefinition?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const dataDomains: StoredDataDomain[] = loadStore<StoredDataDomain>('dataDomains');

const VALID_STATUSES = ['DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED'];
const DOMAIN_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['PROPOSED'],
  PROPOSED:     ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED:     ['ACTIVE', 'DRAFT'],
  ACTIVE:       ['UNDER_REVIEW', 'DEPRECATED'],
  DEPRECATED:   ['DRAFT'],
};
const DOMAIN_LOCKED = new Set(['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED']);

function enrichDomain(domain: StoredDataDomain) {
  const owner = domain.ownerId ? people.find((p) => p.id === domain.ownerId) : null;
  const stewards = domain.stewardIds
    .map((sid) => people.find((p) => p.id === sid))
    .filter(Boolean)
    .map((p) => ({ id: p!.id, name: p!.name }));
  const assets = domain.dataAssetIds
    .map((aid) => dataAssets.find((a) => a.id === aid))
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
router.post('/generate', async (req: Request, res: Response) => {
  const { industry } = req.body;
  if (!industry || typeof industry !== 'string') {
    res.status(400).json({ success: false, error: 'industry is required' });
    return;
  }
  try {
    const suggestions = await aiService.generateDataDomains(industry);
    // The AI returns either a JSON array or an object with a `raw` key.
    const domains = Array.isArray(suggestions) ? suggestions : [];
    res.json({ success: true, data: domains });
  } catch (err: any) {
    logger.error({ err, industry }, 'Data domain generation failed');
    res.status(500).json({ success: false, error: err?.message || 'AI generation failed' });
  }
});

router.delete('/all', (_req: Request, res: Response) => {
  const count = dataDomains.length;
  dataDomains.splice(0, dataDomains.length);
  saveStore('dataDomains', dataDomains);
  auditService.log('system', null, 'DataDomain', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all data domains');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-domains — list all (support ?orgId= filter) */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataDomains.filter((d) => d.orgId === orgId) : dataDomains;
  const enriched = filtered.map(enrichDomain);
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-domains/summary — coverage stats */
router.get('/summary', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataDomains.filter((d) => d.orgId === orgId) : dataDomains;

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
router.get('/:id', (req: Request, res: Response) => {
  const domain = dataDomains.find((d) => d.id === req.params.id);
  if (!domain) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }
  res.json({ success: true, data: enrichDomain(domain) });
});

/** POST /api/v1/data-domains — create */
router.post('/', (req: Request, res: Response) => {
  const { name, description, orgId, status, scopeDefinition } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }

  const now = new Date().toISOString();
  const domain: StoredDataDomain = {
    id: uuid(),
    orgId,
    name,
    description: description || '',
    ownerId: null,
    stewardIds: [],
    dataAssetIds: [],
    ...(scopeDefinition ? { scopeDefinition } : {}),
    status: status && VALID_STATUSES.includes(status) ? status : 'DRAFT',
    createdAt: now,
    updatedAt: now,
  };
  dataDomains.push(domain);
  saveStore('dataDomains', dataDomains);
  res.status(201).json({ success: true, data: enrichDomain(domain) });
});

/** PUT /api/v1/data-domains/:id — update fields */
router.put('/:id', (req: Request, res: Response) => {
  const domain = dataDomains.find((d) => d.id === req.params.id);
  if (!domain) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }

  const { name, description, ownerId, stewardIds, dataAssetIds, status, scopeDefinition } = req.body;

  const hasFieldEdits = name !== undefined || description !== undefined
    || ownerId !== undefined || stewardIds !== undefined || scopeDefinition !== undefined;
  if (hasFieldEdits && DOMAIN_LOCKED.has(domain.status)) {
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
  if (scopeDefinition !== undefined) domain.scopeDefinition = scopeDefinition || undefined;

  // Validate status transition
  if (status !== undefined && status !== domain.status) {
    const allowed = DOMAIN_TRANSITIONS[domain.status] || [];
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
  saveStore('dataDomains', dataDomains);

  res.json({ success: true, data: enrichDomain(domain) });
});

/** DELETE /api/v1/data-domains/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = dataDomains.findIndex((d) => d.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Data domain not found' }); return; }
  dataDomains.splice(idx, 1);
  saveStore('dataDomains', dataDomains);
  res.status(204).send();
});

export default router;
