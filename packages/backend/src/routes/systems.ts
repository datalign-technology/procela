import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore } from '../lib/persistence';
import { filterByOrgScope } from '../lib/org-scope';
import logger from '../lib/logger';
import { dataAssets } from './data-assets';
import { connections, connectionSystemLinks, connectionsForSystem } from './connections';
import { mappings } from './mappings';

interface StoredSystem {
  id: string;
  orgId: string;
  name: string;
  description: string;
  systemType: string;
  businessCriticality?: 'HIGH' | 'MEDIUM' | 'LOW';
  vendor?: string;
  integrationPoints?: string;
  /** How this system is intended to be reached. INTEGRATED expects one or
   *  more Connection profiles; MANUAL is a paper/spreadsheet/handoff
   *  process; EXTERNAL is vendor-managed with no API. Used by gap
   *  detection so a missing connection on a MANUAL system isn't a gap. */
  connectivity?: 'INTEGRATED' | 'MANUAL' | 'EXTERNAL';
  createdAt: string;
  updatedAt: string;
}

export const systems: StoredSystem[] = loadStore<StoredSystem>('systems');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const VALID_CONNECTIVITY = ['INTEGRATED', 'MANUAL', 'EXTERNAL'] as const;

let connectivityMigrated = false;
for (const s of systems) {
  if (!s.connectivity) {
    s.connectivity = 'INTEGRATED';
    connectivityMigrated = true;
  }
}
if (connectivityMigrated) saveStore('systems', systems);

const SYSTEM_TYPES = [
  'ERP', 'CRM', 'GIS', 'SCADA', 'Data Warehouse', 'Data Lake',
  'Business Intelligence', 'Document Management', 'HRIS', 'Financial',
  'Asset Management', 'Customer Portal', 'Billing', 'Spreadsheet', 'Other',
];

const router = Router();

/**
 * Roll connection-profile statuses up to a single system-level pill the UI
 * can render without doing its own join. INTEGRATED systems with zero
 * profiles are flagged so they show up in coverage gaps; MANUAL/EXTERNAL
 * systems return their connectivity verbatim so the absent connection
 * isn't treated as missing.
 */
function profilesForSystem(systemId: string) {
  // Pull profiles via the join table (authoritative) and fall back to
  // any remaining legacy single-systemId rows for migrations in flight.
  const linkedIds = new Set(connectionsForSystem(systemId));
  return connections.filter((c) => linkedIds.has(c.id) || c.systemId === systemId);
}

function rollupConnectionStatus(
  sys: StoredSystem,
): 'CONNECTED' | 'ERROR' | 'UNTESTED' | 'NOT_CONNECTED' | 'MANUAL' | 'EXTERNAL' {
  const profiles = profilesForSystem(sys.id);
  if (profiles.length === 0) {
    if (sys.connectivity === 'MANUAL') return 'MANUAL';
    if (sys.connectivity === 'EXTERNAL') return 'EXTERNAL';
    return 'NOT_CONNECTED';
  }
  if (profiles.some((p) => p.status === 'ERROR')) return 'ERROR';
  if (profiles.some((p) => p.status === 'CONNECTED')) return 'CONNECTED';
  return 'UNTESTED';
}

function decorate(sys: StoredSystem) {
  return {
    ...sys,
    connectivity: sys.connectivity || 'INTEGRATED',
    connectionCount: profilesForSystem(sys.id).length,
    connectionStatus: rollupConnectionStatus(sys),
  };
}

/** DELETE /api/v1/systems/all — delete all systems */
router.delete('/all', (_req: Request, res: Response) => {
  const count = systems.length;
  systems.splice(0, systems.length);
  saveStore('systems', systems);
  auditService.log(DEV_ORG_ID, null, 'System', '*', 'DELETE_ALL', null, { count });
  logger.info({ count }, 'Deleted all systems');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/systems */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = filterByOrgScope(systems, orgId as string | undefined);
  res.json({
    success: true,
    data: filtered.map(decorate),
    systemTypes: SYSTEM_TYPES,
    connectivityOptions: VALID_CONNECTIVITY,
  });
});

/** GET /api/v1/systems/:id */
router.get('/:id', (req: Request, res: Response) => {
  const sys = systems.find((s) => s.id === req.params.id);
  if (!sys) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  res.json({ success: true, data: decorate(sys) });
});

/** POST /api/v1/systems */
router.post('/', (req: Request, res: Response) => {
  const { name, description, systemType, orgId, businessCriticality, vendor, integrationPoints, connectivity } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (connectivity && !VALID_CONNECTIVITY.includes(connectivity)) {
    res.status(400).json({ success: false, error: `connectivity must be one of ${VALID_CONNECTIVITY.join(', ')}` });
    return;
  }
  const now = new Date().toISOString();
  const sys: StoredSystem = {
    id: uuid(), orgId: orgId || DEV_ORG_ID, name,
    description: description || '', systemType: systemType || '',
    connectivity: connectivity || 'INTEGRATED',
    ...(businessCriticality ? { businessCriticality } : {}),
    ...(vendor ? { vendor } : {}),
    ...(integrationPoints ? { integrationPoints } : {}),
    createdAt: now, updatedAt: now,
  };
  systems.push(sys);
  saveStore('systems', systems);
  auditService.log(DEV_ORG_ID, null, 'System', sys.id, 'CREATE', null, sys);
  res.status(201).json({ success: true, data: sys });
});

/** PUT /api/v1/systems/:id */
router.put('/:id', (req: Request, res: Response) => {
  const sys = systems.find((s) => s.id === req.params.id);
  if (!sys) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  const { name, description, systemType, businessCriticality, vendor, integrationPoints, connectivity } = req.body;
  if (connectivity !== undefined && !VALID_CONNECTIVITY.includes(connectivity)) {
    res.status(400).json({ success: false, error: `connectivity must be one of ${VALID_CONNECTIVITY.join(', ')}` });
    return;
  }
  if (name !== undefined) sys.name = name;
  if (description !== undefined) sys.description = description;
  if (systemType !== undefined) sys.systemType = systemType;
  if (businessCriticality !== undefined) sys.businessCriticality = businessCriticality || undefined;
  if (vendor !== undefined) sys.vendor = vendor || undefined;
  if (integrationPoints !== undefined) sys.integrationPoints = integrationPoints || undefined;
  if (connectivity !== undefined) sys.connectivity = connectivity;
  sys.updatedAt = new Date().toISOString();
  saveStore('systems', systems);
  auditService.log(DEV_ORG_ID, null, 'System', sys.id, 'UPDATE', null, sys);
  res.json({ success: true, data: sys });
});

/** GET /api/v1/systems/:id/impact — preview what would be affected by deleting this system */
router.get('/:id/impact', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const sys = systems.find((s) => s.id === id);
  if (!sys) { res.status(404).json({ success: false, error: 'System not found' }); return; }

  const assetsCount = dataAssets.filter((a) => a.systemId === id).length;
  const connectionsCount = profilesForSystem(id).length;
  const assetIds = new Set(dataAssets.filter((a) => a.systemId === id).map((a) => a.id));
  const mappingsCount = mappings.filter((m) => assetIds.has(m.dataAssetId)).length;

  res.json({ success: true, data: { assets: assetsCount, connections: connectionsCount, mappings: mappingsCount } });
});

/** DELETE /api/v1/systems/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = systems.findIndex((s) => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  const removed = systems[idx];
  auditService.log(DEV_ORG_ID, null, 'System', removed.id, 'DELETE', removed, null);
  systems.splice(idx, 1);
  saveStore('systems', systems);
  // Cascade: remove every connection→system link that pointed at this
  // system. The connections themselves keep existing — they may still
  // serve other systems, and a connection with zero links is a valid
  // "unassigned" state captured by gap detection.
  let removedLinks = 0;
  for (let i = connectionSystemLinks.length - 1; i >= 0; i--) {
    if (connectionSystemLinks[i].systemId === removed.id) {
      connectionSystemLinks.splice(i, 1);
      removedLinks++;
    }
  }
  if (removedLinks > 0) saveStore('connectionSystemLinks', connectionSystemLinks);
  // Re-mirror legacy systemId field on any connection that lost its
  // primary link, so older readers see the next remaining link (or '').
  let connsTouched = false;
  for (const c of connections) {
    if (c.systemId === removed.id) {
      const remaining = connectionsForSystem.length > 0 ? [] : []; // placeholder
      // Use the helper directly to read the current set per connection.
      const links = connectionSystemLinks.filter((l) => l.connectionId === c.id);
      c.systemId = links[0]?.systemId || '';
      c.updatedAt = new Date().toISOString();
      connsTouched = true;
    }
  }
  if (connsTouched) saveStore('connections', connections);
  res.status(204).send();
});

/**
 * POST /api/v1/systems/import
 * Import systems from CSV or JSON. orgId is required.
 *
 * JSON: { orgId, systems: [{ name, description?, systemType? }, ...] }
 * CSV:  { orgId, csv: "Name,Description,Type\nSAP ERP,Enterprise resource planning,ERP" }
 */
router.post('/import', (req: Request, res: Response) => {
  try {
    const { orgId, systems: systemList, csv } = req.body;

    if (!orgId) {
      res.status(400).json({ success: false, error: 'Organization is required for import' });
      return;
    }

    let rows: Array<{ name: string; description?: string; systemType?: string }> = [];

    if (csv && typeof csv === 'string') {
      const lines = csv.trim().split('\n');
      const header = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const descIdx = header.indexOf('description');
      const typeIdx = header.findIndex((h: string) => h === 'type' || h === 'systemtype' || h === 'system type');

      if (nameIdx === -1) {
        res.status(400).json({ success: false, error: 'CSV must have a "Name" column' });
        return;
      }

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c: string) => c.trim());
        if (!cols[nameIdx]) continue;
        rows.push({
          name: cols[nameIdx],
          description: descIdx >= 0 ? cols[descIdx] : undefined,
          systemType: typeIdx >= 0 ? cols[typeIdx] : undefined,
        });
      }
    } else if (Array.isArray(systemList)) {
      rows = systemList;
    } else {
      res.status(400).json({ success: false, error: 'Provide "systems" array or "csv" string' });
      return;
    }

    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No systems to import' });
      return;
    }

    const created: StoredSystem[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      if (!row.name) continue;
      // Skip duplicates — same name in same org
      const existingDup = systems.find(
        (s) => s.name.toLowerCase() === row.name.toLowerCase() && s.orgId === orgId,
      );
      if (existingDup) {
        skipped.push(row.name);
        continue;
      }
      const sys: StoredSystem = {
        id: uuid(), orgId, name: row.name,
        description: row.description || '',
        systemType: row.systemType && SYSTEM_TYPES.includes(row.systemType) ? row.systemType : row.systemType || '',
        createdAt: now, updatedAt: now,
      };
      systems.push(sys);
      created.push(sys);
    }

    saveStore('systems', systems);
    logger.info({ created: created.length, skipped: skipped.length, orgId }, 'Imported systems');
    res.status(201).json({
      success: true,
      data: created,
      skipped: skipped.length,
      skippedNames: skipped,
      message: skipped.length > 0
        ? `Imported ${created.length}, skipped ${skipped.length} duplicate(s): ${skipped.join(', ')}`
        : `Imported ${created.length} system(s)`,
    });
  } catch (err) {
    logger.error({ err }, 'Systems import failed');
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

export default router;
