// DecisionRight repository — scalar-only per-entity migration.
// String[] arrays (recommends/approves/informed) pass through as-is;
// `decider` is nullable, everything else has string defaults.

import type { StoredDecisionRight, DecisionCategory } from '../routes/decision-rights';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonDecisionRightsRepository(
  store: StoredDecisionRight[],
): Repository<StoredDecisionRight> {
  return jsonRepository<StoredDecisionRight>(store, () => saveStore('decisionRights', store));
}

// ── Postgres path ──

type PrismaDecisionRightRow = {
  id: string;
  orgId: string;
  decision: string;
  category: string;
  description: string;
  decider: string | null;
  deciderType: string;
  recommends: string[];
  approves: string[];
  informed: string[];
  escalationPath: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaDecisionRightDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaDecisionRightRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaDecisionRightRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDecisionRightRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDecisionRightRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDecisionRightRow>;
}

function fromPrisma(r: PrismaDecisionRightRow): StoredDecisionRight {
  return {
    id: r.id,
    orgId: r.orgId,
    decision: r.decision,
    category: r.category as DecisionCategory,
    description: r.description ?? '',
    decider: r.decider,
    deciderType: r.deciderType as StoredDecisionRight['deciderType'],
    recommends: r.recommends ?? [],
    approves: r.approves ?? [],
    informed: r.informed ?? [],
    escalationPath: r.escalationPath ?? '',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredDecisionRight>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.decision !== undefined) d.decision = row.decision;
  if (row.category !== undefined) d.category = row.category;
  if (row.description !== undefined) d.description = row.description;
  if (row.decider !== undefined) d.decider = row.decider;
  if (row.deciderType !== undefined) d.deciderType = row.deciderType;
  if (row.recommends !== undefined) d.recommends = row.recommends;
  if (row.approves !== undefined) d.approves = row.approves;
  if (row.informed !== undefined) d.informed = row.informed;
  if (row.escalationPath !== undefined) d.escalationPath = row.escalationPath;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaDecisionRightsRepository(
  clientFactory: () => { decisionRight: PrismaDecisionRightDelegate } =
    getPrisma as unknown as () => { decisionRight: PrismaDecisionRightDelegate },
): Repository<StoredDecisionRight> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.decisionRight.findMany({ where: { orgId: filter.orgId } })
        : await client.decisionRight.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.decisionRight.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.decisionRight.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.decisionRight.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.decisionRight.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getDecisionRightsRepository(
  store: StoredDecisionRight[],
): Repository<StoredDecisionRight> {
  return hasDatabase()
    ? prismaDecisionRightsRepository()
    : jsonDecisionRightsRepository(store);
}
