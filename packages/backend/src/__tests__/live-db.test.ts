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
import { randomUUID } from 'crypto';

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
    'flow_relationships', 'process_nodes',
    'data_asset_bindings', 'data_asset_stewards', 'data_assets',
    'data_domain_stewards', 'data_domains',
    'system_custodians', 'systems',
    'audit_logs',
    'notifications',
    'governance_tasks', 'governance_issues',
    'governance_controls', 'governance_policies',
    'governance_groups',
    'comments',
    'dama_roles',
    'person_skills', 'skills',
    'person_orgs', 'people',
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
      automationMode: 'HUMAN', resolution: null, createdBy: null,
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
      lastReviewDate: null, nextReviewDate: null,
      effectiveDate: null,
      createdAt: now, updatedAt: now,
    });
    await ctrl.create({
      id: randomUUID(), orgId, policyId: polId,
      code: 'CTL-1', name: 'Test Control', description: '',
      controlType: 'PREVENTIVE', automationMode: 'HUMAN',
      status: 'DRAFT', ownerAssignmentId: null,
      evidenceRequired: false,
      linkedDomainId: null, linkedSystemId: null,
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
      type: 'SEQUENCE', condition: null, label: null,
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
});
