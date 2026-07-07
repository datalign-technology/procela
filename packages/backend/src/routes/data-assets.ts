import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { filterByOrgScope, isOwnershipLevel } from '../lib/org-scope';
import { auditService } from '../services/audit.service';
import { aiService, SENSITIVITY_TAGS, SensitivityTag } from '../services/ai.service';
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
  /** @deprecated Use `ownerPersonId` (person FK). Kept for legacy display
   *  when no person link is set. Migrations attempt to resolve this to a
   *  person id where possible. */
  owner: string;
  /** Person id of the accountable owner. Aligns with how Domains and
   *  Glossary store ownership and lets the UI render a real name link. */
  ownerPersonId?: string | null;
  stewardIds: string[];
  governanceTier: 'BRONZE' | 'SILVER' | 'GOLD';
  /** Manual snapshot. When DQ rules are configured the engine derives a
   *  live score per column and rolls up to the asset; treat this field as
   *  the last manual override and use `healthScoreAt` for its provenance. */
  healthScore: number;
  /** Timestamp of the last manual healthScore set. */
  healthScoreAt?: string | null;
  /** @deprecated Use `bindings` (DataAssetBinding) — these flat fields
   *  are kept only for legacy reads and migration into bindings. */
  sourceConnectionId?: string;
  /** @deprecated see `bindings` */
  sourceAsset?: string;
  /** @deprecated see `bindings` */
  sourceColumn?: string;
  dataClassification?: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
  /** Sensitivity classifications (PII/PHI/PCI/FINANCIAL/CREDENTIAL/…).
   *  Distinct axis from dataClassification: a dataset can carry a
   *  sensitivity tag without being CONFIDENTIAL (e.g. PII in an
   *  INTERNAL asset), and vice versa. Populated by the AI classifier
   *  route (POST /suggest-sensitivity → user accept →
   *  PUT /sensitivity). Empty / undefined = untagged. */
  sensitivityTags?: Array<'PII' | 'PHI' | 'PCI' | 'FINANCIAL' | 'CREDENTIAL' | 'CONFIDENTIAL' | 'PUBLIC'>;
  /** Content classification of the data, not how it's used.
   *  Replaces the legacy mixed-axis `category`. */
  dataType?: 'MASTER' | 'REFERENCE' | 'TRANSACTIONAL' | 'ANALYTICAL' | 'METADATA';
  /** @deprecated Use `dataType`. Migrated on load. Kept for backwards-
   *  compatible reads from older callers / exports. */
  category?: 'OPERATIONAL' | 'GOVERNANCE' | 'REFERENCE' | 'ANALYTICAL' | 'MASTER';
  /** @deprecated Use `retentionDuration` + `retentionReason` for queryable
   *  retention policy. Free-text `retentionPolicy` kept for legacy reads. */
  retentionPolicy?: string;
  retentionDuration?: { value: number; unit: 'DAYS' | 'MONTHS' | 'YEARS' };
  retentionReason?: string;
  refreshFrequency?:
    | 'REAL_TIME'
    | 'HOURLY'
    | 'DAILY'
    | 'WEEKLY'
    | 'MONTHLY'
    | 'MANUAL'
    | 'EVENT_DRIVEN'
    | 'STREAMING'
    | 'AD_HOC';
  /** Provenance — how the asset entered the catalog. Immutable after
   *  creation. Used by the Data Assets page to filter governance
   *  placeholders out of source-data views, and by gap detection so a
   *  GOVERNANCE_TEMPLATE asset isn't penalised for lacking a binding. */
  origin?: 'MANUAL' | 'GOVERNANCE_TEMPLATE' | 'DISCOVERED' | 'IMPORTED' | 'SYNCED';
  /** Set by the on-prem connector when it last refreshed this asset's
   *  freshness signal. Drives the "Synced N min ago" chip on the Data
   *  Asset rows so users can tell a value reflects reality, not stale
   *  manual entry. */
  lastSyncedByConnectorId?: string | null;
  lastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const dataAssets: StoredDataAsset[] = loadStore<StoredDataAsset>('dataAssets');
registerStore('dataAssets', dataAssets);
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';
const VALID_ORIGINS = ['MANUAL', 'GOVERNANCE_TEMPLATE', 'DISCOVERED', 'IMPORTED', 'SYNCED'] as const;

// Migrate legacy `steward` string → `stewardIds[]`
let migrated = false;
for (const a of dataAssets) {
  if (!a.stewardIds) {
    const legacy = (a as any).steward;
    a.stewardIds = legacy ? [legacy] : [];
    delete (a as any).steward;
    migrated = true;
  }
}

// Migrate legacy `category` → `dataType`. The old enum mixed three axes
// (use-case, content-type, stewardship); the new one is content-type only.
const CATEGORY_TO_DATA_TYPE: Record<string, StoredDataAsset['dataType']> = {
  OPERATIONAL: 'TRANSACTIONAL',
  GOVERNANCE:  'METADATA',
  MASTER:      'MASTER',
  REFERENCE:   'REFERENCE',
  ANALYTICAL:  'ANALYTICAL',
};
for (const a of dataAssets) {
  if (!a.dataType && a.category && CATEGORY_TO_DATA_TYPE[a.category]) {
    a.dataType = CATEGORY_TO_DATA_TYPE[a.category];
    migrated = true;
  }
}

// Backfill `healthScoreAt` from updatedAt where a manual score exists but
// no provenance timestamp is recorded. Cheap and lossless.
for (const a of dataAssets) {
  if (a.healthScore && a.healthScoreAt === undefined) {
    a.healthScoreAt = a.updatedAt;
    migrated = true;
  }
}

// Backfill `origin` for legacy rows. The legacy `category === 'GOVERNANCE'`
// is the only structural marker we have for governance-template seeds;
// rows with a sourceConnectionId or sourceAsset clearly came from a
// connection scan, so call those DISCOVERED. Everything else is treated
// as MANUAL — the safer default since we'd rather underclaim provenance
// than mislabel a real user-typed asset.
for (const a of dataAssets) {
  if (a.origin) continue;
  if ((a as any).category === 'GOVERNANCE') a.origin = 'GOVERNANCE_TEMPLATE';
  else if (a.sourceConnectionId || a.sourceAsset) a.origin = 'DISCOVERED';
  else a.origin = 'MANUAL';
  migrated = true;
}

if (migrated) saveStore('dataAssets', dataAssets);

// Resolve free-text `owner` to a person id where the names match. Deferred
// to next tick because people.ts and data-assets.ts import each other —
// running this synchronously can hit the people export while it is still
// in the TDZ. Leaves the legacy string in place when no match is found
// so the UI can still display it.
function backfillOwnerPersonIds(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { people } = require('./people') as { people: { id: string; name: string }[] };
  let touched = false;
  for (const a of dataAssets) {
    if (a.ownerPersonId !== undefined) continue;
    if (!a.owner) { a.ownerPersonId = null; touched = true; continue; }
    // The legacy `owner` field has been used inconsistently — sometimes it
    // holds a person id (the UI dropdown wrote the id into it) and other
    // times a free-text name. Try id match first, then name match.
    const byId = people.find((p) => p.id === a.owner);
    if (byId) { a.ownerPersonId = byId.id; touched = true; continue; }
    const byName = people.find((p) => p.name.trim().toLowerCase() === a.owner.trim().toLowerCase());
    a.ownerPersonId = byName ? byName.id : null;
    touched = true;
  }
  if (touched) saveStore('dataAssets', dataAssets);
}
setImmediate(backfillOwnerPersonIds);

const VALID_TIERS = ['BRONZE', 'SILVER', 'GOLD'];
const VALID_DATA_TYPES = ['MASTER', 'REFERENCE', 'TRANSACTIONAL', 'ANALYTICAL', 'METADATA'];
const VALID_REFRESH_FREQUENCIES = [
  'REAL_TIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL',
  'EVENT_DRIVEN', 'STREAMING', 'AD_HOC',
];
const VALID_RETENTION_UNITS = ['DAYS', 'MONTHS', 'YEARS'];
const VALID_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

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
registerStore('dataAssetBindings', dataAssetBindings);

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

/**
 * Ensure a DataAssetBinding exists that matches the asset's current
 * sourceConnectionId/sourceAsset/sourceColumn fields. Used when create/update
 * routes accept the legacy single-source form so the bindings store (which
 * drives the UI's "Source" column and Link button) stays in sync.
 *
 * If the asset has no source fields, this is a no-op. If a binding for the
 * same (asset, connection) already exists, its sourceAsset/sourceColumn are
 * refreshed; otherwise a new primary binding is appended.
 */
function syncBindingFromAssetFields(asset: StoredDataAsset): boolean {
  if (!asset.sourceConnectionId || !asset.sourceAsset) return false;
  const now = new Date().toISOString();
  const existing = dataAssetBindings.find(
    (b) => b.dataAssetId === asset.id && b.connectionId === asset.sourceConnectionId,
  );
  if (existing) {
    const changed =
      existing.sourceAsset !== asset.sourceAsset ||
      existing.sourceColumn !== asset.sourceColumn;
    if (!changed) return false;
    existing.sourceAsset = asset.sourceAsset;
    existing.sourceColumn = asset.sourceColumn;
    existing.updatedAt = now;
    return true;
  }
  const isFirstBinding = !dataAssetBindings.some((b) => b.dataAssetId === asset.id);
  dataAssetBindings.push({
    id: uuid(),
    orgId: asset.orgId,
    dataAssetId: asset.id,
    connectionId: asset.sourceConnectionId,
    sourceAsset: asset.sourceAsset,
    sourceColumn: asset.sourceColumn,
    isPrimary: isFirstBinding,
    createdAt: now,
    updatedAt: now,
  });
  return true;
}

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
  columnName: string;
  dataType?: string;
  description?: string;
  sourceConnectionId?: string;
  sourceAsset?: string;
  sourceColumn?: string;
  createdAt: string;
  updatedAt: string;
}

const STANDARD_DATA_TYPES = [
  'String', 'Integer', 'Decimal', 'Boolean', 'Date', 'DateTime',
  'Timestamp', 'Binary', 'JSON', 'Array', 'UUID', 'Email', 'Phone',
  'URL', 'Currency', 'Percentage', 'Text', 'Other',
];

const DATA_TYPE_ALIASES: Record<string, string> = {
  varchar: 'String', char: 'String', text: 'Text', string: 'String', nvarchar: 'String',
  int: 'Integer', integer: 'Integer', bigint: 'Integer', smallint: 'Integer', tinyint: 'Integer', number: 'Integer',
  float: 'Decimal', double: 'Decimal', decimal: 'Decimal', numeric: 'Decimal', real: 'Decimal',
  bool: 'Boolean', boolean: 'Boolean', bit: 'Boolean',
  date: 'Date', datetime: 'DateTime', timestamp: 'Timestamp', datetime2: 'DateTime',
  blob: 'Binary', binary: 'Binary', varbinary: 'Binary', bytea: 'Binary',
  json: 'JSON', jsonb: 'JSON',
  uuid: 'UUID', uniqueidentifier: 'UUID',
  array: 'Array',
};

function normalizeDataType(raw: string): string {
  if (!raw) return '';
  const lower = raw.toLowerCase().replace(/\(.*\)/, '').trim();
  return DATA_TYPE_ALIASES[lower] || raw;
}

export const dataAssetColumns: StoredDataAssetColumn[] =
  loadStore<StoredDataAssetColumn>('dataAssetColumns');
registerStore('dataAssetColumns', dataAssetColumns);

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

const HEALTH_SCORE_THRESHOLD = 80;

/**
 * Derive the highest tier this asset is currently *eligible* for based
 * on observable governance signals. This is advisory only — actual
 * promotion still requires a human action so "Certified" retains its
 * attestation meaning. Used by the UI to surface a "Promote?" prompt.
 *
 * Eligibility ladder (each rung includes the rungs below):
 *   SILVER   needs: owner, ≥1 steward, classification
 *   GOLD     needs: SILVER + ≥1 binding + healthScore ≥ threshold
 *
 * BRONZE is the floor; everyone is eligible for it.
 */
function computeSuggestedTier(asset: StoredDataAsset): 'BRONZE' | 'SILVER' | 'GOLD' {
  const hasOwner = !!asset.ownerPersonId;
  const hasSteward = Array.isArray(asset.stewardIds) && asset.stewardIds.length > 0;
  const hasClassification = !!asset.dataClassification;
  const silverEligible = hasOwner && hasSteward && hasClassification;
  if (!silverEligible) return 'BRONZE';

  const hasBinding = dataAssetBindings.some((b) => b.dataAssetId === asset.id);
  const healthOk = (asset.healthScore || 0) >= HEALTH_SCORE_THRESHOLD;
  if (hasBinding && healthOk) return 'GOLD';
  return 'SILVER';
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

/** GET /api/v1/data-assets/orphans — Phase 3 reverse view. Returns
 *  data assets that have zero mapping rows pointing at them, so the
 *  catalog can surface "you have data nobody's using" candidates for
 *  cleanup or fresh process mapping. Scope by ?orgId like the main
 *  list. Each row is enriched with system name + suggested tier so
 *  the UI doesn't need a second round-trip. */
router.get('/orphans', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(dataAssets, orgId as string | undefined);
  const filteredSystems = filterByOrgScope(systems, orgId as string | undefined);
  const mappedAssetIds = new Set<string>();
  for (const m of mappings) if (m.dataAssetId) mappedAssetIds.add(m.dataAssetId);
  const orphans = filtered
    .filter((a) => !mappedAssetIds.has(a.id))
    .map((a) => {
      const systemName = a.systemId ? filteredSystems.find((s) => s.id === a.systemId)?.name || null : null;
      const ownerName = a.ownerPersonId
        ? people.find((p) => p.id === a.ownerPersonId)?.name || null
        : null;
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        systemId: a.systemId,
        systemName,
        governanceTier: a.governanceTier,
        ownerName,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    });
  res.json({ success: true, data: orphans });
});

/** GET /api/v1/data-assets */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(dataAssets, orgId as string | undefined);
  const filteredSystems = filterByOrgScope(systems, orgId as string | undefined);

  // Enrich each asset with domain, owner, steward and health info so the
  // table can display them without a per-row 360 fetch.
  const enriched = filtered.map((asset) => {
    const domain = dataDomains.find((d) => d.dataAssetIds?.includes(asset.id));
    let domainName: string | null = null;
    let ownerName: string | null = null;
    let stewardName: string | null = null;
    // Owner resolution has THREE fields the client cares about:
    //   ownerName      — the effective owner name for display
    //   ownerSource    — 'asset' if set on the row itself, 'domain'
    //                    if inherited from the domain owner, null if
    //                    the domain also has no owner
    //   domainOwner*   — the domain's owner even when the asset
    //                    overrides it, so the form can show
    //                    "Overrides domain (X)" and offer a reset
    // The 'domain' source is what makes ownership propagate: a
    // domain owner change automatically shows through on every
    // inheriting asset without a per-row update.
    let ownerSource: 'asset' | 'domain' | null = null;
    if (asset.ownerPersonId) {
      ownerName = people.find((p) => p.id === asset.ownerPersonId)?.name || null;
      if (ownerName) ownerSource = 'asset';
    }
    if (!ownerName && asset.owner) {
      ownerName = people.find((p) => p.id === asset.owner || p.name === asset.owner)?.name || asset.owner;
      if (ownerName) ownerSource = 'asset';
    }
    let domainOwnerId: string | null = null;
    let domainOwnerName: string | null = null;
    if (domain) {
      domainName = domain.name;
      if (domain.ownerId) {
        domainOwnerId = domain.ownerId;
        domainOwnerName = people.find((p) => p.id === domain.ownerId)?.name || null;
      }
      if (!ownerName && domainOwnerName) {
        ownerName = domainOwnerName;
        ownerSource = 'domain';
      }
    }
    // Stewards mirror the owner-inheritance model. Same three-way
    // provenance:
    //   stewardSource       — 'asset' if the row has its own list,
    //                         'domain' if inherited, null if neither
    //                         has any.
    //   domainStewardIds    — the domain's own list, always emitted
    //                         when present so the form can show
    //                         "Overrides domain (…)" plus a reset.
    // stewardName (comma-joined names) still surfaces the *effective*
    // stewards for lists/table display — unchanged consumer contract.
    const assetStewardIds = asset.stewardIds?.length > 0 ? asset.stewardIds : [];
    const domainStewardIds: string[] = domain?.stewardIds || [];
    const domainStewardNames = domainStewardIds
      .map((sid: string) => people.find((p) => p.id === sid)?.name)
      .filter(Boolean) as string[];
    let stewardSource: 'asset' | 'domain' | null = null;
    let effectiveStewardIds: string[] = [];
    if (assetStewardIds.length > 0) {
      effectiveStewardIds = assetStewardIds;
      stewardSource = 'asset';
    } else if (domainStewardIds.length > 0) {
      effectiveStewardIds = domainStewardIds;
      stewardSource = 'domain';
    }
    if (effectiveStewardIds.length > 0) {
      stewardName = effectiveStewardIds
        .map((sid: string) => people.find((p) => p.id === sid)?.name)
        .filter(Boolean)
        .join(', ') || null;
    }
    const systemName = asset.systemId ? filteredSystems.find((s) => s.id === asset.systemId)?.name || null : null;
    const suggestedTier = computeSuggestedTier(asset);
    return {
      ...asset,
      domainName,
      ownerName, ownerSource, domainOwnerId, domainOwnerName,
      stewardName, stewardSource, domainStewardIds, domainStewardNames,
      systemName, suggestedTier,
    };
  });

  res.json({ success: true, data: enriched, systems: filteredSystems, dataTypes: STANDARD_DATA_TYPES });
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

  // Resolve owner and stewards from people
  const ownerPerson = asset.owner ? people.find((p) => p.id === asset.owner || p.name === asset.owner) : null;
  const stewardInfos = (asset.stewardIds || [])
    .map((sid: string) => people.find((p) => p.id === sid))
    .filter(Boolean)
    .map((p) => ({ id: p!.id, name: p!.name }));

  res.json({
    success: true,
    data: {
      asset,
      system: system ? { id: system.id, name: system.name, systemType: system.systemType } : null,
      domain: domainInfo,
      mappings: assetMappings,
      ownerInfo: ownerPerson ? { id: ownerPerson.id, name: ownerPerson.name } : (asset.owner ? { id: null, name: asset.owner } : null),
      stewardInfos,
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
  const { name, description, systemId, owner, ownerPersonId, stewardIds, governanceTier, healthScore, orgId,
    sourceConnectionId, sourceAsset, sourceColumn,
    dataClassification, dataType, category,
    retentionPolicy, retentionDuration, retentionReason,
    refreshFrequency, origin } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (origin && !VALID_ORIGINS.includes(origin)) {
    res.status(400).json({ success: false, error: `origin must be one of ${VALID_ORIGINS.join(', ')}` });
    return;
  }
  // Ownership-level guard: data assets attach to one org, but only
  // at the company or division level. A department or team can't
  // be the owner — it inherits visibility from above. Skip when no
  // orgId was supplied so the DEV_ORG_ID fallback path keeps
  // working unchanged.
  if (orgId && !isOwnershipLevel(orgId)) {
    res.status(400).json({ success: false, error: 'Data assets can only be owned at the company or division level. Pick a different org from "Working in...".' });
    return;
  }
  // Trust an explicit origin from the caller (governance template, sync,
  // future importer); otherwise infer DISCOVERED when source-connection
  // fields are present, MANUAL by default.
  const resolvedOrigin: StoredDataAsset['origin'] =
    origin || (sourceConnectionId || sourceAsset ? 'DISCOVERED' : 'MANUAL');

  const tier = governanceTier && VALID_TIERS.includes(governanceTier) ? governanceTier : 'BRONZE';
  const score = typeof healthScore === 'number' ? Math.max(0, Math.min(100, healthScore)) : 0;
  const now = new Date().toISOString();

  // Map legacy `category` to `dataType` if a new caller still sends only the
  // old field. Prefer an explicit `dataType` value when both are present.
  const resolvedDataType: StoredDataAsset['dataType'] | undefined =
    (dataType && VALID_DATA_TYPES.includes(dataType)) ? dataType
    : (category && CATEGORY_TO_DATA_TYPE[category]) ? CATEGORY_TO_DATA_TYPE[category]
    : undefined;

  const validatedClassification = (dataClassification && VALID_CLASSIFICATIONS.includes(dataClassification))
    ? dataClassification : undefined;
  const validatedRefresh = (refreshFrequency && VALID_REFRESH_FREQUENCIES.includes(refreshFrequency))
    ? refreshFrequency : undefined;
  const validatedRetentionDuration = (retentionDuration
    && typeof retentionDuration.value === 'number' && retentionDuration.value > 0
    && VALID_RETENTION_UNITS.includes(retentionDuration.unit))
    ? { value: retentionDuration.value, unit: retentionDuration.unit }
    : undefined;

  const asset: StoredDataAsset = {
    id: uuid(), orgId: orgId || DEV_ORG_ID, name,
    description: description || '',
    systemId: systemId || '',
    owner: owner || '',
    ownerPersonId: ownerPersonId || null,
    stewardIds: Array.isArray(stewardIds) ? stewardIds : [],
    governanceTier: tier,
    healthScore: score,
    ...(score > 0 ? { healthScoreAt: now } : { healthScoreAt: null }),
    ...(sourceConnectionId ? { sourceConnectionId } : {}),
    ...(sourceAsset ? { sourceAsset } : {}),
    ...(sourceColumn ? { sourceColumn } : {}),
    ...(validatedClassification ? { dataClassification: validatedClassification } : {}),
    ...(resolvedDataType ? { dataType: resolvedDataType } : {}),
    ...(category ? { category } : {}),
    ...(retentionPolicy ? { retentionPolicy } : {}),
    ...(validatedRetentionDuration ? { retentionDuration: validatedRetentionDuration } : {}),
    ...(retentionReason ? { retentionReason } : {}),
    ...(validatedRefresh ? { refreshFrequency: validatedRefresh } : {}),
    origin: resolvedOrigin,
    createdAt: now, updatedAt: now,
  };
  dataAssets.push(asset);
  saveStore('dataAssets', dataAssets);
  if (syncBindingFromAssetFields(asset)) saveStore('dataAssetBindings', dataAssetBindings);
  res.status(201).json({ success: true, data: asset });
});

/** PUT /api/v1/data-assets/:id */
router.put('/:id', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }

  const { name, description, systemId, owner, ownerPersonId, stewardIds, governanceTier, healthScore,
    sourceConnectionId, sourceAsset, sourceColumn,
    dataClassification, dataType, category,
    retentionPolicy, retentionDuration, retentionReason,
    refreshFrequency } = req.body;
  const now = new Date().toISOString();

  if (name !== undefined) asset.name = name;
  if (description !== undefined) asset.description = description;
  if (systemId !== undefined) asset.systemId = systemId;
  if (owner !== undefined) asset.owner = owner;
  if (ownerPersonId !== undefined) asset.ownerPersonId = ownerPersonId || null;
  if (stewardIds !== undefined && Array.isArray(stewardIds)) asset.stewardIds = stewardIds;
  if (governanceTier !== undefined && VALID_TIERS.includes(governanceTier)) asset.governanceTier = governanceTier;
  if (healthScore !== undefined && typeof healthScore === 'number') {
    const clamped = Math.max(0, Math.min(100, healthScore));
    if (clamped !== asset.healthScore) {
      asset.healthScore = clamped;
      asset.healthScoreAt = now;
    }
  }
  if (sourceConnectionId !== undefined) asset.sourceConnectionId = sourceConnectionId || undefined;
  if (sourceAsset !== undefined) asset.sourceAsset = sourceAsset || undefined;
  if (sourceColumn !== undefined) asset.sourceColumn = sourceColumn || undefined;
  if (dataClassification !== undefined) {
    asset.dataClassification = (dataClassification && VALID_CLASSIFICATIONS.includes(dataClassification))
      ? dataClassification : undefined;
  }
  if (dataType !== undefined) {
    asset.dataType = (dataType && VALID_DATA_TYPES.includes(dataType)) ? dataType : undefined;
  } else if (category !== undefined && CATEGORY_TO_DATA_TYPE[category]) {
    // Older callers may still send only the legacy `category`; carry over.
    asset.dataType = CATEGORY_TO_DATA_TYPE[category];
  }
  if (category !== undefined) asset.category = category || undefined;
  if (retentionPolicy !== undefined) asset.retentionPolicy = retentionPolicy || undefined;
  if (retentionDuration !== undefined) {
    asset.retentionDuration = (retentionDuration
      && typeof retentionDuration.value === 'number' && retentionDuration.value > 0
      && VALID_RETENTION_UNITS.includes(retentionDuration.unit))
      ? { value: retentionDuration.value, unit: retentionDuration.unit }
      : undefined;
  }
  if (retentionReason !== undefined) asset.retentionReason = retentionReason || undefined;
  if (refreshFrequency !== undefined) {
    asset.refreshFrequency = (refreshFrequency && VALID_REFRESH_FREQUENCIES.includes(refreshFrequency))
      ? refreshFrequency : undefined;
  }
  asset.updatedAt = now;
  saveStore('dataAssets', dataAssets);
  if (syncBindingFromAssetFields(asset)) saveStore('dataAssetBindings', dataAssetBindings);
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
    dataType: normalizeDataType(dataType || ''), description: description || '',
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
  if (dataType !== undefined) col.dataType = normalizeDataType(dataType);
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

// ── Suggest source ────────────────────────────────────────────────────────
//
// Given a Data Asset (a business concept like "Customer Accounts"), score
// the existing connections in the same org and surface the candidates
// whose names are likely to back this asset. Asset-rooted complement to
// the connection-rooted "Discover assets" button on the Connections page.
//
// We score against names already known to the connection — file names
// and column lists for LOCAL files. Database/API connections that
// haven't been live-discovered have no pre-populated candidate list so
// they're skipped here; the user can still reach them from the
// connection-rooted Discover flow.

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function similarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  const jaccard = intersection / union;
  // Substring boost — "customer" appearing in "customers.csv" should
  // outrank a same-jaccard candidate without the substring overlap.
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  const sub = aLow.includes(bLow) || bLow.includes(aLow) ? 0.15 : 0;
  return Math.min(1, jaccard + sub);
}

router.get('/:id/suggest-source', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connections } = require('./connections') as typeof import('./connections');
  const orgConnections = connections.filter((c) => c.orgId === asset.orgId);

  // Don't suggest sources already bound to *some* asset — those have a
  // claim on them. Bound-to-this-asset is also excluded since the user
  // is looking for a missing or additional binding.
  const claimed = new Set(
    dataAssetBindings.map((b) =>
      `${b.connectionId}::${b.sourceAsset || ''}::${b.sourceColumn || ''}`,
    ),
  );

  type Candidate = {
    connectionId: string;
    connectionName: string;
    connectionType: string;
    sourceAsset: string;
    sourceColumn: string | null;
    score: number;
    /** A short human-readable reason the candidate ranked. Helps the
     *  UI explain "why this match" without re-running the scorer. */
    reason: string;
  };

  const candidates: Candidate[] = [];
  const assetText = `${asset.name} ${asset.description || ''}`;

  for (const conn of orgConnections) {
    const cfg: any = conn.config || {};
    const file: string | undefined = cfg.originalFileName;
    const cols: string[] = Array.isArray(cfg.columns) ? cfg.columns : [];
    if (!file && cols.length === 0) continue; // nothing observable to match

    if (file) {
      const score = similarity(assetText, file);
      const key = `${conn.id}::${file}::`;
      if (score > 0 && !claimed.has(key)) {
        candidates.push({
          connectionId: conn.id,
          connectionName: conn.name,
          connectionType: conn.connectionType,
          sourceAsset: file,
          sourceColumn: null,
          score,
          reason: `File name "${file}" overlaps with asset name`,
        });
      }
    }
    for (const col of cols) {
      const score = similarity(assetText, col);
      const key = `${conn.id}::${file || ''}::${col}`;
      if (score > 0 && !claimed.has(key)) {
        candidates.push({
          connectionId: conn.id,
          connectionName: conn.name,
          connectionType: conn.connectionType,
          sourceAsset: file || conn.name,
          sourceColumn: col,
          score,
          reason: `Column "${col}" overlaps with asset name`,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  // Cap at 10 — beyond that the user is better off using the
  // connection-rooted Discover flow with full filtering.
  res.json({ success: true, data: candidates.slice(0, 10) });
});

// ── Sensitivity classification ──
//
// Two-step flow so the user reviews before we tag anything:
//
//   POST /:id/suggest-sensitivity → asks Claude to classify the
//     asset from its metadata (name, description, systemType,
//     columns). Returns an array of {tag, confidence, reason} —
//     NOT persisted. The client renders one chip per suggestion
//     with accept/reject buttons.
//
//   PUT /:id/sensitivity → replaces the asset's sensitivityTags
//     array with what the user accepted. Validated against the
//     canonical SENSITIVITY_TAGS set so a rogue client can't
//     write arbitrary strings.
//
// Delete-all: PUT with `tags: []` clears the asset back to
// untagged. There is no separate DELETE endpoint — one PUT
// route is the durable API.

/** POST /api/v1/data-assets/:id/suggest-sensitivity */
router.post('/:id/suggest-sensitivity', async (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const cols = dataAssetColumns
    .filter((c) => c.dataAssetId === asset.id)
    .map((c) => ({ name: c.columnName, dataType: c.dataType, description: c.description }));
  const system = asset.systemId ? systems.find((s) => s.id === asset.systemId) : undefined;
  try {
    const suggestions = await aiService.suggestAssetSensitivity({
      name: asset.name,
      description: asset.description,
      systemType: system?.systemType,
      columns: cols,
    });
    res.json({ success: true, data: suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI classification failed.';
    logger.error({ err, assetId: asset.id }, 'Sensitivity classification failed');
    res.status(502).json({ success: false, error: `Sensitivity classification failed: ${msg}` });
  }
});

/** PUT /api/v1/data-assets/:id/sensitivity */
router.put('/:id/sensitivity', (req: Request, res: Response) => {
  const asset = dataAssets.find((a) => a.id === req.params.id);
  if (!asset) { res.status(404).json({ success: false, error: 'Data asset not found' }); return; }
  const { tags } = req.body as { tags?: unknown };
  if (!Array.isArray(tags)) {
    res.status(400).json({ success: false, error: 'tags must be an array of sensitivity tag strings.' });
    return;
  }
  const validSet = new Set<string>(SENSITIVITY_TAGS);
  const clean: SensitivityTag[] = [];
  for (const t of tags) {
    if (typeof t !== 'string' || !validSet.has(t)) {
      res.status(400).json({ success: false, error: `Unknown sensitivity tag: ${String(t)}. Valid: ${SENSITIVITY_TAGS.join(', ')}` });
      return;
    }
    if (!clean.includes(t as SensitivityTag)) clean.push(t as SensitivityTag);
  }
  const previous = asset.sensitivityTags || [];
  asset.sensitivityTags = clean.length > 0 ? clean : undefined;
  asset.updatedAt = new Date().toISOString();
  saveStore('dataAssets', dataAssets);
  auditService.log(asset.orgId, null, 'DataAsset', asset.id, 'SENSITIVITY_UPDATED', { sensitivityTags: previous }, { sensitivityTags: clean });
  res.json({ success: true, data: { id: asset.id, sensitivityTags: clean } });
});

export default router;
