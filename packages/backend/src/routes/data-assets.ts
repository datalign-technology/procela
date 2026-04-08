import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { systems } from './systems';

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
  createdAt: string;
  updatedAt: string;
}

export const dataAssets: StoredDataAsset[] = [];
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const VALID_TIERS = ['BRONZE', 'SILVER', 'GOLD'];

const router = Router();

/** GET /api/v1/data-assets */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataAssets.filter((a) => a.orgId === orgId) : dataAssets;
  const filteredSystems = orgId ? systems.filter((s) => s.orgId === orgId) : systems;
  res.json({ success: true, data: filtered, systems: filteredSystems });
});

/** GET /api/v1/data-assets/:id */
router.get('/:id', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  res.json({ success: true, data: asset });
});

/** POST /api/v1/data-assets */
router.post('/', (req: Request, res: Response) => {
  const { name, description, systemId, owner, steward, governanceTier, healthScore, orgId } = req.body;
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
    createdAt: now, updatedAt: now,
  };
  dataAssets.push(asset);
  res.status(201).json({ success: true, data: asset });
});

/** PUT /api/v1/data-assets/:id */
router.put('/:id', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }

  const { name, description, systemId, owner, steward, governanceTier, healthScore } = req.body;
  if (name !== undefined) asset.name = name;
  if (description !== undefined) asset.description = description;
  if (systemId !== undefined) asset.systemId = systemId;
  if (owner !== undefined) asset.owner = owner;
  if (steward !== undefined) asset.steward = steward;
  if (governanceTier !== undefined && VALID_TIERS.includes(governanceTier)) asset.governanceTier = governanceTier;
  if (healthScore !== undefined && typeof healthScore === 'number') asset.healthScore = Math.max(0, Math.min(100, healthScore));
  asset.updatedAt = new Date().toISOString();
  res.json({ success: true, data: asset });
});

/** DELETE /api/v1/data-assets/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = dataAssets.findIndex((a) => a.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  dataAssets.splice(idx, 1);
  res.status(204).send();
});

export default router;
