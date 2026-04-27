import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { organizations } from './organizations';
import { people } from './people';
import { systems } from './systems';
import logger from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncConnection {
  id: string;
  orgId: string;
  name: string;
  targetEntity: 'organizations' | 'people' | 'systems';
  sourceType: 'DATABASE' | 'CSV_URL' | 'JSON_URL';
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
const TARGET_ENTITIES = ['organizations', 'people', 'systems'] as const;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEntityStore(targetEntity: string): any[] | null {
  switch (targetEntity) {
    case 'organizations': return organizations;
    case 'people': return people;
    case 'systems': return systems;
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
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headerRow = lines[0].split(',').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
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
  }

  store.push(newRecord);
  return 'created';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/** GET /api/v1/sync-connections — list all, supports ?orgId= and ?targetEntity= filters */
router.get('/', (req: Request, res: Response) => {
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
router.get('/:id', (req: Request, res: Response) => {
  const sc = syncConnections.find((c) => c.id === req.params.id);
  if (!sc) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }
  res.json({ success: true, data: sc });
});

/** POST /api/v1/sync-connections — create new sync connection */
router.post('/', (req: Request, res: Response) => {
  const { name, targetEntity, sourceType, config, fieldMapping, matchKey, schedule, orgId } = req.body;

  if (!name) {
    res.status(400).json({ success: false, error: 'Name is required' });
    return;
  }
  if (!targetEntity || !TARGET_ENTITIES.includes(targetEntity)) {
    res.status(400).json({ success: false, error: `targetEntity must be one of: ${TARGET_ENTITIES.join(', ')}` });
    return;
  }
  if (!sourceType || !SOURCE_TYPES.includes(sourceType)) {
    res.status(400).json({ success: false, error: `sourceType must be one of: ${SOURCE_TYPES.join(', ')}` });
    return;
  }
  if (!matchKey) {
    res.status(400).json({ success: false, error: 'matchKey is required' });
    return;
  }

  const now = new Date().toISOString();
  const intervalMinutes = schedule?.intervalMinutes || 360;

  const sc: SyncConnection = {
    id: uuid(),
    orgId: orgId || DEV_ORG_ID,
    name,
    targetEntity,
    sourceType,
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

  syncConnections.push(sc);
  saveStore('syncConnections', syncConnections);
  logger.info({ id: sc.id, name: sc.name, targetEntity: sc.targetEntity, sourceType: sc.sourceType }, 'Created sync connection');
  res.status(201).json({ success: true, data: sc });
});

/** PUT /api/v1/sync-connections/:id — update connection */
router.put('/:id', (req: Request, res: Response) => {
  const sc = syncConnections.find((c) => c.id === req.params.id);
  if (!sc) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }

  const { name, targetEntity, sourceType, config, fieldMapping, matchKey, schedule, status } = req.body;

  if (name !== undefined) sc.name = name;
  if (targetEntity !== undefined) {
    if (!TARGET_ENTITIES.includes(targetEntity)) {
      res.status(400).json({ success: false, error: `targetEntity must be one of: ${TARGET_ENTITIES.join(', ')}` });
      return;
    }
    sc.targetEntity = targetEntity;
  }
  if (sourceType !== undefined) {
    if (!SOURCE_TYPES.includes(sourceType)) {
      res.status(400).json({ success: false, error: `sourceType must be one of: ${SOURCE_TYPES.join(', ')}` });
      return;
    }
    sc.sourceType = sourceType;
  }
  if (config !== undefined) sc.config = { ...sc.config, ...config };
  if (fieldMapping !== undefined) sc.fieldMapping = fieldMapping;
  if (matchKey !== undefined) sc.matchKey = matchKey;
  if (status !== undefined && ['ACTIVE', 'PAUSED', 'ERROR'].includes(status)) {
    sc.status = status;
  }
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
  saveStore('syncConnections', syncConnections);
  res.json({ success: true, data: sc });
});

/** DELETE /api/v1/sync-connections/:id — delete connection */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = syncConnections.findIndex((c) => c.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Sync connection not found' });
    return;
  }
  const removed = syncConnections[idx];
  syncConnections.splice(idx, 1);
  saveStore('syncConnections', syncConnections);
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
      rows = await fetchUrlRows(sc.sourceType, sc.config);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown fetch error';
    result.errors = 1;
    result.errorMessages.push(`Source fetch failed: ${msg}`);
    sc.status = 'ERROR';
    sc.lastSyncResult = result;
    sc.updatedAt = new Date().toISOString();
    saveStore('syncConnections', syncConnections);
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

  // Persist the target entity store
  saveStore(sc.targetEntity, store);

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
  saveStore('syncConnections', syncConnections);

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
      rows = await fetchUrlRows(sc.sourceType, sc.config);
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
