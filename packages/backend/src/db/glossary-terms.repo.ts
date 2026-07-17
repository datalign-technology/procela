// GlossaryTerm repository — synonyms / relatedTerms as native String[];
// domainId / ownerPersonId nullable-string.

import type { StoredGlossaryTerm } from '../routes/business-glossary';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonGlossaryTermsRepository(store: StoredGlossaryTerm[]): Repository<StoredGlossaryTerm> {
  return jsonRepository<StoredGlossaryTerm>(store, () => saveStore('glossaryTerms', store));
}

type PrismaGlossaryTermRow = {
  id: string;
  orgId: string;
  term: string;
  definition: string;
  context: string;
  synonyms: string[];
  relatedTerms: string[];
  domainId: string | null;
  ownerPersonId: string | null;
  status: string;
  category: string;
  exampleValues: string;
  businessRules: string;
  sourceOfTruth: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaGlossaryTermDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaGlossaryTermRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaGlossaryTermRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaGlossaryTermRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaGlossaryTermRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaGlossaryTermRow>;
}

function fromPrisma(r: PrismaGlossaryTermRow): StoredGlossaryTerm {
  return {
    id: r.id,
    orgId: r.orgId,
    term: r.term,
    definition: r.definition ?? '',
    context: r.context ?? '',
    synonyms: r.synonyms ?? [],
    relatedTerms: r.relatedTerms ?? [],
    domainId: r.domainId ?? null,
    ownerPersonId: r.ownerPersonId ?? null,
    status: r.status as StoredGlossaryTerm['status'],
    category: r.category as StoredGlossaryTerm['category'],
    exampleValues: r.exampleValues ?? '',
    businessRules: r.businessRules ?? '',
    sourceOfTruth: r.sourceOfTruth ?? '',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredGlossaryTerm>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.term !== undefined) d.term = row.term;
  if (row.definition !== undefined) d.definition = row.definition;
  if (row.context !== undefined) d.context = row.context;
  if (row.synonyms !== undefined) d.synonyms = row.synonyms;
  if (row.relatedTerms !== undefined) d.relatedTerms = row.relatedTerms;
  if (row.domainId !== undefined) d.domainId = row.domainId ?? null;
  if (row.ownerPersonId !== undefined) d.ownerPersonId = row.ownerPersonId ?? null;
  if (row.status !== undefined) d.status = row.status;
  if (row.category !== undefined) d.category = row.category;
  if (row.exampleValues !== undefined) d.exampleValues = row.exampleValues;
  if (row.businessRules !== undefined) d.businessRules = row.businessRules;
  if (row.sourceOfTruth !== undefined) d.sourceOfTruth = row.sourceOfTruth;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaGlossaryTermsRepository(
  clientFactory: () => { glossaryTerm: PrismaGlossaryTermDelegate } = getPrisma as unknown as () => { glossaryTerm: PrismaGlossaryTermDelegate },
): Repository<StoredGlossaryTerm> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.glossaryTerm.findMany({ where: { orgId: filter.orgId } })
        : await client.glossaryTerm.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.glossaryTerm.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.glossaryTerm.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.glossaryTerm.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.glossaryTerm.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getGlossaryTermsRepository(store: StoredGlossaryTerm[]): Repository<StoredGlossaryTerm> {
  return hasDatabase()
    ? prismaGlossaryTermsRepository()
    : jsonGlossaryTermsRepository(store);
}
