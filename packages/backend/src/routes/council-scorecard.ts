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
import { processNodes } from './process-catalog';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { systems } from './systems';
import { getSystemsRepository } from '../db/systems.repo';
import { mappings } from './mappings';
import { getMappingsRepository } from '../db/mappings.repo';
import { getProgramScopeForOrg } from './governance-program';
import { resolveProgramScope } from '../lib/governance-scope';

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
  targets: { coverage: number; classification: number; openIssues: number; exceptions: number; openIssuesDays: number };
  divisions: DivisionRow[];
  enterprise: DivisionRow;
  narrative: { whatMoved: string; forCouncil: string; whatMovedAuto: boolean; forCouncilAuto: boolean };
  // Which measure lens this scorecard was computed under, and the governance
  // scope basis. `applied` is true only when the governed lens actually
  // narrowed the numbers (a scope was defined). `version`/`changedAt` stamp
  // the program's scope version so a saved snapshot records its basis and two
  // snapshots can be compared apples-to-apples (see governance-program.ts).
  scope: { lens: ScorecardLens; applied: boolean; version: number | null; changedAt: string | null };
  // Governance-value drivers (ROI Phase 1): leading indicators, NOT dollars —
  // the un-fakeable signals that a governance program is paying off, computed
  // from data Procela already owns and respecting the current lens. A CFO's $
  // model multiplies these; on their own they're an honest value story.
  valueDrivers: ValueDrivers;
  // Monetized ROI estimate (ROI Phase 2): the value drivers above multiplied
  // by the tenant's OWN dollar assumptions (roiModelForOrg). Procela invents no
  // figures — `configured` is false until a tenant sets a model, and the UI
  // shows a "configure your value model" prompt rather than a fabricated $0.
  roi: RoiEstimate;
}

interface ValueDriverRatio { covered: number; total: number; pct: number }
export interface ValueDrivers {
  // Efficiency: share of in-scope domains + assets that have a named owner —
  // fewer "who owns this?" escalations, faster time-to-trust.
  ownership: ValueDriverRatio;
  // Risk reduced: a "value at risk" proxy governance should drive DOWN —
  // exceptions past expiry + Tier-1 domains without an owner + unclassified
  // assets. A falling number is the value.
  openRisk: number;
  // Velocity: issues resolved in the last 30 days, and mean days-to-resolve
  // over all resolved issues (remediation throughput + cycle time).
  resolvedLast30: number;
  avgResolutionDays: number | null;
}

// ROI Phase 2 — a tenant's OWN dollar assumptions. Procela ships no default
// figures (every multiplier defaults to 0), so a value estimate only appears
// once a tenant has told us what a unit is worth to them. Resolved by walking
// up the org tree exactly like scorecardTargets, so a company can set the
// model once for all its divisions. Stored on the org row (roiModel).
export interface RoiModel {
  currency: string;               // ISO-ish display code (e.g. USD, EUR, GBP)
  riskCostPerItem: number;        // $ exposure the tenant assigns to each open-risk item
  resolutionValuePerIssue: number;// $ cost the tenant avoids per governance issue resolved
  ownershipValuePerEntity: number;// $ annual value of a domain/asset having a named owner
}

// The computed monetization. Ownership value is a standing annual figure;
// resolution value is a run-rate (last-30-days count annualized ×12). Value at
// risk is EXPOSURE governance drives down, so it's reported separately and
// never folded into annualValue (which is realized/run-rate value only).
export interface RoiEstimate {
  configured: boolean;            // false ⇒ no multiplier set; UI shows a CTA
  currency: string;
  model: RoiModel;                // echoed assumptions so the readout is auditable
  valueAtRisk: number;            // openRisk × riskCostPerItem
  resolutionValueMonthly: number; // resolvedLast30 × resolutionValuePerIssue
  resolutionValueAnnualized: number; // resolutionValueMonthly × 12
  ownershipValue: number;         // ownership.covered × ownershipValuePerEntity
  annualValue: number;            // ownershipValue + resolutionValueAnnualized
  // ROI Phase 3 — the monetized value attributed to each value stream, so a
  // leader sees which streams' supporting data is banking value vs. carrying
  // risk. Empty until a value model is set. Attribution is by the process→data
  // mapping (a stream's steps link data assets); a stream's value at risk
  // counts only the risk items that carry an asset/domain link (org-level
  // exceptions and unmapped data aren't attributed), and an asset supporting
  // several streams counts in each — so these rows don't sum to the org total.
  byValueStream: ValueStreamRoi[];
}

// One value stream's attributed governance value (ROI Phase 3).
export interface ValueStreamRoi {
  valueStreamId: string;
  name: string;
  assets: number;                    // in-scope assets mapped to this stream
  ownershipValue: number;
  resolutionValueAnnualized: number;
  annualValue: number;               // ownershipValue + resolutionValueAnnualized
  valueAtRisk: number;
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
const processNodesRepo = getProcessNodesRepository(processNodes);
const systemsRepo = getSystemsRepository(systems);
const mappingsRepo = getMappingsRepository(mappings);

// The measure lens: "all" counts every entity in the org subtree (today's
// behaviour); "governed" narrows to the entities the parent org's governance
// program actually governs — its resolved scope (see lib/governance-scope).
// A program with no scope defined resolves to null ("govern everything"), so
// the governed lens is a safe no-op there and never silently hides work.
export type ScorecardLens = 'all' | 'governed';
function parseLens(v: unknown): ScorecardLens {
  return String(v ?? 'all').toLowerCase() === 'governed' ? 'governed' : 'all';
}

const TERMINAL_ISSUE_STATUSES = new Set(['RESOLVED', 'CLOSED', 'WONT_FIX']);
// All four measure thresholds in one shape. `openIssuesDays` is the age (in
// days) past which an open issue counts. Resolved per-tenant (see
// targetsForOrg) and shipped whole in the derived payload so the UI's target
// labels can't drift from the logic.
export interface ScorecardTargets {
  coverage: number;
  classification: number;
  openIssues: number;
  exceptions: number;
  openIssuesDays: number;
}

// The shipped defaults, used when a tenant hasn't set its own bar.
const DEFAULT_TARGETS: ScorecardTargets = { coverage: 80, classification: 70, openIssues: 0, exceptions: 0, openIssuesDays: 30 };

// Resolve the thresholds for a scorecard scoped to `orgId`: walk up to the
// first ancestor that has set `scorecardTargets` (so a company can set the bar
// for its divisions), merging over the defaults so a partial stored object
// still yields a complete set; fall back to the defaults when none is set.
function targetsForOrg(orgId: string | undefined): ScorecardTargets {
  if (!orgId) return { ...DEFAULT_TARGETS };
  const orgs = getCachedOrgList();
  let cur = orgs.find((o) => o.id === orgId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const t = (cur as { scorecardTargets?: Partial<ScorecardTargets> | null }).scorecardTargets;
    if (t && typeof t === 'object') return { ...DEFAULT_TARGETS, ...t };
    cur = cur.parentId ? orgs.find((o) => o.id === cur!.parentId) : undefined;
  }
  return { ...DEFAULT_TARGETS };
}

// The shipped ROI model — deliberately all zeros. Procela never invents a
// dollar value; a tenant must supply its own for a monetized estimate to show.
const DEFAULT_ROI_MODEL: RoiModel = { currency: 'USD', riskCostPerItem: 0, resolutionValuePerIssue: 0, ownershipValuePerEntity: 0 };

// Resolve the ROI model for a scorecard scoped to `orgId`: walk up to the first
// ancestor that has set `roiModel` (so a company can set the value model for
// its divisions), merging over the defaults so a partial stored object still
// yields a complete set; fall back to the zero model when none is set.
function roiModelForOrg(orgId: string | undefined): RoiModel {
  if (!orgId) return { ...DEFAULT_ROI_MODEL };
  const orgs = getCachedOrgList();
  let cur = orgs.find((o) => o.id === orgId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const m = (cur as { roiModel?: Partial<RoiModel> | null }).roiModel;
    if (m && typeof m === 'object') return { ...DEFAULT_ROI_MODEL, ...m };
    cur = cur.parentId ? orgs.find((o) => o.id === cur!.parentId) : undefined;
  }
  return { ...DEFAULT_ROI_MODEL };
}

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
  domains: Array<{ id: string; orgId: string; ownerId: string | null; criticality?: string; dataAssetIds?: string[] }>;
  assets: Array<{ id: string; orgId: string; ownerPersonId?: string | null; owner?: string | null; sensitivityTags?: unknown[] }>;
  issues: Array<{ orgId: string; status: string; createdAt?: string; closedAt?: string | null; domainId?: string | null; dataAssetId?: string | null }>;
  exceptions: typeof governanceExceptions;
  now: number;
}

function computeMeasures(scope: Set<string>, s: Sources, targets: ScorecardTargets): Omit<DivisionRow, 'orgId' | 'name' | 'status'> {
  const domains = s.domains.filter((d) => scope.has(d.orgId));
  const tier1 = domains.filter((d) => d.criticality === 'TIER_1');
  const tier1Governed = tier1.filter((d) => !!d.ownerId).length;
  const assets = s.assets.filter((a) => scope.has(a.orgId));
  const classified = assets.filter((a) => Array.isArray(a.sensitivityTags) && a.sensitivityTags.length > 0).length;
  const openIssues = s.issues.filter((i) =>
    scope.has(i.orgId) &&
    !TERMINAL_ISSUE_STATUSES.has(i.status) &&
    !!i.createdAt && (s.now - Date.parse(i.createdAt)) > targets.openIssuesDays * DAY_MS,
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
function deriveStatus(m: Omit<DivisionRow, 'orgId' | 'name' | 'status'>, targets: ScorecardTargets): string {
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
    m.coverage == null || m.coverage >= targets.coverage,
    m.classification == null || m.classification >= targets.classification,
    m.openIssues <= targets.openIssues,
    m.exceptions <= targets.exceptions,
  ].filter(Boolean).length;
  return good >= 4 ? 'On track' : good >= 2 ? 'Behind' : 'At risk';
}

function rowFor(orgId: string, name: string, scope: Set<string>, s: Sources, targets: ScorecardTargets): DivisionRow {
  const m = computeMeasures(scope, s, targets);
  return { orgId, name, ...m, status: deriveStatus(m, targets) };
}

// Governance-value drivers over the enterprise scope. Leading indicators only
// — no invented dollars. `s` is already lens-filtered upstream, so these
// respect All vs Governed automatically.
function computeValueDrivers(scope: Set<string>, s: Sources): ValueDrivers {
  const domains = s.domains.filter((d) => scope.has(d.orgId));
  const assets = s.assets.filter((a) => scope.has(a.orgId));

  const owned = domains.filter((d) => !!d.ownerId).length + assets.filter((a) => !!(a.ownerPersonId || a.owner)).length;
  const ownTotal = domains.length + assets.length;
  const ownership: ValueDriverRatio = { covered: owned, total: ownTotal, pct: ownTotal ? Math.round((100 * owned) / ownTotal) : 0 };

  const exceptions = s.exceptions.filter((e) => scope.has(e.orgId) && isPastExpiry(e, s.now)).length;
  const tier1Unowned = domains.filter((d) => d.criticality === 'TIER_1' && !d.ownerId).length;
  const unclassified = assets.filter((a) => !(Array.isArray(a.sensitivityTags) && a.sensitivityTags.length > 0)).length;
  const openRisk = exceptions + tier1Unowned + unclassified;

  const resolved = s.issues.filter((i) => scope.has(i.orgId) && TERMINAL_ISSUE_STATUSES.has(i.status) && !!i.closedAt);
  const resolvedLast30 = resolved.filter((i) => s.now - Date.parse(i.closedAt!) <= 30 * DAY_MS).length;
  const durations = resolved
    .filter((i) => !!i.createdAt)
    .map((i) => (Date.parse(i.closedAt!) - Date.parse(i.createdAt!)) / DAY_MS)
    .filter((n) => Number.isFinite(n) && n >= 0);
  const avgResolutionDays = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return { ownership, openRisk, resolvedLast30, avgResolutionDays };
}

// Monetize the value drivers with the tenant's own model (ROI Phase 2). No
// figures are invented: with the zero model every product is 0 and
// `configured` is false, which the UI reads as "prompt the tenant to set a
// model" rather than "the program is worth nothing". `covered` (owned
// entities), not `total`, drives ownership value — you only bank the value of
// what's actually governed.
function computeRoi(v: ValueDrivers, model: RoiModel): RoiEstimate {
  const configured = model.riskCostPerItem > 0 || model.resolutionValuePerIssue > 0 || model.ownershipValuePerEntity > 0;
  const valueAtRisk = v.openRisk * model.riskCostPerItem;
  const resolutionValueMonthly = v.resolvedLast30 * model.resolutionValuePerIssue;
  const resolutionValueAnnualized = resolutionValueMonthly * 12;
  const ownershipValue = v.ownership.covered * model.ownershipValuePerEntity;
  return {
    configured,
    currency: model.currency,
    model,
    valueAtRisk,
    resolutionValueMonthly,
    resolutionValueAnnualized,
    ownershipValue,
    annualValue: ownershipValue + resolutionValueAnnualized,
    byValueStream: [],
  };
}

// Attribute the monetized value to each value stream (ROI Phase 3). A value
// stream's supporting data is found through the process→data mappings: any
// data asset linked to a step under the stream is attributed to it. `s` is
// already lens-filtered, so only in-scope assets/domains/issues count; a stream
// with no in-scope mapped assets is omitted. Rows don't sum to the org total —
// an asset can support several streams (counted in each) and org-level
// exceptions / unmapped data aren't attributed.
function computeValueStreamRoi(
  nodes: Array<{ id: string; parentId: string | null; level: string; name: string; orgId: string }>,
  mappings: Array<{ processStepId: string; dataAssetId?: string | null }>,
  s: Sources,
  model: RoiModel,
  parentScope: Set<string>,
): ValueStreamRoi[] {
  // Process-node children index, for walking a value stream's whole subtree.
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const arr = childrenOf.get(n.parentId);
    if (arr) arr.push(n.id); else childrenOf.set(n.parentId, [n.id]);
  }
  // In-scope asset lookup (lens-filtered) and the data assets each step maps to.
  const assetById = new Map(s.assets.map((a) => [a.id, a] as const));
  const assetIdsForNode = new Map<string, string[]>();
  for (const m of mappings) {
    if (!m.dataAssetId) continue;
    const arr = assetIdsForNode.get(m.processStepId);
    if (arr) arr.push(m.dataAssetId); else assetIdsForNode.set(m.processStepId, [m.dataAssetId]);
  }

  const out: ValueStreamRoi[] = [];
  for (const vs of nodes) {
    if (vs.level !== 'VALUE_STREAM' || !parentScope.has(vs.orgId)) continue;
    // The stream's whole node subtree (itself + all descendants).
    const nodeIds = new Set<string>();
    const stack = [vs.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (nodeIds.has(id)) continue;
      nodeIds.add(id);
      for (const c of childrenOf.get(id) || []) stack.push(c);
    }
    // In-scope assets mapped to any node in the subtree.
    const attrAssetIds = new Set<string>();
    for (const nid of nodeIds) for (const aid of assetIdsForNode.get(nid) || []) if (assetById.has(aid)) attrAssetIds.add(aid);
    if (attrAssetIds.size === 0) continue; // no governed data flows through this stream

    const attrAssets = [...attrAssetIds].map((id) => assetById.get(id)!);
    const attrDomains = s.domains.filter((d) => (d.dataAssetIds || []).some((aid) => attrAssetIds.has(aid)));
    const attrDomainIds = new Set(attrDomains.map((d) => d.id));

    const ownedEntities =
      attrDomains.filter((d) => !!d.ownerId).length +
      attrAssets.filter((a) => !!(a.ownerPersonId || a.owner)).length;
    // Open-risk items with an entity link (exceptions are org-level — excluded).
    const tier1Unowned = attrDomains.filter((d) => d.criticality === 'TIER_1' && !d.ownerId).length;
    const unclassified = attrAssets.filter((a) => !(Array.isArray(a.sensitivityTags) && a.sensitivityTags.length > 0)).length;
    const openRiskItems = tier1Unowned + unclassified;
    const resolvedLast30 = s.issues.filter((i) =>
      TERMINAL_ISSUE_STATUSES.has(i.status) && !!i.closedAt && (s.now - Date.parse(i.closedAt) <= 30 * DAY_MS) &&
      ((!!i.dataAssetId && attrAssetIds.has(i.dataAssetId)) || (!!i.domainId && attrDomainIds.has(i.domainId))),
    ).length;

    const ownershipValue = ownedEntities * model.ownershipValuePerEntity;
    const resolutionValueAnnualized = resolvedLast30 * model.resolutionValuePerIssue * 12;
    out.push({
      valueStreamId: vs.id,
      name: vs.name,
      assets: attrAssetIds.size,
      ownershipValue,
      resolutionValueAnnualized,
      annualValue: ownershipValue + resolutionValueAnnualized,
      valueAtRisk: openRiskItems * model.riskCostPerItem,
    });
  }
  // Biggest value first, then biggest exposure, then name for stability.
  out.sort((a, b) => (b.annualValue - a.annualValue) || (b.valueAtRisk - a.valueAtRisk) || a.name.localeCompare(b.name));
  return out;
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

async function deriveScorecard(parentOrgId: string, lens: ScorecardLens = 'all'): Promise<DerivedScorecard> {
  const [domains, assets, issues, exceptions, nodes, orgSystems, allMappings] = await Promise.all([
    domainsRepo.list(), assetsRepo.list(), issuesRepo.list(), exceptionsRepo.list(),
    processNodesRepo.list(), systemsRepo.list(), mappingsRepo.list(),
  ]);
  const now = Date.now();

  // Resolve the parent org's governed scope. Empty/absent scope ⇒ null
  // ("govern everything"), so the governed lens narrows nothing there. The
  // program's scope version travels with the scorecard regardless of lens, so
  // a saved snapshot always records the basis it was measured against.
  const anchors = await getProgramScopeForOrg(parentOrgId);
  const resolvedScope = resolveProgramScope(anchors, {
    nodes: nodes as { id: string; parentId?: string | null; systemIds?: string[] }[],
    domains: domains as { id: string; parentDomainId?: string | null; dataAssetIds?: string[] }[],
    assets: assets as { id: string; systemId?: string | null }[],
    systems: orgSystems as { id: string }[],
  });
  const scopeApplied = lens === 'governed' && !!resolvedScope;

  // Under the governed lens, narrow the sources to in-scope entities before
  // any row is built, so every division and the enterprise rollup share one
  // basis. Domains/assets filter by resolved id; an issue is in scope when the
  // asset OR domain it is raised against is. Exceptions carry no entity link
  // (they're org-level), so they stay org-scoped either way.
  let srcDomains = domains as Sources['domains'];
  let srcAssets = assets as Sources['assets'];
  let srcIssues = issues as Sources['issues'];
  if (scopeApplied && resolvedScope) {
    const inD = resolvedScope.domainIds;
    const inA = resolvedScope.assetIds;
    srcDomains = srcDomains.filter((d) => inD.has(d.id));
    srcAssets = srcAssets.filter((a) => inA.has(a.id));
    srcIssues = srcIssues.filter((i) => (!!i.dataAssetId && inA.has(i.dataAssetId)) || (!!i.domainId && inD.has(i.domainId)));
  }

  const s: Sources = {
    domains: srcDomains,
    assets: srcAssets,
    issues: srcIssues,
    exceptions,
    now,
  };
  const orgs = getCachedOrgList();
  const parent = orgs.find((o) => o.id === parentOrgId);
  const orgName = parent?.name || 'Enterprise';

  // One threshold set for the whole scorecard — a per-tenant policy resolved
  // from the parent org (walking up to the first ancestor that sets it).
  const targets = targetsForOrg(parentOrgId);
  const divisions = childDivisions(parentOrgId).map((c) => rowFor(c.id, c.name, subtreeOrgIds(c.id), s, targets));
  const parentScope = subtreeOrgIds(parentOrgId);
  const enterprise = rowFor(parentOrgId, orgName, parentScope, s, targets);
  const narr = autoNarrative(parentScope, s, enterprise);

  const d = new Date(now);
  const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  // Compute the drivers once, then monetize with the tenant's resolved model.
  const valueDrivers = computeValueDrivers(parentScope, s);
  const roiModel = roiModelForOrg(parentOrgId);
  const roi = computeRoi(valueDrivers, roiModel);
  // Per-value-stream attribution only carries meaning once there's a model to
  // multiply by; skip the work (and the empty rows) when unconfigured.
  if (roi.configured) {
    roi.byValueStream = computeValueStreamRoi(
      nodes as Array<{ id: string; parentId: string | null; level: string; name: string; orgId: string }>,
      allMappings as Array<{ processStepId: string; dataAssetId?: string | null }>,
      s, roiModel, parentScope,
    );
  }

  return {
    orgId: parentOrgId,
    orgName,
    period,
    targets,
    divisions,
    enterprise,
    narrative: { whatMoved: narr.whatMoved, forCouncil: narr.forCouncil, whatMovedAuto: true, forCouncilAuto: true },
    scope: {
      lens,
      applied: scopeApplied,
      version: anchors?.version ?? null,
      changedAt: anchors?.changedAt ?? null,
    },
    valueDrivers,
    roi,
  };
}

// ── Routes ──

const router = Router();

/** GET /derive?orgId= — the live, auto-derived scorecard for a parent org. */
router.get('/derive', async (req: Request, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : (req as Request & { user?: { orgId?: string } }).user?.orgId;
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  const derived = await deriveScorecard(orgId, parseLens(req.query.lens));
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
  const { orgId, period, derived, overrides, narrative, status, replaceId, lens } = req.body || {};
  if (!orgId) { res.status(400).json({ success: false, error: 'orgId is required' }); return; }
  // Recompute derived server-side so a saved version's machine baseline is
  // authoritative; the client only supplies overrides + narrative edits. The
  // lens is threaded through so a snapshot taken under the governed lens is
  // stored as governed numbers, stamped with the scope version it used.
  const freshDerived: DerivedScorecard = derived && derived.divisions ? derived : await deriveScorecard(orgId, parseLens(lens));
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
