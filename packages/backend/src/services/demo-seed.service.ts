// One-click demo seed. Populates a Tidewater Utilities fixture in one
// call so a live demo doesn't start with 10 minutes of CSV imports.
//
// Deliberately compact: seeds the shape the demo tells a story about
// (org tree + people + systems + agents + domains + assets +
// mappings + process hierarchy + Susan Chen persona + planted
// orphans) — not every last row a full production catalogue would
// have. The training walkthrough still exists for anyone who wants
// to type the whole thing in manually.
//
// Idempotent: every row is stamped with a `demo-` prefixed id, and
// the reseed pass clears anything with that prefix from every
// registered store first. Safe to run repeatedly.

import { createHash } from 'crypto';
import { organizations } from '../routes/organizations';
import { people } from '../routes/people';
import { systems } from '../routes/systems';
import { agents } from '../routes/agents';
import { dataDomains } from '../routes/data-domains';
import { dataAssets } from '../routes/data-assets';
import { processNodes, flowRelationships } from '../routes/process-catalog';
import { mappings } from '../routes/mappings';
import { governanceTasks } from '../routes/governance-tasks';
import { governanceIssues } from '../routes/governance-issues';
import { dataQualityRules } from '../routes/data-quality';
import { connectors, connectorEvents } from '../routes/connectors';
import { calendarEvents } from '../routes/governance-calendar';
import { statsSnapshots, type StatsSnapshot } from '../routes/dashboard';
import { aiTemplateCache } from '../routes/ai';
import { governancePolicies } from '../routes/governance-policies';
import { governanceControls } from '../routes/governance-controls';
import { governanceGroups } from '../routes/governance-groups';
import { governancePrograms } from '../routes/governance-program';
import { decisionRights } from '../routes/decision-rights';
import { skills } from '../routes/skills';
import { damaRoles } from '../routes/dama-roles';
import { raciOverrides } from '../routes/dashboard';
import { sops } from '../routes/sops';
import { glossaryTerms } from '../routes/business-glossary';
import { operationsManuals } from '../routes/operations-manuals';
import { dataLineageLinks, assetLineageEdges, columnLineageEdges } from '../routes/data-lineage';
import { maturitySnapshots } from '../routes/maturity-trends';
import { gapSnapshots } from '../services/digest.service';
import { agentSchedules } from '../routes/agent-schedules';
import { agentExecutions } from '../routes/agent-executions';
import { comments } from '../routes/comments';
import { tags } from '../routes/tags';
import { attachments } from '../routes/attachments';
import { reports } from '../routes/reports';
import { analysisReports } from '../routes/analysis-reports';
import { savedViews } from '../routes/saved-views';
import { dataAssetColumns, dataAssetBindings } from '../routes/data-assets';
import { connections } from '../routes/connections';
import { saveStore } from '../lib/persistence';
import { invalidateOrgScopeCache } from '../lib/org-scope';
import logger from '../lib/logger';

import type { Repository } from '../db/repository';
import { getOrganizationsRepository } from '../db/organizations.repo';
import { getPeopleRepository } from '../db/people.repo';
import { getSystemsRepository } from '../db/systems.repo';
import { getAgentsRepository } from '../db/agents.repo';
import { getDataDomainsRepository } from '../db/data-domains.repo';
import { getDataAssetsRepository } from '../db/data-assets.repo';
import { getProcessNodesRepository } from '../db/process-nodes.repo';
import { getFlowRelationshipsRepository } from '../db/flow-relationships.repo';
import { getMappingsRepository } from '../db/mappings.repo';
import { getGovernanceTasksRepository } from '../db/governance-tasks.repo';
import { getGovernanceIssuesRepository } from '../db/governance-issues.repo';
import { getDataQualityRulesRepository } from '../db/data-quality-rules.repo';
import { getConnectorsRepository } from '../db/connectors.repo';
import { getConnectorEventsRepository } from '../db/connector-events.repo';
import { getCalendarEventsRepository } from '../db/calendar-events.repo';
import { getStatsSnapshotsRepository } from '../db/stats-snapshots.repo';
import { getGovernancePoliciesRepository } from '../db/governance-policies.repo';
import { getGovernanceControlsRepository } from '../db/governance-controls.repo';
import { getGovernanceGroupsRepository } from '../db/governance-groups.repo';
import { getGovernanceProgramsRepository } from '../db/governance-programs.repo';
import { getDecisionRightsRepository } from '../db/decision-rights.repo';
import { getSkillsRepository } from '../db/skills.repo';
import { getDamaRolesRepository } from '../db/dama-roles.repo';
import { getRaciOverridesRepository } from '../db/raci-overrides.repo';
import { getSopsRepository } from '../db/sops.repo';
import { getGlossaryTermsRepository } from '../db/glossary-terms.repo';
import { getOperationsManualsRepository } from '../db/operations-manuals.repo';
import { getDataLineageLinksRepository } from '../db/data-lineage-links.repo';
import { getAssetLineageEdgesRepository } from '../db/asset-lineage-edges.repo';
import { getColumnLineageEdgesRepository } from '../db/column-lineage-edges.repo';
import { getMaturitySnapshotsRepository } from '../db/maturity-snapshots.repo';
import { getGapSnapshotsRepository } from '../db/gap-snapshots.repo';
import { getAgentSchedulesRepository } from '../db/agent-schedules.repo';
import { getAgentExecutionsRepository } from '../db/agent-executions.repo';
import { getCommentsRepository } from '../db/comments.repo';
import { getTagsRepository } from '../db/tags.repo';
import { getAttachmentsRepository } from '../db/attachments.repo';
import { getReportsRepository } from '../db/reports.repo';
import { getAnalysisReportsRepository } from '../db/analysis-reports.repo';
import { getSavedViewsRepository } from '../db/saved-views.repo';
import { getDataAssetColumnsRepository } from '../db/data-asset-columns.repo';
import { getDataAssetBindingsRepository } from '../db/data-asset-bindings.repo';
import { getConnectionsRepository } from '../db/connections.repo';

// Demo rows use deterministic UUIDs. Postgres id columns are `@db.Uuid`, so a
// non-UUID id like "demo-org-x" is rejected on insert; in JSON mode any string
// works, which is why this only bites under Postgres. demoId(key) hashes a
// stable key into a valid UUID whose first group is a fixed sentinel
// ("deadbeef"), so: reseeds are idempotent (same key → same id), cross-refs
// stay consistent (both the create and the reference call demoId with the same
// key), and the sweep can still recognize demo rows by that id prefix.
export const DEMO_ID_SENTINEL = 'deadbeef';
export function demoId(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  // 8-4-4-4-12 hex → a syntactically valid UUID Postgres @db.Uuid accepts.
  return `${DEMO_ID_SENTINEL}-${h.slice(0, 4)}-4${h.slice(4, 7)}-8${h.slice(7, 10)}-${h.slice(10, 22)}`;
}

function now() { return new Date().toISOString(); }
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

// Industries with a hand-crafted demo fixture. Every profile is built to the
// same feature coverage so a demo of any of them lights up every page.
export type DemoIndustry = 'utilities' | 'shipbuilding' | 'healthcare' | 'manufacturing' | 'financial' | 'government' | 'logistics' | 'insurance';

// aiTemplateCache is keyed by industry string, not `id`, so the sweep
// can't find demo entries by prefix. These are every cache key any
// demo profile pre-warms; the sweep clears all of them on reseed so
// switching industries never leaves a stale pre-warmed template
// behind. Kept in one place so a profile's push and the sweep agree.
const DEMO_AI_CACHE_KEYS = new Set<string>([
  'utilities|tidewater electric',
  'utilities|tidewater water',
  'defense & shipbuilding|ship construction',
  'defense & shipbuilding|fleet sustainment',
  'healthcare|patient care delivery',
  'healthcare|revenue cycle',
  'manufacturing|make-to-order production',
  'manufacturing|supply chain & fulfillment',
  'financial|consumer lending',
  'financial|financial crime & regulatory reporting',
  'government|permitting & licensing',
  'government|public health case management',
  'logistics|line-haul freight',
  'logistics|warehousing & fulfillment',
  'insurance|policy underwriting',
  'insurance|claims management',
]);

// ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
//
// Seeds a realistic improving trend (coverage + health climb, gaps
// fall) ending near each org's current stats, so the Dashboard
// sparklines show REAL history (>= 2 snapshots ⇒ non-synthesized).
// The most-recent row is dated today; the rest step back one week
// each. Ids are `demo-` prefixed so the reseed sweep clears them.
// Shared by every industry profile.
const STATS_WEEKS = 10;
function weeklySnapshots(
  orgId: string,
  end: Pick<StatsSnapshot, 'coverage' | 'avgHealth' | 'gaps' | 'dataAssets' | 'mappings'>,
): StatsSnapshot[] {
  const rows: StatsSnapshot[] = [];
  for (let i = 0; i < STATS_WEEKS; i++) {
    const progress = i / (STATS_WEEKS - 1); // 0 (oldest) → 1 (newest, = end)
    const capturedAt = daysFromNow(-(STATS_WEEKS - 1 - i) * 7).slice(0, 10);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    rows.push({
      id: demoId(`stats-${orgId}-${i}`),
      orgId,
      capturedAt,
      coverage: i === STATS_WEEKS - 1 ? end.coverage : clamp(Math.round(end.coverage - (1 - progress) * 22), 0, 100),
      avgHealth: i === STATS_WEEKS - 1 ? end.avgHealth : clamp(Math.round(end.avgHealth - (1 - progress) * 15), 0, 100),
      gaps: i === STATS_WEEKS - 1 ? end.gaps : Math.max(0, Math.round(end.gaps + (1 - progress) * 6)),
      dataAssets: i === STATS_WEEKS - 1 ? end.dataAssets : Math.max(0, Math.round(end.dataAssets - (1 - progress) * 3)),
      mappings: i === STATS_WEEKS - 1 ? end.mappings : Math.max(0, Math.round(end.mappings - (1 - progress) * 3)),
    });
  }
  return rows;
}

// ── Repository handles ──────────────────────────────────────────────
// Every store the seeder writes goes through its repository so the
// fixture persists to Postgres (when DATABASE_URL is set) AND the JSON
// store (otherwise). In JSON mode each repo wraps the same in-memory
// array the routes import, so the array-based assertions in
// demo-seed.test.ts still see the rows. aiTemplateCache is the one
// exception — an in-memory-only store keyed by industry string with no
// Prisma model, so it keeps its push + saveStore path.
interface DemoRepos {
  organizations: Repository<any>;
  people: Repository<any>;
  systems: Repository<any>;
  agents: Repository<any>;
  dataDomains: Repository<any>;
  dataAssets: Repository<any>;
  processNodes: Repository<any>;
  flowRelationships: Repository<any>;
  mappings: Repository<any>;
  governanceTasks: Repository<any>;
  governanceIssues: Repository<any>;
  dataQualityRules: Repository<any>;
  connectors: Repository<any>;
  connectorEvents: Repository<any>;
  calendarEvents: Repository<any>;
  statsSnapshots: Repository<any>;
  governancePolicies: Repository<any>;
  governanceControls: Repository<any>;
  governanceGroups: Repository<any>;
  governancePrograms: Repository<any>;
  decisionRights: Repository<any>;
  skills: Repository<any>;
  damaRoles: Repository<any>;
  sops: Repository<any>;
  glossaryTerms: Repository<any>;
  operationsManuals: Repository<any>;
  dataLineageLinks: Repository<any>;
  assetLineageEdges: Repository<any>;
  columnLineageEdges: Repository<any>;
  maturitySnapshots: Repository<any>;
  gapSnapshots: Repository<any>;
  agentSchedules: Repository<any>;
  agentExecutions: Repository<any>;
  comments: Repository<any>;
  tags: Repository<any>;
  attachments: Repository<any>;
  reports: Repository<any>;
  analysisReports: Repository<any>;
  savedViews: Repository<any>;
  dataAssetColumns: Repository<any>;
  dataAssetBindings: Repository<any>;
  connections: Repository<any>;
}

function buildRepos(): DemoRepos {
  return {
    organizations: getOrganizationsRepository(organizations as any),
    people: getPeopleRepository(people as any),
    systems: getSystemsRepository(systems as any),
    agents: getAgentsRepository(agents as any),
    dataDomains: getDataDomainsRepository(dataDomains as any),
    dataAssets: getDataAssetsRepository(dataAssets as any),
    processNodes: getProcessNodesRepository(processNodes as any),
    flowRelationships: getFlowRelationshipsRepository(flowRelationships as any),
    mappings: getMappingsRepository(mappings as any),
    governanceTasks: getGovernanceTasksRepository(governanceTasks as any),
    governanceIssues: getGovernanceIssuesRepository(governanceIssues as any),
    dataQualityRules: getDataQualityRulesRepository(dataQualityRules as any),
    connectors: getConnectorsRepository(connectors as any),
    connectorEvents: getConnectorEventsRepository(connectorEvents as any),
    calendarEvents: getCalendarEventsRepository(calendarEvents as any),
    statsSnapshots: getStatsSnapshotsRepository(statsSnapshots as any),
    governancePolicies: getGovernancePoliciesRepository(governancePolicies as any),
    governanceControls: getGovernanceControlsRepository(governanceControls as any),
    governanceGroups: getGovernanceGroupsRepository(governanceGroups as any),
    governancePrograms: getGovernanceProgramsRepository(governancePrograms as any),
    decisionRights: getDecisionRightsRepository(decisionRights as any),
    skills: getSkillsRepository(skills as any),
    damaRoles: getDamaRolesRepository(damaRoles as any),
    sops: getSopsRepository(sops as any),
    glossaryTerms: getGlossaryTermsRepository(glossaryTerms as any),
    operationsManuals: getOperationsManualsRepository(operationsManuals as any),
    dataLineageLinks: getDataLineageLinksRepository(dataLineageLinks as any),
    assetLineageEdges: getAssetLineageEdgesRepository(assetLineageEdges as any),
    columnLineageEdges: getColumnLineageEdgesRepository(columnLineageEdges as any),
    maturitySnapshots: getMaturitySnapshotsRepository(maturitySnapshots as any),
    gapSnapshots: getGapSnapshotsRepository(gapSnapshots as any),
    agentSchedules: getAgentSchedulesRepository(agentSchedules as any),
    agentExecutions: getAgentExecutionsRepository(agentExecutions as any),
    comments: getCommentsRepository(comments as any),
    tags: getTagsRepository(tags as any),
    attachments: getAttachmentsRepository(attachments as any),
    reports: getReportsRepository(reports as any),
    analysisReports: getAnalysisReportsRepository(analysisReports as any),
    savedViews: getSavedViewsRepository(savedViews as any),
    dataAssetColumns: getDataAssetColumnsRepository(dataAssetColumns as any),
    dataAssetBindings: getDataAssetBindingsRepository(dataAssetBindings as any),
    connections: getConnectionsRepository(connections as any),
  };
}

/** RACI overrides use a non-standard repo (list/upsert/remove, composite
 *  key, no id) so they live outside DemoRepos. Built on demand. */
function raciRepo() {
  return getRaciOverridesRepository(raciOverrides as any);
}

/** Create every row in `rows` through `repo`, in order. */
async function createAll(repo: Repository<any>, rows: any[]): Promise<void> {
  for (const row of rows) await repo.create(row);
}

/** Delete all `demo-`-prefixed rows the repo currently holds. Orgs are
 *  handled leaf-first by the caller because the org-hierarchy parent FK
 *  is ON DELETE RESTRICT — deleting a parent before its children fails
 *  in Postgres. Every other entity is safe in any order (child FKs are
 *  Cascade / SetNull). */
async function sweepRepo(repo: Repository<any>): Promise<void> {
  const all = await repo.list();
  for (const row of all) {
    if (typeof row?.id === 'string' && row.id.startsWith(DEMO_ID_SENTINEL)) await repo.delete(row.id);
  }
}

/** Delete demo rows of a self-parenting entity (organizations,
 *  governance groups) leaf-first, so a parent FK never blocks a delete:
 *  repeatedly remove every demo row that is not the parent of another
 *  remaining demo row. */
async function sweepHierarchy(repo: Repository<any>): Promise<void> {
  let remaining = (await repo.list()).filter(
    (o: any) => typeof o?.id === 'string' && o.id.startsWith(DEMO_ID_SENTINEL),
  );
  while (remaining.length) {
    const parentIds = new Set(remaining.map((o: any) => o.parentId).filter(Boolean));
    const leaves = remaining.filter((o: any) => !parentIds.has(o.id));
    // If a cycle ever slipped in, fall back to deleting everything so
    // we don't spin forever — the demo tree is acyclic by construction.
    const toDelete = leaves.length ? leaves : remaining;
    for (const o of toDelete) await repo.delete(o.id);
    const deleted = new Set(toDelete.map((o: any) => o.id));
    remaining = remaining.filter((o: any) => !deleted.has(o.id));
  }
}

/** RACI overrides have no id — they key on (nodeId, personId). Demo
 *  rows are identified by their `demo-`-prefixed nodeId. */
async function sweepRaci(): Promise<void> {
  const repo = raciRepo();
  const all = await repo.list();
  for (const row of all) {
    if (typeof row?.nodeId === 'string' && row.nodeId.startsWith(DEMO_ID_SENTINEL)) {
      await repo.remove(row.nodeId, row.personId);
    }
  }
}

async function sweep(repos: DemoRepos): Promise<void> {
  // Reverse dependency order — children before parents — so Postgres
  // FK checks pass even where a relation is RESTRICT rather than
  // Cascade. Organizations are swept last, leaf-first (sweepHierarchy).
  // Governance-depth entities first: decision rights + program are
  // independent; groups self-parent (leaf-first); controls reference
  // policies (controls before policies).
  await sweepRepo(repos.savedViews);
  await sweepRepo(repos.analysisReports);
  await sweepRepo(repos.reports);
  await sweepRepo(repos.attachments);
  await sweepRepo(repos.tags);
  await sweepRepo(repos.comments);
  await sweepRepo(repos.dataAssetBindings);
  await sweepRepo(repos.dataAssetColumns);
  await sweepRepo(repos.connections);
  await sweepRepo(repos.agentExecutions);
  await sweepRepo(repos.agentSchedules);
  await sweepRepo(repos.gapSnapshots);
  await sweepRepo(repos.maturitySnapshots);
  await sweepRepo(repos.columnLineageEdges);
  await sweepRepo(repos.assetLineageEdges);
  await sweepRepo(repos.dataLineageLinks);
  await sweepRepo(repos.operationsManuals);
  await sweepRepo(repos.glossaryTerms);
  await sweepRepo(repos.sops);
  await sweepRaci();
  await sweepRepo(repos.damaRoles);
  await sweepRepo(repos.skills);
  await sweepRepo(repos.decisionRights);
  await sweepRepo(repos.governancePrograms);
  await sweepHierarchy(repos.governanceGroups);
  await sweepRepo(repos.governanceControls);
  await sweepRepo(repos.governancePolicies);
  await sweepRepo(repos.statsSnapshots);
  await sweepRepo(repos.calendarEvents);
  await sweepRepo(repos.connectorEvents);
  await sweepRepo(repos.connectors);
  await sweepRepo(repos.dataQualityRules);
  await sweepRepo(repos.governanceIssues);
  await sweepRepo(repos.governanceTasks);
  await sweepRepo(repos.mappings);
  await sweepRepo(repos.flowRelationships);
  // Process nodes self-parent with ON DELETE Cascade, so deleting a
  // value stream would cascade its children; sweep leaf-first (like orgs)
  // so each row is deleted while it still exists — no cascade re-delete.
  await sweepHierarchy(repos.processNodes);
  await sweepRepo(repos.dataAssets);
  await sweepRepo(repos.dataDomains);
  await sweepRepo(repos.agents);
  await sweepRepo(repos.systems);
  await sweepRepo(repos.people);
  await sweepHierarchy(repos.organizations);
  // AI template cache is keyed by industry string, not `id`. Sweep
  // every demo-owned key (both industries) so switching industries
  // never leaves a stale pre-warmed template behind.
  for (let i = aiTemplateCache.length - 1; i >= 0; i--) {
    if (DEMO_AI_CACHE_KEYS.has(aiTemplateCache[i]?.industry)) aiTemplateCache.splice(i, 1);
  }
  saveStore('aiTemplateCache', aiTemplateCache);
}

// ── Governance depth (shared by both industry profiles) ─────────────
// Policies → controls → groups → program → decision rights. The
// content is industry-neutral (a DAMA-shaped program looks the same in
// a utility and a shipyard), so both profiles seed identical governance
// depth for guaranteed parity — only the org, personas, and program
// name differ. Ids are fixed `demo-` strings; only one tenant is seeded
// at a time, so they never collide across industries.
interface GovDepthCtx {
  orgId: string;
  cdoId: string;
  govLeadId: string;
  dataOwnerId: string;
  stewardIds: [string, string];
  tenantName: string;
}

async function seedGovernanceDepth(repos: DemoRepos, ts: string, ctx: GovDepthCtx): Promise<void> {
  const { orgId, cdoId, govLeadId, dataOwnerId, stewardIds, tenantName } = ctx;

  // Policies (3) — a charter, a classification policy, a quality standard.
  const polCharter = { id: demoId('pol-charter'), orgId, code: 'CHA-001', name: 'Data Governance Charter', description: 'Mandate, scope, and operating model for the data governance program.', documentType: 'CHARTER', status: 'ACTIVE', ownerAssignmentId: cdoId, category: 'GOVERNANCE', reviewFrequency: 'ANNUAL', nextReviewDate: daysFromNow(120).slice(0, 10), effectiveDate: daysFromNow(-200).slice(0, 10), content: 'The data governance program exists to make data a trusted, owned, discoverable asset across the enterprise.', createdAt: ts, updatedAt: ts };
  const polClassification = { id: demoId('pol-classification'), orgId, code: 'POL-001', name: 'Data Classification Policy', description: 'How data is classified by sensitivity and the handling rules per tier.', documentType: 'POLICY', status: 'ACTIVE', ownerAssignmentId: govLeadId, category: 'CLASSIFICATION', reviewFrequency: 'SEMI_ANNUAL', nextReviewDate: daysFromNow(60).slice(0, 10), effectiveDate: daysFromNow(-150).slice(0, 10), content: 'Every asset is tagged Public, Internal, Confidential, or Restricted, with handling rules per tier.', createdAt: ts, updatedAt: ts };
  const polQuality = { id: demoId('pol-quality'), orgId, code: 'STD-001', name: 'Data Quality Standard', description: 'Minimum quality thresholds and the dimensions measured per asset tier.', documentType: 'STANDARD', status: 'UNDER_REVIEW', ownerAssignmentId: stewardIds[0], category: 'DATA_QUALITY', reviewFrequency: 'QUARTERLY', nextReviewDate: daysFromNow(30).slice(0, 10), effectiveDate: daysFromNow(-90).slice(0, 10), content: 'Gold assets must measure completeness, accuracy, and timeliness at or above the tier threshold.', createdAt: ts, updatedAt: ts };
  await createAll(repos.governancePolicies, [polCharter, polClassification, polQuality]);

  // Controls (3) — each tied to a policy.
  await createAll(repos.governanceControls, [
    { id: demoId('ctl-completeness'), orgId, policyId: polQuality.id, code: 'CTL-001', name: 'Completeness threshold enforcement', description: 'DQ rules flag an asset when completeness falls below the standard.', controlType: 'DETECTIVE', automationMode: 'HUMAN', status: 'ACTIVE', ownerAssignmentId: stewardIds[0], evidenceRequired: true, createdAt: ts, updatedAt: ts },
    { id: demoId('ctl-sensitivity'), orgId, policyId: polClassification.id, code: 'CTL-002', name: 'Sensitivity tag review', description: 'A steward reviews AI-suggested sensitivity tags before they take effect.', controlType: 'PREVENTIVE', automationMode: 'HYBRID', status: 'ACTIVE', ownerAssignmentId: govLeadId, evidenceRequired: true, createdAt: ts, updatedAt: ts },
    { id: demoId('ctl-access'), orgId, policyId: polCharter.id, code: 'CTL-003', name: 'Quarterly access recertification', description: 'Owners recertify who has access to their assets each quarter.', controlType: 'DETECTIVE', automationMode: 'HUMAN', status: 'DRAFT', ownerAssignmentId: cdoId, evidenceRequired: false, createdAt: ts, updatedAt: ts },
  ]);

  // Groups (2) — a council with a stewardship team beneath it.
  const grpCouncil = { id: demoId('grp-council'), orgId, parentId: null, name: 'Data Governance Council', description: 'Cross-domain decision body for the data program.', charter: 'Approve policies, resolve escalations, own the governance roadmap.', type: 'COUNCIL', status: 'ACTIVE', members: [{ personId: cdoId, agentId: null, groupRole: 'CHAIR', since: ts }, { personId: govLeadId, agentId: null, groupRole: 'SECRETARY', since: ts }, { personId: dataOwnerId, agentId: null, groupRole: 'MEMBER', since: ts }], createdAt: ts, updatedAt: ts };
  const grpSteward = { id: demoId('grp-steward'), orgId, parentId: grpCouncil.id, name: 'Data Stewardship Team', description: 'Operational stewards executing governance day-to-day.', charter: 'Maintain metadata, run data quality, triage issues.', type: 'STEWARDSHIP_TEAM', status: 'ACTIVE', members: [{ personId: stewardIds[0], agentId: null, groupRole: 'CHAIR', since: ts }, { personId: stewardIds[1], agentId: null, groupRole: 'MEMBER', since: ts }], createdAt: ts, updatedAt: ts };
  await createAll(repos.governanceGroups, [grpCouncil, grpSteward]);

  // Program (1 per org).
  await repos.governancePrograms.create({
    id: demoId('gov-program'), orgId, name: `${tenantName} Data Governance Program`,
    scope: { inScope: 'Enterprise processes, data domains, and systems in the catalog.', outOfScope: 'Personal productivity data and unmanaged spreadsheets.', boundaries: 'All business units in the org hierarchy.', constraints: 'Regulatory reporting deadlines take priority over roadmap work.' },
    principles: { vision: 'Trusted data, owned by the business, discoverable by everyone.', principles: ['Data is an asset', 'Every asset has an owner', 'Govern by tier, not by fiat', 'Automate the routine controls'], decisionRights: 'Council approves policy; domain owners approve domain scope.', operatingModel: 'FEDERATED' },
    status: 'ACTIVE', launchedAt: daysFromNow(-55), createdAt: ts, updatedAt: ts,
  });

  // Decision rights (2) — one person-decided, one group-decided.
  await createAll(repos.decisionRights, [
    { id: demoId('dr-classification'), orgId, decision: 'Approve data classification changes', description: 'Who signs off when an asset\'s sensitivity tier changes.', category: 'CLASSIFICATION', decider: cdoId, deciderType: 'PERSON', recommends: ['DATA_GOVERNANCE_LEAD'], approves: ['CDO'], informed: ['DATA_OWNER'], escalationPath: 'Council → CDO', createdAt: ts, updatedAt: ts },
    { id: demoId('dr-dispute'), orgId, decision: 'Resolve cross-domain data disputes', description: 'Escalation path when two domains disagree on ownership.', category: 'ISSUE', decider: grpCouncil.id, deciderType: 'GROUP', recommends: ['DATA_OWNER'], approves: ['DATA_GOVERNANCE_LEAD'], informed: ['CDO'], escalationPath: 'Domain owners → Council', createdAt: ts, updatedAt: ts },
  ]);
}

// ── People depth (shared by both industry profiles) ─────────────────
// A skills catalog (one per DAMA-ish competency), skill assignments on
// the key personas, the DAMA role map, and one RACI override. Like
// governance depth, the content is industry-neutral so both profiles
// get identical people depth — only the org, domains, and personas
// differ. Skills catalog ids are fixed `demo-skill-*` strings.
interface PeopleDepthCtx {
  orgId: string;
  domainIds: [string, string, string];
  cdoId: string;
  govLeadId: string;
  dataOwnerId: string;
  stewardId: string;
  techStewardId: string;
  engineerId: string;
  architectId: string;
  raciNodeId: string;
  raciPersonId: string;
}

async function seedPeopleDepth(repos: DemoRepos, ts: string, ctx: PeopleDepthCtx): Promise<void> {
  const { orgId } = ctx;
  const sid = (k: string) => demoId('skill-' + k);

  // Skills catalog — one per competency category.
  const skillDefs: Array<[string, string, string, string]> = [
    ['dq', 'DATA_QUALITY', 'Data Quality Management', 'Profiling, rules, remediation, and DQ measurement.'],
    ['meta', 'METADATA', 'Metadata Management', 'Cataloguing, lineage, and business-glossary curation.'],
    ['arch', 'ARCHITECTURE', 'Data Architecture', 'Modelling, integration patterns, and platform design.'],
    ['sec', 'SECURITY', 'Data Security & Privacy', 'Classification, access control, and privacy compliance.'],
    ['integ', 'INTEGRATION', 'Data Integration', 'Pipelines, ELT, and source-system connectivity.'],
    ['analytics', 'ANALYTICS', 'Analytics & BI', 'Reporting, dashboards, and self-service analytics.'],
    ['gov', 'GOVERNANCE', 'Data Governance', 'Policy, stewardship, and operating-model design.'],
    ['comm', 'COMMUNICATION', 'Stakeholder Communication', 'Facilitation, training, and change management.'],
  ];
  await createAll(repos.skills, skillDefs.map(([k, category, name, description]) => ({
    id: sid(k), orgId, name, description, category, createdAt: ts, updatedAt: ts,
  })));

  // Skill assignments — denormalized onto Person.skillIds.
  const assignments: Array<[string, string[]]> = [
    [ctx.cdoId, ['gov', 'comm']],
    [ctx.govLeadId, ['gov', 'meta']],
    [ctx.dataOwnerId, ['analytics', 'gov']],
    [ctx.stewardId, ['dq', 'meta']],
    [ctx.techStewardId, ['integ', 'dq']],
    [ctx.engineerId, ['integ', 'arch']],
    [ctx.architectId, ['arch', 'sec']],
  ];
  for (const [personId, keys] of assignments) {
    await repos.people.update(personId, { skillIds: keys.map(sid) });
  }

  // DAMA role map.
  await createAll(repos.damaRoles, [
    { id: demoId('dama-cdo'), personId: ctx.cdoId, agentId: null, agentName: null, roleType: 'CDO', scopeType: 'ORG', scopeId: orgId, since: ts, createdAt: ts },
    { id: demoId('dama-govlead'), personId: ctx.govLeadId, agentId: null, agentName: null, roleType: 'DATA_GOVERNANCE_LEAD', scopeType: 'ORG', scopeId: orgId, since: ts, createdAt: ts },
    { id: demoId('dama-owner'), personId: ctx.dataOwnerId, agentId: null, agentName: null, roleType: 'DATA_OWNER', scopeType: 'DOMAIN', scopeId: ctx.domainIds[0], since: ts, createdAt: ts },
    { id: demoId('dama-bsteward'), personId: ctx.stewardId, agentId: null, agentName: null, roleType: 'BUSINESS_DATA_STEWARD', scopeType: 'DOMAIN', scopeId: ctx.domainIds[0], since: ts, createdAt: ts },
    { id: demoId('dama-tsteward'), personId: ctx.techStewardId, agentId: null, agentName: null, roleType: 'TECHNICAL_DATA_STEWARD', scopeType: 'DOMAIN', scopeId: ctx.domainIds[1], since: ts, createdAt: ts },
    { id: demoId('dama-engineer'), personId: ctx.engineerId, agentId: null, agentName: null, roleType: 'DATA_ENGINEER', scopeType: 'ORG', scopeId: orgId, since: ts, createdAt: ts },
    { id: demoId('dama-architect'), personId: ctx.architectId, agentId: null, agentName: null, roleType: 'DATA_ARCHITECT', scopeType: 'ORG', scopeId: orgId, since: ts, createdAt: ts },
  ]);

  // One RACI override so the matrix shows a deliberate deviation.
  await raciRepo().upsert({ nodeId: ctx.raciNodeId, personId: ctx.raciPersonId, value: 'C', reason: 'Consulted for cross-domain impact review' } as any);
}

// ── Docs depth (shared by both industry profiles) ───────────────────
// SOPs, business-glossary terms, and role operations manuals. Content
// is industry-neutral governance documentation, so both profiles get
// identical docs depth — only the org, owner, and one domain link
// differ.
interface DocsDepthCtx {
  orgId: string;
  ownerId: string;
  cdoId: string;
  domainId: string;
}

async function seedDocsDepth(repos: DemoRepos, ts: string, ctx: DocsDepthCtx): Promise<void> {
  const { orgId, ownerId, cdoId, domainId } = ctx;

  // SOPs (3).
  await createAll(repos.sops, [
    { id: demoId('sop-onboard'), orgId, code: 'SOP-001', title: 'Onboard a new data asset', purpose: 'Register a new asset with an owner, a tier, and a domain so it enters governance.', category: 'ONBOARDING', applicableRoles: ['DATA_OWNER', 'BUSINESS_DATA_STEWARD'], triggerEvent: 'A new data asset is discovered or created.', steps: [{ order: 1, title: 'Register the asset', description: 'Create the asset record with a business description.', estimatedMinutes: 10 }, { order: 2, title: 'Assign owner + steward', description: 'Set the accountable owner and the operational steward.', estimatedMinutes: 5 }, { order: 3, title: 'Set governance tier', description: 'Classify Bronze / Silver / Gold and note the rationale.', estimatedMinutes: 5 }], status: 'ACTIVE', version: 1, ownerPersonId: ownerId, createdAt: ts, updatedAt: ts },
    { id: demoId('sop-dq-incident'), orgId, code: 'SOP-002', title: 'Respond to a data quality incident', purpose: 'Triage and resolve a failing data quality rule before it reaches a report.', category: 'INCIDENT', applicableRoles: ['DATA_QUALITY_ANALYST', 'TECHNICAL_DATA_STEWARD'], triggerEvent: 'A data quality rule moves to FAILING.', steps: [{ order: 1, title: 'Confirm the failure', description: 'Re-run the rule and inspect the failure samples.', estimatedMinutes: 15 }, { order: 2, title: 'Open an issue', description: 'Raise a governance issue and assign the domain steward.', estimatedMinutes: 5 }, { order: 3, title: 'Remediate + re-measure', description: 'Fix at source, then re-run to confirm PASSING.', estimatedMinutes: 30 }], status: 'ACTIVE', version: 1, ownerPersonId: ownerId, createdAt: ts, updatedAt: ts },
    { id: demoId('sop-access-review'), orgId, code: 'SOP-003', title: 'Quarterly access recertification', purpose: 'Owners recertify who can access their assets each quarter.', category: 'REVIEW', applicableRoles: ['DATA_OWNER'], triggerEvent: 'Start of each quarter.', steps: [{ order: 1, title: 'Pull the access list', description: 'Export current grants per owned asset.', estimatedMinutes: 10 }, { order: 2, title: 'Certify or revoke', description: 'Confirm each grant is still needed; revoke the rest.', estimatedMinutes: 20 }], status: 'DRAFT', version: 1, ownerPersonId: cdoId, createdAt: ts, updatedAt: ts },
  ]);

  // Glossary terms (4).
  await createAll(repos.glossaryTerms, [
    { id: demoId('term-golden-record'), orgId, term: 'Golden Record', definition: 'The single authoritative version of an entity, reconciled across source systems.', context: 'Master data management.', synonyms: ['System of Record', 'Single Source of Truth'], domainId, ownerPersonId: ownerId, status: 'APPROVED', category: 'BUSINESS', exampleValues: 'The reconciled customer master row for account 10432.', businessRules: 'One golden record per real-world entity; conflicts resolved by survivorship rules.', sourceOfTruth: 'Master Data Management hub', createdAt: ts, updatedAt: ts },
    { id: demoId('term-governance-tier'), orgId, term: 'Governance Tier', definition: 'The maturity level at which an asset is governed: Bronze, Silver, or Gold.', context: 'Data governance.', synonyms: ['Data Tier'], domainId: null, ownerPersonId: cdoId, status: 'APPROVED', category: 'GENERAL', exampleValues: 'Bronze, Silver, Gold', businessRules: 'Gold requires an owner, DQ rules, and a certified definition.', sourceOfTruth: 'Data Governance Standard', createdAt: ts, updatedAt: ts },
    { id: demoId('term-data-owner'), orgId, term: 'Data Owner', definition: 'The person accountable for an asset or domain — its quality, access, and lifecycle.', context: 'Accountability model.', synonyms: [], domainId: null, ownerPersonId: cdoId, status: 'APPROVED', category: 'GENERAL', exampleValues: '', businessRules: 'Exactly one owner per asset; must be a named person, not a team.', sourceOfTruth: 'Data Governance Charter', createdAt: ts, updatedAt: ts },
    { id: demoId('term-data-domain'), orgId, term: 'Data Domain', definition: 'A logical grouping of related data assets under a single stewardship remit.', context: 'Domain model.', synonyms: ['Subject Area'], domainId: null, ownerPersonId: ownerId, status: 'PROPOSED', category: 'TECHNICAL', exampleValues: 'Customer Data, Operational Data', businessRules: 'Every asset belongs to exactly one domain.', sourceOfTruth: 'Domain catalogue', createdAt: ts, updatedAt: ts },
  ]);

  // Operations manuals (3) — per DAMA role.
  await createAll(repos.operationsManuals, [
    { id: demoId('om-cdo'), orgId, roleType: 'CDO', label: 'Chief Data Officer Operations', purpose: 'The recurring cadence for the enterprise data leader.', daily: ['Scan the open-issues bell for anything critical.'], weekly: ['Chair the Data Governance Council.', 'Review portfolio health + coverage trend.'], monthly: ['Report program metrics to the executive team.'], quarterly: ['Refresh the governance roadmap.', 'Sponsor a maturity assessment.'], escalation: ['Unresolved cross-domain disputes escalate to the CDO.'], customContent: '', isCustom: false, ownerPersonId: cdoId, createdAt: ts, updatedAt: ts },
    { id: demoId('om-owner'), orgId, roleType: 'DATA_OWNER', label: 'Data Owner Operations', purpose: 'The recurring cadence for a domain data owner.', daily: [], weekly: ['Triage new issues on owned assets.'], monthly: ['Review DQ scorecards for owned domains.'], quarterly: ['Run access recertification (SOP-003).'], escalation: ['Tier-drop on a critical asset escalates to the Council.'], customContent: '', isCustom: false, ownerPersonId: ownerId, createdAt: ts, updatedAt: ts },
    { id: demoId('om-steward'), orgId, roleType: 'BUSINESS_DATA_STEWARD', label: 'Business Data Steward Operations', purpose: 'The recurring cadence for a business data steward.', daily: ['Clear the metadata queue for assigned assets.'], weekly: ['Review AI-suggested sensitivity tags.'], monthly: ['Reconcile glossary terms with source-of-truth changes.'], quarterly: [], escalation: ['Ambiguous ownership escalates to the Data Owner.'], customContent: '', isCustom: false, ownerPersonId: ownerId, createdAt: ts, updatedAt: ts },
  ]);
}

// ── Lineage + trend history ─────────────────────────────────────────
// System→system + asset→asset lineage edges (profile-specific, so the
// caller passes them), plus maturity and gap snapshot history per org
// (generic improving trend, so the Maturity and gap-trend charts show
// real history rather than a synthesized single point).
interface LineageTrendCtx {
  orgIds: string[];
  links: Array<{ id: string; orgId: string; sourceSystemId: string; targetSystemId: string; dataAssetId: string | null; description: string; flowType: string; frequency: string }>;
  edges: Array<{ id: string; orgId: string; sourceAssetId: string; targetAssetId: string }>;
}

const TREND_WEEKS = 6;
const MATURITY_DIMS = ['Governance', 'Data Quality', 'Metadata', 'Architecture', 'Adoption'];

async function seedLineageAndTrends(repos: DemoRepos, ts: string, ctx: LineageTrendCtx): Promise<void> {
  // Lineage.
  await createAll(repos.dataLineageLinks, ctx.links.map((l) => ({ ...l, status: 'ACTIVE', createdAt: ts, updatedAt: ts })));
  await createAll(repos.assetLineageEdges, ctx.edges.map((e) => ({ ...e, source: 'manual', sourceRef: null, lastSeenAt: ts, createdAt: ts })));

  // Trend history — maturity + gap snapshots per org.
  const round1 = (v: number) => Math.round(v * 10) / 10;
  for (const orgId of ctx.orgIds) {
    const mat: any[] = [];
    const gaps: any[] = [];
    for (let i = 0; i < TREND_WEEKS; i++) {
      const progress = i / (TREND_WEEKS - 1); // 0 (oldest) → 1 (newest)
      const when = daysFromNow(-(TREND_WEEKS - 1 - i) * 7);
      mat.push({
        id: demoId(`mat-${orgId}-${i}`), orgId, timestamp: when,
        overall: round1(2.4 + progress * 1.4),
        dimensions: MATURITY_DIMS.map((name, di) => ({ name, score: round1(Math.min(5, 2.2 + progress * 1.5 + di * 0.1)) })),
      });
      gaps.push({
        id: demoId(`gap-${orgId}-${i}`), orgId, takenAt: when,
        metrics: {
          activities: 15,
          mappedActivities: Math.round(6 + progress * 6),
          coveragePct: Math.round(40 + progress * 35),
          orphanAssets: Math.max(0, Math.round(4 - progress * 2)),
          ungovernedAssets: Math.max(0, Math.round(5 - progress * 3)),
          ownerlessItems: Math.max(0, Math.round(6 - progress * 4)),
        },
      });
    }
    await createAll(repos.maturitySnapshots, mat);
    await createAll(repos.gapSnapshots, gaps);
  }
}

// ── Agent operations (per profile — references a seeded agent + activity) ──
// Two schedules and three executions (approved / awaiting-review /
// failed) so the Agents "runs" surface shows a real lifecycle.
interface AgentOpsCtx {
  orgId: string;
  agentId: string;
  agentName: string;
  activityId: string;
  activityName: string;
  roleType: string;
  createdBy: string;
  reviewerId: string;
}

async function seedAgentOps(repos: DemoRepos, ts: string, ctx: AgentOpsCtx): Promise<void> {
  const { orgId, agentId, agentName, activityId, activityName, roleType, createdBy, reviewerId } = ctx;
  const base = { orgId, agentId, agentName, activityId, activityName, roleType };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

  await createAll(repos.agentSchedules, [
    { id: demoId('sched-daily'), ...base, frequency: 'DAILY', status: 'ACTIVE', startAt: daysFromNow(-30), nextRunAt: daysFromNow(1), lastRunAt: hoursAgo(6), runCount: 24, createdBy, createdAt: ts, updatedAt: ts },
    { id: demoId('sched-weekly'), ...base, frequency: 'WEEKLY', status: 'PAUSED', startAt: daysFromNow(-60), nextRunAt: daysFromNow(5), lastRunAt: daysFromNow(-9), runCount: 6, createdBy, createdAt: ts, updatedAt: ts },
  ]);

  await createAll(repos.agentExecutions, [
    { id: demoId('exec-approved'), ...base, status: 'SUCCESS', startedAt: hoursAgo(6), completedAt: hoursAgo(6), output: `## ${activityName} — draft\n\nGenerated summary reviewed and approved.`, error: null, durationMs: 4200, reviewStatus: 'APPROVED', reviewedBy: reviewerId, reviewedAt: hoursAgo(5), promotedDocumentId: null, createdAt: hoursAgo(6) },
    { id: demoId('exec-pending'), ...base, status: 'SUCCESS', startedAt: hoursAgo(2), completedAt: hoursAgo(2), output: `## ${activityName} — draft\n\nAwaiting steward review.`, error: null, durationMs: 3800, reviewStatus: 'PENDING', reviewedBy: null, reviewedAt: null, promotedDocumentId: null, createdAt: hoursAgo(2) },
    { id: demoId('exec-failed'), ...base, status: 'FAILED', startedAt: hoursAgo(1), completedAt: hoursAgo(1), output: '', error: 'Model call timed out after 60s', durationMs: null, reviewStatus: 'PENDING', reviewedBy: null, reviewedAt: null, promotedDocumentId: null, createdAt: hoursAgo(1) },
  ]);
}

// ── Collaboration + reporting + connections ─────────────────────────
// A warehouse connection with asset columns + a binding, comments/tags/
// attachments on a seeded asset + system, and org-scoped reports,
// analysis, and saved views — so the collaboration affordances and the
// reporting/connection pages light up. References a profile-specific
// asset + system, so the caller passes their ids.
interface CollabReportingCtx {
  orgId: string;
  assetId: string;
  systemId: string;
  personId: string;
  personName: string;
}

async function seedCollabAndReporting(repos: DemoRepos, ts: string, ctx: CollabReportingCtx): Promise<void> {
  const { orgId, assetId, systemId, personId, personName } = ctx;

  // Connection (warehouse) + asset columns + a binding.
  const connId = demoId('conn-warehouse');
  await repos.connections.create({
    id: connId, orgId, name: 'Analytics Warehouse',
    connectionType: 'DATA_WAREHOUSE',
    config: { warehouseType: 'SNOWFLAKE', account: 'demo-account', warehouse: 'DEMO_WH', database: 'ANALYTICS', schema: 'PUBLIC' },
    credentials: { username: 'procela_ro' },
    status: 'CONNECTED', lastTestedAt: ts, lastTestResult: 'Connection successful', createdAt: ts, updatedAt: ts,
  });
  await createAll(repos.dataAssetColumns, [
    { id: demoId('col-id'), dataAssetId: assetId, columnName: 'id', dataType: 'UUID', description: 'Primary key.', sourceConnectionId: connId, sourceAsset: 'ANALYTICS.PUBLIC.asset', sourceColumn: 'id', createdAt: ts, updatedAt: ts },
    { id: demoId('col-name'), dataAssetId: assetId, columnName: 'name', dataType: 'String', description: 'Display name.', sourceConnectionId: connId, sourceAsset: 'ANALYTICS.PUBLIC.asset', sourceColumn: 'name', createdAt: ts, updatedAt: ts },
    { id: demoId('col-status'), dataAssetId: assetId, columnName: 'status', dataType: 'String', description: 'Lifecycle status.', sourceConnectionId: null, sourceAsset: null, sourceColumn: null, createdAt: ts, updatedAt: ts },
    { id: demoId('col-updated'), dataAssetId: assetId, columnName: 'updated_at', dataType: 'Timestamp', description: 'Last change timestamp.', sourceConnectionId: null, sourceAsset: null, sourceColumn: null, createdAt: ts, updatedAt: ts },
  ]);
  await repos.dataAssetBindings.create({ id: demoId('binding-primary'), orgId, dataAssetId: assetId, connectionId: connId, sourceAsset: 'ANALYTICS.PUBLIC.asset', sourceColumn: null, label: 'Primary warehouse table', isPrimary: true, createdAt: ts, updatedAt: ts });

  // Comments — a thread on the asset.
  const commentId = demoId('comment-root');
  await createAll(repos.comments, [
    { id: commentId, orgId, entityType: 'DataAsset', entityId: assetId, parentId: null, userId: personId, userName: personName, content: 'Confirmed the governance tier with the domain owner — good to certify.', mentions: [], createdAt: ts, updatedAt: ts, deletedAt: null },
    { id: demoId('comment-reply'), orgId, entityType: 'DataAsset', entityId: assetId, parentId: commentId, userId: personId, userName: personName, content: 'Certification scheduled for next review cycle.', mentions: [], createdAt: ts, updatedAt: ts, deletedAt: null },
  ]);

  // Tags — on the asset and its system.
  await createAll(repos.tags, [
    { id: demoId('tag-certified'), orgId, entityType: 'DataAsset', entityId: assetId, tag: 'certified', createdBy: personId, createdAt: ts },
    { id: demoId('tag-reviewed'), orgId, entityType: 'DataAsset', entityId: assetId, tag: 'pii-reviewed', createdBy: personId, createdAt: ts },
    { id: demoId('tag-sor'), orgId, entityType: 'System', entityId: systemId, tag: 'source-of-record', createdBy: personId, createdAt: ts },
  ]);

  // Attachments — a link and a file.
  await createAll(repos.attachments, [
    { id: demoId('attach-url'), orgId, entityType: 'DataAsset', entityId: assetId, type: 'URL', name: 'Data dictionary', description: 'Canonical field definitions.', url: 'https://wiki.internal/data-dictionary', uploadedBy: personId, createdAt: ts, updatedAt: ts },
    { id: demoId('attach-file'), orgId, entityType: 'DataAsset', entityId: assetId, type: 'FILE', name: 'Lineage diagram.png', description: 'Upstream lineage sketch.', fileName: 'lineage.png', filePath: '/var/procela/attachments/demo-lineage.png', fileSize: 82344, mimeType: 'image/png', uploadedBy: personId, createdAt: ts, updatedAt: ts },
  ]);

  // Reports (report-builder definitions).
  await createAll(repos.reports, [
    { id: demoId('report-ungoverned'), orgId, name: 'Ungoverned critical assets', description: 'Bronze-tier assets that support critical processes.', ownerId: personId, visibility: 'org', definition: { entity: 'dataAssets', columns: [{ field: 'name' }, { field: 'governanceTier' }, { field: 'healthScore' }], filters: [], sort: { field: 'healthScore', direction: 'asc' }, limit: 100 }, createdAt: ts, updatedAt: ts },
    { id: demoId('report-tiers'), orgId, name: 'Assets by governance tier', description: 'All assets with their tier and health.', ownerId: personId, visibility: 'private', definition: { entity: 'dataAssets', columns: [{ field: 'name' }, { field: 'governanceTier' }], filters: [], limit: 500 }, createdAt: ts, updatedAt: ts },
  ]);

  // Analysis report (pivot config).
  await repos.analysisReports.create({ id: demoId('analysis-coverage'), orgId, name: 'Coverage by division', description: 'Asset coverage split across divisions.', ownerId: personId, config: { rowDim: 'org', colDim: 'governanceTier', measure: 'count' }, createdAt: ts, updatedAt: ts });

  // Saved views (per-page filter snapshots).
  await createAll(repos.savedViews, [
    { id: demoId('view-bronze'), orgId, pageKey: 'data-assets', name: 'Bronze tier', ownerId: personId, ownerName: personName, filters: { governanceTier: 'BRONZE' }, createdAt: ts, updatedAt: ts },
    { id: demoId('view-tier1'), orgId, pageKey: 'processes', name: 'Tier 1 activities', ownerId: personId, ownerName: personName, filters: { criticalityTier: 'TIER_1' }, createdAt: ts, updatedAt: ts },
  ]);
}

export interface DemoSeedReport {
  organizations: number;
  people: number;
  systems: number;
  agents: number;
  dataDomains: number;
  dataAssets: number;
  processNodes: number;
  mappings: number;
  governanceTasks: number;
  governanceIssues: number;
  dataQualityRules: number;
  connectors: number;
  connectorEvents: number;
  calendarEvents: number;
  statsSnapshots: number;
  persona: { id: string; name: string };
}

/**
 * Wipe any existing `demo-*` rows and seed a demo fixture for the
 * requested industry (Utilities or Defense & Shipbuilding). Both
 * profiles are built to the same feature coverage, so a demo of
 * either lights up every page. Returns per-store row counts and the
 * demo persona so the caller can offer a "sign in as <persona>"
 * action next. Only one demo tenant exists at a time — the sweep
 * clears the previous industry's rows before seeding.
 */
export async function seedDemoData(industry: DemoIndustry = 'utilities'): Promise<DemoSeedReport> {
  const repos = buildRepos();
  await sweep(repos);
  const ts = now();
  // One builder per industry — add a new industry by adding its profile
  // function here (and to DemoIndustry + DEMO_AI_CACHE_KEYS).
  const builders: Record<DemoIndustry, (r: DemoRepos, t: string) => Promise<DemoSeedReport>> = {
    utilities: seedUtilities,
    shipbuilding: seedShipbuilding,
    healthcare: seedHealthcare,
    manufacturing: seedManufacturing,
    financial: seedFinancial,
    government: seedGovernment,
    logistics: seedLogistics,
    insurance: seedInsurance,
  };
  const report = await (builders[industry] ?? seedUtilities)(repos, ts);
  // Refresh the org-scope cache so accessible-orgs and the synchronous
  // scope checks see the freshly-seeded orgs immediately. In Postgres mode
  // that cache is otherwise stale until its TTL, so the org picker would
  // read "No organization defined" until it expired. Mirrors what the org
  // route does after a create; no-op in JSON mode.
  await invalidateOrgScopeCache();
  return report;
}

/**
 * Utilities profile — a Tidewater Utilities multi-utility tenant
 * (electric + water + shared services), persona Susan Chen (CDO).
 */
async function seedUtilities(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {

  // ── Organizations ──
  const orgTidewater = { id: demoId('org-tidewater'), parentId: null, name: 'Tidewater Utilities', type: 'company', industry: 'Utilities', description: 'Multi-utility demo tenant — electric + water + shared services.', headCount: 0, tenantSlug: 'tidewater', brandDisplayName: 'Tidewater Utilities', brandGlyph: '⚡', ssoButtonLabel: 'Sign in with Tidewater SSO', brandPrimaryColor: '#0f4f46', createdAt: ts, updatedAt: ts };
  const orgElectric = { id: demoId('org-electric'), parentId: orgTidewater.id, name: 'Tidewater Electric', type: 'division', industry: 'Utilities', description: 'Electric division', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWater = { id: demoId('org-water'), parentId: orgTidewater.id, name: 'Tidewater Water', type: 'division', industry: 'Utilities', description: 'Water division', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgShared = { id: demoId('org-shared'), parentId: orgTidewater.id, name: 'Shared Services', type: 'division', industry: 'Utilities', description: 'IT / Finance / HR / Regulatory / Safety', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgIT = { id: demoId('org-it'), parentId: orgShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgRegulatory = { id: demoId('org-regulatory'), parentId: orgShared.id, name: 'Regulatory Affairs', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgTd = { id: demoId('org-td'), parentId: orgElectric.id, name: 'Transmission & Distribution', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgCustomerElectric = { id: demoId('org-electric-customer'), parentId: orgElectric.id, name: 'Electric Customer Service', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  // Water division mirrors Electric's shape: an operations department
  // (parallel to T&D) and a customer-service department, both nested
  // under the water division so the tree isn't lopsided.
  const orgWaterOps = { id: demoId('org-water-ops'), parentId: orgWater.id, name: 'Water Operations', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWaterCustomer = { id: demoId('org-water-customer'), parentId: orgWater.id, name: 'Water Customer Service', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgTidewater, orgElectric, orgWater, orgShared, orgIT, orgRegulatory, orgTd, orgCustomerElectric, orgWaterOps, orgWaterCustomer]);

  // ── People (compact — enough to tell the demo story) ──
  // Susan Chen is the demo persona: signed-in user for the demo. Owns
  // Customer Data, holds three open tasks + one issue, has an
  // upcoming event.
  const susan = { id: demoId('person-susan-chen'), orgIds: [orgTidewater.id], accessibleOrgIds: [orgTidewater.id, orgElectric.id, orgWater.id, orgShared.id, orgWaterOps.id, orgWaterCustomer.id], name: 'Susan Chen', email: 'susan.chen@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const marisol = { id: demoId('person-marisol'), orgIds: [orgTidewater.id], accessibleOrgIds: [orgTidewater.id], name: 'Marisol Hadid', email: 'marisol.hadid@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const devon = { id: demoId('person-devon'), orgIds: [orgElectric.id], accessibleOrgIds: [orgElectric.id], name: 'Devon Kershaw', email: 'devon.kershaw@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Data Owner Tidewater Electric', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const jennifer = { id: demoId('person-jennifer'), orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id, orgElectric.id], name: 'Jennifer Vasquez', email: 'jennifer.vasquez@tidewater-utilities.com', role: 'EDITOR', title: 'Director Transmission & Distribution Ops', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const brandon = { id: demoId('person-brandon'), orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id], name: 'Brandon Willis', email: 'brandon.willis@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Grid Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const melissa = { id: demoId('person-melissa'), orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id], name: 'Melissa Patel', email: 'melissa.patel@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'System Operator Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const harold = { id: demoId('person-harold'), orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id], name: 'Harold Lindstrom', email: 'harold.lindstrom@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Distribution Control Center', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const natalie = { id: demoId('person-natalie'), orgIds: [orgCustomerElectric.id], accessibleOrgIds: [orgCustomerElectric.id], name: 'Natalie Greer', email: 'natalie.greer@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Customer Data', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const andre = { id: demoId('person-andre'), orgIds: [orgCustomerElectric.id], accessibleOrgIds: [orgCustomerElectric.id], name: 'Andre Ferguson', email: 'andre.ferguson@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Billing & Revenue', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kwame = { id: demoId('person-kwame'), orgIds: [orgIT.id], accessibleOrgIds: [orgIT.id], name: 'Kwame Osei', email: 'kwame.osei@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const amara = { id: demoId('person-amara'), orgIds: [orgIT.id], accessibleOrgIds: [orgIT.id], name: 'Amara Wambui', email: 'amara.wambui@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const tobias = { id: demoId('person-tobias'), orgIds: [orgIT.id], accessibleOrgIds: [orgIT.id], name: 'Tobias Reinholt', email: 'tobias.reinholt@tidewater-utilities.com', role: 'EDITOR', title: 'Manager OT Cybersecurity', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lorraine = { id: demoId('person-lorraine'), orgIds: [orgRegulatory.id], accessibleOrgIds: [orgRegulatory.id], name: 'Lorraine Kimura', email: 'lorraine.kimura@tidewater-utilities.com', role: 'EDITOR', title: 'Director Regulatory Affairs', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const phillip = { id: demoId('person-phillip'), orgIds: [orgRegulatory.id], accessibleOrgIds: [orgRegulatory.id], name: 'Phillip Rosenberg', email: 'phillip.rosenberg@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Compliance Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const samira = { id: demoId('person-samira'), orgIds: [orgCustomerElectric.id], accessibleOrgIds: [orgCustomerElectric.id], name: 'Samira Farooq', email: 'samira.farooq@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Contact Center', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const isabella = { id: demoId('person-isabella'), orgIds: [orgRegulatory.id], accessibleOrgIds: [orgRegulatory.id], name: 'Isabella Rossi', email: 'isabella.rossi@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Water Compliance', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  // Referenced by the training guide (Module 4.1 override-owner example
  // + Module 4.3 domain steward table). Kept separate from the water
  // block because Deborah is on the electric generation side.
  const deborah = { id: demoId('person-deborah'), orgIds: [orgTd.id], accessibleOrgIds: [orgTd.id, orgElectric.id], name: 'Deborah Kwon', email: 'deborah.kwon@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Generation', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  // Water division staff — mirrors the Electric footprint (division-
  // level Data Owner, an Ops director and two operators, plus a
  // customer-side steward + billing manager).
  const nadia = { id: demoId('person-nadia'), orgIds: [orgWater.id], accessibleOrgIds: [orgWater.id], name: 'Nadia Petrov', email: 'nadia.petrov@tidewater-utilities.com', role: 'ORG_ADMIN', title: 'Data Owner Tidewater Water', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const marcus = { id: demoId('person-marcus'), orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id, orgWater.id], name: 'Marcus Chen', email: 'marcus.chen@tidewater-utilities.com', role: 'EDITOR', title: 'Director Water Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sophie = { id: demoId('person-sophie'), orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id], name: 'Sophie Larsson', email: 'sophie.larsson@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Water Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const rafael = { id: demoId('person-rafael'), orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id], name: 'Rafael Ortiz', email: 'rafael.ortiz@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'System Operator Lead — Water Treatment', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const priya = { id: demoId('person-priya'), orgIds: [orgWaterOps.id], accessibleOrgIds: [orgWaterOps.id], name: 'Priya Sharma', email: 'priya.sharma@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Water Distribution Control', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kaia = { id: demoId('person-kaia'), orgIds: [orgWaterCustomer.id], accessibleOrgIds: [orgWaterCustomer.id], name: 'Kaia Nakamura', email: 'kaia.nakamura@tidewater-utilities.com', role: 'CONTRIBUTOR', title: 'Data Steward Water Customer Data', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const diego = { id: demoId('person-diego'), orgIds: [orgWaterCustomer.id], accessibleOrgIds: [orgWaterCustomer.id], name: 'Diego Alvarez', email: 'diego.alvarez@tidewater-utilities.com', role: 'EDITOR', title: 'Manager Water Billing', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [susan, marisol, devon, jennifer, brandon, melissa, harold, natalie, andre, kwame, amara, tobias, lorraine, phillip, samira, isabella, deborah, nadia, marcus, sophie, rafael, priya, kaia, diego]);

  // ── Systems ──
  const sysSCADA = { id: demoId('sys-scada'), orgId: orgElectric.id, name: 'SCADA', description: 'Supervisory Control And Data Acquisition — real-time grid telemetry.', systemType: 'OT', vendorName: 'GE', ownerPersonId: tobias.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysCIS = { id: demoId('sys-cis'), orgId: orgTidewater.id, name: 'CIS', description: 'Customer Information System — accounts, addresses, service history.', systemType: 'IT', vendorName: 'Oracle', ownerPersonId: andre.id, stewardIds: [natalie.id], createdAt: ts, updatedAt: ts };
  const sysAMI = { id: demoId('sys-ami'), orgId: orgTidewater.id, name: 'AMI', description: 'Advanced Metering Infrastructure — interval reads from smart meters.', systemType: 'OT', vendorName: 'Itron', ownerPersonId: kwame.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysOMS = { id: demoId('sys-oms'), orgId: orgElectric.id, name: 'OMS', description: 'Outage Management System — event tracking, restoration workflows.', systemType: 'OT', vendorName: 'ABB', ownerPersonId: harold.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysGIS = { id: demoId('sys-gis'), orgId: orgTidewater.id, name: 'GIS', description: 'Geospatial Information System — assets in the field.', systemType: 'IT', vendorName: 'Esri', ownerPersonId: jennifer.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgTidewater.id, name: 'Data Warehouse', description: 'Enterprise analytics warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: kwame.id, stewardIds: [], createdAt: ts, updatedAt: ts };
  // Water-specific systems (parallel to electric's SCADA + OMS).
  const sysLIMS = { id: demoId('sys-lims'), orgId: orgWater.id, name: 'LIMS', description: 'Laboratory Information Management System — water quality tests, sample chain of custody, effluent monitoring.', systemType: 'IT', vendorName: 'LabWare', ownerPersonId: sophie.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysHydraulic = { id: demoId('sys-hydraulic'), orgId: orgWater.id, name: 'Hydraulic Model', description: 'Distribution network hydraulic simulation — pressure, flow, main-break impact analysis.', systemType: 'OT', vendorName: 'Bentley OpenFlows', ownerPersonId: priya.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysSCADA, sysCIS, sysAMI, sysOMS, sysGIS, sysWarehouse, sysLIMS, sysHydraulic]);

  // ── Agents (5 — one of each type, all wired to responsible persons) ──
  await createAll(repos.agents, [
    { id: demoId('agent-outage-model'), orgIds: [orgElectric.id], name: 'Outage Prediction Model', agentType: 'AI', description: 'Predicts distribution outage probability from weather and asset health.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: amara.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-ami-pipeline'), orgIds: [orgTidewater.id], name: 'AMI Meter Ingestion Pipeline', agentType: 'PIPELINE', description: 'Hourly ETL for electric and water meter interval data into the data lake.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: kwame.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-notify-bot'), orgIds: [orgTidewater.id], name: 'Customer Notification Bot', agentType: 'BOT', description: 'Automated SMS and voice outage notifications and restoration updates.', provider: 'Twilio', status: 'ACTIVE', ownerPersonId: samira.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-pi-service'), orgIds: [orgElectric.id], name: 'PI Historian Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract historian tags.', provider: 'OSIsoft', status: 'ACTIVE', ownerPersonId: tobias.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-compliance'), orgIds: [orgTidewater.id], name: 'Compliance Report Generator', agentType: 'OTHER', description: 'Scheduled generator producing NPDES DMR and DWR monthly submissions.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: isabella.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains ──
  const domCustomer = { id: demoId('domain-customer'), code: 'CUST', orgId: orgTidewater.id, name: 'Customer Data', description: 'Customer accounts, addresses, service history, billing.', ownerId: susan.id, stewardIds: [natalie.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domOps = { id: demoId('domain-ops'), code: 'OPS', orgId: orgTidewater.id, name: 'Operational Data', description: 'Grid, generation, metering — the real-time and near-real-time operational feeds.', ownerId: jennifer.id, stewardIds: [brandon.id, deborah.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domRegulatory = { id: demoId('domain-regulatory'), code: 'REG', orgId: orgTidewater.id, name: 'Regulatory Data', description: 'Compliance evidence, filings, rate case data, NERC CIP + EPA SDWA.', ownerId: lorraine.id, stewardIds: [phillip.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Two sub-domains under Operational Data — shows the Domain → Sub-Domain
  // nesting out of the box. Parents are created first (FK order).
  const domOpsGrid = { id: demoId('domain-ops-grid'), code: 'OPS-01', orgId: orgTidewater.id, name: 'Grid Telemetry', description: 'SCADA and sensor feeds from the distribution grid — the real-time operational signal.', ownerId: jennifer.id, stewardIds: [brandon.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domOps.id, createdAt: ts, updatedAt: ts };
  const domOpsMetering = { id: demoId('domain-ops-metering'), code: 'OPS-02', orgId: orgTidewater.id, name: 'Metering & AMI', description: 'Advanced metering infrastructure reads and interval consumption data.', ownerId: jennifer.id, stewardIds: [deborah.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domOps.id, createdAt: ts, updatedAt: ts };
  const domOpsGen = { id: demoId('domain-ops-generation'), code: 'OPS-03', orgId: orgTidewater.id, name: 'Generation', description: 'Plant-level generation output and availability data.', ownerId: jennifer.id, stewardIds: [deborah.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domOps.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domCustomer, domOps, domRegulatory, domOpsGrid, domOpsMetering, domOpsGen]);

  // ── Data Assets (with domain inheritance where the pattern applies) ──
  const assetOutageLogs = { id: demoId('asset-outage-logs'), orgId: orgElectric.id, name: 'Outage Logs', description: 'Per-event SCADA records of distribution outages.', systemId: sysSCADA.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 62, createdAt: ts, updatedAt: ts };
  const assetCustomerMaster = { id: demoId('asset-customer-master'), orgId: orgTidewater.id, name: 'Customer Master', description: 'Service addresses, account status, billing terms.', systemId: sysCIS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 88, sensitivityTags: ['PII' as const], createdAt: ts, updatedAt: ts };
  const assetMeterReads = { id: demoId('asset-meter-reads'), orgId: orgTidewater.id, name: 'Meter Reads', description: 'AMI 15-minute interval consumption.', systemId: sysAMI.id, owner: '', ownerPersonId: andre.id, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 91, createdAt: ts, updatedAt: ts };
  const assetGeneration = { id: demoId('asset-generation-output'), orgId: orgElectric.id, name: 'Generation Output', description: 'Plant-level MWh by hour.', systemId: sysSCADA.id, owner: '', ownerPersonId: deborah.id, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 55, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's "which data assets
  // have no process using them?" produces a quotable answer.
  const orphanLegacyBilling = { id: demoId('asset-legacy-billing'), orgId: orgTidewater.id, name: 'Legacy Billing Extract', description: 'Nightly dump from the retired billing system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanMeterCsv = { id: demoId('asset-meter-csv'), orgId: orgTidewater.id, name: 'Meter CSV Dump', description: 'Ad-hoc CSV extract of yesterday\'s meter reads for an old vendor. Nobody remembers if it\'s still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  // Water-side assets (parallel to Outage Logs / Generation Output on
  // the electric side). Distribution Pressure feeds the Main Break
  // Response process below; Water Quality Results are LIMS-sourced;
  // NPDES Discharge is the compliance evidence asset.
  const assetDistPressure = { id: demoId('asset-dist-pressure'), orgId: orgWater.id, name: 'Distribution Pressure Reads', description: 'Continuous pressure telemetry from PRV stations and district metered areas.', systemId: sysSCADA.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, createdAt: ts, updatedAt: ts };
  const assetWaterQuality = { id: demoId('asset-water-quality'), orgId: orgWater.id, name: 'Water Quality Results', description: 'Lab and in-line water quality samples — turbidity, chlorine residual, coliform, pH.', systemId: sysLIMS.id, owner: '', ownerPersonId: sophie.id, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 79, createdAt: ts, updatedAt: ts };
  const assetNPDES = { id: demoId('asset-npdes'), orgId: orgWater.id, name: 'NPDES Discharge Records', description: 'Wastewater effluent discharge monitoring reports for state and EPA submissions.', systemId: sysLIMS.id, owner: '', ownerPersonId: isabella.id, stewardIds: [phillip.id] as string[], governanceTier: 'GOLD' as const, healthScore: 92, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetOutageLogs, assetCustomerMaster, assetMeterReads, assetGeneration, orphanLegacyBilling, orphanMeterCsv, assetDistPressure, assetWaterQuality, assetNPDES]);

  // Wire the domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domCustomer.id, { dataAssetIds: [assetCustomerMaster.id] });
  await repos.dataDomains.update(domOps.id, { dataAssetIds: [assetOutageLogs.id, assetMeterReads.id, assetGeneration.id, assetDistPressure.id, assetWaterQuality.id] });
  await repos.dataDomains.update(domRegulatory.id, { dataAssetIds: [assetNPDES.id] });

  // ── Process hierarchy (Tidewater Electric) ──
  // Compact but meaningful: one value stream, two processes, one
  // sub-process per process, three activities. Enough to demo
  // Dependencies, BCM attributes, and mappings.
  const vs = { id: demoId('node-vs-outage'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Outage Management', description: 'End-to-end restoration flow — detect, dispatch, communicate, recover.', activityId: 'VS-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procDetect = { id: demoId('node-proc-detect'), parentId: vs.id, level: 'PROCESS' as const, name: 'Detect & Assess', description: 'Detect outages via SCADA + customer channel, triage severity.', activityId: 'PRO-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procRestore = { id: demoId('node-proc-restore'), parentId: vs.id, level: 'PROCESS' as const, name: 'Restore & Communicate', description: 'Dispatch crews, restore service, notify customers.', activityId: 'PRO-DEMO-2', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: samira.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spTriage = { id: demoId('node-sp-triage'), parentId: procDetect.id, level: 'SUBPROCESS' as const, name: 'Outage Triage', description: 'Sort outages by criticality, allocate crews.', activityId: 'SP-DEMO-1', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  // actSignal sits upstream of actTriage so the Dependencies panel on
  // the seeded Outage triage shows a real predecessor — matches
  // playbook beat 3's promise.
  const actSignal = { id: demoId('node-act-signal'), parentId: spTriage.id, level: 'ACTIVITY' as const, name: 'SCADA anomaly detected', description: 'Grid telemetry flags a probable outage — voltage sag, breaker open, or historian gap.', activityId: 'ACT-DEMO-0', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'System Operator Lead', responsiblePersonId: melissa.id, systemIds: [sysSCADA.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actTriage = { id: demoId('node-act-triage'), parentId: spTriage.id, level: 'ACTIVITY' as const, name: 'Outage triage', description: 'Classify incoming outages, dispatch first responders.', activityId: 'ACT-DEMO-1', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'System Operator Lead', responsiblePersonId: melissa.id, systemIds: [sysSCADA.id, sysOMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Field crew on site within 30 minutes for Tier 1 outages\n\nP95 30 min from detection', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDispatch = { id: demoId('node-act-dispatch'), parentId: procRestore.id, level: 'ACTIVITY' as const, name: 'Crew dispatch', description: 'Assign crews to outages by location + skill.', activityId: 'ACT-DEMO-2', status: 'ACTIVE', orderIndex: 0, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: harold.id, responsibleRole: 'Line Superintendent', systemIds: [sysGIS.id, sysOMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actNotify = { id: demoId('node-act-notify'), parentId: procRestore.id, level: 'ACTIVITY' as const, name: 'Customer notification sent', description: 'SMS/email/voice notifications to affected customers.', activityId: 'ACT-DEMO-3', status: 'ACTIVE', orderIndex: 1, orgId: orgElectric.id, orgIds: [orgElectric.id], ownerId: samira.id, responsibleRole: 'Manager Contact Center', responsiblePersonId: samira.id, systemIds: [sysCIS.id], requiredSkillIds: [] as string[], version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vs, procDetect, procRestore, spTriage, actSignal, actTriage, actDispatch, actNotify]);

  // Flow relationships wiring the Electric activity chain. Feeds the
  // Dependencies panel: Outage triage sees actSignal as predecessor
  // and actDispatch as successor; actDispatch fans into actNotify.
  await createAll(repos.flowRelationships, [
    { id: demoId('flow-1'), fromNodeId: actSignal.id, toNodeId: actTriage.id, type: 'SEQUENCE' as const, label: 'anomaly confirmed', createdAt: ts },
    { id: demoId('flow-2'), fromNodeId: actTriage.id, toNodeId: actDispatch.id, type: 'SEQUENCE' as const, label: 'crew required', createdAt: ts },
    { id: demoId('flow-3'), fromNodeId: actDispatch.id, toNodeId: actNotify.id, type: 'SEQUENCE' as const, label: 'ETA available', createdAt: ts },
  ]);

  // ── Process hierarchy (Tidewater Water) ──
  // Mirrors the Electric shape: one value stream, two processes, one
  // sub-process, three activities. Priority pair with Outage Management
  // — Main Break Response is the equivalent restoration flow, plus a
  // Treatment process for the quality-testing story.
  const vsW = { id: demoId('node-vs-water'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Water Distribution & Quality', description: 'End-to-end delivery of safe potable water — treat, distribute, monitor, restore.', activityId: 'VS-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: marcus.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procMainBreak = { id: demoId('node-proc-main-break'), parentId: vsW.id, level: 'PROCESS' as const, name: 'Main Break Response', description: 'Detect and repair distribution main breaks before customer complaints escalate.', activityId: 'PRO-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procTreatment = { id: demoId('node-proc-treatment'), parentId: vsW.id, level: 'PROCESS' as const, name: 'Treatment Operations', description: 'Run treatment plants + monitor water quality against permit thresholds.', activityId: 'PRO-DEMO-W2', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: rafael.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spBreakTriage = { id: demoId('node-sp-break-triage'), parentId: procMainBreak.id, level: 'SUBPROCESS' as const, name: 'Break Triage', description: 'Confirm break, size the affected zone, dispatch the right crew.', activityId: 'SP-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDetectBreak = { id: demoId('node-act-detect-break'), parentId: spBreakTriage.id, level: 'ACTIVITY' as const, name: 'Detect main break', description: 'Acoustic sensors + pressure anomalies flag likely breaks.', activityId: 'ACT-DEMO-W1', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, responsibleRole: 'System Operator Lead — Water Treatment', responsiblePersonId: rafael.id, systemIds: [sysSCADA.id, sysHydraulic.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Break confirmed within 15 minutes of anomaly signal\n\nP95 15 min from anomaly to dispatch', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDispatchWater = { id: demoId('node-act-dispatch-water'), parentId: procMainBreak.id, level: 'ACTIVITY' as const, name: 'Dispatch repair crew', description: 'Match crew skill + equipment to the break location and severity.', activityId: 'ACT-DEMO-W2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: priya.id, responsibleRole: 'Manager Water Distribution Control', systemIds: [sysGIS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actWaterQualityTest = { id: demoId('node-act-quality-test'), parentId: procTreatment.id, level: 'ACTIVITY' as const, name: 'Water quality sample test', description: 'Draw + analyse the shift sample; log turbidity, chlorine residual, coliform.', activityId: 'ACT-DEMO-W3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWater.id, orgIds: [orgWater.id], ownerId: rafael.id, responsibleRole: 'Data Steward Water Operations', responsiblePersonId: sophie.id, systemIds: [sysLIMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 2, successMeasure: 'Every shift sample logged within 4 hours', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsW, procMainBreak, procTreatment, spBreakTriage, actDetectBreak, actDispatchWater, actWaterQualityTest]);

  // Water-side flow — Detect main break → Dispatch repair crew.
  // Mirrors the electric predecessor/successor story.
  await createAll(repos.flowRelationships, [
    { id: demoId('flow-w1'), fromNodeId: actDetectBreak.id, toNodeId: actDispatchWater.id, type: 'SEQUENCE' as const, label: 'break confirmed', createdAt: ts },
  ]);

  // ── Mappings ──
  await createAll(repos.mappings, [
    { id: demoId('map-1'), orgId: orgElectric.id, processStepId: actTriage.id, dataAssetId: assetOutageLogs.id, linkType: 'INPUT', notes: 'Consumes raw outage records', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-2'), orgId: orgElectric.id, processStepId: actTriage.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Cross-references affected customers', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-3'), orgId: orgElectric.id, processStepId: actNotify.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Pulls customer contact preferences', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-4'), orgId: orgTidewater.id, processStepId: actDispatch.id, dataAssetId: assetMeterReads.id, linkType: 'INPUT', notes: 'Verifies restoration via meter reads', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    // Water side mappings — parallel shape to electric's three.
    { id: demoId('map-w1'), orgId: orgWater.id, processStepId: actDetectBreak.id, dataAssetId: assetDistPressure.id, linkType: 'INPUT', notes: 'Reads pressure telemetry to confirm the break signal', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-w2'), orgId: orgWater.id, processStepId: actDetectBreak.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Identifies the customers in the affected zone', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-w3'), orgId: orgWater.id, processStepId: actWaterQualityTest.id, dataAssetId: assetWaterQuality.id, linkType: 'OUTPUT', notes: 'Writes the shift sample result set', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Susan (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-1'), orgId: orgTidewater.id, title: 'Approve Q3 data classification review', description: 'Review the AI-suggested sensitivity tags on Customer Master and Outage Logs and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: susan.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetCustomerMaster.id, automationMode: 'HUMAN' as any, createdBy: marisol.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-2'), orgId: orgTidewater.id, title: 'Sign off on Regulatory Data domain scope', description: 'Lorraine has proposed expanding the Regulatory Data domain to cover new SDWA reporting fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: susan.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domRegulatory.id, automationMode: 'HUMAN' as any, createdBy: lorraine.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-3'), orgId: orgTidewater.id, title: 'Retire Legacy Billing Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: susan.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyBilling.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Susan ──
  await repos.governanceIssues.create({
    id: demoId('issue-1'),
    orgId: orgTidewater.id,
    title: 'Generation Output tier below Silver — critical process, ungoverned',
    description: 'Generation Output is BRONZE tier but the Detect & Assess process depends on it as an input. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domOps.id,
    dataAssetId: assetGeneration.id,
    systemId: sysSCADA.id,
    reportedBy: marisol.id,
    assignedTo: susan.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules ──
  // Two rules that tell a demo story:
  //   * Customer Master · Completeness · currently PASSING at 96 —
  //     the healthy state. Demonstrates the green DQ tile on the
  //     Dashboard and the rule detail on the DQ page.
  //   * Generation Output · Timeliness · currently FAILING at 62 —
  //     under threshold. Same asset as the seeded governance issue,
  //     so the DQ tile and the issue tell one coherent story.
  const dqPassing = {
    id: demoId('dq-rule-passing'),
    orgId: orgTidewater.id,
    dataAssetId: assetCustomerMaster.id,
    dimension: 'COMPLETENESS' as const,
    name: 'Customer Master · email completeness',
    description: 'At least 95% of customer records must have a non-null email address.',
    threshold: 95,
    currentScore: 96,
    weight: 1,
    status: 'PASSING' as const,
    lastMeasured: ts,
    scheduleFrequency: 'DAILY' as const,
    nextRunAt: daysFromNow(1),
    createdAt: ts,
    updatedAt: ts,
  };
  const dqFailing = {
    id: demoId('dq-rule-failing'),
    orgId: orgElectric.id,
    dataAssetId: assetGeneration.id,
    dimension: 'TIMELINESS' as const,
    name: 'Generation Output · hourly write latency',
    description: 'Every hour the plant should write within 5 minutes of the reporting boundary. Rolling 24h.',
    threshold: 95,
    currentScore: 62,
    weight: 1,
    status: 'FAILING' as const,
    lastMeasured: ts,
    scheduleFrequency: 'HOURLY' as const,
    nextRunAt: daysFromNow(0),
    createdAt: ts,
    updatedAt: ts,
  };
  await createAll(repos.dataQualityRules, [dqPassing, dqFailing]);

  // ── Edge connector (on-prem agent) ──
  // One healthy connector shows the customer their in-network agent
  // relationship in the demo without needing to spin up a real
  // container on stage. Pair state is populated; the token hash is
  // a fixed sha256 of the string "demo-connector-token" so a demo
  // reader can grep the store and see how the field looks without
  // exposing a plaintext token. Freshness bucket is computed live
  // at read time — we set lastHeartbeatAt to 45 seconds ago so the
  // row shows ONLINE without any timing acrobatics.
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-tidewater'),
    orgId: orgTidewater.id,
    name: 'Tidewater Data Platform Connector',
    // sha256("demo-connector-token") — the plaintext isn't reachable
    // through the demo path so this is illustrative only, but keeps
    // the schema honest.
    tokenHash: '5f6d3c4f26f9c50a9c1a5a2f70c3f7f4a0b3d3c8b3f7d9c3a1e2f5b6c9d0e1f2',
    pairingCode: null,
    pairingCodeExpiresAt: null,
    systemIds: [sysAMI.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt,
    agentVersion: '1.2.0',
    status: 'ONLINE' as const,
    createdAt: connectorCreatedAt,
    updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  // Wire the connector's most recent sync onto Meter Reads so the
  // Data Asset detail page shows the "Synced 5 min ago" chip during
  // the demo. These fields live on the asset as a runtime extension
  // that the connector route adds without a schema change — the
  // frontend picks it up unconditionally.
  await repos.dataAssets.update(assetMeterReads.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  // Connector activity feed — the "Events" tab on the connector
  // detail. Order is chronological ascending; the UI reverses on
  // render so newest reads first.
  await createAll(repos.connectorEvents, [
    {
      id: demoId('ce-paired'), connectorId: conn.id, orgId: orgTidewater.id,
      type: 'PAIRED', ts: connectorCreatedAt,
      data: { agentVersion: '1.2.0' },
    },
    {
      id: demoId('ce-scan-start'), connectorId: conn.id, orgId: orgTidewater.id,
      type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      data: { targetSystemIds: [sysAMI.id, sysWarehouse.id] },
    },
    {
      id: demoId('ce-scan-done'), connectorId: conn.id, orgId: orgTidewater.id,
      type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(),
      data: { durationMs: 40_120, assetsDiscovered: 1 },
    },
    {
      id: demoId('ce-assets'), connectorId: conn.id, orgId: orgTidewater.id,
      type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(),
      data: { incoming: 1, created: 0, updated: 1 },
    },
    {
      id: demoId('ce-hb'), connectorId: conn.id, orgId: orgTidewater.id,
      type: 'HEARTBEAT', ts: connectorHeartbeatAt,
      data: { agentVersion: '1.2.0' },
    },
  ]);

  // Second connector — PAIRING state. Shows the other half of the
  // agent lifecycle so the demo can walk both "just installed,
  // waiting to be claimed" and "steady-state ONLINE". Pairing code
  // is a fixed 8-digit string; expiry ~5 minutes into the future
  // so a live claim from the CLI during the demo would actually
  // work if the presenter wanted to prove the round-trip.
  const pairingConn = {
    id: demoId('conn-pairing'),
    orgId: orgTidewater.id,
    name: 'Water Plant SCADA Connector',
    tokenHash: null,
    pairingCode: '19427301',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[],
    lastHeartbeatAt: null,
    agentVersion: null,
    status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  // Populates the fourth My Dashboard tile (Upcoming Events) so
  // the persona doesn't have three lit tiles and one blank.
  // Weekly Data Governance Committee sync — the archetypal DAMA
  // artefact, Susan owns it, meets Fridays at 09:00.
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-dgc'),
    orgId: orgTidewater.id,
    name: 'Data Governance Committee weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [susan.id, marisol.id, devon.id, lorraine.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org
  // (see weeklySnapshots at module scope). ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgTidewater.id, { coverage: 60, avgHealth: 68, gaps: 9, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgElectric.id, { coverage: 67, avgHealth: 66, gaps: 5, dataAssets: 4, mappings: 4 }),
    ...weeklySnapshots(orgWater.id, { coverage: 75, avgHealth: 82, gaps: 3, dataAssets: 3, mappings: 3 }),
    ...weeklySnapshots(orgShared.id, { coverage: 40, avgHealth: 70, gaps: 4, dataAssets: 0, mappings: 0 }),
  ]);

  // ── AI template cache — pre-warm the wand for Tidewater ──
  // A live demo can't afford the 10–30s Claude wait on the "Generate
  // processes" wand. Seeding two hand-crafted templates against the
  // real cache keys means the first click for Electric OR Water
  // returns instantly. The user can still hit "Regenerate from AI"
  // if they want a fresh live call — the button bypasses the cache.
  aiTemplateCache.push(
    {
      industry: 'utilities|tidewater electric',
      industryLabel: 'Utilities — Tidewater Electric',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Outage Management',
            description: 'Detect, dispatch, restore, and communicate through distribution outages.',
            purpose: 'Restore electric service safely and quickly when the grid is disrupted.',
            businessOutcome: 'Reliable power delivery and defensible SAIDI / SAIFI performance to the regulator.',
            processes: [
              { name: 'Detect & Assess', description: 'Identify the outage and its scope from SCADA and customer channels.', purpose: 'Turn raw signals into an actionable event.', activities: [
                { name: 'Detect outage from SCADA', description: 'SCADA breaker + FCI events land in the OMS.' },
                { name: 'Correlate customer reports', description: 'Cross-reference contact-centre calls with the outage extent.' },
                { name: 'Classify severity', description: 'Assign a Tier 1/2/3 based on customer count and critical loads.' },
              ] },
              { name: 'Dispatch & Restore', description: 'Assign crews, execute switching, restore service.', purpose: 'Get the lights back on with the safest possible plan.', activities: [
                { name: 'Assign crew', description: 'Match the closest qualified crew to the outage in GIS.' },
                { name: 'Execute switching plan', description: 'Isolate the fault and back-feed unaffected customers.' },
                { name: 'Confirm restoration', description: 'Verify restoration via meter reads and customer callback.' },
              ] },
              { name: 'Communicate & Report', description: 'Keep customers and regulators informed throughout the event.', purpose: 'Meet notification SLAs and regulatory reporting deadlines.', activities: [
                { name: 'Notify affected customers', description: 'SMS, voice, and email based on customer contact preferences.' },
                { name: 'Update outage map', description: 'Publish restoration ETAs on the public outage map.' },
                { name: 'File regulatory report', description: 'Submit reliability event data to the PUC.' },
              ] },
            ],
          },
          {
            name: 'Generation Operations',
            description: 'Run the generation fleet to meet load and reliability targets.',
            purpose: 'Deliver dispatchable capacity into the wholesale + retail markets.',
            businessOutcome: 'Margin on generation vs market prices while staying inside environmental limits.',
            processes: [
              { name: 'Day-Ahead Planning', description: 'Forecast load, commit units, and file day-ahead bids.', purpose: 'Line up the least-cost generation stack for tomorrow.', activities: [
                { name: 'Forecast day-ahead load', description: 'Combine weather + historical patterns into an hourly forecast.' },
                { name: 'Commit units', description: 'Schedule unit start-ups given fuel and ramp constraints.' },
              ] },
              { name: 'Real-Time Operations', description: 'Balance generation against load in real time.', purpose: 'Keep the lights on and frequency stable across the interconnect.', activities: [
                { name: 'Monitor plant output', description: 'Watch MW output vs schedule per unit.' },
                { name: 'Dispatch adjustments', description: 'Move generation up or down to hold ACE within limits.' },
              ] },
            ],
          },
          {
            name: 'Customer Operations',
            description: 'Onboard, bill, and serve residential + commercial electric customers.',
            purpose: 'Deliver a defensible customer experience across the meter-to-cash lifecycle.',
            businessOutcome: 'Cash collected on time; low arrears; high CSAT.',
            processes: [
              { name: 'New Service Onboarding', description: 'Set up a new customer at a new address.', purpose: 'Get the meter energised, billed, and pointed at the right rate.', activities: [
                { name: 'Receive new service request', description: 'From the web portal or contact centre.' },
                { name: 'Provision meter', description: 'Schedule field visit + install the AMI meter.' },
                { name: 'Activate billing account', description: 'Create the CIS account and enrol in the correct rate.' },
              ] },
              { name: 'Meter-to-Cash', description: 'Read meters, bill customers, collect payment.', purpose: 'Convert consumption into revenue.', activities: [
                { name: 'Ingest interval reads', description: 'AMI reads flow into the billing engine hourly.' },
                { name: 'Generate bill', description: 'Apply the customer rate schedule to their consumption.' },
                { name: 'Receive payment', description: 'Post payment to the CIS account.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'utilities|tidewater water',
      industryLabel: 'Utilities — Tidewater Water',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Water Treatment',
            description: 'Convert raw source water into potable water that meets SDWA standards.',
            purpose: 'Produce safe drinking water at the volumes customers demand.',
            businessOutcome: 'Zero SDWA violations, minimum chemical cost, defensible turbidity trend.',
            processes: [
              { name: 'Coagulation & Sedimentation', description: 'Add coagulant + settle solids.', purpose: 'Remove suspended particles before filtration.', activities: [
                { name: 'Dose coagulant', description: 'Adjust dose based on raw water turbidity + temperature.' },
                { name: 'Settle sludge', description: 'Sediment settles into the sludge collection zone.' },
              ] },
              { name: 'Filtration & Disinfection', description: 'Filter + chlorinate.', purpose: 'Meet the primary drinking water standards.', activities: [
                { name: 'Run filter cycle', description: 'Media filters catch remaining solids; backwash on turbidity breakthrough.' },
                { name: 'Chlorinate', description: 'Dose chlorine to hit residual + CT targets.' },
              ] },
            ],
          },
          {
            name: 'Water Distribution',
            description: 'Move potable water from plants to customer taps under pressure.',
            purpose: 'Deliver enough water at the right pressure to every service line.',
            businessOutcome: 'Low non-revenue water; low main-break rate; predictable pressure at all zones.',
            processes: [
              { name: 'Pressure Management', description: 'Keep distribution pressure inside a safe operating band.', purpose: 'Balance customer service against pipe stress.', activities: [
                { name: 'Monitor DMA pressure', description: 'Read PRV telemetry across the district metered areas.' },
                { name: 'Adjust PRV setpoints', description: 'Tune valve setpoints in response to demand patterns.' },
              ] },
              { name: 'Main Break Response', description: 'Detect + repair main breaks.', purpose: 'Restore service before customer complaints escalate.', activities: [
                { name: 'Detect main break', description: 'Acoustic sensors + pressure anomalies flag likely breaks.' },
                { name: 'Dispatch repair crew', description: 'Match crew to break location.' },
                { name: 'Restore service', description: 'Repair the main and re-pressurise the affected zone.' },
              ] },
            ],
          },
          {
            name: 'Wastewater Operations',
            description: 'Collect and treat wastewater to NPDES permit standards.',
            purpose: 'Return safe effluent to the receiving water body.',
            businessOutcome: 'Zero NPDES exceedances; steady biosolids production.',
            processes: [
              { name: 'Collection', description: 'Convey wastewater from customers to the treatment plant.', purpose: 'Keep the collection system flowing.', activities: [
                { name: 'Monitor pump stations', description: 'Watch wet-well levels + pump run-hours.' },
                { name: 'Respond to blockages', description: 'Vac truck dispatch for grease + root intrusion events.' },
              ] },
              { name: 'Treatment', description: 'Biological + chemical treatment of collected wastewater.', purpose: 'Meet effluent permit limits.', activities: [
                { name: 'Run activated sludge process', description: 'Aerate + return sludge to hit BOD/TSS targets.' },
                { name: 'Disinfect effluent', description: 'UV or chlorine disinfection before discharge.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgTidewater.id,
    cdoId: susan.id,
    govLeadId: marisol.id,
    dataOwnerId: devon.id,
    stewardIds: [natalie.id, brandon.id],
    tenantName: 'Tidewater Utilities',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgTidewater.id,
    domainIds: [domCustomer.id, domOps.id, domRegulatory.id],
    cdoId: susan.id,
    govLeadId: marisol.id,
    dataOwnerId: devon.id,
    stewardId: natalie.id,
    techStewardId: brandon.id,
    engineerId: kwame.id,
    architectId: amara.id,
    raciNodeId: actTriage.id,
    raciPersonId: melissa.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgTidewater.id, ownerId: natalie.id, cdoId: susan.id, domainId: domCustomer.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgTidewater.id, orgElectric.id, orgWater.id],
    links: [
      { id: demoId('lin-1'), orgId: orgTidewater.id, sourceSystemId: sysAMI.id, targetSystemId: sysWarehouse.id, dataAssetId: assetMeterReads.id, description: 'AMI interval reads land in the warehouse.', flowType: 'ETL', frequency: 'HOURLY' },
      { id: demoId('lin-2'), orgId: orgTidewater.id, sourceSystemId: sysCIS.id, targetSystemId: sysWarehouse.id, dataAssetId: assetCustomerMaster.id, description: 'Customer master syncs nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-3'), orgId: orgElectric.id, sourceSystemId: sysSCADA.id, targetSystemId: sysOMS.id, dataAssetId: assetOutageLogs.id, description: 'SCADA events stream into the outage management system.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgTidewater.id, sourceAssetId: assetMeterReads.id, targetAssetId: assetCustomerMaster.id },
      { id: demoId('edge-2'), orgId: orgElectric.id, sourceAssetId: assetOutageLogs.id, targetAssetId: assetGeneration.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgTidewater.id, agentId: demoId('agent-compliance'), agentName: 'Compliance Report Generator', activityId: actTriage.id, activityName: 'Outage triage', roleType: 'DATA_QUALITY_ANALYST', createdBy: susan.id, reviewerId: marisol.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgTidewater.id, assetId: assetCustomerMaster.id, systemId: sysCIS.id, personId: natalie.id, personName: 'Natalie Greer' });

  // Column-level lineage: a couple of upstream columns on Meter Reads feeding
  // Customer Master's columns (which seedCollabAndReporting just created), so
  // the Lineage page's column grain lights up alongside the asset edge above.
  await createAll(repos.dataAssetColumns, [
    { id: demoId('mr-col-id'), dataAssetId: assetMeterReads.id, columnName: 'meter_id', dataType: 'UUID', description: 'Meter identifier.', sourceConnectionId: null, sourceAsset: null, sourceColumn: null, createdAt: ts, updatedAt: ts },
    { id: demoId('mr-col-account'), dataAssetId: assetMeterReads.id, columnName: 'account_name', dataType: 'String', description: 'Account display name.', sourceConnectionId: null, sourceAsset: null, sourceColumn: null, createdAt: ts, updatedAt: ts },
  ]);
  await createAll(repos.columnLineageEdges, [
    { id: demoId('coledge-1'), orgId: orgTidewater.id, sourceColumnId: demoId('mr-col-id'), targetColumnId: demoId('col-id'), source: 'manual', sourceRef: null, lastSeenAt: ts, createdAt: ts },
    { id: demoId('coledge-2'), orgId: orgTidewater.id, sourceColumnId: demoId('mr-col-account'), targetColumnId: demoId('col-name'), source: 'manual', sourceRef: null, lastSeenAt: ts, createdAt: ts },
  ]);

  logger.info({ persona: susan.name }, 'Demo data seeded');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: susan.id, name: susan.name },
  };
}

/**
 * Shipbuilding profile — Meridian Shipbuilding, a naval + commercial
 * shipyard (New Construction + Fleet Sustainment + Shared Services),
 * persona Elena Ruiz (CDO). Built to the same feature coverage and
 * counts as the utilities profile, with authentic shipbuilding
 * structure: value streams for Ship Construction and Fleet
 * Sustainment, weld/NDT quality evidence, and a PLM/ERP/MES/EAM/QMS
 * system landscape.
 */
async function seedShipbuilding(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {
  // ── Organizations (company → 3 divisions → 6 departments) ──
  const orgMeridian = { id: demoId('org-meridian'), parentId: null, name: 'Meridian Shipbuilding', type: 'company', industry: 'Defense & Shipbuilding', description: 'Naval + commercial shipyard demo tenant — new construction, sustainment, shared services.', headCount: 0, tenantSlug: 'meridian', brandDisplayName: 'Meridian Shipbuilding', brandGlyph: '⚓', ssoButtonLabel: 'Sign in with Meridian SSO', brandPrimaryColor: '#0f4f46', createdAt: ts, updatedAt: ts };
  const orgNewCon = { id: demoId('org-newcon'), parentId: orgMeridian.id, name: 'New Construction', type: 'division', industry: 'Defense & Shipbuilding', description: 'New-build ship construction', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgSustain = { id: demoId('org-sustain'), parentId: orgMeridian.id, name: 'Fleet Sustainment', type: 'division', industry: 'Defense & Shipbuilding', description: 'Repair, overhaul, dry-dock availabilities', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgMShared = { id: demoId('org-mshared'), parentId: orgMeridian.id, name: 'Shared Services', type: 'division', industry: 'Defense & Shipbuilding', description: 'IT / Quality / Regulatory / Supply Chain', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgHull = { id: demoId('org-hull'), parentId: orgNewCon.id, name: 'Hull & Structure', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgOutfit = { id: demoId('org-outfit'), parentId: orgNewCon.id, name: 'Outfitting & Assembly', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgDryDock = { id: demoId('org-drydock'), parentId: orgSustain.id, name: 'Dry Dock Operations', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgRepair = { id: demoId('org-repair'), parentId: orgSustain.id, name: 'Repair Planning', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgMIT = { id: demoId('org-mit'), parentId: orgMShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgQuality = { id: demoId('org-quality'), parentId: orgMShared.id, name: 'Quality & Compliance', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgMeridian, orgNewCon, orgSustain, orgMShared, orgHull, orgOutfit, orgDryDock, orgRepair, orgMIT, orgQuality]);

  // ── People (24) — persona Elena Ruiz (CDO) ──
  const elena = { id: demoId('person-elena-ruiz'), orgIds: [orgMeridian.id], accessibleOrgIds: [orgMeridian.id, orgNewCon.id, orgSustain.id, orgMShared.id, orgHull.id, orgOutfit.id, orgDryDock.id, orgRepair.id, orgMIT.id, orgQuality.id], name: 'Elena Ruiz', email: 'elena.ruiz@meridian-shipbuilding.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const priyanka = { id: demoId('person-priyanka'), orgIds: [orgMeridian.id], accessibleOrgIds: [orgMeridian.id], name: 'Priyanka Rao', email: 'priyanka.rao@meridian-shipbuilding.com', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const grant = { id: demoId('person-grant'), orgIds: [orgNewCon.id], accessibleOrgIds: [orgNewCon.id], name: 'Grant Whitfield', email: 'grant.whitfield@meridian-shipbuilding.com', role: 'ORG_ADMIN', title: 'Data Owner New Construction', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const tomas = { id: demoId('person-tomas'), orgIds: [orgHull.id], accessibleOrgIds: [orgHull.id, orgNewCon.id], name: 'Tomas Nogueira', email: 'tomas.nogueira@meridian-shipbuilding.com', role: 'EDITOR', title: 'Director Hull Construction', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const bianca = { id: demoId('person-bianca'), orgIds: [orgHull.id], accessibleOrgIds: [orgHull.id], name: 'Bianca Ferro', email: 'bianca.ferro@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Welding Engineering Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const dmitri = { id: demoId('person-dmitri'), orgIds: [orgHull.id], accessibleOrgIds: [orgHull.id], name: 'Dmitri Volkov', email: 'dmitri.volkov@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Data Steward Hull & Structure', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const aaliyah = { id: demoId('person-aaliyah'), orgIds: [orgHull.id], accessibleOrgIds: [orgHull.id], name: 'Aaliyah Bright', email: 'aaliyah.bright@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Steel Fabrication Superintendent', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const corentin = { id: demoId('person-corentin'), orgIds: [orgOutfit.id], accessibleOrgIds: [orgOutfit.id], name: 'Corentin Bahati', email: 'corentin.bahati@meridian-shipbuilding.com', role: 'EDITOR', title: 'Manager Outfitting & Assembly', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const noor = { id: demoId('person-noor'), orgIds: [orgOutfit.id], accessibleOrgIds: [orgOutfit.id], name: 'Noor Haddad', email: 'noor.haddad@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Data Steward Outfitting', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const yusuf = { id: demoId('person-yusuf'), orgIds: [orgOutfit.id], accessibleOrgIds: [orgOutfit.id], name: 'Yusuf Demir', email: 'yusuf.demir@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Pipefitting Superintendent', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const marco = { id: demoId('person-marco'), orgIds: [orgSustain.id], accessibleOrgIds: [orgSustain.id], name: 'Marco Bellini', email: 'marco.bellini@meridian-shipbuilding.com', role: 'ORG_ADMIN', title: 'Data Owner Fleet Sustainment', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const reggie = { id: demoId('person-reggie'), orgIds: [orgDryDock.id], accessibleOrgIds: [orgDryDock.id, orgSustain.id], name: 'Reggie Dawson', email: 'reggie.dawson@meridian-shipbuilding.com', role: 'EDITOR', title: 'Director Dry Dock Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const yuki = { id: demoId('person-yuki'), orgIds: [orgDryDock.id], accessibleOrgIds: [orgDryDock.id], name: 'Yuki Tanaka', email: 'yuki.tanaka@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Dock Master', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sofiam = { id: demoId('person-sofia-m'), orgIds: [orgDryDock.id], accessibleOrgIds: [orgDryDock.id], name: 'Sofia Marchetti', email: 'sofia.marchetti@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Data Steward Dry Dock', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const hassan = { id: demoId('person-hassan'), orgIds: [orgRepair.id], accessibleOrgIds: [orgRepair.id], name: 'Hassan Rahimi', email: 'hassan.rahimi@meridian-shipbuilding.com', role: 'EDITOR', title: 'Manager Repair Planning', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lena = { id: demoId('person-lena'), orgIds: [orgRepair.id], accessibleOrgIds: [orgRepair.id], name: 'Lena Fischer', email: 'lena.fischer@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Planner / Estimator', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const ravi = { id: demoId('person-ravi'), orgIds: [orgMIT.id], accessibleOrgIds: [orgMIT.id], name: 'Ravi Chandra', email: 'ravi.chandra@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const meghan = { id: demoId('person-meghan'), orgIds: [orgMIT.id], accessibleOrgIds: [orgMIT.id], name: "Meghan O'Connell", email: 'meghan.oconnell@meridian-shipbuilding.com', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const anders = { id: demoId('person-anders'), orgIds: [orgMIT.id], accessibleOrgIds: [orgMIT.id], name: 'Anders Holm', email: 'anders.holm@meridian-shipbuilding.com', role: 'EDITOR', title: 'Manager OT / ICS Cybersecurity', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gabriela = { id: demoId('person-gabriela'), orgIds: [orgQuality.id], accessibleOrgIds: [orgQuality.id], name: 'Gabriela Souza', email: 'gabriela.souza@meridian-shipbuilding.com', role: 'EDITOR', title: 'Director Quality & Compliance', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const warrick = { id: demoId('person-warrick'), orgIds: [orgQuality.id], accessibleOrgIds: [orgQuality.id], name: 'Warrick Blythe', email: 'warrick.blythe@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'Data Steward Compliance Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const chenwei = { id: demoId('person-chen-wei'), orgIds: [orgQuality.id], accessibleOrgIds: [orgQuality.id], name: 'Chen Wei', email: 'chen.wei@meridian-shipbuilding.com', role: 'CONTRIBUTOR', title: 'QA / QC Inspector Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const isadora = { id: demoId('person-isadora'), orgIds: [orgQuality.id], accessibleOrgIds: [orgQuality.id], name: 'Isadora Klein', email: 'isadora.klein@meridian-shipbuilding.com', role: 'EDITOR', title: 'Manager Naval Regulatory Affairs', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const felix = { id: demoId('person-felix'), orgIds: [orgQuality.id], accessibleOrgIds: [orgQuality.id], name: 'Felix Osborne', email: 'felix.osborne@meridian-shipbuilding.com', role: 'EDITOR', title: 'Manager Non-Destructive Testing', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [elena, priyanka, grant, tomas, bianca, dmitri, aaliyah, corentin, noor, yusuf, marco, reggie, yuki, sofiam, hassan, lena, ravi, meghan, anders, gabriela, warrick, chenwei, isadora, felix]);

  // ── Systems (8) — PLM / ERP / MES / EAM / QMS / warehouse + OT ──
  const sysPLM = { id: demoId('sys-plm'), orgId: orgMeridian.id, name: 'PLM', description: 'Product Lifecycle Management — 3D product model, drawings, engineering BOM.', systemType: 'IT', vendorName: 'Siemens Teamcenter', ownerPersonId: ravi.id, stewardIds: [dmitri.id], createdAt: ts, updatedAt: ts };
  const sysERP = { id: demoId('sys-erp'), orgId: orgMeridian.id, name: 'ERP', description: 'Enterprise Resource Planning — materials, procurement, work orders, finance.', systemType: 'IT', vendorName: 'SAP S/4HANA', ownerPersonId: grant.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysMES = { id: demoId('sys-mes'), orgId: orgNewCon.id, name: 'MES', description: 'Manufacturing Execution System — shop-floor work order status, nesting, throughput.', systemType: 'OT', vendorName: 'Dassault Apriso', ownerPersonId: corentin.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysEAM = { id: demoId('sys-eam'), orgId: orgMeridian.id, name: 'EAM', description: 'Enterprise Asset Management — cranes, dry docks, yard equipment maintenance.', systemType: 'IT', vendorName: 'IBM Maximo', ownerPersonId: reggie.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysQMS = { id: demoId('sys-qms'), orgId: orgMeridian.id, name: 'QMS', description: 'Quality Management System — inspections, nonconformance reports, certifications.', systemType: 'IT', vendorName: 'ETQ Reliance', ownerPersonId: gabriela.id, stewardIds: [warrick.id], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgMeridian.id, name: 'Data Warehouse', description: 'Enterprise analytics warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: ravi.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysWeldHist = { id: demoId('sys-weldhist'), orgId: orgNewCon.id, name: 'Weld Historian', description: 'Weld data historian — machine parameters (amperage, voltage, travel speed) per weld.', systemType: 'OT', vendorName: 'AVEVA PI', ownerPersonId: anders.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysNDT = { id: demoId('sys-ndt'), orgId: orgQuality.id, name: 'NDT Imaging', description: 'Non-destructive testing — digital radiography + ultrasonic weld inspection images.', systemType: 'OT', vendorName: 'GE Waygate', ownerPersonId: felix.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysPLM, sysERP, sysMES, sysEAM, sysQMS, sysWarehouse, sysWeldHist, sysNDT]);

  // ── Agents (5 — one of each type) ──
  await createAll(repos.agents, [
    { id: demoId('agent-weld-model'), orgIds: [orgNewCon.id], name: 'Weld Defect Prediction Model', agentType: 'AI', description: 'Predicts weld defect probability from machine telemetry and radiography.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: meghan.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-mat-pipeline'), orgIds: [orgMeridian.id], name: 'Material Receipts Ingestion Pipeline', agentType: 'PIPELINE', description: 'Nightly ETL of ERP goods-receipt and inventory data into the warehouse.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: ravi.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-schedule-bot'), orgIds: [orgMeridian.id], name: 'Production Schedule Alert Bot', agentType: 'BOT', description: 'Alerts planners to schedule slips and block-erection blockers.', provider: 'Slack', status: 'ACTIVE', ownerPersonId: hassan.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-hist-service'), orgIds: [orgNewCon.id], name: 'Weld Historian Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract weld historian tags.', provider: 'AVEVA', status: 'ACTIVE', ownerPersonId: anders.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-cert-gen'), orgIds: [orgMeridian.id], name: 'Naval Cert Package Generator', agentType: 'OTHER', description: 'Scheduled generator producing ABS + Naval certification evidence packages.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: isadora.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains (3) ──
  const domDesign = { id: demoId('domain-design'), code: 'ENG', orgId: orgMeridian.id, name: 'Design & Engineering Data', description: '3D product models, drawings, engineering BOMs, change orders.', ownerId: elena.id, stewardIds: [dmitri.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domProduction = { id: demoId('domain-production'), code: 'PROD', orgId: orgMeridian.id, name: 'Production Data', description: 'Work orders, material receipts, weld telemetry — the shop-floor operational feeds.', ownerId: grant.id, stewardIds: [noor.id, aaliyah.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domQuality = { id: demoId('domain-quality'), code: 'QLT', orgId: orgMeridian.id, name: 'Quality & Compliance Data', description: 'Inspection records, nonconformance reports, certification evidence (ABS / Naval / OSHA).', ownerId: gabriela.id, stewardIds: [warrick.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Sub-domains under Production Data — mirrors the canonical shipbuilder model
  // (Manufacturing → Welding / Fabrication / Assembly). Parent created first.
  const domProdWelding = { id: demoId('domain-prod-welding'), code: 'PROD-01', orgId: orgMeridian.id, name: 'Welding', description: 'Weld records, procedure specs (WPS), and weld sensor telemetry from the shop floor.', ownerId: grant.id, stewardIds: [noor.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domProduction.id, createdAt: ts, updatedAt: ts };
  const domProdFab = { id: demoId('domain-prod-fab'), code: 'PROD-02', orgId: orgMeridian.id, name: 'Fabrication', description: 'Cut lists, plate and structural fabrication records, and material receipts.', ownerId: grant.id, stewardIds: [aaliyah.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domProduction.id, createdAt: ts, updatedAt: ts };
  const domProdAssembly = { id: demoId('domain-prod-assembly'), code: 'PROD-03', orgId: orgMeridian.id, name: 'Assembly & Outfitting', description: 'Module assembly, outfitting work packages, and unit erection sequencing.', ownerId: grant.id, stewardIds: [noor.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domProduction.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domDesign, domProduction, domQuality, domProdWelding, domProdFab, domProdAssembly]);

  // ── Data Assets (9) ──
  const assetProductModel = { id: demoId('asset-product-model'), orgId: orgMeridian.id, name: '3D Product Model', description: 'The master 3D CAD product model and released drawings.', systemId: sysPLM.id, owner: '', ownerPersonId: dmitri.id, stewardIds: [] as string[], governanceTier: 'GOLD' as const, healthScore: 90, createdAt: ts, updatedAt: ts };
  const assetBOM = { id: demoId('asset-bom'), orgId: orgMeridian.id, name: 'Bill of Materials', description: 'Engineering + manufacturing BOM — parts, quantities, cut lists.', systemId: sysPLM.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 86, createdAt: ts, updatedAt: ts };
  const assetWeldRecords = { id: demoId('asset-weld-records'), orgId: orgMeridian.id, name: 'Weld Inspection Records', description: 'Per-weld visual + NDT inspection results and weld maps.', systemId: sysQMS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 58, createdAt: ts, updatedAt: ts };
  const assetWorkOrders = { id: demoId('asset-work-orders'), orgId: orgNewCon.id, name: 'Work Order Status', description: 'Shop-floor work order state — planned, in-progress, complete by block.', systemId: sysMES.id, owner: '', ownerPersonId: corentin.id, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, createdAt: ts, updatedAt: ts };
  const assetMaterialReceipts = { id: demoId('asset-material-receipts'), orgId: orgMeridian.id, name: 'Material Receipts', description: 'ERP goods-receipt records — steel plate, pipe, valves, outfitting materials.', systemId: sysERP.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 88, createdAt: ts, updatedAt: ts };
  const assetNCR = { id: demoId('asset-ncr'), orgId: orgMeridian.id, name: 'Nonconformance Reports', description: 'Quality NCRs and their dispositions — the compliance evidence trail for ABS / Naval audits.', systemId: sysQMS.id, owner: '', ownerPersonId: gabriela.id, stewardIds: [warrick.id] as string[], governanceTier: 'GOLD' as const, healthScore: 92, createdAt: ts, updatedAt: ts };
  const assetWeldTelemetry = { id: demoId('asset-weld-telemetry'), orgId: orgNewCon.id, name: 'Weld Machine Telemetry', description: 'Historian tags — amperage, voltage, travel speed, heat input per weld pass.', systemId: sysWeldHist.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 80, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's orphan-detection
  // returns a quotable answer.
  const orphanLegacyDrawings = { id: demoId('asset-legacy-drawings'), orgId: orgMeridian.id, name: 'Legacy Drawing Extract', description: 'Nightly dump from the retired 2D drawing system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanNestingCsv = { id: demoId('asset-nesting-csv'), orgId: orgMeridian.id, name: 'Nesting CSV Dump', description: 'Ad-hoc CSV extract of cutting-table nest results for an old vendor. Nobody remembers if it is still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetProductModel, assetBOM, assetWeldRecords, assetWorkOrders, assetMaterialReceipts, assetNCR, assetWeldTelemetry, orphanLegacyDrawings, orphanNestingCsv]);

  // Domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domDesign.id, { dataAssetIds: [assetProductModel.id, assetBOM.id] });
  await repos.dataDomains.update(domProduction.id, { dataAssetIds: [assetWorkOrders.id, assetMaterialReceipts.id, assetWeldTelemetry.id] });
  await repos.dataDomains.update(domQuality.id, { dataAssetIds: [assetWeldRecords.id, assetNCR.id] });

  // ── Process hierarchy — VS1 Ship Construction (New Construction) ──
  const vsShip = { id: demoId('node-vs-ship'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Ship Construction', description: 'End-to-end new-build flow — fabricate blocks, erect, outfit, deliver.', activityId: 'VS-DEMO-S1', status: 'ACTIVE', orderIndex: 0, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: tomas.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procBlock = { id: demoId('node-proc-block'), parentId: vsShip.id, level: 'PROCESS' as const, name: 'Block Fabrication', description: 'Cut, weld, and assemble hull blocks from steel plate.', activityId: 'PRO-DEMO-S1', status: 'ACTIVE', orderIndex: 0, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: tomas.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procErect = { id: demoId('node-proc-erect'), parentId: vsShip.id, level: 'PROCESS' as const, name: 'Erection & Outfitting', description: 'Erect blocks on the ways and install outfitting.', activityId: 'PRO-DEMO-S2', status: 'ACTIVE', orderIndex: 1, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: corentin.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spPanel = { id: demoId('node-sp-panel'), parentId: procBlock.id, level: 'SUBPROCESS' as const, name: 'Panel Line', description: 'Automated panel fabrication — nest, cut, and weld flat panels.', activityId: 'SP-DEMO-S1', status: 'ACTIVE', orderIndex: 0, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: bianca.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actNest = { id: demoId('node-act-nest'), parentId: spPanel.id, level: 'ACTIVITY' as const, name: 'Nest & cut steel', description: 'Nest parts onto plate and cut on the burning table per the BOM cut list.', activityId: 'ACT-DEMO-S1', status: 'ACTIVE', orderIndex: 0, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: bianca.id, responsibleRole: 'Steel Fabrication Superintendent', responsiblePersonId: aaliyah.id, systemIds: [sysMES.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actWeld = { id: demoId('node-act-weld'), parentId: spPanel.id, level: 'ACTIVITY' as const, name: 'Weld panel', description: 'Weld the nested parts into a finished panel; log weld parameters and inspection.', activityId: 'ACT-DEMO-S2', status: 'ACTIVE', orderIndex: 1, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: bianca.id, responsibleRole: 'Welding Engineering Lead', responsiblePersonId: bianca.id, systemIds: [sysWeldHist.id, sysMES.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'First-pass weld yield ≥ 98% on Tier 1 joints\n\nP95 rework rate under 2%', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actErect = { id: demoId('node-act-erect'), parentId: procErect.id, level: 'ACTIVITY' as const, name: 'Erect block', description: 'Lift and land the finished block onto the building ways in sequence.', activityId: 'ACT-DEMO-S3', status: 'ACTIVE', orderIndex: 0, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: corentin.id, responsibleRole: 'Manager Outfitting & Assembly', responsiblePersonId: corentin.id, systemIds: [sysEAM.id, sysMES.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actOutfit = { id: demoId('node-act-outfit'), parentId: procErect.id, level: 'ACTIVITY' as const, name: 'Install outfitting', description: 'Install pipe, HVAC, cabling, and equipment per the 3D product model.', activityId: 'ACT-DEMO-S4', status: 'ACTIVE', orderIndex: 1, orgId: orgNewCon.id, orgIds: [orgNewCon.id], ownerId: corentin.id, responsibleRole: 'Pipefitting Superintendent', responsiblePersonId: yusuf.id, systemIds: [sysPLM.id], requiredSkillIds: [] as string[], version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsShip, procBlock, procErect, spPanel, actNest, actWeld, actErect, actOutfit]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-s1'), fromNodeId: actNest.id, toNodeId: actWeld.id, type: 'SEQUENCE' as const, label: 'parts cut', createdAt: ts },
    { id: demoId('flow-s2'), fromNodeId: actWeld.id, toNodeId: actErect.id, type: 'SEQUENCE' as const, label: 'panel welded', createdAt: ts },
    { id: demoId('flow-s3'), fromNodeId: actErect.id, toNodeId: actOutfit.id, type: 'SEQUENCE' as const, label: 'block erected', createdAt: ts },
  ]);

  // ── Process hierarchy — VS2 Fleet Sustainment ──
  const vsSustain = { id: demoId('node-vs-sustain'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Fleet Sustainment', description: 'Dock, survey, repair, and re-certify vessels during sustainment availabilities.', activityId: 'VS-DEMO-S2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSustain.id, orgIds: [orgSustain.id], ownerId: marco.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procAvail = { id: demoId('node-proc-avail'), parentId: vsSustain.id, level: 'PROCESS' as const, name: 'Dry Dock Availability', description: 'Bring a vessel into dock, survey condition, and execute the repair package.', activityId: 'PRO-DEMO-S3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSustain.id, orgIds: [orgSustain.id], ownerId: reggie.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procQA = { id: demoId('node-proc-qa'), parentId: vsSustain.id, level: 'PROCESS' as const, name: 'Quality Assurance & Test', description: 'Inspect, test, and re-certify repaired structure before undocking.', activityId: 'PRO-DEMO-S4', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgSustain.id, orgIds: [orgSustain.id], ownerId: gabriela.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spDocking = { id: demoId('node-sp-docking'), parentId: procAvail.id, level: 'SUBPROCESS' as const, name: 'Docking Prep', description: 'Survey the docked vessel and scope the repair package.', activityId: 'SP-DEMO-S2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSustain.id, orgIds: [orgSustain.id], ownerId: reggie.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actSurvey = { id: demoId('node-act-survey'), parentId: spDocking.id, level: 'ACTIVITY' as const, name: 'Hull condition survey', description: 'Ultrasonic thickness + visual survey of the docked hull; log defects.', activityId: 'ACT-DEMO-S5', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSustain.id, orgIds: [orgSustain.id], ownerId: reggie.id, responsibleRole: 'Dock Master', responsiblePersonId: yuki.id, systemIds: [sysNDT.id, sysEAM.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 6, successMeasure: 'Survey package complete within 48 hours of docking', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actRepairDispatch = { id: demoId('node-act-repair-dispatch'), parentId: procAvail.id, level: 'ACTIVITY' as const, name: 'Dispatch repair team', description: 'Match trade crews and materials to the scoped repair package.', activityId: 'ACT-DEMO-S6', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSustain.id, orgIds: [orgSustain.id], ownerId: hassan.id, responsibleRole: 'Manager Repair Planning', responsiblePersonId: hassan.id, systemIds: [sysERP.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actWeldQA = { id: demoId('node-act-weld-qa'), parentId: procQA.id, level: 'ACTIVITY' as const, name: 'Weld QA & radiography sign-off', description: 'Radiograph the repair welds and sign off or raise an NCR.', activityId: 'ACT-DEMO-S7', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSustain.id, orgIds: [orgSustain.id], ownerId: gabriela.id, responsibleRole: 'QA / QC Inspector Lead', responsiblePersonId: chenwei.id, systemIds: [sysNDT.id, sysQMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Every repair weld radiographed and dispositioned before undock', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsSustain, procAvail, procQA, spDocking, actSurvey, actRepairDispatch, actWeldQA]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-s4'), fromNodeId: actSurvey.id, toNodeId: actRepairDispatch.id, type: 'SEQUENCE' as const, label: 'defects scoped', createdAt: ts },
  ]);

  // ── Mappings (7) ──
  await createAll(repos.mappings, [
    { id: demoId('map-s1'), orgId: orgNewCon.id, processStepId: actNest.id, dataAssetId: assetBOM.id, linkType: 'INPUT', notes: 'Consumes the BOM cut list', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-s2'), orgId: orgNewCon.id, processStepId: actWeld.id, dataAssetId: assetWeldTelemetry.id, linkType: 'INPUT', notes: 'Reads weld machine parameters from the historian', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-s3'), orgId: orgNewCon.id, processStepId: actWeld.id, dataAssetId: assetWeldRecords.id, linkType: 'OUTPUT', notes: 'Writes the per-weld inspection record', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-s4'), orgId: orgNewCon.id, processStepId: actErect.id, dataAssetId: assetWorkOrders.id, linkType: 'INPUT', notes: 'Checks block readiness via work order status', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-s5'), orgId: orgNewCon.id, processStepId: actOutfit.id, dataAssetId: assetProductModel.id, linkType: 'INPUT', notes: 'Installs outfitting per the 3D product model', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-s6'), orgId: orgSustain.id, processStepId: actSurvey.id, dataAssetId: assetNCR.id, linkType: 'INPUT', notes: 'Reviews prior nonconformance reports for the vessel', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-s7'), orgId: orgSustain.id, processStepId: actWeldQA.id, dataAssetId: assetNCR.id, linkType: 'OUTPUT', notes: 'Raises NCRs on failed radiography', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Elena (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-s1'), orgId: orgMeridian.id, title: 'Approve weld records classification review', description: 'Review the AI-suggested sensitivity tags on Weld Inspection Records and Nonconformance Reports and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: elena.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetWeldRecords.id, automationMode: 'HUMAN' as any, createdBy: priyanka.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-s2'), orgId: orgMeridian.id, title: 'Sign off on Quality & Compliance domain scope', description: 'Gabriela has proposed expanding the Quality & Compliance domain to cover new ABS survey evidence fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: elena.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domQuality.id, automationMode: 'HUMAN' as any, createdBy: gabriela.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-s3'), orgId: orgMeridian.id, title: 'Retire Legacy Drawing Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: elena.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyDrawings.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Elena ──
  await repos.governanceIssues.create({
    id: demoId('issue-s1'),
    orgId: orgMeridian.id,
    title: 'Weld Inspection Records tier below Silver — critical process, ungoverned',
    description: 'Weld Inspection Records is BRONZE tier but the Block Fabrication process writes it as the primary weld-quality evidence. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domQuality.id,
    dataAssetId: assetWeldRecords.id,
    systemId: sysQMS.id,
    reportedBy: priyanka.id,
    assignedTo: elena.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules (2 — one passing, one failing) ──
  await createAll(repos.dataQualityRules, [
    {
      id: demoId('dq-rule-passing'), orgId: orgMeridian.id, dataAssetId: assetBOM.id,
      dimension: 'COMPLETENESS' as const, name: 'Bill of Materials · part-number completeness',
      description: 'At least 95% of BOM lines must carry a resolved part number.',
      threshold: 95, currentScore: 97, weight: 1, status: 'PASSING' as const,
      lastMeasured: ts, scheduleFrequency: 'DAILY' as const, nextRunAt: daysFromNow(1), createdAt: ts, updatedAt: ts,
    },
    {
      id: demoId('dq-rule-failing'), orgId: orgMeridian.id, dataAssetId: assetWeldRecords.id,
      dimension: 'TIMELINESS' as const, name: 'Weld Inspection Records · submission latency',
      description: 'Weld inspection results should be logged within 4 hours of the weld. Rolling 24h.',
      threshold: 95, currentScore: 58, weight: 1, status: 'FAILING' as const,
      lastMeasured: ts, scheduleFrequency: 'HOURLY' as const, nextRunAt: daysFromNow(0), createdAt: ts, updatedAt: ts,
    },
  ]);

  // ── Edge connector (ONLINE) ──
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-meridian'), orgId: orgMeridian.id, name: 'Meridian Yard Data Connector',
    tokenHash: '5f6d3c4f26f9c50a9c1a5a2f70c3f7f4a0b3d3c8b3f7d9c3a1e2f5b6c9d0e1f2',
    pairingCode: null, pairingCodeExpiresAt: null,
    systemIds: [sysMES.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt, agentVersion: '1.2.0', status: 'ONLINE' as const,
    createdAt: connectorCreatedAt, updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  await repos.dataAssets.update(assetWorkOrders.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  await createAll(repos.connectorEvents, [
    { id: demoId('ce-s-paired'), connectorId: conn.id, orgId: orgMeridian.id, type: 'PAIRED', ts: connectorCreatedAt, data: { agentVersion: '1.2.0' } },
    { id: demoId('ce-s-scan-start'), connectorId: conn.id, orgId: orgMeridian.id, type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: { targetSystemIds: [sysMES.id, sysWarehouse.id] } },
    { id: demoId('ce-s-scan-done'), connectorId: conn.id, orgId: orgMeridian.id, type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(), data: { durationMs: 40_120, assetsDiscovered: 1 } },
    { id: demoId('ce-s-assets'), connectorId: conn.id, orgId: orgMeridian.id, type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(), data: { incoming: 1, created: 0, updated: 1 } },
    { id: demoId('ce-s-hb'), connectorId: conn.id, orgId: orgMeridian.id, type: 'HEARTBEAT', ts: connectorHeartbeatAt, data: { agentVersion: '1.2.0' } },
  ]);

  // ── Second connector — PAIRING state ──
  const pairingConn = {
    id: demoId('conn-s-pairing'), orgId: orgMeridian.id, name: 'NDT Lab Connector',
    tokenHash: null, pairingCode: '48610273',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[], lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-s-dgc'),
    orgId: orgMeridian.id,
    name: 'Data Governance Council weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [elena.id, priyanka.id, grant.id, gabriela.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgMeridian.id, { coverage: 62, avgHealth: 70, gaps: 8, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgNewCon.id, { coverage: 70, avgHealth: 72, gaps: 4, dataAssets: 4, mappings: 5 }),
    ...weeklySnapshots(orgSustain.id, { coverage: 66, avgHealth: 74, gaps: 3, dataAssets: 2, mappings: 2 }),
    ...weeklySnapshots(orgMShared.id, { coverage: 45, avgHealth: 76, gaps: 3, dataAssets: 0, mappings: 0 }),
  ]);

  // ── AI template cache — pre-warm the wand for Meridian ──
  aiTemplateCache.push(
    {
      industry: 'defense & shipbuilding|ship construction',
      industryLabel: 'Defense & Shipbuilding — Ship Construction',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Ship Construction',
            description: 'Fabricate blocks, erect them, and outfit the vessel through delivery.',
            purpose: 'Build the vessel to spec, on schedule, at the required quality.',
            businessOutcome: 'On-time delivery with defensible weld quality and a clean survey record.',
            processes: [
              { name: 'Block Fabrication', description: 'Cut, weld, and assemble hull blocks from steel plate.', purpose: 'Turn raw plate into erection-ready blocks.', activities: [
                { name: 'Nest & cut steel', description: 'Nest parts onto plate and cut on the burning table per the BOM.' },
                { name: 'Weld panel', description: 'Weld nested parts into panels and log weld parameters.' },
                { name: 'Assemble block', description: 'Join panels and stiffeners into a finished block.' },
              ] },
              { name: 'Erection & Outfitting', description: 'Erect blocks and install ship systems.', purpose: 'Assemble the hull and make it a working ship.', activities: [
                { name: 'Erect block', description: 'Lift and land blocks onto the ways in sequence.' },
                { name: 'Install outfitting', description: 'Install pipe, HVAC, cabling, and equipment per the 3D model.' },
                { name: 'Compartment turnover', description: 'Inspect and hand a completed compartment to test.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'defense & shipbuilding|fleet sustainment',
      industryLabel: 'Defense & Shipbuilding — Fleet Sustainment',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Fleet Sustainment',
            description: 'Dock, survey, repair, and re-certify vessels during availabilities.',
            purpose: 'Return the vessel to service safely and on schedule.',
            businessOutcome: 'Availability completed to cost and schedule with a certified repair record.',
            processes: [
              { name: 'Dry Dock Availability', description: 'Dock the vessel, survey it, and execute the repair package.', purpose: 'Scope and complete the repair work.', activities: [
                { name: 'Hull condition survey', description: 'Ultrasonic + visual survey of the docked hull; log defects.' },
                { name: 'Dispatch repair team', description: 'Match trade crews and materials to the scoped package.' },
              ] },
              { name: 'Quality Assurance & Test', description: 'Inspect, test, and re-certify before undocking.', purpose: 'Prove the repair meets class + naval standards.', activities: [
                { name: 'Weld QA & radiography sign-off', description: 'Radiograph repair welds and disposition or raise an NCR.' },
                { name: 'Re-certify vessel', description: 'Assemble the certification evidence package for class survey.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgMeridian.id,
    cdoId: elena.id,
    govLeadId: priyanka.id,
    dataOwnerId: grant.id,
    stewardIds: [dmitri.id, warrick.id],
    tenantName: 'Meridian Shipbuilding',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgMeridian.id,
    domainIds: [domDesign.id, domProduction.id, domQuality.id],
    cdoId: elena.id,
    govLeadId: priyanka.id,
    dataOwnerId: grant.id,
    stewardId: dmitri.id,
    techStewardId: warrick.id,
    engineerId: ravi.id,
    architectId: meghan.id,
    raciNodeId: actWeld.id,
    raciPersonId: chenwei.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgMeridian.id, ownerId: dmitri.id, cdoId: elena.id, domainId: domDesign.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgMeridian.id, orgNewCon.id, orgSustain.id],
    links: [
      { id: demoId('lin-1'), orgId: orgMeridian.id, sourceSystemId: sysERP.id, targetSystemId: sysWarehouse.id, dataAssetId: assetMaterialReceipts.id, description: 'ERP goods receipts sync nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-2'), orgId: orgNewCon.id, sourceSystemId: sysMES.id, targetSystemId: sysWarehouse.id, dataAssetId: assetWorkOrders.id, description: 'Shop-floor work order status feeds the warehouse.', flowType: 'ETL', frequency: 'HOURLY' },
      { id: demoId('lin-3'), orgId: orgNewCon.id, sourceSystemId: sysWeldHist.id, targetSystemId: sysWarehouse.id, dataAssetId: assetWeldTelemetry.id, description: 'Weld historian tags stream into the warehouse.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgMeridian.id, sourceAssetId: assetProductModel.id, targetAssetId: assetBOM.id },
      { id: demoId('edge-2'), orgId: orgNewCon.id, sourceAssetId: assetWeldTelemetry.id, targetAssetId: assetWeldRecords.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgMeridian.id, agentId: demoId('agent-cert-gen'), agentName: 'Naval Cert Package Generator', activityId: actWeldQA.id, activityName: 'Weld QA & radiography sign-off', roleType: 'TECHNICAL_DATA_STEWARD', createdBy: elena.id, reviewerId: priyanka.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgMeridian.id, assetId: assetProductModel.id, systemId: sysPLM.id, personId: dmitri.id, personName: 'Dmitri Volkov' });

  logger.info({ persona: elena.name }, 'Demo data seeded (shipbuilding)');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: elena.id, name: elena.name },
  };
}

/**
 * Healthcare profile — a Cedarline Health integrated delivery network
 * (acute care + ambulatory + shared services), persona Dr. Naomi Okafor (CDO).
 * Same shape and counts as the other profiles.
 */
async function seedHealthcare(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {
  // ── Organizations (company → 3 divisions → 6 departments) ──
  const orgCedarline = { id: demoId('org-cedarline'), parentId: null, name: 'Cedarline Health', type: 'company', industry: 'Healthcare', description: 'Integrated delivery network demo tenant — acute care + ambulatory + shared services.', headCount: 0, tenantSlug: 'cedarline', brandDisplayName: 'Cedarline Health', brandGlyph: '✚', ssoButtonLabel: 'Sign in with Cedarline SSO', brandPrimaryColor: '#0f766e', createdAt: ts, updatedAt: ts };
  const orgAcute = { id: demoId('org-acute'), parentId: orgCedarline.id, name: 'Acute Care', type: 'division', industry: 'Healthcare', description: 'Inpatient hospitals, emergency, and diagnostics', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgAmbulatory = { id: demoId('org-ambulatory'), parentId: orgCedarline.id, name: 'Ambulatory', type: 'division', industry: 'Healthcare', description: 'Clinics, population health, and revenue cycle', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgHShared = { id: demoId('org-hshared'), parentId: orgCedarline.id, name: 'Shared Services', type: 'division', industry: 'Healthcare', description: 'IT / Compliance & Privacy', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgClinInfo = { id: demoId('org-clininfo'), parentId: orgAcute.id, name: 'Clinical Informatics', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgHIM = { id: demoId('org-him'), parentId: orgAcute.id, name: 'Health Information Management', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgPopHealth = { id: demoId('org-pophealth'), parentId: orgAmbulatory.id, name: 'Population Health', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgRevCycle = { id: demoId('org-revcycle'), parentId: orgAmbulatory.id, name: 'Revenue Cycle', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgHIT = { id: demoId('org-hit'), parentId: orgHShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgCompliance = { id: demoId('org-compliance'), parentId: orgHShared.id, name: 'Compliance & Privacy', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgCedarline, orgAcute, orgAmbulatory, orgHShared, orgClinInfo, orgHIM, orgPopHealth, orgRevCycle, orgHIT, orgCompliance]);

  // ── People (24) — persona Dr. Naomi Okafor (CDO) ──
  const naomi = { id: demoId('person-naomi-okafor'), orgIds: [orgCedarline.id], accessibleOrgIds: [orgCedarline.id, orgAcute.id, orgAmbulatory.id, orgHShared.id, orgClinInfo.id, orgHIM.id, orgPopHealth.id, orgRevCycle.id, orgHIT.id, orgCompliance.id], name: 'Dr. Naomi Okafor', email: 'naomi.okafor@cedarline-health.org', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const raj = { id: demoId('person-raj'), orgIds: [orgCedarline.id], accessibleOrgIds: [orgCedarline.id], name: 'Raj Malhotra', email: 'raj.malhotra@cedarline-health.org', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const pierce = { id: demoId('person-pierce'), orgIds: [orgAcute.id], accessibleOrgIds: [orgAcute.id], name: 'Dr. Alan Pierce', email: 'alan.pierce@cedarline-health.org', role: 'ORG_ADMIN', title: 'Data Owner Acute Care', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sofia = { id: demoId('person-sofia-a'), orgIds: [orgClinInfo.id], accessibleOrgIds: [orgClinInfo.id, orgAcute.id], name: 'Dr. Sofia Alvarez', email: 'sofia.alvarez@cedarline-health.org', role: 'EDITOR', title: 'Director Clinical Informatics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kelly = { id: demoId('person-kelly'), orgIds: [orgClinInfo.id], accessibleOrgIds: [orgClinInfo.id], name: 'Kelly Nguyen', email: 'kelly.nguyen@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Clinical Data Steward', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const marcus = { id: demoId('person-marcus-b'), orgIds: [orgClinInfo.id], accessibleOrgIds: [orgClinInfo.id], name: 'Marcus Bell', email: 'marcus.bell@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Nursing Informatics Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const deepa = { id: demoId('person-deepa'), orgIds: [orgClinInfo.id], accessibleOrgIds: [orgClinInfo.id], name: 'Deepa Iyer', email: 'deepa.iyer@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Data Steward Encounters', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const tanya = { id: demoId('person-tanya'), orgIds: [orgHIM.id], accessibleOrgIds: [orgHIM.id], name: 'Tanya Brooks', email: 'tanya.brooks@cedarline-health.org', role: 'EDITOR', title: 'Manager Health Information Management', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const victor = { id: demoId('person-victor'), orgIds: [orgHIM.id], accessibleOrgIds: [orgHIM.id], name: 'Victor Sole', email: 'victor.sole@cedarline-health.org', role: 'CONTRIBUTOR', title: 'HIM Coding Steward', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const graceh = { id: demoId('person-grace-h'), orgIds: [orgHIM.id], accessibleOrgIds: [orgHIM.id], name: 'Grace Kim', email: 'grace.kim@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Release-of-Information Specialist', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const omar = { id: demoId('person-omar-h'), orgIds: [orgAmbulatory.id], accessibleOrgIds: [orgAmbulatory.id], name: 'Dr. Omar Haddad', email: 'omar.haddad@cedarline-health.org', role: 'ORG_ADMIN', title: 'Data Owner Ambulatory', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const priya = { id: demoId('person-priya-n'), orgIds: [orgPopHealth.id], accessibleOrgIds: [orgPopHealth.id, orgAmbulatory.id], name: 'Priya Nair', email: 'priya.nair@cedarline-health.org', role: 'EDITOR', title: 'Director Population Health', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const leo = { id: demoId('person-leo'), orgIds: [orgPopHealth.id], accessibleOrgIds: [orgPopHealth.id], name: 'Leo Fontaine', email: 'leo.fontaine@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Population Health Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const hana = { id: demoId('person-hana'), orgIds: [orgPopHealth.id], accessibleOrgIds: [orgPopHealth.id], name: 'Hana Suzuki', email: 'hana.suzuki@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Data Steward Population Health', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const denise = { id: demoId('person-denise'), orgIds: [orgRevCycle.id], accessibleOrgIds: [orgRevCycle.id, orgAmbulatory.id], name: 'Denise Carter', email: 'denise.carter@cedarline-health.org', role: 'EDITOR', title: 'Manager Revenue Cycle', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const ahmed = { id: demoId('person-ahmed'), orgIds: [orgRevCycle.id], accessibleOrgIds: [orgRevCycle.id], name: 'Ahmed Farouk', email: 'ahmed.farouk@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Charge Integrity Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const biancar = { id: demoId('person-bianca-r'), orgIds: [orgRevCycle.id], accessibleOrgIds: [orgRevCycle.id], name: 'Bianca Rossi', email: 'bianca.rossi@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Data Steward Revenue Cycle', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const ravih = { id: demoId('person-ravi-h'), orgIds: [orgHIT.id], accessibleOrgIds: [orgHIT.id], name: 'Ravi Sharma', email: 'ravi.sharma@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const meghanh = { id: demoId('person-meghan-h'), orgIds: [orgHIT.id], accessibleOrgIds: [orgHIT.id], name: 'Meghan Doyle', email: 'meghan.doyle@cedarline-health.org', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const nina = { id: demoId('person-nina'), orgIds: [orgHIT.id], accessibleOrgIds: [orgHIT.id], name: 'Nina Petrov', email: 'nina.petrov@cedarline-health.org', role: 'EDITOR', title: 'Manager Healthcare Cybersecurity', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gabrielm = { id: demoId('person-gabriel-m'), orgIds: [orgCompliance.id], accessibleOrgIds: [orgCompliance.id], name: 'Gabriel Mendes', email: 'gabriel.mendes@cedarline-health.org', role: 'EDITOR', title: 'Chief Compliance & Privacy Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const wendy = { id: demoId('person-wendy'), orgIds: [orgCompliance.id], accessibleOrgIds: [orgCompliance.id], name: 'Wendy Cho', email: 'wendy.cho@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Data Steward Compliance Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const chenli = { id: demoId('person-chen-li'), orgIds: [orgCompliance.id], accessibleOrgIds: [orgCompliance.id], name: 'Dr. Chen Li', email: 'chen.li@cedarline-health.org', role: 'CONTRIBUTOR', title: 'Physician Advisor / Quality', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const isabel = { id: demoId('person-isabel'), orgIds: [orgCompliance.id], accessibleOrgIds: [orgCompliance.id], name: 'Isabel Ortiz', email: 'isabel.ortiz@cedarline-health.org', role: 'EDITOR', title: 'Manager Regulatory Reporting (CMS / eCQM)', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [naomi, raj, pierce, sofia, kelly, marcus, deepa, tanya, victor, graceh, omar, priya, leo, hana, denise, ahmed, biancar, ravih, meghanh, nina, gabrielm, wendy, chenli, isabel]);

  // ── Systems (8) — EHR / Revenue Cycle / LIS / PACS / warehouse + clinical OT ──
  const sysEHR = { id: demoId('sys-ehr'), orgId: orgCedarline.id, name: 'EHR', description: 'Electronic Health Record — encounters, orders, notes, results, medications.', systemType: 'IT', vendorName: 'Epic', ownerPersonId: ravih.id, stewardIds: [kelly.id], createdAt: ts, updatedAt: ts };
  const sysRevCycle = { id: demoId('sys-revcycle'), orgId: orgCedarline.id, name: 'Revenue Cycle', description: 'Charge capture, coding, claims, and reimbursement.', systemType: 'IT', vendorName: 'Epic Resolute', ownerPersonId: denise.id, stewardIds: [biancar.id], createdAt: ts, updatedAt: ts };
  const sysLIS = { id: demoId('sys-lis'), orgId: orgAcute.id, name: 'Lab Information System', description: 'Laboratory orders, specimen tracking, and result reporting.', systemType: 'OT', vendorName: 'Sunquest', ownerPersonId: nina.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysPACS = { id: demoId('sys-pacs'), orgId: orgAcute.id, name: 'Imaging PACS', description: 'Picture archiving — radiology images and diagnostic reports.', systemType: 'OT', vendorName: 'GE Centricity', ownerPersonId: deepa.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgCedarline.id, name: 'Data Warehouse', description: 'Enterprise analytics warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: ravih.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysPharmacy = { id: demoId('sys-pharmacy'), orgId: orgCedarline.id, name: 'Pharmacy System', description: 'Medication orders, dispensing, and the automated dispensing cabinets.', systemType: 'IT', vendorName: 'Omnicell', ownerPersonId: marcus.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysTelemetry = { id: demoId('sys-telemetry'), orgId: orgAcute.id, name: 'Vitals Telemetry', description: 'Bedside patient monitoring — continuous vitals and waveform telemetry.', systemType: 'OT', vendorName: 'Philips IntelliVue', ownerPersonId: nina.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysRegistration = { id: demoId('sys-registration'), orgId: orgCedarline.id, name: 'Patient Registration (ADT)', description: 'Admit / discharge / transfer — registration, demographics, and eligibility.', systemType: 'IT', vendorName: 'Epic Grand Central', ownerPersonId: tanya.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysEHR, sysRevCycle, sysLIS, sysPACS, sysWarehouse, sysPharmacy, sysTelemetry, sysRegistration]);

  // ── Agents (5 — one of each type) ──
  await createAll(repos.agents, [
    { id: demoId('agent-sepsis-model'), orgIds: [orgAcute.id], name: 'Sepsis Risk Prediction Model', agentType: 'AI', description: 'Scores inpatient sepsis risk from vitals, labs, and nursing assessments.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: meghanh.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-claims-pipeline'), orgIds: [orgCedarline.id], name: 'Claims Ingestion Pipeline', agentType: 'PIPELINE', description: 'Nightly ETL of remittance and claim status data into the warehouse.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: ravih.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-bed-bot'), orgIds: [orgAcute.id], name: 'Bed Availability Alert Bot', agentType: 'BOT', description: 'Alerts bed management to capacity constraints and pending discharges.', provider: 'Microsoft Teams', status: 'ACTIVE', ownerPersonId: pierce.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-lis-service'), orgIds: [orgAcute.id], name: 'Lab Interface Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract lab result feeds.', provider: 'Sunquest', status: 'ACTIVE', ownerPersonId: nina.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-ecqm-gen'), orgIds: [orgCedarline.id], name: 'Quality Measure (eCQM) Report Generator', agentType: 'OTHER', description: 'Scheduled generator producing CMS eCQM and quality-measure submission packages.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: isabel.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains (3 top-level + 3 sub-domains under Clinical Data) ──
  const domPatient = { id: demoId('domain-patient'), code: 'PAT', orgId: orgCedarline.id, name: 'Patient & Access Data', description: 'Demographics, registration, eligibility, and the encounter record.', ownerId: naomi.id, stewardIds: [kelly.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domClinical = { id: demoId('domain-clinical'), code: 'CLIN', orgId: orgCedarline.id, name: 'Clinical Data', description: 'Diagnostic results, imaging, medications, and bedside telemetry — the care-delivery feeds.', ownerId: pierce.id, stewardIds: [kelly.id, deepa.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domCompliance = { id: demoId('domain-rcm'), code: 'RCM', orgId: orgCedarline.id, name: 'Revenue & Compliance Data', description: 'Charges, claims, and the compliance evidence trail (HIPAA / CMS / eCQM).', ownerId: gabrielm.id, stewardIds: [wendy.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Sub-domains under Clinical Data — the diagnostic modalities. Parent created first.
  const domClinLab = { id: demoId('domain-clin-lab'), code: 'CLIN-01', orgId: orgCedarline.id, name: 'Laboratory', description: 'Lab orders, specimen tracking, and result reporting.', ownerId: pierce.id, stewardIds: [kelly.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domClinical.id, createdAt: ts, updatedAt: ts };
  const domClinImaging = { id: demoId('domain-clin-imaging'), code: 'CLIN-02', orgId: orgCedarline.id, name: 'Imaging', description: 'Radiology images, diagnostic reports, and PACS metadata.', ownerId: pierce.id, stewardIds: [deepa.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domClinical.id, createdAt: ts, updatedAt: ts };
  const domClinMeds = { id: demoId('domain-clin-meds'), code: 'CLIN-03', orgId: orgCedarline.id, name: 'Medications', description: 'Medication orders, administration records, and dispensing data.', ownerId: pierce.id, stewardIds: [marcus.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domClinical.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domPatient, domClinical, domCompliance, domClinLab, domClinImaging, domClinMeds]);

  // ── Data Assets (9) ──
  const assetDemographics = { id: demoId('asset-demographics'), orgId: orgCedarline.id, name: 'Patient Demographics', description: 'The registration master — name, MRN, contacts, and eligibility. PHI, tightly governed.', systemId: sysEHR.id, owner: '', ownerPersonId: kelly.id, stewardIds: [] as string[], governanceTier: 'GOLD' as const, healthScore: 90, sensitivityTags: ['PHI', 'PII'], createdAt: ts, updatedAt: ts };
  const assetEncounters = { id: demoId('asset-encounters'), orgId: orgCedarline.id, name: 'Clinical Encounters', description: 'The encounter record — visits, admissions, diagnoses, and notes.', systemId: sysEHR.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 86, sensitivityTags: ['PHI'], createdAt: ts, updatedAt: ts };
  const assetLabResults = { id: demoId('asset-lab-results'), orgId: orgAcute.id, name: 'Lab Results', description: 'Laboratory result values and reference ranges by order.', systemId: sysLIS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 58, sensitivityTags: ['PHI'], createdAt: ts, updatedAt: ts };
  const assetRadiology = { id: demoId('asset-radiology'), orgId: orgAcute.id, name: 'Radiology Reports', description: 'Signed diagnostic imaging reports and impressions.', systemId: sysPACS.id, owner: '', ownerPersonId: deepa.id, stewardIds: [] as string[], governanceTier: 'GOLD' as const, healthScore: 92, sensitivityTags: ['PHI'], createdAt: ts, updatedAt: ts };
  const assetMedOrders = { id: demoId('asset-med-orders'), orgId: orgCedarline.id, name: 'Medication Orders', description: 'Active and historical medication orders and administration records.', systemId: sysPharmacy.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, sensitivityTags: ['PHI'], createdAt: ts, updatedAt: ts };
  const assetClaims = { id: demoId('asset-claims'), orgId: orgCedarline.id, name: 'Claims & Billing Records', description: 'Charges, coded claims, and remittance — the reimbursement record.', systemId: sysRevCycle.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 88, sensitivityTags: ['PHI', 'PII'], createdAt: ts, updatedAt: ts };
  const assetVitals = { id: demoId('asset-vitals'), orgId: orgAcute.id, name: 'Vitals Telemetry', description: 'Continuous bedside vitals and waveform telemetry captured from monitors.', systemId: sysTelemetry.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 80, sensitivityTags: ['PHI'], createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's orphan-detection returns a quotable answer.
  const orphanLegacyReg = { id: demoId('asset-legacy-registration'), orgId: orgCedarline.id, name: 'Legacy Registration Extract', description: 'Nightly dump from the retired registration system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanClaimsCsv = { id: demoId('asset-claims-csv'), orgId: orgCedarline.id, name: 'Claims CSV Dump', description: 'Ad-hoc CSV extract of claims for an old payer-reporting vendor. Nobody remembers if it is still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetDemographics, assetEncounters, assetLabResults, assetRadiology, assetMedOrders, assetClaims, assetVitals, orphanLegacyReg, orphanClaimsCsv]);

  // Domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domPatient.id, { dataAssetIds: [assetDemographics.id, assetEncounters.id] });
  await repos.dataDomains.update(domClinical.id, { dataAssetIds: [assetLabResults.id, assetRadiology.id, assetVitals.id] });
  await repos.dataDomains.update(domCompliance.id, { dataAssetIds: [assetClaims.id, assetMedOrders.id] });

  // ── Process hierarchy — VS1 Patient Care Delivery (Acute Care) ──
  const vsCare = { id: demoId('node-vs-care'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Patient Care Delivery', description: 'End-to-end inpatient care — register, order and result diagnostics, diagnose, and treat.', activityId: 'VS-DEMO-H1', status: 'ACTIVE', orderIndex: 0, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: pierce.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procAdmit = { id: demoId('node-proc-admit'), parentId: vsCare.id, level: 'PROCESS' as const, name: 'Admission & Encounter', description: 'Register the patient and open the encounter; order and collect diagnostics.', activityId: 'PRO-DEMO-H1', status: 'ACTIVE', orderIndex: 0, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: sofia.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procTreat = { id: demoId('node-proc-treat'), parentId: vsCare.id, level: 'PROCESS' as const, name: 'Diagnosis & Treatment', description: 'Interpret results, diagnose, and order medications and treatment.', activityId: 'PRO-DEMO-H2', status: 'ACTIVE', orderIndex: 1, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: pierce.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spOrders = { id: demoId('node-sp-orders'), parentId: procAdmit.id, level: 'SUBPROCESS' as const, name: 'Orders & Results', description: 'Order diagnostics and capture their results against the encounter.', activityId: 'SP-DEMO-H1', status: 'ACTIVE', orderIndex: 0, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: kelly.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actRegister = { id: demoId('node-act-register'), parentId: spOrders.id, level: 'ACTIVITY' as const, name: 'Register & verify patient', description: 'Register the patient, verify identity and eligibility, and open the encounter.', activityId: 'ACT-DEMO-H1', status: 'ACTIVE', orderIndex: 0, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: sofia.id, responsibleRole: 'Director Clinical Informatics', responsiblePersonId: sofia.id, systemIds: [sysRegistration.id, sysEHR.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actOrderLabs = { id: demoId('node-act-order-labs'), parentId: spOrders.id, level: 'ACTIVITY' as const, name: 'Order & collect labs', description: 'Place lab orders, collect specimens, and log the result against the order.', activityId: 'ACT-DEMO-H2', status: 'ACTIVE', orderIndex: 1, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: kelly.id, responsibleRole: 'Clinical Data Steward', responsiblePersonId: kelly.id, systemIds: [sysLIS.id, sysEHR.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Critical lab results available within 60 minutes of collection\n\nResult-to-chart latency P95 under 30 min', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDiagnose = { id: demoId('node-act-diagnose'), parentId: procTreat.id, level: 'ACTIVITY' as const, name: 'Diagnose & document', description: 'Interpret labs and imaging, reach a diagnosis, and document the assessment.', activityId: 'ACT-DEMO-H3', status: 'ACTIVE', orderIndex: 0, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: pierce.id, responsibleRole: 'Data Owner Acute Care', responsiblePersonId: pierce.id, systemIds: [sysEHR.id, sysPACS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actPrescribe = { id: demoId('node-act-prescribe'), parentId: procTreat.id, level: 'ACTIVITY' as const, name: 'Prescribe & administer meds', description: 'Order medications, check interactions, and record administration.', activityId: 'ACT-DEMO-H4', status: 'ACTIVE', orderIndex: 1, orgId: orgAcute.id, orgIds: [orgAcute.id], ownerId: pierce.id, responsibleRole: 'Nursing Informatics Lead', responsiblePersonId: marcus.id, systemIds: [sysPharmacy.id, sysEHR.id], requiredSkillIds: [] as string[], version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsCare, procAdmit, procTreat, spOrders, actRegister, actOrderLabs, actDiagnose, actPrescribe]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-h1'), fromNodeId: actRegister.id, toNodeId: actOrderLabs.id, type: 'SEQUENCE' as const, label: 'encounter opened', createdAt: ts },
    { id: demoId('flow-h2'), fromNodeId: actOrderLabs.id, toNodeId: actDiagnose.id, type: 'SEQUENCE' as const, label: 'results back', createdAt: ts },
    { id: demoId('flow-h3'), fromNodeId: actDiagnose.id, toNodeId: actPrescribe.id, type: 'SEQUENCE' as const, label: 'diagnosis made', createdAt: ts },
  ]);

  // ── Process hierarchy — VS2 Revenue Cycle (Ambulatory) ──
  const vsRevenue = { id: demoId('node-vs-revenue'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Revenue Cycle', description: 'Capture charges, code the encounter, and submit and reconcile claims.', activityId: 'VS-DEMO-H2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgAmbulatory.id, orgIds: [orgAmbulatory.id], ownerId: omar.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procCharge = { id: demoId('node-proc-charge'), parentId: vsRevenue.id, level: 'PROCESS' as const, name: 'Charge Capture & Coding', description: 'Capture charges from the encounter and assign clinical codes.', activityId: 'PRO-DEMO-H3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgAmbulatory.id, orgIds: [orgAmbulatory.id], ownerId: denise.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procClaims = { id: demoId('node-proc-claims'), parentId: vsRevenue.id, level: 'PROCESS' as const, name: 'Claims & Reimbursement', description: 'Submit claims, work denials, and reconcile remittance.', activityId: 'PRO-DEMO-H4', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgAmbulatory.id, orgIds: [orgAmbulatory.id], ownerId: denise.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spCoding = { id: demoId('node-sp-coding'), parentId: procCharge.id, level: 'SUBPROCESS' as const, name: 'Coding', description: 'Assign ICD / CPT codes to the documented encounter.', activityId: 'SP-DEMO-H2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgAmbulatory.id, orgIds: [orgAmbulatory.id], ownerId: tanya.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actCode = { id: demoId('node-act-code'), parentId: spCoding.id, level: 'ACTIVITY' as const, name: 'Assign clinical codes', description: 'Read the encounter record and assign diagnosis and procedure codes.', activityId: 'ACT-DEMO-H5', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgAmbulatory.id, orgIds: [orgAmbulatory.id], ownerId: tanya.id, responsibleRole: 'HIM Coding Steward', responsiblePersonId: victor.id, systemIds: [sysEHR.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, successMeasure: 'Coding accuracy ≥ 97% on audited charts', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actPostCharge = { id: demoId('node-act-post-charge'), parentId: procCharge.id, level: 'ACTIVITY' as const, name: 'Post charges', description: 'Reconcile captured charges against the coded encounter and post them.', activityId: 'ACT-DEMO-H6', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgAmbulatory.id, orgIds: [orgAmbulatory.id], ownerId: denise.id, responsibleRole: 'Charge Integrity Analyst', responsiblePersonId: ahmed.id, systemIds: [sysRevCycle.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actSubmitClaim = { id: demoId('node-act-submit-claim'), parentId: procClaims.id, level: 'ACTIVITY' as const, name: 'Submit & reconcile claim', description: 'Submit the claim, work denials, and reconcile remittance.', activityId: 'ACT-DEMO-H7', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgAmbulatory.id, orgIds: [orgAmbulatory.id], ownerId: denise.id, responsibleRole: 'Manager Revenue Cycle', responsiblePersonId: denise.id, systemIds: [sysRevCycle.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Clean-claim rate ≥ 95%; denial rate under 5%', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsRevenue, procCharge, procClaims, spCoding, actCode, actPostCharge, actSubmitClaim]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-h4'), fromNodeId: actCode.id, toNodeId: actPostCharge.id, type: 'SEQUENCE' as const, label: 'coded', createdAt: ts },
  ]);

  // ── Mappings (7) ──
  await createAll(repos.mappings, [
    { id: demoId('map-h1'), orgId: orgAcute.id, processStepId: actRegister.id, dataAssetId: assetDemographics.id, linkType: 'INPUT', notes: 'Verifies patient identity + eligibility', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-h2'), orgId: orgAcute.id, processStepId: actOrderLabs.id, dataAssetId: assetLabResults.id, linkType: 'OUTPUT', notes: 'Writes the lab result record', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-h3'), orgId: orgAcute.id, processStepId: actDiagnose.id, dataAssetId: assetLabResults.id, linkType: 'INPUT', notes: 'Reviews lab results to reach a diagnosis', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-h4'), orgId: orgAcute.id, processStepId: actDiagnose.id, dataAssetId: assetRadiology.id, linkType: 'INPUT', notes: 'Reviews imaging reports', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-h5'), orgId: orgAcute.id, processStepId: actPrescribe.id, dataAssetId: assetMedOrders.id, linkType: 'OUTPUT', notes: 'Writes medication orders', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-h6'), orgId: orgAmbulatory.id, processStepId: actCode.id, dataAssetId: assetEncounters.id, linkType: 'INPUT', notes: 'Codes from the encounter record', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-h7'), orgId: orgAmbulatory.id, processStepId: actSubmitClaim.id, dataAssetId: assetClaims.id, linkType: 'OUTPUT', notes: 'Submits and reconciles the claim', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Naomi (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-h1'), orgId: orgCedarline.id, title: 'Approve Lab Results classification review', description: 'Review the AI-suggested PHI sensitivity tags on Lab Results and Medication Orders and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: naomi.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetLabResults.id, automationMode: 'HUMAN' as any, createdBy: raj.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-h2'), orgId: orgCedarline.id, title: 'Sign off on Revenue & Compliance domain scope', description: 'Gabriel has proposed expanding the Revenue & Compliance domain to cover new CMS eCQM evidence fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: naomi.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domCompliance.id, automationMode: 'HUMAN' as any, createdBy: gabrielm.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-h3'), orgId: orgCedarline.id, title: 'Retire Legacy Registration Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: naomi.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyReg.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Naomi ──
  await repos.governanceIssues.create({
    id: demoId('issue-h1'),
    orgId: orgCedarline.id,
    title: 'Lab Results tier below Silver — critical diagnostic process, ungoverned',
    description: 'Lab Results is BRONZE tier but the Diagnosis & Treatment process reads it as primary diagnostic evidence. Recommend promoting to Silver with a result-latency SLA.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domClinical.id,
    dataAssetId: assetLabResults.id,
    systemId: sysLIS.id,
    reportedBy: raj.id,
    assignedTo: naomi.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules (2 — one passing, one failing) ──
  await createAll(repos.dataQualityRules, [
    {
      id: demoId('dq-rule-passing'), orgId: orgCedarline.id, dataAssetId: assetClaims.id,
      dimension: 'COMPLETENESS' as const, name: 'Claims & Billing Records · charge-code completeness',
      description: 'At least 95% of claim lines must carry a resolved procedure + diagnosis code.',
      threshold: 95, currentScore: 97, weight: 1, status: 'PASSING' as const,
      lastMeasured: ts, scheduleFrequency: 'DAILY' as const, nextRunAt: daysFromNow(1), createdAt: ts, updatedAt: ts,
    },
    {
      id: demoId('dq-rule-failing'), orgId: orgCedarline.id, dataAssetId: assetLabResults.id,
      dimension: 'TIMELINESS' as const, name: 'Lab Results · result turnaround latency',
      description: 'Critical lab results should reach the chart within 60 minutes of collection. Rolling 24h.',
      threshold: 95, currentScore: 58, weight: 1, status: 'FAILING' as const,
      lastMeasured: ts, scheduleFrequency: 'HOURLY' as const, nextRunAt: daysFromNow(0), createdAt: ts, updatedAt: ts,
    },
  ]);

  // ── Edge connector (ONLINE) ──
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-cedarline'), orgId: orgCedarline.id, name: 'Cedarline Clinical Data Connector',
    tokenHash: '5f6d3c4f26f9c50a9c1a5a2f70c3f7f4a0b3d3c8b3f7d9c3a1e2f5b6c9d0e1f2',
    pairingCode: null, pairingCodeExpiresAt: null,
    systemIds: [sysEHR.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt, agentVersion: '1.2.0', status: 'ONLINE' as const,
    createdAt: connectorCreatedAt, updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  await repos.dataAssets.update(assetEncounters.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  await createAll(repos.connectorEvents, [
    { id: demoId('ce-h-paired'), connectorId: conn.id, orgId: orgCedarline.id, type: 'PAIRED', ts: connectorCreatedAt, data: { agentVersion: '1.2.0' } },
    { id: demoId('ce-h-scan-start'), connectorId: conn.id, orgId: orgCedarline.id, type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: { targetSystemIds: [sysEHR.id, sysWarehouse.id] } },
    { id: demoId('ce-h-scan-done'), connectorId: conn.id, orgId: orgCedarline.id, type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(), data: { durationMs: 40_120, assetsDiscovered: 1 } },
    { id: demoId('ce-h-assets'), connectorId: conn.id, orgId: orgCedarline.id, type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(), data: { incoming: 1, created: 0, updated: 1 } },
    { id: demoId('ce-h-hb'), connectorId: conn.id, orgId: orgCedarline.id, type: 'HEARTBEAT', ts: connectorHeartbeatAt, data: { agentVersion: '1.2.0' } },
  ]);

  // ── Second connector — PAIRING state ──
  const pairingConn = {
    id: demoId('conn-h-pairing'), orgId: orgCedarline.id, name: 'Lab Analyzer Connector',
    tokenHash: null, pairingCode: '73920185',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[], lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-h-dgc'),
    orgId: orgCedarline.id,
    name: 'Data Governance Council weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [naomi.id, raj.id, pierce.id, gabrielm.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgCedarline.id, { coverage: 64, avgHealth: 72, gaps: 8, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgAcute.id, { coverage: 72, avgHealth: 74, gaps: 4, dataAssets: 5, mappings: 5 }),
    ...weeklySnapshots(orgAmbulatory.id, { coverage: 66, avgHealth: 76, gaps: 3, dataAssets: 2, mappings: 2 }),
    ...weeklySnapshots(orgHShared.id, { coverage: 48, avgHealth: 78, gaps: 3, dataAssets: 0, mappings: 0 }),
  ]);

  // ── AI template cache — pre-warm the wand for Cedarline ──
  aiTemplateCache.push(
    {
      industry: 'healthcare|patient care delivery',
      industryLabel: 'Healthcare — Patient Care Delivery',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Patient Care Delivery',
            description: 'Register, order and result diagnostics, diagnose, and treat the patient.',
            purpose: 'Deliver safe, timely care with a complete and defensible clinical record.',
            businessOutcome: 'Better outcomes with results in the chart on time and a clean documentation trail.',
            processes: [
              { name: 'Admission & Encounter', description: 'Register the patient and open the encounter; order and collect diagnostics.', purpose: 'Get the patient into care with the right identity and orders.', activities: [
                { name: 'Register & verify patient', description: 'Register, verify identity and eligibility, and open the encounter.' },
                { name: 'Order & collect labs', description: 'Place lab orders, collect specimens, and log the result.' },
                { name: 'Capture vitals', description: 'Record bedside vitals and connect telemetry monitoring.' },
              ] },
              { name: 'Diagnosis & Treatment', description: 'Interpret results, diagnose, and order treatment.', purpose: 'Reach a diagnosis and start the right treatment.', activities: [
                { name: 'Diagnose & document', description: 'Interpret labs and imaging, diagnose, and document the assessment.' },
                { name: 'Prescribe & administer meds', description: 'Order medications, check interactions, and record administration.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'healthcare|revenue cycle',
      industryLabel: 'Healthcare — Revenue Cycle',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Revenue Cycle',
            description: 'Capture charges, code the encounter, and submit and reconcile claims.',
            purpose: 'Get paid accurately and promptly for the care delivered.',
            businessOutcome: 'High clean-claim rate, low denials, and a compliant coding trail.',
            processes: [
              { name: 'Charge Capture & Coding', description: 'Capture charges from the encounter and assign clinical codes.', purpose: 'Turn documented care into billable, coded charges.', activities: [
                { name: 'Assign clinical codes', description: 'Read the encounter record and assign diagnosis and procedure codes.' },
                { name: 'Post charges', description: 'Reconcile captured charges against the coded encounter and post them.' },
              ] },
              { name: 'Claims & Reimbursement', description: 'Submit claims, work denials, and reconcile remittance.', purpose: 'Convert charges into collected revenue.', activities: [
                { name: 'Submit & reconcile claim', description: 'Submit the claim, work denials, and reconcile remittance.' },
                { name: 'Post payment', description: 'Post remittance and route residual balances.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgCedarline.id,
    cdoId: naomi.id,
    govLeadId: raj.id,
    dataOwnerId: pierce.id,
    stewardIds: [kelly.id, wendy.id],
    tenantName: 'Cedarline Health',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgCedarline.id,
    domainIds: [domPatient.id, domClinical.id, domCompliance.id],
    cdoId: naomi.id,
    govLeadId: raj.id,
    dataOwnerId: pierce.id,
    stewardId: kelly.id,
    techStewardId: wendy.id,
    engineerId: ravih.id,
    architectId: meghanh.id,
    raciNodeId: actOrderLabs.id,
    raciPersonId: chenli.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgCedarline.id, ownerId: kelly.id, cdoId: naomi.id, domainId: domPatient.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgCedarline.id, orgAcute.id, orgAmbulatory.id],
    links: [
      { id: demoId('lin-1'), orgId: orgCedarline.id, sourceSystemId: sysEHR.id, targetSystemId: sysWarehouse.id, dataAssetId: assetEncounters.id, description: 'Encounter records sync nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-2'), orgId: orgCedarline.id, sourceSystemId: sysRevCycle.id, targetSystemId: sysWarehouse.id, dataAssetId: assetClaims.id, description: 'Claims + remittance feed the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-3'), orgId: orgAcute.id, sourceSystemId: sysLIS.id, targetSystemId: sysWarehouse.id, dataAssetId: assetLabResults.id, description: 'Lab results stream into the warehouse.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgCedarline.id, sourceAssetId: assetDemographics.id, targetAssetId: assetEncounters.id },
      { id: demoId('edge-2'), orgId: orgCedarline.id, sourceAssetId: assetEncounters.id, targetAssetId: assetClaims.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgCedarline.id, agentId: demoId('agent-ecqm-gen'), agentName: 'Quality Measure (eCQM) Report Generator', activityId: actSubmitClaim.id, activityName: 'Submit & reconcile claim', roleType: 'TECHNICAL_DATA_STEWARD', createdBy: naomi.id, reviewerId: raj.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgCedarline.id, assetId: assetDemographics.id, systemId: sysEHR.id, personId: kelly.id, personName: 'Kelly Nguyen' });

  logger.info({ persona: naomi.name }, 'Demo data seeded (healthcare)');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: naomi.id, name: naomi.name },
  };
}

/**
 * Manufacturing profile — a Forgeline Manufacturing discrete manufacturer
 * (plant operations + supply chain + shared services), persona Marcus Feldt (CDO).
 * Same shape and counts as the other profiles.
 */
async function seedManufacturing(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {
  // ── Organizations (company → 3 divisions → 6 departments) ──
  const orgForgeline = { id: demoId('org-forgeline'), parentId: null, name: 'Forgeline Manufacturing', type: 'company', industry: 'Manufacturing', description: 'Discrete manufacturer demo tenant — plant operations + supply chain + shared services.', headCount: 0, tenantSlug: 'forgeline', brandDisplayName: 'Forgeline Manufacturing', brandGlyph: '⚙', ssoButtonLabel: 'Sign in with Forgeline SSO', brandPrimaryColor: '#1e3a8a', createdAt: ts, updatedAt: ts };
  const orgPlant = { id: demoId('org-plant'), parentId: orgForgeline.id, name: 'Plant Operations', type: 'division', industry: 'Manufacturing', description: 'Machining, assembly, and test', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgSupply = { id: demoId('org-supply'), parentId: orgForgeline.id, name: 'Supply Chain', type: 'division', industry: 'Manufacturing', description: 'Procurement, logistics, and fulfillment', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgFShared = { id: demoId('org-fshared'), parentId: orgForgeline.id, name: 'Shared Services', type: 'division', industry: 'Manufacturing', description: 'IT / Quality', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgMachining = { id: demoId('org-machining'), parentId: orgPlant.id, name: 'Machining', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgAssembly = { id: demoId('org-assembly'), parentId: orgPlant.id, name: 'Assembly & Test', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgProcurement = { id: demoId('org-procurement'), parentId: orgSupply.id, name: 'Procurement', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgLogistics = { id: demoId('org-logistics'), parentId: orgSupply.id, name: 'Logistics', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgFIT = { id: demoId('org-fit'), parentId: orgFShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgFQuality = { id: demoId('org-fquality'), parentId: orgFShared.id, name: 'Quality', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgForgeline, orgPlant, orgSupply, orgFShared, orgMachining, orgAssembly, orgProcurement, orgLogistics, orgFIT, orgFQuality]);

  // ── People (24) — persona Marcus Feldt (CDO) ──
  const marcusf = { id: demoId('person-marcus-feldt'), orgIds: [orgForgeline.id], accessibleOrgIds: [orgForgeline.id, orgPlant.id, orgSupply.id, orgFShared.id, orgMachining.id, orgAssembly.id, orgProcurement.id, orgLogistics.id, orgFIT.id, orgFQuality.id], name: 'Marcus Feldt', email: 'marcus.feldt@forgeline-mfg.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lenav = { id: demoId('person-lena-v'), orgIds: [orgForgeline.id], accessibleOrgIds: [orgForgeline.id], name: 'Lena Vogt', email: 'lena.vogt@forgeline-mfg.com', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const hector = { id: demoId('person-hector'), orgIds: [orgPlant.id], accessibleOrgIds: [orgPlant.id], name: 'Hector Ramos', email: 'hector.ramos@forgeline-mfg.com', role: 'ORG_ADMIN', title: 'Data Owner Plant Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const dana = { id: demoId('person-dana'), orgIds: [orgMachining.id], accessibleOrgIds: [orgMachining.id, orgPlant.id], name: 'Dana Cross', email: 'dana.cross@forgeline-mfg.com', role: 'EDITOR', title: 'Director Machining', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const owen = { id: demoId('person-owen'), orgIds: [orgMachining.id], accessibleOrgIds: [orgMachining.id], name: 'Owen Pratt', email: 'owen.pratt@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'CNC Programming Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const marta = { id: demoId('person-marta'), orgIds: [orgMachining.id], accessibleOrgIds: [orgMachining.id], name: 'Marta Silva', email: 'marta.silva@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Data Steward Machining', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const bruno = { id: demoId('person-bruno'), orgIds: [orgMachining.id], accessibleOrgIds: [orgMachining.id], name: 'Bruno Costa', email: 'bruno.costa@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Machining Superintendent', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const priscilla = { id: demoId('person-priscilla'), orgIds: [orgAssembly.id], accessibleOrgIds: [orgAssembly.id], name: 'Priscilla Adeyemi', email: 'priscilla.adeyemi@forgeline-mfg.com', role: 'EDITOR', title: 'Manager Assembly & Test', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const jaewon = { id: demoId('person-jaewon'), orgIds: [orgAssembly.id], accessibleOrgIds: [orgAssembly.id], name: 'Jae-won Park', email: 'jaewon.park@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Data Steward Assembly', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const toby = { id: demoId('person-toby'), orgIds: [orgAssembly.id], accessibleOrgIds: [orgAssembly.id], name: 'Toby Fields', email: 'toby.fields@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Assembly Line Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const rafael = { id: demoId('person-rafael'), orgIds: [orgSupply.id], accessibleOrgIds: [orgSupply.id], name: 'Rafael Ortiz', email: 'rafael.ortiz@forgeline-mfg.com', role: 'ORG_ADMIN', title: 'Data Owner Supply Chain', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const ingrid = { id: demoId('person-ingrid'), orgIds: [orgProcurement.id], accessibleOrgIds: [orgProcurement.id, orgSupply.id], name: 'Ingrid Sorensen', email: 'ingrid.sorensen@forgeline-mfg.com', role: 'EDITOR', title: 'Director Procurement', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const samw = { id: demoId('person-sam-w'), orgIds: [orgProcurement.id], accessibleOrgIds: [orgProcurement.id], name: 'Sam Whitaker', email: 'sam.whitaker@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Buyer / Planner', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const aisha = { id: demoId('person-aisha'), orgIds: [orgProcurement.id], accessibleOrgIds: [orgProcurement.id], name: 'Aisha Bello', email: 'aisha.bello@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Data Steward Procurement', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const diego = { id: demoId('person-diego'), orgIds: [orgLogistics.id], accessibleOrgIds: [orgLogistics.id, orgSupply.id], name: 'Diego Santos', email: 'diego.santos@forgeline-mfg.com', role: 'EDITOR', title: 'Manager Logistics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const fenella = { id: demoId('person-fenella'), orgIds: [orgLogistics.id], accessibleOrgIds: [orgLogistics.id], name: 'Fenella Wright', email: 'fenella.wright@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Warehouse Data Steward', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const neel = { id: demoId('person-neel'), orgIds: [orgFIT.id], accessibleOrgIds: [orgFIT.id], name: 'Neel Kapoor', email: 'neel.kapoor@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const erin = { id: demoId('person-erin'), orgIds: [orgFIT.id], accessibleOrgIds: [orgFIT.id], name: 'Erin Walsh', email: 'erin.walsh@forgeline-mfg.com', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const karl = { id: demoId('person-karl'), orgIds: [orgFIT.id], accessibleOrgIds: [orgFIT.id], name: 'Karl Brenner', email: 'karl.brenner@forgeline-mfg.com', role: 'EDITOR', title: 'Manager OT / ICS Cybersecurity', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sophial = { id: demoId('person-sophia-l'), orgIds: [orgFQuality.id], accessibleOrgIds: [orgFQuality.id], name: 'Sophia Lang', email: 'sophia.lang@forgeline-mfg.com', role: 'EDITOR', title: 'Director Quality', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const vikram = { id: demoId('person-vikram'), orgIds: [orgFQuality.id], accessibleOrgIds: [orgFQuality.id], name: 'Vikram Desai', email: 'vikram.desai@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'Data Steward Quality Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const renata = { id: demoId('person-renata'), orgIds: [orgFQuality.id], accessibleOrgIds: [orgFQuality.id], name: 'Renata Cruz', email: 'renata.cruz@forgeline-mfg.com', role: 'CONTRIBUTOR', title: 'QA / Metrology Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const paul = { id: demoId('person-paul'), orgIds: [orgFQuality.id], accessibleOrgIds: [orgFQuality.id], name: 'Paul Nakamura', email: 'paul.nakamura@forgeline-mfg.com', role: 'EDITOR', title: 'Manager Supplier Quality', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const beatrix = { id: demoId('person-beatrix'), orgIds: [orgFQuality.id], accessibleOrgIds: [orgFQuality.id], name: 'Beatrix Hahn', email: 'beatrix.hahn@forgeline-mfg.com', role: 'EDITOR', title: 'Manager Regulatory & Compliance', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [marcusf, lenav, hector, dana, owen, marta, bruno, priscilla, jaewon, toby, rafael, ingrid, samw, aisha, diego, fenella, neel, erin, karl, sophial, vikram, renata, paul, beatrix]);

  // ── Systems (8) — ERP / MES / PLM / historian / QMS / WMS / warehouse + CMMS ──
  const sysERP = { id: demoId('sys-merp'), orgId: orgForgeline.id, name: 'ERP', description: 'Enterprise Resource Planning — materials, procurement, work orders, finance.', systemType: 'IT', vendorName: 'SAP S/4HANA', ownerPersonId: neel.id, stewardIds: [aisha.id], createdAt: ts, updatedAt: ts };
  const sysMES = { id: demoId('sys-mmes'), orgId: orgPlant.id, name: 'MES', description: 'Manufacturing Execution System — shop-floor work orders, routings, throughput.', systemType: 'OT', vendorName: 'Rockwell FactoryTalk', ownerPersonId: hector.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysPLM = { id: demoId('sys-mplm'), orgId: orgForgeline.id, name: 'PLM', description: 'Product Lifecycle Management — CAD, drawings, engineering BOM, change orders.', systemType: 'IT', vendorName: 'PTC Windchill', ownerPersonId: marta.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysHistorian = { id: demoId('sys-mhist'), orgId: orgPlant.id, name: 'Process Historian', description: 'Machine data historian — spindle load, feed, temperature, cycle time per machine.', systemType: 'OT', vendorName: 'AVEVA PI', ownerPersonId: karl.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysQMS = { id: demoId('sys-mqms'), orgId: orgFQuality.id, name: 'QMS', description: 'Quality Management System — inspections, nonconformances, supplier quality, PPAP.', systemType: 'IT', vendorName: 'ETQ Reliance', ownerPersonId: sophial.id, stewardIds: [vikram.id], createdAt: ts, updatedAt: ts };
  const sysWMS = { id: demoId('sys-mwms'), orgId: orgSupply.id, name: 'WMS', description: 'Warehouse Management System — inventory, picking, packing, shipping.', systemType: 'IT', vendorName: 'Manhattan Associates', ownerPersonId: diego.id, stewardIds: [fenella.id], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgForgeline.id, name: 'Data Warehouse', description: 'Enterprise analytics warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: neel.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysCMMS = { id: demoId('sys-mcmms'), orgId: orgPlant.id, name: 'CMMS', description: 'Computerized Maintenance Management — asset maintenance, work orders, downtime.', systemType: 'IT', vendorName: 'IBM Maximo', ownerPersonId: hector.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysERP, sysMES, sysPLM, sysHistorian, sysQMS, sysWMS, sysWarehouse, sysCMMS]);

  // ── Agents (5 — one of each type) ──
  await createAll(repos.agents, [
    { id: demoId('agent-maint-model'), orgIds: [orgPlant.id], name: 'Predictive Maintenance Model', agentType: 'AI', description: 'Predicts machine failure risk from historian telemetry and maintenance logs.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: erin.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-prod-pipeline'), orgIds: [orgForgeline.id], name: 'Production Data Ingestion Pipeline', agentType: 'PIPELINE', description: 'Nightly ETL of MES work-order and machine data into the warehouse.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: neel.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-oee-bot'), orgIds: [orgPlant.id], name: 'OEE Alert Bot', agentType: 'BOT', description: 'Alerts supervisors when line OEE drops below target or a machine faults.', provider: 'Microsoft Teams', status: 'ACTIVE', ownerPersonId: hector.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-hist-service'), orgIds: [orgPlant.id], name: 'Historian Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract historian tags.', provider: 'AVEVA', status: 'ACTIVE', ownerPersonId: karl.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-ppap-gen'), orgIds: [orgForgeline.id], name: 'PPAP Package Generator', agentType: 'OTHER', description: 'Scheduled generator producing PPAP and first-article quality submission packages.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: beatrix.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains (3 top-level + 3 sub-domains under Production Data) ──
  const domEng = { id: demoId('domain-eng'), code: 'ENG', orgId: orgForgeline.id, name: 'Product & Engineering Data', description: 'CAD models, drawings, engineering BOMs, change orders, and maintenance records.', ownerId: marcusf.id, stewardIds: [marta.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domProd = { id: demoId('domain-mprod'), code: 'PROD', orgId: orgForgeline.id, name: 'Production Data', description: 'Work orders, machine telemetry, and material inventory — the shop-floor feeds.', ownerId: hector.id, stewardIds: [marta.id, jaewon.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domQuality = { id: demoId('domain-mquality'), code: 'QLT', orgId: orgForgeline.id, name: 'Quality & Compliance Data', description: 'Inspection records, nonconformances, and supplier quality evidence (ISO / IATF / PPAP).', ownerId: sophial.id, stewardIds: [vikram.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Sub-domains under Production Data — the shop-floor areas. Parent created first.
  const domProdMachining = { id: demoId('domain-mprod-machining'), code: 'PROD-01', orgId: orgForgeline.id, name: 'Machining', description: 'CNC programs, machine telemetry, and part-level machining records.', ownerId: hector.id, stewardIds: [marta.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domProd.id, createdAt: ts, updatedAt: ts };
  const domProdAssembly = { id: demoId('domain-mprod-assembly'), code: 'PROD-02', orgId: orgForgeline.id, name: 'Assembly', description: 'Assembly work orders, build sequences, and test results.', ownerId: hector.id, stewardIds: [jaewon.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domProd.id, createdAt: ts, updatedAt: ts };
  const domProdMaterials = { id: demoId('domain-mprod-materials'), code: 'PROD-03', orgId: orgForgeline.id, name: 'Materials', description: 'Material inventory, receipts, and consumption against work orders.', ownerId: hector.id, stewardIds: [aisha.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domProd.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domEng, domProd, domQuality, domProdMachining, domProdAssembly, domProdMaterials]);

  // ── Data Assets (9) ──
  const assetProductMaster = { id: demoId('asset-product-master'), orgId: orgForgeline.id, name: 'Product Master', description: 'The master CAD product model, released drawings, and engineering BOM.', systemId: sysPLM.id, owner: '', ownerPersonId: marta.id, stewardIds: [] as string[], governanceTier: 'GOLD' as const, healthScore: 90, createdAt: ts, updatedAt: ts };
  const assetWorkOrders = { id: demoId('asset-mwork-orders'), orgId: orgPlant.id, name: 'Work Orders', description: 'Shop-floor work order state — routings, operations, and completion by part.', systemId: sysMES.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, createdAt: ts, updatedAt: ts };
  const assetMachineTelemetry = { id: demoId('asset-machine-telemetry'), orgId: orgPlant.id, name: 'Machine Telemetry', description: 'Historian tags — spindle load, feed, temperature, and cycle time per machine.', systemId: sysHistorian.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 80, createdAt: ts, updatedAt: ts };
  const assetInspection = { id: demoId('asset-inspection'), orgId: orgForgeline.id, name: 'Inspection Records', description: 'Per-part dimensional and functional inspection results and dispositions.', systemId: sysQMS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 58, createdAt: ts, updatedAt: ts };
  const assetInventory = { id: demoId('asset-inventory'), orgId: orgForgeline.id, name: 'Material Inventory', description: 'On-hand inventory, receipts, and consumption — raw stock through finished goods.', systemId: sysERP.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 88, createdAt: ts, updatedAt: ts };
  const assetSupplierQuality = { id: demoId('asset-supplier-quality'), orgId: orgForgeline.id, name: 'Supplier Quality Records', description: 'Supplier scorecards, PPAP submissions, and incoming inspection evidence.', systemId: sysQMS.id, owner: '', ownerPersonId: paul.id, stewardIds: [vikram.id] as string[], governanceTier: 'GOLD' as const, healthScore: 92, createdAt: ts, updatedAt: ts };
  const assetMaintenance = { id: demoId('asset-maintenance'), orgId: orgPlant.id, name: 'Maintenance Logs', description: 'CMMS maintenance work orders, downtime events, and asset history.', systemId: sysCMMS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 82, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's orphan-detection returns a quotable answer.
  const orphanLegacyMRP = { id: demoId('asset-legacy-mrp'), orgId: orgForgeline.id, name: 'Legacy MRP Extract', description: 'Nightly dump from the retired MRP system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanScrapCsv = { id: demoId('asset-scrap-csv'), orgId: orgForgeline.id, name: 'Scrap CSV Dump', description: 'Ad-hoc CSV extract of scrap and rework for an old cost-reporting tool. Nobody remembers if it is still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetProductMaster, assetWorkOrders, assetMachineTelemetry, assetInspection, assetInventory, assetSupplierQuality, assetMaintenance, orphanLegacyMRP, orphanScrapCsv]);

  // Domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domEng.id, { dataAssetIds: [assetProductMaster.id, assetMaintenance.id] });
  await repos.dataDomains.update(domProd.id, { dataAssetIds: [assetWorkOrders.id, assetMachineTelemetry.id, assetInventory.id] });
  await repos.dataDomains.update(domQuality.id, { dataAssetIds: [assetInspection.id, assetSupplierQuality.id] });

  // ── Process hierarchy — VS1 Make-to-Order Production (Plant Operations) ──
  const vsProd = { id: demoId('node-vs-prod'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Make-to-Order Production', description: 'End-to-end build — program and machine parts, assemble, test, and inspect.', activityId: 'VS-DEMO-M1', status: 'ACTIVE', orderIndex: 0, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: hector.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procMachine = { id: demoId('node-proc-machine'), parentId: vsProd.id, level: 'PROCESS' as const, name: 'Machining & Fabrication', description: 'Program, set up, and machine parts to the engineering drawing.', activityId: 'PRO-DEMO-M1', status: 'ACTIVE', orderIndex: 0, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: dana.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procAssemble = { id: demoId('node-proc-assemble'), parentId: vsProd.id, level: 'PROCESS' as const, name: 'Assembly & Test', description: 'Assemble machined parts into units and test and inspect them.', activityId: 'PRO-DEMO-M2', status: 'ACTIVE', orderIndex: 1, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: priscilla.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spCNC = { id: demoId('node-sp-cnc'), parentId: procMachine.id, level: 'SUBPROCESS' as const, name: 'CNC Machining', description: 'Program the CNC, set up the machine, and cut the part.', activityId: 'SP-DEMO-M1', status: 'ACTIVE', orderIndex: 0, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: owen.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actProgram = { id: demoId('node-act-program'), parentId: spCNC.id, level: 'ACTIVITY' as const, name: 'Program & set up machine', description: 'Generate the CNC program from the model and set up the machine and tooling.', activityId: 'ACT-DEMO-M1', status: 'ACTIVE', orderIndex: 0, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: owen.id, responsibleRole: 'CNC Programming Lead', responsiblePersonId: owen.id, systemIds: [sysMES.id, sysPLM.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actMachine = { id: demoId('node-act-machine'), parentId: spCNC.id, level: 'ACTIVITY' as const, name: 'Machine part', description: 'Run the CNC cut, monitor machine telemetry, and produce the part to tolerance.', activityId: 'ACT-DEMO-M2', status: 'ACTIVE', orderIndex: 1, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: bruno.id, responsibleRole: 'Machining Superintendent', responsiblePersonId: bruno.id, systemIds: [sysMES.id, sysHistorian.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'First-pass yield ≥ 98% on Tier 1 parts\n\nScrap rate under 1.5%', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actAssemble = { id: demoId('node-act-assemble'), parentId: procAssemble.id, level: 'ACTIVITY' as const, name: 'Assemble unit', description: 'Join machined parts and components into a finished unit per the work order.', activityId: 'ACT-DEMO-M3', status: 'ACTIVE', orderIndex: 0, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: priscilla.id, responsibleRole: 'Assembly Line Lead', responsiblePersonId: toby.id, systemIds: [sysMES.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actInspect = { id: demoId('node-act-inspect'), parentId: procAssemble.id, level: 'ACTIVITY' as const, name: 'Final test & inspect', description: 'Test and dimensionally inspect the unit; pass it or raise a nonconformance.', activityId: 'ACT-DEMO-M4', status: 'ACTIVE', orderIndex: 1, orgId: orgPlant.id, orgIds: [orgPlant.id], ownerId: priscilla.id, responsibleRole: 'QA / Metrology Lead', responsiblePersonId: renata.id, systemIds: [sysQMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Every unit inspected and dispositioned before shipment', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsProd, procMachine, procAssemble, spCNC, actProgram, actMachine, actAssemble, actInspect]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-m1'), fromNodeId: actProgram.id, toNodeId: actMachine.id, type: 'SEQUENCE' as const, label: 'program ready', createdAt: ts },
    { id: demoId('flow-m2'), fromNodeId: actMachine.id, toNodeId: actAssemble.id, type: 'SEQUENCE' as const, label: 'parts made', createdAt: ts },
    { id: demoId('flow-m3'), fromNodeId: actAssemble.id, toNodeId: actInspect.id, type: 'SEQUENCE' as const, label: 'unit assembled', createdAt: ts },
  ]);

  // ── Process hierarchy — VS2 Supply Chain & Fulfillment (Supply Chain) ──
  const vsSupply = { id: demoId('node-vs-supply'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Supply Chain & Fulfillment', description: 'Procure materials, receive and inspect them, and pick and ship finished orders.', activityId: 'VS-DEMO-M2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSupply.id, orgIds: [orgSupply.id], ownerId: rafael.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procProcure = { id: demoId('node-proc-procure'), parentId: vsSupply.id, level: 'PROCESS' as const, name: 'Procurement', description: 'Place purchase orders and receive and inspect incoming material.', activityId: 'PRO-DEMO-M3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSupply.id, orgIds: [orgSupply.id], ownerId: ingrid.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procFulfill = { id: demoId('node-proc-fulfill'), parentId: vsSupply.id, level: 'PROCESS' as const, name: 'Fulfillment', description: 'Pick, pack, and ship finished-goods orders.', activityId: 'PRO-DEMO-M4', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgSupply.id, orgIds: [orgSupply.id], ownerId: diego.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spPurchasing = { id: demoId('node-sp-purchasing'), parentId: procProcure.id, level: 'SUBPROCESS' as const, name: 'Purchasing', description: 'Convert requirements into confirmed purchase orders.', activityId: 'SP-DEMO-M2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSupply.id, orgIds: [orgSupply.id], ownerId: samw.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actPO = { id: demoId('node-act-po'), parentId: spPurchasing.id, level: 'ACTIVITY' as const, name: 'Place & confirm PO', description: 'Raise the purchase order against the material requirement and confirm it.', activityId: 'ACT-DEMO-M5', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSupply.id, orgIds: [orgSupply.id], ownerId: samw.id, responsibleRole: 'Buyer / Planner', responsiblePersonId: samw.id, systemIds: [sysERP.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actReceive = { id: demoId('node-act-receive'), parentId: procProcure.id, level: 'ACTIVITY' as const, name: 'Receive & inspect material', description: 'Receive inbound material, run incoming inspection, and post it to inventory.', activityId: 'ACT-DEMO-M6', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSupply.id, orgIds: [orgSupply.id], ownerId: ingrid.id, responsibleRole: 'Data Steward Procurement', responsiblePersonId: aisha.id, systemIds: [sysWMS.id, sysQMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actShip = { id: demoId('node-act-ship'), parentId: procFulfill.id, level: 'ACTIVITY' as const, name: 'Pick & ship order', description: 'Allocate inventory, pick and pack the order, and ship it.', activityId: 'ACT-DEMO-M7', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgSupply.id, orgIds: [orgSupply.id], ownerId: diego.id, responsibleRole: 'Manager Logistics', responsiblePersonId: diego.id, systemIds: [sysWMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'On-time ship rate ≥ 97%', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsSupply, procProcure, procFulfill, spPurchasing, actPO, actReceive, actShip]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-m4'), fromNodeId: actPO.id, toNodeId: actReceive.id, type: 'SEQUENCE' as const, label: 'PO placed', createdAt: ts },
  ]);

  // ── Mappings (7) ──
  await createAll(repos.mappings, [
    { id: demoId('map-m1'), orgId: orgPlant.id, processStepId: actProgram.id, dataAssetId: assetProductMaster.id, linkType: 'INPUT', notes: 'Programs from the engineering model + BOM', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-m2'), orgId: orgPlant.id, processStepId: actMachine.id, dataAssetId: assetMachineTelemetry.id, linkType: 'INPUT', notes: 'Reads machine parameters from the historian', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-m3'), orgId: orgPlant.id, processStepId: actInspect.id, dataAssetId: assetInspection.id, linkType: 'OUTPUT', notes: 'Writes the inspection record', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-m4'), orgId: orgPlant.id, processStepId: actAssemble.id, dataAssetId: assetWorkOrders.id, linkType: 'INPUT', notes: 'Checks build sequence via the work order', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-m5'), orgId: orgSupply.id, processStepId: actReceive.id, dataAssetId: assetInventory.id, linkType: 'OUTPUT', notes: 'Posts received material to inventory', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-m6'), orgId: orgSupply.id, processStepId: actReceive.id, dataAssetId: assetSupplierQuality.id, linkType: 'INPUT', notes: 'Checks supplier quality on receipt', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-m7'), orgId: orgSupply.id, processStepId: actShip.id, dataAssetId: assetInventory.id, linkType: 'INPUT', notes: 'Allocates inventory to the shipment', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Marcus (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-m1'), orgId: orgForgeline.id, title: 'Approve Inspection Records classification review', description: 'Review the AI-suggested sensitivity tags on Inspection Records and Supplier Quality Records and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: marcusf.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetInspection.id, automationMode: 'HUMAN' as any, createdBy: lenav.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-m2'), orgId: orgForgeline.id, title: 'Sign off on Quality & Compliance domain scope', description: 'Sophia has proposed expanding the Quality & Compliance domain to cover new IATF audit evidence fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: marcusf.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domQuality.id, automationMode: 'HUMAN' as any, createdBy: sophial.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-m3'), orgId: orgForgeline.id, title: 'Retire Legacy MRP Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: marcusf.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyMRP.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Marcus ──
  await repos.governanceIssues.create({
    id: demoId('issue-m1'),
    orgId: orgForgeline.id,
    title: 'Inspection Records tier below Silver — critical process, ungoverned',
    description: 'Inspection Records is BRONZE tier but the Assembly & Test process writes it as the primary quality evidence. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domQuality.id,
    dataAssetId: assetInspection.id,
    systemId: sysQMS.id,
    reportedBy: lenav.id,
    assignedTo: marcusf.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules (2 — one passing, one failing) ──
  await createAll(repos.dataQualityRules, [
    {
      id: demoId('dq-rule-passing'), orgId: orgForgeline.id, dataAssetId: assetWorkOrders.id,
      dimension: 'COMPLETENESS' as const, name: 'Work Orders · routing completeness',
      description: 'At least 95% of work orders must carry a complete operation routing.',
      threshold: 95, currentScore: 97, weight: 1, status: 'PASSING' as const,
      lastMeasured: ts, scheduleFrequency: 'DAILY' as const, nextRunAt: daysFromNow(1), createdAt: ts, updatedAt: ts,
    },
    {
      id: demoId('dq-rule-failing'), orgId: orgForgeline.id, dataAssetId: assetInspection.id,
      dimension: 'TIMELINESS' as const, name: 'Inspection Records · result submission latency',
      description: 'Inspection results should be logged within 4 hours of the operation. Rolling 24h.',
      threshold: 95, currentScore: 58, weight: 1, status: 'FAILING' as const,
      lastMeasured: ts, scheduleFrequency: 'HOURLY' as const, nextRunAt: daysFromNow(0), createdAt: ts, updatedAt: ts,
    },
  ]);

  // ── Edge connector (ONLINE) ──
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-forgeline'), orgId: orgForgeline.id, name: 'Forgeline Plant Data Connector',
    tokenHash: '5f6d3c4f26f9c50a9c1a5a2f70c3f7f4a0b3d3c8b3f7d9c3a1e2f5b6c9d0e1f2',
    pairingCode: null, pairingCodeExpiresAt: null,
    systemIds: [sysMES.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt, agentVersion: '1.2.0', status: 'ONLINE' as const,
    createdAt: connectorCreatedAt, updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  await repos.dataAssets.update(assetWorkOrders.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  await createAll(repos.connectorEvents, [
    { id: demoId('ce-m-paired'), connectorId: conn.id, orgId: orgForgeline.id, type: 'PAIRED', ts: connectorCreatedAt, data: { agentVersion: '1.2.0' } },
    { id: demoId('ce-m-scan-start'), connectorId: conn.id, orgId: orgForgeline.id, type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: { targetSystemIds: [sysMES.id, sysWarehouse.id] } },
    { id: demoId('ce-m-scan-done'), connectorId: conn.id, orgId: orgForgeline.id, type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(), data: { durationMs: 40_120, assetsDiscovered: 1 } },
    { id: demoId('ce-m-assets'), connectorId: conn.id, orgId: orgForgeline.id, type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(), data: { incoming: 1, created: 0, updated: 1 } },
    { id: demoId('ce-m-hb'), connectorId: conn.id, orgId: orgForgeline.id, type: 'HEARTBEAT', ts: connectorHeartbeatAt, data: { agentVersion: '1.2.0' } },
  ]);

  // ── Second connector — PAIRING state ──
  const pairingConn = {
    id: demoId('conn-m-pairing'), orgId: orgForgeline.id, name: 'Metrology Lab Connector',
    tokenHash: null, pairingCode: '52084196',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[], lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-m-dgc'),
    orgId: orgForgeline.id,
    name: 'Data Governance Council weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [marcusf.id, lenav.id, hector.id, sophial.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgForgeline.id, { coverage: 63, avgHealth: 71, gaps: 8, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgPlant.id, { coverage: 71, avgHealth: 73, gaps: 4, dataAssets: 4, mappings: 5 }),
    ...weeklySnapshots(orgSupply.id, { coverage: 66, avgHealth: 75, gaps: 3, dataAssets: 2, mappings: 2 }),
    ...weeklySnapshots(orgFShared.id, { coverage: 46, avgHealth: 77, gaps: 3, dataAssets: 0, mappings: 0 }),
  ]);

  // ── AI template cache — pre-warm the wand for Forgeline ──
  aiTemplateCache.push(
    {
      industry: 'manufacturing|make-to-order production',
      industryLabel: 'Manufacturing — Make-to-Order Production',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Make-to-Order Production',
            description: 'Program and machine parts, assemble them, and test and inspect the unit.',
            purpose: 'Build to spec, on schedule, at the required quality and yield.',
            businessOutcome: 'On-time build with high first-pass yield and a clean inspection record.',
            processes: [
              { name: 'Machining & Fabrication', description: 'Program, set up, and machine parts to the drawing.', purpose: 'Turn stock into finished parts.', activities: [
                { name: 'Program & set up machine', description: 'Generate the CNC program and set up the machine and tooling.' },
                { name: 'Machine part', description: 'Run the cut, monitor telemetry, and produce the part to tolerance.' },
                { name: 'Deburr & clean', description: 'Deburr, clean, and stage the finished part for assembly.' },
              ] },
              { name: 'Assembly & Test', description: 'Assemble parts into units and test and inspect them.', purpose: 'Make a working, verified unit.', activities: [
                { name: 'Assemble unit', description: 'Join parts and components into a finished unit per the work order.' },
                { name: 'Final test & inspect', description: 'Test and inspect the unit; pass it or raise a nonconformance.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'manufacturing|supply chain & fulfillment',
      industryLabel: 'Manufacturing — Supply Chain & Fulfillment',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Supply Chain & Fulfillment',
            description: 'Procure and receive material, and pick and ship finished orders.',
            purpose: 'Keep the line fed and get finished goods to the customer on time.',
            businessOutcome: 'Material available when needed and orders shipped on time and complete.',
            processes: [
              { name: 'Procurement', description: 'Place purchase orders and receive and inspect material.', purpose: 'Get the right material in on time and to spec.', activities: [
                { name: 'Place & confirm PO', description: 'Raise the purchase order against the requirement and confirm it.' },
                { name: 'Receive & inspect material', description: 'Receive, run incoming inspection, and post to inventory.' },
              ] },
              { name: 'Fulfillment', description: 'Pick, pack, and ship finished-goods orders.', purpose: 'Deliver complete orders on time.', activities: [
                { name: 'Pick & ship order', description: 'Allocate inventory, pick and pack the order, and ship it.' },
                { name: 'Confirm delivery', description: 'Confirm delivery and close the shipment.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgForgeline.id,
    cdoId: marcusf.id,
    govLeadId: lenav.id,
    dataOwnerId: hector.id,
    stewardIds: [marta.id, vikram.id],
    tenantName: 'Forgeline Manufacturing',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgForgeline.id,
    domainIds: [domEng.id, domProd.id, domQuality.id],
    cdoId: marcusf.id,
    govLeadId: lenav.id,
    dataOwnerId: hector.id,
    stewardId: marta.id,
    techStewardId: vikram.id,
    engineerId: neel.id,
    architectId: erin.id,
    raciNodeId: actMachine.id,
    raciPersonId: renata.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgForgeline.id, ownerId: marta.id, cdoId: marcusf.id, domainId: domEng.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgForgeline.id, orgPlant.id, orgSupply.id],
    links: [
      { id: demoId('lin-1'), orgId: orgForgeline.id, sourceSystemId: sysERP.id, targetSystemId: sysWarehouse.id, dataAssetId: assetInventory.id, description: 'ERP inventory + receipts sync nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-2'), orgId: orgPlant.id, sourceSystemId: sysMES.id, targetSystemId: sysWarehouse.id, dataAssetId: assetWorkOrders.id, description: 'Shop-floor work order status feeds the warehouse.', flowType: 'ETL', frequency: 'HOURLY' },
      { id: demoId('lin-3'), orgId: orgPlant.id, sourceSystemId: sysHistorian.id, targetSystemId: sysWarehouse.id, dataAssetId: assetMachineTelemetry.id, description: 'Machine historian tags stream into the warehouse.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgForgeline.id, sourceAssetId: assetProductMaster.id, targetAssetId: assetWorkOrders.id },
      { id: demoId('edge-2'), orgId: orgPlant.id, sourceAssetId: assetMachineTelemetry.id, targetAssetId: assetInspection.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgForgeline.id, agentId: demoId('agent-ppap-gen'), agentName: 'PPAP Package Generator', activityId: actInspect.id, activityName: 'Final test & inspect', roleType: 'TECHNICAL_DATA_STEWARD', createdBy: marcusf.id, reviewerId: lenav.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgForgeline.id, assetId: assetProductMaster.id, systemId: sysPLM.id, personId: marta.id, personName: 'Marta Silva' });

  logger.info({ persona: marcusf.name }, 'Demo data seeded (manufacturing)');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: marcusf.id, name: marcusf.name },
  };
}

/**
 * Financial Services profile — a Harborstone Financial bank holding company
 * (Retail Banking + Wealth & Markets + Shared Services), persona Grace Lin
 * (CDO). Same fixed-count skeleton and story shape as the other profiles:
 * two planted orphan assets on the warehouse, and a failing DQ rule
 * co-located with the ownership issue on the Bronze/critical AML Alerts
 * asset — the regulatory-reporting story the Financial Services industry
 * page leads with (BCBS 239 lineage, financial-crime monitoring).
 */
async function seedFinancial(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {
  // ── Organizations (company → 3 divisions → 6 departments) ──
  const orgHarborstone = { id: demoId('org-harborstone'), parentId: null, name: 'Harborstone Financial', type: 'company', industry: 'Financial Services', description: 'Bank holding company demo tenant — retail banking + wealth & markets + shared services.', headCount: 0, tenantSlug: 'harborstone', brandDisplayName: 'Harborstone Financial', brandGlyph: '＄', ssoButtonLabel: 'Sign in with Harborstone SSO', brandPrimaryColor: '#1e40af', createdAt: ts, updatedAt: ts };
  const orgRetail = { id: demoId('org-retail'), parentId: orgHarborstone.id, name: 'Retail Banking', type: 'division', industry: 'Financial Services', description: 'Deposits, payments, and lending', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWealth = { id: demoId('org-wealth'), parentId: orgHarborstone.id, name: 'Wealth & Markets', type: 'division', industry: 'Financial Services', description: 'Wealth management and capital markets', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgFinShared = { id: demoId('org-finshared'), parentId: orgHarborstone.id, name: 'Shared Services', type: 'division', industry: 'Financial Services', description: 'IT / Risk & Compliance', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgDeposits = { id: demoId('org-deposits'), parentId: orgRetail.id, name: 'Deposits & Payments', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgLending = { id: demoId('org-lending'), parentId: orgRetail.id, name: 'Lending', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWealthMgmt = { id: demoId('org-wealthmgmt'), parentId: orgWealth.id, name: 'Wealth Management', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgMarkets = { id: demoId('org-markets'), parentId: orgWealth.id, name: 'Capital Markets', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgFinIT = { id: demoId('org-finit'), parentId: orgFinShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgRiskComp = { id: demoId('org-riskcomp'), parentId: orgFinShared.id, name: 'Risk & Compliance', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgHarborstone, orgRetail, orgWealth, orgFinShared, orgDeposits, orgLending, orgWealthMgmt, orgMarkets, orgFinIT, orgRiskComp]);

  // ── People (24) — persona Grace Lin (CDO) ──
  const grace = { id: demoId('person-grace-lin'), orgIds: [orgHarborstone.id], accessibleOrgIds: [orgHarborstone.id, orgRetail.id, orgWealth.id, orgFinShared.id, orgDeposits.id, orgLending.id, orgWealthMgmt.id, orgMarkets.id, orgFinIT.id, orgRiskComp.id], name: 'Grace Lin', email: 'grace.lin@harborstone.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const daniel = { id: demoId('person-daniel-roth'), orgIds: [orgHarborstone.id], accessibleOrgIds: [orgHarborstone.id], name: 'Daniel Roth', email: 'daniel.roth@harborstone.com', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const nadia = { id: demoId('person-nadia'), orgIds: [orgRetail.id], accessibleOrgIds: [orgRetail.id], name: 'Nadia Haddad', email: 'nadia.haddad@harborstone.com', role: 'ORG_ADMIN', title: 'Data Owner Retail Banking', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const oliver = { id: demoId('person-oliver'), orgIds: [orgDeposits.id], accessibleOrgIds: [orgDeposits.id, orgRetail.id], name: 'Oliver Bennett', email: 'oliver.bennett@harborstone.com', role: 'EDITOR', title: 'Director Deposits & Payments', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const chloe = { id: demoId('person-chloe'), orgIds: [orgDeposits.id], accessibleOrgIds: [orgDeposits.id], name: 'Chloe Martin', email: 'chloe.martin@harborstone.com', role: 'CONTRIBUTOR', title: 'Payments Product Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const raj = { id: demoId('person-raj'), orgIds: [orgDeposits.id], accessibleOrgIds: [orgDeposits.id], name: 'Raj Malhotra', email: 'raj.malhotra@harborstone.com', role: 'CONTRIBUTOR', title: 'Data Steward Deposits', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sofia = { id: demoId('person-sofia'), orgIds: [orgDeposits.id], accessibleOrgIds: [orgDeposits.id], name: 'Sofia Reyes', email: 'sofia.reyes@harborstone.com', role: 'CONTRIBUTOR', title: 'Payments Operations Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const wesley = { id: demoId('person-wesley'), orgIds: [orgLending.id], accessibleOrgIds: [orgLending.id], name: 'Wesley Grant', email: 'wesley.grant@harborstone.com', role: 'EDITOR', title: 'Manager Lending', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const tara = { id: demoId('person-tara'), orgIds: [orgLending.id], accessibleOrgIds: [orgLending.id], name: 'Tara Nolan', email: 'tara.nolan@harborstone.com', role: 'CONTRIBUTOR', title: 'Data Steward Lending', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const felix = { id: demoId('person-felix'), orgIds: [orgLending.id], accessibleOrgIds: [orgLending.id], name: 'Felix Osei', email: 'felix.osei@harborstone.com', role: 'CONTRIBUTOR', title: 'Credit Risk Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const jerome = { id: demoId('person-jerome'), orgIds: [orgWealth.id], accessibleOrgIds: [orgWealth.id], name: 'Jerome Blake', email: 'jerome.blake@harborstone.com', role: 'ORG_ADMIN', title: 'Data Owner Wealth & Markets', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const amara = { id: demoId('person-amara'), orgIds: [orgWealthMgmt.id], accessibleOrgIds: [orgWealthMgmt.id, orgWealth.id], name: 'Amara Okoye', email: 'amara.okoye@harborstone.com', role: 'EDITOR', title: 'Director Wealth Management', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const henrik = { id: demoId('person-henrik'), orgIds: [orgWealthMgmt.id], accessibleOrgIds: [orgWealthMgmt.id], name: 'Henrik Sund', email: 'henrik.sund@harborstone.com', role: 'CONTRIBUTOR', title: 'Data Steward Wealth', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const bianca = { id: demoId('person-bianca'), orgIds: [orgWealthMgmt.id], accessibleOrgIds: [orgWealthMgmt.id], name: 'Bianca Ferraro', email: 'bianca.ferraro@harborstone.com', role: 'CONTRIBUTOR', title: 'Portfolio Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const victor = { id: demoId('person-victor'), orgIds: [orgMarkets.id], accessibleOrgIds: [orgMarkets.id, orgWealth.id], name: 'Victor Cheng', email: 'victor.cheng@harborstone.com', role: 'EDITOR', title: 'Manager Capital Markets', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const leilani = { id: demoId('person-leilani'), orgIds: [orgMarkets.id], accessibleOrgIds: [orgMarkets.id], name: 'Leilani Cruz', email: 'leilani.cruz@harborstone.com', role: 'CONTRIBUTOR', title: 'Data Steward Markets', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const neil = { id: demoId('person-neil'), orgIds: [orgFinIT.id], accessibleOrgIds: [orgFinIT.id], name: 'Neil Abbott', email: 'neil.abbott@harborstone.com', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const erica = { id: demoId('person-erica'), orgIds: [orgFinIT.id], accessibleOrgIds: [orgFinIT.id], name: 'Erica Vance', email: 'erica.vance@harborstone.com', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const karim = { id: demoId('person-karim'), orgIds: [orgFinIT.id], accessibleOrgIds: [orgFinIT.id], name: 'Karim Fadel', email: 'karim.fadel@harborstone.com', role: 'EDITOR', title: 'Manager Information Security', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sylvia = { id: demoId('person-sylvia'), orgIds: [orgRiskComp.id], accessibleOrgIds: [orgRiskComp.id], name: 'Sylvia Moreno', email: 'sylvia.moreno@harborstone.com', role: 'EDITOR', title: 'Director Risk & Compliance', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const anil = { id: demoId('person-anil'), orgIds: [orgRiskComp.id], accessibleOrgIds: [orgRiskComp.id], name: 'Anil Kapoor', email: 'anil.kapoor@harborstone.com', role: 'CONTRIBUTOR', title: 'Data Steward Risk Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const rowan = { id: demoId('person-rowan'), orgIds: [orgRiskComp.id], accessibleOrgIds: [orgRiskComp.id], name: 'Rowan Fitzgerald', email: 'rowan.fitzgerald@harborstone.com', role: 'CONTRIBUTOR', title: 'BSA / AML Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const petra = { id: demoId('person-petra'), orgIds: [orgRiskComp.id], accessibleOrgIds: [orgRiskComp.id], name: 'Petra Novak', email: 'petra.novak@harborstone.com', role: 'EDITOR', title: 'Manager Regulatory Reporting', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const beatrice = { id: demoId('person-beatrice'), orgIds: [orgRiskComp.id], accessibleOrgIds: [orgRiskComp.id], name: 'Beatrice Lund', email: 'beatrice.lund@harborstone.com', role: 'EDITOR', title: 'Manager Financial Crime', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [grace, daniel, nadia, oliver, chloe, raj, sofia, wesley, tara, felix, jerome, amara, henrik, bianca, victor, leilani, neil, erica, karim, sylvia, anil, rowan, petra, beatrice]);

  // ── Systems (8) — core banking / LOS / cards / wealth / markets / CRM / warehouse + AML ──
  const sysCore = { id: demoId('sys-core'), orgId: orgHarborstone.id, name: 'Core Banking', description: 'Core banking platform — deposit accounts, general ledger, postings.', systemType: 'IT', vendorName: 'FIS Modern Banking', ownerPersonId: neil.id, stewardIds: [raj.id], createdAt: ts, updatedAt: ts };
  const sysLOS = { id: demoId('sys-los'), orgId: orgRetail.id, name: 'Loan Origination System', description: 'Loan origination — applications, underwriting decisions, and booking.', systemType: 'IT', vendorName: 'nCino', ownerPersonId: tara.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysCards = { id: demoId('sys-cards'), orgId: orgRetail.id, name: 'Cards & Payments', description: 'Card authorization, settlement, and payment rails (ACH / wire).', systemType: 'IT', vendorName: 'TSYS', ownerPersonId: chloe.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysWealthPlatform = { id: demoId('sys-wealth'), orgId: orgWealth.id, name: 'Wealth Platform', description: 'Brokerage and portfolio management — holdings, positions, and advice.', systemType: 'IT', vendorName: 'Envestnet', ownerPersonId: henrik.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysMarketsPlatform = { id: demoId('sys-markets'), orgId: orgWealth.id, name: 'Trading Platform', description: 'Capital-markets order and execution management for traded instruments.', systemType: 'IT', vendorName: 'Charles River', ownerPersonId: leilani.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysCRM = { id: demoId('sys-fcrm'), orgId: orgHarborstone.id, name: 'CRM', description: 'Customer relationship management — the customer master and KYC profile.', systemType: 'IT', vendorName: 'Salesforce Financial Services Cloud', ownerPersonId: nadia.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgHarborstone.id, name: 'Data Warehouse', description: 'Enterprise analytics and regulatory-reporting warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: neil.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysAML = { id: demoId('sys-aml'), orgId: orgRiskComp.id, name: 'Financial Crime Platform', description: 'Transaction monitoring, sanctions screening, and case management (AML / fraud).', systemType: 'IT', vendorName: 'NICE Actimize', ownerPersonId: rowan.id, stewardIds: [anil.id], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysCore, sysLOS, sysCards, sysWealthPlatform, sysMarketsPlatform, sysCRM, sysWarehouse, sysAML]);

  // ── Agents (5 — one of each type) ──
  await createAll(repos.agents, [
    { id: demoId('agent-credit-model'), orgIds: [orgRetail.id], name: 'Credit Decisioning Model', agentType: 'AI', description: 'Scores loan applications for credit risk from bureau and application data.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: felix.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-reg-pipeline'), orgIds: [orgHarborstone.id], name: 'Regulatory Data Pipeline', agentType: 'PIPELINE', description: 'Nightly ETL of core banking + cards data into the reporting warehouse.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: neil.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-fraud-bot'), orgIds: [orgRiskComp.id], name: 'Fraud Alert Bot', agentType: 'BOT', description: 'Notifies analysts when transaction monitoring raises a high-risk alert.', provider: 'Microsoft Teams', status: 'ACTIVE', ownerPersonId: rowan.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-core-service'), orgIds: [orgFinIT.id], name: 'Core Extract Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract core banking tables.', provider: 'FIS', status: 'ACTIVE', ownerPersonId: neil.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-reg-gen'), orgIds: [orgHarborstone.id], name: 'Regulatory Report Generator', agentType: 'OTHER', description: 'Scheduled generator assembling BCBS 239 risk-aggregation and regulatory submission packages.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: petra.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains (3 top-level + 3 sub-domains under Transactions & Payments) ──
  const domCustomer = { id: demoId('domain-customer'), code: 'CUST', orgId: orgHarborstone.id, name: 'Customer & Account Data', description: 'Customer master, KYC profiles, and the accounts and holdings they own.', ownerId: grace.id, stewardIds: [raj.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domTxn = { id: demoId('domain-txn'), code: 'TXN', orgId: orgHarborstone.id, name: 'Transactions & Payments', description: 'Deposit postings, card and payment transactions, and the loan portfolio.', ownerId: nadia.id, stewardIds: [raj.id, tara.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domRisk = { id: demoId('domain-risk'), code: 'RISK', orgId: orgHarborstone.id, name: 'Risk & Regulatory Data', description: 'Financial-crime alerts and the regulatory-reporting datasets (BCBS 239).', ownerId: sylvia.id, stewardIds: [anil.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Sub-domains under Transactions & Payments — the retail money-movement areas. Parent created first.
  const domTxnDeposits = { id: demoId('domain-txn-deposits'), code: 'TXN-01', orgId: orgHarborstone.id, name: 'Deposits & Accounts', description: 'Deposit account balances, postings, and the general ledger.', ownerId: nadia.id, stewardIds: [raj.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domTxn.id, createdAt: ts, updatedAt: ts };
  const domTxnCards = { id: demoId('domain-txn-cards'), code: 'TXN-02', orgId: orgHarborstone.id, name: 'Card Payments', description: 'Card authorizations, settlements, and payment-rail transactions.', ownerId: nadia.id, stewardIds: [chloe.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domTxn.id, createdAt: ts, updatedAt: ts };
  const domTxnLending = { id: demoId('domain-txn-lending'), code: 'TXN-03', orgId: orgHarborstone.id, name: 'Lending', description: 'Loan applications, decisions, and the serviced loan portfolio.', ownerId: wesley.id, stewardIds: [tara.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domTxn.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domCustomer, domTxn, domRisk, domTxnDeposits, domTxnCards, domTxnLending]);

  // ── Data Assets (9) ──
  const assetCustomerMaster = { id: demoId('asset-customer-master'), orgId: orgHarborstone.id, name: 'Customer Master', description: 'The golden customer record — identity, KYC profile, and relationships.', systemId: sysCRM.id, owner: '', ownerPersonId: nadia.id, stewardIds: [raj.id] as string[], governanceTier: 'GOLD' as const, healthScore: 91, createdAt: ts, updatedAt: ts };
  const assetAccountLedger = { id: demoId('asset-account-ledger'), orgId: orgHarborstone.id, name: 'Deposit Accounts Ledger', description: 'Deposit account balances and postings from the core banking general ledger.', systemId: sysCore.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 86, createdAt: ts, updatedAt: ts };
  const assetCardTxns = { id: demoId('asset-card-txns'), orgId: orgHarborstone.id, name: 'Card Transactions', description: 'Authorized and settled card and payment-rail transactions.', systemId: sysCards.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 82, createdAt: ts, updatedAt: ts };
  const assetLoanPortfolio = { id: demoId('asset-loan-portfolio'), orgId: orgHarborstone.id, name: 'Loan Portfolio', description: 'Booked and serviced loans — balances, terms, delinquency, and repayments.', systemId: sysLOS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, createdAt: ts, updatedAt: ts };
  const assetAmlAlerts = { id: demoId('asset-aml-alerts'), orgId: orgHarborstone.id, name: 'AML Alerts', description: 'Transaction-monitoring alerts, dispositions, and suspicious-activity cases.', systemId: sysAML.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 56, createdAt: ts, updatedAt: ts };
  const assetRegReporting = { id: demoId('asset-reg-reporting'), orgId: orgHarborstone.id, name: 'Regulatory Reporting Dataset', description: 'The reconciled risk-aggregation dataset behind regulatory filings (BCBS 239).', systemId: sysWarehouse.id, owner: '', ownerPersonId: petra.id, stewardIds: [anil.id] as string[], governanceTier: 'GOLD' as const, healthScore: 93, createdAt: ts, updatedAt: ts };
  const assetWealthHoldings = { id: demoId('asset-wealth-holdings'), orgId: orgHarborstone.id, name: 'Wealth Holdings', description: 'Client portfolio positions and holdings across managed accounts.', systemId: sysWealthPlatform.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 83, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's orphan-detection returns a quotable answer.
  const orphanLegacyCore = { id: demoId('asset-legacy-core'), orgId: orgHarborstone.id, name: 'Legacy Core Extract', description: 'Nightly dump from the retired core banking system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanFraudCsv = { id: demoId('asset-fraud-csv'), orgId: orgHarborstone.id, name: 'Fraud CSV Dump', description: 'Ad-hoc CSV extract of fraud losses for an old reporting deck. Nobody remembers if it is still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetCustomerMaster, assetAccountLedger, assetCardTxns, assetLoanPortfolio, assetAmlAlerts, assetRegReporting, assetWealthHoldings, orphanLegacyCore, orphanFraudCsv]);

  // Domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domCustomer.id, { dataAssetIds: [assetCustomerMaster.id, assetWealthHoldings.id] });
  await repos.dataDomains.update(domTxn.id, { dataAssetIds: [assetAccountLedger.id, assetCardTxns.id, assetLoanPortfolio.id] });
  await repos.dataDomains.update(domRisk.id, { dataAssetIds: [assetAmlAlerts.id, assetRegReporting.id] });

  // ── Process hierarchy — VS1 Consumer Lending (Retail Banking) ──
  const vsLending = { id: demoId('node-vs-lending'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Consumer Lending', description: 'End-to-end lending — take the application, decision it, and service the loan.', activityId: 'VS-DEMO-F1', status: 'ACTIVE', orderIndex: 0, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: nadia.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procOriginate = { id: demoId('node-proc-originate'), parentId: vsLending.id, level: 'PROCESS' as const, name: 'Loan Origination', description: 'Capture the application, underwrite it, and decision the loan.', activityId: 'PRO-DEMO-F1', status: 'ACTIVE', orderIndex: 0, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: wesley.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procServicing = { id: demoId('node-proc-servicing'), parentId: vsLending.id, level: 'PROCESS' as const, name: 'Loan Servicing', description: 'Board the approved loan and service repayments over its life.', activityId: 'PRO-DEMO-F2', status: 'ACTIVE', orderIndex: 1, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: oliver.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spApplication = { id: demoId('node-sp-application'), parentId: procOriginate.id, level: 'SUBPROCESS' as const, name: 'Application & Underwriting', description: 'Take the application and underwrite the credit decision.', activityId: 'SP-DEMO-F1', status: 'ACTIVE', orderIndex: 0, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: felix.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actCapture = { id: demoId('node-act-capture'), parentId: spApplication.id, level: 'ACTIVITY' as const, name: 'Capture application', description: 'Take the borrower application and pull identity and KYC from the customer master.', activityId: 'ACT-DEMO-F1', status: 'ACTIVE', orderIndex: 0, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: tara.id, responsibleRole: 'Data Steward Lending', responsiblePersonId: tara.id, systemIds: [sysLOS.id, sysCRM.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actUnderwrite = { id: demoId('node-act-underwrite'), parentId: spApplication.id, level: 'ACTIVITY' as const, name: 'Underwrite & decision', description: 'Score the application for credit risk and approve, decline, or refer it.', activityId: 'ACT-DEMO-F2', status: 'ACTIVE', orderIndex: 1, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: felix.id, responsibleRole: 'Credit Risk Analyst', responsiblePersonId: felix.id, systemIds: [sysLOS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Decision SLA met on ≥ 95% of applications\n\nNo decision on stale bureau data', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actBoard = { id: demoId('node-act-board'), parentId: procServicing.id, level: 'ACTIVITY' as const, name: 'Board & service loan', description: 'Book the approved loan to the core ledger and open it for servicing.', activityId: 'ACT-DEMO-F3', status: 'ACTIVE', orderIndex: 0, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: oliver.id, responsibleRole: 'Data Steward Lending', responsiblePersonId: tara.id, systemIds: [sysCore.id, sysLOS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actRepay = { id: demoId('node-act-repay'), parentId: procServicing.id, level: 'ACTIVITY' as const, name: 'Process repayments', description: 'Post scheduled repayments against the loan and reconcile to the ledger.', activityId: 'ACT-DEMO-F4', status: 'ACTIVE', orderIndex: 1, orgId: orgRetail.id, orgIds: [orgRetail.id], ownerId: oliver.id, responsibleRole: 'Data Steward Deposits', responsiblePersonId: raj.id, systemIds: [sysCore.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Repayments posted same day and reconciled', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsLending, procOriginate, procServicing, spApplication, actCapture, actUnderwrite, actBoard, actRepay]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-f1'), fromNodeId: actCapture.id, toNodeId: actUnderwrite.id, type: 'SEQUENCE' as const, label: 'application taken', createdAt: ts },
    { id: demoId('flow-f2'), fromNodeId: actUnderwrite.id, toNodeId: actBoard.id, type: 'SEQUENCE' as const, label: 'loan approved', createdAt: ts },
    { id: demoId('flow-f3'), fromNodeId: actBoard.id, toNodeId: actRepay.id, type: 'SEQUENCE' as const, label: 'loan booked', createdAt: ts },
  ]);

  // ── Process hierarchy — VS2 Financial Crime & Regulatory Reporting (Risk & Compliance) ──
  const vsFincrime = { id: demoId('node-vs-fincrime'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Financial Crime & Regulatory Reporting', description: 'Monitor transactions for financial crime, investigate alerts, and file regulatory reports.', activityId: 'VS-DEMO-F2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgFinShared.id, orgIds: [orgFinShared.id], ownerId: sylvia.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procMonitoring = { id: demoId('node-proc-monitoring'), parentId: vsFincrime.id, level: 'PROCESS' as const, name: 'Transaction Monitoring', description: 'Screen transactions for financial crime and triage the alerts.', activityId: 'PRO-DEMO-F3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgFinShared.id, orgIds: [orgFinShared.id], ownerId: rowan.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procReporting = { id: demoId('node-proc-reporting'), parentId: vsFincrime.id, level: 'PROCESS' as const, name: 'Regulatory Reporting', description: 'Assemble and file the required regulatory reports.', activityId: 'PRO-DEMO-F4', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgFinShared.id, orgIds: [orgFinShared.id], ownerId: petra.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spTriage = { id: demoId('node-sp-triage'), parentId: procMonitoring.id, level: 'SUBPROCESS' as const, name: 'Alert Triage', description: 'Screen transactions and triage the monitoring alerts.', activityId: 'SP-DEMO-F2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgFinShared.id, orgIds: [orgFinShared.id], ownerId: rowan.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actScreen = { id: demoId('node-act-screen'), parentId: spTriage.id, level: 'ACTIVITY' as const, name: 'Screen transactions', description: 'Run transaction monitoring and sanctions screening and raise alerts.', activityId: 'ACT-DEMO-F5', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgFinShared.id, orgIds: [orgFinShared.id], ownerId: rowan.id, responsibleRole: 'BSA / AML Officer', responsiblePersonId: rowan.id, systemIds: [sysAML.id, sysCards.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actInvestigate = { id: demoId('node-act-investigate'), parentId: procMonitoring.id, level: 'ACTIVITY' as const, name: 'Investigate & disposition alert', description: 'Investigate the alert, decide it, and record the suspicious-activity case.', activityId: 'ACT-DEMO-F6', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgFinShared.id, orgIds: [orgFinShared.id], ownerId: beatrice.id, responsibleRole: 'BSA / AML Officer', responsiblePersonId: rowan.id, systemIds: [sysAML.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Every alert dispositioned within the review SLA', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actFileReport = { id: demoId('node-act-filereport'), parentId: procReporting.id, level: 'ACTIVITY' as const, name: 'File regulatory report', description: 'Reconcile the risk-aggregation dataset and file the regulatory report.', activityId: 'ACT-DEMO-F7', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgFinShared.id, orgIds: [orgFinShared.id], ownerId: petra.id, responsibleRole: 'Data Steward Risk Evidence', responsiblePersonId: anil.id, systemIds: [sysWarehouse.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, successMeasure: 'Filings complete, reconciled, and on time', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsFincrime, procMonitoring, procReporting, spTriage, actScreen, actInvestigate, actFileReport]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-f4'), fromNodeId: actScreen.id, toNodeId: actInvestigate.id, type: 'SEQUENCE' as const, label: 'alert raised', createdAt: ts },
  ]);

  // ── Mappings (7) ──
  await createAll(repos.mappings, [
    { id: demoId('map-f1'), orgId: orgRetail.id, processStepId: actCapture.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Pulls identity + KYC from the customer master', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-f2'), orgId: orgRetail.id, processStepId: actUnderwrite.id, dataAssetId: assetLoanPortfolio.id, linkType: 'OUTPUT', notes: 'Writes the decisioned loan to the portfolio', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-f3'), orgId: orgRetail.id, processStepId: actBoard.id, dataAssetId: assetAccountLedger.id, linkType: 'OUTPUT', notes: 'Books the loan to the core ledger', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-f4'), orgId: orgRetail.id, processStepId: actRepay.id, dataAssetId: assetAccountLedger.id, linkType: 'INPUT', notes: 'Posts repayments against the ledger', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-f5'), orgId: orgFinShared.id, processStepId: actScreen.id, dataAssetId: assetCardTxns.id, linkType: 'INPUT', notes: 'Screens card + payment transactions', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-f6'), orgId: orgFinShared.id, processStepId: actInvestigate.id, dataAssetId: assetAmlAlerts.id, linkType: 'OUTPUT', notes: 'Writes the alert disposition + case', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-f7'), orgId: orgFinShared.id, processStepId: actFileReport.id, dataAssetId: assetRegReporting.id, linkType: 'OUTPUT', notes: 'Produces the reconciled regulatory dataset', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Grace (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-f1'), orgId: orgHarborstone.id, title: 'Approve AML Alerts classification review', description: 'Review the AI-suggested sensitivity tags on AML Alerts and the Regulatory Reporting Dataset and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: grace.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetAmlAlerts.id, automationMode: 'HUMAN' as any, createdBy: daniel.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-f2'), orgId: orgHarborstone.id, title: 'Sign off on Risk & Regulatory domain scope', description: 'Sylvia has proposed expanding the Risk & Regulatory domain to cover new BCBS 239 aggregation fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: grace.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domRisk.id, automationMode: 'HUMAN' as any, createdBy: sylvia.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-f3'), orgId: orgHarborstone.id, title: 'Retire Legacy Core Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: grace.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyCore.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Grace ──
  await repos.governanceIssues.create({
    id: demoId('issue-f1'),
    orgId: orgHarborstone.id,
    title: 'AML Alerts tier below Silver — critical process, ungoverned',
    description: 'AML Alerts is BRONZE tier but the Transaction Monitoring process writes it as the primary financial-crime evidence. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domRisk.id,
    dataAssetId: assetAmlAlerts.id,
    systemId: sysAML.id,
    reportedBy: daniel.id,
    assignedTo: grace.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules (2 — one passing, one failing) ──
  await createAll(repos.dataQualityRules, [
    {
      id: demoId('dq-rule-passing'), orgId: orgHarborstone.id, dataAssetId: assetAccountLedger.id,
      dimension: 'COMPLETENESS' as const, name: 'Deposit Accounts · posting completeness',
      description: 'At least 95% of ledger postings must carry a complete account + amount + date.',
      threshold: 95, currentScore: 98, weight: 1, status: 'PASSING' as const,
      lastMeasured: ts, scheduleFrequency: 'DAILY' as const, nextRunAt: daysFromNow(1), createdAt: ts, updatedAt: ts,
    },
    {
      id: demoId('dq-rule-failing'), orgId: orgHarborstone.id, dataAssetId: assetAmlAlerts.id,
      dimension: 'TIMELINESS' as const, name: 'AML Alerts · alert review latency',
      description: 'Monitoring alerts should be dispositioned within the review SLA. Rolling 24h.',
      threshold: 95, currentScore: 56, weight: 1, status: 'FAILING' as const,
      lastMeasured: ts, scheduleFrequency: 'HOURLY' as const, nextRunAt: daysFromNow(0), createdAt: ts, updatedAt: ts,
    },
  ]);

  // ── Edge connector (ONLINE) ──
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-harborstone'), orgId: orgHarborstone.id, name: 'Harborstone Core Data Connector',
    tokenHash: '7a1b9c2d38e0f41b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b',
    pairingCode: null, pairingCodeExpiresAt: null,
    systemIds: [sysCore.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt, agentVersion: '1.2.0', status: 'ONLINE' as const,
    createdAt: connectorCreatedAt, updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  await repos.dataAssets.update(assetAccountLedger.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  await createAll(repos.connectorEvents, [
    { id: demoId('ce-f-paired'), connectorId: conn.id, orgId: orgHarborstone.id, type: 'PAIRED', ts: connectorCreatedAt, data: { agentVersion: '1.2.0' } },
    { id: demoId('ce-f-scan-start'), connectorId: conn.id, orgId: orgHarborstone.id, type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: { targetSystemIds: [sysCore.id, sysWarehouse.id] } },
    { id: demoId('ce-f-scan-done'), connectorId: conn.id, orgId: orgHarborstone.id, type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(), data: { durationMs: 41_030, assetsDiscovered: 1 } },
    { id: demoId('ce-f-assets'), connectorId: conn.id, orgId: orgHarborstone.id, type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(), data: { incoming: 1, created: 0, updated: 1 } },
    { id: demoId('ce-f-hb'), connectorId: conn.id, orgId: orgHarborstone.id, type: 'HEARTBEAT', ts: connectorHeartbeatAt, data: { agentVersion: '1.2.0' } },
  ]);

  // ── Second connector — PAIRING state ──
  const pairingConn = {
    id: demoId('conn-f-pairing'), orgId: orgHarborstone.id, name: 'Branch Ledger Connector',
    tokenHash: null, pairingCode: '73916024',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[], lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-f-dgc'),
    orgId: orgHarborstone.id,
    name: 'Data Governance Council weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [grace.id, daniel.id, nadia.id, sylvia.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgHarborstone.id, { coverage: 64, avgHealth: 72, gaps: 8, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgRetail.id, { coverage: 72, avgHealth: 74, gaps: 4, dataAssets: 4, mappings: 4 }),
    ...weeklySnapshots(orgWealth.id, { coverage: 61, avgHealth: 76, gaps: 3, dataAssets: 1, mappings: 0 }),
    ...weeklySnapshots(orgFinShared.id, { coverage: 55, avgHealth: 70, gaps: 4, dataAssets: 2, mappings: 3 }),
  ]);

  // ── AI template cache — pre-warm the wand for Harborstone ──
  aiTemplateCache.push(
    {
      industry: 'financial|consumer lending',
      industryLabel: 'Financial Services — Consumer Lending',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Consumer Lending',
            description: 'Take the application, underwrite it, and service the loan.',
            purpose: 'Originate sound loans quickly and service them cleanly over their life.',
            businessOutcome: 'On-SLA decisions, well-booked loans, and reconciled repayments.',
            processes: [
              { name: 'Loan Origination', description: 'Capture the application, underwrite it, and decision the loan.', purpose: 'Turn an application into a sound credit decision.', activities: [
                { name: 'Capture application', description: 'Take the application and pull identity and KYC from the customer master.' },
                { name: 'Underwrite & decision', description: 'Score the application for credit risk and approve, decline, or refer it.' },
                { name: 'Verify & disburse', description: 'Verify conditions and disburse the approved funds.' },
              ] },
              { name: 'Loan Servicing', description: 'Board the loan and service repayments over its life.', purpose: 'Keep the loan accurate and repayments reconciled.', activities: [
                { name: 'Board & service loan', description: 'Book the approved loan to the core ledger and open it for servicing.' },
                { name: 'Process repayments', description: 'Post scheduled repayments and reconcile to the ledger.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'financial|financial crime & regulatory reporting',
      industryLabel: 'Financial Services — Financial Crime & Regulatory Reporting',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Financial Crime & Regulatory Reporting',
            description: 'Monitor transactions, investigate alerts, and file regulatory reports.',
            purpose: 'Catch financial crime and meet regulatory obligations with clean, traceable data.',
            businessOutcome: 'Alerts dispositioned on SLA and filings complete, reconciled, and on time.',
            processes: [
              { name: 'Transaction Monitoring', description: 'Screen transactions for financial crime and triage the alerts.', purpose: 'Surface suspicious activity and disposition it.', activities: [
                { name: 'Screen transactions', description: 'Run transaction monitoring and sanctions screening and raise alerts.' },
                { name: 'Investigate & disposition alert', description: 'Investigate the alert, decide it, and record the case.' },
              ] },
              { name: 'Regulatory Reporting', description: 'Assemble and file the required regulatory reports.', purpose: 'Meet filing obligations with reconciled data.', activities: [
                { name: 'File regulatory report', description: 'Reconcile the risk-aggregation dataset and file the report.' },
                { name: 'Attest & archive', description: 'Attest to the filing and archive the evidence.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgHarborstone.id,
    cdoId: grace.id,
    govLeadId: daniel.id,
    dataOwnerId: nadia.id,
    stewardIds: [raj.id, anil.id],
    tenantName: 'Harborstone Financial',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgHarborstone.id,
    domainIds: [domCustomer.id, domTxn.id, domRisk.id],
    cdoId: grace.id,
    govLeadId: daniel.id,
    dataOwnerId: nadia.id,
    stewardId: raj.id,
    techStewardId: anil.id,
    engineerId: neil.id,
    architectId: erica.id,
    raciNodeId: actUnderwrite.id,
    raciPersonId: felix.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgHarborstone.id, ownerId: raj.id, cdoId: grace.id, domainId: domCustomer.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgHarborstone.id, orgRetail.id, orgFinShared.id],
    links: [
      { id: demoId('lin-1'), orgId: orgHarborstone.id, sourceSystemId: sysCore.id, targetSystemId: sysWarehouse.id, dataAssetId: assetAccountLedger.id, description: 'Core banking ledger syncs nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-2'), orgId: orgRetail.id, sourceSystemId: sysLOS.id, targetSystemId: sysWarehouse.id, dataAssetId: assetLoanPortfolio.id, description: 'Loan portfolio status feeds the warehouse.', flowType: 'ETL', frequency: 'HOURLY' },
      { id: demoId('lin-3'), orgId: orgFinShared.id, sourceSystemId: sysAML.id, targetSystemId: sysWarehouse.id, dataAssetId: assetAmlAlerts.id, description: 'Financial-crime alerts stream into the warehouse for reporting.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgHarborstone.id, sourceAssetId: assetCustomerMaster.id, targetAssetId: assetAccountLedger.id },
      { id: demoId('edge-2'), orgId: orgFinShared.id, sourceAssetId: assetCardTxns.id, targetAssetId: assetAmlAlerts.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgHarborstone.id, agentId: demoId('agent-reg-gen'), agentName: 'Regulatory Report Generator', activityId: actFileReport.id, activityName: 'File regulatory report', roleType: 'TECHNICAL_DATA_STEWARD', createdBy: grace.id, reviewerId: daniel.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgHarborstone.id, assetId: assetCustomerMaster.id, systemId: sysCRM.id, personId: raj.id, personName: 'Raj Malhotra' });

  logger.info({ persona: grace.name }, 'Demo data seeded (financial)');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: grace.id, name: grace.name },
  };
}

/**
 * Government & Public Sector profile — a Lakeside County government
 * (Public Works + Health & Human Services + Shared Services), persona
 * Evelyn Park (CDO). Same fixed-count skeleton and story shape as the
 * other profiles: two planted orphan assets on the warehouse, and a
 * failing DQ rule co-located with the ownership issue on the
 * Bronze/critical Public Health Cases asset — the citizen/mission-data
 * accountability story (FISMA, data sovereignty) the industry page leads
 * with.
 */
async function seedGovernment(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {
  // ── Organizations (county → 3 divisions → 6 departments) ──
  const orgLakeside = { id: demoId('org-lakeside'), parentId: null, name: 'Lakeside County', type: 'company', industry: 'Government & Public Sector', description: 'County government demo tenant — public works + health & human services + shared services.', headCount: 0, tenantSlug: 'lakeside', brandDisplayName: 'Lakeside County', brandGlyph: '⚖', ssoButtonLabel: 'Sign in with Lakeside County SSO', brandPrimaryColor: '#334155', createdAt: ts, updatedAt: ts };
  const orgPublicWorks = { id: demoId('org-publicworks'), parentId: orgLakeside.id, name: 'Public Works', type: 'division', industry: 'Government & Public Sector', description: 'Roads, transportation, water, and sewer', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgHHS = { id: demoId('org-hhs'), parentId: orgLakeside.id, name: 'Health & Human Services', type: 'division', industry: 'Government & Public Sector', description: 'Public health and social services', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgGovShared = { id: demoId('org-govshared'), parentId: orgLakeside.id, name: 'Shared Services', type: 'division', industry: 'Government & Public Sector', description: 'IT / Finance & Records', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgRoads = { id: demoId('org-roads'), parentId: orgPublicWorks.id, name: 'Roads & Transportation', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWater = { id: demoId('org-water'), parentId: orgPublicWorks.id, name: 'Water & Sewer', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgPublicHealth = { id: demoId('org-publichealth'), parentId: orgHHS.id, name: 'Public Health', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgSocial = { id: demoId('org-social'), parentId: orgHHS.id, name: 'Social Services', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgGovIT = { id: demoId('org-govit'), parentId: orgGovShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgFinRecords = { id: demoId('org-finrecords'), parentId: orgGovShared.id, name: 'Finance & Records', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgLakeside, orgPublicWorks, orgHHS, orgGovShared, orgRoads, orgWater, orgPublicHealth, orgSocial, orgGovIT, orgFinRecords]);

  // ── People (24) — persona Evelyn Park (CDO) ──
  const evelyn = { id: demoId('person-evelyn-park'), orgIds: [orgLakeside.id], accessibleOrgIds: [orgLakeside.id, orgPublicWorks.id, orgHHS.id, orgGovShared.id, orgRoads.id, orgWater.id, orgPublicHealth.id, orgSocial.id, orgGovIT.id, orgFinRecords.id], name: 'Evelyn Park', email: 'evelyn.park@lakeside.gov', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const harold = { id: demoId('person-harold'), orgIds: [orgLakeside.id], accessibleOrgIds: [orgLakeside.id], name: 'Harold Diaz', email: 'harold.diaz@lakeside.gov', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gloria = { id: demoId('person-gloria'), orgIds: [orgPublicWorks.id], accessibleOrgIds: [orgPublicWorks.id], name: 'Gloria Mendez', email: 'gloria.mendez@lakeside.gov', role: 'ORG_ADMIN', title: 'Data Owner Public Works', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const dean = { id: demoId('person-dean'), orgIds: [orgRoads.id], accessibleOrgIds: [orgRoads.id, orgPublicWorks.id], name: 'Dean Foster', email: 'dean.foster@lakeside.gov', role: 'EDITOR', title: 'Director Roads & Transportation', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const nina = { id: demoId('person-nina'), orgIds: [orgRoads.id], accessibleOrgIds: [orgRoads.id], name: 'Nina Kowalski', email: 'nina.kowalski@lakeside.gov', role: 'CONTRIBUTOR', title: 'GIS Program Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const carlos = { id: demoId('person-carlos'), orgIds: [orgRoads.id], accessibleOrgIds: [orgRoads.id], name: 'Carlos Vega', email: 'carlos.vega@lakeside.gov', role: 'CONTRIBUTOR', title: 'Data Steward Roads', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const bruce = { id: demoId('person-bruce'), orgIds: [orgRoads.id], accessibleOrgIds: [orgRoads.id], name: 'Bruce Whitman', email: 'bruce.whitman@lakeside.gov', role: 'CONTRIBUTOR', title: 'Infrastructure Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lorena = { id: demoId('person-lorena'), orgIds: [orgWater.id], accessibleOrgIds: [orgWater.id], name: 'Lorena Cruz', email: 'lorena.cruz@lakeside.gov', role: 'EDITOR', title: 'Manager Water & Sewer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sanjay = { id: demoId('person-sanjay'), orgIds: [orgWater.id], accessibleOrgIds: [orgWater.id], name: 'Sanjay Rao', email: 'sanjay.rao@lakeside.gov', role: 'CONTRIBUTOR', title: 'Data Steward Water', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const tabitha = { id: demoId('person-tabitha'), orgIds: [orgWater.id], accessibleOrgIds: [orgWater.id], name: 'Tabitha Owens', email: 'tabitha.owens@lakeside.gov', role: 'CONTRIBUTOR', title: 'Utility Operations Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const desmond = { id: demoId('person-desmond'), orgIds: [orgHHS.id], accessibleOrgIds: [orgHHS.id], name: 'Desmond Clarke', email: 'desmond.clarke@lakeside.gov', role: 'ORG_ADMIN', title: 'Data Owner Health & Human Services', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const olivia = { id: demoId('person-olivia'), orgIds: [orgPublicHealth.id], accessibleOrgIds: [orgPublicHealth.id, orgHHS.id], name: 'Olivia Brandt', email: 'olivia.brandt@lakeside.gov', role: 'EDITOR', title: 'Director Public Health', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const amir = { id: demoId('person-amir'), orgIds: [orgPublicHealth.id], accessibleOrgIds: [orgPublicHealth.id], name: 'Amir Haddad', email: 'amir.haddad@lakeside.gov', role: 'CONTRIBUTOR', title: 'Data Steward Public Health', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const jade = { id: demoId('person-jade'), orgIds: [orgPublicHealth.id], accessibleOrgIds: [orgPublicHealth.id], name: 'Jade Lin', email: 'jade.lin@lakeside.gov', role: 'CONTRIBUTOR', title: 'Epidemiology Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const rosa = { id: demoId('person-rosa'), orgIds: [orgSocial.id], accessibleOrgIds: [orgSocial.id], name: 'Rosa Iglesias', email: 'rosa.iglesias@lakeside.gov', role: 'EDITOR', title: 'Manager Social Services', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kevin = { id: demoId('person-kevin'), orgIds: [orgSocial.id], accessibleOrgIds: [orgSocial.id], name: 'Kevin Ahn', email: 'kevin.ahn@lakeside.gov', role: 'CONTRIBUTOR', title: 'Data Steward Social Services', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const neal = { id: demoId('person-neal'), orgIds: [orgGovIT.id], accessibleOrgIds: [orgGovIT.id], name: 'Neal Whitfield', email: 'neal.whitfield@lakeside.gov', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const erika = { id: demoId('person-erika'), orgIds: [orgGovIT.id], accessibleOrgIds: [orgGovIT.id], name: 'Erika Voss', email: 'erika.voss@lakeside.gov', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kwame = { id: demoId('person-kwame'), orgIds: [orgGovIT.id], accessibleOrgIds: [orgGovIT.id], name: 'Kwame Boateng', email: 'kwame.boateng@lakeside.gov', role: 'EDITOR', title: 'Manager Information Security', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sylvie = { id: demoId('person-sylvie'), orgIds: [orgFinRecords.id], accessibleOrgIds: [orgFinRecords.id], name: 'Sylvie Marchand', email: 'sylvie.marchand@lakeside.gov', role: 'EDITOR', title: 'Director Finance & Records', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const anita = { id: demoId('person-anita'), orgIds: [orgFinRecords.id], accessibleOrgIds: [orgFinRecords.id], name: 'Anita Deshpande', email: 'anita.deshpande@lakeside.gov', role: 'CONTRIBUTOR', title: 'Data Steward Finance Records', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const roland = { id: demoId('person-roland'), orgIds: [orgFinRecords.id], accessibleOrgIds: [orgFinRecords.id], name: 'Roland Pierce', email: 'roland.pierce@lakeside.gov', role: 'CONTRIBUTOR', title: 'County Clerk / Records Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const paulette = { id: demoId('person-paulette'), orgIds: [orgFinRecords.id], accessibleOrgIds: [orgFinRecords.id], name: 'Paulette Simmons', email: 'paulette.simmons@lakeside.gov', role: 'EDITOR', title: 'Manager Regulatory Reporting', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const bernard = { id: demoId('person-bernard'), orgIds: [orgFinRecords.id], accessibleOrgIds: [orgFinRecords.id], name: 'Bernard Osei', email: 'bernard.osei@lakeside.gov', role: 'EDITOR', title: 'Manager Compliance & Audit', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [evelyn, harold, gloria, dean, nina, carlos, bruce, lorena, sanjay, tabitha, desmond, olivia, amir, jade, rosa, kevin, neal, erika, kwame, sylvie, anita, roland, paulette, bernard]);

  // ── Systems (8) — permitting / GIS / tax / public-health / benefits / financial / warehouse + 311 ──
  const sysPermitting = { id: demoId('sys-permitting'), orgId: orgPublicWorks.id, name: 'Permitting & Licensing System', description: 'Permit and license applications, reviews, inspections, and issuance.', systemType: 'IT', vendorName: 'Accela Civic Platform', ownerPersonId: dean.id, stewardIds: [carlos.id], createdAt: ts, updatedAt: ts };
  const sysGIS = { id: demoId('sys-gis'), orgId: orgPublicWorks.id, name: 'GIS', description: 'Geographic information system — parcels, roads, and infrastructure assets.', systemType: 'IT', vendorName: 'Esri ArcGIS', ownerPersonId: nina.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysTax = { id: demoId('sys-tax'), orgId: orgLakeside.id, name: 'Property & Tax System', description: 'Property assessment, tax roll, billing, and collections.', systemType: 'IT', vendorName: 'Tyler Technologies', ownerPersonId: sylvie.id, stewardIds: [anita.id], createdAt: ts, updatedAt: ts };
  const sysPublicHealth = { id: demoId('sys-publichealth'), orgId: orgHHS.id, name: 'Public Health Case System', description: 'Communicable-disease case management, investigations, and reporting.', systemType: 'IT', vendorName: 'NEDSS', ownerPersonId: olivia.id, stewardIds: [amir.id], createdAt: ts, updatedAt: ts };
  const sysBenefits = { id: demoId('sys-benefits'), orgId: orgHHS.id, name: 'Benefits Eligibility System', description: 'Social-services eligibility, enrollment, and case management.', systemType: 'IT', vendorName: 'Deloitte Health & Human Services', ownerPersonId: rosa.id, stewardIds: [kevin.id], createdAt: ts, updatedAt: ts };
  const sysFinancial = { id: demoId('sys-govfinancial'), orgId: orgLakeside.id, name: 'Financial System', description: 'County ERP — general ledger, budget, procurement, and payroll.', systemType: 'IT', vendorName: 'Workday', ownerPersonId: sylvie.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgLakeside.id, name: 'Data Warehouse', description: 'Enterprise analytics and open-data warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: neal.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sys311 = { id: demoId('sys-311'), orgId: orgGovShared.id, name: '311 Citizen Services', description: 'Citizen service requests, complaints, and case routing.', systemType: 'IT', vendorName: 'Salesforce Public Sector', ownerPersonId: roland.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysPermitting, sysGIS, sysTax, sysPublicHealth, sysBenefits, sysFinancial, sysWarehouse, sys311]);

  // ── Agents (5 — one of each type) ──
  await createAll(repos.agents, [
    { id: demoId('agent-forecast-model'), orgIds: [orgHHS.id], name: 'Outbreak Forecast Model', agentType: 'AI', description: 'Forecasts case trends from public-health case data to guide response.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: jade.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-openpipeline'), orgIds: [orgLakeside.id], name: 'Open Data Pipeline', agentType: 'PIPELINE', description: 'Nightly ETL of permitting, tax, and 311 data into the open-data warehouse.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: neal.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-311-bot'), orgIds: [orgGovShared.id], name: '311 Request Router Bot', agentType: 'BOT', description: 'Routes incoming citizen service requests to the responsible department.', provider: 'Microsoft Teams', status: 'ACTIVE', ownerPersonId: roland.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-gis-service'), orgIds: [orgGovIT.id], name: 'GIS Extract Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract GIS layers.', provider: 'Esri', status: 'ACTIVE', ownerPersonId: neal.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-report-gen'), orgIds: [orgLakeside.id], name: 'State Report Generator', agentType: 'OTHER', description: 'Scheduled generator assembling mandated state and federal reporting packages.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: paulette.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains (3 top-level + 3 sub-domains under Citizen & Case Data) ──
  const domCitizen = { id: demoId('domain-citizen'), code: 'CIT', orgId: orgLakeside.id, name: 'Citizen & Case Data', description: 'Resident registry, public-health cases, and social-services case records.', ownerId: evelyn.id, stewardIds: [amir.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domInfra = { id: demoId('domain-infra'), code: 'INF', orgId: orgLakeside.id, name: 'Infrastructure & Assets Data', description: 'Road and utility assets, GIS layers, and permits and licenses.', ownerId: gloria.id, stewardIds: [carlos.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domFinance = { id: demoId('domain-govfinance'), code: 'FIN', orgId: orgLakeside.id, name: 'Finance & Regulatory Data', description: 'Property and tax records and the county financial ledger.', ownerId: sylvie.id, stewardIds: [anita.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Sub-domains under Citizen & Case Data — the case-carrying program areas. Parent created first.
  const domCitizenHealth = { id: demoId('domain-citizen-health'), code: 'CIT-01', orgId: orgLakeside.id, name: 'Public Health Cases', description: 'Communicable-disease cases, investigations, and dispositions.', ownerId: olivia.id, stewardIds: [amir.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domCitizen.id, createdAt: ts, updatedAt: ts };
  const domCitizenSocial = { id: demoId('domain-citizen-social'), code: 'CIT-02', orgId: orgLakeside.id, name: 'Social Services Cases', description: 'Benefits eligibility, enrollment, and case management records.', ownerId: rosa.id, stewardIds: [kevin.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domCitizen.id, createdAt: ts, updatedAt: ts };
  const domCitizenPermits = { id: demoId('domain-citizen-permits'), code: 'CIT-03', orgId: orgLakeside.id, name: 'Permits & Licenses', description: 'Permit and license applications, reviews, and issuance.', ownerId: gloria.id, stewardIds: [carlos.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domCitizen.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domCitizen, domInfra, domFinance, domCitizenHealth, domCitizenSocial, domCitizenPermits]);

  // ── Data Assets (9) ──
  const assetResidentRegistry = { id: demoId('asset-resident-registry'), orgId: orgLakeside.id, name: 'Resident Registry', description: 'The golden resident record — identity and the cases and accounts a resident holds.', systemId: sys311.id, owner: '', ownerPersonId: roland.id, stewardIds: [] as string[], governanceTier: 'GOLD' as const, healthScore: 90, createdAt: ts, updatedAt: ts };
  const assetPropertyTax = { id: demoId('asset-property-tax'), orgId: orgLakeside.id, name: 'Property & Tax Records', description: 'Parcel assessments, the tax roll, billing, and collections.', systemId: sysTax.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 87, createdAt: ts, updatedAt: ts };
  const assetPermits = { id: demoId('asset-permits'), orgId: orgLakeside.id, name: 'Permits & Licenses', description: 'Permit and license applications, reviews, inspections, and issued records.', systemId: sysPermitting.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 83, createdAt: ts, updatedAt: ts };
  const assetPublicHealthCases = { id: demoId('asset-ph-cases'), orgId: orgLakeside.id, name: 'Public Health Cases', description: 'Communicable-disease case records, investigations, and dispositions.', systemId: sysPublicHealth.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 57, createdAt: ts, updatedAt: ts };
  const assetBenefitsCases = { id: demoId('asset-benefits-cases'), orgId: orgLakeside.id, name: 'Benefits Case Records', description: 'Social-services eligibility, enrollment, and case-management records.', systemId: sysBenefits.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 82, createdAt: ts, updatedAt: ts };
  const assetRoadAssets = { id: demoId('asset-road-assets'), orgId: orgLakeside.id, name: 'Road Asset Inventory', description: 'Road, bridge, and utility asset inventory and condition from the GIS.', systemId: sysGIS.id, owner: '', ownerPersonId: nina.id, stewardIds: [carlos.id] as string[], governanceTier: 'GOLD' as const, healthScore: 91, createdAt: ts, updatedAt: ts };
  const assetFinancialLedger = { id: demoId('asset-financial-ledger'), orgId: orgLakeside.id, name: 'Financial Ledger', description: 'County general ledger, budget actuals, and procurement postings.', systemId: sysFinancial.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 85, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's orphan-detection returns a quotable answer.
  const orphanLegacyTax = { id: demoId('asset-legacy-tax'), orgId: orgLakeside.id, name: 'Legacy Tax Extract', description: 'Nightly dump from the retired tax mainframe. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanIncidentCsv = { id: demoId('asset-incident-csv'), orgId: orgLakeside.id, name: 'Incident CSV Dump', description: 'Ad-hoc CSV extract of code-enforcement incidents for an old reporting deck. Nobody remembers if it is still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetResidentRegistry, assetPropertyTax, assetPermits, assetPublicHealthCases, assetBenefitsCases, assetRoadAssets, assetFinancialLedger, orphanLegacyTax, orphanIncidentCsv]);

  // Domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domCitizen.id, { dataAssetIds: [assetResidentRegistry.id, assetPublicHealthCases.id, assetBenefitsCases.id] });
  await repos.dataDomains.update(domInfra.id, { dataAssetIds: [assetRoadAssets.id, assetPermits.id] });
  await repos.dataDomains.update(domFinance.id, { dataAssetIds: [assetPropertyTax.id, assetFinancialLedger.id] });

  // ── Process hierarchy — VS1 Permitting & Licensing (Public Works) ──
  const vsPermitting = { id: demoId('node-vs-permitting'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Permitting & Licensing', description: 'End-to-end permitting — take the application, review and inspect it, and issue the permit.', activityId: 'VS-DEMO-G1', status: 'ACTIVE', orderIndex: 0, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: gloria.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procIntake = { id: demoId('node-proc-intake'), parentId: vsPermitting.id, level: 'PROCESS' as const, name: 'Permit Intake', description: 'Take the application and verify the property, fees, and eligibility.', activityId: 'PRO-DEMO-G1', status: 'ACTIVE', orderIndex: 0, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: dean.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procReview = { id: demoId('node-proc-review'), parentId: vsPermitting.id, level: 'PROCESS' as const, name: 'Permit Review & Issuance', description: 'Review and inspect the application and issue or deny the permit.', activityId: 'PRO-DEMO-G2', status: 'ACTIVE', orderIndex: 1, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: dean.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spCapture = { id: demoId('node-sp-capture'), parentId: procIntake.id, level: 'SUBPROCESS' as const, name: 'Application Capture', description: 'Take the application and verify the property and fees.', activityId: 'SP-DEMO-G1', status: 'ACTIVE', orderIndex: 0, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: carlos.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actReceiveApp = { id: demoId('node-act-receiveapp'), parentId: spCapture.id, level: 'ACTIVITY' as const, name: 'Receive application', description: 'Take the permit application and match the applicant to the resident registry.', activityId: 'ACT-DEMO-G1', status: 'ACTIVE', orderIndex: 0, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: carlos.id, responsibleRole: 'Data Steward Roads', responsiblePersonId: carlos.id, systemIds: [sysPermitting.id, sys311.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actVerify = { id: demoId('node-act-verify'), parentId: spCapture.id, level: 'ACTIVITY' as const, name: 'Verify property & fees', description: 'Verify the parcel against the tax roll and confirm fees are paid.', activityId: 'ACT-DEMO-G2', status: 'ACTIVE', orderIndex: 1, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: dean.id, responsibleRole: 'Infrastructure Analyst', responsiblePersonId: bruce.id, systemIds: [sysTax.id, sysPermitting.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actReviewInspect = { id: demoId('node-act-reviewinspect'), parentId: procReview.id, level: 'ACTIVITY' as const, name: 'Review & inspect', description: 'Review the application against code and schedule and record the inspection.', activityId: 'ACT-DEMO-G3', status: 'ACTIVE', orderIndex: 0, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: dean.id, responsibleRole: 'GIS Program Lead', responsiblePersonId: nina.id, systemIds: [sysPermitting.id, sysGIS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actIssue = { id: demoId('node-act-issue'), parentId: procReview.id, level: 'ACTIVITY' as const, name: 'Issue permit', description: 'Approve and issue the permit or license and record it.', activityId: 'ACT-DEMO-G4', status: 'ACTIVE', orderIndex: 1, orgId: orgPublicWorks.id, orgIds: [orgPublicWorks.id], ownerId: dean.id, responsibleRole: 'Director Roads & Transportation', responsiblePersonId: dean.id, systemIds: [sysPermitting.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Permits issued within the published SLA', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsPermitting, procIntake, procReview, spCapture, actReceiveApp, actVerify, actReviewInspect, actIssue]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-g1'), fromNodeId: actReceiveApp.id, toNodeId: actVerify.id, type: 'SEQUENCE' as const, label: 'application taken', createdAt: ts },
    { id: demoId('flow-g2'), fromNodeId: actVerify.id, toNodeId: actReviewInspect.id, type: 'SEQUENCE' as const, label: 'property verified', createdAt: ts },
    { id: demoId('flow-g3'), fromNodeId: actReviewInspect.id, toNodeId: actIssue.id, type: 'SEQUENCE' as const, label: 'review passed', createdAt: ts },
  ]);

  // ── Process hierarchy — VS2 Public Health Case Management (Health & Human Services) ──
  const vsHealth = { id: demoId('node-vs-health'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Public Health Case Management', description: 'Register a public-health case, investigate it, and report it to the state and close it.', activityId: 'VS-DEMO-G2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgHHS.id, orgIds: [orgHHS.id], ownerId: desmond.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procCaseIntake = { id: demoId('node-proc-caseintake'), parentId: vsHealth.id, level: 'PROCESS' as const, name: 'Case Intake & Investigation', description: 'Register the case, triage it, and investigate it.', activityId: 'PRO-DEMO-G3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgHHS.id, orgIds: [orgHHS.id], ownerId: olivia.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procReporting = { id: demoId('node-proc-greporting'), parentId: vsHealth.id, level: 'PROCESS' as const, name: 'Reporting & Closure', description: 'Report the case to the state and close it.', activityId: 'PRO-DEMO-G4', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgHHS.id, orgIds: [orgHHS.id], ownerId: olivia.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spTriage = { id: demoId('node-sp-triage'), parentId: procCaseIntake.id, level: 'SUBPROCESS' as const, name: 'Case Triage', description: 'Register the case and triage its priority.', activityId: 'SP-DEMO-G2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgHHS.id, orgIds: [orgHHS.id], ownerId: amir.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actRegisterCase = { id: demoId('node-act-registercase'), parentId: spTriage.id, level: 'ACTIVITY' as const, name: 'Register case', description: 'Open the case and match the subject to the resident registry and benefits records.', activityId: 'ACT-DEMO-G5', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgHHS.id, orgIds: [orgHHS.id], ownerId: amir.id, responsibleRole: 'Data Steward Public Health', responsiblePersonId: amir.id, systemIds: [sysPublicHealth.id, sysBenefits.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actInvestigate = { id: demoId('node-act-investigate'), parentId: procCaseIntake.id, level: 'ACTIVITY' as const, name: 'Investigate case', description: 'Investigate the case, record contacts and dispositions, and update the case record.', activityId: 'ACT-DEMO-G6', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgHHS.id, orgIds: [orgHHS.id], ownerId: olivia.id, responsibleRole: 'Data Steward Public Health', responsiblePersonId: amir.id, systemIds: [sysPublicHealth.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Every case investigated and dispositioned within the reporting SLA', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actReport = { id: demoId('node-act-report'), parentId: procReporting.id, level: 'ACTIVITY' as const, name: 'Report to state & close', description: 'Reconcile the case record and file the mandated state report, then close the case.', activityId: 'ACT-DEMO-G7', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgHHS.id, orgIds: [orgHHS.id], ownerId: olivia.id, responsibleRole: 'Manager Regulatory Reporting', responsiblePersonId: paulette.id, systemIds: [sysPublicHealth.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, successMeasure: 'Reportable cases filed to the state on time', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsHealth, procCaseIntake, procReporting, spTriage, actRegisterCase, actInvestigate, actReport]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-g4'), fromNodeId: actRegisterCase.id, toNodeId: actInvestigate.id, type: 'SEQUENCE' as const, label: 'case registered', createdAt: ts },
  ]);

  // ── Mappings (7) ──
  await createAll(repos.mappings, [
    { id: demoId('map-g1'), orgId: orgPublicWorks.id, processStepId: actReceiveApp.id, dataAssetId: assetResidentRegistry.id, linkType: 'INPUT', notes: 'Matches the applicant to the resident registry', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-g2'), orgId: orgPublicWorks.id, processStepId: actVerify.id, dataAssetId: assetPropertyTax.id, linkType: 'INPUT', notes: 'Verifies the parcel against the tax roll', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-g3'), orgId: orgPublicWorks.id, processStepId: actReviewInspect.id, dataAssetId: assetRoadAssets.id, linkType: 'INPUT', notes: 'Checks the parcel and infrastructure against the GIS', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-g4'), orgId: orgPublicWorks.id, processStepId: actIssue.id, dataAssetId: assetPermits.id, linkType: 'OUTPUT', notes: 'Writes the issued permit record', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-g5'), orgId: orgHHS.id, processStepId: actRegisterCase.id, dataAssetId: assetBenefitsCases.id, linkType: 'INPUT', notes: 'Links the case to benefits and eligibility records', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-g6'), orgId: orgHHS.id, processStepId: actInvestigate.id, dataAssetId: assetPublicHealthCases.id, linkType: 'OUTPUT', notes: 'Writes the investigation + disposition', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-g7'), orgId: orgHHS.id, processStepId: actReport.id, dataAssetId: assetPublicHealthCases.id, linkType: 'INPUT', notes: 'Reads the case to file the state report', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Evelyn (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-g1'), orgId: orgLakeside.id, title: 'Approve Public Health Cases classification review', description: 'Review the AI-suggested sensitivity tags on Public Health Cases and Benefits Case Records and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: evelyn.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetPublicHealthCases.id, automationMode: 'HUMAN' as any, createdBy: harold.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-g2'), orgId: orgLakeside.id, title: 'Sign off on Citizen & Case domain scope', description: 'Desmond has proposed expanding the Citizen & Case domain to cover new state reporting fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: evelyn.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domCitizen.id, automationMode: 'HUMAN' as any, createdBy: desmond.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-g3'), orgId: orgLakeside.id, title: 'Retire Legacy Tax Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: evelyn.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyTax.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Evelyn ──
  await repos.governanceIssues.create({
    id: demoId('issue-g1'),
    orgId: orgLakeside.id,
    title: 'Public Health Cases tier below Silver — critical process, ungoverned',
    description: 'Public Health Cases is BRONZE tier but the Case Management process writes it as the primary public-health case-of-record. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domCitizen.id,
    dataAssetId: assetPublicHealthCases.id,
    systemId: sysPublicHealth.id,
    reportedBy: harold.id,
    assignedTo: evelyn.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules (2 — one passing, one failing) ──
  await createAll(repos.dataQualityRules, [
    {
      id: demoId('dq-rule-passing'), orgId: orgLakeside.id, dataAssetId: assetPropertyTax.id,
      dimension: 'COMPLETENESS' as const, name: 'Property & Tax · parcel completeness',
      description: 'At least 95% of parcels must carry a complete assessment + owner + situs.',
      threshold: 95, currentScore: 97, weight: 1, status: 'PASSING' as const,
      lastMeasured: ts, scheduleFrequency: 'DAILY' as const, nextRunAt: daysFromNow(1), createdAt: ts, updatedAt: ts,
    },
    {
      id: demoId('dq-rule-failing'), orgId: orgLakeside.id, dataAssetId: assetPublicHealthCases.id,
      dimension: 'TIMELINESS' as const, name: 'Public Health Cases · reporting latency',
      description: 'Reportable cases should be filed to the state within the mandated window. Rolling 24h.',
      threshold: 95, currentScore: 57, weight: 1, status: 'FAILING' as const,
      lastMeasured: ts, scheduleFrequency: 'HOURLY' as const, nextRunAt: daysFromNow(0), createdAt: ts, updatedAt: ts,
    },
  ]);

  // ── Edge connector (ONLINE) ──
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-lakeside'), orgId: orgLakeside.id, name: 'Lakeside County Data Connector',
    tokenHash: '3c9e1a7f52b4d80c6e1f3a9d7b5c2e0f4a6d8b1c3e5f7092a4c6e8b0d2f4a6c8',
    pairingCode: null, pairingCodeExpiresAt: null,
    systemIds: [sysPermitting.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt, agentVersion: '1.2.0', status: 'ONLINE' as const,
    createdAt: connectorCreatedAt, updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  await repos.dataAssets.update(assetPermits.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  await createAll(repos.connectorEvents, [
    { id: demoId('ce-g-paired'), connectorId: conn.id, orgId: orgLakeside.id, type: 'PAIRED', ts: connectorCreatedAt, data: { agentVersion: '1.2.0' } },
    { id: demoId('ce-g-scan-start'), connectorId: conn.id, orgId: orgLakeside.id, type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: { targetSystemIds: [sysPermitting.id, sysWarehouse.id] } },
    { id: demoId('ce-g-scan-done'), connectorId: conn.id, orgId: orgLakeside.id, type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(), data: { durationMs: 39_540, assetsDiscovered: 1 } },
    { id: demoId('ce-g-assets'), connectorId: conn.id, orgId: orgLakeside.id, type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(), data: { incoming: 1, created: 0, updated: 1 } },
    { id: demoId('ce-g-hb'), connectorId: conn.id, orgId: orgLakeside.id, type: 'HEARTBEAT', ts: connectorHeartbeatAt, data: { agentVersion: '1.2.0' } },
  ]);

  // ── Second connector — PAIRING state ──
  const pairingConn = {
    id: demoId('conn-g-pairing'), orgId: orgLakeside.id, name: 'Health Department Connector',
    tokenHash: null, pairingCode: '48213975',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[], lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-g-dgc'),
    orgId: orgLakeside.id,
    name: 'Data Governance Council weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [evelyn.id, harold.id, gloria.id, desmond.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgLakeside.id, { coverage: 62, avgHealth: 71, gaps: 8, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgPublicWorks.id, { coverage: 70, avgHealth: 74, gaps: 4, dataAssets: 3, mappings: 4 }),
    ...weeklySnapshots(orgHHS.id, { coverage: 58, avgHealth: 69, gaps: 4, dataAssets: 3, mappings: 3 }),
    ...weeklySnapshots(orgGovShared.id, { coverage: 52, avgHealth: 73, gaps: 3, dataAssets: 3, mappings: 0 }),
  ]);

  // ── AI template cache — pre-warm the wand for Lakeside County ──
  aiTemplateCache.push(
    {
      industry: 'government|permitting & licensing',
      industryLabel: 'Government & Public Sector — Permitting & Licensing',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Permitting & Licensing',
            description: 'Take the application, review and inspect it, and issue the permit.',
            purpose: 'Issue permits and licenses accurately and within the published SLA.',
            businessOutcome: 'On-SLA permits with verified property, fees, and inspection records.',
            processes: [
              { name: 'Permit Intake', description: 'Take the application and verify the property and fees.', purpose: 'Get a complete, verified application on file.', activities: [
                { name: 'Receive application', description: 'Take the application and match the applicant to the resident registry.' },
                { name: 'Verify property & fees', description: 'Verify the parcel against the tax roll and confirm fees are paid.' },
              ] },
              { name: 'Permit Review & Issuance', description: 'Review and inspect the application and issue the permit.', purpose: 'Approve compliant applications and issue the permit.', activities: [
                { name: 'Review & inspect', description: 'Review against code, schedule, and record the inspection.' },
                { name: 'Issue permit', description: 'Approve and issue the permit or license and record it.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'government|public health case management',
      industryLabel: 'Government & Public Sector — Public Health Case Management',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Public Health Case Management',
            description: 'Register a case, investigate it, and report it to the state and close it.',
            purpose: 'Manage public-health cases and meet mandated state reporting on time.',
            businessOutcome: 'Cases investigated on SLA and reportable cases filed to the state on time.',
            processes: [
              { name: 'Case Intake & Investigation', description: 'Register the case, triage it, and investigate it.', purpose: 'Open and work the case to a disposition.', activities: [
                { name: 'Register case', description: 'Open the case and match the subject to the resident registry.' },
                { name: 'Investigate case', description: 'Investigate the case, record contacts, and update the record.' },
              ] },
              { name: 'Reporting & Closure', description: 'Report the case to the state and close it.', purpose: 'Meet mandated reporting and close the case.', activities: [
                { name: 'Report to state & close', description: 'Reconcile the case record, file the state report, and close the case.' },
                { name: 'Archive case evidence', description: 'Archive the case evidence per the retention schedule.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgLakeside.id,
    cdoId: evelyn.id,
    govLeadId: harold.id,
    dataOwnerId: gloria.id,
    stewardIds: [carlos.id, amir.id],
    tenantName: 'Lakeside County',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgLakeside.id,
    domainIds: [domCitizen.id, domInfra.id, domFinance.id],
    cdoId: evelyn.id,
    govLeadId: harold.id,
    dataOwnerId: gloria.id,
    stewardId: carlos.id,
    techStewardId: anita.id,
    engineerId: neal.id,
    architectId: erika.id,
    raciNodeId: actInvestigate.id,
    raciPersonId: amir.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgLakeside.id, ownerId: carlos.id, cdoId: evelyn.id, domainId: domCitizen.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgLakeside.id, orgPublicWorks.id, orgHHS.id],
    links: [
      { id: demoId('lin-1'), orgId: orgLakeside.id, sourceSystemId: sysTax.id, targetSystemId: sysWarehouse.id, dataAssetId: assetPropertyTax.id, description: 'Property & tax records sync nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-2'), orgId: orgPublicWorks.id, sourceSystemId: sysPermitting.id, targetSystemId: sysWarehouse.id, dataAssetId: assetPermits.id, description: 'Permit records feed the open-data warehouse.', flowType: 'ETL', frequency: 'HOURLY' },
      { id: demoId('lin-3'), orgId: orgHHS.id, sourceSystemId: sysPublicHealth.id, targetSystemId: sysWarehouse.id, dataAssetId: assetPublicHealthCases.id, description: 'Public-health case data streams into the warehouse for reporting.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgLakeside.id, sourceAssetId: assetResidentRegistry.id, targetAssetId: assetPermits.id },
      { id: demoId('edge-2'), orgId: orgHHS.id, sourceAssetId: assetResidentRegistry.id, targetAssetId: assetPublicHealthCases.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgLakeside.id, agentId: demoId('agent-report-gen'), agentName: 'State Report Generator', activityId: actReport.id, activityName: 'Report to state & close', roleType: 'TECHNICAL_DATA_STEWARD', createdBy: evelyn.id, reviewerId: harold.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgLakeside.id, assetId: assetResidentRegistry.id, systemId: sys311.id, personId: carlos.id, personName: 'Carlos Vega' });

  logger.info({ persona: evelyn.name }, 'Demo data seeded (government)');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: evelyn.id, name: evelyn.name },
  };
}

/**
 * Transportation & Logistics profile — a Cascade Logistics freight carrier
 * (Line-Haul Freight + Warehousing + Shared Services), persona Omar Reyes
 * (CDO). Same fixed-count skeleton and story shape as the other profiles:
 * two planted orphan assets on the warehouse, and a failing DQ rule
 * co-located with the ownership issue on the Bronze/critical Customs
 * Declarations asset — the cross-border/C-TPAT traceability story the
 * industry page leads with.
 */
async function seedLogistics(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {
  // ── Organizations (company → 3 divisions → 6 departments) ──
  const orgCascade = { id: demoId('org-cascade'), parentId: null, name: 'Cascade Logistics', type: 'company', industry: 'Transportation & Logistics', description: 'Freight carrier demo tenant — line-haul freight + warehousing + shared services.', headCount: 0, tenantSlug: 'cascade', brandDisplayName: 'Cascade Logistics', brandGlyph: '⛟', ssoButtonLabel: 'Sign in with Cascade SSO', brandPrimaryColor: '#c2410c', createdAt: ts, updatedAt: ts };
  const orgLineHaul = { id: demoId('org-linehaul'), parentId: orgCascade.id, name: 'Line-Haul Freight', type: 'division', industry: 'Transportation & Logistics', description: 'Dispatch, fleet, and driver operations', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgWarehousing = { id: demoId('org-warehousing'), parentId: orgCascade.id, name: 'Warehousing', type: 'division', industry: 'Transportation & Logistics', description: 'Distribution centers and fulfillment', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgLogShared = { id: demoId('org-logshared'), parentId: orgCascade.id, name: 'Shared Services', type: 'division', industry: 'Transportation & Logistics', description: 'IT / Safety & Compliance', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgDispatch = { id: demoId('org-dispatch'), parentId: orgLineHaul.id, name: 'Dispatch & Fleet', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgDriverOps = { id: demoId('org-driverops'), parentId: orgLineHaul.id, name: 'Driver Operations', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgDC = { id: demoId('org-dc'), parentId: orgWarehousing.id, name: 'Distribution Centers', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgFulfillment = { id: demoId('org-fulfillment'), parentId: orgWarehousing.id, name: 'Inbound & Outbound', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgLogIT = { id: demoId('org-logit'), parentId: orgLogShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgSafety = { id: demoId('org-safety'), parentId: orgLogShared.id, name: 'Safety & Compliance', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgCascade, orgLineHaul, orgWarehousing, orgLogShared, orgDispatch, orgDriverOps, orgDC, orgFulfillment, orgLogIT, orgSafety]);

  // ── People (24) — persona Omar Reyes (CDO) ──
  const omar = { id: demoId('person-omar-reyes'), orgIds: [orgCascade.id], accessibleOrgIds: [orgCascade.id, orgLineHaul.id, orgWarehousing.id, orgLogShared.id, orgDispatch.id, orgDriverOps.id, orgDC.id, orgFulfillment.id, orgLogIT.id, orgSafety.id], name: 'Omar Reyes', email: 'omar.reyes@cascade-logistics.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const denise = { id: demoId('person-denise'), orgIds: [orgCascade.id], accessibleOrgIds: [orgCascade.id], name: 'Denise Hartley', email: 'denise.hartley@cascade-logistics.com', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const travis = { id: demoId('person-travis'), orgIds: [orgLineHaul.id], accessibleOrgIds: [orgLineHaul.id], name: 'Travis Boone', email: 'travis.boone@cascade-logistics.com', role: 'ORG_ADMIN', title: 'Data Owner Line-Haul Freight', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gina = { id: demoId('person-gina'), orgIds: [orgDispatch.id], accessibleOrgIds: [orgDispatch.id, orgLineHaul.id], name: 'Gina Alvarez', email: 'gina.alvarez@cascade-logistics.com', role: 'EDITOR', title: 'Director Dispatch & Fleet', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const curtis = { id: demoId('person-curtis'), orgIds: [orgDispatch.id], accessibleOrgIds: [orgDispatch.id], name: 'Curtis Reed', email: 'curtis.reed@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Dispatch Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const molly = { id: demoId('person-molly'), orgIds: [orgDispatch.id], accessibleOrgIds: [orgDispatch.id], name: 'Molly Tran', email: 'molly.tran@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Data Steward Dispatch', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const hank = { id: demoId('person-hank'), orgIds: [orgDispatch.id], accessibleOrgIds: [orgDispatch.id], name: 'Hank Boyd', email: 'hank.boyd@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Fleet Telematics Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const yvonne = { id: demoId('person-yvonne'), orgIds: [orgDriverOps.id], accessibleOrgIds: [orgDriverOps.id], name: 'Yvonne Clarke', email: 'yvonne.clarke@cascade-logistics.com', role: 'EDITOR', title: 'Manager Driver Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const derek = { id: demoId('person-derek'), orgIds: [orgDriverOps.id], accessibleOrgIds: [orgDriverOps.id], name: 'Derek Hollis', email: 'derek.hollis@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Data Steward Driver Ops', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const simone = { id: demoId('person-simone'), orgIds: [orgDriverOps.id], accessibleOrgIds: [orgDriverOps.id], name: 'Simone Weber', email: 'simone.weber@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Safety Data Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const bradley = { id: demoId('person-bradley'), orgIds: [orgWarehousing.id], accessibleOrgIds: [orgWarehousing.id], name: 'Bradley Cho', email: 'bradley.cho@cascade-logistics.com', role: 'ORG_ADMIN', title: 'Data Owner Warehousing', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const helena = { id: demoId('person-helena'), orgIds: [orgDC.id], accessibleOrgIds: [orgDC.id, orgWarehousing.id], name: 'Helena Ford', email: 'helena.ford@cascade-logistics.com', role: 'EDITOR', title: 'Director Distribution Centers', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const ravi = { id: demoId('person-ravi'), orgIds: [orgDC.id], accessibleOrgIds: [orgDC.id], name: 'Ravi Menon', email: 'ravi.menon@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Data Steward Warehouse', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gerald = { id: demoId('person-gerald'), orgIds: [orgDC.id], accessibleOrgIds: [orgDC.id], name: 'Gerald Pace', email: 'gerald.pace@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Inventory Control Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const cindy = { id: demoId('person-cindy'), orgIds: [orgFulfillment.id], accessibleOrgIds: [orgFulfillment.id], name: 'Cindy Lau', email: 'cindy.lau@cascade-logistics.com', role: 'EDITOR', title: 'Manager Inbound & Outbound', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const malik = { id: demoId('person-malik'), orgIds: [orgFulfillment.id], accessibleOrgIds: [orgFulfillment.id], name: 'Malik Turner', email: 'malik.turner@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Data Steward Fulfillment', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const ethan = { id: demoId('person-ethan'), orgIds: [orgLogIT.id], accessibleOrgIds: [orgLogIT.id], name: 'Ethan Brooks', email: 'ethan.brooks@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const diana = { id: demoId('person-diana'), orgIds: [orgLogIT.id], accessibleOrgIds: [orgLogIT.id], name: 'Diana Frost', email: 'diana.frost@cascade-logistics.com', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lorne = { id: demoId('person-lorne'), orgIds: [orgLogIT.id], accessibleOrgIds: [orgLogIT.id], name: 'Lorne Jacobs', email: 'lorne.jacobs@cascade-logistics.com', role: 'EDITOR', title: 'Manager Information Security', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const claudia = { id: demoId('person-claudia'), orgIds: [orgSafety.id], accessibleOrgIds: [orgSafety.id], name: 'Claudia Moss', email: 'claudia.moss@cascade-logistics.com', role: 'EDITOR', title: 'Director Safety & Compliance', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const priyanka = { id: demoId('person-priyanka'), orgIds: [orgSafety.id], accessibleOrgIds: [orgSafety.id], name: 'Priyanka Rao', email: 'priyanka.rao@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Data Steward Compliance Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const desh = { id: demoId('person-desh'), orgIds: [orgSafety.id], accessibleOrgIds: [orgSafety.id], name: 'Desh Patel', email: 'desh.patel@cascade-logistics.com', role: 'CONTRIBUTOR', title: 'Customs & Trade Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const odette = { id: demoId('person-odette'), orgIds: [orgSafety.id], accessibleOrgIds: [orgSafety.id], name: 'Odette Klein', email: 'odette.klein@cascade-logistics.com', role: 'EDITOR', title: 'Manager Regulatory Reporting', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lionel = { id: demoId('person-lionel'), orgIds: [orgSafety.id], accessibleOrgIds: [orgSafety.id], name: 'Lionel Barnes', email: 'lionel.barnes@cascade-logistics.com', role: 'EDITOR', title: 'Manager Safety & Audit', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [omar, denise, travis, gina, curtis, molly, hank, yvonne, derek, simone, bradley, helena, ravi, gerald, cindy, malik, ethan, diana, lorne, claudia, priyanka, desh, odette, lionel]);

  // ── Systems (8) — TMS / telematics / WMS / yard / maintenance / CRM / warehouse + EDI ──
  const sysTMS = { id: demoId('sys-tms'), orgId: orgLineHaul.id, name: 'TMS', description: 'Transportation Management System — loads, routing, tendering, and dispatch.', systemType: 'IT', vendorName: 'Oracle OTM', ownerPersonId: gina.id, stewardIds: [molly.id], createdAt: ts, updatedAt: ts };
  const sysTelematics = { id: demoId('sys-telematics'), orgId: orgLineHaul.id, name: 'Telematics & ELD', description: 'Fleet telematics and electronic logging — GPS, hours-of-service, and vehicle data.', systemType: 'OT', vendorName: 'Samsara', ownerPersonId: hank.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysWMS = { id: demoId('sys-lwms'), orgId: orgWarehousing.id, name: 'WMS', description: 'Warehouse Management System — inventory, receiving, picking, and shipping.', systemType: 'IT', vendorName: 'Blue Yonder', ownerPersonId: ravi.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysYard = { id: demoId('sys-yard'), orgId: orgWarehousing.id, name: 'Yard Management System', description: 'Yard and dock scheduling — trailer moves, dock doors, and appointments.', systemType: 'IT', vendorName: 'PINC', ownerPersonId: cindy.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysMaint = { id: demoId('sys-lmaint'), orgId: orgLineHaul.id, name: 'Fleet Maintenance System', description: 'Tractor and trailer maintenance — work orders, DVIRs, and parts.', systemType: 'IT', vendorName: 'TMT Fleet Maintenance', ownerPersonId: gina.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysCRM = { id: demoId('sys-lcrm'), orgId: orgCascade.id, name: 'Customer Portal', description: 'Customer relationship and booking portal — accounts, rates, and shipment visibility.', systemType: 'IT', vendorName: 'Salesforce', ownerPersonId: helena.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgCascade.id, name: 'Data Warehouse', description: 'Enterprise analytics warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: ethan.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysEDI = { id: demoId('sys-edi'), orgId: orgSafety.id, name: 'EDI & Customs Gateway', description: 'EDI and customs gateway — trading-partner documents and cross-border filings.', systemType: 'IT', vendorName: 'SPS Commerce', ownerPersonId: desh.id, stewardIds: [priyanka.id], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysTMS, sysTelematics, sysWMS, sysYard, sysMaint, sysCRM, sysWarehouse, sysEDI]);

  // ── Agents (5 — one of each type) ──
  await createAll(repos.agents, [
    { id: demoId('agent-eta-model'), orgIds: [orgLineHaul.id], name: 'ETA Prediction Model', agentType: 'AI', description: 'Predicts delivery ETAs from telematics, traffic, and load data.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: hank.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-freight-pipeline'), orgIds: [orgCascade.id], name: 'Freight Data Pipeline', agentType: 'PIPELINE', description: 'Nightly ETL of load, telematics, and WMS data into the warehouse.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: ethan.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-exception-bot'), orgIds: [orgLineHaul.id], name: 'Delivery Exception Bot', agentType: 'BOT', description: 'Alerts dispatch when a load is late, off-route, or misses a delivery window.', provider: 'Microsoft Teams', status: 'ACTIVE', ownerPersonId: curtis.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-telematics-service'), orgIds: [orgLogIT.id], name: 'Telematics Extract Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract telematics feeds.', provider: 'Samsara', status: 'ACTIVE', ownerPersonId: ethan.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-customs-gen'), orgIds: [orgCascade.id], name: 'Customs Filing Generator', agentType: 'OTHER', description: 'Scheduled generator assembling customs and C-TPAT cross-border filing packages.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: odette.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains (3 top-level + 3 sub-domains under Shipment & Freight Data) ──
  const domShipment = { id: demoId('domain-shipment'), code: 'SHP', orgId: orgCascade.id, name: 'Shipment & Freight Data', description: 'Loads, shipments, warehouse inventory, and cross-border customs records.', ownerId: omar.id, stewardIds: [molly.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domFleet = { id: demoId('domain-fleet'), code: 'FLT', orgId: orgCascade.id, name: 'Fleet & Telematics Data', description: 'Vehicle telematics, hours-of-service logs, and maintenance records.', ownerId: travis.id, stewardIds: [hank.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domCustomer = { id: demoId('domain-lcustomer'), code: 'CUS', orgId: orgCascade.id, name: 'Customer & Compliance Data', description: 'Customer accounts, carrier rates, and compliance evidence.', ownerId: helena.id, stewardIds: [priyanka.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Sub-domains under Shipment & Freight Data — the movement areas. Parent created first.
  const domShipLinehaul = { id: demoId('domain-ship-linehaul'), code: 'SHP-01', orgId: orgCascade.id, name: 'Line-Haul Loads', description: 'Load boards, tenders, dispatch, and delivery records.', ownerId: travis.id, stewardIds: [molly.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domShipment.id, createdAt: ts, updatedAt: ts };
  const domShipWarehouse = { id: demoId('domain-ship-warehouse'), code: 'SHP-02', orgId: orgCascade.id, name: 'Warehouse Inventory', description: 'Distribution-center inventory, receipts, and shipments.', ownerId: bradley.id, stewardIds: [ravi.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domShipment.id, createdAt: ts, updatedAt: ts };
  const domShipCustoms = { id: demoId('domain-ship-customs'), code: 'SHP-03', orgId: orgCascade.id, name: 'Customs & Trade', description: 'Cross-border customs declarations and trade documents.', ownerId: claudia.id, stewardIds: [desh.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domShipment.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domShipment, domFleet, domCustomer, domShipLinehaul, domShipWarehouse, domShipCustoms]);

  // ── Data Assets (9) ──
  const assetCustomerMaster = { id: demoId('asset-lcustomer-master'), orgId: orgCascade.id, name: 'Customer Master', description: 'The golden customer record — accounts, bill-to, and shipment relationships.', systemId: sysCRM.id, owner: '', ownerPersonId: helena.id, stewardIds: [] as string[], governanceTier: 'GOLD' as const, healthScore: 90, createdAt: ts, updatedAt: ts };
  const assetShipmentRecords = { id: demoId('asset-shipment-records'), orgId: orgCascade.id, name: 'Shipment Records', description: 'Loads and shipments — tenders, routing, status, and proof of delivery.', systemId: sysTMS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 85, createdAt: ts, updatedAt: ts };
  const assetTelematics = { id: demoId('asset-telematics'), orgId: orgCascade.id, name: 'Fleet Telematics', description: 'Vehicle GPS, engine, and event telemetry from the telematics platform.', systemId: sysTelematics.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 82, createdAt: ts, updatedAt: ts };
  const assetCustoms = { id: demoId('asset-customs'), orgId: orgCascade.id, name: 'Customs Declarations', description: 'Cross-border customs declarations, entries, and C-TPAT documentation.', systemId: sysEDI.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 57, createdAt: ts, updatedAt: ts };
  const assetInventory = { id: demoId('asset-linventory'), orgId: orgCascade.id, name: 'Warehouse Inventory', description: 'Distribution-center inventory, receipts, and consumption.', systemId: sysWMS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, createdAt: ts, updatedAt: ts };
  const assetHOS = { id: demoId('asset-hos'), orgId: orgCascade.id, name: 'Driver Hours-of-Service Logs', description: 'Electronic hours-of-service logs and duty status for DOT compliance.', systemId: sysTelematics.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 80, createdAt: ts, updatedAt: ts };
  const assetRates = { id: demoId('asset-rates'), orgId: orgCascade.id, name: 'Carrier Rates', description: 'Customer and lane rate agreements, tariffs, and accessorials.', systemId: sysCRM.id, owner: '', ownerPersonId: odette.id, stewardIds: [priyanka.id] as string[], governanceTier: 'GOLD' as const, healthScore: 92, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's orphan-detection returns a quotable answer.
  const orphanLegacyDispatch = { id: demoId('asset-legacy-dispatch'), orgId: orgCascade.id, name: 'Legacy Dispatch Extract', description: 'Nightly dump from the retired dispatch system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanClaimsCsv = { id: demoId('asset-lclaims-csv'), orgId: orgCascade.id, name: 'Claims CSV Dump', description: 'Ad-hoc CSV extract of freight-damage claims for an old reporting deck. Nobody remembers if it is still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetCustomerMaster, assetShipmentRecords, assetTelematics, assetCustoms, assetInventory, assetHOS, assetRates, orphanLegacyDispatch, orphanClaimsCsv]);

  // Domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domShipment.id, { dataAssetIds: [assetShipmentRecords.id, assetInventory.id, assetCustoms.id] });
  await repos.dataDomains.update(domFleet.id, { dataAssetIds: [assetTelematics.id, assetHOS.id] });
  await repos.dataDomains.update(domCustomer.id, { dataAssetIds: [assetCustomerMaster.id, assetRates.id] });

  // ── Process hierarchy — VS1 Line-Haul Freight (Line-Haul Freight) ──
  const vsLineHaul = { id: demoId('node-vs-linehaul'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Line-Haul Freight', description: 'End-to-end line-haul — plan and tender the load, clear customs, dispatch, and deliver.', activityId: 'VS-DEMO-L1', status: 'ACTIVE', orderIndex: 0, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: travis.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procPlanning = { id: demoId('node-proc-planning'), parentId: vsLineHaul.id, level: 'PROCESS' as const, name: 'Load Planning & Tender', description: 'Plan and tender the load and clear it for cross-border movement.', activityId: 'PRO-DEMO-L1', status: 'ACTIVE', orderIndex: 0, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: gina.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procDispatch = { id: demoId('node-proc-ldispatch'), parentId: vsLineHaul.id, level: 'PROCESS' as const, name: 'Dispatch & Delivery', description: 'Dispatch the load, track it in transit, and confirm delivery.', activityId: 'PRO-DEMO-L2', status: 'ACTIVE', orderIndex: 1, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: gina.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spLoadBuild = { id: demoId('node-sp-loadbuild'), parentId: procPlanning.id, level: 'SUBPROCESS' as const, name: 'Load Build', description: 'Build and tender the load and clear customs.', activityId: 'SP-DEMO-L1', status: 'ACTIVE', orderIndex: 0, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: molly.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actPlanTender = { id: demoId('node-act-plantender'), parentId: spLoadBuild.id, level: 'ACTIVITY' as const, name: 'Plan & tender load', description: 'Build the load against the customer order and tender it to a driver or carrier.', activityId: 'ACT-DEMO-L1', status: 'ACTIVE', orderIndex: 0, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: molly.id, responsibleRole: 'Dispatch Lead', responsiblePersonId: curtis.id, systemIds: [sysTMS.id, sysCRM.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actClearCustoms = { id: demoId('node-act-clearcustoms'), parentId: spLoadBuild.id, level: 'ACTIVITY' as const, name: 'Clear customs', description: 'File the customs declaration and clear the cross-border shipment.', activityId: 'ACT-DEMO-L2', status: 'ACTIVE', orderIndex: 1, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: claudia.id, responsibleRole: 'Customs & Trade Analyst', responsiblePersonId: desh.id, systemIds: [sysEDI.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Declarations filed and cleared before the shipment reaches the border', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actDispatchTrack = { id: demoId('node-act-dispatchtrack'), parentId: procDispatch.id, level: 'ACTIVITY' as const, name: 'Dispatch & track', description: 'Dispatch the load and track it in transit against telematics.', activityId: 'ACT-DEMO-L3', status: 'ACTIVE', orderIndex: 0, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: gina.id, responsibleRole: 'Fleet Telematics Analyst', responsiblePersonId: hank.id, systemIds: [sysTMS.id, sysTelematics.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actConfirmDelivery = { id: demoId('node-act-confirmdelivery'), parentId: procDispatch.id, level: 'ACTIVITY' as const, name: 'Confirm delivery', description: 'Confirm delivery, capture proof of delivery, and close the load.', activityId: 'ACT-DEMO-L4', status: 'ACTIVE', orderIndex: 1, orgId: orgLineHaul.id, orgIds: [orgLineHaul.id], ownerId: gina.id, responsibleRole: 'Dispatch Lead', responsiblePersonId: curtis.id, systemIds: [sysTMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, successMeasure: 'On-time delivery rate ≥ 97%', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsLineHaul, procPlanning, procDispatch, spLoadBuild, actPlanTender, actClearCustoms, actDispatchTrack, actConfirmDelivery]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-l1'), fromNodeId: actPlanTender.id, toNodeId: actClearCustoms.id, type: 'SEQUENCE' as const, label: 'load tendered', createdAt: ts },
    { id: demoId('flow-l2'), fromNodeId: actClearCustoms.id, toNodeId: actDispatchTrack.id, type: 'SEQUENCE' as const, label: 'customs cleared', createdAt: ts },
    { id: demoId('flow-l3'), fromNodeId: actDispatchTrack.id, toNodeId: actConfirmDelivery.id, type: 'SEQUENCE' as const, label: 'in transit', createdAt: ts },
  ]);

  // ── Process hierarchy — VS2 Warehousing & Fulfillment (Warehousing) ──
  const vsWarehousing = { id: demoId('node-vs-warehousing'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Warehousing & Fulfillment', description: 'Receive and put away inbound stock, then pick and ship outbound orders.', activityId: 'VS-DEMO-L2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWarehousing.id, orgIds: [orgWarehousing.id], ownerId: bradley.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procInbound = { id: demoId('node-proc-inbound'), parentId: vsWarehousing.id, level: 'PROCESS' as const, name: 'Inbound Receiving', description: 'Receive, inspect, and put away inbound stock.', activityId: 'PRO-DEMO-L3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWarehousing.id, orgIds: [orgWarehousing.id], ownerId: helena.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procOutbound = { id: demoId('node-proc-outbound'), parentId: vsWarehousing.id, level: 'PROCESS' as const, name: 'Outbound Fulfillment', description: 'Pick, pack, and ship outbound orders.', activityId: 'PRO-DEMO-L4', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgWarehousing.id, orgIds: [orgWarehousing.id], ownerId: cindy.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spDock = { id: demoId('node-sp-dock'), parentId: procInbound.id, level: 'SUBPROCESS' as const, name: 'Dock & Putaway', description: 'Receive at the dock and put stock away.', activityId: 'SP-DEMO-L2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWarehousing.id, orgIds: [orgWarehousing.id], ownerId: ravi.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actReceiveInspect = { id: demoId('node-act-lreceive'), parentId: spDock.id, level: 'ACTIVITY' as const, name: 'Receive & inspect', description: 'Receive inbound freight at the dock, inspect it, and post the receipt.', activityId: 'ACT-DEMO-L5', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWarehousing.id, orgIds: [orgWarehousing.id], ownerId: ravi.id, responsibleRole: 'Data Steward Warehouse', responsiblePersonId: ravi.id, systemIds: [sysWMS.id, sysYard.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actPutaway = { id: demoId('node-act-putaway'), parentId: procInbound.id, level: 'ACTIVITY' as const, name: 'Put away stock', description: 'Direct the stock to a bin and update inventory locations.', activityId: 'ACT-DEMO-L6', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWarehousing.id, orgIds: [orgWarehousing.id], ownerId: helena.id, responsibleRole: 'Inventory Control Analyst', responsiblePersonId: gerald.id, systemIds: [sysWMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actPickShip = { id: demoId('node-act-pickship'), parentId: procOutbound.id, level: 'ACTIVITY' as const, name: 'Pick & ship order', description: 'Allocate inventory, pick and pack the order, and ship it.', activityId: 'ACT-DEMO-L7', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgWarehousing.id, orgIds: [orgWarehousing.id], ownerId: cindy.id, responsibleRole: 'Data Steward Fulfillment', responsiblePersonId: malik.id, systemIds: [sysWMS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Order accuracy ≥ 99.5% and on-time ship ≥ 98%', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsWarehousing, procInbound, procOutbound, spDock, actReceiveInspect, actPutaway, actPickShip]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-l4'), fromNodeId: actReceiveInspect.id, toNodeId: actPutaway.id, type: 'SEQUENCE' as const, label: 'received', createdAt: ts },
  ]);

  // ── Mappings (7) ──
  await createAll(repos.mappings, [
    { id: demoId('map-l1'), orgId: orgLineHaul.id, processStepId: actPlanTender.id, dataAssetId: assetCustomerMaster.id, linkType: 'INPUT', notes: 'Builds the load against the customer order', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-l2'), orgId: orgLineHaul.id, processStepId: actClearCustoms.id, dataAssetId: assetCustoms.id, linkType: 'OUTPUT', notes: 'Files the customs declaration', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-l3'), orgId: orgLineHaul.id, processStepId: actDispatchTrack.id, dataAssetId: assetTelematics.id, linkType: 'INPUT', notes: 'Tracks the load against telematics', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-l4'), orgId: orgLineHaul.id, processStepId: actConfirmDelivery.id, dataAssetId: assetShipmentRecords.id, linkType: 'OUTPUT', notes: 'Writes proof of delivery to the shipment', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-l5'), orgId: orgWarehousing.id, processStepId: actReceiveInspect.id, dataAssetId: assetInventory.id, linkType: 'OUTPUT', notes: 'Posts the receipt to inventory', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-l6'), orgId: orgWarehousing.id, processStepId: actPutaway.id, dataAssetId: assetInventory.id, linkType: 'INPUT', notes: 'Updates inventory locations', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-l7'), orgId: orgWarehousing.id, processStepId: actPickShip.id, dataAssetId: assetShipmentRecords.id, linkType: 'INPUT', notes: 'Allocates inventory to the outbound shipment', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Omar (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-l1'), orgId: orgCascade.id, title: 'Approve Customs Declarations classification review', description: 'Review the AI-suggested sensitivity tags on Customs Declarations and Carrier Rates and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: omar.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetCustoms.id, automationMode: 'HUMAN' as any, createdBy: denise.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-l2'), orgId: orgCascade.id, title: 'Sign off on Shipment & Freight domain scope', description: 'Bradley has proposed expanding the Shipment & Freight domain to cover new cross-border trade fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: omar.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domShipment.id, automationMode: 'HUMAN' as any, createdBy: bradley.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-l3'), orgId: orgCascade.id, title: 'Retire Legacy Dispatch Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: omar.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyDispatch.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Omar ──
  await repos.governanceIssues.create({
    id: demoId('issue-l1'),
    orgId: orgCascade.id,
    title: 'Customs Declarations tier below Silver — critical process, ungoverned',
    description: 'Customs Declarations is BRONZE tier but the Line-Haul process writes it as the primary cross-border compliance record. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domShipment.id,
    dataAssetId: assetCustoms.id,
    systemId: sysEDI.id,
    reportedBy: denise.id,
    assignedTo: omar.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules (2 — one passing, one failing) ──
  await createAll(repos.dataQualityRules, [
    {
      id: demoId('dq-rule-passing'), orgId: orgCascade.id, dataAssetId: assetShipmentRecords.id,
      dimension: 'COMPLETENESS' as const, name: 'Shipment Records · load completeness',
      description: 'At least 95% of loads must carry a complete origin, destination, and stops.',
      threshold: 95, currentScore: 97, weight: 1, status: 'PASSING' as const,
      lastMeasured: ts, scheduleFrequency: 'DAILY' as const, nextRunAt: daysFromNow(1), createdAt: ts, updatedAt: ts,
    },
    {
      id: demoId('dq-rule-failing'), orgId: orgCascade.id, dataAssetId: assetCustoms.id,
      dimension: 'TIMELINESS' as const, name: 'Customs Declarations · filing latency',
      description: 'Customs declarations should be filed before the shipment reaches the border. Rolling 24h.',
      threshold: 95, currentScore: 57, weight: 1, status: 'FAILING' as const,
      lastMeasured: ts, scheduleFrequency: 'HOURLY' as const, nextRunAt: daysFromNow(0), createdAt: ts, updatedAt: ts,
    },
  ]);

  // ── Edge connector (ONLINE) ──
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-cascade'), orgId: orgCascade.id, name: 'Cascade Fleet Data Connector',
    tokenHash: '9d2e4b7a15c8f60e3b9a1d5c7e2f4a8b0c6d3e1f5a9b7c2d4e6f8a0b1c3d5e7f',
    pairingCode: null, pairingCodeExpiresAt: null,
    systemIds: [sysTMS.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt, agentVersion: '1.2.0', status: 'ONLINE' as const,
    createdAt: connectorCreatedAt, updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  await repos.dataAssets.update(assetShipmentRecords.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  await createAll(repos.connectorEvents, [
    { id: demoId('ce-l-paired'), connectorId: conn.id, orgId: orgCascade.id, type: 'PAIRED', ts: connectorCreatedAt, data: { agentVersion: '1.2.0' } },
    { id: demoId('ce-l-scan-start'), connectorId: conn.id, orgId: orgCascade.id, type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: { targetSystemIds: [sysTMS.id, sysWarehouse.id] } },
    { id: demoId('ce-l-scan-done'), connectorId: conn.id, orgId: orgCascade.id, type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(), data: { durationMs: 40_780, assetsDiscovered: 1 } },
    { id: demoId('ce-l-assets'), connectorId: conn.id, orgId: orgCascade.id, type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(), data: { incoming: 1, created: 0, updated: 1 } },
    { id: demoId('ce-l-hb'), connectorId: conn.id, orgId: orgCascade.id, type: 'HEARTBEAT', ts: connectorHeartbeatAt, data: { agentVersion: '1.2.0' } },
  ]);

  // ── Second connector — PAIRING state ──
  const pairingConn = {
    id: demoId('conn-l-pairing'), orgId: orgCascade.id, name: 'Distribution Center Connector',
    tokenHash: null, pairingCode: '61508342',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[], lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-l-dgc'),
    orgId: orgCascade.id,
    name: 'Data Governance Council weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [omar.id, denise.id, travis.id, claudia.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgCascade.id, { coverage: 63, avgHealth: 71, gaps: 8, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgLineHaul.id, { coverage: 71, avgHealth: 73, gaps: 4, dataAssets: 4, mappings: 4 }),
    ...weeklySnapshots(orgWarehousing.id, { coverage: 66, avgHealth: 75, gaps: 3, dataAssets: 2, mappings: 3 }),
    ...weeklySnapshots(orgLogShared.id, { coverage: 50, avgHealth: 72, gaps: 3, dataAssets: 1, mappings: 0 }),
  ]);

  // ── AI template cache — pre-warm the wand for Cascade ──
  aiTemplateCache.push(
    {
      industry: 'logistics|line-haul freight',
      industryLabel: 'Transportation & Logistics — Line-Haul Freight',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Line-Haul Freight',
            description: 'Plan and tender the load, clear customs, dispatch, and deliver.',
            purpose: 'Move freight on time, in compliance, and with full traceability.',
            businessOutcome: 'On-time deliveries with cleared customs and captured proof of delivery.',
            processes: [
              { name: 'Load Planning & Tender', description: 'Plan and tender the load and clear customs.', purpose: 'Get a compliant, tendered load ready to move.', activities: [
                { name: 'Plan & tender load', description: 'Build the load against the order and tender it to a driver or carrier.' },
                { name: 'Clear customs', description: 'File the customs declaration and clear the cross-border shipment.' },
              ] },
              { name: 'Dispatch & Delivery', description: 'Dispatch the load, track it, and confirm delivery.', purpose: 'Deliver on time and capture proof.', activities: [
                { name: 'Dispatch & track', description: 'Dispatch the load and track it in transit against telematics.' },
                { name: 'Confirm delivery', description: 'Confirm delivery, capture proof of delivery, and close the load.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'logistics|warehousing & fulfillment',
      industryLabel: 'Transportation & Logistics — Warehousing & Fulfillment',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Warehousing & Fulfillment',
            description: 'Receive and put away inbound stock, then pick and ship outbound orders.',
            purpose: 'Keep inventory accurate and ship complete orders on time.',
            businessOutcome: 'Accurate inventory and on-time, accurate outbound shipments.',
            processes: [
              { name: 'Inbound Receiving', description: 'Receive, inspect, and put away inbound stock.', purpose: 'Get stock received and stored accurately.', activities: [
                { name: 'Receive & inspect', description: 'Receive inbound freight at the dock, inspect it, and post the receipt.' },
                { name: 'Put away stock', description: 'Direct the stock to a bin and update inventory locations.' },
              ] },
              { name: 'Outbound Fulfillment', description: 'Pick, pack, and ship outbound orders.', purpose: 'Deliver complete orders on time.', activities: [
                { name: 'Pick & ship order', description: 'Allocate inventory, pick and pack the order, and ship it.' },
                { name: 'Confirm shipment', description: 'Confirm the shipment and close the order.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgCascade.id,
    cdoId: omar.id,
    govLeadId: denise.id,
    dataOwnerId: travis.id,
    stewardIds: [molly.id, priyanka.id],
    tenantName: 'Cascade Logistics',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgCascade.id,
    domainIds: [domShipment.id, domFleet.id, domCustomer.id],
    cdoId: omar.id,
    govLeadId: denise.id,
    dataOwnerId: travis.id,
    stewardId: molly.id,
    techStewardId: priyanka.id,
    engineerId: ethan.id,
    architectId: diana.id,
    raciNodeId: actClearCustoms.id,
    raciPersonId: desh.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgCascade.id, ownerId: molly.id, cdoId: omar.id, domainId: domShipment.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgCascade.id, orgLineHaul.id, orgWarehousing.id],
    links: [
      { id: demoId('lin-1'), orgId: orgCascade.id, sourceSystemId: sysTMS.id, targetSystemId: sysWarehouse.id, dataAssetId: assetShipmentRecords.id, description: 'Load and shipment data syncs nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-2'), orgId: orgLineHaul.id, sourceSystemId: sysTelematics.id, targetSystemId: sysWarehouse.id, dataAssetId: assetTelematics.id, description: 'Telematics feeds stream into the warehouse.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
      { id: demoId('lin-3'), orgId: orgWarehousing.id, sourceSystemId: sysWMS.id, targetSystemId: sysWarehouse.id, dataAssetId: assetInventory.id, description: 'Warehouse inventory feeds the warehouse hourly.', flowType: 'ETL', frequency: 'HOURLY' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgCascade.id, sourceAssetId: assetCustomerMaster.id, targetAssetId: assetShipmentRecords.id },
      { id: demoId('edge-2'), orgId: orgLineHaul.id, sourceAssetId: assetShipmentRecords.id, targetAssetId: assetCustoms.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgCascade.id, agentId: demoId('agent-customs-gen'), agentName: 'Customs Filing Generator', activityId: actClearCustoms.id, activityName: 'Clear customs', roleType: 'TECHNICAL_DATA_STEWARD', createdBy: omar.id, reviewerId: denise.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgCascade.id, assetId: assetCustomerMaster.id, systemId: sysCRM.id, personId: molly.id, personName: 'Molly Tran' });

  logger.info({ persona: omar.name }, 'Demo data seeded (logistics)');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: omar.id, name: omar.name },
  };
}

/**
 * Insurance profile — a Northwind Mutual P&C insurer (Underwriting +
 * Claims + Shared Services), persona Priya Anand (CDO). Same fixed-count
 * skeleton and story shape as the other profiles: two planted orphan
 * assets on the warehouse, and a failing DQ rule co-located with the
 * ownership issue on the Bronze/critical Claims Loss Records asset — the
 * NAIC / model-risk / demonstrable-lineage story the industry page leads
 * with.
 */
async function seedInsurance(repos: DemoRepos, ts: string): Promise<DemoSeedReport> {
  // ── Organizations (company → 3 divisions → 6 departments) ──
  const orgNorthwind = { id: demoId('org-northwind'), parentId: null, name: 'Northwind Mutual', type: 'company', industry: 'Insurance', description: 'P&C mutual insurer demo tenant — underwriting + claims + shared services.', headCount: 0, tenantSlug: 'northwind', brandDisplayName: 'Northwind Mutual', brandGlyph: '☂', ssoButtonLabel: 'Sign in with Northwind SSO', brandPrimaryColor: '#0e7490', createdAt: ts, updatedAt: ts };
  const orgUnderwriting = { id: demoId('org-underwriting'), parentId: orgNorthwind.id, name: 'Underwriting', type: 'division', industry: 'Insurance', description: 'Personal and commercial lines underwriting', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgClaims = { id: demoId('org-claims'), parentId: orgNorthwind.id, name: 'Claims', type: 'division', industry: 'Insurance', description: 'Claims operations and special investigations', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgInsShared = { id: demoId('org-insshared'), parentId: orgNorthwind.id, name: 'Shared Services', type: 'division', industry: 'Insurance', description: 'IT / Actuarial & Compliance', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgPersonal = { id: demoId('org-personal'), parentId: orgUnderwriting.id, name: 'Personal Lines', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgCommercial = { id: demoId('org-commercial'), parentId: orgUnderwriting.id, name: 'Commercial Lines', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgClaimsOps = { id: demoId('org-claimsops'), parentId: orgClaims.id, name: 'Claims Operations', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgSIU = { id: demoId('org-siu'), parentId: orgClaims.id, name: 'Special Investigations', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgInsIT = { id: demoId('org-insit'), parentId: orgInsShared.id, name: 'Information Technology', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  const orgActuarial = { id: demoId('org-actuarial'), parentId: orgInsShared.id, name: 'Actuarial & Compliance', type: 'department', industry: '', description: '', headCount: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.organizations, [orgNorthwind, orgUnderwriting, orgClaims, orgInsShared, orgPersonal, orgCommercial, orgClaimsOps, orgSIU, orgInsIT, orgActuarial]);

  // ── People (24) — persona Priya Anand (CDO) ──
  const priya = { id: demoId('person-priya-anand'), orgIds: [orgNorthwind.id], accessibleOrgIds: [orgNorthwind.id, orgUnderwriting.id, orgClaims.id, orgInsShared.id, orgPersonal.id, orgCommercial.id, orgClaimsOps.id, orgSIU.id, orgInsIT.id, orgActuarial.id], name: 'Priya Anand', email: 'priya.anand@northwind-mutual.com', role: 'ORG_ADMIN', title: 'Chief Data Officer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gordon = { id: demoId('person-gordon'), orgIds: [orgNorthwind.id], accessibleOrgIds: [orgNorthwind.id], name: 'Gordon Steele', email: 'gordon.steele@northwind-mutual.com', role: 'ORG_ADMIN', title: 'Data Governance Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const fiona = { id: demoId('person-fiona'), orgIds: [orgUnderwriting.id], accessibleOrgIds: [orgUnderwriting.id], name: 'Fiona Walsh', email: 'fiona.walsh@northwind-mutual.com', role: 'ORG_ADMIN', title: 'Data Owner Underwriting', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const trevor = { id: demoId('person-trevor'), orgIds: [orgPersonal.id], accessibleOrgIds: [orgPersonal.id, orgUnderwriting.id], name: 'Trevor Nash', email: 'trevor.nash@northwind-mutual.com', role: 'EDITOR', title: 'Director Personal Lines', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const cara = { id: demoId('person-cara'), orgIds: [orgPersonal.id], accessibleOrgIds: [orgPersonal.id], name: 'Cara Dunn', email: 'cara.dunn@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Underwriting Data Lead', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const ito = { id: demoId('person-ito'), orgIds: [orgPersonal.id], accessibleOrgIds: [orgPersonal.id], name: 'Ito Watanabe', email: 'ito.watanabe@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Data Steward Personal Lines', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const beth = { id: demoId('person-beth'), orgIds: [orgPersonal.id], accessibleOrgIds: [orgPersonal.id], name: 'Beth Cardoso', email: 'beth.cardoso@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Underwriting Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const rhonda = { id: demoId('person-rhonda'), orgIds: [orgCommercial.id], accessibleOrgIds: [orgCommercial.id], name: 'Rhonda Pike', email: 'rhonda.pike@northwind-mutual.com', role: 'EDITOR', title: 'Manager Commercial Lines', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sunil = { id: demoId('person-sunil'), orgIds: [orgCommercial.id], accessibleOrgIds: [orgCommercial.id], name: 'Sunil Verma', email: 'sunil.verma@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Data Steward Commercial Lines', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const adam = { id: demoId('person-adam'), orgIds: [orgCommercial.id], accessibleOrgIds: [orgCommercial.id], name: 'Adam Fletcher', email: 'adam.fletcher@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Commercial Underwriter', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gerard = { id: demoId('person-gerard'), orgIds: [orgClaims.id], accessibleOrgIds: [orgClaims.id], name: 'Gerard Toussaint', email: 'gerard.toussaint@northwind-mutual.com', role: 'ORG_ADMIN', title: 'Data Owner Claims', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const nora = { id: demoId('person-nora'), orgIds: [orgClaimsOps.id], accessibleOrgIds: [orgClaimsOps.id, orgClaims.id], name: 'Nora Bianchi', email: 'nora.bianchi@northwind-mutual.com', role: 'EDITOR', title: 'Director Claims Operations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const kofi = { id: demoId('person-kofi'), orgIds: [orgClaimsOps.id], accessibleOrgIds: [orgClaimsOps.id], name: 'Kofi Mensah', email: 'kofi.mensah@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Data Steward Claims', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const lucia = { id: demoId('person-lucia'), orgIds: [orgClaimsOps.id], accessibleOrgIds: [orgClaimsOps.id], name: 'Lucia Romano', email: 'lucia.romano@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Claims Data Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const dmitri = { id: demoId('person-dmitri'), orgIds: [orgSIU.id], accessibleOrgIds: [orgSIU.id], name: 'Dmitri Volkov', email: 'dmitri.volkov@northwind-mutual.com', role: 'EDITOR', title: 'Manager Special Investigations', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const tanya = { id: demoId('person-tanya'), orgIds: [orgSIU.id], accessibleOrgIds: [orgSIU.id], name: 'Tanya Sokolov', email: 'tanya.sokolov@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'SIU Data Steward', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const manuel = { id: demoId('person-manuel'), orgIds: [orgInsIT.id], accessibleOrgIds: [orgInsIT.id], name: 'Manuel Ortega', email: 'manuel.ortega@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Lead Data Engineer', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const sophie = { id: demoId('person-sophie'), orgIds: [orgInsIT.id], accessibleOrgIds: [orgInsIT.id], name: 'Sophie Laurent', email: 'sophie.laurent@northwind-mutual.com', role: 'EDITOR', title: 'Manager Data & Analytics', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const idris = { id: demoId('person-idris'), orgIds: [orgInsIT.id], accessibleOrgIds: [orgInsIT.id], name: 'Idris Bello', email: 'idris.bello@northwind-mutual.com', role: 'EDITOR', title: 'Manager Information Security', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const margaret = { id: demoId('person-margaret'), orgIds: [orgActuarial.id], accessibleOrgIds: [orgActuarial.id], name: 'Margaret Doyle', email: 'margaret.doyle@northwind-mutual.com', role: 'EDITOR', title: 'Chief Actuary / Director', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const wei = { id: demoId('person-wei'), orgIds: [orgActuarial.id], accessibleOrgIds: [orgActuarial.id], name: 'Wei Zhang', email: 'wei.zhang@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Data Steward Actuarial Evidence', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const rupert = { id: demoId('person-rupert'), orgIds: [orgActuarial.id], accessibleOrgIds: [orgActuarial.id], name: 'Rupert Hastings', email: 'rupert.hastings@northwind-mutual.com', role: 'CONTRIBUTOR', title: 'Model Risk Analyst', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const vivienne = { id: demoId('person-vivienne'), orgIds: [orgActuarial.id], accessibleOrgIds: [orgActuarial.id], name: 'Vivienne Marsh', email: 'vivienne.marsh@northwind-mutual.com', role: 'EDITOR', title: 'Manager Regulatory Reporting', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  const gregory = { id: demoId('person-gregory'), orgIds: [orgActuarial.id], accessibleOrgIds: [orgActuarial.id], name: 'Gregory Stone', email: 'gregory.stone@northwind-mutual.com', role: 'EDITOR', title: 'Manager Compliance & Audit', skillIds: [], active: true, createdAt: ts, updatedAt: ts };
  await createAll(repos.people, [priya, gordon, fiona, trevor, cara, ito, beth, rhonda, sunil, adam, gerard, nora, kofi, lucia, dmitri, tanya, manuel, sophie, idris, margaret, wei, rupert, vivienne, gregory]);

  // ── Systems (8) — PAS / underwriting / claims / billing / CRM / actuarial / warehouse + fraud ──
  const sysPAS = { id: demoId('sys-pas'), orgId: orgNorthwind.id, name: 'Policy Administration System', description: 'Policy lifecycle — quotes, policies, endorsements, and renewals.', systemType: 'IT', vendorName: 'Guidewire PolicyCenter', ownerPersonId: cara.id, stewardIds: [ito.id], createdAt: ts, updatedAt: ts };
  const sysUW = { id: demoId('sys-uw'), orgId: orgUnderwriting.id, name: 'Underwriting Workbench', description: 'Rating engine and underwriting workbench — pricing factors and decisions.', systemType: 'IT', vendorName: 'Earnix', ownerPersonId: trevor.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysClaims = { id: demoId('sys-claimsys'), orgId: orgClaims.id, name: 'Claims Management System', description: 'Claim intake, adjudication, reserves, and settlement.', systemType: 'IT', vendorName: 'Guidewire ClaimCenter', ownerPersonId: kofi.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysBilling = { id: demoId('sys-insbilling'), orgId: orgNorthwind.id, name: 'Billing System', description: 'Premium billing, collections, and disbursements.', systemType: 'IT', vendorName: 'Guidewire BillingCenter', ownerPersonId: vivienne.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysCRM = { id: demoId('sys-inscrm'), orgId: orgNorthwind.id, name: 'Agency Portal', description: 'Agent and policyholder portal — accounts, quotes, and self-service.', systemType: 'IT', vendorName: 'Salesforce Financial Services Cloud', ownerPersonId: fiona.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysActuarial = { id: demoId('sys-actuarial'), orgId: orgActuarial.id, name: 'Actuarial Platform', description: 'Reserving, pricing models, and statutory reporting.', systemType: 'IT', vendorName: 'Moody’s AXIS', ownerPersonId: margaret.id, stewardIds: [wei.id], createdAt: ts, updatedAt: ts };
  const sysWarehouse = { id: demoId('sys-warehouse'), orgId: orgNorthwind.id, name: 'Data Warehouse', description: 'Enterprise analytics and reserving warehouse (Snowflake).', systemType: 'IT', vendorName: 'Snowflake', ownerPersonId: manuel.id, stewardIds: [] as string[], createdAt: ts, updatedAt: ts };
  const sysFraud = { id: demoId('sys-fraud'), orgId: orgSIU.id, name: 'SIU Fraud Analytics', description: 'Special-investigations fraud scoring, case management, and referrals.', systemType: 'IT', vendorName: 'SAS Fraud', ownerPersonId: dmitri.id, stewardIds: [tanya.id], createdAt: ts, updatedAt: ts };
  await createAll(repos.systems, [sysPAS, sysUW, sysClaims, sysBilling, sysCRM, sysActuarial, sysWarehouse, sysFraud]);

  // ── Agents (5 — one of each type) ──
  await createAll(repos.agents, [
    { id: demoId('agent-fraud-model'), orgIds: [orgClaims.id], name: 'Claims Fraud Model', agentType: 'AI', description: 'Scores claims for fraud risk from claim, policy, and third-party data.', provider: 'Internal ML Platform', status: 'ACTIVE', ownerPersonId: dmitri.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-reserving-pipeline'), orgIds: [orgNorthwind.id], name: 'Reserving Data Pipeline', agentType: 'PIPELINE', description: 'Nightly ETL of policy and claims data into the reserving warehouse.', provider: 'Apache Airflow', status: 'ACTIVE', ownerPersonId: manuel.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-referral-bot'), orgIds: [orgUnderwriting.id], name: 'Underwriting Referral Bot', agentType: 'BOT', description: 'Alerts underwriters when a submission breaches referral rules.', provider: 'Microsoft Teams', status: 'ACTIVE', ownerPersonId: cara.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-pas-service'), orgIds: [orgInsIT.id], name: 'PAS Extract Service Account', agentType: 'SERVICE_ACCOUNT', description: 'Read-only account used by analytics jobs to extract policy tables.', provider: 'Guidewire', status: 'ACTIVE', ownerPersonId: manuel.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
    { id: demoId('agent-statutory-gen'), orgIds: [orgNorthwind.id], name: 'Statutory Filing Generator', agentType: 'OTHER', description: 'Scheduled generator assembling NAIC statutory and Model Audit Rule filing packages.', provider: 'Internal', status: 'ACTIVE', ownerPersonId: vivienne.id, skillIds: [], instructions: '', createdAt: ts, updatedAt: ts },
  ]);

  // ── Data Domains (3 top-level + 3 sub-domains under Policy & Customer Data) ──
  const domPolicy = { id: demoId('domain-policy'), code: 'POL', orgId: orgNorthwind.id, name: 'Policy & Customer Data', description: 'Policyholder master and the personal and commercial policies they hold.', ownerId: priya.id, stewardIds: [ito.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domClaimsData = { id: demoId('domain-claims'), code: 'CLM', orgId: orgNorthwind.id, name: 'Claims & Loss Data', description: 'Claim loss records, reserves, and settlement history.', ownerId: gerard.id, stewardIds: [kofi.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domActuarialData = { id: demoId('domain-actuarial'), code: 'ACT', orgId: orgNorthwind.id, name: 'Actuarial & Regulatory Data', description: 'Rating and pricing factors, premium and billing, and statutory reporting.', ownerId: margaret.id, stewardIds: [wei.id], dataAssetIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  // Sub-domains under Policy & Customer Data — the lines of business. Parent created first.
  const domPolicyPersonal = { id: demoId('domain-policy-personal'), code: 'POL-01', orgId: orgNorthwind.id, name: 'Personal Lines Policies', description: 'Personal auto, home, and umbrella policies.', ownerId: trevor.id, stewardIds: [ito.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domPolicy.id, createdAt: ts, updatedAt: ts };
  const domPolicyCommercial = { id: demoId('domain-policy-commercial'), code: 'POL-02', orgId: orgNorthwind.id, name: 'Commercial Lines Policies', description: 'Commercial property, liability, and workers’ comp policies.', ownerId: rhonda.id, stewardIds: [sunil.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domPolicy.id, createdAt: ts, updatedAt: ts };
  const domPolicyBilling = { id: demoId('domain-policy-billing'), code: 'POL-03', orgId: orgNorthwind.id, name: 'Billing & Payments', description: 'Premium billing, collections, and disbursements.', ownerId: vivienne.id, stewardIds: [wei.id], dataAssetIds: [] as string[], status: 'ACTIVE', parentDomainId: domPolicy.id, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataDomains, [domPolicy, domClaimsData, domActuarialData, domPolicyPersonal, domPolicyCommercial, domPolicyBilling]);

  // ── Data Assets (9) ──
  const assetPolicyholderMaster = { id: demoId('asset-policyholder-master'), orgId: orgNorthwind.id, name: 'Policyholder Master', description: 'The golden policyholder record — identity, contacts, and the policies they hold.', systemId: sysCRM.id, owner: '', ownerPersonId: ito.id, stewardIds: [] as string[], governanceTier: 'GOLD' as const, healthScore: 91, createdAt: ts, updatedAt: ts };
  const assetPersonalPolicies = { id: demoId('asset-personal-policies'), orgId: orgNorthwind.id, name: 'Personal Lines Policies', description: 'Personal auto, home, and umbrella policies, endorsements, and renewals.', systemId: sysPAS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 85, createdAt: ts, updatedAt: ts };
  const assetCommercialPolicies = { id: demoId('asset-commercial-policies'), orgId: orgNorthwind.id, name: 'Commercial Lines Policies', description: 'Commercial property, liability, and workers’ comp policies.', systemId: sysPAS.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 83, createdAt: ts, updatedAt: ts };
  const assetClaimsLoss = { id: demoId('asset-claims-loss'), orgId: orgNorthwind.id, name: 'Claims Loss Records', description: 'Claim files, adjudications, payments, and loss detail — the reserving source.', systemId: sysClaims.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 56, createdAt: ts, updatedAt: ts };
  const assetPremiumBilling = { id: demoId('asset-premium-billing'), orgId: orgNorthwind.id, name: 'Premium & Billing', description: 'Premium billing, collections, and disbursement records.', systemId: sysBilling.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 84, createdAt: ts, updatedAt: ts };
  const assetReserves = { id: demoId('asset-reserves'), orgId: orgNorthwind.id, name: 'Loss Reserves Dataset', description: 'The reconciled reserving dataset behind statutory filings and pricing.', systemId: sysActuarial.id, owner: '', ownerPersonId: margaret.id, stewardIds: [wei.id] as string[], governanceTier: 'GOLD' as const, healthScore: 93, createdAt: ts, updatedAt: ts };
  const assetRatingFactors = { id: demoId('asset-rating-factors'), orgId: orgNorthwind.id, name: 'Rating & Pricing Factors', description: 'Rating tables, rating factors, and pricing model inputs.', systemId: sysUW.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'SILVER' as const, healthScore: 82, createdAt: ts, updatedAt: ts };
  // Planted orphans — obviously-named so Ask AI's orphan-detection returns a quotable answer.
  const orphanLegacyPolicy = { id: demoId('asset-legacy-policy'), orgId: orgNorthwind.id, name: 'Legacy Policy Extract', description: 'Nightly dump from the retired policy system. Kept as a fallback but no process references it.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  const orphanSiuCsv = { id: demoId('asset-siu-csv'), orgId: orgNorthwind.id, name: 'SIU CSV Dump', description: 'Ad-hoc CSV extract of fraud referrals for an old reporting deck. Nobody remembers if it is still used.', systemId: sysWarehouse.id, owner: '', ownerPersonId: null, stewardIds: [] as string[], governanceTier: 'BRONZE' as const, healthScore: 0, createdAt: ts, updatedAt: ts };
  await createAll(repos.dataAssets, [assetPolicyholderMaster, assetPersonalPolicies, assetCommercialPolicies, assetClaimsLoss, assetPremiumBilling, assetReserves, assetRatingFactors, orphanLegacyPolicy, orphanSiuCsv]);

  // Domain → asset backrefs so the Domains page shows counts.
  await repos.dataDomains.update(domPolicy.id, { dataAssetIds: [assetPolicyholderMaster.id, assetPersonalPolicies.id, assetCommercialPolicies.id] });
  await repos.dataDomains.update(domClaimsData.id, { dataAssetIds: [assetClaimsLoss.id, assetReserves.id] });
  await repos.dataDomains.update(domActuarialData.id, { dataAssetIds: [assetRatingFactors.id, assetPremiumBilling.id] });

  // ── Process hierarchy — VS1 Policy Underwriting (Underwriting) ──
  const vsUnderwriting = { id: demoId('node-vs-underwriting'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Policy Underwriting', description: 'End-to-end underwriting — take the application, rate and quote it, underwrite it, and issue the policy.', activityId: 'VS-DEMO-I1', status: 'ACTIVE', orderIndex: 0, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: fiona.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procQuote = { id: demoId('node-proc-quote'), parentId: vsUnderwriting.id, level: 'PROCESS' as const, name: 'Quote & Rate', description: 'Capture the application and rate and quote it.', activityId: 'PRO-DEMO-I1', status: 'ACTIVE', orderIndex: 0, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: trevor.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procIssue = { id: demoId('node-proc-issue'), parentId: vsUnderwriting.id, level: 'PROCESS' as const, name: 'Underwrite & Issue', description: 'Underwrite the risk and bind and issue the policy.', activityId: 'PRO-DEMO-I2', status: 'ACTIVE', orderIndex: 1, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: rhonda.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spIntake = { id: demoId('node-sp-intake'), parentId: procQuote.id, level: 'SUBPROCESS' as const, name: 'Application Intake', description: 'Take the application and rate and quote it.', activityId: 'SP-DEMO-I1', status: 'ACTIVE', orderIndex: 0, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: cara.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actCaptureApp = { id: demoId('node-act-captureapp'), parentId: spIntake.id, level: 'ACTIVITY' as const, name: 'Capture application', description: 'Take the applicant submission and match to the policyholder master.', activityId: 'ACT-DEMO-I1', status: 'ACTIVE', orderIndex: 0, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: cara.id, responsibleRole: 'Underwriting Data Lead', responsiblePersonId: cara.id, systemIds: [sysPAS.id, sysCRM.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_2' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actRateQuote = { id: demoId('node-act-ratequote'), parentId: spIntake.id, level: 'ACTIVITY' as const, name: 'Rate & quote', description: 'Rate the risk against the rating factors and generate the quote.', activityId: 'ACT-DEMO-I2', status: 'ACTIVE', orderIndex: 1, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: cara.id, responsibleRole: 'Underwriting Analyst', responsiblePersonId: beth.id, systemIds: [sysUW.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Quotes rated against current, approved rating tables', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actUnderwrite = { id: demoId('node-act-iunderwrite'), parentId: procIssue.id, level: 'ACTIVITY' as const, name: 'Underwrite & decision', description: 'Assess the risk and approve, decline, or refer the submission.', activityId: 'ACT-DEMO-I3', status: 'ACTIVE', orderIndex: 0, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: rhonda.id, responsibleRole: 'Commercial Underwriter', responsiblePersonId: adam.id, systemIds: [sysUW.id, sysPAS.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actBindIssue = { id: demoId('node-act-bindissue'), parentId: procIssue.id, level: 'ACTIVITY' as const, name: 'Bind & issue policy', description: 'Bind the risk, issue the policy, and set up billing.', activityId: 'ACT-DEMO-I4', status: 'ACTIVE', orderIndex: 1, orgId: orgUnderwriting.id, orgIds: [orgUnderwriting.id], ownerId: trevor.id, responsibleRole: 'Data Steward Personal Lines', responsiblePersonId: ito.id, systemIds: [sysPAS.id, sysBilling.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Policies issued and billed accurately on bind', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsUnderwriting, procQuote, procIssue, spIntake, actCaptureApp, actRateQuote, actUnderwrite, actBindIssue]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-i1'), fromNodeId: actCaptureApp.id, toNodeId: actRateQuote.id, type: 'SEQUENCE' as const, label: 'application taken', createdAt: ts },
    { id: demoId('flow-i2'), fromNodeId: actRateQuote.id, toNodeId: actUnderwrite.id, type: 'SEQUENCE' as const, label: 'quoted', createdAt: ts },
    { id: demoId('flow-i3'), fromNodeId: actUnderwrite.id, toNodeId: actBindIssue.id, type: 'SEQUENCE' as const, label: 'approved', createdAt: ts },
  ]);

  // ── Process hierarchy — VS2 Claims Management (Claims) ──
  const vsClaims = { id: demoId('node-vs-claims'), parentId: null, level: 'VALUE_STREAM' as const, name: 'Claims Management', description: 'Take first notice of loss, adjudicate the claim, and settle and recover.', activityId: 'VS-DEMO-I2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgClaims.id, orgIds: [orgClaims.id], ownerId: gerard.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procAdjudicate = { id: demoId('node-proc-adjudicate'), parentId: vsClaims.id, level: 'PROCESS' as const, name: 'Claim Intake & Adjudication', description: 'Register the claim and adjudicate it.', activityId: 'PRO-DEMO-I3', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgClaims.id, orgIds: [orgClaims.id], ownerId: nora.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const procSettle = { id: demoId('node-proc-settle'), parentId: vsClaims.id, level: 'PROCESS' as const, name: 'Settlement & Recovery', description: 'Settle the claim, pay it, and pursue recovery.', activityId: 'PRO-DEMO-I4', status: 'ACTIVE' as const, orderIndex: 1, orgId: orgClaims.id, orgIds: [orgClaims.id], ownerId: nora.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const spFNOL = { id: demoId('node-sp-fnol'), parentId: procAdjudicate.id, level: 'SUBPROCESS' as const, name: 'First Notice of Loss', description: 'Register the claim and open the file.', activityId: 'SP-DEMO-I2', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgClaims.id, orgIds: [orgClaims.id], ownerId: kofi.id, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actRegisterClaim = { id: demoId('node-act-registerclaim'), parentId: spFNOL.id, level: 'ACTIVITY' as const, name: 'Register claim (FNOL)', description: 'Take first notice of loss and match it to the policyholder and policy.', activityId: 'ACT-DEMO-I5', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgClaims.id, orgIds: [orgClaims.id], ownerId: kofi.id, responsibleRole: 'Data Steward Claims', responsiblePersonId: kofi.id, systemIds: [sysClaims.id, sysCRM.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actAdjudicate = { id: demoId('node-act-adjudicate'), parentId: procAdjudicate.id, level: 'ACTIVITY' as const, name: 'Adjudicate claim', description: 'Investigate and adjudicate the claim and record the loss and reserve.', activityId: 'ACT-DEMO-I6', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgClaims.id, orgIds: [orgClaims.id], ownerId: nora.id, responsibleRole: 'Claims Data Analyst', responsiblePersonId: lucia.id, systemIds: [sysClaims.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 4, successMeasure: 'Every claim adjudicated with a complete, timely loss record', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  const actSettle = { id: demoId('node-act-settle'), parentId: procSettle.id, level: 'ACTIVITY' as const, name: 'Settle & pay claim', description: 'Settle the claim, pay it, and update reserves.', activityId: 'ACT-DEMO-I7', status: 'ACTIVE' as const, orderIndex: 0, orgId: orgClaims.id, orgIds: [orgClaims.id], ownerId: nora.id, responsibleRole: 'Chief Actuary / Director', responsiblePersonId: margaret.id, systemIds: [sysClaims.id, sysActuarial.id], requiredSkillIds: [] as string[], criticalityTier: 'TIER_1' as const, rtoHours: 8, successMeasure: 'Settlements paid accurately and reserves reconciled', version: 1, domain: 'OPERATIONAL' as const, createdAt: ts, updatedAt: ts };
  await createAll(repos.processNodes, [vsClaims, procAdjudicate, procSettle, spFNOL, actRegisterClaim, actAdjudicate, actSettle]);

  await createAll(repos.flowRelationships, [
    { id: demoId('flow-i4'), fromNodeId: actRegisterClaim.id, toNodeId: actAdjudicate.id, type: 'SEQUENCE' as const, label: 'claim registered', createdAt: ts },
  ]);

  // ── Mappings (7) ──
  await createAll(repos.mappings, [
    { id: demoId('map-i1'), orgId: orgUnderwriting.id, processStepId: actCaptureApp.id, dataAssetId: assetPolicyholderMaster.id, linkType: 'INPUT', notes: 'Matches the applicant to the policyholder master', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-i2'), orgId: orgUnderwriting.id, processStepId: actRateQuote.id, dataAssetId: assetRatingFactors.id, linkType: 'INPUT', notes: 'Rates the risk against the rating factors', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-i3'), orgId: orgUnderwriting.id, processStepId: actUnderwrite.id, dataAssetId: assetPersonalPolicies.id, linkType: 'OUTPUT', notes: 'Writes the underwritten policy', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-i4'), orgId: orgUnderwriting.id, processStepId: actBindIssue.id, dataAssetId: assetPremiumBilling.id, linkType: 'OUTPUT', notes: 'Sets up billing on bind', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-i5'), orgId: orgClaims.id, processStepId: actRegisterClaim.id, dataAssetId: assetPolicyholderMaster.id, linkType: 'INPUT', notes: 'Matches the claim to the policyholder and policy', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-i6'), orgId: orgClaims.id, processStepId: actAdjudicate.id, dataAssetId: assetClaimsLoss.id, linkType: 'OUTPUT', notes: 'Writes the loss record + reserve', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
    { id: demoId('map-i7'), orgId: orgClaims.id, processStepId: actSettle.id, dataAssetId: assetReserves.id, linkType: 'OUTPUT', notes: 'Updates the reserves dataset on settlement', aiSuggested: false, userOverridden: false, createdAt: ts, updatedAt: ts, createdBy: null } as any,
  ]);

  // ── Governance tasks assigned to Priya (populates My Dashboard) ──
  await createAll(repos.governanceTasks, [
    { id: demoId('task-i1'), orgId: orgNorthwind.id, title: 'Approve Claims Loss Records classification review', description: 'Review the AI-suggested sensitivity tags on Claims Loss Records and the Loss Reserves Dataset and approve or reject each.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'HIGH' as any, assigneeId: priya.id, dueDate: daysFromNow(3), linkedObjectType: 'DataAsset', linkedObjectId: assetClaimsLoss.id, automationMode: 'HUMAN' as any, createdBy: gordon.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-i2'), orgId: orgNorthwind.id, title: 'Sign off on Claims & Loss domain scope', description: 'Gerard has proposed expanding the Claims & Loss domain to cover new Model Audit Rule evidence fields.', taskType: 'REVIEW' as any, status: 'OPEN' as any, priority: 'MEDIUM' as any, assigneeId: priya.id, dueDate: daysFromNow(7), linkedObjectType: 'DataDomain', linkedObjectId: domClaimsData.id, automationMode: 'HUMAN' as any, createdBy: gerard.id, createdAt: ts, updatedAt: ts, completedAt: null },
    { id: demoId('task-i3'), orgId: orgNorthwind.id, title: 'Retire Legacy Policy Extract or find its owner', description: 'This asset has been sitting orphaned for two quarters. Confirm it can go, or reassign it.', taskType: 'GENERAL' as any, status: 'OPEN' as any, priority: 'LOW' as any, assigneeId: priya.id, dueDate: daysFromNow(14), linkedObjectType: 'DataAsset', linkedObjectId: orphanLegacyPolicy.id, automationMode: 'HUMAN' as any, createdBy: null, createdAt: ts, updatedAt: ts, completedAt: null },
  ]);

  // ── One open governance issue assigned to Priya ──
  await repos.governanceIssues.create({
    id: demoId('issue-i1'),
    orgId: orgNorthwind.id,
    title: 'Claims Loss Records tier below Silver — critical process, ungoverned',
    description: 'Claims Loss Records is BRONZE tier but the Claims process writes it as the reserving source of record. Recommend promoting to Silver with an SLA target.',
    issueType: 'OWNERSHIP' as any,
    severity: 'HIGH' as any,
    status: 'OPEN' as any,
    domainId: domClaimsData.id,
    dataAssetId: assetClaimsLoss.id,
    systemId: sysClaims.id,
    reportedBy: gordon.id,
    assignedTo: priya.id,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  } as any);

  // ── Data Quality rules (2 — one passing, one failing) ──
  await createAll(repos.dataQualityRules, [
    {
      id: demoId('dq-rule-passing'), orgId: orgNorthwind.id, dataAssetId: assetPersonalPolicies.id,
      dimension: 'COMPLETENESS' as const, name: 'Personal Lines · policy completeness',
      description: 'At least 95% of policies must carry a complete insured, coverage, and term.',
      threshold: 95, currentScore: 98, weight: 1, status: 'PASSING' as const,
      lastMeasured: ts, scheduleFrequency: 'DAILY' as const, nextRunAt: daysFromNow(1), createdAt: ts, updatedAt: ts,
    },
    {
      id: demoId('dq-rule-failing'), orgId: orgNorthwind.id, dataAssetId: assetClaimsLoss.id,
      dimension: 'TIMELINESS' as const, name: 'Claims Loss Records · reserve posting latency',
      description: 'Loss and reserve detail should be posted within the reserving SLA. Rolling 24h.',
      threshold: 95, currentScore: 56, weight: 1, status: 'FAILING' as const,
      lastMeasured: ts, scheduleFrequency: 'HOURLY' as const, nextRunAt: daysFromNow(0), createdAt: ts, updatedAt: ts,
    },
  ]);

  // ── Edge connector (ONLINE) ──
  const connectorHeartbeatAt = new Date(Date.now() - 45 * 1000).toISOString();
  const connectorCreatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const connectorSyncAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const conn = {
    id: demoId('conn-northwind'), orgId: orgNorthwind.id, name: 'Northwind Policy Data Connector',
    tokenHash: '2f8a4d1c7b3e9605a2d8c4f1e7b3a9d5c0f6e2b8a4d1c7f3e9b5a0d6c2f8e4b1',
    pairingCode: null, pairingCodeExpiresAt: null,
    systemIds: [sysPAS.id, sysWarehouse.id],
    lastHeartbeatAt: connectorHeartbeatAt, agentVersion: '1.2.0', status: 'ONLINE' as const,
    createdAt: connectorCreatedAt, updatedAt: connectorHeartbeatAt,
  };
  await repos.connectors.create(conn);

  await repos.dataAssets.update(assetPersonalPolicies.id, {
    lastSyncedByConnectorId: conn.id,
    lastSyncedAt: connectorSyncAt,
  } as any);

  await createAll(repos.connectorEvents, [
    { id: demoId('ce-i-paired'), connectorId: conn.id, orgId: orgNorthwind.id, type: 'PAIRED', ts: connectorCreatedAt, data: { agentVersion: '1.2.0' } },
    { id: demoId('ce-i-scan-start'), connectorId: conn.id, orgId: orgNorthwind.id, type: 'SCAN_STARTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: { targetSystemIds: [sysPAS.id, sysWarehouse.id] } },
    { id: demoId('ce-i-scan-done'), connectorId: conn.id, orgId: orgNorthwind.id, type: 'SCAN_COMPLETED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 40 * 1000).toISOString(), data: { durationMs: 40_960, assetsDiscovered: 1 } },
    { id: demoId('ce-i-assets'), connectorId: conn.id, orgId: orgNorthwind.id, type: 'ASSETS_REPORTED', ts: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000).toISOString(), data: { incoming: 1, created: 0, updated: 1 } },
    { id: demoId('ce-i-hb'), connectorId: conn.id, orgId: orgNorthwind.id, type: 'HEARTBEAT', ts: connectorHeartbeatAt, data: { agentVersion: '1.2.0' } },
  ]);

  // ── Second connector — PAIRING state ──
  const pairingConn = {
    id: demoId('conn-i-pairing'), orgId: orgNorthwind.id, name: 'Claims Office Connector',
    tokenHash: null, pairingCode: '39174865',
    pairingCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    systemIds: [] as string[], lastHeartbeatAt: null, agentVersion: null, status: 'PAIRED' as const,
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(), updatedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  };
  await repos.connectors.create(pairingConn as any);

  // ── Governance calendar event ──
  const dayNow = new Date();
  const daysUntilFriday = (5 - dayNow.getDay() + 7) % 7 || 7;
  const nextFriday = new Date(dayNow.getFullYear(), dayNow.getMonth(), dayNow.getDate() + daysUntilFriday, 9, 0, 0);
  await repos.calendarEvents.create({
    id: demoId('cal-i-dgc'),
    orgId: orgNorthwind.id,
    name: 'Data Governance Council weekly',
    description: 'Weekly cross-domain review — open issues, escalations, control decisions, upcoming policy work.',
    eventType: 'COMMITTEE_MEETING' as const,
    cadence: 'WEEKLY' as const,
    dayOfMonth: null,
    dayOfWeek: 5,
    timeOfDay: '09:00',
    durationMinutes: 60,
    attendees: [priya.id, gordon.id, fiona.id, margaret.id],
    agendaTemplate: '1. Open governance issues (from bell)\n2. Domain scope changes\n3. Control effectiveness review\n4. Upcoming policy publications',
    nextOccurrence: nextFriday.toISOString(),
    lastOccurrence: null,
    autoCreateTasks: false,
    status: 'ACTIVE' as const,
    createdAt: ts,
    updatedAt: ts,
  });

  // ── Dashboard stats snapshots — ~10 weekly rows per demo org ──
  await createAll(repos.statsSnapshots, [
    ...weeklySnapshots(orgNorthwind.id, { coverage: 64, avgHealth: 72, gaps: 8, dataAssets: 9, mappings: 7 }),
    ...weeklySnapshots(orgUnderwriting.id, { coverage: 72, avgHealth: 74, gaps: 4, dataAssets: 4, mappings: 4 }),
    ...weeklySnapshots(orgClaims.id, { coverage: 60, avgHealth: 70, gaps: 4, dataAssets: 2, mappings: 3 }),
    ...weeklySnapshots(orgInsShared.id, { coverage: 55, avgHealth: 73, gaps: 3, dataAssets: 3, mappings: 0 }),
  ]);

  // ── AI template cache — pre-warm the wand for Northwind ──
  aiTemplateCache.push(
    {
      industry: 'insurance|policy underwriting',
      industryLabel: 'Insurance — Policy Underwriting',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Policy Underwriting',
            description: 'Take the application, rate and quote it, underwrite it, and issue the policy.',
            purpose: 'Write profitable, well-priced risk quickly and issue accurate policies.',
            businessOutcome: 'On-SLA quotes rated against approved tables and accurately issued and billed policies.',
            processes: [
              { name: 'Quote & Rate', description: 'Capture the application and rate and quote it.', purpose: 'Turn a submission into an accurate quote.', activities: [
                { name: 'Capture application', description: 'Take the submission and match to the policyholder master.' },
                { name: 'Rate & quote', description: 'Rate the risk against the rating factors and generate the quote.' },
              ] },
              { name: 'Underwrite & Issue', description: 'Underwrite the risk and bind and issue the policy.', purpose: 'Decide the risk and issue the policy.', activities: [
                { name: 'Underwrite & decision', description: 'Assess the risk and approve, decline, or refer the submission.' },
                { name: 'Bind & issue policy', description: 'Bind the risk, issue the policy, and set up billing.' },
              ] },
            ],
          },
        ],
      },
    },
    {
      industry: 'insurance|claims management',
      industryLabel: 'Insurance — Claims Management',
      generatedAt: ts,
      data: {
        valueStreams: [
          {
            name: 'Claims Management',
            description: 'Take first notice of loss, adjudicate the claim, and settle and recover.',
            purpose: 'Pay valid claims fairly and quickly with accurate loss and reserve data.',
            businessOutcome: 'Claims adjudicated with complete loss records and settlements reconciled to reserves.',
            processes: [
              { name: 'Claim Intake & Adjudication', description: 'Register the claim and adjudicate it.', purpose: 'Open and decide the claim.', activities: [
                { name: 'Register claim (FNOL)', description: 'Take first notice of loss and match it to the policy.' },
                { name: 'Adjudicate claim', description: 'Investigate and adjudicate the claim and record the loss and reserve.' },
              ] },
              { name: 'Settlement & Recovery', description: 'Settle the claim, pay it, and pursue recovery.', purpose: 'Pay and close the claim and reconcile reserves.', activities: [
                { name: 'Settle & pay claim', description: 'Settle the claim, pay it, and update reserves.' },
                { name: 'Pursue recovery', description: 'Pursue subrogation and salvage recovery and close the file.' },
              ] },
            ],
          },
        ],
      },
    },
  );
  saveStore('aiTemplateCache', aiTemplateCache);

  // Governance depth — policies, controls, groups, program, decision rights.
  await seedGovernanceDepth(repos, ts, {
    orgId: orgNorthwind.id,
    cdoId: priya.id,
    govLeadId: gordon.id,
    dataOwnerId: fiona.id,
    stewardIds: [ito.id, wei.id],
    tenantName: 'Northwind Mutual',
  });

  // People depth — skills catalog, skill assignments, DAMA roles, RACI.
  await seedPeopleDepth(repos, ts, {
    orgId: orgNorthwind.id,
    domainIds: [domPolicy.id, domClaimsData.id, domActuarialData.id],
    cdoId: priya.id,
    govLeadId: gordon.id,
    dataOwnerId: fiona.id,
    stewardId: ito.id,
    techStewardId: wei.id,
    engineerId: manuel.id,
    architectId: sophie.id,
    raciNodeId: actAdjudicate.id,
    raciPersonId: lucia.id,
  });

  // Docs depth — SOPs, glossary terms, operations manuals.
  await seedDocsDepth(repos, ts, { orgId: orgNorthwind.id, ownerId: ito.id, cdoId: priya.id, domainId: domPolicy.id });

  // Lineage + trend history.
  await seedLineageAndTrends(repos, ts, {
    orgIds: [orgNorthwind.id, orgUnderwriting.id, orgClaims.id],
    links: [
      { id: demoId('lin-1'), orgId: orgNorthwind.id, sourceSystemId: sysPAS.id, targetSystemId: sysWarehouse.id, dataAssetId: assetPersonalPolicies.id, description: 'Policy data syncs nightly to the warehouse.', flowType: 'ETL', frequency: 'DAILY' },
      { id: demoId('lin-2'), orgId: orgClaims.id, sourceSystemId: sysClaims.id, targetSystemId: sysWarehouse.id, dataAssetId: assetClaimsLoss.id, description: 'Claims loss data feeds the reserving warehouse.', flowType: 'ETL', frequency: 'HOURLY' },
      { id: demoId('lin-3'), orgId: orgNorthwind.id, sourceSystemId: sysActuarial.id, targetSystemId: sysWarehouse.id, dataAssetId: assetReserves.id, description: 'Reserving outputs stream into the warehouse.', flowType: 'STREAMING', frequency: 'REAL_TIME' },
    ],
    edges: [
      { id: demoId('edge-1'), orgId: orgNorthwind.id, sourceAssetId: assetPolicyholderMaster.id, targetAssetId: assetPersonalPolicies.id },
      { id: demoId('edge-2'), orgId: orgClaims.id, sourceAssetId: assetClaimsLoss.id, targetAssetId: assetReserves.id },
    ],
  });

  // Agent operations — schedules + executions for a seeded agent.
  await seedAgentOps(repos, ts, { orgId: orgNorthwind.id, agentId: demoId('agent-statutory-gen'), agentName: 'Statutory Filing Generator', activityId: actSettle.id, activityName: 'Settle & pay claim', roleType: 'TECHNICAL_DATA_STEWARD', createdBy: priya.id, reviewerId: gordon.id });

  // Collaboration + reporting + connections.
  await seedCollabAndReporting(repos, ts, { orgId: orgNorthwind.id, assetId: assetPolicyholderMaster.id, systemId: sysCRM.id, personId: ito.id, personName: 'Ito Watanabe' });

  logger.info({ persona: priya.name }, 'Demo data seeded (insurance)');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    dataDomains: 6,
    dataAssets: 9,
    processNodes: 15,
    mappings: 7,
    governanceTasks: 3,
    governanceIssues: 1,
    dataQualityRules: 2,
    connectors: 2,
    connectorEvents: 5,
    calendarEvents: 1,
    statsSnapshots: STATS_WEEKS * 4,
    persona: { id: priya.id, name: priya.name },
  };
}
