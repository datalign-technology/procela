import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { people } from './people';
import { dataAssets } from './data-assets';

export interface StoredDataDomain {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;       // personId of the Data Owner
  stewardIds: string[];          // personIds of Data Stewards
  dataAssetIds: string[];        // linked data asset IDs
  status: 'ACTIVE' | 'DRAFT';
  createdAt: string;
  updatedAt: string;
}

export const dataDomains: StoredDataDomain[] = loadStore<StoredDataDomain>('dataDomains');

const VALID_STATUSES = ['ACTIVE', 'DRAFT'];

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
  const { name, description, orgId, status } = req.body;
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

  const { name, description, ownerId, stewardIds, dataAssetIds, status } = req.body;
  if (name !== undefined) domain.name = name;
  if (description !== undefined) domain.description = description;
  if (ownerId !== undefined) domain.ownerId = ownerId || null;
  if (stewardIds !== undefined && Array.isArray(stewardIds)) domain.stewardIds = stewardIds;
  if (dataAssetIds !== undefined && Array.isArray(dataAssetIds)) domain.dataAssetIds = dataAssetIds;
  if (status !== undefined && VALID_STATUSES.includes(status)) domain.status = status;
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
