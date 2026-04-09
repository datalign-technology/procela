import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { dataAssets } from './data-assets';

interface DataQualityRule {
  id: string;
  orgId: string;
  dataAssetId: string;
  dimension: 'COMPLETENESS' | 'ACCURACY' | 'TIMELINESS' | 'CONSISTENCY' | 'UNIQUENESS' | 'VALIDITY';
  name: string;
  description: string;
  threshold: number;
  currentScore: number;
  weight: number;
  status: 'PASSING' | 'FAILING' | 'WARNING' | 'NOT_MEASURED';
  lastMeasured: string | null;
  createdAt: string;
  updatedAt: string;
}

export const dataQualityRules: DataQualityRule[] = loadStore<DataQualityRule>('dataQualityRules');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const QUALITY_DIMENSIONS = ['COMPLETENESS', 'ACCURACY', 'TIMELINESS', 'CONSISTENCY', 'UNIQUENESS', 'VALIDITY'];

function computeStatus(currentScore: number, threshold: number): DataQualityRule['status'] {
  if (currentScore >= threshold) return 'PASSING';
  if (currentScore >= threshold - 10) return 'WARNING';
  return 'FAILING';
}

const router = Router();

/** DELETE /api/v1/data-quality/all — delete all rules */
router.delete('/all', (_req: Request, res: Response) => {
  const count = dataQualityRules.length;
  dataQualityRules.splice(0, dataQualityRules.length);
  saveStore('dataQualityRules', dataQualityRules);
  auditService.log(DEV_ORG_ID, null, 'DataQualityRule', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all data quality rules');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-quality — list all (support ?orgId= and ?dataAssetId= filters), enrich with asset name */
router.get('/', (req: Request, res: Response) => {
  const { orgId, dataAssetId } = req.query;
  let filtered = dataQualityRules;
  if (orgId) filtered = filtered.filter((r) => r.orgId === orgId);
  if (dataAssetId) filtered = filtered.filter((r) => r.dataAssetId === dataAssetId);

  const enriched = filtered.map((rule) => {
    const asset = dataAssets.find((a) => a.id === rule.dataAssetId);
    return {
      ...rule,
      dataAssetName: asset?.name || '',
    };
  });

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-quality/summary — overall quality stats */
router.get('/summary', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataQualityRules.filter((r) => r.orgId === orgId) : dataQualityRules;

  const totalRules = filtered.length;
  const passingCount = filtered.filter((r) => r.status === 'PASSING').length;
  const warningCount = filtered.filter((r) => r.status === 'WARNING').length;
  const failingCount = filtered.filter((r) => r.status === 'FAILING').length;
  const notMeasuredCount = filtered.filter((r) => r.status === 'NOT_MEASURED').length;

  // Avg score per dimension
  const dimensionStats: Record<string, { total: number; count: number; avg: number }> = {};
  for (const dim of QUALITY_DIMENSIONS) {
    const dimRules = filtered.filter((r) => r.dimension === dim);
    const total = dimRules.reduce((sum, r) => sum + r.currentScore, 0);
    const count = dimRules.length;
    dimensionStats[dim] = { total, count, avg: count > 0 ? Math.round(total / count) : 0 };
  }

  const avgScore = totalRules > 0
    ? Math.round(filtered.reduce((sum, r) => sum + r.currentScore, 0) / totalRules)
    : 0;

  res.json({
    success: true,
    data: {
      totalRules,
      passingCount,
      warningCount,
      failingCount,
      notMeasuredCount,
      avgScore,
      dimensionStats,
    },
  });
});

/** GET /api/v1/data-quality/by-asset/:assetId — all rules for a data asset */
router.get('/by-asset/:assetId', (req: Request, res: Response) => {
  const { assetId } = req.params;
  const rules = dataQualityRules.filter((r) => r.dataAssetId === assetId);

  const enriched = rules.map((rule) => {
    const asset = dataAssets.find((a) => a.id === rule.dataAssetId);
    return { ...rule, dataAssetName: asset?.name || '' };
  });

  res.json({ success: true, data: enriched });
});

/** POST /api/v1/data-quality/compute-health/:assetId — compute weighted health score */
router.post('/compute-health/:assetId', (req: Request, res: Response) => {
  const { assetId } = req.params;
  const asset = dataAssets.find((a) => a.id === assetId);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }

  const rules = dataQualityRules.filter((r) => r.dataAssetId === assetId);
  if (rules.length === 0) {
    res.json({ success: true, data: { assetId, healthScore: asset.healthScore, rulesCount: 0, message: 'No rules defined for this asset' } });
    return;
  }

  const totalWeight = rules.reduce((sum, r) => sum + r.weight, 0);
  const weightedSum = rules.reduce((sum, r) => sum + r.currentScore * r.weight, 0);
  const healthScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  // Update the data asset's healthScore
  asset.healthScore = healthScore;
  asset.updatedAt = new Date().toISOString();
  saveStore('dataAssets', dataAssets);

  res.json({
    success: true,
    data: {
      assetId,
      healthScore,
      rulesCount: rules.length,
      totalWeight,
    },
  });
});

/** GET /api/v1/data-quality/:id */
router.get('/:id', (req: Request, res: Response) => {
  const rule = dataQualityRules.find((r) => r.id === req.params.id);
  if (!rule) { res.status(404).json({ success: false, error: 'Quality rule not found' }); return; }
  res.json({ success: true, data: rule });
});

/** POST /api/v1/data-quality — create rule */
router.post('/', (req: Request, res: Response) => {
  const { dataAssetId, dimension, name, description, threshold, currentScore, weight, orgId } = req.body;

  if (!dataAssetId || !name) {
    res.status(400).json({ success: false, error: 'dataAssetId and name are required' });
    return;
  }

  const validDimension = dimension && QUALITY_DIMENSIONS.includes(dimension) ? dimension : 'COMPLETENESS';
  const validThreshold = typeof threshold === 'number' ? Math.max(0, Math.min(100, threshold)) : 80;
  const validScore = typeof currentScore === 'number' ? Math.max(0, Math.min(100, currentScore)) : 0;
  const validWeight = typeof weight === 'number' ? Math.max(1, Math.min(10, weight)) : 5;

  const status = validScore > 0 ? computeStatus(validScore, validThreshold) : 'NOT_MEASURED';

  const now = new Date().toISOString();
  const rule: DataQualityRule = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    dataAssetId,
    dimension: validDimension,
    name,
    description: description || '',
    threshold: validThreshold,
    currentScore: validScore,
    weight: validWeight,
    status,
    lastMeasured: validScore > 0 ? now : null,
    createdAt: now,
    updatedAt: now,
  };

  dataQualityRules.push(rule);
  saveStore('dataQualityRules', dataQualityRules);
  auditService.log(rule.orgId, null, 'DataQualityRule', rule.id, 'CREATE', null, rule);
  res.status(201).json({ success: true, data: rule });
});

/** PUT /api/v1/data-quality/:id — update rule */
router.put('/:id', (req: Request, res: Response) => {
  const rule = dataQualityRules.find((r) => r.id === req.params.id);
  if (!rule) { res.status(404).json({ success: false, error: 'Quality rule not found' }); return; }

  const { dataAssetId, dimension, name, description, threshold, currentScore, weight } = req.body;

  if (dataAssetId !== undefined) rule.dataAssetId = dataAssetId;
  if (dimension !== undefined && QUALITY_DIMENSIONS.includes(dimension)) rule.dimension = dimension;
  if (name !== undefined) rule.name = name;
  if (description !== undefined) rule.description = description;
  if (threshold !== undefined && typeof threshold === 'number') rule.threshold = Math.max(0, Math.min(100, threshold));
  if (weight !== undefined && typeof weight === 'number') rule.weight = Math.max(1, Math.min(10, weight));

  if (currentScore !== undefined && typeof currentScore === 'number') {
    rule.currentScore = Math.max(0, Math.min(100, currentScore));
    rule.lastMeasured = new Date().toISOString();
    // Auto-compute status when score is updated
    rule.status = computeStatus(rule.currentScore, rule.threshold);
  }

  // Also recompute status if threshold changed but score didn't
  if (threshold !== undefined && currentScore === undefined && rule.currentScore > 0) {
    rule.status = computeStatus(rule.currentScore, rule.threshold);
  }

  rule.updatedAt = new Date().toISOString();
  saveStore('dataQualityRules', dataQualityRules);
  auditService.log(rule.orgId, null, 'DataQualityRule', rule.id, 'UPDATE', null, rule);
  res.json({ success: true, data: rule });
});

/** DELETE /api/v1/data-quality/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = dataQualityRules.findIndex((r) => r.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Quality rule not found' }); return; }
  auditService.log(DEV_ORG_ID, null, 'DataQualityRule', dataQualityRules[idx].id, 'DELETE', dataQualityRules[idx], null);
  dataQualityRules.splice(idx, 1);
  saveStore('dataQualityRules', dataQualityRules);
  res.status(204).send();
});

export default router;
