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
import { businessCapabilities } from '../routes/business-capabilities';
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
import { dataLineageLinks, assetLineageEdges } from '../routes/data-lineage';
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
import { getBusinessCapabilitiesRepository } from '../db/business-capabilities.repo';
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

// Industries with a hand-crafted demo fixture. Both are built to the
// same feature coverage so a demo of either lights up every page.
export type DemoIndustry = 'utilities' | 'shipbuilding';

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
  businessCapabilities: Repository<any>;
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
    businessCapabilities: getBusinessCapabilitiesRepository(businessCapabilities as any),
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
  await sweepRepo(repos.businessCapabilities);
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
  businessCapabilities: number;
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
  const report = industry === 'shipbuilding'
    ? await seedShipbuilding(repos, ts)
    : await seedUtilities(repos, ts);
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

  // ── Business Capabilities (the grouping level above Data Domain) ──
  // Capability → Data Domain → Sub-Domain. Created before the domains so the
  // businessCapabilityId FK resolves on import.
  const capCustomer = { id: demoId('capability-customer'), code: 'CUST', orgId: orgTidewater.id, name: 'Customer Management', description: 'Serving customers end to end — accounts, billing, and service. Groups the customer-facing data domains.', ownerId: susan.id, dataDomainIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const capGridOps = { id: demoId('capability-grid-ops'), code: 'GRDOPS', orgId: orgTidewater.id, name: 'Grid & Generation Operations', description: 'Running the physical network — grid telemetry, generation, and metering. Groups the operational data domains.', ownerId: jennifer.id, dataDomainIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const capCompliance = { id: demoId('capability-compliance'), code: 'RCOMP', orgId: orgTidewater.id, name: 'Regulatory Compliance', description: 'Meeting NERC CIP, EPA SDWA, and rate-case obligations. Groups the regulatory data domains.', ownerId: lorraine.id, dataDomainIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  await createAll(repos.businessCapabilities, [capCustomer, capGridOps, capCompliance]);

  // ── Data Domains ──
  const domCustomer = { id: demoId('domain-customer'), code: 'CUST', orgId: orgTidewater.id, name: 'Customer Data', description: 'Customer accounts, addresses, service history, billing.', ownerId: susan.id, stewardIds: [natalie.id], dataAssetIds: [] as string[], businessCapabilityId: capCustomer.id, status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domOps = { id: demoId('domain-ops'), code: 'OPS', orgId: orgTidewater.id, name: 'Operational Data', description: 'Grid, generation, metering — the real-time and near-real-time operational feeds.', ownerId: jennifer.id, stewardIds: [brandon.id, deborah.id], dataAssetIds: [] as string[], businessCapabilityId: capGridOps.id, status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domRegulatory = { id: demoId('domain-regulatory'), code: 'REG', orgId: orgTidewater.id, name: 'Regulatory Data', description: 'Compliance evidence, filings, rate case data, NERC CIP + EPA SDWA.', ownerId: lorraine.id, stewardIds: [phillip.id], dataAssetIds: [] as string[], businessCapabilityId: capCompliance.id, status: 'ACTIVE', createdAt: ts, updatedAt: ts };
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

  logger.info({ persona: susan.name }, 'Demo data seeded');

  return {
    organizations: 10,
    people: 24,
    systems: 8,
    agents: 5,
    businessCapabilities: 3,
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

  // ── Business Capabilities (3) — grouping level above Data Domain ──
  const capEngineering = { id: demoId('capability-engineering'), code: 'ENGG', orgId: orgMeridian.id, name: 'Engineering & Design', description: 'Designing the vessel — models, drawings, and engineering BOMs. Groups the design/engineering data domains.', ownerId: elena.id, dataDomainIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const capProduction = { id: demoId('capability-production'), code: 'PRODN', orgId: orgMeridian.id, name: 'Production & Fabrication', description: 'Building the vessel — work orders, materials, and weld telemetry across the shop floor. Groups the production data domains.', ownerId: grant.id, dataDomainIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const capQuality = { id: demoId('capability-quality'), code: 'QCOMP', orgId: orgMeridian.id, name: 'Quality & Certification', description: 'Proving the vessel — inspection, nonconformance, and ABS/Naval/OSHA certification evidence. Groups the quality/compliance data domains.', ownerId: gabriela.id, dataDomainIds: [] as string[], status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  await createAll(repos.businessCapabilities, [capEngineering, capProduction, capQuality]);

  // ── Data Domains (3) ──
  const domDesign = { id: demoId('domain-design'), code: 'ENG', orgId: orgMeridian.id, name: 'Design & Engineering Data', description: '3D product models, drawings, engineering BOMs, change orders.', ownerId: elena.id, stewardIds: [dmitri.id], dataAssetIds: [] as string[], businessCapabilityId: capEngineering.id, status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domProduction = { id: demoId('domain-production'), code: 'PROD', orgId: orgMeridian.id, name: 'Production Data', description: 'Work orders, material receipts, weld telemetry — the shop-floor operational feeds.', ownerId: grant.id, stewardIds: [noor.id, aaliyah.id], dataAssetIds: [] as string[], businessCapabilityId: capProduction.id, status: 'ACTIVE', createdAt: ts, updatedAt: ts };
  const domQuality = { id: demoId('domain-quality'), code: 'QLT', orgId: orgMeridian.id, name: 'Quality & Compliance Data', description: 'Inspection records, nonconformance reports, certification evidence (ABS / Naval / OSHA).', ownerId: gabriela.id, stewardIds: [warrick.id], dataAssetIds: [] as string[], businessCapabilityId: capQuality.id, status: 'ACTIVE', createdAt: ts, updatedAt: ts };
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
    businessCapabilities: 3,
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
