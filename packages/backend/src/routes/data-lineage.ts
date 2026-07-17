import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { auditService } from '../services/audit.service';
import logger from '../lib/logger';
import { systems } from './systems';
import { dataAssets } from './data-assets';
import { dataQualityRules } from './data-quality';
import { getDataLineageLinksRepository } from '../db/data-lineage-links.repo';
import { getAssetLineageEdgesRepository } from '../db/asset-lineage-edges.repo';

export interface DataLineageLink {
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
registerStore('dataLineageLinks', dataLineageLinks);

const dataLineageLinksRepo = getDataLineageLinksRepository(dataLineageLinks);

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
registerStore('assetLineageEdges', assetLineageEdges);

const assetLineageEdgesRepo = getAssetLineageEdgesRepository(assetLineageEdges);

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
registerStore('dbtAssetMappings', dbtAssetMappings);

// ── dbt test mapping ────────────────────────────────────────────────────
// Parallel to dbtAssetMappings but for test nodes. Each dbt test creates
// (or updates) a Data Quality rule; re-imports reuse the same rule via
// this mapping so user edits to a derived rule survive a refresh.

interface DbtTestMapping {
  dbtUniqueId: string;
  ruleId: string;
  orgId: string;
}

export const dbtTestMappings: DbtTestMapping[] =
  loadStore<DbtTestMapping>('dbtTestMappings');
registerStore('dbtTestMappings', dbtTestMappings);

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const FLOW_TYPES = ['ETL', 'API', 'FILE_TRANSFER', 'REPLICATION', 'MANUAL', 'STREAMING'];
const FREQUENCIES = ['REAL_TIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ON_DEMAND'];

const router = Router();

/** DELETE /api/v1/data-lineage/all — delete all lineage links */
router.delete('/all', async (_req: Request, res: Response) => {
  const count = dataLineageLinks.length;
  const ids = dataLineageLinks.map((l) => l.id);
  for (const id of ids) await dataLineageLinksRepo.delete(id);
  auditService.log(DEV_ORG_ID, null, 'DataLineageLink', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all data lineage links');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/data-lineage — list all (support ?orgId= filter), enrich with system names and data asset name */
router.get('/', async (req: Request, res: Response) => {
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
router.get('/by-system/:systemId', async (req: Request, res: Response) => {
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
router.get('/visualization', async (req: Request, res: Response) => {
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

/** GET /api/v1/data-lineage/asset-edges?orgId= - enriched with asset
 *  names and an isStale flag (true when lastSeenAt is older than the
 *  STALE_AFTER threshold). Manual edges are never marked stale: the
 *  threshold only applies to edges whose source carries a freshness
 *  expectation (today: just 'dbt').
 *
 *  Must be declared before the '/:id' route below — otherwise Express
 *  matches 'asset-edges' as an :id and returns a 404. */
router.get('/asset-edges', async (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? assetLineageEdges.filter((e) => e.orgId === orgId) : assetLineageEdges;
  const now = Date.now();
  const enriched = filtered.map((e) => {
    const src = dataAssets.find((a) => a.id === e.sourceAssetId);
    const tgt = dataAssets.find((a) => a.id === e.targetAssetId);
    const ageMs = now - new Date(e.lastSeenAt).getTime();
    const isStale = e.source === 'dbt' && ageMs > STALE_AFTER_MS;
    return {
      ...e,
      sourceAssetName: src?.name || null,
      targetAssetName: tgt?.name || null,
      isStale,
      staleAfterDays: STALE_AFTER_MS / (24 * 60 * 60 * 1000),
    };
  });
  res.json({ success: true, data: enriched });
});

/** GET /api/v1/data-lineage/:id — single link */
router.get('/:id', async (req: Request, res: Response) => {
  const link = dataLineageLinks.find((l) => l.id === req.params.id);
  if (!link) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }
  res.json({ success: true, data: link });
});

/** POST /api/v1/data-lineage — create */
router.post('/', async (req: Request, res: Response) => {
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

  await dataLineageLinksRepo.create(link);
  auditService.log(link.orgId, null, 'DataLineageLink', link.id, 'CREATE', null, link);
  res.status(201).json({ success: true, data: link });
});

/** PUT /api/v1/data-lineage/:id — update */
router.put('/:id', async (req: Request, res: Response) => {
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

  await dataLineageLinksRepo.update(link.id, {
    sourceSystemId: link.sourceSystemId,
    targetSystemId: link.targetSystemId,
    dataAssetId: link.dataAssetId,
    description: link.description,
    flowType: link.flowType,
    frequency: link.frequency,
    status: link.status,
    updatedAt: link.updatedAt,
  });
  auditService.log(link.orgId, null, 'DataLineageLink', link.id, 'UPDATE', null, link);
  res.json({ success: true, data: link });
});

/** DELETE /api/v1/data-lineage/:id — delete */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = dataLineageLinks.find((l) => l.id === req.params.id);
  if (!removed) { res.status(404).json({ success: false, error: 'Lineage link not found' }); return; }
  auditService.log(DEV_ORG_ID, null, 'DataLineageLink', removed.id, 'DELETE', removed, null);
  await dataLineageLinksRepo.delete(removed.id);
  res.status(204).send();
});

// ═══════════════════════════════════════════════════════════════════════════
// Asset-level lineage (auto-derived from dbt + future SQL log sources)
// ═══════════════════════════════════════════════════════════════════════════

/** How long an edge can go without being re-seen by an importer before
 *  the API marks it stale. dbt Cloud refreshes should normally run
 *  daily, so 30 days catches "the dbt project moved" or "no one's
 *  refreshed in a month" without producing noise from a missed weekly
 *  schedule. Configurable per-org in a future PR. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

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
  // Test-only fields - dbt populates these for resource_type === 'test'.
  column_name?: string;
  test_metadata?: {
    name?: string;                 // 'not_null' | 'unique' | 'accepted_values' | 'relationships' | ...
    kwargs?: Record<string, unknown>;
  };
}

// Map dbt's built-in test names to Procela's DQ rule shape.
// dbt has hundreds of community packages; we map the four canonical
// built-ins. Anything else lands as a CUSTOM rule with the test name
// preserved in the description so users can see what dbt found.
const DBT_TEST_TO_DQ: Record<string, { dimension: 'COMPLETENESS' | 'ACCURACY' | 'TIMELINESS' | 'CONSISTENCY' | 'UNIQUENESS' | 'VALIDITY'; ruleType: 'NOT_NULL' | 'UNIQUE' | 'IN_SET' | 'CUSTOM' }> = {
  not_null:        { dimension: 'COMPLETENESS', ruleType: 'NOT_NULL' },
  unique:          { dimension: 'UNIQUENESS',   ruleType: 'UNIQUE'   },
  accepted_values: { dimension: 'VALIDITY',     ruleType: 'IN_SET'   },
  relationships:   { dimension: 'CONSISTENCY',  ruleType: 'CUSTOM'   },
};

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
export interface DbtImportSummary {
  assetsCreated: number;
  assetsMatched: number;
  edgesCreated: number;
  edgesTouched: number;
  edgesRemoved: number;
  dqRulesCreated: number;
  dqRulesTouched: number;
  dqRulesRemoved: number;
}

/** Shared manifest-reconciliation core. Called by the HTTP import-dbt
 *  endpoint *and* by the dbt Cloud refresh job - keeps a single source
 *  of truth for upsert + edge + test reconciliation, so any future
 *  manifest source (dbt Core CLI uploads, dbt Cloud, S3 path) plugs in
 *  without re-implementing the lifecycle.
 *
 *  Throws on a structurally-invalid manifest; otherwise returns a
 *  summary the caller can surface as a toast or persist as an
 *  audit trail. */
export async function reconcileDbtManifest(
  manifest: DbtManifest,
  orgIdInput: string | undefined,
  actorUserId: string | null,
): Promise<DbtImportSummary> {
  const effectiveOrgId = orgIdInput || DEV_ORG_ID;

  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest is required and must be an object');
  }

  return reconcileManifestInner(manifest, effectiveOrgId, actorUserId);
}

router.post('/import-dbt', async (req: Request, res: Response) => {
  const { orgId, manifest } = req.body as { orgId?: string; manifest?: DbtManifest };
  try {
    const summary = await reconcileDbtManifest(
      manifest as DbtManifest,
      orgId,
      (req as any).user?.sub || null,
    );
    res.json({ success: true, summary });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e?.message || 'manifest reconciliation failed' });
  }
});

async function reconcileManifestInner(
  manifest: DbtManifest,
  effectiveOrgId: string,
  actorUserId: string | null,
): Promise<DbtImportSummary> {
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
    throw new Error('No model/source/seed/snapshot nodes found in manifest.');
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
        await assetLineageEdgesRepo.update(existing.id, existing);
        edgesTouched++;
      } else {
        const edge: AssetLineageEdge = {
          id: uuid(),
          orgId: effectiveOrgId,
          sourceAssetId,
          targetAssetId,
          source: 'dbt',
          sourceRef: key,
          lastSeenAt: now,
          createdAt: now,
        };
        await assetLineageEdgesRepo.create(edge);
        edgesCreated++;
      }
    }
  }

  // Drop prior dbt edges that no longer appear in this manifest, scoped
  // to the same org. Manual edges are untouched.
  let edgesRemoved = 0;
  // Snapshot the ids to delete first — iterating backwards over the
  // shared array while awaiting each delete is safe on the JSON path
  // (delete splices in place) but relying on that would make future
  // Postgres divergence surprising. Materialise up front.
  const edgesToDelete: string[] = [];
  for (const e of assetLineageEdges) {
    if (e.orgId !== effectiveOrgId) continue;
    if (e.source !== 'dbt') continue;
    if (!e.sourceRef || !declaredKeys.has(e.sourceRef)) {
      edgesToDelete.push(e.id);
    }
  }
  for (const id of edgesToDelete) {
    await assetLineageEdgesRepo.delete(id);
    edgesRemoved++;
  }

  // ── 3. Reconcile dbt tests as Data Quality rules ─────────────────────
  // Each dbt test (resource_type === 'test') becomes (or matches) a DQ
  // rule on the target asset. dbtTestMappings keeps the dbt unique_id
  // bound to the Procela rule id so user edits to a derived rule survive
  // a refresh. Tests that vanish from the manifest get their rule
  // deleted - same lifecycle as the edges above.

  const declaredTestUids = new Set<string>();
  let dqRulesCreated = 0;
  let dqRulesTouched = 0;

  const allNodes = manifest.nodes ? Object.entries(manifest.nodes) : [];
  for (const [uid, node] of allNodes) {
    if (!node || node.resource_type !== 'test') continue;
    const deps = node.depends_on?.nodes || [];
    // A test usually has multiple deps (the model + macro packages). We
    // attach the rule to the first one that maps to a Procela asset.
    const targetAssetId = deps.map((d) => uidToAssetId.get(d)).find((x): x is string => !!x);
    if (!targetAssetId) continue;
    declaredTestUids.add(uid);

    const testName = node.test_metadata?.name || 'custom';
    const mapping = DBT_TEST_TO_DQ[testName] || { dimension: 'ACCURACY' as const, ruleType: 'CUSTOM' as const };
    const columnName = node.column_name
      || (node.test_metadata?.kwargs?.column_name as string | undefined)
      || undefined;

    // Build a stable rule name and human-readable description from the
    // test metadata. We don't try to fully translate dbt's kwargs into
    // Procela rule parameters - that's column-level lineage's job. For
    // now the description preserves the dbt context so users see WHY
    // the rule was created.
    const friendlyTestName = `${testName.replace(/_/g, ' ')}${columnName ? ` on ${columnName}` : ''}`;
    const ruleName = `${friendlyTestName} (dbt)`;
    const description = `Auto-derived from dbt test \`${node.name || uid}\`. Edit to refine.`;

    const existing = dbtTestMappings.find(
      (m) => m.dbtUniqueId === uid && m.orgId === effectiveOrgId,
    );
    let rule = existing
      ? dataQualityRules.find((r) => r.id === existing.ruleId)
      : undefined;

    if (rule) {
      // Refresh derived fields but leave user-edited ones alone (we
      // touch only name + description + assetId mapping).
      rule.dataAssetId = targetAssetId;
      rule.columnName = columnName ?? rule.columnName;
      rule.updatedAt = now;
      dqRulesTouched++;
    } else {
      const ruleId = uuid();
      dataQualityRules.push({
        id: ruleId,
        orgId: effectiveOrgId,
        dataAssetId: targetAssetId,
        columnName,
        dimension: mapping.dimension,
        name: ruleName,
        description,
        threshold: 100,
        currentScore: 0,
        weight: 1,
        status: 'NOT_MEASURED',
        lastMeasured: null,
        ruleType: mapping.ruleType,
        templateId: `dbt:${testName}`,
        createdAt: now,
        updatedAt: now,
      });
      dbtTestMappings.push({ dbtUniqueId: uid, ruleId, orgId: effectiveOrgId });
      dqRulesCreated++;
    }
  }

  // Drop prior dbt-derived rules whose tests aren't in this manifest.
  // Only rules tied to a mapping in dbtTestMappings (so user-created
  // rules are never touched).
  let dqRulesRemoved = 0;
  for (let i = dbtTestMappings.length - 1; i >= 0; i--) {
    const m = dbtTestMappings[i];
    if (m.orgId !== effectiveOrgId) continue;
    if (declaredTestUids.has(m.dbtUniqueId)) continue;
    const ruleIdx = dataQualityRules.findIndex((r) => r.id === m.ruleId);
    if (ruleIdx >= 0) {
      dataQualityRules.splice(ruleIdx, 1);
      dqRulesRemoved++;
    }
    dbtTestMappings.splice(i, 1);
  }

  saveStore('dataAssets', dataAssets);
  saveStore('dbtAssetMappings', dbtAssetMappings);
  // assetLineageEdges is written per-mutation via assetLineageEdgesRepo.
  saveStore('dataQualityRules', dataQualityRules);
  saveStore('dbtTestMappings', dbtTestMappings);

  auditService.log(
    effectiveOrgId,
    actorUserId,
    'AssetLineageEdge',
    '*',
    'IMPORT_DBT',
    null,
    { assetsCreated, assetsMatched, edgesCreated, edgesTouched, edgesRemoved, dqRulesCreated, dqRulesTouched, dqRulesRemoved },
  );
  logger.info(
    { assetsCreated, assetsMatched, edgesCreated, edgesTouched, edgesRemoved, dqRulesCreated, dqRulesTouched, dqRulesRemoved },
    'dbt manifest imported',
  );

  return {
    assetsCreated, assetsMatched,
    edgesCreated, edgesTouched, edgesRemoved,
    dqRulesCreated, dqRulesTouched, dqRulesRemoved,
  };
}

export default router;
