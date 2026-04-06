import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';

export interface StoredOrg {
  id: string;
  name: string;
  industry: string;
  department: string;
  createdAt: string;
  updatedAt: string;
}

// Exported so other routes can reference orgs
export const organizations: StoredOrg[] = [
  {
    id: '00000000-0000-0000-0000-000000000010',
    name: 'Default Organization',
    industry: '',
    department: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const router = Router();

/** GET /api/v1/organizations */
router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: organizations });
});

/** GET /api/v1/organizations/:id */
router.get('/:id', (req: Request, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  res.json({ success: true, data: org });
});

/** POST /api/v1/organizations */
router.post('/', (req: Request, res: Response) => {
  const { name, industry, department } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  const now = new Date().toISOString();
  const org: StoredOrg = {
    id: uuid(), name,
    industry: industry || '', department: department || '',
    createdAt: now, updatedAt: now,
  };
  organizations.push(org);
  res.status(201).json({ success: true, data: org });
});

/** PUT /api/v1/organizations/:id */
router.put('/:id', (req: Request, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  const { name, industry, department } = req.body;
  if (name !== undefined) org.name = name;
  if (industry !== undefined) org.industry = industry;
  if (department !== undefined) org.department = department;
  org.updatedAt = new Date().toISOString();
  res.json({ success: true, data: org });
});

/** DELETE /api/v1/organizations/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = organizations.findIndex((o) => o.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  if (organizations[idx].id === '00000000-0000-0000-0000-000000000010') {
    res.status(400).json({ success: false, error: 'Cannot delete the default organization' });
    return;
  }
  organizations.splice(idx, 1);
  res.status(204).send();
});

export default router;
