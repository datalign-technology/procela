// GovernancePolicy repository — scalar-only per-entity migration.
// The "policies" surface is actually the home for the full document
// family (charters, frameworks, standards, policies) — documentType
// discriminates. All lifecycle / owner / review fields are String on
// the Prisma side so the vocabulary can extend without a migration.

import type { StoredGovernancePolicy } from '../routes/governance-policies';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonGovernancePoliciesRepository(store: StoredGovernancePolicy[]): Repository<StoredGovernancePolicy> {
  return jsonRepository<StoredGovernancePolicy>(store, () => saveStore('governancePolicies', store));
}

// ── Postgres path ──

type PrismaPolicyRow = {
  id: string;
  orgId: string;
  code: string;
  name: string;
  description: string;
  documentType: string;
  status: string;
  ownerAssignmentId: string | null;
  category: string;
  reviewFrequency: string;
  lastReviewDate: string | null;
  nextReviewDate: string | null;
  effectiveDate: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGovernancePolicyDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaPolicyRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaPolicyRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaPolicyRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaPolicyRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaPolicyRow>;
}

function fromPrisma(r: PrismaPolicyRow): StoredGovernancePolicy {
  return {
    id: r.id,
    orgId: r.orgId,
    code: r.code,
    name: r.name,
    description: r.description,
    documentType: r.documentType as StoredGovernancePolicy['documentType'],
    status: r.status as StoredGovernancePolicy['status'],
    ownerAssignmentId: r.ownerAssignmentId,
    category: r.category as StoredGovernancePolicy['category'],
    reviewFrequency: r.reviewFrequency as StoredGovernancePolicy['reviewFrequency'],
    lastReviewDate: r.lastReviewDate,
    nextReviewDate: r.nextReviewDate,
    effectiveDate: r.effectiveDate,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredGovernancePolicy>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.code !== undefined) data.code = row.code;
  if (row.name !== undefined) data.name = row.name;
  if (row.description !== undefined) data.description = row.description;
  if (row.documentType !== undefined) data.documentType = row.documentType;
  if (row.status !== undefined) data.status = row.status;
  if (row.ownerAssignmentId !== undefined) data.ownerAssignmentId = row.ownerAssignmentId;
  if (row.category !== undefined) data.category = row.category;
  if (row.reviewFrequency !== undefined) data.reviewFrequency = row.reviewFrequency;
  if (row.lastReviewDate !== undefined) data.lastReviewDate = row.lastReviewDate;
  if (row.nextReviewDate !== undefined) data.nextReviewDate = row.nextReviewDate;
  if (row.effectiveDate !== undefined) data.effectiveDate = row.effectiveDate;
  if (row.content !== undefined) data.content = row.content;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  return data;
}

export function prismaGovernancePoliciesRepository(
  clientFactory: () => { governancePolicy: PrismaGovernancePolicyDelegate } = getPrisma as unknown as () => { governancePolicy: PrismaGovernancePolicyDelegate },
): Repository<StoredGovernancePolicy> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.governancePolicy.findMany({ where: { orgId: filter.orgId } })
        : await client.governancePolicy.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.governancePolicy.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.governancePolicy.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.governancePolicy.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.governancePolicy.delete({ where: { id } });
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
 * Pick the right GovernancePolicy repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getGovernancePoliciesRepository(store: StoredGovernancePolicy[]): Repository<StoredGovernancePolicy> {
  return hasDatabase()
    ? prismaGovernancePoliciesRepository()
    : jsonGovernancePoliciesRepository(store);
}
