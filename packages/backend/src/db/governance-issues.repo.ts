// GovernanceIssue repository — scalar-only per-entity migration.
// Follows db/mappings.repo.ts. Fields worth calling out:
//   - Extended vocabulary for issueType / severity / status stored as
//     String on the Prisma side (see the schema comment on this model
//     for the vocabulary-extension rationale).
//   - linkedRuleId / linkedAgentId are optional application-side
//     back-references used by the auto-issue sync helpers; kept as
//     bare strings with no FK so a source-record delete doesn't
//     cascade an audit-relevant issue away.

import type { StoredGovernanceIssue } from '../routes/governance-issues';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonGovernanceIssuesRepository(store: StoredGovernanceIssue[]): Repository<StoredGovernanceIssue> {
  return jsonRepository<StoredGovernanceIssue>(store, () => saveStore('governanceIssues', store));
}

// ── Postgres path ──

type PrismaIssueRow = {
  id: string;
  orgId: string;
  title: string;
  description: string;
  issueType: string;
  severity: string;
  status: string;
  domainId: string | null;
  dataAssetId: string | null;
  systemId: string | null;
  reportedBy: string | null;
  assignedTo: string | null;
  resolutionSummary: string | null;
  closedAt: Date | null;
  linkedRuleId: string | null;
  linkedAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGovernanceIssueDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaIssueRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaIssueRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaIssueRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaIssueRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaIssueRow>;
}

function fromPrisma(r: PrismaIssueRow): StoredGovernanceIssue {
  return {
    id: r.id,
    orgId: r.orgId,
    title: r.title,
    description: r.description,
    issueType: r.issueType as StoredGovernanceIssue['issueType'],
    severity: r.severity as StoredGovernanceIssue['severity'],
    status: r.status as StoredGovernanceIssue['status'],
    domainId: r.domainId,
    dataAssetId: r.dataAssetId,
    systemId: r.systemId,
    reportedBy: r.reportedBy,
    assignedTo: r.assignedTo,
    resolutionSummary: r.resolutionSummary,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    // Optional back-references — only include when non-null so a
    // manually-created issue that never touched the auto-sync helpers
    // round-trips without gaining spurious properties.
    ...(r.linkedRuleId !== null ? { linkedRuleId: r.linkedRuleId } : {}),
    ...(r.linkedAgentId !== null ? { linkedAgentId: r.linkedAgentId } : {}),
  };
}

function toPrismaData(row: Partial<StoredGovernanceIssue>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.title !== undefined) data.title = row.title;
  if (row.description !== undefined) data.description = row.description;
  if (row.issueType !== undefined) data.issueType = row.issueType;
  if (row.severity !== undefined) data.severity = row.severity;
  if (row.status !== undefined) data.status = row.status;
  if (row.domainId !== undefined) data.domainId = row.domainId;
  if (row.dataAssetId !== undefined) data.dataAssetId = row.dataAssetId;
  if (row.systemId !== undefined) data.systemId = row.systemId;
  if (row.reportedBy !== undefined) data.reportedBy = row.reportedBy;
  if (row.assignedTo !== undefined) data.assignedTo = row.assignedTo;
  if (row.resolutionSummary !== undefined) data.resolutionSummary = row.resolutionSummary;
  if (row.closedAt !== undefined) data.closedAt = row.closedAt ? new Date(row.closedAt) : null;
  if (row.linkedRuleId !== undefined) data.linkedRuleId = row.linkedRuleId;
  if (row.linkedAgentId !== undefined) data.linkedAgentId = row.linkedAgentId;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

export function prismaGovernanceIssuesRepository(
  clientFactory: () => { governanceIssue: PrismaGovernanceIssueDelegate } = getPrisma as unknown as () => { governanceIssue: PrismaGovernanceIssueDelegate },
): Repository<StoredGovernanceIssue> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.governanceIssue.findMany({ where: { orgId: filter.orgId } })
        : await client.governanceIssue.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.governanceIssue.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.governanceIssue.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.governanceIssue.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.governanceIssue.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

// ── Factory ──

/**
 * Pick the right GovernanceIssue repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getGovernanceIssuesRepository(store: StoredGovernanceIssue[]): Repository<StoredGovernanceIssue> {
  return hasDatabase()
    ? prismaGovernanceIssuesRepository()
    : jsonGovernanceIssuesRepository(store);
}
