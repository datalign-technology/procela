import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { organizations } from './organizations';
import logger from '../lib/logger';

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
  const { orgId, name, email, role, title } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (!orgId) { res.status(400).json({ success: false, error: 'Organization is required' }); return; }
  const org = organizations.find((o) => o.id === orgId);
  if (!org) { res.status(400).json({ success: false, error: 'Organization not found. Person must be assigned to an existing organization level.' }); return; }
  const now = new Date().toISOString();
  const person: StoredPerson = {
    id: uuid(), orgId, name,
    email: email || '', role: role || 'VIEWER',
    title: title || '',
    createdAt: now, updatedAt: now,
  };
  people.push(person);
  res.status(201).json({ success: true, data: person });
});

/** PUT /api/v1/people/:id */
router.put('/:id', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  const { name, email, role, title, orgId } = req.body;
  if (name !== undefined) person.name = name;
  if (email !== undefined) person.email = email;
  if (role !== undefined) person.role = role;
  if (title !== undefined) person.title = title;
  if (orgId !== undefined) {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) { res.status(400).json({ success: false, error: 'Organization not found. Person must be assigned to an existing organization level.' }); return; }
    person.orgId = orgId;
  }
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

/**
 * POST /api/v1/people/import
 * Import people from CSV or JSON. orgId is required.
 *
 * JSON: { orgId: string, people: [{ name, email?, role?, title? }, ...] }
 * CSV:  { orgId: string, csv: "Name,Email,Role,Title\nJohn,john@co.com,VIEWER,Manager" }
 */
router.post('/import', (req: Request, res: Response) => {
  try {
    const { orgId, people: peopleList, csv } = req.body;

    if (!orgId) {
      res.status(400).json({ success: false, error: 'Organization level is required for import' });
      return;
    }
    const org = organizations.find((o) => o.id === orgId);
    if (!org) {
      res.status(400).json({ success: false, error: 'Selected organization level does not exist' });
      return;
    }

    let rows: Array<{ name: string; email?: string; role?: string; title?: string }> = [];

    if (csv && typeof csv === 'string') {
      const lines = csv.trim().split('\n');
      const header = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const emailIdx = header.indexOf('email');
      const roleIdx = header.indexOf('role');
      const titleIdx = header.indexOf('title');

      if (nameIdx === -1) {
        res.status(400).json({ success: false, error: 'CSV must have a "Name" column' });
        return;
      }

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c: string) => c.trim());
        if (!cols[nameIdx]) continue;
        rows.push({
          name: cols[nameIdx],
          email: emailIdx >= 0 ? cols[emailIdx] : undefined,
          role: roleIdx >= 0 ? cols[roleIdx] : undefined,
          title: titleIdx >= 0 ? cols[titleIdx] : undefined,
        });
      }
    } else if (Array.isArray(peopleList)) {
      rows = peopleList;
    } else {
      res.status(400).json({ success: false, error: 'Provide "people" array or "csv" string' });
      return;
    }

    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No people to import' });
      return;
    }

    const validRoles = ROLES as readonly string[];
    const created: StoredPerson[] = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      if (!row.name) continue;
      const role = row.role && validRoles.includes(row.role.toUpperCase()) ? row.role.toUpperCase() : 'VIEWER';
      const person: StoredPerson = {
        id: uuid(), orgId, name: row.name,
        email: row.email || '', role,
        title: row.title || '',
        createdAt: now, updatedAt: now,
      };
      people.push(person);
      created.push(person);
    }

    logger.info({ count: created.length, orgId, orgName: org.name }, 'Imported people');
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error({ err }, 'People import failed');
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

export default router;
