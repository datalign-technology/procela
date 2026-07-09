import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore, registerStore } from '../lib/persistence';
import { parseCsv } from '../lib/csv';
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
  statusMode?: 'simple' | 'review' | 'advanced';
  // ── SSO white-labeling ─────────────────────────────────────────
  // Only meaningful on company-level orgs. Populated when a
  // customer runs Procela under their own subdomain / tenant slug
  // and wants the sign-in card to read as their brand rather than
  // generic Procela.
  /** Tenant slug used to resolve branding on the login screen —
   *  either `<slug>.procela.io` as a subdomain or `?tenant=<slug>`
   *  as a query param. Lower-case ASCII + hyphens; unique across
   *  companies. */
  tenantSlug?: string;
  /** Human display name shown on the login card ("Tidewater
   *  Utilities" instead of "Procela"). Falls back to `name`. */
  brandDisplayName?: string;
  /** Emoji or single-character glyph rendered next to the display
   *  name. Kept text-only in v1 to sidestep asset upload +
   *  cache-invalidation complexity — a logo URL / SVG upload can
   *  come later without breaking existing rows. */
  brandGlyph?: string;
  /** Label on the primary SSO button — "Sign in with Corp SSO",
   *  "Sign in with Azure AD", etc. Falls back to the generic
   *  provider name when unset. */
  ssoButtonLabel?: string;
  /** Hex color (with leading #) used for the SSO button + accent.
   *  Falls back to Procela primary when unset. */
  brandPrimaryColor?: string;
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
registerStore('organizations', organizations);

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
  const { statusMode, tenantSlug, brandDisplayName, brandGlyph, ssoButtonLabel, brandPrimaryColor } = req.body;
  if (name !== undefined) org.name = name;
  if (parentId !== undefined) org.parentId = parentId;
  if (type !== undefined) org.type = type;
  if (industry !== undefined) org.industry = industry;
  if (description !== undefined) org.description = description;
  if (headCount !== undefined) org.headCount = headCount;
  if (statusMode !== undefined && (statusMode === 'simple' || statusMode === 'review' || statusMode === 'advanced')) org.statusMode = statusMode;

  // ── SSO white-labeling ──
  if (tenantSlug !== undefined) {
    const cleaned = typeof tenantSlug === 'string' ? tenantSlug.trim().toLowerCase() : '';
    if (cleaned === '') {
      org.tenantSlug = undefined;
    } else if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(cleaned)) {
      res.status(400).json({ success: false, error: 'tenantSlug must be 3-64 lowercase letters, digits, or hyphens (no leading/trailing hyphen).' });
      return;
    } else {
      const clash = organizations.find((o) => o.id !== org.id && o.tenantSlug === cleaned);
      if (clash) {
        res.status(409).json({ success: false, error: `Tenant slug "${cleaned}" is already in use.` });
        return;
      }
      org.tenantSlug = cleaned;
    }
  }
  if (brandDisplayName !== undefined) org.brandDisplayName = typeof brandDisplayName === 'string' ? brandDisplayName.slice(0, 80) : undefined;
  if (brandGlyph !== undefined) org.brandGlyph = typeof brandGlyph === 'string' ? brandGlyph.slice(0, 8) : undefined;
  if (ssoButtonLabel !== undefined) org.ssoButtonLabel = typeof ssoButtonLabel === 'string' ? ssoButtonLabel.slice(0, 80) : undefined;
  if (brandPrimaryColor !== undefined) {
    if (brandPrimaryColor === '' || brandPrimaryColor === null) {
      org.brandPrimaryColor = undefined;
    } else if (typeof brandPrimaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(brandPrimaryColor)) {
      org.brandPrimaryColor = brandPrimaryColor;
    } else {
      res.status(400).json({ success: false, error: 'brandPrimaryColor must be a #RRGGBB hex string.' });
      return;
    }
  }
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

  // Up to 3 sample names per category — turns "47 mappings" into
  // "47 mappings — Bills→Customer Master, Outages→SCADA, +44 more"
  // in the delete dialog so users see what they're actually about
  // to delete, not just a count.
  const SAMPLE_LIMIT = 3;
  const samplesOf = <T,>(items: T[], pick: (i: T) => string): string[] =>
    items.slice(0, SAMPLE_LIMIT).map(pick).filter(Boolean);
  const mappingLabel = (m: any) => {
    const node = processNodes.find((n: any) => n.id === m.processStepId);
    const asset = dataAssets.find((a: any) => a.id === m.dataAssetId);
    return `${node?.name || '?'} → ${asset?.name || '?'}`;
  };
  const childOrgsList = [...orgIds].filter((id) => id !== org.id)
    .map((id) => organizations.find((o) => o.id === id))
    .filter((o) => !!o);

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
      samples: {
        childOrgs:        samplesOf(childOrgsList, (o: any) => o.name),
        people:           samplesOf(people.filter(matchOrgIds), (p: any) => p.name),
        processes:        samplesOf(processNodes.filter((n: any) => (n.orgIds || []).some((id: string) => orgIds.has(id)) || orgIds.has(n.orgId)), (n: any) => n.name),
        dataAssets:       samplesOf(dataAssets.filter(matchOrg), (a: any) => a.name),
        systems:          samplesOf(systems.filter(matchOrg), (s: any) => s.name),
        dataDomains:      samplesOf(dataDomains.filter(matchOrg), (d: any) => d.name),
        mappings:         samplesOf(mappings.filter(matchOrg), mappingLabel),
        governanceGroups: samplesOf(governanceGroups.filter(matchOrg), (g: any) => g.name),
        damaRoles:        samplesOf(damaRoles.filter((r: any) => orgIds.has(r.scopeId)), (r: any) => r.roleLabel || r.roleType || r.id),
        tasks:            samplesOf(governanceTasks.filter(matchOrg), (t: any) => t.title || t.name || t.id),
        issues:           samplesOf(governanceIssues.filter(matchOrg), (i: any) => i.title || i.name || i.id),
        policies:         samplesOf(governancePolicies.filter(matchOrg), (p: any) => p.name),
        controls:         samplesOf(governanceControls.filter(matchOrg), (c: any) => c.name),
        glossaryTerms:    samplesOf(glossaryTerms.filter(matchOrg), (g: any) => g.term || g.name),
        sops:             samplesOf(sops.filter(matchOrg), (s: any) => s.title || s.name),
        calendarEvents:   samplesOf(calendarEvents.filter(matchOrg), (e: any) => e.title || e.name || e.id),
        decisionRights:   samplesOf(decisionRights.filter(matchOrg), (d: any) => d.decision || d.name || d.id),
      },
    },
  });
});

// GET /api/v1/organizations/:id/snapshot — full JSON dump of every
// entity the delete would touch. Used by the "Export org snapshot"
// button in the delete dialog so a user has a recovery archive
// before they pull the trigger.
router.get('/:id/snapshot', (req: AuthenticatedRequest, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  const { canAccessOrg } = accessHelpers();
  if (!canAccessOrg(req.user, org.id)) {
    res.status(403).json({ success: false, error: 'You do not have access to this organization' });
    return;
  }
  const orgIds = new Set<string>([org.id]);
  const walk = (parentId: string) => {
    for (const child of organizations.filter((o) => o.parentId === parentId)) {
      orgIds.add(child.id); walk(child.id);
    }
  };
  walk(org.id);

  // Defensive requires mirror the impact endpoint — keep both in
  // sync if more categories are added.
  const reqStore = (path: string, key: string): any[] => {
    try { return require(path)[key] || []; } catch { return []; }
  };
  const people = reqStore('./people', 'people');
  const processNodes = reqStore('./process-catalog', 'processNodes');
  const dataAssets = reqStore('./data-assets', 'dataAssets');
  const systems = reqStore('./systems', 'systems');
  const dataDomains = reqStore('./data-domains', 'dataDomains');
  const mappings = reqStore('./mappings', 'mappings');
  const governanceGroups = reqStore('./governance-groups', 'governanceGroups');
  const damaRoles = reqStore('./dama-roles', 'damaRoles');
  const governanceTasks = reqStore('./governance-tasks', 'governanceTasks');
  const governanceIssues = reqStore('./governance-issues', 'governanceIssues');
  const governancePolicies = reqStore('./governance-policies', 'governancePolicies');
  const governanceControls = reqStore('./governance-controls', 'governanceControls');
  const glossaryTerms = reqStore('./business-glossary', 'glossaryTerms');
  const sops = reqStore('./sops', 'sops');
  const calendarEvents = reqStore('./governance-calendar', 'calendarEvents');
  const decisionRights = reqStore('./decision-rights', 'decisionRights');

  const matchOrg = (item: any) => orgIds.has(item.orgId);
  const matchOrgIds = (item: any) => (item.orgIds || []).some((id: string) => orgIds.has(id));

  res.json({
    success: true,
    snapshot: {
      generatedAt: new Date().toISOString(),
      rootOrgId: org.id,
      rootOrgName: org.name,
      subtreeOrgIds: [...orgIds],
      // Every entity that would be touched by DELETE /:id (default
      // cascade). Re-importing this archive is not yet wired — the
      // file is a manual recovery aid for now.
      organizations: organizations.filter((o) => orgIds.has(o.id)),
      people: people.filter(matchOrgIds),
      processNodes: processNodes.filter((n: any) => (n.orgIds || []).some((id: string) => orgIds.has(id)) || orgIds.has(n.orgId)),
      dataAssets: dataAssets.filter(matchOrg),
      systems: systems.filter(matchOrg),
      dataDomains: dataDomains.filter(matchOrg),
      mappings: mappings.filter(matchOrg),
      governanceGroups: governanceGroups.filter(matchOrg),
      damaRoles: damaRoles.filter((r: any) => orgIds.has(r.scopeId)),
      governanceTasks: governanceTasks.filter(matchOrg),
      governanceIssues: governanceIssues.filter(matchOrg),
      governancePolicies: governancePolicies.filter(matchOrg),
      governanceControls: governanceControls.filter(matchOrg),
      glossaryTerms: glossaryTerms.filter(matchOrg),
      sops: sops.filter(matchOrg),
      calendarEvents: calendarEvents.filter(matchOrg),
      decisionRights: decisionRights.filter(matchOrg),
    },
  });
});

/**
 * DELETE /api/v1/organizations/:id
 *
 * Default behavior (empty body, or {"actions": {}}): cascade-deletes every
 * descendant org and every entity tied to the deleted subtree. This matches
 * the original cascade behavior so existing callers stay working.
 *
 * With an `actions` body, the caller can choose per-category cleanup:
 *   - "delete": drop every matching row (default for any unspecified key)
 *   - "move":   re-home every matching row to `targetOrgId`
 *   - "orphan": for multi-org entities only (people, processes), strip the
 *               removed org IDs from `orgIds[]`. If the array becomes empty
 *               the row is deleted.
 *
 * Body shape:
 *   {
 *     "actions": {
 *       "childOrgs": { "type": "move", "targetOrgId": "..." },
 *       "people":    { "type": "orphan" },
 *       "dataAssets":{ "type": "delete" },
 *       ...
 *     }
 *   }
 */
type ActionType = 'delete' | 'move' | 'orphan';
interface CategoryAction { type: ActionType; targetOrgId?: string }
type CategoryKey =
  | 'childOrgs' | 'people' | 'processes' | 'dataAssets' | 'systems'
  | 'dataDomains' | 'mappings' | 'governanceGroups' | 'damaRoles'
  | 'tasks' | 'issues' | 'policies' | 'controls'
  | 'glossaryTerms' | 'sops' | 'calendarEvents' | 'decisionRights';

const ORPHAN_ELIGIBLE: ReadonlySet<CategoryKey> = new Set<CategoryKey>(['people', 'processes']);

interface ApplyResult { deleted: number; moved: number; orphaned: number }

router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
  const org = organizations.find((o) => o.id === req.params.id);
  if (!org) { res.status(404).json({ success: false, error: 'Organization not found' }); return; }
  const { canAccessOrg, getDescendantOrgIds } = accessHelpers();
  if (!canAccessOrg(req.user, org.id)) {
    res.status(403).json({ success: false, error: 'You do not have access to this organization' });
    return;
  }

  const subtreeIds = new Set<string>([org.id, ...getDescendantOrgIds(org.id)]);
  const directChildIds = new Set(organizations.filter((o) => o.parentId === org.id).map((o) => o.id));

  // Resolve and validate actions up front. An unspecified action defaults
  // to "delete" so callers that don't send a body get the original cascade.
  const incoming: Partial<Record<CategoryKey, CategoryAction>> = req.body?.actions || {};
  const resolved: Record<CategoryKey, CategoryAction> = {} as any;
  const KEYS: CategoryKey[] = [
    'childOrgs', 'people', 'processes', 'dataAssets', 'systems',
    'dataDomains', 'mappings', 'governanceGroups', 'damaRoles',
    'tasks', 'issues', 'policies', 'controls',
    'glossaryTerms', 'sops', 'calendarEvents', 'decisionRights',
  ];
  for (const key of KEYS) {
    const a = incoming[key] || { type: 'delete' };
    if (a.type !== 'delete' && a.type !== 'move' && a.type !== 'orphan') {
      res.status(400).json({ success: false, error: `Invalid action type for "${key}"` });
      return;
    }
    if (a.type === 'orphan' && !ORPHAN_ELIGIBLE.has(key)) {
      res.status(400).json({ success: false, error: `Orphan is only allowed for People and Processes (rejected for "${key}")` });
      return;
    }
    if (a.type === 'move') {
      if (!a.targetOrgId) {
        res.status(400).json({ success: false, error: `targetOrgId is required for move action on "${key}"` });
        return;
      }
      if (subtreeIds.has(a.targetOrgId)) {
        res.status(400).json({ success: false, error: `Move target for "${key}" cannot be inside the deleted subtree` });
        return;
      }
      if (!organizations.find((o) => o.id === a.targetOrgId)) {
        res.status(400).json({ success: false, error: `Move target organization for "${key}" not found` });
        return;
      }
      if (!canAccessOrg(req.user, a.targetOrgId)) {
        res.status(403).json({ success: false, error: `You do not have access to the move target for "${key}"` });
        return;
      }
    }
    resolved[key] = a;
  }

  // The set of org IDs whose entities receive the action. If child orgs are
  // being moved the descendants survive, so only the org itself is "removed."
  const removedOrgIds = resolved.childOrgs.type === 'move'
    ? new Set<string>([org.id])
    : new Set<string>(subtreeIds);

  // Apply child-org action first so subsequent entity ops see the right tree.
  let childOrgsDeleted = 0;
  let childOrgsMoved = 0;
  if (resolved.childOrgs.type === 'move') {
    // Reparent direct children only — descendants below them stay put.
    for (const o of organizations) {
      if (directChildIds.has(o.id)) {
        o.parentId = resolved.childOrgs.targetOrgId!;
        o.updatedAt = new Date().toISOString();
        childOrgsMoved++;
      }
    }
  } else {
    // Delete every descendant; the root org is removed at the end.
    for (let i = organizations.length - 1; i >= 0; i--) {
      if (subtreeIds.has(organizations[i].id) && organizations[i].id !== org.id) {
        organizations.splice(i, 1);
        childOrgsDeleted++;
      }
    }
  }

  // Track IDs that were physically removed so we can prune cross-references.
  const deletedIds = {
    people: new Set<string>(),
    processNodes: new Set<string>(),
    dataAssets: new Set<string>(),
    dataDomains: new Set<string>(),
    governanceGroups: new Set<string>(),
  };

  // ── Helpers for applying actions ────────────────────────────────────────
  const applySingleOrg = (
    store: any[],
    storeName: string,
    action: CategoryAction,
    deletedSet?: Set<string>,
    orgField: string = 'orgId',
  ): ApplyResult => {
    let deleted = 0, moved = 0;
    if (action.type === 'delete') {
      for (let i = store.length - 1; i >= 0; i--) {
        if (removedOrgIds.has(store[i][orgField])) {
          if (deletedSet) deletedSet.add(store[i].id);
          store.splice(i, 1); deleted++;
        }
      }
    } else if (action.type === 'move') {
      for (const item of store) {
        if (removedOrgIds.has(item[orgField])) {
          item[orgField] = action.targetOrgId!;
          if (item.updatedAt !== undefined) item.updatedAt = new Date().toISOString();
          moved++;
        }
      }
    }
    if (deleted > 0 || moved > 0) saveStore(storeName, store);
    return { deleted, moved, orphaned: 0 };
  };

  const applyMultiOrg = (
    store: any[],
    storeName: string,
    action: CategoryAction,
    deletedSet: Set<string>,
  ): ApplyResult => {
    let deleted = 0, moved = 0, orphaned = 0;
    for (let i = store.length - 1; i >= 0; i--) {
      const item = store[i];
      const itemOrgIds: string[] = item.orgIds || [];
      const matched = itemOrgIds.some((id: string) => removedOrgIds.has(id))
        || (item.orgId !== undefined && removedOrgIds.has(item.orgId));
      if (!matched) continue;

      if (action.type === 'delete') {
        deletedSet.add(item.id); store.splice(i, 1); deleted++;
        continue;
      }

      const remaining = itemOrgIds.filter((id: string) => !removedOrgIds.has(id));

      if (action.type === 'move') {
        const target = action.targetOrgId!;
        if (!remaining.includes(target)) remaining.push(target);
        item.orgIds = remaining;
        if (item.orgId !== undefined && removedOrgIds.has(item.orgId)) item.orgId = target;
        if (item.updatedAt !== undefined) item.updatedAt = new Date().toISOString();
        moved++;
      } else { // orphan
        if (remaining.length === 0) {
          // No surviving org → delete row instead of leaving it homeless.
          deletedSet.add(item.id); store.splice(i, 1); deleted++;
        } else {
          item.orgIds = remaining;
          if (item.orgId !== undefined && removedOrgIds.has(item.orgId)) item.orgId = remaining[0];
          if (item.updatedAt !== undefined) item.updatedAt = new Date().toISOString();
          orphaned++;
        }
      }
    }
    if (deleted > 0 || moved > 0 || orphaned > 0) saveStore(storeName, store);
    return { deleted, moved, orphaned };
  };

  const summary: Record<string, ApplyResult> = {};

  // ── Apply actions per category ──────────────────────────────────────────
  try { summary.people           = applyMultiOrg(require('./people').people,                          'people',             resolved.people,            deletedIds.people); } catch {}
  try { summary.processes        = applyMultiOrg(require('./process-catalog').processNodes,          'processNodes',       resolved.processes,         deletedIds.processNodes); } catch {}
  try { summary.dataAssets       = applySingleOrg(require('./data-assets').dataAssets,                'dataAssets',         resolved.dataAssets,        deletedIds.dataAssets); } catch {}
  try { summary.systems          = applySingleOrg(require('./systems').systems,                      'systems',            resolved.systems); } catch {}
  try { summary.dataDomains      = applySingleOrg(require('./data-domains').dataDomains,             'dataDomains',        resolved.dataDomains,       deletedIds.dataDomains); } catch {}
  try { summary.mappings         = applySingleOrg(require('./mappings').mappings,                    'mappings',           resolved.mappings); } catch {}
  try { summary.governanceGroups = applySingleOrg(require('./governance-groups').governanceGroups,   'governanceGroups',   resolved.governanceGroups,  deletedIds.governanceGroups); } catch {}
  try { summary.damaRoles        = applySingleOrg(require('./dama-roles').damaRoles,                 'damaRoles',          resolved.damaRoles, undefined, 'scopeId'); } catch {}
  try { summary.tasks            = applySingleOrg(require('./governance-tasks').governanceTasks,     'governanceTasks',    resolved.tasks); } catch {}
  try { summary.issues           = applySingleOrg(require('./governance-issues').governanceIssues,   'governanceIssues',   resolved.issues); } catch {}
  try { summary.policies         = applySingleOrg(require('./governance-policies').governancePolicies, 'governancePolicies', resolved.policies); } catch {}
  try { summary.controls         = applySingleOrg(require('./governance-controls').governanceControls, 'governanceControls', resolved.controls); } catch {}
  try { summary.glossaryTerms    = applySingleOrg(require('./business-glossary').glossaryTerms,      'glossaryTerms',      resolved.glossaryTerms); } catch {}
  try { summary.sops             = applySingleOrg(require('./sops').sops,                            'sops',               resolved.sops); } catch {}
  try { summary.calendarEvents   = applySingleOrg(require('./governance-calendar').calendarEvents,   'calendarEvents',     resolved.calendarEvents); } catch {}
  try { summary.decisionRights   = applySingleOrg(require('./decision-rights').decisionRights,       'decisionRights',     resolved.decisionRights); } catch {}

  // ── Cross-reference cleanup ─────────────────────────────────────────────
  // Anything physically deleted above leaves dangling IDs on surviving rows.
  // Prune them so we don't ship the org with stale references.
  if (deletedIds.people.size > 0) {
    try {
      const groups = require('./governance-groups').governanceGroups;
      let changed = false;
      for (const g of groups) {
        if (!Array.isArray(g.members)) continue;
        const before = g.members.length;
        g.members = g.members.filter((m: any) => !deletedIds.people.has(m.personId));
        if (g.members.length !== before) { changed = true; g.updatedAt = new Date().toISOString(); }
      }
      if (changed) saveStore('governanceGroups', groups);
    } catch {}
    try {
      const damaRoles = require('./dama-roles').damaRoles;
      let removed = 0;
      for (let i = damaRoles.length - 1; i >= 0; i--) {
        if (damaRoles[i].personId && deletedIds.people.has(damaRoles[i].personId)) {
          damaRoles.splice(i, 1); removed++;
        }
      }
      if (removed > 0) saveStore('damaRoles', damaRoles);
    } catch {}
  }

  if (deletedIds.dataAssets.size > 0) {
    try {
      const mappings = require('./mappings').mappings;
      let removed = 0;
      for (let i = mappings.length - 1; i >= 0; i--) {
        if (deletedIds.dataAssets.has(mappings[i].dataAssetId)) { mappings.splice(i, 1); removed++; }
      }
      if (removed > 0) saveStore('mappings', mappings);
    } catch {}
    try {
      const domains = require('./data-domains').dataDomains;
      let changed = false;
      for (const d of domains) {
        if (!Array.isArray(d.dataAssetIds)) continue;
        const before = d.dataAssetIds.length;
        d.dataAssetIds = d.dataAssetIds.filter((aid: string) => !deletedIds.dataAssets.has(aid));
        if (d.dataAssetIds.length !== before) { changed = true; d.updatedAt = new Date().toISOString(); }
      }
      if (changed) saveStore('dataDomains', domains);
    } catch {}
  }

  if (deletedIds.processNodes.size > 0) {
    try {
      const mappings = require('./mappings').mappings;
      let removed = 0;
      for (let i = mappings.length - 1; i >= 0; i--) {
        if (deletedIds.processNodes.has(mappings[i].processStepId)) { mappings.splice(i, 1); removed++; }
      }
      if (removed > 0) saveStore('mappings', mappings);
    } catch {}
  }

  // Finally, remove the root org itself.
  for (let i = organizations.length - 1; i >= 0; i--) {
    if (organizations[i].id === org.id) { organizations.splice(i, 1); break; }
  }
  saveStore('organizations', organizations);

  // Single summary audit entry — easier to scan than 16 separate lines.
  logger.info({
    orgId: org.id,
    orgName: org.name,
    actions: resolved,
    summary,
    childOrgsDeleted, childOrgsMoved,
  }, 'Deleted organization with cleanup');

  res.json({
    success: true,
    deletedOrgId: org.id,
    childOrgs: { deleted: childOrgsDeleted, moved: childOrgsMoved },
    summary,
  });
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
  if (mode !== 'simple' && mode !== 'review' && mode !== 'advanced') {
    res.status(400).json({ success: false, error: 'mode must be "simple", "review", or "advanced"' });
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

  // Migrate process nodes and data domains in this org's scope. When
  // switching *out of* a mode that carries statuses the new mode
  // doesn't recognise, park those rows back on DRAFT so the
  // transition machine on the target mode has valid ground state.
  let migrated = 0;
  const needsMigration = mode === 'simple' || mode === 'review';
  if (needsMigration) {
    const { getDescendantOrgIds } = accessHelpers();
    const scopeIds = new Set([org.id, ...getDescendantOrgIds(org.id)]);
    // Statuses that exist in advanced but neither simple nor review.
    // review understands PENDING_REVIEW natively, so leave those alone
    // when moving simple → review or vice versa. simple recognises
    // only DRAFT / ACTIVE / DEPRECATED and needs both bucket cleared.
    const legacyStatuses = mode === 'simple'
      ? new Set(['PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'PENDING_REVIEW'])
      : new Set(['PROPOSED', 'UNDER_REVIEW', 'APPROVED']);

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
      const parsed = parseCsv(csv);
      if (parsed.length === 0) {
        res.status(400).json({ success: false, error: 'CSV appears to be empty' });
        return;
      }
      const header = parsed[0].map((h) => h.trim().toLowerCase());
      const nameIdx = header.indexOf('name');
      const parentIdx = header.indexOf('parent');
      const typeIdx = header.indexOf('type');
      const industryIdx = header.indexOf('industry');
      const descIdx = header.indexOf('description');

      if (nameIdx === -1) {
        res.status(400).json({ success: false, error: 'CSV must have a "Name" column' });
        return;
      }

      for (let i = 1; i < parsed.length; i++) {
        const cols = parsed[i].map((c) => c.trim());
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
