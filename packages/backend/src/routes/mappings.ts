import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { people } from './people';

// ── Types ──

interface StoredMapping {
  id: string;
  orgId: string;
  processStepId: string;
  dataAssetId: string;
  linkType: string;
  notes: string;
  aiSuggested: boolean;
  userOverridden: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const mappings: StoredMapping[] = loadStore<StoredMapping>('mappings');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const VALID_LINK_TYPES = ['consumes', 'produces', 'transforms', 'references'];

// ── Helpers ──

function findStepInfo(stepId: string) {
  const node = processNodes.find((n) => n.id === stepId);
  if (!node) return null;

  // Build ancestry path
  const path: string[] = [node.name];
  let current = node;
  while (current.parentId) {
    const parent = processNodes.find((n) => n.id === current.parentId);
    if (!parent) break;
    path.unshift(parent.name);
    current = parent;
  }

  return {
    stepId: node.id,
    stepName: node.name,
    level: node.level,
    activityId: node.activityId,
    path: path.join(' > '),
  };
}

function findAssetInfo(assetId: string) {
  const asset = dataAssets.find((a) => a.id === assetId);
  if (!asset) return null;
  const owner = asset.owner ? people.find((p) => p.id === asset.owner) : null;
  const stewardIds = asset.stewardIds || [];
  const stewardName = stewardIds
    .map((sid) => people.find((p) => p.id === sid)?.name)
    .filter(Boolean)
    .join(', ') || null;
  return {
    assetId: asset.id,
    assetName: asset.name,
    assetDescription: asset.description,
    governanceTier: asset.governanceTier,
    healthScore: asset.healthScore,
    ownerName: owner?.name || null,
    stewardName,
  };
}

function enrichMapping(m: StoredMapping) {
  return {
    ...m,
    stepInfo: findStepInfo(m.processStepId),
    assetInfo: findAssetInfo(m.dataAssetId),
  };
}

const router = Router();

/** DELETE /api/v1/mappings/all — delete all mappings */
router.delete('/all', (_req: Request, res: Response) => {
  const count = mappings.length;
  mappings.splice(0, mappings.length);
  saveStore('mappings', mappings);
  auditService.log(DEV_ORG_ID, null, 'Mapping', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all mappings');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/mappings */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(mappings, orgId as string | undefined);
  const enriched = filtered.map(enrichMapping);
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/mappings/by-step/:stepId */
router.get('/by-step/:stepId', (req: Request, res: Response) => {
  const filtered = mappings.filter((m) => m.processStepId === req.params.stepId);
  res.json({ success: true, data: filtered.map(enrichMapping) });
});

/** GET /api/v1/mappings/by-asset/:assetId */
router.get('/by-asset/:assetId', (req: Request, res: Response) => {
  const filtered = mappings.filter((m) => m.dataAssetId === req.params.assetId);
  res.json({ success: true, data: filtered.map(enrichMapping) });
});

/** POST /api/v1/mappings */
router.post('/', (req: Request, res: Response) => {
  const { processStepId, dataAssetId, linkType, notes, aiSuggested, orgId } = req.body;

  if (!processStepId) {
    res.status(400).json({ success: false, error: 'processStepId is required' });
    return;
  }
  if (!dataAssetId) {
    res.status(400).json({ success: false, error: 'dataAssetId is required' });
    return;
  }
  if (linkType && !VALID_LINK_TYPES.includes(linkType)) {
    res.status(400).json({ success: false, error: `linkType must be one of: ${VALID_LINK_TYPES.join(', ')}` });
    return;
  }

  const now = new Date().toISOString();
  const mapping: StoredMapping = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    processStepId,
    dataAssetId,
    linkType: linkType || 'references',
    notes: notes || '',
    aiSuggested: aiSuggested === true,
    userOverridden: false,
    createdBy: 'dev-user',
    createdAt: now,
    updatedAt: now,
  };
  mappings.push(mapping);
  saveStore('mappings', mappings);
  res.status(201).json({ success: true, data: enrichMapping(mapping) });
});

/** PUT /api/v1/mappings/:id */
router.put('/:id', (req: Request, res: Response) => {
  const mapping = mappings.find((m) => m.id === req.params.id);
  if (!mapping) {
    res.status(404).json({ success: false, error: 'Mapping not found' });
    return;
  }

  const { processStepId, dataAssetId, linkType, notes, aiSuggested, userOverridden } = req.body;
  if (processStepId !== undefined) mapping.processStepId = processStepId;
  if (dataAssetId !== undefined) mapping.dataAssetId = dataAssetId;
  if (linkType !== undefined) {
    if (!VALID_LINK_TYPES.includes(linkType)) {
      res.status(400).json({ success: false, error: `linkType must be one of: ${VALID_LINK_TYPES.join(', ')}` });
      return;
    }
    mapping.linkType = linkType;
  }
  if (notes !== undefined) mapping.notes = notes;
  if (aiSuggested !== undefined) mapping.aiSuggested = aiSuggested === true;
  if (userOverridden !== undefined) mapping.userOverridden = userOverridden === true;
  mapping.updatedAt = new Date().toISOString();
  saveStore('mappings', mappings);
  res.json({ success: true, data: enrichMapping(mapping) });
});

/** DELETE /api/v1/mappings/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = mappings.findIndex((m) => m.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Mapping not found' });
    return;
  }
  mappings.splice(idx, 1);
  saveStore('mappings', mappings);
  res.status(204).send();
});

export default router;
