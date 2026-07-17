// Sop repository — steps is JSONB (array of SopStep), applicableRoles
// is a native String[]. lastReviewedAt is DateTime? in Postgres but
// stored as a string on the JSON row, so it's ISO-stringified on read
// and Date()-parsed on write.

import type { StoredSop, SopStep } from '../routes/sops';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonSopsRepository(store: StoredSop[]): Repository<StoredSop> {
  return jsonRepository<StoredSop>(store, () => saveStore('sops', store));
}

type PrismaSopRow = {
  id: string;
  orgId: string;
  code: string;
  title: string;
  purpose: string;
  category: string;
  applicableRoles: string[];
  triggerEvent: string;
  steps: unknown;
  status: string;
  version: number;
  ownerPersonId: string | null;
  lastReviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaSopDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaSopRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaSopRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaSopRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaSopRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaSopRow>;
}

function fromPrisma(r: PrismaSopRow): StoredSop {
  return {
    id: r.id,
    orgId: r.orgId,
    code: r.code,
    title: r.title,
    purpose: r.purpose ?? '',
    category: r.category as StoredSop['category'],
    applicableRoles: r.applicableRoles ?? [],
    triggerEvent: r.triggerEvent ?? '',
    steps: (r.steps ?? []) as unknown as SopStep[],
    status: r.status as StoredSop['status'],
    version: r.version,
    ownerPersonId: r.ownerPersonId ?? null,
    lastReviewedAt: r.lastReviewedAt ? r.lastReviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredSop>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.code !== undefined) d.code = row.code;
  if (row.title !== undefined) d.title = row.title;
  if (row.purpose !== undefined) d.purpose = row.purpose;
  if (row.category !== undefined) d.category = row.category;
  if (row.applicableRoles !== undefined) d.applicableRoles = row.applicableRoles;
  if (row.triggerEvent !== undefined) d.triggerEvent = row.triggerEvent;
  if (row.steps !== undefined) d.steps = row.steps;
  if (row.status !== undefined) d.status = row.status;
  if (row.version !== undefined) d.version = row.version;
  if (row.ownerPersonId !== undefined) d.ownerPersonId = row.ownerPersonId ?? null;
  if (row.lastReviewedAt !== undefined) d.lastReviewedAt = row.lastReviewedAt ? new Date(row.lastReviewedAt) : null;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaSopsRepository(
  clientFactory: () => { sop: PrismaSopDelegate } = getPrisma as unknown as () => { sop: PrismaSopDelegate },
): Repository<StoredSop> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.sop.findMany({ where: { orgId: filter.orgId } })
        : await client.sop.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.sop.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.sop.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.sop.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.sop.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getSopsRepository(store: StoredSop[]): Repository<StoredSop> {
  return hasDatabase()
    ? prismaSopsRepository()
    : jsonSopsRepository(store);
}
