import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { dataAssets, getPrimaryBinding } from './data-assets';
import { connections } from './connections';
import {
  evaluateRule,
  suggestTemplates,
  describeRule,
  RULE_TEMPLATES,
  RuleType,
  RuleParameters,
  RuleRunResult,
  DescribeContext,
} from '../services/dq-engine';

interface DataQualityRule {
  id: string;
  orgId: string;
  dataAssetId: string;
  // Optional: when set, the rule targets a specific column within the
  // asset. When null/undefined, it targets the asset as a whole (legacy
  // behaviour). New rules should always target a column.
  columnId?: string;
  columnName?: string; // denormalised for display; set from the column record at creation time
  dimension: 'COMPLETENESS' | 'ACCURACY' | 'TIMELINESS' | 'CONSISTENCY' | 'UNIQUENESS' | 'VALIDITY';
  name: string;
  description: string;
  threshold: number;
  currentScore: number;
  weight: number;
  status: 'PASSING' | 'FAILING' | 'WARNING' | 'NOT_MEASURED';
  lastMeasured: string | null;
  // Typed-rule extensions. Older rules (without these) still work as
  // manual "set a score" rows; new rules created from templates carry a
  // concrete ruleType + params and can be executed by the DQ engine.
  ruleType?: RuleType;
  parameters?: RuleParameters;
  lastRun?: RuleRunResult;
  // Stable id of the OOTB template this rule was created from (e.g.
  // 'not-null', 'regex-email'). Empty / undefined when the rule was
  // hand-built via the CUSTOM template or migrated from legacy data.
  // Used to hide already-used templates from the templates list.
  templateId?: string;
  // Schedule — when set, a backend tick auto-runs this rule on the
  // chosen cadence and updates `nextRunAt`. 'NEVER' (or undefined) is
  // a manual-only rule.
  scheduleFrequency?: 'NEVER' | 'HOURLY' | 'DAILY' | 'WEEKLY';
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

const VALID_RULE_TYPES: RuleType[] = [
  'NOT_NULL', 'UNIQUE', 'REGEX_MATCH', 'IN_SET', 'NUMERIC_RANGE', 'LENGTH_RANGE', 'CUSTOM',
];

const VALID_SCHEDULE_FREQUENCIES = ['NEVER', 'HOURLY', 'DAILY', 'WEEKLY'] as const;
type ScheduleFrequency = typeof VALID_SCHEDULE_FREQUENCIES[number];

/**
 * Roll the `nextRunAt` timestamp forward by one cadence interval. Returns
 * an ISO string. NEVER yields null (meaning "do not auto-run").
 *
 * Cadences are deliberately wall-clock simple: from `from`, advance by
 * one hour / day / week. No timezone arithmetic.
 */
function computeNextRunAt(freq: ScheduleFrequency, from: string | Date): string | null {
  if (freq === 'NEVER') return null;
  const fromDate = typeof from === 'string' ? new Date(from) : from;
  const ms =
    freq === 'HOURLY' ? 60 * 60 * 1000 :
    freq === 'DAILY' ? 24 * 60 * 60 * 1000 :
    freq === 'WEEKLY' ? 7 * 24 * 60 * 60 * 1000 :
    0;
  return new Date(fromDate.getTime() + ms).toISOString();
}

/**
 * Build the DescribeContext for a rule by looking up its Data Asset and the
 * source connection. Returns an empty context when the asset / connection
 * can't be resolved so placeholders are used in the rendered definition.
 */
function contextForRule(rule: DataQualityRule): DescribeContext {
  const asset = dataAssets.find((a) => a.id === rule.dataAssetId);
  if (!asset) return {};
  // Prefer the asset's primary binding. Fall back to the legacy shadow
  // fields (`asset.sourceConnectionId` etc.) so pre-binding rows still
  // resolve correctly until they're migrated.
  const binding = getPrimaryBinding(asset.id);
  const connId = binding?.connectionId || asset.sourceConnectionId;
  const conn = connId ? connections.find((c) => c.id === connId) : undefined;
  return {
    connectionType: conn?.connectionType,
    storageType: conn?.config?.storageType,
    dbType: conn?.config?.dbType,
    sourceAsset: binding?.sourceAsset || asset.sourceAsset,
    sourceColumn: binding?.sourceColumn || asset.sourceColumn,
    originalFileName: conn?.config?.originalFileName,
  };
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
    const definition = rule.ruleType
      ? describeRule(rule.ruleType, rule.parameters || {}, contextForRule(rule))
      : null;
    return {
      ...rule,
      dataAssetName: asset?.name || '',
      definition,
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
    const definition = rule.ruleType
      ? describeRule(rule.ruleType, rule.parameters || {}, contextForRule(rule))
      : null;
    return { ...rule, dataAssetName: asset?.name || '', definition };
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

/**
 * GET /api/v1/data-quality/templates?column=<name>&assetId=<id>
 *
 * Returns the OOTB rule template catalog, split into `suggested` (templates
 * whose column-name heuristic matches the requested column) and `generic`
 * (applicable to any column). When `assetId` is provided each template
 * also carries a `definition` showing the concrete SQL / JS / pseudocode
 * that would run against the asset's bound source.
 *
 * IMPORTANT: must be declared before `GET /:id` — otherwise Express
 * matches this request against the `:id` route and returns a 404.
 */
router.get('/templates', (req: Request, res: Response) => {
  const column = typeof req.query.column === 'string' ? req.query.column : undefined;
  const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : undefined;
  const { suggested, generic } = suggestTemplates(column);

  // Resolve the describe context once if the caller provided an assetId.
  // Prefer the asset's primary binding (new model); fall back to the
  // legacy shadow fields for un-migrated rows.
  let ctx: DescribeContext = {};
  if (assetId) {
    const asset = dataAssets.find((a) => a.id === assetId);
    if (asset) {
      const binding = getPrimaryBinding(asset.id);
      const connId = binding?.connectionId || asset.sourceConnectionId;
      const conn = connId ? connections.find((c) => c.id === connId) : undefined;
      ctx = {
        connectionType: conn?.connectionType,
        storageType: conn?.config?.storageType,
        dbType: conn?.config?.dbType,
        sourceAsset: binding?.sourceAsset || asset.sourceAsset,
        sourceColumn: binding?.sourceColumn || asset.sourceColumn,
        originalFileName: conn?.config?.originalFileName,
      };
    }
  }

  const project = (t: typeof RULE_TEMPLATES[number]) => ({
    id: t.id,
    ruleType: t.ruleType,
    dimension: t.dimension,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    definition: describeRule(t.ruleType, t.parameters, ctx),
  });
  res.json({
    success: true,
    data: {
      suggested: suggested.map(project),
      generic: generic.map(project),
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
  const { dataAssetId, columnId, dimension, name, description, threshold, currentScore, weight, orgId,
    ruleType, parameters, templateId, scheduleFrequency } = req.body;

  if (!dataAssetId || !name) {
    res.status(400).json({ success: false, error: 'dataAssetId and name are required' });
    return;
  }

  const validDimension = dimension && QUALITY_DIMENSIONS.includes(dimension) ? dimension : 'COMPLETENESS';
  const validThreshold = typeof threshold === 'number' ? Math.max(0, Math.min(100, threshold)) : 80;
  const validScore = typeof currentScore === 'number' ? Math.max(0, Math.min(100, currentScore)) : 0;
  const validWeight = typeof weight === 'number' ? Math.max(1, Math.min(10, weight)) : 5;
  const validRuleType: RuleType | undefined = ruleType && VALID_RULE_TYPES.includes(ruleType) ? ruleType : undefined;
  const validSchedule = VALID_SCHEDULE_FREQUENCIES.includes(scheduleFrequency) ? scheduleFrequency : 'NEVER';

  const status = validScore > 0 ? computeStatus(validScore, validThreshold) : 'NOT_MEASURED';

  // If no explicit orgId, inherit from the owning asset so rules always
  // live in the same tenant as the asset they measure.
  const ownerAsset = dataAssets.find((a) => a.id === dataAssetId);
  const resolvedOrgId = orgId || ownerAsset?.orgId || DEV_ORG_ID;

  const now = new Date().toISOString();
  const rule: DataQualityRule = {
    id: uuid(),
    orgId: resolvedOrgId,
    dataAssetId,
    ...(columnId ? { columnId } : {}),
    ...(columnId ? (() => {
      // Resolve column name for display convenience.
      const { dataAssetColumns } = require('./data-assets');
      const col = dataAssetColumns.find((c: any) => c.id === columnId);
      return col ? { columnName: col.columnName } : {};
    })() : {}),
    dimension: validDimension,
    name,
    description: description || '',
    threshold: validThreshold,
    currentScore: validScore,
    weight: validWeight,
    status,
    lastMeasured: validScore > 0 ? now : null,
    ...(validRuleType ? { ruleType: validRuleType } : {}),
    ...(parameters && typeof parameters === 'object' ? { parameters } : {}),
    ...(typeof templateId === 'string' && templateId ? { templateId } : {}),
    scheduleFrequency: validSchedule,
    nextRunAt: validSchedule === 'NEVER' ? null : computeNextRunAt(validSchedule, now),
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

  const { dataAssetId, dimension, name, description, threshold, currentScore, weight,
    ruleType, parameters, templateId, scheduleFrequency } = req.body;

  if (dataAssetId !== undefined) rule.dataAssetId = dataAssetId;
  if (dimension !== undefined && QUALITY_DIMENSIONS.includes(dimension)) rule.dimension = dimension;
  if (name !== undefined) rule.name = name;
  if (description !== undefined) rule.description = description;
  if (threshold !== undefined && typeof threshold === 'number') rule.threshold = Math.max(0, Math.min(100, threshold));
  if (weight !== undefined && typeof weight === 'number') rule.weight = Math.max(1, Math.min(10, weight));
  if (ruleType !== undefined && VALID_RULE_TYPES.includes(ruleType)) rule.ruleType = ruleType;
  if (parameters !== undefined && typeof parameters === 'object' && parameters !== null) rule.parameters = parameters;
  if (templateId !== undefined) rule.templateId = templateId || undefined;
  if (scheduleFrequency !== undefined && VALID_SCHEDULE_FREQUENCIES.includes(scheduleFrequency)) {
    rule.scheduleFrequency = scheduleFrequency;
    // Re-derive nextRunAt from "now" so the cadence starts fresh on
    // change. NEVER clears the schedule entirely.
    rule.nextRunAt = scheduleFrequency === 'NEVER' ? null : computeNextRunAt(scheduleFrequency, new Date());
  }

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

/**
 * POST /api/v1/data-quality/:id/run
 *
 * Execute the rule against its Data Asset's source. For assets imported
 * from a FILE_STORAGE/LOCAL connection column we read the uploaded file
 * and compute real pass/fail numbers; every other connection type returns
 * a clearly-labelled simulated result.
 */
router.post('/:id/run', (req: Request, res: Response) => {
  const rule = dataQualityRules.find((r) => r.id === req.params.id);
  if (!rule) { res.status(404).json({ success: false, error: 'Quality rule not found' }); return; }
  if (!rule.ruleType) {
    res.status(400).json({ success: false, error: 'This rule has no ruleType — it was created as a manual score rather than a typed DQ rule.' });
    return;
  }

  const result = runRuleNow(rule);
  if (!result) { res.status(404).json({ success: false, error: 'Linked data asset not found' }); return; }
  res.json({ success: true, data: result.engineResult });
});

/**
 * Execute a single rule against its asset, persist the result, advance
 * the schedule cursor if any, recompute the asset health score, and
 * audit the run. Used by both the manual /run route and the scheduler
 * tick so the side effects stay in one place.
 *
 * Returns null if the linked asset can't be found (orphaned rule).
 */
function runRuleNow(rule: DataQualityRule): { engineResult: RuleRunResult; assetHealth: number } | null {
  const asset = dataAssets.find((a) => a.id === rule.dataAssetId);
  if (!asset) return null;

  const conn = asset.sourceConnectionId ? connections.find((c) => c.id === asset.sourceConnectionId) : undefined;

  const result = evaluateRule(rule.ruleType!, rule.parameters || {}, {
    connectionType: conn?.connectionType,
    storageType: conn?.config?.storageType,
    localFilePath: conn?.config?.localFilePath,
    sourceColumn: asset.sourceColumn,
    originalFileName: conn?.config?.originalFileName,
    assetId: asset.id,
    ruleId: rule.id,
  });

  rule.lastRun = result;
  rule.currentScore = result.passRate;
  rule.lastMeasured = result.ranAt;
  rule.status = computeStatus(result.passRate, rule.threshold);
  rule.updatedAt = result.ranAt;
  if (rule.scheduleFrequency && rule.scheduleFrequency !== 'NEVER') {
    rule.nextRunAt = computeNextRunAt(rule.scheduleFrequency as ScheduleFrequency, result.ranAt);
  }
  saveStore('dataQualityRules', dataQualityRules);

  // Auto-recompute the asset's health score from the weighted average.
  const assetRules = dataQualityRules.filter((r) => r.dataAssetId === asset.id);
  const totalWeight = assetRules.reduce((sum, r) => sum + r.weight, 0);
  const weightedSum = assetRules.reduce((sum, r) => sum + r.currentScore * r.weight, 0);
  const newAssetHealth = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  if (asset.healthScore !== newAssetHealth) {
    asset.healthScore = newAssetHealth;
    asset.updatedAt = result.ranAt;
    saveStore('dataAssets', dataAssets);
  }

  auditService.log(rule.orgId, null, 'DataQualityRule', rule.id, 'RUN', null, {
    simulated: result.simulated,
    passRate: result.passRate,
    totalRows: result.totalRows,
    assetHealthScore: newAssetHealth,
  });
  logger.info({ ruleId: rule.id, simulated: result.simulated, passRate: result.passRate, totalRows: result.totalRows, assetHealthScore: newAssetHealth }, 'DQ rule run');

  return { engineResult: result, assetHealth: newAssetHealth };
}

// ── Scheduler ────────────────────────────────────────────────────────────
//
// Tick once a minute. Runs any scheduled rule whose `nextRunAt` is in
// the past (or null/undefined for a freshly-scheduled rule that hasn't
// rolled forward yet). Skips legacy / typeless rules. The setInterval
// is unref'd so it doesn't keep test processes alive when the only
// thing pinning the event loop is the scheduler.
const SCHEDULER_TICK_MS = 60 * 1000;
function tickScheduler(): void {
  const now = new Date();
  for (const rule of dataQualityRules) {
    if (!rule.ruleType) continue;
    if (!rule.scheduleFrequency || rule.scheduleFrequency === 'NEVER') continue;
    const due = !rule.nextRunAt || new Date(rule.nextRunAt) <= now;
    if (!due) continue;
    try { runRuleNow(rule); }
    catch (err) {
      logger.error({ err, ruleId: rule.id }, 'Scheduled DQ rule run failed');
    }
  }
}
const schedulerHandle = setInterval(tickScheduler, SCHEDULER_TICK_MS);
if (typeof schedulerHandle.unref === 'function') schedulerHandle.unref();

export default router;
