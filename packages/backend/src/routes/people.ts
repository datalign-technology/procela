import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import { organizations } from './organizations';
import { damaRoles, DAMA_ROLE_TYPES } from './dama-roles';
import { governanceGroups } from './governance-groups';
import { processNodes } from './process-catalog';
import { dataAssets } from './data-assets';
import { dataDomains } from './data-domains';
import logger from '../lib/logger';

const ROLES = [
  'SUPER_ADMIN',
  'ORG_ADMIN',
  'EDITOR',
  'CONTRIBUTOR',
  'VIEWER',
] as const;

export interface StoredPerson {
  id: string;
  orgIds: string[];
  accessibleOrgIds: string[];
  name: string;
  email: string;
  role: string;
  title: string;
  jobRole?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Org access resolution ──

export function getDescendantOrgIds(orgId: string): string[] {
  const ids: string[] = [];
  const children = organizations.filter((o) => o.parentId === orgId);
  for (const child of children) {
    ids.push(child.id);
    ids.push(...getDescendantOrgIds(child.id));
  }
  return ids;
}

function getAncestorOrgs(orgId: string, levels: string[]): string[] {
  const ids: string[] = [];
  let current = organizations.find((o) => o.id === orgId);
  while (current?.parentId) {
    const parent = organizations.find((o) => o.id === current!.parentId);
    if (!parent) break;
    if (levels.includes(parent.type)) ids.push(parent.id);
    current = parent;
  }
  return ids;
}

const WORKING_LEVELS = ['company', 'division'];

export function computeAccessibleOrgs(person: StoredPerson): Array<{ id: string; name: string; type: string }> {
  const allWorkingOrgs = organizations.filter((o) => WORKING_LEVELS.includes(o.type));

  // SUPER_ADMIN: everything
  if (person.role === 'SUPER_ADMIN') {
    return allWorkingOrgs.map((o) => ({ id: o.id, name: o.name, type: o.type }));
  }

  const computed = new Set<string>();

  // Process each assigned org
  for (const assignedOrgId of person.orgIds) {
    const assignedOrg = organizations.find((o) => o.id === assignedOrgId);
    if (!assignedOrg) continue;

    if (assignedOrg.type === 'company') {
      computed.add(assignedOrg.id);
      if (person.role === 'ORG_ADMIN') {
        for (const did of getDescendantOrgIds(assignedOrg.id)) {
          const d = organizations.find((o) => o.id === did);
          if (d && WORKING_LEVELS.includes(d.type)) computed.add(d.id);
        }
      } else {
        const childDivisions = organizations.filter((o) => o.parentId === assignedOrg.id && o.type === 'division');
        for (const div of childDivisions) computed.add(div.id);
      }
    } else if (assignedOrg.type === 'division') {
      computed.add(assignedOrg.id);
      if (person.role === 'ORG_ADMIN') {
        for (const did of getDescendantOrgIds(assignedOrg.id)) {
          const d = organizations.find((o) => o.id === did);
          if (d && WORKING_LEVELS.includes(d.type)) computed.add(d.id);
        }
      }
    } else {
      // Department/team/unit: find parent division or company
      for (const aid of getAncestorOrgs(assignedOrg.id, WORKING_LEVELS)) computed.add(aid);
    }
  }

  // Add explicit grants
  for (const grantId of person.accessibleOrgIds) {
    const org = organizations.find((o) => o.id === grantId);
    if (org && WORKING_LEVELS.includes(org.type)) computed.add(grantId);
  }

  // Deduplicate by org ID (Set guarantees uniqueness) and by name
  // in case the same org appears under different IDs
  const seen = new Set<string>();
  return Array.from(computed)
    .map((id) => {
      const org = organizations.find((o) => o.id === id);
      return org ? { id: org.id, name: org.name, type: org.type } : null;
    })
    .filter((o): o is { id: string; name: string; type: string } => {
      if (!o) return false;
      const key = `${o.name.toLowerCase()}|${o.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Returns the full set of org IDs the authenticated user is allowed to see,
 * or `null` when the user has unrestricted access (SUPER_ADMIN, or a user
 * with no matching people record — the dev fallback).
 *
 * The visible set is derived from `computeAccessibleOrgs` and then expanded
 * to include every descendant (of any org type) under each accessible
 * working-level org. This ensures a user scoped to, e.g., "Newport News
 * Shipbuilding" cannot see sibling divisions or other unrelated companies,
 * but can still see the departments/teams/units beneath NNS.
 */
export function getVisibleOrgIds(
  user: { email?: string; role?: string } | undefined | null,
): Set<string> | null {
  if (!user) return null;
  if (user.role === 'SUPER_ADMIN') return null;

  const person = people.find(
    (p) => p.email.toLowerCase() === (user.email || '').toLowerCase(),
  );
  // No matching people record — dev fallback, unrestricted.
  if (!person) return null;
  if (person.role === 'SUPER_ADMIN') return null;

  const visible = new Set<string>();
  for (const o of computeAccessibleOrgs(person)) {
    visible.add(o.id);
    for (const descId of getDescendantOrgIds(o.id)) {
      visible.add(descId);
    }
  }
  return visible;
}

/**
 * Returns true if the user is allowed to access the given org.
 * An unrestricted user (SUPER_ADMIN / dev fallback) always passes.
 */
export function canAccessOrg(
  user: { email?: string; role?: string } | undefined | null,
  orgId: string,
): boolean {
  const visible = getVisibleOrgIds(user);
  if (visible === null) return true;
  return visible.has(orgId);
}

export const people: StoredPerson[] = loadStore<StoredPerson>('people');

// Migration: PROCESS_OWNER and DATA_STEWARD were legacy app-roles that
// conflated platform permissions with governance accountability. They've
// been replaced by the DAMA role model. Migrate anyone still carrying
// the old values to EDITOR (closest equivalent permission set).
const LEGACY_ROLES = new Set(['PROCESS_OWNER', 'DATA_STEWARD']);
let migrated = 0;
for (const p of people) {
  if (LEGACY_ROLES.has(p.role)) {
    p.role = 'EDITOR';
    migrated++;
  }
}
if (migrated > 0) {
  saveStore('people', people);
  logger.info({ migrated }, 'Migrated legacy PROCESS_OWNER/DATA_STEWARD roles to EDITOR');
}

const router = Router();

/** DELETE /api/v1/people/all — delete all people */
router.delete('/all', (_req: Request, res: Response) => {
  const count = people.length;
  people.splice(0, people.length);
  saveStore('people', people);
  logger.info({ count }, 'Deleted all people');
  res.json({ success: true, deleted: count });
});

/** GET /api/v1/people */
router.get('/', (req: Request, res: Response) => {
  const { orgId } = req.query;
  const filtered = orgId ? people.filter((p) => p.orgIds.includes(orgId as string)) : people;
  res.json({ success: true, data: filtered, roles: ROLES });
});

/** GET /api/v1/people/:id/360 — full 360 view of a person */
router.get('/:id/360', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }

  // Org assignments with resolved names
  const orgAssignments = person.orgIds
    .map((oid) => organizations.find((o) => o.id === oid))
    .filter(Boolean)
    .map((o) => ({ id: o!.id, name: o!.name, type: o!.type }));

  // DAMA roles
  const personDamaRoles = damaRoles
    .filter((r) => r.personId === person.id)
    .map((r) => {
      let scopeName = r.scopeId;
      if (r.scopeType === 'ORG') {
        const org = organizations.find((o) => o.id === r.scopeId);
        if (org) scopeName = org.name;
      }
      return { ...r, scopeName };
    });

  // Governance group memberships
  const personGroups = governanceGroups
    .filter((g) => g.members.some((m) => m.personId === person.id))
    .map((g) => {
      const membership = g.members.find((m) => m.personId === person.id)!;
      return { groupId: g.id, groupName: g.name, groupType: g.type, groupRole: membership.groupRole, since: membership.since };
    });

  // Process nodes owned
  const ownedProcessNodes = processNodes
    .filter((n) => n.ownerId === person.id)
    .map((n) => ({ id: n.id, name: n.name, level: n.level, status: n.status }));

  // Data assets owned or stewarded
  const ownedDataAssets = dataAssets
    .filter((a) => a.owner === person.id || a.owner === person.name)
    .map((a) => ({ id: a.id, name: a.name, governanceTier: a.governanceTier, relation: 'owner' as const }));
  const stewardedDataAssets = dataAssets
    .filter((a) => (a.stewardIds || []).includes(person.id) && a.owner !== person.id)
    .map((a) => ({ id: a.id, name: a.name, governanceTier: a.governanceTier, relation: 'steward' as const }));

  // Governance groups scoped to the person's orgs — deduplicated by
  // name+type to avoid showing multiple "Data Governance Council" entries
  // that may exist if templates were generated more than once.
  const personOrgSet = new Set(person.orgIds || []);
  const orgScopedGroups = governanceGroups.filter((g) => personOrgSet.size === 0 || personOrgSet.has(g.orgId));
  const seenGroupKeys = new Set<string>();
  const allGroups = orgScopedGroups
    .filter((g) => {
      const key = `${g.name.toLowerCase()}|${g.type}`;
      if (seenGroupKeys.has(key)) return false;
      seenGroupKeys.add(key);
      return true;
    })
    .map((g) => ({ id: g.id, name: g.name, type: g.type }));

  // All data domains (for checkbox UI) — scoped to person's orgs
  const allDomains = dataDomains
    .filter((d) => personOrgSet.size === 0 || personOrgSet.has(d.orgId))
    .map((d) => ({ id: d.id, name: d.name, ownerId: d.ownerId, stewardIds: d.stewardIds }));

  // All DAMA role types
  const allDamaRoleTypes = [...DAMA_ROLE_TYPES];

  res.json({
    success: true,
    data: {
      person,
      orgAssignments,
      damaRoles: personDamaRoles,
      governanceGroups: personGroups,
      ownedProcessNodes,
      dataAssets: [...ownedDataAssets, ...stewardedDataAssets],
      allGroups,
      allDomains,
      allDamaRoleTypes,
    },
  });
});

/** GET /api/v1/people/:id */
router.get('/:id', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  res.json({ success: true, data: person });
});

/** POST /api/v1/people */
router.post('/', (req: Request, res: Response) => {
  const { orgIds, orgId, name, email, role, title, jobRole, accessibleOrgIds } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  // Support both orgIds (array) and orgId (single, backward compat)
  const assignedOrgIds: string[] = orgIds || (orgId ? [orgId] : []);
  if (assignedOrgIds.length === 0) { res.status(400).json({ success: false, error: 'At least one organization is required' }); return; }
  // Prevent duplicate emails
  if (email && people.find((p) => p.email.toLowerCase() === email.toLowerCase())) {
    res.status(409).json({ success: false, error: `A person with email "${email}" already exists.` });
    return;
  }
  for (const oid of assignedOrgIds) {
    const org = organizations.find((o) => o.id === oid);
    if (!org) { res.status(400).json({ success: false, error: `Organization "${oid}" not found.` }); return; }
  }
  const now = new Date().toISOString();
  const person: StoredPerson = {
    id: uuid(), orgIds: assignedOrgIds, name,
    email: email || '', role: role || 'VIEWER',
    title: title || '',
    ...(jobRole ? { jobRole } : {}),
    accessibleOrgIds: accessibleOrgIds || [],
    createdAt: now, updatedAt: now,
  };
  people.push(person);
  saveStore('people', people);
  res.status(201).json({ success: true, data: person });
});

/** PUT /api/v1/people/:id */
router.put('/:id', (req: Request, res: Response) => {
  const person = people.find((p) => p.id === req.params.id);
  if (!person) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  const { name, email, role, title, jobRole, orgIds, orgId, accessibleOrgIds } = req.body;
  if (name !== undefined) person.name = name;
  if (email !== undefined) person.email = email;
  if (role !== undefined) person.role = role;
  if (title !== undefined) person.title = title;
  if (jobRole !== undefined) person.jobRole = jobRole || undefined;
  if (accessibleOrgIds !== undefined) person.accessibleOrgIds = accessibleOrgIds;
  // Support both orgIds (array) and orgId (single, backward compat)
  const newOrgIds = orgIds || (orgId ? [orgId] : undefined);
  if (newOrgIds !== undefined) {
    for (const oid of newOrgIds) {
      const org = organizations.find((o) => o.id === oid);
      if (!org) { res.status(400).json({ success: false, error: `Organization "${oid}" not found.` }); return; }
    }
    person.orgIds = newOrgIds;
  }
  person.updatedAt = new Date().toISOString();
  saveStore('people', people);
  res.json({ success: true, data: person });
});

/** DELETE /api/v1/people/:id */
router.delete('/:id', (req: Request, res: Response) => {
  const idx = people.findIndex((p) => p.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Person not found' }); return; }
  people.splice(idx, 1);
  saveStore('people', people);
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
    const skipped: string[] = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      if (!row.name) continue;
      // Skip duplicates by email
      if (row.email) {
        const existing = people.find((p) => p.email.toLowerCase() === row.email!.toLowerCase());
        if (existing) {
          skipped.push(row.email);
          continue;
        }
      }
      const role = row.role && validRoles.includes(row.role.toUpperCase()) ? row.role.toUpperCase() : 'VIEWER';
      const person: StoredPerson = {
        id: uuid(), orgIds: [orgId], name: row.name,
        email: row.email || '', role,
        title: row.title || '',
        accessibleOrgIds: [],
        createdAt: now, updatedAt: now,
      };
      people.push(person);
      created.push(person);
    }

    saveStore('people', people);
    logger.info({ created: created.length, skipped: skipped.length, orgId, orgName: org.name }, 'Imported people');
    res.status(201).json({
      success: true,
      data: created,
      skipped: skipped.length,
      skippedEmails: skipped,
      message: skipped.length > 0
        ? `Imported ${created.length}, skipped ${skipped.length} (duplicate email: ${skipped.join(', ')})`
        : `Imported ${created.length} people`,
    });
  } catch (err) {
    logger.error({ err }, 'People import failed');
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

export default router;
