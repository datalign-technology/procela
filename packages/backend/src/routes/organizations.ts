import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../lib/persistence';
import logger from '../lib/logger';
import { AuthenticatedRequest } from '../middleware/auth';
// Lazy-required inside handlers to avoid the circular import with
// `routes/people` (which imports the `organizations` array from this file).
// Using `require` at call-time ensures both modules are fully initialised
// before `getVisibleOrgIds` is invoked.
function accessHelpers(): typeof import('./people') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./people');
}

export interface StoredOrg {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  industry: string;
  description: string;
  headCount: number;
  statusMode?: 'simple' | 'advanced';
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

export const organizations: StoredOrg[] = loadStore<StoredOrg>('organizations');

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

/** DELETE /api/v1/organizations/all — delete all organizations */
router.delete('/all', (req: AuthenticatedRequest, res: Response) => {
  const { getVisibleOrgIds } = accessHelpers();
  if (getVisibleOrgIds(req.user) !== null) {
    res.status(403).json({ success: false, error: 'Only super admins can delete all organizations' });
    return;
  }
  const count = organizations.length;
  organizations.splice(0, organizations.length);
  saveStore('organizations', organizations);
  logger.info({ count }, 'Deleted all organizations');
  res.json({ success: true, deleted: count });
});

/**
 * GET /api/v1/organizations — returns flat list and tree, scoped to the
 * user's visible orgs and (optionally) narrowed to a subtree rooted at
 * `?scopeOrgId=<id>`. The frontend passes its active "Working In" context
 * as `scopeOrgId` so the user only sees the org they're currently working in
 * and its descendants.
 */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
  const { getVisibleOrgIds, getDescendantOrgIds } = accessHelpers();
  const visible = getVisibleOrgIds(req.user);
  let scoped = visible === null
    ? organizations
    : organizations.filter((o) => visible.has(o.id));

  const scopeOrgId = typeof req.query.scopeOrgId === 'string' ? req.query.scopeOrgId : null;
  if (scopeOrgId) {
    const scopeRoot = organizations.find((o) => o.id === scopeOrgId);
    if (!scopeRoot) {
      res.status(404).json({ success: false, error: 'Scope organization not found' });
      return;
    }
    // Security: the scope must be in the user's visible set.
    if (visible !== null && !visible.has(scopeOrgId)) {
      res.status(403).json({ success: false, error: 'You do not have access to the specified scope organization' });
      return;
    }
    const subtreeIds = new Set<string>([scopeOrgId, ...getDescendantOrgIds(scopeOrgId)]);
    scoped = scoped.filter((o) => subtreeIds.has(o.id));
  }

  res.json({
    success: true,
    data: scoped,
    tree: buildTree(scoped),
    orgTypes: ORG_TYPES,
  });
});

/** GET /api/v1/organizations/:id */
router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  const { canAccessOrg } = accessHelpers();
  if (!canAccessOrg(req.user, org.id)) {
    res.status(403).json({ success: false, error: 'You do not have access to this organization' });
    return;
  }
  res.json({ success: true, data: org });
});

/** POST /api/v1/organizations */
router.post('/', (req: AuthenticatedRequest, res: Response) => {
  const { name, parentId, type, industry, description, headCount } = req.body;
  if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return; }
  if (parentId && !organizations.find((o) => o.id === parentId)) {
    res.status(400).json({ success: false, error: 'Parent organization not found' });
    return;
  }
  const { getVisibleOrgIds } = accessHelpers();
  const visible = getVisibleOrgIds(req.user);
  if (parentId) {
    if (visible !== null && !visible.has(parentId)) {
      res.status(403).json({ success: false, error: 'You do not have access to the specified parent organization' });
      return;
    }
  } else if (visible !== null) {
    // A null parentId means creating a top-level org — reserved for unrestricted users.
    res.status(403).json({ success: false, error: 'Only super admins can create top-level organizations' });
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
router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  const { canAccessOrg } = accessHelpers();
  if (!canAccessOrg(req.user, org.id)) {
    res.status(403).json({ success: false, error: 'You do not have access to this organization' });
    return;
  }
  const { name, parentId, type, industry, description, headCount } = req.body;
  // If the caller is trying to reparent, make sure the new parent is also in scope.
  if (parentId !== undefined && parentId !== org.parentId && parentId !== null) {
    if (!canAccessOrg(req.user, parentId)) {
      res.status(403).json({ success: false, error: 'You do not have access to the specified parent organization' });
      return;
    }
  }
  const { statusMode } = req.body;
  if (name !== undefined) org.name = name;
  if (parentId !== undefined) org.parentId = parentId;
  if (type !== undefined) org.type = type;
  if (industry !== undefined) org.industry = industry;
  if (description !== undefined) org.description = description;
  if (headCount !== undefined) org.headCount = headCount;
  if (statusMode !== undefined && (statusMode === 'simple' || statusMode === 'advanced')) org.statusMode = statusMode;
  org.updatedAt = new Date().toISOString();
  saveStore('organizations', organizations);
  res.json({ success: true, data: org });
});

/** DELETE /api/v1/organizations/:id */
/** GET /api/v1/organizations/:id/impact — preview what deleting this org would affect */
router.get('/:id/impact', (req: AuthenticatedRequest, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }

  // Collect this org + all descendant org IDs
  const orgIds = new Set<string>([org.id]);
  const collectDescendants = (parentId: string) => {
    for (const child of organizations.filter((o) => o.parentId === parentId)) {
      orgIds.add(child.id);
      collectDescendants(child.id);
    }
  };
  collectDescendants(org.id);

  // Count associated data across all stores (defensive requires)
  let people: any[] = [];
  let processNodes: any[] = [];
  let dataAssets: any[] = [];
  let systems: any[] = [];
  let dataDomains: any[] = [];
  let mappings: any[] = [];
  let governanceGroups: any[] = [];
  let damaRoles: any[] = [];
  let governanceTasks: any[] = [];
  let governanceIssues: any[] = [];
  let governancePolicies: any[] = [];
  let governanceControls: any[] = [];
  let glossaryTerms: any[] = [];
  let sops: any[] = [];
  let calendarEvents: any[] = [];
  let decisionRights: any[] = [];
  try { people = require('./people').people; } catch {}
  try { processNodes = require('./process-catalog').processNodes; } catch {}
  try { dataAssets = require('./data-assets').dataAssets; } catch {}
  try { systems = require('./systems').systems; } catch {}
  try { dataDomains = require('./data-domains').dataDomains; } catch {}
  try { mappings = require('./mappings').mappings; } catch {}
  try { governanceGroups = require('./governance-groups').governanceGroups; } catch {}
  try { damaRoles = require('./dama-roles').damaRoles; } catch {}
  try { governanceTasks = require('./governance-tasks').governanceTasks; } catch {}
  try { governanceIssues = require('./governance-issues').governanceIssues; } catch {}
  try { governancePolicies = require('./governance-policies').governancePolicies; } catch {}
  try { governanceControls = require('./governance-controls').governanceControls; } catch {}
  try { glossaryTerms = require('./business-glossary').glossaryTerms; } catch {}
  try { sops = require('./sops').sops; } catch {}
  try { calendarEvents = require('./governance-calendar').calendarEvents; } catch {}
  try { decisionRights = require('./decision-rights').decisionRights; } catch {}

  const matchOrg = (item: any) => orgIds.has(item.orgId);
  const matchOrgIds = (item: any) => (item.orgIds || []).some((id: string) => orgIds.has(id));

  res.json({
    success: true,
    data: {
      childOrgs: orgIds.size - 1,
      people: people.filter(matchOrgIds).length,
      processes: processNodes.filter((n: any) => (n.orgIds || []).some((id: string) => orgIds.has(id)) || orgIds.has(n.orgId)).length,
      dataAssets: dataAssets.filter(matchOrg).length,
      systems: systems.filter(matchOrg).length,
      dataDomains: dataDomains.filter(matchOrg).length,
      mappings: mappings.filter(matchOrg).length,
      governanceGroups: governanceGroups.filter(matchOrg).length,
      damaRoles: damaRoles.filter((r: any) => orgIds.has(r.scopeId)).length,
      tasks: governanceTasks.filter(matchOrg).length,
      issues: governanceIssues.filter(matchOrg).length,
      policies: governancePolicies.filter(matchOrg).length,
      controls: governanceControls.filter(matchOrg).length,
      glossaryTerms: glossaryTerms.filter(matchOrg).length,
      sops: sops.filter(matchOrg).length,
      calendarEvents: calendarEvents.filter(matchOrg).length,
      decisionRights: decisionRights.filter(matchOrg).length,
    },
  });
});

router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  const { canAccessOrg } = accessHelpers();
  if (!canAccessOrg(req.user, org.id)) {
    res.status(403).json({ success: false, error: 'You do not have access to this organization' });
    return;
  }

  // Collect this org + all descendant org IDs
  const orgIds = new Set<string>([org.id]);
  const collectDescendants = (parentId: string) => {
    for (const child of organizations.filter((o) => o.parentId === parentId)) {
      orgIds.add(child.id);
      collectDescendants(child.id);
    }
  };
  collectDescendants(org.id);

  // Cascade delete all associated data
  const cascadeDelete = (store: any[], storeName: string, matchFn: (item: any) => boolean) => {
    let removed = 0;
    for (let i = store.length - 1; i >= 0; i--) {
      if (matchFn(store[i])) { store.splice(i, 1); removed++; }
    }
    if (removed > 0) saveStore(storeName, store);
    return removed;
  };

  const matchOrg = (item: any) => orgIds.has(item.orgId);
  const matchOrgIds = (item: any) => (item.orgIds || []).some((id: string) => orgIds.has(id));
  const cascaded: Record<string, number> = {};

  try { cascaded.people = cascadeDelete(require('./people').people, 'people', matchOrgIds); } catch {}
  try { cascaded.processNodes = cascadeDelete(require('./process-catalog').processNodes, 'processNodes', (n) => (n.orgIds || []).some((id: string) => orgIds.has(id)) || orgIds.has(n.orgId)); } catch {}
  try { cascaded.dataAssets = cascadeDelete(require('./data-assets').dataAssets, 'dataAssets', matchOrg); } catch {}
  try { cascaded.systems = cascadeDelete(require('./systems').systems, 'systems', matchOrg); } catch {}
  try { cascaded.dataDomains = cascadeDelete(require('./data-domains').dataDomains, 'dataDomains', matchOrg); } catch {}
  try { cascaded.mappings = cascadeDelete(require('./mappings').mappings, 'mappings', matchOrg); } catch {}
  try { cascaded.governanceGroups = cascadeDelete(require('./governance-groups').governanceGroups, 'governanceGroups', matchOrg); } catch {}
  try { cascaded.damaRoles = cascadeDelete(require('./dama-roles').damaRoles, 'damaRoles', (r) => orgIds.has(r.scopeId)); } catch {}
  try { cascaded.governanceTasks = cascadeDelete(require('./governance-tasks').governanceTasks, 'governanceTasks', matchOrg); } catch {}
  try { cascaded.governanceIssues = cascadeDelete(require('./governance-issues').governanceIssues, 'governanceIssues', matchOrg); } catch {}
  try { cascaded.governancePolicies = cascadeDelete(require('./governance-policies').governancePolicies, 'governancePolicies', matchOrg); } catch {}
  try { cascaded.governanceControls = cascadeDelete(require('./governance-controls').governanceControls, 'governanceControls', matchOrg); } catch {}
  try { cascaded.glossaryTerms = cascadeDelete(require('./business-glossary').glossaryTerms, 'glossaryTerms', matchOrg); } catch {}
  try { cascaded.sops = cascadeDelete(require('./sops').sops, 'sops', matchOrg); } catch {}
  try { cascaded.calendarEvents = cascadeDelete(require('./governance-calendar').calendarEvents, 'calendarEvents', matchOrg); } catch {}
  try { cascaded.decisionRights = cascadeDelete(require('./decision-rights').decisionRights, 'decisionRights', matchOrg); } catch {}

  // Delete the org(s) themselves
  const orgIdsArray = Array.from(orgIds);
  for (let i = organizations.length - 1; i >= 0; i--) {
    if (orgIds.has(organizations[i].id)) organizations.splice(i, 1);
  }
  saveStore('organizations', organizations);

  logger.info({ orgId: org.id, orgName: org.name, descendantCount: orgIds.size - 1, cascaded }, 'Deleted organization with cascade');
  res.json({ success: true, deleted: orgIdsArray.length, cascaded });
});

/**
 * POST /api/v1/organizations/:id/status-mode
 * Switch between simple (Draft/Active/Deprecated) and advanced
 * (Draft/Proposed/Under Review/Approved/Active/Deprecated) status modes.
 * Migrates existing entity statuses when switching:
 * - advanced → simple: PROPOSED/UNDER_REVIEW/APPROVED → DRAFT
 * - simple → advanced: no migration needed (simple statuses are a subset)
 */
router.post('/:id/status-mode', (req: AuthenticatedRequest, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }

  const { mode } = req.body;
  if (mode !== 'simple' && mode !== 'advanced') {
    res.status(400).json({ success: false, error: 'mode must be "simple" or "advanced"' });
    return;
  }

  const oldMode = org.statusMode || 'simple';
  if (mode === oldMode) {
    res.json({ success: true, data: org, migrated: 0, message: `Already in ${mode} mode` });
    return;
  }

  org.statusMode = mode;
  org.updatedAt = new Date().toISOString();
  saveStore('organizations', organizations);

  // Migrate process nodes and data domains in this org's scope
  let migrated = 0;
  if (mode === 'simple') {
    const { getDescendantOrgIds } = accessHelpers();
    const scopeIds = new Set([org.id, ...getDescendantOrgIds(org.id)]);
    const legacyStatuses = new Set(['PROPOSED', 'UNDER_REVIEW', 'APPROVED']);

    // Lazy-require to avoid circular deps
    const { processNodes } = require('./process-catalog');
    const { saveStore: save } = require('../lib/persistence');
    for (const node of processNodes) {
      if ((scopeIds.has(node.orgId) || (node.orgIds || []).some((id: string) => scopeIds.has(id))) && legacyStatuses.has(node.status)) {
        node.status = 'DRAFT';
        migrated++;
      }
    }
    if (migrated > 0) save('processNodes', processNodes);

    const { dataDomains } = require('./data-domains');
    let domainsMigrated = 0;
    for (const d of dataDomains) {
      if (scopeIds.has(d.orgId) && legacyStatuses.has(d.status)) {
        d.status = 'DRAFT';
        domainsMigrated++;
      }
    }
    if (domainsMigrated > 0) { save('dataDomains', dataDomains); migrated += domainsMigrated; }
  }

  logger.info({ orgId: org.id, oldMode, newMode: mode, migrated }, 'Status mode switched');
  res.json({
    success: true,
    data: org,
    migrated,
    message: migrated > 0
      ? `Switched to ${mode} mode. ${migrated} item(s) migrated from review/approval statuses to Draft.`
      : `Switched to ${mode} mode.`,
  });
});

/**
 * POST /api/v1/organizations/import
 * Import org structure from JSON or CSV-style data.
 *
 * JSON format: { organizations: [{ name, parentName?, type?, industry?, description? }, ...] }
 * CSV format:  { csv: "Name,Parent,Type,Industry,Description\nAcme Corp,,company,..." }
 */
router.post('/import', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { organizations: orgList, csv, parentId } = req.body;
    const rootParent = parentId || null;
    const created: StoredOrg[] = [];
    const nameToId = new Map<string, string>();

    const { getVisibleOrgIds } = accessHelpers();
    const visible = getVisibleOrgIds(req.user);

    // Restricted users must import under an org they have access to. They can
    // never import rootless (top-level) orgs, and any explicit parentId has
    // to resolve to an accessible org.
    if (visible !== null) {
      if (!rootParent) {
        res.status(403).json({ success: false, error: 'Only super admins can import top-level organizations' });
        return;
      }
      if (!visible.has(rootParent)) {
        res.status(403).json({ success: false, error: 'You do not have access to the specified parent organization' });
        return;
      }
    }

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

    // Track which orgs existed before this import so dedup only checks
    // pre-existing records, not ones created in this batch.
    const preExistingIds = new Set(organizations.map((o) => o.id));
    const newlyCreated = new Set<string>();
    const skipped: string[] = [];

    for (const row of rows) {
      let pid = rootParent;
      if (row.parentName) {
        const parentKey = row.parentName.toLowerCase();
        if (nameToId.has(parentKey)) {
          pid = nameToId.get(parentKey)!;
        }
      }

      // Skip duplicates — same name + same parent, but only check
      // orgs that existed BEFORE this import (not ones created in this batch)
      const existingDup = organizations.find(
        (o) => preExistingIds.has(o.id) && o.name.toLowerCase() === row.name.toLowerCase() && o.parentId === pid,
      );
      if (existingDup) {
        skipped.push(row.name);
        continue;
      }

      // For restricted users, the resolved parent must be an accessible org
      // (or an org created earlier in this same import, which by construction
      // sits under an accessible root).
      if (visible !== null && pid && !visible.has(pid) && !newlyCreated.has(pid)) {
        res.status(403).json({
          success: false,
          error: `Row "${row.name}" resolves to a parent outside your accessible scope`,
        });
        return;
      }

      const org: StoredOrg = {
        id: uuid(), parentId: pid, name: row.name,
        type: row.type || 'department', industry: row.industry || '',
        description: row.description || '', headCount: 0,
        createdAt: now, updatedAt: now,
      };
      organizations.push(org);
      created.push(org);
      newlyCreated.add(org.id);
      nameToId.set(org.name.toLowerCase(), org.id);
    }

    saveStore('organizations', organizations);
    logger.info({ created: created.length, skipped: skipped.length }, 'Imported organizations');
    res.status(201).json({
      success: true,
      data: created,
      tree: buildTree(organizations),
      skipped: skipped.length,
      skippedNames: skipped,
      message: skipped.length > 0
        ? `Imported ${created.length}, skipped ${skipped.length} duplicate(s): ${skipped.join(', ')}`
        : `Imported ${created.length} organization(s)`,
    });
  } catch (err) {
    logger.error({ err }, 'Organization import failed');
    res.status(500).json({ success: false, error: 'Import failed' });
  }
});

export default router;
