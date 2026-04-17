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

// ── Data Asset Bindings ──────────────────────────────────────────────────
//
// A binding connects a Data Asset (stable business identity) to a specific
// physical location: a Connection + a table/file + (optionally) a column.
// The asset stays the same when you unlink one location and point to
// another — that's the whole reason bindings are separate rows.
//
// The model allows multiple bindings per asset (dev/staging/prod, primary/
// failover) but the current UI operates on one-at-a-time. `isPrimary`
// marks the binding that DQ rules, lineage, etc. default to; exactly one
// binding per asset should have it set when any bindings exist.

export interface StoredDataAssetBinding {
  id: string;
  orgId: string;
  dataAssetId: string;
  connectionId: string;
  sourceAsset: string;      // table / file / endpoint / sheet name
  sourceColumn?: string;    // specific column; null = whole asset
  label?: string;           // free-form, e.g. "prod"
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export const dataAssetBindings: StoredDataAssetBinding[] =
  loadStore<StoredDataAssetBinding>('dataAssetBindings');

/**
 * One-time migration: any existing Data Asset that still carries the legacy
 * `sourceConnectionId` triplet gets a synthetic primary binding. The legacy
 * fields stay on the asset (deprecated shadow state) so consumers that
 * haven't been updated still work; new code should go through bindings.
 */
function migrateLegacySourceFieldsToBindings(): void {
  let migrated = 0;
  const now = new Date().toISOString();
  for (const asset of dataAssets) {
    if (!asset.sourceConnectionId || !asset.sourceAsset) continue;
    const existing = dataAssetBindings.find(
      (b) => b.dataAssetId === asset.id && b.connectionId === asset.sourceConnectionId,
    );
    if (existing) continue;
    dataAssetBindings.push({
      id: uuid(),
      orgId: asset.orgId,
      dataAssetId: asset.id,
      connectionId: asset.sourceConnectionId,
      sourceAsset: asset.sourceAsset,
      sourceColumn: asset.sourceColumn,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    });
    migrated++;
  }
  if (migrated > 0) {
    saveStore('dataAssetBindings', dataAssetBindings);
    logger.info({ migrated }, 'Migrated legacy source fields to DataAssetBindings');
  }
}
migrateLegacySourceFieldsToBindings();

// ── Data Asset Columns ──────────────────────────────────────────────────
//
// Columns are the measurable data points within a Data Asset. A Data Asset
// represents the business concept ("Customer Accounts"); columns represent
// the individual fields ("email", "phone", "created_at"). DQ rules target
// columns specifically, and asset health rolls up from column-level scores.
//
// Columns can be auto-populated from a connection's discovery output (the
// Link flow offers this), or manually added.

export interface StoredDataAssetColumn {
  id: string;
  dataAssetId: string;
  columnName: string;         // e.g. "email", "customer_id"
  dataType?: string;          // e.g. "VARCHAR", "INTEGER", "DATE" — discovered or user-set
  description?: string;       // business description
  sourceConnectionId?: string;
  sourceAsset?: string;       // physical table/file this column came from
  sourceColumn?: string;      // physical column name if different from columnName
  createdAt: string;
  updatedAt: string;
}

export const dataAssetColumns: StoredDataAssetColumn[] =
  loadStore<StoredDataAssetColumn>('dataAssetColumns');

/**
 * Resolve the primary binding for an asset, or undefined if it isn't linked
 * to a physical location yet. Exported so other modules (DQ engine,
 * lineage, dashboards) can consume it without reaching into the array.
 */
export function getPrimaryBinding(assetId: string): StoredDataAssetBinding | undefined {
  const own = dataAssetBindings.filter((b) => b.dataAssetId === assetId);
  return own.find((b) => b.isPrimary) || own[0];
}

/**
 * Remove every binding that points at a given connection. Called by the
 * connections route when a connection is deleted so no orphaned bindings
 * linger.
 */
export function purgeBindingsForConnection(connectionId: string): number {
  const victims = dataAssetBindings.filter((b) => b.connectionId === connectionId);
  for (const v of victims) {
    const idx = dataAssetBindings.indexOf(v);
    if (idx !== -1) dataAssetBindings.splice(idx, 1);
  }
  if (victims.length > 0) saveStore('dataAssetBindings', dataAssetBindings);
  return victims.length;
}

const router = Router();

/** DELETE /api/v1/data-assets/all — delete all data assets */
router.delete('/all', (_req: Request, res: Response) => {
  const count = dataAssets.length;
  dataAssets.splice(0, dataAssets.length);
  saveStore('dataAssets', dataAssets);
  // Wipe bindings alongside the assets they were pointing at.
  const bindingCount = dataAssetBindings.length;
  dataAssetBindings.splice(0, dataAssetBindings.length);
  saveStore('dataAssetBindings', dataAssetBindings);
  auditService.log(DEV_ORG_ID, null, 'DataAsset', '*', 'DELETE_ALL', null, { count, bindingCount });
  logger.info({ count, bindingCount }, 'Deleted all data assets and their bindings');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-assets */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataAssets.filter((a) => a.orgId === orgId) : dataAssets;
  const filteredSystems = orgId ? systems.filter((s) => s.orgId === orgId) : systems;

  // Enrich each asset with domain, owner, steward and health info so the
  // table can display them without a per-row 360 fetch.
  const enriched = filtered.map((asset) => {
    const domain = dataDomains.find((d) => d.dataAssetIds?.includes(asset.id));
    let domainName: string | null = null;
    let ownerName: string | null = null;
    let stewardName: string | null = null;
    if (domain) {
      domainName = domain.name;
      if (domain.ownerId) ownerName = people.find((p) => p.id === domain.ownerId)?.name || null;
      if (domain.stewardIds?.length > 0) {
        stewardName = domain.stewardIds
          .map((sid: string) => people.find((p) => p.id === sid)?.name)
          .filter(Boolean)
          .join(', ') || null;
      }
    }
    return { ...asset, domainName, ownerName, stewardName };
  });

  res.json({ success: true, data: enriched, systems: filteredSystems });
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

// ── Bindings ─────────────────────────────────────────────────────────────
// MUST be declared before `GET /:id` or Express resolves `/:id/bindings`
// as `{ id: "bindings" }` → 404.

/** GET /api/v1/data-assets/:id/bindings — list bindings for an asset */
router.get('/:id/bindings', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const bindings = dataAssetBindings.filter((b) => b.dataAssetId === asset.id);
  res.json({ success: true, data: bindings });
});

/**
 * POST /api/v1/data-assets/:id/bindings
 *
 * Link a Data Asset to a concrete location on a Connection. Body:
 *   { connectionId, sourceAsset, sourceColumn?, label?, isPrimary? }
 *
 * If this is the asset's first binding it's automatically marked primary.
 * If `isPrimary: true` is sent, any previously-primary binding is demoted.
 */
router.post('/:id/bindings', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }

  const { connectionId, sourceAsset, sourceColumn, label, isPrimary } = req.body;
  if (!connectionId || typeof connectionId !== 'string') {
    res.status(400).json({ success: false, error: 'connectionId is required' });
    return;
  }
  if (!sourceAsset || typeof sourceAsset !== 'string') {
    res.status(400).json({ success: false, error: 'sourceAsset is required (the table / file / endpoint name)' });
    return;
  }

  // Look up the connection lazily so we don't create a static import cycle
  // with the connections route (which imports back into routes/data-assets
  // via the discover flow in the past).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connections } = require('./connections') as typeof import('./connections');
  const conn = connections.find((c) => c.id === connectionId);
  if (!conn) {
    res.status(400).json({ success: false, error: 'Connection not found' });
    return;
  }

  const existing = dataAssetBindings.filter((b) => b.dataAssetId === asset.id);
  const shouldBePrimary = isPrimary === true || existing.length === 0;
  if (shouldBePrimary) {
    // Demote any previously primary binding so there's only one active.
    for (const b of existing) {
      if (b.isPrimary) { b.isPrimary = false; b.updatedAt = new Date().toISOString(); }
    }
  }

  const now = new Date().toISOString();
  const binding: StoredDataAssetBinding = {
    id: uuid(),
    orgId: asset.orgId,
    dataAssetId: asset.id,
    connectionId,
    sourceAsset,
    sourceColumn: sourceColumn || undefined,
    label: label || undefined,
    isPrimary: shouldBePrimary,
    createdAt: now,
    updatedAt: now,
  };
  dataAssetBindings.push(binding);
  saveStore('dataAssetBindings', dataAssetBindings);
  auditService.log(asset.orgId, null, 'DataAssetBinding', binding.id, 'CREATE', null, binding);
  res.status(201).json({ success: true, data: binding });
});

/**
 * PUT /api/v1/data-assets/:id/bindings/:bindingId
 *
 * Update a binding's source asset/column/label/primary flag. Connection
 * cannot be changed here — to point at a different connection, delete
 * this binding and create a new one (mirrors the "unlink → link"
 * interaction the UI offers).
 */
router.put('/:id/bindings/:bindingId', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const binding = dataAssetBindings.find((b) => b.id === req.params.bindingId && b.dataAssetId === asset.id);
  if (!binding) { res.status(404).json({ success: false, error: 'Binding not found' }); return; }

  const { sourceAsset, sourceColumn, label, isPrimary } = req.body;
  if (sourceAsset !== undefined) binding.sourceAsset = sourceAsset;
  if (sourceColumn !== undefined) binding.sourceColumn = sourceColumn || undefined;
  if (label !== undefined) binding.label = label || undefined;
  if (isPrimary === true && !binding.isPrimary) {
    for (const b of dataAssetBindings) {
      if (b.dataAssetId === asset.id && b !== binding && b.isPrimary) {
        b.isPrimary = false; b.updatedAt = new Date().toISOString();
      }
    }
    binding.isPrimary = true;
  }
  binding.updatedAt = new Date().toISOString();
  saveStore('dataAssetBindings', dataAssetBindings);
  auditService.log(asset.orgId, null, 'DataAssetBinding', binding.id, 'UPDATE', null, binding);
  res.json({ success: true, data: binding });
});

/**
 * DELETE /api/v1/data-assets/:id/bindings/:bindingId
 *
 * Unlink a binding. If the removed binding was primary and other bindings
 * exist, the next one in creation order is promoted to primary so the
 * asset still has a canonical location.
 */
router.delete('/:id/bindings/:bindingId', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const idx = dataAssetBindings.findIndex((b) => b.id === req.params.bindingId && b.dataAssetId === asset.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Binding not found' }); return; }
  const removed = dataAssetBindings[idx];
  dataAssetBindings.splice(idx, 1);

  // Promote a successor so there's still one primary when any bindings remain.
  if (removed.isPrimary) {
    const remaining = dataAssetBindings.filter((b) => b.dataAssetId === asset.id);
    if (remaining.length > 0) {
      const next = remaining.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      next.isPrimary = true;
      next.updatedAt = new Date().toISOString();
    }
  }
  saveStore('dataAssetBindings', dataAssetBindings);
  auditService.log(asset.orgId, null, 'DataAssetBinding', removed.id, 'DELETE', removed, null);
  res.status(204).send();
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
  const removed = dataAssets[idx];
  dataAssets.splice(idx, 1);
  saveStore('dataAssets', dataAssets);
  // Cascade: delete this asset's bindings so they don't linger.
  const ownBindings = dataAssetBindings.filter((b) => b.dataAssetId === removed.id);
  for (const b of ownBindings) {
    const bi = dataAssetBindings.indexOf(b);
    if (bi !== -1) dataAssetBindings.splice(bi, 1);
  }
  if (ownBindings.length > 0) saveStore('dataAssetBindings', dataAssetBindings);
  res.status(204).send();
});

// ──────────────────────────────────────────────────────────────────────────
// Column CRUD — nested under /data-assets/:id/columns
// ──────────────────────────────────────────────────────────────────────────

/** GET /data-assets/:id/columns — list columns for an asset, enriched with
 *  per-column DQ rule summary (count, passing, failing, health score). */
router.get('/:id/columns', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const cols = dataAssetColumns.filter((c) => c.dataAssetId === asset.id);

  // Lazy-import DQ rules to avoid circular dep at module level.
  let dqRules: any[] = [];
  try { dqRules = require('./data-quality').dataQualityRules || []; } catch { /* */ }

  const enriched = cols.map((col) => {
    const rules = dqRules.filter((r: any) => r.dataAssetId === asset.id && r.columnId === col.id);
    const passing = rules.filter((r: any) => r.status === 'PASSING').length;
    const failing = rules.filter((r: any) => r.status === 'FAILING').length;
    const warning = rules.filter((r: any) => r.status === 'WARNING').length;
    const totalWeight = rules.reduce((s: number, r: any) => s + (r.weight || 5), 0);
    const weightedSum = rules.reduce((s: number, r: any) => s + (r.currentScore || 0) * (r.weight || 5), 0);
    const health = rules.length > 0 && totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;
    const enrichedRules = rules.map((r: any) => ({
      id: r.id, name: r.name, ruleType: r.ruleType || null,
      dimension: r.dimension, threshold: r.threshold,
      currentScore: r.currentScore, status: r.status,
      lastMeasured: r.lastMeasured, weight: r.weight,
      scheduleFrequency: r.scheduleFrequency || 'NEVER',
      nextRunAt: r.nextRunAt || null,
    }));
    return {
      ...col,
      rulesCount: rules.length,
      rulesPassing: passing,
      rulesFailing: failing,
      rulesWarning: warning,
      healthScore: health,
      rules: enrichedRules,
    };
  });

  res.json({ success: true, data: enriched });
});

/** POST /data-assets/:id/columns — create a column */
router.post('/:id/columns', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const { columnName, dataType, description, sourceConnectionId, sourceAsset, sourceColumn } = req.body;
  if (!columnName) { res.status(400).json({ success: false, error: 'columnName is required' }); return; }
  const now = new Date().toISOString();
  const col: StoredDataAssetColumn = {
    id: uuid(), dataAssetId: asset.id, columnName,
    dataType: dataType || '', description: description || '',
    sourceConnectionId: sourceConnectionId || undefined,
    sourceAsset: sourceAsset || undefined,
    sourceColumn: sourceColumn || columnName,
    createdAt: now, updatedAt: now,
  };
  dataAssetColumns.push(col);
  saveStore('dataAssetColumns', dataAssetColumns);
  res.status(201).json({ success: true, data: col });
});

/** PUT /data-assets/:id/columns/:colId — update a column */
router.put('/:id/columns/:colId', (req: Request, res: Response) => {
  const col = dataAssetColumns.find((c) => c.id === req.params.colId && c.dataAssetId === req.params.id);
  if (!col) { res.status(404).json({ success: false, error: 'Column not found' }); return; }
  const { columnName, dataType, description } = req.body;
  if (columnName !== undefined) col.columnName = columnName;
  if (dataType !== undefined) col.dataType = dataType;
  if (description !== undefined) col.description = description;
  col.updatedAt = new Date().toISOString();
  saveStore('dataAssetColumns', dataAssetColumns);
  res.json({ success: true, data: col });
});

/** DELETE /data-assets/:id/columns/:colId — delete a column */
router.delete('/:id/columns/:colId', (req: Request, res: Response) => {
  const idx = dataAssetColumns.findIndex((c) => c.id === req.params.colId && c.dataAssetId === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Column not found' }); return; }
  dataAssetColumns.splice(idx, 1);
  saveStore('dataAssetColumns', dataAssetColumns);
  res.status(204).send();
});

/**
 * POST /data-assets/:id/columns/auto-discover
 *
 * Reads the asset's primary binding, calls the connection's discover
 * endpoint to enumerate columns, and creates DataAssetColumn records for
 * any columns that don't already exist. Idempotent — re-running it picks
 * up new columns without duplicating existing ones.
 */
router.post('/:id/columns/auto-discover', async (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const binding = getPrimaryBinding(asset.id);
  if (!binding) {
    res.status(400).json({ success: false, error: 'Asset has no connection binding. Link it to a connection first.' });
    return;
  }
  // Import the connector dynamically to avoid circular deps at module level.
  const { connections } = require('./connections');
  const conn = connections.find((c: any) => c.id === binding.connectionId);
  if (!conn) {
    res.status(400).json({ success: false, error: 'The linked connection no longer exists.' });
    return;
  }
  try {
    // Use the shared connector service — it handles LOCAL files with real
    // parsing and simulates discovery for DATABASE, API, WAREHOUSE, etc.
    const { discoverAssets } = require('../services/connector.service');
    const result = await discoverAssets(conn);

    let discoveredColumns: string[] = [];
    if (result.success && result.details?.assets) {
      // Find the asset whose name matches the binding's sourceAsset.
      const matchingAsset = result.details.assets.find(
        (a: any) => a.name === binding.sourceAsset,
      );
      if (matchingAsset?.columns) {
        discoveredColumns = matchingAsset.columns;
      } else if (result.details.assets.length > 0 && !binding.sourceAsset) {
        // No sourceAsset on the binding (rare) — take columns from the
        // first discovered asset as a best-effort fallback.
        discoveredColumns = result.details.assets[0].columns || [];
      }
    }
    // Fallback: if the connection config itself has a columns array
    // (populated during the original test/upload for LOCAL files).
    if (discoveredColumns.length === 0 && conn.config?.columns && Array.isArray(conn.config.columns)) {
      discoveredColumns = conn.config.columns;
    }
    if (discoveredColumns.length === 0) {
      res.json({ success: true, data: [], message: 'No columns discovered from this connection.' });
      return;
    }
    const existing = dataAssetColumns.filter((c) => c.dataAssetId === asset.id);
    const existingNames = new Set(existing.map((c) => c.columnName.toLowerCase()));
    const now = new Date().toISOString();
    const created: StoredDataAssetColumn[] = [];
    for (const colName of discoveredColumns) {
      if (existingNames.has(colName.toLowerCase())) continue;
      const col: StoredDataAssetColumn = {
        id: uuid(), dataAssetId: asset.id, columnName: colName,
        dataType: '', description: '',
        sourceConnectionId: binding.connectionId,
        sourceAsset: binding.sourceAsset,
        sourceColumn: colName,
        createdAt: now, updatedAt: now,
      };
      dataAssetColumns.push(col);
      created.push(col);
    }
    if (created.length > 0) saveStore('dataAssetColumns', dataAssetColumns);
    res.json({ success: true, data: created, message: `Discovered ${created.length} new column(s).`, total: existing.length + created.length });
  } catch (err: any) {
    logger.error({ err, assetId: asset.id }, 'Column auto-discover failed');
    res.status(500).json({ success: false, error: err?.message || 'Discovery failed' });
  }
});

export default router;
