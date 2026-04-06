import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';

const ROLES = [
  'SUPER_ADMIN',
  'ORG_ADMIN',
  'PROCESS_OWNER',
  'DATA_STEWARD',
  'CONTRIBUTOR',
  'VIEWER',
] as const;

export interface StoredPerson {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;
  department: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export const people: StoredPerson[] = [];

const router = Router();

/** GET /api/v1/people */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? people.filter((p) => p.orgId === orgId) : people;
  res.json({ success: true, data: filtered, roles: ROLES });
});

/** GET /api/v1/people/:id */
router.get('/:id', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  res.json({ success: true, data: person });
});

/** POST /api/v1/people */
router.post('/', (req: Request, res: Response) => {
  const { orgId, name, email, role, department, title } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'Organization is required' }); return; }
  const now = new Date().toISOString();
  const person: StoredPerson = {
    id: uuid(), orgId, name,
    email: email || '', role: role || 'VIEWER',
    department: department || '', title: title || '',
    createdAt: now, updatedAt: now,
  };
  people.push(person);
  res.status(201).json({ success: true, data: person });
});

/** PUT /api/v1/people/:id */
router.put('/:id', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  const { name, email, role, department, title, orgId } = req.body;
  if (name !== undefined) person.name = name;
  if (email !== undefined) person.email = email;
  if (role !== undefined) person.role = role;
  if (department !== undefined) person.department = department;
  if (title !== undefined) person.title = title;
  if (orgId !== undefined) person.orgId = orgId;
  person.updatedAt = new Date().toISOString();
  res.json({ success: true, data: person });
});

/** DELETE /api/v1/people/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = people.findIndex((p) => p.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  people.splice(idx, 1);
  res.status(204).send();
});

export default router;
