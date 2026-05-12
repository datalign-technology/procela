import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { systems } from './systems';
import { dataAssets } from './data-assets';

interface DataLineageLink {
  id: string;
  orgId: string;
  sourceSystemId: string;
  targetSystemId: string;
  dataAssetId: string | null;
  description: string;
  flowType: 'ETL' | 'API' | 'FILE_TRANSFER' | 'REPLICATION' | 'MANUAL' | 'STREAMING';
  frequency: 'REAL_TIME' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ON_DEMAND';
  status: 'ACTIVE' | 'INACTIVE' | 'DEPRECATED';
  createdAt: string;
  updatedAt: string;
}

export const dataLineageLinks: DataLineageLink[] = loadStore<DataLineageLink>('dataLineageLinks');

// ── Asset-level lineage edges ─────────────────────────────────────────────
// The original DataLineageLink models system-to-system flows. For dbt
// manifest imports (and future SQL-log derivations) we need a finer
// asset-to-asset edge that carries the source of the derivation, so
// re-imports can replace prior edges from the same source without
// touching anything a human added.

export interface AssetLineageEdge {
  id: string;
  orgId: string;
  sourceAssetId: string;
  targetAssetId: string;
  /** Where this edge came from. 'manual' is reserved for future
   *  hand-drawn asset-level edges; today only dbt populates this store. */
  source: 'dbt' | 'manual';
  /** Free-form provenance string the importer fills in. For dbt this is
   *  the model's unique_id (e.g. "model.project.orders") - useful for
   *  debugging which manifest entry produced the edge. */
  sourceRef?: string;
  /** Last time this edge was seen by the importer. A re-import touches
   *  the timestamp; stale edges (whose sourceRef is no longer in the
   *  latest manifest) get deleted. */
  lastSeenAt: string;
  createdAt: string;
}

export const assetLineageEdges: AssetLineageEdge[] =
  loadStore<AssetLineageEdge>('assetLineageEdges');

// ── dbt asset mapping ────────────────────────────────────────────────────
// Maps a dbt unique_id (the manifest key) to the Procela DataAsset id it
// was first matched to. Survives re-imports so the same asset is updated
// rather than re-created. Kept in a side store so the DataAsset schema
// stays clean.

interface DbtAssetMapping {
  dbtUniqueId: string;
  assetId: string;
  orgId: string;
}

export const dbtAssetMappings: DbtAssetMapping[] =
  loadStore<DbtAssetMapping>('dbtAssetMappings');

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const FLOW_TYPES = ['ETL', 'API', 'FILE_TRANSFER', 'REPLICATION', 'MANUAL', 'STREAMING'];
const FREQUENCIES = ['REAL_TIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ON_DEMAND'];

const router = Router();

/** DELETE /api/v1/data-lineage/all — delete all lineage links */
router.delete('/all', (_req: Request, res: Response) => {
  const count = dataLineageLinks.length;
  dataLineageLinks.splice(0, dataLineageLinks.length);
  saveStore('dataLineageLinks', dataLineageLinks);
  auditService.log(DEV_ORG_ID, null, 'DataLineageLink', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all data lineage links');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-lineage — list all (support ?orgId= filter), enrich with system names and data asset name */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? dataLineageLinks.filter((l) => l.orgId === orgId) : dataLineageLinks;

  const enriched = filtered.map((link) => {
    const sourceSystem = systems.find((s) => s.id === link.sourceSystemId);
    const targetSystem = systems.find((s) => s.id === link.targetSystemId);
    const dataAsset = link.dataAssetId ? dataAssets.find((a) => a.id === link.dataAssetId) : null;
    return {
      ...link,
      sourceSystemName: sourceSystem?.name || '',
      targetSystemName: targetSystem?.name || '',
      dataAssetName: dataAsset?.name || '',
    };
  });

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-lineage/by-system/:systemId — get all lineage links involving a system */
router.get('/by-system/:systemId', (req: Request, res: Response) => {
  const { systemId } = req.params;
  const links = dataLineageLinks.filter(
    (l) => l.sourceSystemId === systemId || l.targetSystemId === systemId
  );

  const enriched = links.map((link) => {
    const sourceSystem = systems.find((s) => s.id === link.sourceSystemId);
    const targetSystem = systems.find((s) => s.id === link.targetSystemId);
    const dataAsset = link.dataAssetId ? dataAssets.find((a) => a.id === link.dataAssetId) : null;
    return {
      ...link,
      sourceSystemName: sourceSystem?.name || '',
      targetSystemName: targetSystem?.name || '',
      dataAssetName: dataAsset?.name || '',
    };
  });

  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-lineage/visualization — return data formatted for visualization */
router.get('/visualization', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filteredLinks = orgId ? dataLineageLinks.filter((l) => l.orgId === orgId) : dataLineageLinks;

  // Collect unique system IDs from lineage links
  const systemIds = new Set<string>();
  filteredLinks.forEach((link) => {
    systemIds.add(link.sourceSystemId);
    systemIds.add(link.targetSystemId);
  });

  const nodes = systems
    .filter((s) => systemIds.has(s.id))
    .map((s) => {
      const inbound = filteredLinks.filter((l) => l.targetSystemId === s.id).length;
      const outbound = filteredLinks.filter((l) => l.sourceSystemId === s.id).length;
      return {
        id: s.id,
        name: s.name,
        systemType: s.systemType,
        inboundCount: inbound,
        outboundCount: outbound,
      };
    });

  const links = filteredLinks.map((link) => {
    const dataAsset = link.dataAssetId ? dataAssets.find((a) => a.id === link.dataAssetId) : null;
    return {
      id: link.id,
      sourceSystemId: link.sourceSystemId,
      targetSystemId: link.targetSystemId,
      flowType: link.flowType,
      frequency: link.frequency,
      status: link.status,
      dataAssetName: dataAsset?.name || '',
    };
  });

  res.json({ success: true, data: { nodes, links } });
});

/** GET /api/v1/data-lineage/:id — single link */
router.get('/:id', (req: Request, res: Response) => {
  const link = dataLineageLinks.find((l) => l.id === req.params.id);
  if (!link) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }
  res.json({ success: true, data: link });
});

/** POST /api/v1/data-lineage — create */
router.post('/', (req: Request, res: Response) => {
  const { sourceSystemId, targetSystemId, dataAssetId, description, flowType, frequency, status, orgId } = req.body;

  if (!sourceSystemId || !targetSystemId) {
    res.status(400).json({ success: false, error: 'sourceSystemId and targetSystemId are required' });
    return;
  }

  if (sourceSystemId === targetSystemId) {
    res.status(400).json({ success: false, error: 'Source and target systems cannot be the same' });
    return;
  }

  const validFlowType = flowType && FLOW_TYPES.includes(flowType) ? flowType : 'ETL';
  const validFrequency = frequency && FREQUENCIES.includes(frequency) ? frequency : 'ON_DEMAND';
  const validStatus = status && ['ACTIVE', 'INACTIVE', 'DEPRECATED'].includes(status) ? status : 'ACTIVE';

  const now = new Date().toISOString();
  const link: DataLineageLink = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    sourceSystemId,
    targetSystemId,
    dataAssetId: dataAssetId || null,
    description: description || '',
    flowType: validFlowType,
    frequency: validFrequency,
    status: validStatus,
    createdAt: now,
    updatedAt: now,
  };

  dataLineageLinks.push(link);
  saveStore('dataLineageLinks', dataLineageLinks);
  auditService.log(link.orgId, null, 'DataLineageLink', link.id, 'CREATE', null, link);
  res.status(201).json({ success: true, data: link });
});

/** PUT /api/v1/data-lineage/:id — update */
router.put('/:id', (req: Request, res: Response) => {
  const link = dataLineageLinks.find((l) => l.id === req.params.id);
  if (!link) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }

  const { sourceSystemId, targetSystemId, dataAssetId, description, flowType, frequency, status } = req.body;

  const newSource = sourceSystemId !== undefined ? sourceSystemId : link.sourceSystemId;
  const newTarget = targetSystemId !== undefined ? targetSystemId : link.targetSystemId;
  if (newSource === newTarget) {
    res.status(400).json({ success: false, error: 'Source and target systems cannot be the same' });
    return;
  }

  if (sourceSystemId !== undefined) link.sourceSystemId = sourceSystemId;
  if (targetSystemId !== undefined) link.targetSystemId = targetSystemId;
  if (dataAssetId !== undefined) link.dataAssetId = dataAssetId || null;
  if (description !== undefined) link.description = description;
  if (flowType !== undefined && FLOW_TYPES.includes(flowType)) link.flowType = flowType;
  if (frequency !== undefined && FREQUENCIES.includes(frequency)) link.frequency = frequency;
  if (status !== undefined && ['ACTIVE', 'INACTIVE', 'DEPRECATED'].includes(status)) link.status = status;
  link.updatedAt = new Date().toISOString();

  saveStore('dataLineageLinks', dataLineageLinks);
  auditService.log(link.orgId, null, 'DataLineageLink', link.id, 'UPDATE', null, link);
  res.json({ success: true, data: link });
});

/** DELETE /api/v1/data-lineage/:id — delete */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = dataLineageLinks.findIndex((l) => l.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }
  auditService.log(DEV_ORG_ID, null, 'DataLineageLink', dataLineageLinks[idx].id, 'DELETE', dataLineageLinks[idx], null);
  dataLineageLinks.splice(idx, 1);
  saveStore('dataLineageLinks', dataLineageLinks);
  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// Asset-level lineage (auto-derived from dbt + future SQL log sources)
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/v1/data-lineage/asset-edges?orgId= - enriched with asset names */
router.get('/asset-edges', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? assetLineageEdges.filter((e) => e.orgId === orgId) : assetLineageEdges;
  const enriched = filtered.map((e) => {
    const src = dataAssets.find((a) => a.id === e.sourceAssetId);
    const tgt = dataAssets.find((a) => a.id === e.targetAssetId);
    return {
      ...e,
      sourceAssetName: src?.name || null,
      targetAssetName: tgt?.name || null,
    };
  });
  res.json({ success: true, data: enriched });
});

// ── dbt manifest types (loosely typed — we only read a few fields) ─────────

interface DbtNode {
  unique_id?: string;
  name?: string;
  resource_type?: string;          // 'model' | 'source' | 'seed' | 'snapshot' | 'test' | ...
  database?: string | null;
  schema?: string | null;
  description?: string;
  depends_on?: { nodes?: string[] };
  source_name?: string;            // sources only
  identifier?: string;             // sources only — the physical table name
}

interface DbtManifest {
  nodes?: Record<string, DbtNode>;
  sources?: Record<string, DbtNode>;
}

// Which resource_types we treat as data assets. Tests and analyses are
// not assets in Procela's sense, so we ignore them.
const DBT_ASSET_TYPES = new Set(['model', 'source', 'seed', 'snapshot']);

function friendlyAssetName(node: DbtNode): string {
  // For sources, dbt's "name" is the table; for models, the model name.
  // Schema prefix improves disambiguation when two projects ship a model
  // called "users".
  const schema = node.schema || '';
  const base = node.identifier || node.name || node.unique_id || '';
  return schema ? `${schema}.${base}` : base;
}

/** POST /api/v1/data-lineage/import-dbt - parse a dbt manifest.json
 *  payload and reconcile it into the catalog as asset edges. Idempotent:
 *  re-importing the same manifest updates existing assets and edges
 *  rather than duplicating. Stale edges (rows that were sourced from
 *  dbt but are no longer present in this manifest) get removed.
 *
 *  Body: { orgId?: string, manifest: DbtManifest }
 */
router.post('/import-dbt', (req: Request, res: Response) => {
  const { orgId, manifest } = req.body as { orgId?: string; manifest?: DbtManifest };
  if (!manifest || typeof manifest !== 'object') {
    res.status(400).json({ success: false, error: 'manifest is required and must be an object' });
    return;
  }
  const effectiveOrgId = orgId || DEV_ORG_ID;

  // Flat list of all asset-bearing dbt nodes from both nodes and sources.
  const flat: DbtNode[] = [];
  for (const m of [manifest.nodes, manifest.sources]) {
    if (!m) continue;
    for (const [uid, node] of Object.entries(m)) {
      if (!node || !node.resource_type) continue;
      if (!DBT_ASSET_TYPES.has(node.resource_type)) continue;
      flat.push({ ...node, unique_id: node.unique_id || uid });
    }
  }
  if (flat.length === 0) {
    res.status(400).json({ success: false, error: 'No model/source/seed/snapshot nodes found in manifest.' });
    return;
  }

  // ── 1. Upsert assets ─────────────────────────────────────────────────
  // For each dbt node, resolve to an existing DataAsset by prior dbt
  // mapping, then by exact name match, else create a new one. The
  // dbtAssetMappings side table is the source of truth for re-imports.

  const uidToAssetId = new Map<string, string>();
  let assetsCreated = 0;
  let assetsMatched = 0;
  const now = new Date().toISOString();

  for (const node of flat) {
    const uid = node.unique_id!;
    const friendlyName = friendlyAssetName(node);

    // a) Prior dbt mapping
    const existingMapping = dbtAssetMappings.find(
      (m) => m.dbtUniqueId === uid && m.orgId === effectiveOrgId,
    );
    let assetId: string | null = null;
    if (existingMapping && dataAssets.find((a) => a.id === existingMapping.assetId)) {
      assetId = existingMapping.assetId;
      assetsMatched++;
    }

    // b) Exact-name match against existing org assets
    if (!assetId && friendlyName) {
      const match = dataAssets.find(
        (a) => a.orgId === effectiveOrgId
          && a.name.trim().toLowerCase() === friendlyName.trim().toLowerCase(),
      );
      if (match) {
        assetId = match.id;
        assetsMatched++;
      }
    }

    // c) Create new asset
    if (!assetId) {
      const id = uuid();
      dataAssets.push({
        id,
        orgId: effectiveOrgId,
        name: friendlyName || uid,
        description: node.description || '',
        systemId: '',
        owner: '',
        stewardIds: [],
        governanceTier: 'BRONZE',
        healthScore: 0,
        origin: 'DISCOVERED',
        createdAt: now,
        updatedAt: now,
      } as any);
      assetId = id;
      assetsCreated++;
    }

    // Persist the mapping so this node finds the same asset next time.
    if (!existingMapping) {
      dbtAssetMappings.push({ dbtUniqueId: uid, assetId, orgId: effectiveOrgId });
    } else if (existingMapping.assetId !== assetId) {
      existingMapping.assetId = assetId;  // mapping repaired (e.g. matched to a new asset after the old was deleted)
    }
    uidToAssetId.set(uid, assetId);
  }

  // ── 2. Reconcile edges ───────────────────────────────────────────────
  // Build the set of edges this manifest declares, then sync the store:
  //   - upsert each declared edge (refresh lastSeenAt)
  //   - delete prior dbt edges whose sourceRef isn't in the new set

  const declaredKeys = new Set<string>();
  let edgesCreated = 0;
  let edgesTouched = 0;

  for (const node of flat) {
    const uid = node.unique_id!;
    const targetAssetId = uidToAssetId.get(uid);
    if (!targetAssetId) continue;
    const deps = node.depends_on?.nodes || [];
    for (const depUid of deps) {
      const sourceAssetId = uidToAssetId.get(depUid);
      if (!sourceAssetId || sourceAssetId === targetAssetId) continue;
      const key = `${uid}->${depUid}`;
      declaredKeys.add(key);
      const existing = assetLineageEdges.find(
        (e) => e.orgId === effectiveOrgId
          && e.source === 'dbt'
          && e.sourceRef === key,
      );
      if (existing) {
        existing.lastSeenAt = now;
        // Repair if the dbt mapping moved the endpoint to a different asset.
        existing.sourceAssetId = sourceAssetId;
        existing.targetAssetId = targetAssetId;
        edgesTouched++;
      } else {
        assetLineageEdges.push({
          id: uuid(),
          orgId: effectiveOrgId,
          sourceAssetId,
          targetAssetId,
          source: 'dbt',
          sourceRef: key,
          lastSeenAt: now,
          createdAt: now,
        });
        edgesCreated++;
      }
    }
  }

  // Drop prior dbt edges that no longer appear in this manifest, scoped
  // to the same org. Manual edges are untouched.
  let edgesRemoved = 0;
  for (let i = assetLineageEdges.length - 1; i >= 0; i--) {
    const e = assetLineageEdges[i];
    if (e.orgId !== effectiveOrgId) continue;
    if (e.source !== 'dbt') continue;
    if (!e.sourceRef || !declaredKeys.has(e.sourceRef)) {
      assetLineageEdges.splice(i, 1);
      edgesRemoved++;
    }
  }

  saveStore('dataAssets', dataAssets);
  saveStore('dbtAssetMappings', dbtAssetMappings);
  saveStore('assetLineageEdges', assetLineageEdges);

  auditService.log(
    effectiveOrgId,
    (req as any).user?.sub || null,
    'AssetLineageEdge',
    '*',
    'IMPORT_DBT',
    null,
    { assetsCreated, assetsMatched, edgesCreated, edgesTouched, edgesRemoved },
  );
  logger.info(
    { assetsCreated, assetsMatched, edgesCreated, edgesTouched, edgesRemoved },
    'dbt manifest imported',
  );

  res.json({
    success: true,
    summary: { assetsCreated, assetsMatched, edgesCreated, edgesTouched, edgesRemoved },
  });
});

export default router;
