// Live-DB integration test. Exercises the Prisma path of each
// repository against a real Postgres, not a stub — the goal is to
// catch schema drift, mapping bugs, and Prisma-delegate signature
// mismatches that the stubbed-Prisma unit tests can't see.
//
// This test file is a NO-OP when DATABASE_URL is unset — that keeps
// `npm test` fast for anyone running against JSON persistence
// locally. CI's live-DB job sets DATABASE_URL and Postgres has been
// prepared with `prisma db push` before the tests run.
//
// Coverage strategy: for each repo, run a create → read → update →
// delete cycle against real tables. Any schema/mapping mismatch
// fails loudly (Prisma throws on unknown column, missing FK, wrong
// type). The setup wipes the involved tables before each test so
// runs are idempotent.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { randomUUID, createHash } from 'crypto';

import { hasDatabase } from '../db/prisma';
import { prismaOrganizationsRepository } from '../db/organizations.repo';
import { prismaDataDomainsRepository } from '../db/data-domains.repo';
import { prismaDataAssetsRepository } from '../db/data-assets.repo';
import { prismaSystemsRepository } from '../db/systems.repo';
import { prismaPeopleRepository } from '../db/people.repo';
import { prismaProcessNodesRepository } from '../db/process-nodes.repo';
import { prismaMappingsRepository } from '../db/mappings.repo';
import { prismaAuditLogsRepository } from '../db/audit-logs.repo';
import { prismaNotificationsRepository } from '../db/notifications.repo';
import { prismaGovernanceTasksRepository } from '../db/governance-tasks.repo';
import { prismaGovernanceIssuesRepository } from '../db/governance-issues.repo';
import { prismaGovernancePoliciesRepository } from '../db/governance-policies.repo';
import { prismaGovernanceControlsRepository } from '../db/governance-controls.repo';
import { prismaGovernanceGroupsRepository } from '../db/governance-groups.repo';
import { prismaCommentsRepository } from '../db/comments.repo';
import { prismaFlowRelationshipsRepository } from '../db/flow-relationships.repo';
import { prismaSkillsRepository } from '../db/skills.repo';
import { prismaDamaRolesRepository } from '../db/dama-roles.repo';
// Secondary-store repos — batch-3 migration.
import { prismaAttachmentsRepository } from '../db/attachments.repo';
import { prismaTagsRepository } from '../db/tags.repo';
import { prismaSavedViewsRepository } from '../db/saved-views.repo';
import { prismaReportsRepository } from '../db/reports.repo';
import { prismaSopsRepository } from '../db/sops.repo';
import { prismaGlossaryTermsRepository } from '../db/glossary-terms.repo';
import { prismaOperationsManualsRepository } from '../db/operations-manuals.repo';
import { prismaCalendarEventsRepository } from '../db/calendar-events.repo';
import { prismaAnalysisReportsRepository } from '../db/analysis-reports.repo';
import { prismaGovernanceProgramsRepository } from '../db/governance-programs.repo';
import { prismaDecisionRightsRepository } from '../db/decision-rights.repo';
import { prismaSyncConnectionsRepository } from '../db/sync-connections.repo';
import { prismaConnectionsRepository } from '../db/connections.repo';
import { prismaConnectorsRepository } from '../db/connectors.repo';
import { prismaConnectorEventsRepository } from '../db/connector-events.repo';
import { prismaMaturitySnapshotsRepository } from '../db/maturity-snapshots.repo';
import { prismaDataLineageLinksRepository } from '../db/data-lineage-links.repo';
import { prismaDataQualityRulesRepository } from '../db/data-quality-rules.repo';
import { prismaDbtCloudConnectionsRepository } from '../db/dbt-cloud-connections.repo';
import { prismaAssetLineageEdgesRepository } from '../db/asset-lineage-edges.repo';
import { prismaDataAssetBindingsRepository } from '../db/data-asset-bindings.repo';
import { prismaDataAssetColumnsRepository } from '../db/data-asset-columns.repo';
import { prismaAgentsRepository } from '../db/agents.repo';
import { prismaAgentSchedulesRepository } from '../db/agent-schedules.repo';
import { prismaAgentExecutionsRepository } from '../db/agent-executions.repo';
import { prismaConnectionSystemLinksRepository } from '../db/connection-system-links.repo';
import { prismaGapSnapshotsRepository } from '../db/gap-snapshots.repo';
import { prismaProcessVersionsRepository } from '../db/process-versions.repo';

// Converted-service imports — the "business flow" suite below exercises the
// cutover-migrated services end-to-end against Postgres, not just the raw
// repos. This is what proves the whole read path (service → repo → Prisma)
// works once DATABASE_URL is set, which the repo round-trips alone can't.
import { executeReport } from '../services/report-engine';
import { getVisibleOrgScope, refreshOrgScopeCache } from '../lib/org-scope';
import { getSettingRepository } from '../db/settings.repo';

// The governance-program route is exercised end-to-end over HTTP below — it
// reads the program AND computes phase status from sibling stores, all of
// which are empty in Postgres mode unless the handlers go through the repos.
import express from 'express';
import type { AddressInfo } from 'net';
import govProgramRouter from '../routes/governance-program';
import savedViewsRouter from '../routes/saved-views';
import tagsRouter from '../routes/tags';
import syncConnectionsRouter, { tickSyncScheduler } from '../routes/sync-connections';
import connectorSyncRouter from '../routes/connector-sync';
import { runBootstrap } from '../services/bootstrap.service';

// Lazy-require the Prisma client so this file doesn't blow up
// module-load when Prisma hasn't been generated (local dev without
// DATABASE_URL). The test bodies only touch it when running.
type AnyPrismaClient = { $disconnect(): Promise<void>; $executeRawUnsafe(sql: string): Promise<unknown> } & Record<string, unknown>;
let prisma: AnyPrismaClient | null = null;
function loadPrisma(): AnyPrismaClient {
  if (prisma) return prisma;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient() as AnyPrismaClient;
  return prisma;
}

// Truncate every table this test touches. Uses CASCADE so FK
// dependencies unwind in one shot. Runs BEFORE each test so a
// failed test doesn't leave state behind for the next.
async function truncateAll(): Promise<void> {
  const client = loadPrisma();
  const tables = [
    'mappings',
    'process_node_orgs', 'process_node_controls', 'process_node_skills', 'process_node_systems',
    'flow_relationships', 'process_versions', 'process_nodes',
    'data_asset_columns', 'data_asset_bindings', 'data_asset_stewards', 'data_assets',
    'data_domain_stewards', 'data_domains',
    'data_quality_rules', 'data_lineage_links', 'asset_lineage_edges',
    'system_custodians', 'systems',
    'audit_logs',
    'notifications',
    'governance_tasks', 'governance_issues',
    'governance_controls', 'governance_policies',
    'governance_groups', 'governance_programs',
    'comments',
    'dama_roles',
    'person_skills', 'skills',
    'person_orgs', 'people',
    // Secondary stores — batch-3 migration.
    'attachments', 'tags', 'saved_views', 'reports', 'analysis_reports',
    'sops', 'glossary_terms', 'operations_manuals', 'calendar_events',
    'decision_rights',
    'sync_connections', 'connection_system_links', 'connections',
    'connector_events', 'connectors',
    'dbt_cloud_connections',
    'agent_executions', 'agent_schedules', 'agents',
    'maturity_snapshots', 'gap_snapshots',
    'app_settings',
    'scheduler_leases',
    'organizations',
  ];
  for (const table of tables) {
    await client.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
}

// Convenience: seed one org, one person and return their ids so
// downstream inserts have valid FKs.
async function seedFixture(): Promise<{ orgId: string; personId: string }> {
  const client = loadPrisma() as unknown as {
    organization: { create(a: unknown): Promise<{ id: string }> };
    person: { create(a: unknown): Promise<{ id: string }> };
  };
  const org = await client.organization.create({
    data: { id: randomUUID(), name: 'Live-DB org', type: 'COMPANY' },
  });
  const person = await client.person.create({
    data: { id: randomUUID(), name: 'Live-DB person', email: `p-${Date.now()}@x.com` },
  });
  return { orgId: org.id, personId: person.id };
}

const SKIP = !hasDatabase();
const suite = SKIP
  ? (name: string, _fn: () => unknown) => describe.skip(name, () => { /* no-op */ })
  : describe;

suite('live-db repository round-trips', () => {
  before(() => {
    if (SKIP) return;
    // Prisma client is created lazily inside loadPrisma().
  });
  after(async () => {
    if (SKIP) return;
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    if (SKIP) return;
    await truncateAll();
  });

  it('Organization: create → get → update → delete', async () => {
    const repo = prismaOrganizationsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaOrganizationsRepository>[0] extends () => infer C ? C : never);
    const id = randomUUID();
    const now = new Date().toISOString();
    await repo.create({
      id, parentId: null, name: 'Tidewater Utilities', type: 'company',
      industry: 'utilities', description: '', headCount: 0,
      createdAt: now, updatedAt: now,
    });
    const fetched = await repo.get(id);
    assert.strictEqual(fetched?.name, 'Tidewater Utilities');
    const updated = await repo.update(id, { industry: 'water utilities' });
    assert.strictEqual(updated?.industry, 'water utilities');
    assert.strictEqual(await repo.delete(id), true);
    assert.strictEqual(await repo.get(id), null);
  });

  it('DataDomain: create with stewardIds M2M → get resolves stewards', async () => {
    const { orgId, personId } = await seedFixture();
    const stewardIds = [personId];
    const repo = prismaDataDomainsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDataDomainsRepository>[0] extends () => infer C ? C : never);
    const id = randomUUID();
    const now = new Date().toISOString();
    await repo.create({
      id, orgId, name: 'Customer Data', description: '', ownerId: null,
      stewardIds, dataAssetIds: [], status: 'DRAFT',
      createdAt: now, updatedAt: now,
    });
    const fetched = await repo.get(id);
    assert.deepStrictEqual(fetched?.stewardIds, stewardIds);
  });

  it('DataAsset: sensitivityTags String[] + retentionDuration JSONB round-trip', async () => {
    const { orgId } = await seedFixture();
    const repo = prismaDataAssetsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDataAssetsRepository>[0] extends () => infer C ? C : never);
    const id = randomUUID();
    const now = new Date().toISOString();
    await repo.create({
      id, orgId, name: 'Meter Reads', description: '', systemId: '',
      owner: '', ownerPersonId: null,
      stewardIds: [],
      sensitivityTags: ['PII', 'PCI'],
      retentionDuration: { value: 7, unit: 'YEARS' },
      governanceTier: 'SILVER', healthScore: 0,
      createdAt: now, updatedAt: now,
    });
    const fetched = await repo.get(id);
    assert.deepStrictEqual(fetched?.sensitivityTags, ['PII', 'PCI']);
    assert.deepStrictEqual(fetched?.retentionDuration, { value: 7, unit: 'YEARS' });
  });

  it('System: JSONB integrations + custodianIds M2M round-trip', async () => {
    const { orgId, personId } = await seedFixture();
    const repo = prismaSystemsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaSystemsRepository>[0] extends () => infer C ? C : never);
    const id = randomUUID();
    const now = new Date().toISOString();
    await repo.create({
      id, orgId, name: 'Salesforce', description: '', systemType: 'CRM',
      integrations: [
        { id: 'int-1', targetSystemId: id, interfaceType: 'REST_API', direction: 'OUTBOUND' },
      ],
      custodianIds: [personId],
      createdAt: now, updatedAt: now,
    });
    const fetched = await repo.get(id);
    assert.strictEqual(fetched?.integrations?.[0].interfaceType, 'REST_API');
    assert.deepStrictEqual(fetched?.custodianIds, [personId]);
  });

  it('Person: orgIds + skillIds double-M2M round-trip', async () => {
    const { orgId } = await seedFixture();
    // Seed a skill for the M2M. `category` is required on the Skill
    // model — the JSON store carries it too, we just weren't reading
    // through the repo here.
    const skillClient = loadPrisma() as unknown as { skill: { create(a: unknown): Promise<{ id: string }> } };
    const skill = await skillClient.skill.create({
      data: { id: randomUUID(), orgId, name: 'Anomaly Detection', category: 'ANALYTICS' },
    });
    const repo = prismaPeopleRepository(() => loadPrisma() as unknown as Parameters<typeof prismaPeopleRepository>[0] extends () => infer C ? C : never);
    const id = randomUUID();
    const now = new Date().toISOString();
    await repo.create({
      id, orgIds: [orgId], accessibleOrgIds: [],
      name: 'Melissa Patel', email: `melissa-${Date.now()}@x.com`,
      role: 'PROCESS_OWNER', title: 'System Operator Lead',
      skillIds: [skill.id],
      createdAt: now, updatedAt: now,
    });
    const fetched = await repo.get(id);
    assert.deepStrictEqual(fetched?.orgIds, [orgId]);
    assert.deepStrictEqual(fetched?.skillIds, [skill.id]);
  });

  it('ProcessNode: rich docs + all four M2Ms round-trip', async () => {
    const { orgId } = await seedFixture();
    const client = loadPrisma() as unknown as {
      system: { create(a: unknown): Promise<{ id: string }> };
      skill: { create(a: unknown): Promise<{ id: string }> };
      governancePolicy: { create(a: unknown): Promise<{ id: string }> };
      governanceControl: { create(a: unknown): Promise<{ id: string }> };
    };
    const sys = await client.system.create({ data: { id: randomUUID(), orgId, name: 'SCADA' } });
    const skill = await client.skill.create({ data: { id: randomUUID(), orgId, name: 'Incident Response', category: 'DATA_QUALITY' } });
    const pol = await client.governancePolicy.create({ data: { id: randomUUID(), orgId, code: 'POL-1', name: 'Outage Policy', description: '', documentType: 'POLICY', content: '' } });
    const ctrl = await client.governanceControl.create({ data: { id: randomUUID(), orgId, name: 'CIP-007 R2.1', policyId: pol.id, code: 'CTL-1', description: '' } });
    const repo = prismaProcessNodesRepository(() => loadPrisma() as unknown as Parameters<typeof prismaProcessNodesRepository>[0] extends () => infer C ? C : never);
    const id = randomUUID();
    const now = new Date().toISOString();
    await repo.create({
      id, parentId: null, level: 'ACTIVITY', name: 'Outage triage', description: '',
      activityId: null, status: 'DRAFT', orderIndex: 0,
      orgId, orgIds: [orgId], ownerId: null, version: 1,
      purpose: 'Restore service', complianceTags: ['NERC-CIP-007'],
      criticalityTier: 'TIER_1', rtoHours: 4,
      controlIds: [ctrl.id], requiredSkillIds: [skill.id], systemIds: [sys.id],
      domain: 'OPERATIONAL',
      createdAt: now, updatedAt: now,
    });
    const fetched = await repo.get(id);
    assert.strictEqual(fetched?.purpose, 'Restore service');
    assert.strictEqual(fetched?.criticalityTier, 'TIER_1');
    assert.deepStrictEqual(fetched?.complianceTags, ['NERC-CIP-007']);
    assert.deepStrictEqual(fetched?.orgIds, [orgId]);
    assert.deepStrictEqual(fetched?.controlIds, [ctrl.id]);
    assert.deepStrictEqual(fetched?.requiredSkillIds, [skill.id]);
    assert.deepStrictEqual(fetched?.systemIds, [sys.id]);
  });

  it('AuditLog: hash-chain fields preserved byte-for-byte + sentinel orgId accepted', async () => {
    const repo = prismaAuditLogsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaAuditLogsRepository>[0] extends () => infer C ? C : never);
    const id = randomUUID();
    const prevHash = 'a'.repeat(64);
    const entryHash = 'b'.repeat(64);
    await repo.create({
      id, orgId: 'system', userId: null,
      entityType: 'Audit', entityId: 'chain',
      action: 'AUDIT_CHAIN_BOOTSTRAPPED',
      before: null, after: { note: 'bootstrap' },
      timestamp: new Date().toISOString(),
      prevHash, entryHash,
    });
    const fetched = await repo.get(id);
    assert.strictEqual(fetched?.orgId, 'system');
    assert.strictEqual(fetched?.entityId, 'chain');
    assert.strictEqual(fetched?.prevHash, prevHash);
    assert.strictEqual(fetched?.entryHash, entryHash);
  });

  it('Notification / GovernanceTask / GovernanceIssue: scalar CRUD cycle', async () => {
    const { orgId, personId } = await seedFixture();
    const notif = prismaNotificationsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaNotificationsRepository>[0] extends () => infer C ? C : never);
    const task = prismaGovernanceTasksRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGovernanceTasksRepository>[0] extends () => infer C ? C : never);
    const issue = prismaGovernanceIssuesRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGovernanceIssuesRepository>[0] extends () => infer C ? C : never);
    const now = new Date().toISOString();
    await notif.create({
      id: randomUUID(), orgId, userId: personId,
      type: 'INFO', title: 'Ping', message: 'body', link: '/x',
      read: false, createdAt: now,
    });
    await task.create({
      id: randomUUID(), orgId, title: 'Audit prep', description: '',
      taskType: 'REVIEW', priority: 'HIGH', status: 'OPEN',
      assigneeId: personId, dueDate: null,
      linkedObjectType: null, linkedObjectId: null,
      automationMode: 'HUMAN', createdBy: null,
      createdAt: now, updatedAt: now, completedAt: null,
    });
    await issue.create({
      id: randomUUID(), orgId, title: 'Broken rule',
      description: '', issueType: 'DATA_QUALITY',
      severity: 'HIGH', status: 'OPEN',
      domainId: null, dataAssetId: null, systemId: null,
      reportedBy: null, assignedTo: personId, resolutionSummary: null,
      createdAt: now, updatedAt: now, closedAt: null,
    });
    const notifs = await notif.list({ orgId });
    const tasks = await task.list({ orgId });
    const issues = await issue.list({ orgId });
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(issues.length, 1);
  });

  it('GovernancePolicy / GovernanceControl: policyId is a soft reference (no FK cascade)', async () => {
    const { orgId } = await seedFixture();
    const pol = prismaGovernancePoliciesRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGovernancePoliciesRepository>[0] extends () => infer C ? C : never);
    const ctrl = prismaGovernanceControlsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGovernanceControlsRepository>[0] extends () => infer C ? C : never);
    const polId = randomUUID();
    const now = new Date().toISOString();
    await pol.create({
      id: polId, orgId, code: 'POL-99', name: 'Test Policy',
      description: '', documentType: 'POLICY', content: 'body',
      status: 'DRAFT', ownerAssignmentId: null,
      category: 'GOVERNANCE', reviewFrequency: 'ANNUAL',
      nextReviewDate: null,
      effectiveDate: null,
      createdAt: now, updatedAt: now,
    });
    await ctrl.create({
      id: randomUUID(), orgId, policyId: polId,
      code: 'CTL-1', name: 'Test Control', description: '',
      controlType: 'PREVENTIVE', automationMode: 'HUMAN',
      status: 'DRAFT', ownerAssignmentId: null,
      evidenceRequired: false,
      createdAt: now, updatedAt: now,
    });
    assert.strictEqual((await ctrl.list({ orgId })).length, 1);
    assert.strictEqual(await pol.delete(polId), true);
    // policyId is intentionally a soft reference (String, no @relation)
    // on the schema. When a policy is deleted, the route-level cascade
    // sets every dependent control's policyId to '' rather than
    // dropping the control. Deleting the policy from the DB
    // directly (as the repo does) leaves the control alone — that's
    // what this test proves. The application-side sweep is out of
    // scope for the repo layer.
    assert.strictEqual((await ctrl.list({ orgId })).length, 1);
  });

  it('Comment / FlowRelationship / Skill / DamaRole / Mapping / GovernanceGroup: create + list', async () => {
    const { orgId, personId } = await seedFixture();
    const now = new Date().toISOString();
    // Seed prereqs for the ones with FKs.
    const client = loadPrisma() as unknown as {
      processNode: { create(a: unknown): Promise<{ id: string }> };
      dataAsset: { create(a: unknown): Promise<{ id: string }> };
    };
    const node = await client.processNode.create({
      data: { id: randomUUID(), name: 'X', level: 'ACTIVITY', orgId, domain: 'OPERATIONAL' },
    });
    const node2 = await client.processNode.create({
      data: { id: randomUUID(), name: 'Y', level: 'ACTIVITY', orgId, domain: 'OPERATIONAL' },
    });
    const asset = await client.dataAsset.create({
      data: { id: randomUUID(), orgId, name: 'Asset' },
    });

    const comment = prismaCommentsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaCommentsRepository>[0] extends () => infer C ? C : never);
    const flow = prismaFlowRelationshipsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaFlowRelationshipsRepository>[0] extends () => infer C ? C : never);
    const skill = prismaSkillsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaSkillsRepository>[0] extends () => infer C ? C : never);
    const dama = prismaDamaRolesRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDamaRolesRepository>[0] extends () => infer C ? C : never);
    const mapping = prismaMappingsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaMappingsRepository>[0] extends () => infer C ? C : never);
    const group = prismaGovernanceGroupsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGovernanceGroupsRepository>[0] extends () => infer C ? C : never);

    await comment.create({
      id: randomUUID(), orgId, entityType: 'Person', entityId: personId,
      parentId: null,
      userId: personId, userName: 'Bob', content: 'hi',
      mentions: [], updatedAt: now, deletedAt: null,
      createdAt: now,
    });
    await flow.create({
      id: randomUUID(), fromNodeId: node.id, toNodeId: node2.id,
      type: 'SEQUENCE', label: null,
      createdAt: now,
    });
    await skill.create({
      id: randomUUID(), orgId, name: 'DQ Analysis',
      description: '', category: 'DATA_QUALITY',
      createdAt: now, updatedAt: now,
    });
    await dama.create({
      id: randomUUID(), personId, agentId: null, agentName: null,
      roleType: 'DATA_STEWARD',
      scopeType: 'ORG', scopeId: orgId, since: now,
      createdAt: now,
    });
    await mapping.create({
      id: randomUUID(), orgId,
      processStepId: node.id, dataAssetId: asset.id,
      linkType: 'consumes', notes: '',
      aiSuggested: false, userOverridden: false,
      createdBy: personId, createdAt: now, updatedAt: now,
    });
    await group.create({
      id: randomUUID(), orgId, name: 'Data Governance Committee',
      type: 'COMMITTEE', parentId: null,
      description: '', charter: '', status: 'ACTIVE', members: [],
      createdAt: now, updatedAt: now,
    });

    assert.strictEqual((await comment.list({ orgId })).length, 1);
    assert.strictEqual((await flow.list()).length, 1);
    assert.strictEqual((await skill.list({ orgId })).length, 1);
    assert.strictEqual((await dama.list()).length, 1);
    assert.strictEqual((await mapping.list({ orgId })).length, 1);
    assert.strictEqual((await group.list({ orgId })).length, 1);
  });

  // ── Secondary stores (batch-3 migration) ──────────────────────────────
  // Compact create+list cycles per entity. Catches schema drift, JSON
  // column round-trips, and native String[] column shapes. Grouped by
  // FK-independence so a single seedFixture() covers the majority.

  it('Attachment / Tag / SavedView / Report / AnalysisReport: create + list', async () => {
    const { orgId, personId } = await seedFixture();
    const now = new Date().toISOString();
    const attachment = prismaAttachmentsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaAttachmentsRepository>[0] extends () => infer C ? C : never);
    const tag = prismaTagsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaTagsRepository>[0] extends () => infer C ? C : never);
    const view = prismaSavedViewsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaSavedViewsRepository>[0] extends () => infer C ? C : never);
    const report = prismaReportsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaReportsRepository>[0] extends () => infer C ? C : never);
    const analysis = prismaAnalysisReportsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaAnalysisReportsRepository>[0] extends () => infer C ? C : never);

    await attachment.create({
      id: randomUUID(), orgId, entityType: 'ProcessNode', entityId: randomUUID(),
      type: 'URL', name: 'ref', description: '', url: 'https://x',
      uploadedBy: personId, createdAt: now, updatedAt: now,
    });
    const tagId = randomUUID();
    await tag.create({ id: tagId, orgId, entityType: 'DataAsset', entityId: randomUUID(), tag: 'PII', createdBy: personId, createdAt: now });
    // createdBy (layer-2 anchor) round-trips through the live column.
    assert.strictEqual((await tag.list({ orgId })).find((t) => t.id === tagId)?.createdBy, personId);
    await view.create({
      id: randomUUID(), orgId, pageKey: 'data-assets', name: 'v1',
      ownerId: personId, ownerName: 'Bob',
      filters: { status: 'ACTIVE' }, createdAt: now, updatedAt: now,
    });
    await report.create({
      id: randomUUID(), orgId, name: 'r1', description: '',
      ownerId: personId, visibility: 'org',
      definition: { entity: 'ProcessNode', columns: [], filters: [] } as unknown as import('../services/report-engine').ReportDefinition,
      createdAt: now, updatedAt: now,
    });
    await analysis.create({
      id: randomUUID(), orgId, name: 'a1', description: null,
      ownerId: personId,
      config: { rowDim: 'status' }, createdAt: now, updatedAt: now,
    });

    assert.strictEqual((await attachment.list({ orgId })).length, 1);
    assert.strictEqual((await tag.list({ orgId })).length, 1);
    assert.strictEqual((await view.list({ orgId })).length, 1);
    assert.strictEqual((await report.list({ orgId })).length, 1);
    assert.strictEqual((await analysis.list({ orgId })).length, 1);
  });

  it('Sop / GlossaryTerm / OperationsManual / CalendarEvent: String[] + JSON round-trip', async () => {
    const { orgId, personId } = await seedFixture();
    const now = new Date().toISOString();
    const sop = prismaSopsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaSopsRepository>[0] extends () => infer C ? C : never);
    const glossary = prismaGlossaryTermsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGlossaryTermsRepository>[0] extends () => infer C ? C : never);
    const opm = prismaOperationsManualsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaOperationsManualsRepository>[0] extends () => infer C ? C : never);
    const cal = prismaCalendarEventsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaCalendarEventsRepository>[0] extends () => infer C ? C : never);

    const sopId = randomUUID();
    await sop.create({
      id: sopId, orgId, code: 'SOP-1', title: 'Access request',
      purpose: 'grant access', category: 'ACCESS',
      applicableRoles: ['CDO', 'DATA_STEWARD'],
      triggerEvent: 'ticket', steps: [{ order: 1, title: 'Verify', description: '', estimatedMinutes: 5 }],
      status: 'ACTIVE', version: 1,
      ownerPersonId: personId,
      createdAt: now, updatedAt: now,
    });
    const gotSop = await sop.get(sopId);
    assert.deepStrictEqual(gotSop?.applicableRoles, ['CDO', 'DATA_STEWARD']);
    assert.strictEqual(gotSop?.steps[0]?.title, 'Verify');

    await glossary.create({
      id: randomUUID(), orgId, term: 'Meter Read', definition: 'A reading',
      context: '', synonyms: ['reading'],
      domainId: null, ownerPersonId: personId,
      status: 'APPROVED', category: 'BUSINESS',
      exampleValues: '', businessRules: '', sourceOfTruth: '',
      createdAt: now, updatedAt: now,
    });
    const opmId = randomUUID();
    await opm.create({
      id: opmId, orgId, roleType: 'CDO', label: 'CDO',
      purpose: 'strategy',
      daily: ['review alerts'], weekly: ['check reports'], monthly: [], quarterly: [], escalation: [],
      customContent: '', isCustom: false, ownerPersonId: personId,
      createdAt: now, updatedAt: now,
    });
    // ownerPersonId (layer-2 anchor) round-trips through the live column.
    assert.strictEqual((await opm.get(opmId))?.ownerPersonId, personId);
    await cal.create({
      id: randomUUID(), orgId, name: 'DG Council',
      description: 'monthly council', eventType: 'COUNCIL_MEETING',
      cadence: 'MONTHLY', dayOfMonth: 15, dayOfWeek: null,
      timeOfDay: '10:00', durationMinutes: 60,
      attendees: [personId], agendaTemplate: '',
      nextOccurrence: null, lastOccurrence: null,
      autoCreateTasks: false, status: 'ACTIVE',
      createdAt: now, updatedAt: now,
    });
    assert.strictEqual((await glossary.list({ orgId })).length, 1);
    assert.strictEqual((await opm.list({ orgId })).length, 1);
    assert.strictEqual((await cal.list({ orgId })).length, 1);
  });

  it('GovernanceProgram / DecisionRight: scope+principles JSON + recommends String[]', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();
    const program = prismaGovernanceProgramsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGovernanceProgramsRepository>[0] extends () => infer C ? C : never);
    const dr = prismaDecisionRightsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDecisionRightsRepository>[0] extends () => infer C ? C : never);
    await program.create({
      id: randomUUID(), orgId, name: 'Enterprise DG',
      scope: { inScope: 'utilities', outOfScope: '', boundaries: '', constraints: '' },
      principles: { vision: 'v', principles: ['p1'], decisionRights: '', operatingModel: 'HYBRID' },
      targetStartDate: null, targetLaunchDate: null, status: 'PLANNING',
      createdAt: now, updatedAt: now,
    });
    await dr.create({
      id: randomUUID(), orgId, decision: 'Retire dataset',
      category: 'POLICY', description: 'retire critical',
      decider: 'CDO', deciderType: 'ROLE',
      recommends: ['DATA_STEWARD'], approves: ['CDO'], informed: ['CIO'],
      escalationPath: 'CDO → CIO',
      createdAt: now, updatedAt: now,
    });
    const progs = await program.list({ orgId });
    assert.strictEqual(progs[0].principles.operatingModel, 'HYBRID');
    const drs = await dr.list({ orgId });
    assert.deepStrictEqual(drs[0].recommends, ['DATA_STEWARD']);
  });

  it('Connection / ConnectionSystemLink / Connector / ConnectorEvent / SyncConnection: JSON + String[]', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();
    const connection = prismaConnectionsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaConnectionsRepository>[0] extends () => infer C ? C : never);
    const csLink = prismaConnectionSystemLinksRepository(() => loadPrisma() as unknown as Parameters<typeof prismaConnectionSystemLinksRepository>[0] extends () => infer C ? C : never);
    const connector = prismaConnectorsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaConnectorsRepository>[0] extends () => infer C ? C : never);
    const connectorEvent = prismaConnectorEventsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaConnectorEventsRepository>[0] extends () => infer C ? C : never);
    const sync = prismaSyncConnectionsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaSyncConnectionsRepository>[0] extends () => infer C ? C : never);

    const connId = randomUUID();
    await connection.create({
      id: connId, orgId, name: 'Primary Postgres', connectionType: 'DATABASE',
      config: { dbType: 'POSTGRESQL', host: 'localhost', port: 5432, database: 'app' },
      credentials: { username: 'u', password: 'p' },
      status: 'CONNECTED', lastTestedAt: null, lastTestResult: null,
      createdAt: now, updatedAt: now,
    });
    await csLink.create({
      id: randomUUID(), orgId, connectionId: connId, systemId: randomUUID(),
      createdAt: now,
    });
    const cnctorId = randomUUID();
    await connector.create({
      id: cnctorId, orgId, name: 'On-prem agent',
      tokenHash: null, pairingCode: null, pairingCodeExpiresAt: null,
      systemIds: [randomUUID()], lastHeartbeatAt: null, agentVersion: null,
      status: 'PAIRED', createdAt: now, updatedAt: now,
    });
    await connectorEvent.create({
      id: randomUUID(), connectorId: cnctorId, orgId,
      type: 'HEARTBEAT', ts: now, data: { latency: 42 },
    });
    await sync.create({
      id: randomUUID(), orgId, name: 'HR sync', targetEntity: 'people',
      sourceType: 'DATABASE', connectionId: connId,
      config: { table: 'employees' }, fieldMapping: { name: 'full_name' },
      matchKey: 'email',
      schedule: { enabled: true, intervalMinutes: 60, lastRunAt: null, nextRunAt: null },
      status: 'ACTIVE', lastSyncResult: null,
      createdAt: now, updatedAt: now,
    });
    assert.strictEqual((await connection.list({ orgId })).length, 1);
    assert.strictEqual((await csLink.list({ orgId })).length, 1);
    assert.deepStrictEqual((await connector.list({ orgId }))[0].systemIds.length, 1);
    assert.strictEqual((await connectorEvent.list({ orgId })).length, 1);
    assert.strictEqual((await sync.list({ orgId })).length, 1);
  });

  it('DataQualityRule / DbtCloudConnection / AssetLineageEdge / DataLineageLink: mixed JSON + scalar', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();
    const client = loadPrisma() as unknown as {
      dataAsset: { create(a: unknown): Promise<{ id: string }> };
      system: { create(a: unknown): Promise<{ id: string }> };
    };
    const asset1 = await client.dataAsset.create({ data: { id: randomUUID(), orgId, name: 'A1' } });
    const asset2 = await client.dataAsset.create({ data: { id: randomUUID(), orgId, name: 'A2' } });
    const sys1 = await client.system.create({ data: { id: randomUUID(), orgId, name: 'S1' } });
    const sys2 = await client.system.create({ data: { id: randomUUID(), orgId, name: 'S2' } });

    const dqRule = prismaDataQualityRulesRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDataQualityRulesRepository>[0] extends () => infer C ? C : never);
    const dbtCloud = prismaDbtCloudConnectionsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDbtCloudConnectionsRepository>[0] extends () => infer C ? C : never);
    const assetEdge = prismaAssetLineageEdgesRepository(() => loadPrisma() as unknown as Parameters<typeof prismaAssetLineageEdgesRepository>[0] extends () => infer C ? C : never);
    const lineage = prismaDataLineageLinksRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDataLineageLinksRepository>[0] extends () => infer C ? C : never);

    await dqRule.create({
      id: randomUUID(), orgId, dataAssetId: asset1.id,
      dimension: 'COMPLETENESS', name: 'not null email', description: '',
      threshold: 100, currentScore: 95, weight: 1,
      status: 'PASSING', lastMeasured: now,
      ruleType: 'NOT_NULL', parameters: {},
      createdAt: now, updatedAt: now,
    });
    await dbtCloud.create({
      id: randomUUID(), orgId, name: 'prod dbt',
      host: 'cloud.getdbt.com', accountId: 'acc-1', jobId: 'job-1',
      token: 'tok', lastRunAt: null, lastStatus: 'NEVER',
      lastError: null, lastSummary: null,
      pollFrequency: 'NEVER', nextPollAt: null,
      createdAt: now, updatedAt: now,
    });
    await assetEdge.create({
      id: randomUUID(), orgId,
      sourceAssetId: asset1.id, targetAssetId: asset2.id,
      source: 'dbt', sourceRef: 'model.x->model.y',
      lastSeenAt: now, createdAt: now,
    });
    await lineage.create({
      id: randomUUID(), orgId,
      sourceSystemId: sys1.id, targetSystemId: sys2.id,
      dataAssetId: null, description: '',
      flowType: 'ETL', frequency: 'DAILY', status: 'ACTIVE',
      createdAt: now, updatedAt: now,
    });
    assert.strictEqual((await dqRule.list({ orgId })).length, 1);
    assert.strictEqual((await dbtCloud.list({ orgId })).length, 1);
    assert.strictEqual((await assetEdge.list({ orgId })).length, 1);
    assert.strictEqual((await lineage.list({ orgId })).length, 1);
  });

  it('DataAssetBinding / DataAssetColumn: bindings label + isPrimary; column no orgId', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();
    const client = loadPrisma() as unknown as {
      dataAsset: { create(a: unknown): Promise<{ id: string }> };
    };
    const asset = await client.dataAsset.create({ data: { id: randomUUID(), orgId, name: 'A' } });
    const binding = prismaDataAssetBindingsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDataAssetBindingsRepository>[0] extends () => infer C ? C : never);
    const column = prismaDataAssetColumnsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaDataAssetColumnsRepository>[0] extends () => infer C ? C : never);
    await binding.create({
      id: randomUUID(), orgId, dataAssetId: asset.id,
      connectionId: randomUUID(),
      sourceAsset: 'public.customers', sourceColumn: undefined,
      label: 'prod', isPrimary: true,
      createdAt: now, updatedAt: now,
    });
    await column.create({
      id: randomUUID(), dataAssetId: asset.id,
      columnName: 'email', dataType: 'String',
      createdAt: now, updatedAt: now,
    });
    const bs = await binding.list({ orgId });
    assert.strictEqual(bs[0].isPrimary, true);
    assert.strictEqual(bs[0].label, 'prod');
    const cs = await column.list();
    assert.strictEqual(cs.length, 1);
  });

  it('Agent / AgentSchedule / AgentExecution: orgIds native String[] + activity FKs', async () => {
    const { orgId, personId } = await seedFixture();
    const now = new Date().toISOString();
    const client = loadPrisma() as unknown as {
      processNode: { create(a: unknown): Promise<{ id: string }> };
    };
    const activity = await client.processNode.create({
      data: { id: randomUUID(), name: 'Data Governance Activity', level: 'ACTIVITY', orgId, domain: 'GOVERNANCE' },
    });
    const agent = prismaAgentsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaAgentsRepository>[0] extends () => infer C ? C : never);
    const sched = prismaAgentSchedulesRepository(() => loadPrisma() as unknown as Parameters<typeof prismaAgentSchedulesRepository>[0] extends () => infer C ? C : never);
    const exec = prismaAgentExecutionsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaAgentExecutionsRepository>[0] extends () => infer C ? C : never);

    const agentId = randomUUID();
    await agent.create({
      id: agentId, orgIds: [orgId], name: 'Claude Steward',
      agentType: 'AI', description: '', provider: 'Anthropic',
      status: 'ACTIVE', ownerPersonId: personId,
      skillIds: [], instructions: 'do the thing',
      createdAt: now, updatedAt: now,
    });
    await sched.create({
      id: randomUUID(), orgId, agentId, agentName: 'Claude Steward',
      activityId: activity.id, activityName: 'Data Governance Activity',
      roleType: 'DATA_STEWARD', frequency: 'DAILY', status: 'ACTIVE',
      startAt: now, nextRunAt: now, lastRunAt: null, runCount: 0,
      createdBy: personId, createdAt: now, updatedAt: now,
    });
    await exec.create({
      id: randomUUID(), orgId, agentId, agentName: 'Claude Steward',
      activityId: activity.id, activityName: 'Data Governance Activity',
      roleType: 'DATA_STEWARD', status: 'SUCCESS',
      startedAt: now, completedAt: now, output: 'draft output',
      error: null, durationMs: 1234,
      reviewStatus: 'PENDING', reviewedBy: null, reviewedAt: null,
      promotedDocumentId: null, createdAt: now,
    });
    const agentsInOrg = await agent.list({ orgId });
    assert.strictEqual(agentsInOrg.length, 1);
    assert.deepStrictEqual(agentsInOrg[0].orgIds, [orgId]);
    assert.strictEqual((await sched.list({ orgId })).length, 1);
    assert.strictEqual((await exec.list({ orgId })).length, 1);
  });

  it('MaturitySnapshot / GapSnapshot / ProcessVersion: no updatedAt entities', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();
    const client = loadPrisma() as unknown as {
      processNode: { create(a: unknown): Promise<{ id: string }> };
    };
    const node = await client.processNode.create({
      data: { id: randomUUID(), name: 'N', level: 'ACTIVITY', orgId, domain: 'OPERATIONAL' },
    });
    const maturity = prismaMaturitySnapshotsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaMaturitySnapshotsRepository>[0] extends () => infer C ? C : never);
    const gap = prismaGapSnapshotsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaGapSnapshotsRepository>[0] extends () => infer C ? C : never);
    const pv = prismaProcessVersionsRepository(() => loadPrisma() as unknown as Parameters<typeof prismaProcessVersionsRepository>[0] extends () => infer C ? C : never);

    await maturity.create({
      id: randomUUID(), orgId, timestamp: now, overall: 72,
      dimensions: [{ name: 'Governance', score: 80 }, { name: 'Quality', score: 64 }],
    });
    await gap.create({
      id: randomUUID(), orgId, takenAt: now,
      metrics: { activities: 10, mappedActivities: 6, coveragePct: 60, orphanAssets: 2, ungovernedAssets: 3, ownerlessItems: 4 },
    });
    await pv.create({
      id: randomUUID(), nodeId: node.id, version: 2,
      snapshot: {
        id: node.id, parentId: null, level: 'ACTIVITY', name: 'N',
        description: '', activityId: null, status: 'DRAFT', orderIndex: 0,
        orgId, orgIds: [orgId], ownerId: null, version: 2,
        createdAt: now, updatedAt: now,
      },
      changedBy: null, changedAt: now, status: 'DRAFT', note: '',
    });
    assert.strictEqual((await maturity.list({ orgId })).length, 1);
    const gaps = await gap.list({ orgId });
    assert.strictEqual(gaps[0].metrics.coveragePct, 60);
    assert.strictEqual((await pv.list()).length, 1);
  });
});

// ── Business-flow suite ──────────────────────────────────────────────────
//
// The round-trip suite above proves each repository maps to Postgres
// correctly in isolation. This suite goes one layer up: it drives the
// cutover-converted *services* against the same live Postgres, seeding via
// the Prisma repos and asserting the service reads what the DB holds. These
// are the paths that broke most subtly during the cutover — a service that
// still closed over a stale boot-time array would pass the repo tests but
// return empty here. Same SKIP/truncate harness as above.
const prismaRepo = <F extends (loader: () => never) => unknown>(factory: F): ReturnType<F> =>
  factory(() => loadPrisma() as never) as ReturnType<F>;

suite('live-db business flows', () => {
  after(async () => {
    if (SKIP) return;
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    if (SKIP) return;
    await truncateAll();
  });

  it('report-engine: executeReport resolves a Postgres join (processNodes → responsiblePerson)', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();

    // Seed a person, then an activity whose responsiblePersonId points at
    // them — the join the report projects. Both live in Postgres; the
    // service reads them back through getProcessNodesRepository/
    // getPeopleRepository, which route to Prisma because DATABASE_URL is set.
    const people = prismaRepo(prismaPeopleRepository);
    const personId = randomUUID();
    await people.create({
      id: personId, orgIds: [orgId], accessibleOrgIds: [],
      name: 'Dana Reyes', email: `dana-${Date.now()}@x.com`,
      role: 'PROCESS_OWNER', title: 'Grid Ops Lead', skillIds: [],
      createdAt: now, updatedAt: now,
    });
    const nodes = prismaRepo(prismaProcessNodesRepository);
    const nodeId = randomUUID();
    await nodes.create({
      id: nodeId, parentId: null, level: 'ACTIVITY', name: 'Dispatch crews',
      description: '', activityId: null, status: 'DRAFT', orderIndex: 0,
      orgId, orgIds: [orgId], ownerId: null, version: 1,
      responsiblePersonId: personId,
      purpose: '', complianceTags: [], criticalityTier: 'TIER_1', rtoHours: 4,
      controlIds: [], requiredSkillIds: [], systemIds: [], domain: 'OPERATIONAL',
      createdAt: now, updatedAt: now,
    });

    const result = await executeReport(
      {
        entity: 'processNodes',
        columns: [
          { field: 'name' },
          { field: 'responsiblePerson.name', label: 'Owner' },
        ],
        filters: [],
      },
      orgId,
    );

    assert.strictEqual(result.totalMatched, 1);
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].name, 'Dispatch crews');
    // The join resolved against the Postgres people table, not a stale array.
    assert.strictEqual(result.rows[0]['responsiblePerson.name'], 'Dana Reyes');
  });

  it('org-scope: getVisibleOrgScope cascades over a Postgres-hydrated cache', async () => {
    // Seed a company → division tree in Postgres via the repo, then hydrate
    // the org-scope cache from it. getVisibleOrgScope must walk the tree it
    // read from Postgres (parent sees child; child sees parent).
    const orgs = prismaRepo(prismaOrganizationsRepository);
    const now = new Date().toISOString();
    const companyId = randomUUID();
    const divisionId = randomUUID();
    await orgs.create({
      id: companyId, parentId: null, name: 'Tidewater Utilities', type: 'company',
      industry: 'utilities', description: '', headCount: 0, createdAt: now, updatedAt: now,
    });
    await orgs.create({
      id: divisionId, parentId: companyId, name: 'Water Division', type: 'division',
      industry: 'utilities', description: '', headCount: 0, createdAt: now, updatedAt: now,
    });

    await refreshOrgScopeCache();

    const fromCompany = getVisibleOrgScope(companyId);
    assert.ok(fromCompany, 'company scope should be non-null');
    assert.ok(fromCompany!.has(companyId), 'company sees itself');
    assert.ok(fromCompany!.has(divisionId), 'company sees its division (walk down)');

    const fromDivision = getVisibleOrgScope(divisionId);
    assert.ok(fromDivision, 'division scope should be non-null');
    assert.ok(fromDivision!.has(divisionId), 'division sees itself');
    assert.ok(fromDivision!.has(companyId), 'division sees its parent (walk up)');
  });

  it('scheduler leadership: one owner at a time, with failover when the lease expires', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { __test__ } = require('../lib/scheduler-leadership') as typeof import('../lib/scheduler-leadership');
    const client = loadPrisma();
    await client.$executeRawUnsafe(`DELETE FROM scheduler_leases WHERE id = 'scheduler'`);

    // This process claims the empty lease → leader.
    assert.strictEqual(await __test__.acquireOrRenew(), true);
    // Re-claiming our own valid lease keeps us leader.
    assert.strictEqual(await __test__.acquireOrRenew(), true);

    // A different live holder owns the lease → we are NOT leader.
    await client.$executeRawUnsafe(
      `UPDATE scheduler_leases SET holder = 'other-instance', "expiresAt" = now() + interval '90 seconds' WHERE id = 'scheduler'`,
    );
    assert.strictEqual(await __test__.acquireOrRenew(), false);

    // Once that holder's lease expires, we take over (failover).
    await client.$executeRawUnsafe(
      `UPDATE scheduler_leases SET "expiresAt" = now() - interval '1 second' WHERE id = 'scheduler'`,
    );
    assert.strictEqual(await __test__.acquireOrRenew(), true);

    // Only ever one lease row.
    const rows = await (client as unknown as {
      $queryRawUnsafe: (s: string) => Promise<Array<{ n: number }>>;
    }).$queryRawUnsafe(`SELECT count(*)::int AS n FROM scheduler_leases`);
    assert.strictEqual(rows[0].n, 1);
  });

  it('sync-connections: a run persists target entities to Postgres with sync tracking, and re-runs are idempotent', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();

    // A DATABASE-source sync uses simulated mock rows (5), so no external URL
    // is needed; the point is that applyRow writes through the systems repo.
    const sync = prismaRepo(prismaSyncConnectionsRepository);
    const scId = randomUUID();
    await sync.create({
      id: scId, orgId, name: 'Mock systems sync', targetEntity: 'systems',
      sourceType: 'DATABASE', connectionId: null,
      config: { dbType: 'POSTGRESQL', table: 't', sampleData: true },
      fieldMapping: { name: 'sys_name', description: 'sys_desc' }, matchKey: 'name',
      schedule: { enabled: false, intervalMinutes: 60, lastRunAt: null, nextRunAt: null },
      status: 'ACTIVE', lastSyncResult: null, createdAt: now, updatedAt: now,
    } as never);

    const app = express();
    app.use(express.json());
    app.use('/sync-connections', syncConnectionsRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', () => r(null)));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/sync-connections`;
    try {
      const run1 = (await (await fetch(`${base}/${scId}/run`, { method: 'POST' })).json()) as any;
      assert.strictEqual(run1.data.created, 5, 'first run creates the 5 mock rows');
      assert.strictEqual(run1.data.errors, 0);

      // The rows exist in Postgres with the sync-tracking columns set — they
      // would NOT if applyRow still wrote to a dead in-memory array + saveStore.
      const systemsRepo = prismaRepo(prismaSystemsRepository);
      const synced = (await systemsRepo.list({ orgId })).filter((s: any) => s.syncConnectionId === scId);
      assert.strictEqual(synced.length, 5, 'entities persisted with syncConnectionId');
      assert.ok(synced.every((s: any) => s.syncStatus === 'ACTIVE'), 'syncStatus persisted');

      const run2 = (await (await fetch(`${base}/${scId}/run`, { method: 'POST' })).json()) as any;
      assert.strictEqual(run2.data.created, 0, 'second run creates nothing');
      assert.strictEqual(run2.data.skipped, 5, 'second run matches the existing rows');
    } finally {
      await new Promise((r) => server.close(() => r(null)));
    }
  });

  it('sync auto-runner: a due enabled sync fires on tick, persists rows, and advances nextRunAt', async () => {
    const { orgId } = await seedFixture();
    const now = Date.now();

    // Enabled sync whose nextRunAt is in the past → the tick should pick it up.
    // DATABASE source uses the 5 simulated mock rows, so no network is needed.
    const sync = prismaRepo(prismaSyncConnectionsRepository);
    const scId = randomUUID();
    const pastNextRun = new Date(now - 60_000).toISOString();
    await sync.create({
      id: scId, orgId, name: 'Auto systems sync', targetEntity: 'systems',
      sourceType: 'DATABASE', connectionId: null,
      config: { dbType: 'POSTGRESQL', table: 't', sampleData: true },
      fieldMapping: { name: 'sys_name', description: 'sys_desc' }, matchKey: 'name',
      schedule: { enabled: true, intervalMinutes: 60, lastRunAt: null, nextRunAt: pastNextRun },
      status: 'ACTIVE', lastSyncResult: null,
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    } as never);

    // Also seed a due-but-DISABLED sync — the tick must skip it entirely.
    const disabledId = randomUUID();
    await sync.create({
      id: disabledId, orgId, name: 'Disabled sync', targetEntity: 'systems',
      sourceType: 'DATABASE', connectionId: null,
      config: { dbType: 'POSTGRESQL', table: 't', sampleData: true },
      fieldMapping: { name: 'off_name' }, matchKey: 'name',
      schedule: { enabled: false, intervalMinutes: 60, lastRunAt: null, nextRunAt: pastNextRun },
      status: 'ACTIVE', lastSyncResult: null,
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    } as never);

    // Drive the tick directly (bypasses the leader gate, which lives in
    // startBackgroundSweep). runSync is dispatched fire-and-forget, so poll
    // until the run has recorded its result on the connection.
    await tickSyncScheduler();
    let ran: any = null;
    for (let i = 0; i < 100; i++) {
      ran = await sync.get(scId);
      if (ran?.schedule?.lastRunAt) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ran?.schedule?.lastRunAt, 'the due sync ran within the poll window');
    assert.ok(
      new Date(ran.schedule.nextRunAt).getTime() > now,
      'nextRunAt advanced into the future',
    );
    assert.strictEqual(ran.lastSyncResult?.created, 5, 'the run created the 5 mock rows');

    // Rows landed in Postgres tagged to this sync.
    const systemsRepo = prismaRepo(prismaSystemsRepository);
    const synced = (await systemsRepo.list({ orgId })).filter((s: any) => s.syncConnectionId === scId);
    assert.strictEqual(synced.length, 5, 'auto-run persisted the entities');

    // The disabled sync never fired.
    const off = await sync.get(disabledId);
    assert.strictEqual(off?.schedule?.lastRunAt, null, 'disabled sync was skipped');
  });

  it('sync live driver: a DATABASE sync reads REAL rows from Postgres via a credentialed connection', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();
    const client = loadPrisma();

    // Parse the live-DB URL the suite already connects with, and reuse it as
    // the sync *source* — pointing the Postgres driver back at this same
    // database is the cleanest way to exercise a real connection in CI.
    const url = new URL(process.env.DATABASE_URL as string);
    const source = {
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.replace(/^\//, ''),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };

    // A real source table with distinctive values mock rows could never
    // produce (generateMockRows only emits "mock_<col>_<n>").
    await client.$executeRawUnsafe('DROP TABLE IF EXISTS sync_src');
    await client.$executeRawUnsafe(
      'CREATE TABLE sync_src (sys_name text, sys_desc text)',
    );
    await client.$executeRawUnsafe(
      `INSERT INTO sync_src (sys_name, sys_desc) VALUES
         ('Acme Billing', 'invoicing platform'),
         ('Acme CRM', 'customer records'),
         ('Acme GIS', 'network mapping')`,
    );

    try {
      // Credentials live on the Connection profile; the sync references it.
      const connections = prismaRepo(prismaConnectionsRepository);
      const connId = randomUUID();
      await connections.create({
        id: connId, orgId, name: 'Live Postgres source', connectionType: 'DATABASE',
        config: { dbType: 'POSTGRESQL', host: source.host, port: source.port, database: source.database },
        credentials: { username: source.username, password: source.password },
        status: 'CONNECTED', lastTestedAt: null, lastTestResult: null,
        createdAt: now, updatedAt: now,
      });

      const sync = prismaRepo(prismaSyncConnectionsRepository);
      const scId = randomUUID();
      await sync.create({
        id: scId, orgId, name: 'Live systems sync', targetEntity: 'systems',
        sourceType: 'DATABASE', connectionId: connId,
        // No sampleData → the live driver path. schema+table drive the SELECT.
        config: { schema: 'public', table: 'sync_src' },
        fieldMapping: { name: 'sys_name', description: 'sys_desc' }, matchKey: 'name',
        schedule: { enabled: false, intervalMinutes: 60, lastRunAt: null, nextRunAt: null },
        status: 'ACTIVE', lastSyncResult: null, createdAt: now, updatedAt: now,
      } as never);

      const app = express();
      app.use(express.json());
      app.use('/sync-connections', syncConnectionsRouter);
      const server = app.listen(0);
      await new Promise((r) => server.once('listening', () => r(null)));
      const port = (server.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}/sync-connections`;
      try {
        const run = (await (await fetch(`${base}/${scId}/run`, { method: 'POST' })).json()) as any;
        assert.strictEqual(run.success, true, 'live run succeeded');
        assert.strictEqual(run.data.created, 3, 'created a row per real source row');
        assert.strictEqual(run.data.errors, 0);
        assert.notStrictEqual(run.simulated, true, 'this was a REAL connection, not simulated');

        // The persisted systems carry the real source values — proof the
        // driver read the table, not generateMockRows.
        const systemsRepo = prismaRepo(prismaSystemsRepository);
        const names = (await systemsRepo.list({ orgId }))
          .filter((s: any) => s.syncConnectionId === scId)
          .map((s: any) => s.name)
          .sort();
        assert.deepStrictEqual(names, ['Acme Billing', 'Acme CRM', 'Acme GIS']);
      } finally {
        await new Promise((r) => server.close(() => r(null)));
      }
    } finally {
      await client.$executeRawUnsafe('DROP TABLE IF EXISTS sync_src');
    }
  });

  it('sync live driver: a DATABASE sync with an unreachable source FAILS LOUDLY (no silent mock fallback)', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();

    // No sampleData, no reachable host → the run must error, not fake success.
    const sync = prismaRepo(prismaSyncConnectionsRepository);
    const scId = randomUUID();
    await sync.create({
      id: scId, orgId, name: 'Broken source', targetEntity: 'systems',
      sourceType: 'DATABASE', connectionId: null,
      config: { dbType: 'POSTGRESQL', host: '127.0.0.1', port: 1, database: 'nope', table: 'whatever' },
      fieldMapping: { name: 'n' }, matchKey: 'name',
      schedule: { enabled: false, intervalMinutes: 60, lastRunAt: null, nextRunAt: null },
      status: 'ACTIVE', lastSyncResult: null, createdAt: now, updatedAt: now,
    } as never);

    const app = express();
    app.use(express.json());
    app.use('/sync-connections', syncConnectionsRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', () => r(null)));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/sync-connections`;
    try {
      const run = (await (await fetch(`${base}/${scId}/run`, { method: 'POST' })).json()) as any;
      assert.strictEqual(run.success, false, 'unreachable source fails the run');
      assert.ok(run.error, 'an error message is returned');
      assert.strictEqual(run.data.created, 0, 'nothing was created');

      // The connection is marked ERROR — not silently ACTIVE.
      const after = await sync.get(scId);
      assert.strictEqual(after?.status, 'ERROR');
    } finally {
      await new Promise((r) => server.close(() => r(null)));
    }
  });

  it('sync live driver: an ORACLE sync is wired (fails on connection, not "unsupported dbType")', async () => {
    const { orgId } = await seedFixture();
    const now = new Date().toISOString();

    // Unreachable Oracle host → the run must reach a real connection attempt
    // and fail there. Before Oracle was wired, resolveDbSource rejected it up
    // front with a "supports POSTGRESQL, MYSQL, SQLSERVER" message.
    const sync = prismaRepo(prismaSyncConnectionsRepository);
    const scId = randomUUID();
    await sync.create({
      id: scId, orgId, name: 'Oracle ERP sync', targetEntity: 'systems',
      sourceType: 'DATABASE', connectionId: null,
      config: { dbType: 'ORACLE', host: '127.0.0.1', port: 1, database: 'ORCLPDB1', table: 'SYSTEMS' },
      fieldMapping: { name: 'NAME' }, matchKey: 'name',
      schedule: { enabled: false, intervalMinutes: 60, lastRunAt: null, nextRunAt: null },
      status: 'ACTIVE', lastSyncResult: null, createdAt: now, updatedAt: now,
    } as never);

    const app = express();
    app.use(express.json());
    app.use('/sync-connections', syncConnectionsRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', () => r(null)));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/sync-connections`;
    try {
      const run = (await (await fetch(`${base}/${scId}/run`, { method: 'POST' })).json()) as any;
      assert.strictEqual(run.success, false, 'unreachable Oracle source fails the run');
      assert.ok(run.error, 'an error message is returned');
      assert.doesNotMatch(String(run.error), /supports POSTGRESQL/i, 'Oracle reached a real connection attempt, not the unsupported-engine guard');
      const after = await sync.get(scId);
      assert.strictEqual(after?.status, 'ERROR');
    } finally {
      await new Promise((r) => server.close(() => r(null)));
    }
  });

  it('sync agent-push: a connector fetches its due job and pushes rows that persist, with auth + ownership enforced', async () => {
    const { orgId } = await seedFixture();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // A paired connector with a known token (backend stores only the hash).
    const token = 'pct_' + 'a'.repeat(96);
    const connectors = prismaRepo(prismaConnectorsRepository);
    const connectorId = randomUUID();
    await connectors.create({
      id: connectorId, orgId, name: 'On-prem agent', tokenHash: createHash('sha256').update(token).digest('hex'),
      pairingCode: null, pairingCodeExpiresAt: null, systemIds: [], lastHeartbeatAt: null,
      agentVersion: 'test/1.0', status: 'ONLINE', createdAt: nowIso, updatedAt: nowIso,
    } as never);

    // A second connector (its own token) to prove ownership isolation.
    const otherToken = 'pct_' + 'b'.repeat(96);
    await connectors.create({
      id: randomUUID(), orgId, name: 'Other agent', tokenHash: createHash('sha256').update(otherToken).digest('hex'),
      pairingCode: null, pairingCodeExpiresAt: null, systemIds: [], lastHeartbeatAt: null,
      agentVersion: 'test/1.0', status: 'ONLINE', createdAt: nowIso, updatedAt: nowIso,
    } as never);

    // An AGENT-mode sync bound to the first connector, due now.
    const sync = prismaRepo(prismaSyncConnectionsRepository);
    const scId = randomUUID();
    await sync.create({
      id: scId, orgId, name: 'Agent systems sync', targetEntity: 'systems',
      sourceType: 'DATABASE', connectionId: null,
      executionMode: 'AGENT', connectorId,
      config: { dbType: 'POSTGRESQL', schema: 'public', table: 'hr_systems' },
      fieldMapping: { name: 'sys_name', description: 'sys_desc' }, matchKey: 'name',
      schedule: { enabled: true, intervalMinutes: 60, lastRunAt: null, nextRunAt: new Date(now - 60_000).toISOString() },
      status: 'ACTIVE', lastSyncResult: null, createdAt: nowIso, updatedAt: nowIso,
    } as never);

    const app = express();
    app.use(express.json());
    app.use('/connectors', connectorSyncRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', () => r(null)));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/connectors`;
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    try {
      // No token / bad token → 401.
      assert.strictEqual((await fetch(`${base}/sync-jobs`)).status, 401);
      assert.strictEqual((await fetch(`${base}/sync-jobs`, { headers: auth('pct_wrong') })).status, 401);

      // The connector sees exactly its due job.
      const jobsRes = await fetch(`${base}/sync-jobs`, { headers: auth(token) });
      assert.strictEqual(jobsRes.status, 200);
      const jobs = (await jobsRes.json()) as any;
      assert.strictEqual(jobs.data.length, 1);
      assert.strictEqual(jobs.data[0].id, scId);
      assert.strictEqual(jobs.data[0].table, 'hr_systems');
      assert.strictEqual(jobs.data[0].targetEntity, 'systems');

      // The other connector sees no jobs (isolation).
      const otherJobs = (await (await fetch(`${base}/sync-jobs`, { headers: auth(otherToken) })).json()) as any;
      assert.strictEqual(otherJobs.data.length, 0);

      // The other connector may NOT push to a sync it doesn't own → 403.
      const forbidden = await fetch(`${base}/sync-jobs/${scId}/push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(otherToken) },
        body: JSON.stringify({ rows: [{ sys_name: 'X', sys_desc: 'y' }] }),
      });
      assert.strictEqual(forbidden.status, 403);

      // The owning connector pushes rows it read locally → they persist.
      const pushRes = await fetch(`${base}/sync-jobs/${scId}/push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(token) },
        body: JSON.stringify({ rows: [
          { sys_name: 'Grid GIS', sys_desc: 'network map' },
          { sys_name: 'Meter Data', sys_desc: 'AMI readings' },
        ] }),
      });
      assert.strictEqual(pushRes.status, 200);
      const push = (await pushRes.json()) as any;
      assert.strictEqual(push.success, true);
      assert.strictEqual(push.data.created, 2);
      assert.strictEqual(push.data.errors, 0);

      const systemsRepo = prismaRepo(prismaSystemsRepository);
      const names = (await systemsRepo.list({ orgId }))
        .filter((s: any) => s.syncConnectionId === scId).map((s: any) => s.name).sort();
      assert.deepStrictEqual(names, ['Grid GIS', 'Meter Data']);

      // The push advanced the schedule (server-authoritative scheduling).
      const after = await sync.get(scId);
      assert.ok(after?.schedule?.lastRunAt, 'lastRunAt set by push');
      assert.ok(new Date(after!.schedule.nextRunAt!).getTime() > now, 'nextRunAt advanced');

      // Now that nextRunAt is in the future, the job is no longer "due".
      const jobsAfter = (await (await fetch(`${base}/sync-jobs`, { headers: auth(token) })).json()) as any;
      assert.strictEqual(jobsAfter.data.length, 0, 'job not due after push advanced its schedule');
    } finally {
      await new Promise((r) => server.close(() => r(null)));
    }
  });

  it('sync auto-runner: AGENT syncs are skipped by the direct tick (agent drives them)', async () => {
    const { orgId } = await seedFixture();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // A due AGENT sync with a deliberately unreachable direct config: if the
    // tick wrongly direct-ran it, the fail-loud path would flip it to ERROR.
    const sync = prismaRepo(prismaSyncConnectionsRepository);
    const scId = randomUUID();
    await sync.create({
      id: scId, orgId, name: 'Agent-only sync', targetEntity: 'systems',
      sourceType: 'DATABASE', connectionId: null,
      executionMode: 'AGENT', connectorId: randomUUID(),
      config: { dbType: 'POSTGRESQL', host: '127.0.0.1', port: 1, database: 'nope', table: 't' },
      fieldMapping: { name: 'n' }, matchKey: 'name',
      schedule: { enabled: true, intervalMinutes: 60, lastRunAt: null, nextRunAt: new Date(now - 60_000).toISOString() },
      status: 'ACTIVE', lastSyncResult: null, createdAt: nowIso, updatedAt: nowIso,
    } as never);

    await tickSyncScheduler();
    // Give any (erroneously dispatched) run a moment to record its failure.
    await new Promise((r) => setTimeout(r, 200));

    const after = await sync.get(scId);
    assert.strictEqual(after?.status, 'ACTIVE', 'AGENT sync was not direct-run (still ACTIVE, not ERROR)');
    assert.strictEqual(after?.schedule?.lastRunAt, null, 'AGENT sync was not run by the tick');
  });

  it('bootstrap: creates the primary org + SUPER_ADMIN on a clean DB, idempotently, and promotes an existing user', async () => {
    // Clean DB (beforeEach truncated). No seedFixture — bootstrap must stand up
    // the org itself.
    const orgId = randomUUID();
    const orgs = prismaRepo(prismaOrganizationsRepository);
    const people = prismaRepo(prismaPeopleRepository);

    // First run: creates both.
    const r1 = await runBootstrap({ superAdminEmail: 'admin@acme.test', superAdminName: 'Acme Admin', orgName: 'Acme Corp', orgIndustry: 'utilities', orgId });
    assert.strictEqual(r1.skipped, false);
    assert.strictEqual(r1.createdOrg, true);
    assert.strictEqual(r1.createdAdmin, true);

    const org = await orgs.get(orgId);
    assert.strictEqual(org?.name, 'Acme Corp');
    assert.strictEqual((org as any)?.industry, 'utilities');

    const admin = (await people.list()).find((p: any) => p.email === 'admin@acme.test');
    assert.ok(admin, 'super admin created');
    assert.strictEqual(admin!.role, 'SUPER_ADMIN');
    assert.deepStrictEqual(admin!.orgIds, [orgId]);

    // Second run: fully idempotent — nothing created, no duplicate person.
    const r2 = await runBootstrap({ superAdminEmail: 'admin@acme.test', orgName: 'Acme Corp', orgId });
    assert.strictEqual(r2.createdOrg, undefined);
    assert.strictEqual(r2.createdAdmin, undefined);
    assert.strictEqual((await people.list()).filter((p: any) => p.email === 'admin@acme.test').length, 1);

    // Promotion path: a demoted admin is restored to SUPER_ADMIN on next boot.
    await people.update(admin!.id, { role: 'VIEWER' });
    const r3 = await runBootstrap({ superAdminEmail: 'admin@acme.test', orgId });
    assert.strictEqual(r3.promotedAdmin, true);
    assert.strictEqual((await people.get(admin!.id))!.role, 'SUPER_ADMIN');

    // No email configured → no-op.
    const r4 = await runBootstrap({ superAdminEmail: '' });
    assert.strictEqual(r4.skipped, true);
  });

  it('settings: AppSetting set → get round-trips a JSON value through Postgres', async () => {
    // getSettingRepository([]) hands back the Prisma-backed repo when
    // DATABASE_URL is set — the empty array is ignored. A structured value
    // must survive the Json column round-trip unchanged.
    const repo = getSettingRepository([]);
    const value = { theme: 'procela-dark', retentionDays: 90, features: ['gap-detection'] };
    await repo.set('branding', value, 'admin-user');
    const read = await repo.get<typeof value>('branding');
    assert.deepStrictEqual(read, value);
    assert.strictEqual(await repo.get('never-set'), null);
  });

  it('governance-program route: GET + status read the seeded program from Postgres, not an empty default', async () => {
    const { orgId, personId } = await seedFixture();
    const now = new Date().toISOString();

    // A rich program plus the Phase 1/2 prerequisites, all via the Prisma
    // repos — this mirrors what the demo seeder writes to Postgres.
    const programs = prismaRepo(prismaGovernanceProgramsRepository);
    const programId = randomUUID();
    await programs.create({
      id: programId, orgId, name: 'Seeded Program',
      scope: { inScope: 'Everything in the catalog', outOfScope: '', boundaries: '', constraints: '' },
      principles: { vision: 'Trusted data', principles: ['P1', 'P2'], decisionRights: '', operatingModel: 'FEDERATED' },
      targetStartDate: null, targetLaunchDate: null,
      status: 'ACTIVE', createdAt: now, updatedAt: now,
    });
    const domains = prismaRepo(prismaDataDomainsRepository);
    await domains.create({
      id: randomUUID(), orgId, name: 'Customer', description: '', ownerId: personId,
      stewardIds: [], dataAssetIds: [], status: 'ACTIVE', createdAt: now, updatedAt: now,
    });
    const groups = prismaRepo(prismaGovernanceGroupsRepository);
    await groups.create({
      id: randomUUID(), orgId, name: 'Council', type: 'COUNCIL', parentId: null,
      description: '', charter: '', status: 'ACTIVE', members: [], createdAt: now, updatedAt: now,
    });
    const dama = prismaRepo(prismaDamaRolesRepository);
    for (const roleType of ['CDO', 'DATA_GOVERNANCE_LEAD']) {
      await dama.create({
        id: randomUUID(), personId, agentId: null, agentName: null,
        roleType, scopeType: 'ORG', scopeId: orgId, since: now, createdAt: now,
      });
    }

    // Drive the ACTUAL route handlers over HTTP against Postgres.
    const app = express();
    app.use(express.json());
    app.use('/governance-program', govProgramRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', () => r(null)));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}/governance-program`;
    try {
      const prog = (await (await fetch(`${base}?orgId=${orgId}`)).json()) as any;
      // The seeded program is returned — NOT a freshly-created empty default.
      assert.strictEqual(prog.data.id, programId);
      assert.strictEqual(prog.data.name, 'Seeded Program');
      assert.strictEqual(prog.data.status, 'ACTIVE');
      assert.deepStrictEqual(prog.data.principles.principles, ['P1', 'P2']);

      const st = (await (await fetch(`${base}/${programId}/status`)).json()) as any;
      // Phase computation read the seeded siblings from Postgres, not the
      // empty in-memory arrays — so Phase 1 is complete and Phase 2 has
      // real progress from the domain, council, and leadership roles.
      assert.strictEqual(st.data.phases.phase1.completed, true);
      assert.ok(st.data.phases.phase2.progress > 0);
      assert.ok(st.data.overallProgress > 0);
    } finally {
      await new Promise((r) => server.close(() => r(null)));
    }
  });

  it('saved-views + tags routes: list/get/delete read the seeded rows from Postgres, not the empty array', async () => {
    const { orgId, personId } = await seedFixture();
    const now = new Date().toISOString();

    const views = prismaRepo(prismaSavedViewsRepository);
    const viewId = randomUUID();
    await views.create({
      id: viewId, orgId, ownerId: personId, ownerName: 'Live-DB person',
      pageKey: 'processes', name: 'My View',
      filters: { columns: ['name'] }, createdAt: now, updatedAt: now,
    });
    const tags = prismaRepo(prismaTagsRepository);
    const tagId = randomUUID();
    await tags.create({
      id: tagId, orgId, entityType: 'DataAsset', entityId: randomUUID(),
      tag: 'pii', createdBy: personId, createdAt: now,
    });

    const app = express();
    app.use(express.json());
    app.use('/saved-views', savedViewsRouter);
    app.use('/tags', tagsRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', () => r(null)));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    try {
      // List returns the seeded view (would be empty if the handler still
      // read the in-memory array in Postgres mode).
      const list = (await (await fetch(`${base}/saved-views?orgId=${orgId}&pageKey=processes`)).json()) as any;
      assert.ok(list.data.some((v: any) => v.id === viewId), 'seeded saved view is listed');

      // Delete resolves the row via the repo — a 2xx, not the 404 the old
      // handler returned by looking the id up in the empty in-memory array.
      const del = await fetch(`${base}/saved-views/${viewId}`, { method: 'DELETE' });
      assert.ok(del.status >= 200 && del.status < 300, `delete finds the seeded view (got ${del.status})`);

      // Tag delete likewise resolves via the repo.
      const tagDel = await fetch(`${base}/tags/${tagId}`, { method: 'DELETE' });
      assert.ok(tagDel.status >= 200 && tagDel.status < 300, `delete finds the seeded tag (got ${tagDel.status})`);
    } finally {
      await new Promise((r) => server.close(() => r(null)));
    }
  });
});
