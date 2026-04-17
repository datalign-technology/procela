import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

interface StoredSystem {
  id: string;
  orgId: string;
  name: string;
  description: string;
  systemType: string;
  businessCriticality?: 'HIGH' | 'MEDIUM' | 'LOW';
  vendor?: string;
  integrationPoints?: string;
  createdAt: string;
  updatedAt: string;
}

export const systems: StoredSystem[] = loadStore<StoredSystem>('systems');
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const SYSTEM_TYPES = [
  'ERP', 'CRM', 'GIS', 'SCADA', 'Data Warehouse', 'Data Lake',
  'Business Intelligence', 'Document Management', 'HRIS', 'Financial',
  'Asset Management', 'Customer Portal', 'Billing', 'Spreadsheet', 'Other',
];

const router = Router();

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
  const filtered = orgId ? systems.filter((s) => s.orgId === orgId) : systems;
  res.json({ success: true, data: filtered, systemTypes: SYSTEM_TYPES });
});

/** GET /api/v1/systems/:id */
router.get('/:id', (req: Request, res: Response) => {
  const sys = systems.find((s) => s.id === req.params.id);
  if (!sys) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  res.json({ success: true, data: sys });
});

/** POST /api/v1/systems */
router.post('/', (req: Request, res: Response) => {
  const { name, description, systemType, orgId, businessCriticality, vendor, integrationPoints } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const now = new Date().toISOString();
  const sys: StoredSystem = {
    id: uuid(), orgId: orgId || DEV_ORG_ID, name,
    description: description || '', systemType: systemType || '',
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
  const { name, description, systemType, businessCriticality, vendor, integrationPoints } = req.body;
  if (name !== undefined) sys.name = name;
  if (description !== undefined) sys.description = description;
  if (systemType !== undefined) sys.systemType = systemType;
  if (businessCriticality !== undefined) sys.businessCriticality = businessCriticality || undefined;
  if (vendor !== undefined) sys.vendor = vendor || undefined;
  if (integrationPoints !== undefined) sys.integrationPoints = integrationPoints || undefined;
  sys.updatedAt = new Date().toISOString();
  saveStore('systems', systems);
  auditService.log(DEV_ORG_ID, null, 'System', sys.id, 'UPDATE', null, sys);
  res.json({ success: true, data: sys });
});

/** DELETE /api/v1/systems/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = systems.findIndex((s) => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  auditService.log(DEV_ORG_ID, null, 'System', systems[idx].id, 'DELETE', systems[idx], null);
  systems.splice(idx, 1);
  saveStore('systems', systems);
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
    const now = new Date().toISOString();

    for (const row of rows) {
      if (!row.name) continue;
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
    logger.info({ count: created.length, orgId }, 'Imported systems');
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error({ err }, 'Systems import failed');
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

export default router;
