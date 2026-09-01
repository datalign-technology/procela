// Council Scorecard.
//
// A monthly governance report where each child division reports four measures
// that roll up to an enterprise (parent) total, plus two narrative sections.
// The measures + narrative are AUTO-DERIVED from live data; the CDO / Data
// Governance Lead can override any value and save immutable monthly versions
// for historical reference.
//
// Reads (derive/list/get) are open to any authenticated user. Writes
// (save/update/delete) require requireScorecardEditor (admin OR CDO/DGL).

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { loadStore, registerStore } from '../lib/persistence';
import { getCouncilScorecardsRepository } from '../db/council-scorecards.repo';
import { getCachedOrgList, OWNERSHIP_LEVELS } from '../lib/org-scope';
import { auditLogs, auditService } from '../services/audit.service';
import { canEditScorecard, requireScorecardEditor } from '../lib/scorecard-permissions';

import { dataDomains } from './data-domains';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { dataAssets } from './data-assets';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { governanceIssues } from './governance-issues';
import { getGovernanceIssuesRepository } from '../db/governance-issues.repo';
import { governanceExceptions, isPastExpiry } from './governance-exceptions';
import { getGovernanceExceptionsRepository } from '../db/governance-exceptions.repo';

// ── Types ──

export interface DivisionRow {
  orgId: string;
  name: string;
  domainsTotal: number;
  domainsGoverned: number;
  tier1Total: number;
  coverage: number | null;        // % of tier-1 domains that are governed
  classification: number | null;  // % of assets with a sensitivity classification
  openIssues: number;             // non-terminal governance issues open > 30 days
  exceptions: number;             // exceptions past expiry and still active
  status: string;                 // derived: On track | Behind | At risk | No data
}

export interface DerivedScorecard {
  orgId: string;
  orgName: string;
  period: string;                 // YYYY-MM
  targets: { coverage: number; classification: number };
  divisions: DivisionRow[];
  enterprise: DivisionRow;
  narrative: { whatMoved: string; forCouncil: string; whatMovedAuto: boolean; forCouncilAuto: boolean };
}

export interface StoredCouncilScorecard {
  id: string;
  orgId: string;
  period: string;
  status: string;                 // DRAFT | PUBLISHED
  createdBy?: string;
  derived: DerivedScorecard;
  overrides: Record<string, unknown>;
  narrative: { whatMoved?: string; forCouncil?: string; whatMovedAuto?: boolean; forCouncilAuto?: boolean };
  createdAt: string;
  updatedAt: string;
}

export const councilScorecards: StoredCouncilScorecard[] =
  loadStore<StoredCouncilScorecard>('councilScorecards');
registerStore('councilScorecards', councilScorecards);

const repo = getCouncilScorecardsRepository(councilScorecards);
const domainsRepo = getDataDomainsRepository(dataDomains);
const assetsRepo = getDataAssetsRepository(dataAssets);
const issuesRepo = getGovernanceIssuesRepository(governanceIssues);
const exceptionsRepo = getGovernanceExceptionsRepository(governanceExceptions);

const TERMINAL_ISSUE_STATUSES = new Set(['RESOLVED', 'CLOSED', 'WONT_FIX']);
const TARGETS = { coverage: 80, classification: 70 };
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Org tree helpers ──

/** Root org id + all descendant org ids (BFS on parentId). */
function subtreeOrgIds(rootId: string): Set<string> {
  const orgs = getCachedOrgList();
  const out = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const o of orgs) {
      if (o.parentId && out.has(o.parentId) && !out.has(o.id)) { out.add(o.id); added = true; }
    }
  }
  return out;
}

/** Direct child divisions (owning-level children) of a parent org. */
function childDivisions(parentId: string): { id: string; name: string }[] {
  return getCachedOrgList()
    .filter((o) => o.parentId === parentId && OWNERSHIP_LEVELS.includes(o.type))
    .map((o) => ({ id: o.id, name: o.name }));
}

// ── Measure computation ──

interface Sources {
  domains: Array<{ orgId: string; ownerId: string | null; criticality?: string }>;
  assets: Array<{ orgId: string; sensitivityTags?: unknown[] }>;
  issues: Array<{ orgId: string; status: string; createdAt?: string }>;
  exceptions: typeof governanceExceptions;
  now: number;
}

function computeMeasures(scope: Set<string>, s: Sources): Omit<DivisionRow, 'orgId' | 'name' | 'status'> {
  const domains = s.domains.filter((d) => scope.has(d.orgId));
  const tier1 = domains.filter((d) => d.criticality === 'TIER_1');
  const tier1Governed = tier1.filter((d) => !!d.ownerId).length;
  const assets = s.assets.filter((a) => scope.has(a.orgId));
  const classified = assets.filter((a) => Array.isArray(a.sensitivityTags) && a.sensitivityTags.length > 0).length;
  const openIssues = s.issues.filter((i) =>
    scope.has(i.orgId) &&
    !TERMINAL_ISSUE_STATUSES.has(i.status) &&
    !!i.createdAt && (s.now - Date.parse(i.createdAt)) > 30 * DAY_MS,
  ).length;
  const exceptions = s.exceptions.filter((e) => scope.has(e.orgId) && isPastExpiry(e, s.now)).length;
  return {
    domainsTotal: domains.length,
    domainsGoverned: domains.filter((d) => !!d.ownerId).length,
    tier1Total: tier1.length,
    coverage: tier1.length > 0 ? Math.round((100 * tier1Governed) / tier1.length) : null,
    classification: assets.length > 0 ? Math.round((100 * classified) / assets.length) : null,
    openIssues,
    exceptions,
  };
}

/** Derived status from the four measures vs. targets. Overridable by editors. */
function deriveStatus(m: Omit<DivisionRow, 'orgId' | 'name' | 'status'>): string {
  // Nothing to assess yet — no governed domains, no tier-1 coverage
  // denominator, nothing classified, and no open issues or exceptions.
  // A brand-new / empty division has no governance health to report, so
  // return a neutral status rather than shaming it as "Behind".
  const noData =
    m.domainsGoverned === 0 &&
    m.coverage == null &&
    (m.classification == null || m.classification === 0) &&
    m.openIssues === 0 &&
    m.exceptions === 0;
  if (noData) return 'No data';
  const good = [
    m.coverage == null || m.coverage >= TARGETS.coverage,
    m.classification == null || m.classification >= TARGETS.classification,
    m.openIssues === 0,
    m.exceptions === 0,
  ].filter(Boolean).length;
  return good >= 4 ? 'On track' : good >= 2 ? 'Behind' : 'At risk';
}

function rowFor(orgId: string, name: string, scope: Set<string>, s: Sources): DivisionRow {
  const m = computeMeasures(scope, s);
  return { orgId, name, ...m, status: deriveStatus(m) };
}

// ── Narrative auto-derivation (data trends / activity) ──

function pluralS(n: number): string { return n === 1 ? '' : 's'; }

function autoNarrative(parentScope: Set<string>, s: Sources, enterprise: DivisionRow): { whatMoved: string; forCouncil: string } {
  // "What moved" — recent governance ACTIVITY from the audit log (last 30 days).
  const since = s.now - 30 * DAY_MS;
  const recent = auditLogs.filter((e) =>
    parentScope.has(e.orgId) && !!e.timestamp && Date.parse(e.timestamp) >= since,
  );
  const count = (pred: (e: typeof auditLogs[number]) => boolean) => recent.filter(pred).length;
  const movedBits: string[] = [];
  const classifications = count((e) => (e.action || '').includes('SENSITIVITY'));
  if (classifications) movedBits.push(`${classifications} data classification${pluralS(classifications)} recorded`);
  const newDomains = count((e) => e.entityType === 'DataDomain' && e.action === 'CREATE');
  if (newDomains) movedBits.push(`${newDomains} data domain${pluralS(newDomains)} registered`);
  const rulesAdded = count((e) => e.entityType === 'DataQualityRule' && e.action === 'CREATE');
  if (rulesAdded) movedBits.push(`${rulesAdded} quality rule${pluralS(rulesAdded)} added`);
  const exceptionsGranted = count((e) => e.entityType === 'GovernanceException' && e.action === 'CREATE');
  if (exceptionsGranted) movedBits.push(`${exceptionsGranted} exception${pluralS(exceptionsGranted)} granted`);
  const whatMoved = movedBits.length
    ? movedBits.slice(0, 3).map((b) => `• ${b}.`).join('\n')
    : '• No governance activity recorded in the last 30 days.';

  // "For the council" — current-state RISK facts worth escalating.
  const councilBits: string[] = [];
  const tier1NoOwner = s.domains.filter((d) => parentScope.has(d.orgId) && d.criticality === 'TIER_1' && !d.ownerId).length;
  if (tier1NoOwner) councilBits.push(`${tier1NoOwner} tier-1 domain${pluralS(tier1NoOwner)} ${tier1NoOwner === 1 ? 'has' : 'have'} no named owner`);
  if (enterprise.exceptions) councilBits.push(`${enterprise.exceptions} exception${pluralS(enterprise.exceptions)} past expiry need renewal or closure`);
  const unclassified = s.assets.filter((a) => parentScope.has(a.orgId) && !(Array.isArray(a.sensitivityTags) && a.sensitivityTags.length > 0)).length;
  if (unclassified) councilBits.push(`${unclassified} data asset${pluralS(unclassified)} ${unclassified === 1 ? 'is' : 'are'} unclassified`);
  const forCouncil = councilBits.length
    ? councilBits.slice(0, 3).map((b) => `• ${b}.`).join('\n')
    : '• No escalations for the council this period.';

  return { whatMoved, forCouncil };
}

// ── Derive the whole scorecard for a parent org ──

async function deriveScorecard(parentOrgId: string): Promise<DerivedScorecard> {
  const [domains, assets, issues, exceptions] = await Promise.all([
    domainsRepo.list(), assetsRepo.list(), issuesRepo.list(), exceptionsRepo.list(),
  ]);
  const now = Date.now();
  const s: Sources = {
    domains: domains as Sources['domains'],
    assets: assets as Sources['assets'],
    issues: issues as Sources['issues'],
    exceptions,
    now,
  };
  const orgs = getCachedOrgList();
  const parent = orgs.find((o) => o.id === parentOrgId);
  const orgName = parent?.name || 'Enterprise';

  const divisions = childDivisions(parentOrgId).map((c) => rowFor(c.id, c.name, subtreeOrgIds(c.id), s));
  const parentScope = subtreeOrgIds(parentOrgId);
  const enterprise = rowFor(parentOrgId, orgName, parentScope, s);
  const narr = autoNarrative(parentScope, s, enterprise);

  const d = new Date(now);
  const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  return {
    orgId: parentOrgId,
    orgName,
    period,
    targets: TARGETS,
    divisions,
    enterprise,
    narrative: { whatMoved: narr.whatMoved, forCouncil: narr.forCouncil, whatMovedAuto: true, forCouncilAuto: true },
  };
}

// ── Routes ──

const router = Router();

/** GET /derive?orgId= — the live, auto-derived scorecard for a parent org. */
router.get('/derive', async (req: Request, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : (req as Request & { user?: { orgId?: string } }).user?.orgId;
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  const derived = await deriveScorecard(orgId);
  const canEdit = canEditScorecard((req as Request & { user?: { role?: string; email?: string } }).user);
  res.json({ success: true, data: { ...derived, canEdit } });
});

/** GET /?orgId= — saved versions for a parent org, newest first. */
router.get('/', async (req: Request, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  const all = await repo.list(orgId ? { orgId } : undefined);
  const list = (orgId ? all.filter((v) => v.orgId === orgId) : all)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((v) => ({ id: v.id, orgId: v.orgId, period: v.period, status: v.status, createdBy: v.createdBy, createdAt: v.createdAt, updatedAt: v.updatedAt }));
  res.json({ success: true, data: list });
});

/** GET /:id — one saved version in full. */
router.get('/:id', async (req: Request, res: Response) => {
  const v = await repo.get(String(req.params.id));
  if (!v) { res.status(404).json({ success: false, error: 'Scorecard version not found' }); return; }
  res.json({ success: true, data: v });
});

/** POST / — save a version (derived + overrides + narrative). Editors only.
 *  With `replaceId`, overwrite that existing version in place (keeping its id,
 *  createdAt and createdBy, refreshing the derived baseline + timestamp) so a
 *  same-period re-save can replace rather than stack another snapshot. */
router.post('/', requireScorecardEditor, async (req: Request, res: Response) => {
  const { orgId, period, derived, overrides, narrative, status, replaceId } = req.body || {};
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  // Recompute derived server-side so a saved version's machine baseline is
  // authoritative; the client only supplies overrides + narrative edits.
  const freshDerived: DerivedScorecard = derived && derived.divisions ? derived : await deriveScorecard(orgId);
  const now = new Date().toISOString();
  const userId = (req as Request & { user?: { id?: string } }).user?.id || undefined;

  if (replaceId) {
    const existing = await repo.get(String(replaceId));
    if (!existing || existing.orgId !== orgId) { res.status(404).json({ success: false, error: 'Scorecard version to replace not found' }); return; }
    const before = { period: existing.period, derived: existing.derived, overrides: existing.overrides, narrative: existing.narrative, status: existing.status };
    existing.period = period || freshDerived.period;
    existing.status = status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED';
    existing.derived = freshDerived;
    existing.overrides = overrides && typeof overrides === 'object' ? overrides : {};
    existing.narrative = narrative && typeof narrative === 'object' ? narrative : {};
    existing.updatedAt = now;
    await repo.update(existing.id, existing);
    auditService.log(orgId, userId || null, 'CouncilScorecard', existing.id, 'REPLACE', before, { period: existing.period, status: existing.status });
    res.json({ success: true, data: existing });
    return;
  }

  const entity: StoredCouncilScorecard = {
    id: uuid(),
    orgId,
    period: period || freshDerived.period,
    status: status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED',
    createdBy: userId,
    derived: freshDerived,
    overrides: overrides && typeof overrides === 'object' ? overrides : {},
    narrative: narrative && typeof narrative === 'object' ? narrative : {},
    createdAt: now,
    updatedAt: now,
  };
  await repo.create(entity);
  auditService.log(orgId, userId || null, 'CouncilScorecard', entity.id, 'PUBLISH', null, { period: entity.period, status: entity.status });
  res.status(201).json({ success: true, data: entity });
});

/** PUT /:id — edit a saved version's overrides / narrative. Editors only. */
router.put('/:id', requireScorecardEditor, async (req: Request, res: Response) => {
  const entity = await repo.get(String(req.params.id));
  if (!entity) { res.status(404).json({ success: false, error: 'Scorecard version not found' }); return; }
  const before = { overrides: entity.overrides, narrative: entity.narrative, status: entity.status };
  const { overrides, narrative, status } = req.body || {};
  if (overrides !== undefined && typeof overrides === 'object') entity.overrides = overrides;
  if (narrative !== undefined && typeof narrative === 'object') entity.narrative = narrative;
  if (status === 'DRAFT' || status === 'PUBLISHED') entity.status = status;
  entity.updatedAt = new Date().toISOString();
  await repo.update(entity.id, entity);
  auditService.log(entity.orgId, (req as Request & { user?: { id?: string } }).user?.id || null, 'CouncilScorecard', entity.id, 'UPDATE', before, { overrides: entity.overrides, narrative: entity.narrative, status: entity.status });
  res.json({ success: true, data: entity });
});

/** DELETE /:id — remove a saved version. Editors only. */
router.delete('/:id', requireScorecardEditor, async (req: Request, res: Response) => {
  const entity = await repo.get(String(req.params.id));
  if (!entity) { res.status(404).json({ success: false, error: 'Scorecard version not found' }); return; }
  await repo.delete(entity.id);
  auditService.log(entity.orgId, (req as Request & { user?: { id?: string } }).user?.id || null, 'CouncilScorecard', entity.id, 'DELETE', { period: entity.period }, null);
  res.status(204).send();
});

export default router;
