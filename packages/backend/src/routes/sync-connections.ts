import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { parseCsv } from '../lib/csv';
import { organizations } from './organizations';
import { people } from './people';
import { systems } from './systems';
import { glossaryTerms } from './business-glossary';
import { connections } from './connections';
import logger from '../lib/logger';
import { getSyncConnectionsRepository } from '../db/sync-connections.repo';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncConnection {
  id: string;
  orgId: string;
  name: string;
  targetEntity: 'organizations' | 'people' | 'systems' | 'business-glossary';
  sourceType: 'DATABASE' | 'CSV_URL' | 'JSON_URL';
  /** Optional reference to a saved Connection profile in the admin
   *  Connections area. When set, the sync resolves host/port/credentials
   *  from the profile at run time and `config` only carries source-
   *  specific overrides (table, query, URL path suffix, etc.). When
   *  null, the sync owns its config inline. */
  connectionId: string | null;
  config: {
    // DATABASE
    dbType?: 'POSTGRESQL' | 'MYSQL' | 'SQLSERVER';
    host?: string;
    port?: number;
    database?: string;
    schema?: string;
    table?: string;
    query?: string;
    // URL-based
    url?: string;
    authHeader?: string;
  };
  fieldMapping: Record<string, string>;
  matchKey: string;
  schedule: {
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  };
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  lastSyncResult: {
    timestamp: string;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    errorMessages: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_TYPES = ['DATABASE', 'CSV_URL', 'JSON_URL'] as const;
const TARGET_ENTITIES = ['organizations', 'people', 'systems', 'business-glossary'] as const;
const DB_TYPES = ['POSTGRESQL', 'MYSQL', 'SQLSERVER'] as const;

const TARGET_FIELD_MAP: Record<string, string[]> = {
  organizations: ['name', 'type', 'industry', 'description'],
  people: ['name', 'email', 'role', 'title', 'jobRole'],
  systems: ['name', 'description', 'systemType', 'vendor', 'businessCriticality'],
};

const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export const syncConnections: SyncConnection[] = loadStore<SyncConnection>('syncConnections');
registerStore('syncConnections', syncConnections);

const syncConnectionsRepo = getSyncConnectionsRepository(syncConnections);

// Request-body schemas — Zod at the API boundary. Enum checks + type
// guarantees fall out of the parse so downstream code can use the
// typed body directly.
const syncConfigSchema = z.object({
  dbType: z.enum(DB_TYPES).optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  database: z.string().optional(),
  schema: z.string().optional(),
  table: z.string().optional(),
  query: z.string().optional(),
  url: z.string().optional(),
  authHeader: z.string().optional(),
});
const syncScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().optional(),
});
const createSyncConnectionBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  targetEntity: z.enum(TARGET_ENTITIES, {
    message: `targetEntity must be one of: ${TARGET_ENTITIES.join(', ')}`,
  }),
  sourceType: z.enum(SOURCE_TYPES, {
    message: `sourceType must be one of: ${SOURCE_TYPES.join(', ')}`,
  }),
  matchKey: z.string().min(1, 'matchKey is required'),
  config: syncConfigSchema.optional(),
  fieldMapping: z.record(z.string(), z.string()).optional(),
  schedule: syncScheduleSchema.optional(),
  orgId: z.string().optional(),
  connectionId: z.string().nullable().optional(),
});
const updateSyncConnectionBodySchema = z.object({
  name: z.string().optional(),
  targetEntity: z.enum(TARGET_ENTITIES, {
    message: `targetEntity must be one of: ${TARGET_ENTITIES.join(', ')}`,
  }).optional(),
  sourceType: z.enum(SOURCE_TYPES, {
    message: `sourceType must be one of: ${SOURCE_TYPES.join(', ')}`,
  }).optional(),
  matchKey: z.string().optional(),
  config: syncConfigSchema.optional(),
  fieldMapping: z.record(z.string(), z.string()).optional(),
  schedule: syncScheduleSchema.optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ERROR']).optional(),
  connectionId: z.string().nullable().optional(),
});

// Backfill connectionId on legacy rows so consumers can rely on the
// field existing. null = inline (no saved-connection reference).
let connectionIdMigrated = false;
for (const sc of syncConnections) {
  if (sc.connectionId === undefined) {
    sc.connectionId = null;
    connectionIdMigrated = true;
  }
}
if (connectionIdMigrated) saveStore('syncConnections', syncConnections);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the effective config a sync run will use. When a `connectionId`
 * is set, we overlay the saved Connection profile's host/port/database/
 * baseUrl/auth on top of the sync's own config so the source can be
 * fetched without re-entering credentials per sync. Sync-owned fields
 * (table, query, URL path) always win — those are sync-specific even
 * when the underlying server isn't.
 *
 * For URL-based syncs we synthesize an Authorization header from saved
 * credentials (apiKey or token) when the sync didn't already set one.
 * Returns the original config unchanged if the connection ref is dead.
 */
function resolveEffectiveConfig(sc: SyncConnection): SyncConnection['config'] {
  if (!sc.connectionId) return sc.config;
  const conn = connections.find((c) => c.id === sc.connectionId);
  if (!conn) return sc.config;

  const merged: SyncConnection['config'] = { ...sc.config };
  if (sc.sourceType === 'DATABASE') {
    if (conn.config.dbType && !merged.dbType) merged.dbType = conn.config.dbType as any;
    if (conn.config.host && !merged.host) merged.host = conn.config.host;
    if (conn.config.port && !merged.port) merged.port = conn.config.port;
    if (conn.config.database && !merged.database) merged.database = conn.config.database;
    if (conn.config.schema && !merged.schema) merged.schema = conn.config.schema;
  } else {
    // CSV_URL / JSON_URL — pull baseUrl when sync didn't carry its own
    if (conn.config.baseUrl && !merged.url) merged.url = conn.config.baseUrl;
    if (!merged.authHeader) {
      const cred = conn.credentials || {};
      if (cred.apiKey) merged.authHeader = `Bearer ${cred.apiKey}`;
      else if (cred.token) merged.authHeader = `Bearer ${cred.token}`;
      else if (cred.username && cred.password) {
        merged.authHeader = `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString('base64')}`;
      }
    }
  }
  return merged;
}

function isConnectionCompatible(conn: { connectionType: string }, sourceType: string): boolean {
  if (sourceType === 'DATABASE') return conn.connectionType === 'DATABASE' || conn.connectionType === 'DATA_WAREHOUSE';
  return conn.connectionType === 'API' || conn.connectionType === 'FILE_STORAGE';
}

function getEntityStore(targetEntity: string): any[] | null {
  switch (targetEntity) {
    case 'organizations': return organizations;
    case 'people': return people;
    case 'systems': return systems;
    case 'business-glossary': return glossaryTerms;
    default: return null;
  }
}

function computeNextRunAt(intervalMinutes: number): string {
  return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
}

/**
 * Attempt to fetch rows from a URL-based source.
 * For CSV_URL: fetches the URL, splits by newlines, parses as CSV.
 * For JSON_URL: fetches the URL, expects a JSON array.
 */
async function fetchUrlRows(
  sourceType: 'CSV_URL' | 'JSON_URL',
  config: SyncConnection['config'],
): Promise<Record<string, string>[]> {
  const { url, authHeader } = config;
  if (!url) throw new Error('No URL configured');

  const headers: Record<string, string> = {};
  if (authHeader) headers['Authorization'] = authHeader;

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  if (sourceType === 'JSON_URL') {
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error('JSON response is not an array');
    return data;
  }

  // CSV_URL
  const text = await resp.text();
  const parsed = parseCsv(text);
  if (parsed.length < 2) return [];
  const headerRow = parsed[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const cols = parsed[i].map((c) => c.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < headerRow.length; j++) {
      row[headerRow[j]] = cols[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Generate simulated rows for DATABASE sources (prototype only).
 */
function generateMockRows(
  targetEntity: string,
  fieldMapping: Record<string, string>,
): Record<string, string>[] {
  const count = 5;
  const rows: Record<string, string>[] = [];
  for (let i = 1; i <= count; i++) {
    const row: Record<string, string> = {};
    for (const [_targetField, sourceColumn] of Object.entries(fieldMapping)) {
      row[sourceColumn] = `mock_${sourceColumn}_${i}`;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Apply a single source row against the target entity store.
 * Returns 'created' | 'updated' | 'skipped'.
 */
function applyRow(
  store: any[],
  targetEntity: string,
  fieldMapping: Record<string, string>,
  matchKey: string,
  sourceRow: Record<string, string>,
  orgId: string,
  syncConnectionId?: string,
  syncedRecordIds?: Set<string>,
): 'created' | 'updated' | 'skipped' {
  // Resolve the source column for the match key
  const matchSourceColumn = fieldMapping[matchKey];
  if (!matchSourceColumn) return 'skipped';

  const matchValue = sourceRow[matchSourceColumn];
  if (!matchValue) return 'skipped';

  // Find existing record by matchKey value
  const existing = store.find((item: any) => {
    const targetValue = item[matchKey];
    return targetValue !== undefined && String(targetValue).toLowerCase() === String(matchValue).toLowerCase();
  });

  if (existing) {
    syncedRecordIds?.add(existing.id);
    // Update fields that differ
    let changed = false;
    for (const [targetField, sourceColumn] of Object.entries(fieldMapping)) {
      if (targetField === matchKey) continue;
      const newValue = sourceRow[sourceColumn];
      if (newValue !== undefined && newValue !== '' && existing[targetField] !== newValue) {
        existing[targetField] = newValue;
        changed = true;
      }
    }
    if (syncConnectionId && existing.syncConnectionId !== syncConnectionId) {
      existing.syncConnectionId = syncConnectionId;
      changed = true;
    }
    if (existing.syncStatus === 'MISSING_FROM_SOURCE') {
      existing.syncStatus = 'ACTIVE';
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      return 'updated';
    }
    return 'skipped';
  }

  // Create new record
  const now = new Date().toISOString();
  const newRecord: any = {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    syncConnectionId: syncConnectionId || null,
    syncStatus: 'ACTIVE',
  };
  syncedRecordIds?.add(newRecord.id);

  // Set org scoping based on entity type
  if (targetEntity === 'people') {
    newRecord.orgIds = [orgId];
    newRecord.accessibleOrgIds = [orgId];
  } else {
    newRecord.orgId = orgId;
  }

  // Apply field mapping
  for (const [targetField, sourceColumn] of Object.entries(fieldMapping)) {
    const value = sourceRow[sourceColumn];
    if (value !== undefined && value !== '') {
      newRecord[targetField] = value;
    }
  }

  // Set defaults for missing required fields
  if (targetEntity === 'organizations') {
    if (!newRecord.name) return 'skipped';
    if (!newRecord.type) newRecord.type = 'department';
    if (!newRecord.industry) newRecord.industry = '';
    if (!newRecord.description) newRecord.description = '';
    if (newRecord.headCount === undefined) newRecord.headCount = 0;
    if (!newRecord.parentId) newRecord.parentId = null;
  } else if (targetEntity === 'people') {
    if (!newRecord.name) return 'skipped';
    if (!newRecord.email) newRecord.email = '';
    if (!newRecord.role) newRecord.role = 'VIEWER';
    if (!newRecord.title) newRecord.title = '';
  } else if (targetEntity === 'systems') {
    if (!newRecord.name) return 'skipped';
    if (!newRecord.description) newRecord.description = '';
    if (!newRecord.systemType) newRecord.systemType = 'Other';
  } else if (targetEntity === 'business-glossary') {
    if (!newRecord.term) return 'skipped';
    if (!newRecord.definition) newRecord.definition = '';
    if (!newRecord.category) newRecord.category = 'BUSINESS';
    if (!newRecord.status) newRecord.status = 'DRAFT';
    if (!Array.isArray(newRecord.synonyms)) newRecord.synonyms = [];
    if (!Array.isArray(newRecord.relatedTerms)) newRecord.relatedTerms = [];
    if (newRecord.domainId === undefined) newRecord.domainId = null;
    if (newRecord.ownerPersonId === undefined) newRecord.ownerPersonId = null;
    if (!newRecord.context) newRecord.context = '';
    if (!newRecord.exampleValues) newRecord.exampleValues = '';
    if (!newRecord.businessRules) newRecord.businessRules = '';
    if (!newRecord.sourceOfTruth) newRecord.sourceOfTruth = '';
  }

  store.push(newRecord);
  return 'created';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/** GET /api/v1/sync-connections — list all, supports ?orgId= and ?targetEntity= filters */
router.get('/', async (req: Request, res: Response) => {
  const { orgId, targetEntity } = req.query;
  let filtered = syncConnections;
  if (orgId && typeof orgId === 'string') {
    filtered = filtered.filter((sc) => sc.orgId === orgId);
  }
  if (targetEntity && typeof targetEntity === 'string') {
    filtered = filtered.filter((sc) => sc.targetEntity === targetEntity);
  }
  res.json({
    success: true,
    data: filtered,
    sourceTypes: SOURCE_TYPES,
    targetEntities: TARGET_ENTITIES,
    dbTypes: DB_TYPES,
  });
});

/** GET /api/v1/sync-connections/:id — get single connection */
router.get('/:id', async (req: Request, res: Response) => {
  const sc = syncConnections.find((c) => c.id === req.params.id);
  if (!sc) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }
  res.json({ success: true, data: sc });
});

/** POST /api/v1/sync-connections — create new sync connection */
router.post('/', async (req: Request, res: Response) => {
  const parsed = createSyncConnectionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ success: false, error: first?.message || 'Invalid request body', details: parsed.error.issues });
    return;
  }
  const { name, targetEntity, sourceType, config, fieldMapping, matchKey, schedule, orgId, connectionId } = parsed.data;

  if (connectionId) {
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) {
      res.status(400).json({ success: false, error: `connectionId ${connectionId} not found` });
      return;
    }
    if (!isConnectionCompatible(conn, sourceType)) {
      res.status(400).json({ success: false, error: `connection type ${conn.connectionType} is not compatible with sourceType ${sourceType}` });
      return;
    }
  }

  const now = new Date().toISOString();
  const intervalMinutes = schedule?.intervalMinutes || 360;

  const sc: SyncConnection = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    name,
    targetEntity,
    sourceType,
    connectionId: connectionId || null,
    config: config || {},
    fieldMapping: fieldMapping || {},
    matchKey,
    schedule: {
      enabled: schedule?.enabled ?? false,
      intervalMinutes,
      lastRunAt: null,
      nextRunAt: schedule?.enabled ? computeNextRunAt(intervalMinutes) : null,
    },
    status: 'ACTIVE',
    lastSyncResult: null,
    createdAt: now,
    updatedAt: now,
  };

  await syncConnectionsRepo.create(sc);
  logger.info({ id: sc.id, name: sc.name, targetEntity: sc.targetEntity, sourceType: sc.sourceType }, 'Created sync connection');
  res.status(201).json({ success: true, data: sc });
});

/** PUT /api/v1/sync-connections/:id — update connection */
router.put('/:id', async (req: Request, res: Response) => {
  const sc = syncConnections.find((c) => c.id === req.params.id);
  if (!sc) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }

  const parsed = updateSyncConnectionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ success: false, error: first?.message || 'Invalid request body', details: parsed.error.issues });
    return;
  }
  const { name, targetEntity, sourceType, config, fieldMapping, matchKey, schedule, status, connectionId } = parsed.data;

  if (name !== undefined) sc.name = name;
  if (targetEntity !== undefined) sc.targetEntity = targetEntity;
  if (sourceType !== undefined) sc.sourceType = sourceType;
  if (connectionId !== undefined) {
    if (connectionId === null || connectionId === '') {
      sc.connectionId = null;
    } else {
      const conn = connections.find((c) => c.id === connectionId);
      if (!conn) {
        res.status(400).json({ success: false, error: `connectionId ${connectionId} not found` });
        return;
      }
      if (!isConnectionCompatible(conn, sc.sourceType)) {
        res.status(400).json({ success: false, error: `connection type ${conn.connectionType} is not compatible with sourceType ${sc.sourceType}` });
        return;
      }
      sc.connectionId = connectionId;
    }
  }
  if (config !== undefined) sc.config = { ...sc.config, ...config };
  if (fieldMapping !== undefined) sc.fieldMapping = fieldMapping;
  if (matchKey !== undefined) sc.matchKey = matchKey;
  if (status !== undefined) sc.status = status;
  if (schedule !== undefined) {
    if (schedule.enabled !== undefined) sc.schedule.enabled = schedule.enabled;
    if (schedule.intervalMinutes !== undefined) sc.schedule.intervalMinutes = schedule.intervalMinutes;
    if (sc.schedule.enabled) {
      sc.schedule.nextRunAt = computeNextRunAt(sc.schedule.intervalMinutes);
    } else {
      sc.schedule.nextRunAt = null;
    }
  }

  sc.updatedAt = new Date().toISOString();
  await syncConnectionsRepo.update(sc.id, {
    name: sc.name,
    targetEntity: sc.targetEntity,
    sourceType: sc.sourceType,
    connectionId: sc.connectionId,
    config: sc.config,
    fieldMapping: sc.fieldMapping,
    matchKey: sc.matchKey,
    schedule: sc.schedule,
    status: sc.status,
    updatedAt: sc.updatedAt,
  });
  res.json({ success: true, data: sc });
});

/** DELETE /api/v1/sync-connections/:id — delete connection */
router.delete('/:id', async (req: Request, res: Response) => {
  const removed = syncConnections.find((c) => c.id === req.params.id);
  if (!removed) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }
  await syncConnectionsRepo.delete(removed.id);
  logger.info({ id: removed.id, name: removed.name }, 'Deleted sync connection');
  res.status(204).send();
});

/** POST /api/v1/sync-connections/:id/run — execute sync now (manual trigger) */
router.post('/:id/run', async (req: Request, res: Response) => {
  const sc = syncConnections.find((c) => c.id === req.params.id);
  if (!sc) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }

  const store = getEntityStore(sc.targetEntity);
  if (!store) {
    res.status(500).json({ success: false, error: `Unknown target entity: ${sc.targetEntity}` });
    return;
  }

  const result = {
    timestamp: new Date().toISOString(),
    created: 0,
    updated: 0,
    skipped: 0,
    missingFromSource: 0,
    errors: 0,
    errorMessages: [] as string[],
  };
  const syncedRecordIds = new Set<string>();

  let rows: Record<string, string>[] = [];
  let simulated = false;

  try {
    if (sc.sourceType === 'DATABASE') {
      // Cannot connect to real databases in the prototype — simulate
      rows = generateMockRows(sc.targetEntity, sc.fieldMapping);
      simulated = true;
    } else {
      // CSV_URL or JSON_URL — attempt real fetch
      rows = await fetchUrlRows(sc.sourceType, resolveEffectiveConfig(sc));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown fetch error';
    result.errors = 1;
    result.errorMessages.push(`Source fetch failed: ${msg}`);
    sc.status = 'ERROR';
    sc.lastSyncResult = result;
    sc.updatedAt = new Date().toISOString();
    await syncConnectionsRepo.update(sc.id, {
      status: sc.status,
      lastSyncResult: sc.lastSyncResult,
      updatedAt: sc.updatedAt,
    });
    logger.error({ err, id: sc.id }, 'Sync connection fetch failed');
    res.json({ success: false, data: result, error: msg });
    return;
  }

  // Apply each row
  for (const row of rows) {
    try {
      const action = applyRow(store, sc.targetEntity, sc.fieldMapping, sc.matchKey, row, sc.orgId, sc.id, syncedRecordIds);
      if (action === 'created') result.created++;
      else if (action === 'updated') result.updated++;
      else result.skipped++;
    } catch (err) {
      result.errors++;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errorMessages.push(msg);
    }
  }

  // Mark records previously synced by this connection but missing from this batch
  for (const item of store) {
    if ((item as any).syncConnectionId === sc.id && !syncedRecordIds.has(item.id)) {
      if ((item as any).syncStatus !== 'MISSING_FROM_SOURCE') {
        (item as any).syncStatus = 'MISSING_FROM_SOURCE';
        (item as any).updatedAt = new Date().toISOString();
        result.missingFromSource++;
      }
    }
  }

  // Persist the target entity store. Most targets share their key name
  // with the persistence file ("organizations", "people", "systems"), but
  // glossary lives under "glossaryTerms" so map explicitly when needed.
  const STORE_KEY_FOR_ENTITY: Record<string, string> = { 'business-glossary': 'glossaryTerms' };
  saveStore(STORE_KEY_FOR_ENTITY[sc.targetEntity] || sc.targetEntity, store);

  // Update sync connection metadata
  sc.lastSyncResult = result;
  sc.schedule.lastRunAt = result.timestamp;
  if (sc.schedule.enabled) {
    sc.schedule.nextRunAt = computeNextRunAt(sc.schedule.intervalMinutes);
  }
  if (result.errors > 0 && result.created === 0 && result.updated === 0) {
    sc.status = 'ERROR';
  } else {
    sc.status = 'ACTIVE';
  }
  sc.updatedAt = new Date().toISOString();
  await syncConnectionsRepo.update(sc.id, {
    lastSyncResult: sc.lastSyncResult,
    schedule: sc.schedule,
    status: sc.status,
    updatedAt: sc.updatedAt,
  });

  logger.info(
    { id: sc.id, created: result.created, updated: result.updated, skipped: result.skipped, missingFromSource: result.missingFromSource, errors: result.errors, simulated },
    'Sync connection run completed',
  );
  res.json({ success: true, data: result, simulated });
});

/** GET /api/v1/sync-connections/:id/preview — dry run showing first 10 rows */
router.get('/:id/preview', async (req: Request, res: Response) => {
  const sc = syncConnections.find((c) => c.id === req.params.id);
  if (!sc) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }

  const store = getEntityStore(sc.targetEntity);
  if (!store) {
    res.status(500).json({ success: false, error: `Unknown target entity: ${sc.targetEntity}` });
    return;
  }

  let rows: Record<string, string>[] = [];
  let simulated = false;

  try {
    if (sc.sourceType === 'DATABASE') {
      rows = generateMockRows(sc.targetEntity, sc.fieldMapping);
      simulated = true;
    } else {
      rows = await fetchUrlRows(sc.sourceType, resolveEffectiveConfig(sc));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown fetch error';
    res.json({
      success: false,
      error: `Source fetch failed: ${msg}`,
      suggestedFields: TARGET_FIELD_MAP[sc.targetEntity] || [],
    });
    return;
  }

  // Preview at most 10 rows
  const previewRows = rows.slice(0, 10);
  const matchSourceColumn = sc.fieldMapping[sc.matchKey];

  const preview = previewRows.map((row) => {
    const matchValue = matchSourceColumn ? row[matchSourceColumn] : undefined;
    let action: 'create' | 'update' | 'skip' = 'create';

    if (matchValue) {
      const existing = store.find((item: any) => {
        const targetValue = item[sc.matchKey];
        return targetValue !== undefined && String(targetValue).toLowerCase() === String(matchValue).toLowerCase();
      });

      if (existing) {
        // Check if any mapped fields differ
        let differs = false;
        for (const [targetField, sourceColumn] of Object.entries(sc.fieldMapping)) {
          if (targetField === sc.matchKey) continue;
          const newValue = row[sourceColumn];
          if (newValue !== undefined && newValue !== '' && existing[targetField] !== newValue) {
            differs = true;
            break;
          }
        }
        action = differs ? 'update' : 'skip';
      }
    } else {
      action = 'skip';
    }

    return {
      sourceRow: row,
      action,
      matchValue: matchValue || null,
    };
  });

  res.json({
    success: true,
    data: {
      totalSourceRows: rows.length,
      previewRows: preview,
      suggestedFields: TARGET_FIELD_MAP[sc.targetEntity] || [],
    },
    simulated,
  });
});

export default router;
