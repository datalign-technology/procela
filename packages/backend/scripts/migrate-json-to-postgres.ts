/**
 * migrate-json-to-postgres — one-shot importer that copies the JSON-file
 * stores (`.procela-data/*.json`) into Postgres through the same repositories
 * the app uses. Cutover checklist item #3 (see docs/POSTGRES_CUTOVER_PLAN.md).
 *
 * Usage:
 *   DATABASE_URL=postgres://…  tsx scripts/migrate-json-to-postgres.ts
 *   DATABASE_URL=postgres://…  tsx scripts/migrate-json-to-postgres.ts --dry-run
 *
 * The repositories target Postgres whenever DATABASE_URL is set, so this
 * script simply reads each store file and creates each row through the right
 * repo, in foreign-key dependency order. It is IDEMPOTENT: a row whose id
 * already exists in Postgres is skipped, so a re-run tops up rather than
 * duplicating.
 *
 * Ordering: organizations (self-parent) and people first, then the entities
 * that reference them, then leaves. Self-parent entities (organizations,
 * processNodes, governanceGroups) are inserted in two passes — parent link
 * nulled on insert, then set — so a child never references a not-yet-inserted
 * parent.
 *
 * KNOWN LIMITATION: entity repositories persist scalar columns; many-to-many
 * relations expressed as join tables (org memberships, stewards, skills,
 * process-node systems/controls) are written only to the extent the entity's
 * own create() does so. For a data-carrying cutover, verify join-table
 * coverage first — or take the plan's recommended fresh-org cutover path,
 * where there's no JSON data to preserve. `refreshTokens` (ephemeral sessions)
 * and `aiTemplateCache` (regenerable, unmodeled) are intentionally skipped.
 */

import fs from 'fs';
import path from 'path';

import { hasDatabase, disconnectPrisma } from '../src/db/prisma';
import { getOrganizationsRepository } from '../src/db/organizations.repo';
import { getPeopleRepository } from '../src/db/people.repo';
import { getSystemsRepository } from '../src/db/systems.repo';
import { getProcessNodesRepository } from '../src/db/process-nodes.repo';
import { getDataDomainsRepository } from '../src/db/data-domains.repo';
import { getSkillsRepository } from '../src/db/skills.repo';
import { getDamaRolesRepository } from '../src/db/dama-roles.repo';
import { getDataAssetsRepository } from '../src/db/data-assets.repo';
import { getDataAssetBindingsRepository } from '../src/db/data-asset-bindings.repo';
import { getDataAssetColumnsRepository } from '../src/db/data-asset-columns.repo';
import { getGovernanceControlsRepository } from '../src/db/governance-controls.repo';
import { getGovernanceGroupsRepository } from '../src/db/governance-groups.repo';
import { getGovernancePoliciesRepository } from '../src/db/governance-policies.repo';
import { getMappingsRepository } from '../src/db/mappings.repo';
import { getFlowRelationshipsRepository } from '../src/db/flow-relationships.repo';
import { getGovernanceTasksRepository } from '../src/db/governance-tasks.repo';
import { getGovernanceIssuesRepository } from '../src/db/governance-issues.repo';
import { getGovernanceProgramsRepository } from '../src/db/governance-programs.repo';
import { getDecisionRightsRepository } from '../src/db/decision-rights.repo';
import { getCommentsRepository } from '../src/db/comments.repo';
import { getNotificationsRepository } from '../src/db/notifications.repo';
import { getAuditLogsRepository } from '../src/db/audit-logs.repo';
import { getAttachmentsRepository } from '../src/db/attachments.repo';
import { getTagsRepository } from '../src/db/tags.repo';
import { getSavedViewsRepository } from '../src/db/saved-views.repo';
import { getReportsRepository } from '../src/db/reports.repo';
import { getAnalysisReportsRepository } from '../src/db/analysis-reports.repo';
import { getSopsRepository } from '../src/db/sops.repo';
import { getGlossaryTermsRepository } from '../src/db/glossary-terms.repo';
import { getOperationsManualsRepository } from '../src/db/operations-manuals.repo';
import { getCalendarEventsRepository } from '../src/db/calendar-events.repo';
import { getConnectionsRepository } from '../src/db/connections.repo';
import { getConnectionSystemLinksRepository } from '../src/db/connection-system-links.repo';
import { getConnectorsRepository } from '../src/db/connectors.repo';
import { getConnectorEventsRepository } from '../src/db/connector-events.repo';
import { getDataLineageLinksRepository } from '../src/db/data-lineage-links.repo';
import { getAssetLineageEdgesRepository } from '../src/db/asset-lineage-edges.repo';
import { getDataQualityRulesRepository } from '../src/db/data-quality-rules.repo';
import { getDbtCloudConnectionsRepository } from '../src/db/dbt-cloud-connections.repo';
import { getSyncConnectionsRepository } from '../src/db/sync-connections.repo';
import { getMaturitySnapshotsRepository } from '../src/db/maturity-snapshots.repo';
import { getGapSnapshotsRepository } from '../src/db/gap-snapshots.repo';
import { getProcessVersionsRepository } from '../src/db/process-versions.repo';
import { getSuggestionDismissalsRepository } from '../src/db/suggestion-dismissals.repo';
import { getAgentsRepository } from '../src/db/agents.repo';
import { getAgentSchedulesRepository } from '../src/db/agent-schedules.repo';
import { getAgentExecutionsRepository } from '../src/db/agent-executions.repo';
import { getScimGroupsRepository } from '../src/db/scim-groups.repo';
import { getOidcProvidersRepository } from '../src/db/oidc-providers.repo';
// Non-{id} stores.
import { getSettingRepository } from '../src/db/settings.repo';
import { getRaciOverridesRepository } from '../src/db/raci-overrides.repo';
import { getDbtAssetMappingsRepository, getDbtTestMappingsRepository } from '../src/db/dbt-mappings.repo';

const DATA_DIR = path.resolve(process.cwd(), '.procela-data');
const DRY_RUN = process.argv.includes('--dry-run');

interface IdRepo {
  get(id: string): Promise<{ id: string } | null>;
  create(row: unknown): Promise<unknown>;
  update(id: string, patch: unknown): Promise<unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Factory = (store: any[]) => unknown;

/** Standard {id} entities, in FK-dependency order. `selfParent` names a
 *  self-referential FK field that gets the two-pass treatment. */
const ID_ENTITIES: Array<{ store: string; factory: Factory; selfParent?: string }> = [
  // Tier 0
  { store: 'organizations', factory: getOrganizationsRepository, selfParent: 'parentId' },
  { store: 'people', factory: getPeopleRepository },
  // Tier 1
  { store: 'systems', factory: getSystemsRepository },
  { store: 'processNodes', factory: getProcessNodesRepository, selfParent: 'parentId' },
  { store: 'dataDomains', factory: getDataDomainsRepository },
  { store: 'skills', factory: getSkillsRepository },
  { store: 'damaRoles', factory: getDamaRolesRepository },
  // Tier 2
  { store: 'dataAssets', factory: getDataAssetsRepository },
  { store: 'governanceControls', factory: getGovernanceControlsRepository },
  { store: 'governanceGroups', factory: getGovernanceGroupsRepository, selfParent: 'parentId' },
  // Tier 3
  { store: 'governancePolicies', factory: getGovernancePoliciesRepository },
  { store: 'dataAssetBindings', factory: getDataAssetBindingsRepository },
  { store: 'dataAssetColumns', factory: getDataAssetColumnsRepository },
  { store: 'mappings', factory: getMappingsRepository },
  { store: 'flowRelationships', factory: getFlowRelationshipsRepository },
  // Tier 4 — leaves (Org-scoped or no blocking FK)
  { store: 'governanceTasks', factory: getGovernanceTasksRepository },
  { store: 'governanceIssues', factory: getGovernanceIssuesRepository },
  { store: 'governancePrograms', factory: getGovernanceProgramsRepository },
  { store: 'decisionRights', factory: getDecisionRightsRepository },
  { store: 'comments', factory: getCommentsRepository },
  { store: 'notifications', factory: getNotificationsRepository },
  { store: 'auditLogs', factory: getAuditLogsRepository },
  { store: 'attachments', factory: getAttachmentsRepository },
  { store: 'tags', factory: getTagsRepository },
  { store: 'savedViews', factory: getSavedViewsRepository },
  { store: 'reports', factory: getReportsRepository },
  { store: 'analysisReports', factory: getAnalysisReportsRepository },
  { store: 'sops', factory: getSopsRepository },
  { store: 'glossaryTerms', factory: getGlossaryTermsRepository },
  { store: 'operationsManuals', factory: getOperationsManualsRepository },
  { store: 'calendarEvents', factory: getCalendarEventsRepository },
  { store: 'connections', factory: getConnectionsRepository },
  { store: 'connectionSystemLinks', factory: getConnectionSystemLinksRepository },
  { store: 'connectors', factory: getConnectorsRepository },
  { store: 'connectorEvents', factory: getConnectorEventsRepository },
  { store: 'dataLineageLinks', factory: getDataLineageLinksRepository },
  { store: 'assetLineageEdges', factory: getAssetLineageEdgesRepository },
  { store: 'dataQualityRules', factory: getDataQualityRulesRepository },
  { store: 'dbtCloudConnections', factory: getDbtCloudConnectionsRepository },
  { store: 'syncConnections', factory: getSyncConnectionsRepository },
  { store: 'maturitySnapshots', factory: getMaturitySnapshotsRepository },
  { store: 'gapSnapshots', factory: getGapSnapshotsRepository },
  { store: 'processVersions', factory: getProcessVersionsRepository },
  { store: 'suggestionDismissals', factory: getSuggestionDismissalsRepository },
  { store: 'agents', factory: getAgentsRepository },
  { store: 'agentSchedules', factory: getAgentSchedulesRepository },
  { store: 'agentExecutions', factory: getAgentExecutionsRepository },
  { store: 'scim-groups', factory: getScimGroupsRepository },
  { store: 'oidcProviders', factory: getOidcProvidersRepository },
];

interface Result { store: string; total: number; inserted: number; skipped: number }

function readStore(name: string): Record<string, unknown>[] {
  const p = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    console.warn(`  ! ${name}: unreadable JSON, skipping`);
    return [];
  }
}

async function migrateIdEntity(store: string, factory: Factory, selfParent?: string): Promise<Result> {
  const rows = readStore(store);
  if (DRY_RUN || rows.length === 0) return { store, total: rows.length, inserted: 0, skipped: 0 };
  const repo = factory([]) as unknown as IdRepo;
  let inserted = 0;
  let skipped = 0;
  if (selfParent) {
    // Pass 1: insert with the self-parent link nulled.
    for (const row of rows) {
      const id = row.id as string;
      if (await repo.get(id)) { skipped++; continue; }
      await repo.create({ ...row, [selfParent]: null });
      inserted++;
    }
    // Pass 2: set the self-parent link now every row exists.
    for (const row of rows) {
      if (row[selfParent]) await repo.update(row.id as string, { [selfParent]: row[selfParent] });
    }
  } else {
    for (const row of rows) {
      const id = row.id as string;
      if (await repo.get(id)) { skipped++; continue; }
      await repo.create(row);
      inserted++;
    }
  }
  return { store, total: rows.length, inserted, skipped };
}

async function migrateSpecial(): Promise<Result[]> {
  const out: Result[] = [];

  // AppSetting — a key/value store; upsert each row by key.
  {
    const rows = readStore('appSettings');
    if (!DRY_RUN && rows.length) {
      const repo = getSettingRepository([]);
      for (const r of rows) {
        await repo.set(String(r.key), r.value, (r.updatedBy as string | null | undefined) ?? null);
      }
    }
    out.push({ store: 'appSettings', total: rows.length, inserted: DRY_RUN ? 0 : rows.length, skipped: 0 });
  }

  // RaciOverride — composite key (nodeId, personId); upsert each.
  {
    const rows = readStore('raciOverrides');
    if (!DRY_RUN && rows.length) {
      const repo = getRaciOverridesRepository([]);
      for (const r of rows) await repo.upsert(r as never);
    }
    out.push({ store: 'raciOverrides', total: rows.length, inserted: DRY_RUN ? 0 : rows.length, skipped: 0 });
  }

  // dbt mappings — composite key (orgId, dbtUniqueId); upsert each.
  for (const [store, factory] of [
    ['dbtAssetMappings', getDbtAssetMappingsRepository],
    ['dbtTestMappings', getDbtTestMappingsRepository],
  ] as const) {
    const rows = readStore(store);
    if (!DRY_RUN && rows.length) {
      const repo = factory([]);
      for (const r of rows) await repo.upsert(r as never);
    }
    out.push({ store, total: rows.length, inserted: DRY_RUN ? 0 : rows.length, skipped: 0 });
  }

  return out;
}

async function main(): Promise<void> {
  if (!hasDatabase()) {
    console.error('DATABASE_URL is not set. Point it at the target Postgres and re-run.');
    process.exit(1);
  }
  console.log(`Reading stores from ${DATA_DIR}${DRY_RUN ? ' (dry run — no writes)' : ''}\n`);

  const results: Result[] = [];
  for (const { store, factory, selfParent } of ID_ENTITIES) {
    results.push(await migrateIdEntity(store, factory, selfParent));
  }
  results.push(...(await migrateSpecial()));

  console.log('store'.padEnd(26), 'total'.padStart(7), 'inserted'.padStart(10), 'skipped'.padStart(9));
  let totalRows = 0;
  let totalInserted = 0;
  for (const r of results) {
    if (r.total === 0) continue;
    totalRows += r.total;
    totalInserted += r.inserted;
    console.log(r.store.padEnd(26), String(r.total).padStart(7), String(r.inserted).padStart(10), String(r.skipped).padStart(9));
  }
  console.log('\n' + (DRY_RUN
    ? `Dry run: ${totalRows} rows across ${results.filter((r) => r.total > 0).length} stores would be migrated.`
    : `Done: ${totalInserted} rows inserted (${totalRows} read).`));

  await disconnectPrisma();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
