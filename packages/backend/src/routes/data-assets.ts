import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { systems } from './systems';
import { dataDomains } from './data-domains';
import { mappings } from './mappings';
import { people } from './people';
import { processNodes } from './process-catalog';

interface StoredDataAsset {
  id: string;
  orgId: string;
  name: string;
  description: string;
  systemId: string;
  owner: string;
  steward: string;
  governanceTier: 'BRONZE' | 'SILVER' | 'GOLD';
  healthScore: number;
  // Optional provenance: set when the asset was imported from a discovered
  // connection column. Enables "where did this come from?" and later
  // re-sync against the source.
  sourceConnectionId?: string;
  sourceAsset?: string;   // table / file / endpoint / sheet name in the source
  sourceColumn?: string;  // the specific column, null if the whole asset was imported
  createdAt: string;
  updatedAt: string;
}

export const dataAssets: StoredDataAsset[] = loadStore<StoredDataAsset>('dataAssets');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const VALID_TIERS = ['BRONZE', 'SILVER', 'GOLD'];

const router = Router();

/** DELETE /api/v1/data-assets/all — delete all data assets */
router.delete('/all', (_req: Request, res: Response) => {
  const count = dataAssets.length;
  dataAssets.splice(0, dataAssets.length);
  saveStore('dataAssets', dataAssets);
  auditService.log(DEV_ORG_ID, null, 'DataAsset', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all data assets');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-assets */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataAssets.filter((a) => a.orgId === orgId) : dataAssets;
  const filteredSystems = orgId ? systems.filter((s) => s.orgId === orgId) : systems;
  res.json({ success: true, data: filtered, systems: filteredSystems });
});

/** GET /api/v1/data-assets/:id/360 — full 360 view of a data asset */
router.get('/:id/360', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }

  // Resolve system
  const system = asset.systemId ? systems.find((s) => s.id === asset.systemId) || null : null;

  // Find data domain containing this asset
  const domain = dataDomains.find((d) => d.dataAssetIds.includes(asset.id));
  let domainInfo = null;
  if (domain) {
    const owner = domain.ownerId ? people.find((p) => p.id === domain.ownerId) : null;
    const stewards = domain.stewardIds
      .map((sid) => people.find((p) => p.id === sid))
      .filter(Boolean)
      .map((p) => ({ id: p!.id, name: p!.name }));
    domainInfo = { id: domain.id, name: domain.name, ownerName: owner?.name || null, stewards };
  }

  // Mappings enriched with process node path
  const assetMappings = mappings
    .filter((m) => m.dataAssetId === asset.id)
    .map((m) => {
      const node = processNodes.find((n) => n.id === m.processStepId);
      let path = m.processStepId;
      if (node) {
        const parts: string[] = [node.name];
        let current = node;
        while (current.parentId) {
          const parent = processNodes.find((n) => n.id === current.parentId);
          if (!parent) break;
          parts.unshift(parent.name);
          current = parent;
        }
        path = parts.join(' > ');
      }
      return { id: m.id, processStepId: m.processStepId, linkType: m.linkType, notes: m.notes, processPath: path };
    });

  // Resolve owner and steward from people
  const ownerPerson = asset.owner ? people.find((p) => p.id === asset.owner || p.name === asset.owner) : null;
  const stewardPerson = asset.steward ? people.find((p) => p.id === asset.steward || p.name === asset.steward) : null;

  res.json({
    success: true,
    data: {
      asset,
      system: system ? { id: system.id, name: system.name, systemType: system.systemType } : null,
      domain: domainInfo,
      mappings: assetMappings,
      ownerInfo: ownerPerson ? { id: ownerPerson.id, name: ownerPerson.name } : (asset.owner ? { id: null, name: asset.owner } : null),
      stewardInfo: stewardPerson ? { id: stewardPerson.id, name: stewardPerson.name } : (asset.steward ? { id: null, name: asset.steward } : null),
    },
  });
});

/** GET /api/v1/data-assets/:id */
router.get('/:id', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  res.json({ success: true, data: asset });
});

/** POST /api/v1/data-assets */
router.post('/', (req: Request, res: Response) => {
  const { name, description, systemId, owner, steward, governanceTier, healthScore, orgId,
    sourceConnectionId, sourceAsset, sourceColumn } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }

  const tier = governanceTier && VALID_TIERS.includes(governanceTier) ? governanceTier : 'BRONZE';
  const score = typeof healthScore === 'number' ? Math.max(0, Math.min(100, healthScore)) : 0;

  const now = new Date().toISOString();
  const asset: StoredDataAsset = {
    id: uuid(), orgId: orgId || DEV_ORG_ID, name,
    description: description || '',
    systemId: systemId || '',
    owner: owner || '',
    steward: steward || '',
    governanceTier: tier,
    healthScore: score,
    ...(sourceConnectionId ? { sourceConnectionId } : {}),
    ...(sourceAsset ? { sourceAsset } : {}),
    ...(sourceColumn ? { sourceColumn } : {}),
    createdAt: now, updatedAt: now,
  };
  dataAssets.push(asset);
  saveStore('dataAssets', dataAssets);
  res.status(201).json({ success: true, data: asset });
});

/** PUT /api/v1/data-assets/:id */
router.put('/:id', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }

  const { name, description, systemId, owner, steward, governanceTier, healthScore,
    sourceConnectionId, sourceAsset, sourceColumn } = req.body;
  if (name !== undefined) asset.name = name;
  if (description !== undefined) asset.description = description;
  if (systemId !== undefined) asset.systemId = systemId;
  if (owner !== undefined) asset.owner = owner;
  if (steward !== undefined) asset.steward = steward;
  if (governanceTier !== undefined && VALID_TIERS.includes(governanceTier)) asset.governanceTier = governanceTier;
  if (healthScore !== undefined && typeof healthScore === 'number') asset.healthScore = Math.max(0, Math.min(100, healthScore));
  if (sourceConnectionId !== undefined) asset.sourceConnectionId = sourceConnectionId || undefined;
  if (sourceAsset !== undefined) asset.sourceAsset = sourceAsset || undefined;
  if (sourceColumn !== undefined) asset.sourceColumn = sourceColumn || undefined;
  asset.updatedAt = new Date().toISOString();
  saveStore('dataAssets', dataAssets);
  res.json({ success: true, data: asset });
});

/** DELETE /api/v1/data-assets/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = dataAssets.findIndex((a) => a.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  dataAssets.splice(idx, 1);
  saveStore('dataAssets', dataAssets);
  res.status(204).send();
});

export default router;
