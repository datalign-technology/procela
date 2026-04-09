import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';

export interface StoredOrg {
  id: string;
  parentId: string | null;
  name: string;
  type: string; // 'company' | 'division' | 'department' | 'team' | 'unit'
  industry: string;
  description: string;
  headCount: number;
  createdAt: string;
  updatedAt: string;
}

const ORG_TYPES = ['company', 'division', 'department', 'team', 'unit'] as const;

const DEFAULT_ORG: StoredOrg = {
  id: '00000000-0000-0000-0000-000000000010',
  parentId: null,
  name: 'Default Organization',
  type: 'company',
  industry: '',
  description: '',
  headCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const loaded = loadStore<StoredOrg>('organizations');
export const organizations: StoredOrg[] = loaded.length > 0 ? loaded : [DEFAULT_ORG];

// ── Helpers ──

function buildTree(orgs: StoredOrg[]): any[] {
  const map = new Map<string, any>();
  const roots: any[] = [];

  for (const org of orgs) {
    map.set(org.id, { ...org, children: [] });
  }

  for (const org of orgs) {
    const node = map.get(org.id);
    if (org.parentId && map.has(org.parentId)) {
      map.get(org.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

const router = Router();

/** GET /api/v1/organizations — returns flat list and tree */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: organizations,
    tree: buildTree(organizations),
    orgTypes: ORG_TYPES,
  });
});

/** GET /api/v1/organizations/:id */
router.get('/:id', (req: Request, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  res.json({ success: true, data: org });
});

/** POST /api/v1/organizations */
router.post('/', (req: Request, res: Response) => {
  const { name, parentId, type, industry, description, headCount } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (parentId && !organizations.find((o) => o.id === parentId)) {
    res.status(400).json({ success: false, error: 'Parent organization not found' });
    return;
  }
  const now = new Date().toISOString();
  const org: StoredOrg = {
    id: uuid(), parentId: parentId || null, name,
    type: type || 'department', industry: industry || '',
    description: description || '', headCount: headCount || 0,
    createdAt: now, updatedAt: now,
  };
  organizations.push(org);
  saveStore('organizations', organizations);
  res.status(201).json({ success: true, data: org });
});

/** PUT /api/v1/organizations/:id */
router.put('/:id', (req: Request, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  const { name, parentId, type, industry, description, headCount } = req.body;
  if (name !== undefined) org.name = name;
  if (parentId !== undefined) org.parentId = parentId;
  if (type !== undefined) org.type = type;
  if (industry !== undefined) org.industry = industry;
  if (description !== undefined) org.description = description;
  if (headCount !== undefined) org.headCount = headCount;
  org.updatedAt = new Date().toISOString();
  saveStore('organizations', organizations);
  res.json({ success: true, data: org });
});

/** DELETE /api/v1/organizations/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  // Must have at least one org remaining
  const topLevelOrgs = organizations.filter((o) => !o.parentId);
  if (topLevelOrgs.length <= 1 && !org.parentId) {
    res.status(400).json({ success: false, error: 'Cannot delete the last top-level organization' });
    return;
  }
  // Re-parent children to this org's parent
  for (const child of organizations) {
    if (child.parentId === org.id) {
      child.parentId = org.parentId;
    }
  }
  const idx = organizations.findIndex((o) => o.id === req.params.id);
  organizations.splice(idx, 1);
  saveStore('organizations', organizations);
  res.status(204).send();
});

/**
 * POST /api/v1/organizations/import
 * Import org structure from JSON or CSV-style data.
 *
 * JSON format: { organizations: [{ name, parentName?, type?, industry?, description? }, ...] }
 * CSV format:  { csv: "Name,Parent,Type,Industry,Description\nAcme Corp,,company,..." }
 */
router.post('/import', (req: Request, res: Response) => {
  try {
    const { organizations: orgList, csv, parentId } = req.body;
    const rootParent = parentId || null;
    const created: StoredOrg[] = [];
    const nameToId = new Map<string, string>();

    // Build map of existing orgs by name
    for (const existing of organizations) {
      nameToId.set(existing.name.toLowerCase(), existing.id);
    }

    let rows: Array<{ name: string; parentName?: string; type?: string; industry?: string; description?: string }> = [];

    if (csv && typeof csv === 'string') {
      // Parse CSV
      const lines = csv.trim().split('\n');
      const header = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const parentIdx = header.indexOf('parent');
      const typeIdx = header.indexOf('type');
      const industryIdx = header.indexOf('industry');
      const descIdx = header.indexOf('description');

      if (nameIdx === -1) {
        res.status(400).json({ success: false, error: 'CSV must have a "Name" column' });
        return;
      }

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c: string) => c.trim());
        if (!cols[nameIdx]) continue;
        rows.push({
          name: cols[nameIdx],
          parentName: parentIdx >= 0 ? cols[parentIdx] : undefined,
          type: typeIdx >= 0 ? cols[typeIdx] : undefined,
          industry: industryIdx >= 0 ? cols[industryIdx] : undefined,
          description: descIdx >= 0 ? cols[descIdx] : undefined,
        });
      }
    } else if (Array.isArray(orgList)) {
      rows = orgList;
    } else {
      res.status(400).json({ success: false, error: 'Provide "organizations" array or "csv" string' });
      return;
    }

    if (rows.length === 0) {
      res.status(400).json({ success: false, error: 'No organizations to import' });
      return;
    }

    // Process in order — parents should come before children
    const now = new Date().toISOString();

    for (const row of rows) {
      let pid = rootParent;
      if (row.parentName) {
        const parentKey = row.parentName.toLowerCase();
        if (nameToId.has(parentKey)) {
          pid = nameToId.get(parentKey)!;
        }
      }

      const org: StoredOrg = {
        id: uuid(), parentId: pid, name: row.name,
        type: row.type || 'department', industry: row.industry || '',
        description: row.description || '', headCount: 0,
        createdAt: now, updatedAt: now,
      };
      organizations.push(org);
      created.push(org);
      nameToId.set(org.name.toLowerCase(), org.id);
    }

    saveStore('organizations', organizations);
    logger.info({ count: created.length }, 'Imported organizations');
    res.status(201).json({ success: true, data: created, tree: buildTree(organizations) });
  } catch (err) {
    logger.error({ err }, 'Organization import failed');
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

export default router;
