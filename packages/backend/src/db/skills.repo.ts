// Skill repository — scalar-only per-entity migration. Follows the
// shape of db/mappings.repo.ts. Skills are a small catalog (name,
// category, description) with two consumers on the schema side —
// PersonSkill and ProcessNodeSkill — that manage their own join
// tables.

import type { StoredSkill } from '../stores/skills';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonSkillsRepository(store: StoredSkill[]): Repository<StoredSkill> {
  return jsonRepository<StoredSkill>(store, () => saveStore('skills', store));
}

// ── Postgres path ──

type PrismaSkillRow = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  category: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaSkillDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaSkillRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaSkillRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaSkillRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaSkillRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaSkillRow>;
}

function fromPrisma(r: PrismaSkillRow): StoredSkill {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    category: r.category as StoredSkill['category'],
    description: r.description ?? '',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredSkill>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.name !== undefined) data.name = row.name;
  if (row.category !== undefined) data.category = row.category;
  if (row.description !== undefined) data.description = row.description || null;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  // updatedAt is Prisma-managed.
  return data;
}

export function prismaSkillsRepository(
  clientFactory: () => { skill: PrismaSkillDelegate } = getPrisma as unknown as () => { skill: PrismaSkillDelegate },
): Repository<StoredSkill> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.skill.findMany({ where: { orgId: filter.orgId } })
        : await client.skill.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.skill.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.skill.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const updated = await client.skill.update({ where: { id }, data: toPrismaData(patch) });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.skill.delete({ where: { id } });
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
 * Pick the right Skill repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getSkillsRepository(store: StoredSkill[]): Repository<StoredSkill> {
  return hasDatabase()
    ? prismaSkillsRepository()
    : jsonSkillsRepository(store);
}
