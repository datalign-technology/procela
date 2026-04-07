import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { auditService } from '../services/audit.service';

interface StoredSystem {
  id: string;
  orgId: string;
  name: string;
  description: string;
  systemType: string;
  createdAt: string;
  updatedAt: string;
}

export const systems: StoredSystem[] = [];
const DEV_ORG_ID = '00000000-0000-0000-0000-000000000010';

const SYSTEM_TYPES = [
  'ERP', 'CRM', 'GIS', 'SCADA', 'Data Warehouse', 'Data Lake',
  'Business Intelligence', 'Document Management', 'HRIS', 'Financial',
  'Asset Management', 'Customer Portal', 'Billing', 'Spreadsheet', 'Other',
];

const router = Router();

/** GET /api/v1/systems */
router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: systems, systemTypes: SYSTEM_TYPES });
});

/** GET /api/v1/systems/:id */
router.get('/:id', (req: Request, res: Response) => {
  const sys = systems.find((s) => s.id === req.params.id);
  if (!sys) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  res.json({ success: true, data: sys });
});

/** POST /api/v1/systems */
router.post('/', (req: Request, res: Response) => {
  const { name, description, systemType } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const now = new Date().toISOString();
  const sys: StoredSystem = {
    id: uuid(), orgId: DEV_ORG_ID, name,
    description: description || '', systemType: systemType || '',
    createdAt: now, updatedAt: now,
  };
  systems.push(sys);
  auditService.log(DEV_ORG_ID, null, 'System', sys.id, 'CREATE', null, sys);
  res.status(201).json({ success: true, data: sys });
});

/** PUT /api/v1/systems/:id */
router.put('/:id', (req: Request, res: Response) => {
  const sys = systems.find((s) => s.id === req.params.id);
  if (!sys) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  const { name, description, systemType } = req.body;
  if (name !== undefined) sys.name = name;
  if (description !== undefined) sys.description = description;
  if (systemType !== undefined) sys.systemType = systemType;
  sys.updatedAt = new Date().toISOString();
  auditService.log(DEV_ORG_ID, null, 'System', sys.id, 'UPDATE', null, sys);
  res.json({ success: true, data: sys });
});

/** DELETE /api/v1/systems/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = systems.findIndex((s) => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'System not found' }); return; }
  auditService.log(DEV_ORG_ID, null, 'System', systems[idx].id, 'DELETE', systems[idx], null);
  systems.splice(idx, 1);
  res.status(204).send();
});

export default router;
