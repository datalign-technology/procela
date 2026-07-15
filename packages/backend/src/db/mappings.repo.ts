// Mapping repository — fourth per-entity migration.
//
// Mapping is the "process step ↔ artefact" join. The artefact can be
// a DataAsset (most common), a GovernancePolicy, or an Attachment
// (uuid-only, no schema-side FK — Attachment lives in the secondary-
// store batch). Exactly one of the three targets is set on each row,
// enforced application-side by the route validator.
//
// Patterns this repo exercises for the first time:
//   - Multiple optional FK slots on one row (dataAssetId, policyId,
//     attachmentId), each with its own Prisma relation for those
//     that are modelled. attachmentId stays a bare uuid.
//   - No M2M — mappings are pure scalar rows, which is the norm for
//     the remaining secondary entities. Ships a smaller repo file
//     that's easier to copy for those.

import type { StoredMapping } from '../routes/mappings';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonMappingsRepository(store: StoredMapping[]): Repository<StoredMapping> {
  return jsonRepository<StoredMapping>(store, () => saveStore('mappings', store));
}

// ── Postgres path ──

type PrismaMappingRow = {
  id: string;
  orgId: string;
  processStepId: string;
  dataAssetId: string | null;
  policyId: string | null;
  attachmentId: string | null;
  linkType: string | null;
  notes: string | null;
  aiSuggested: boolean;
  userOverridden: boolean;
  criticality: string | null;
  dataFormat: string | null;
  sla: string | null;
  qualityRequirement: string | null;
  fulfillsExpected: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaMappingDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaMappingRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaMappingRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaMappingRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaMappingRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaMappingRow>;
}

function fromPrisma(r: PrismaMappingRow): StoredMapping {
  return {
    id: r.id,
    orgId: r.orgId,
    processStepId: r.processStepId,
    ...(r.dataAssetId ? { dataAssetId: r.dataAssetId } : {}),
    ...(r.policyId ? { policyId: r.policyId } : {}),
    ...(r.attachmentId ? { attachmentId: r.attachmentId } : {}),
    linkType: r.linkType ?? '',
    notes: r.notes ?? '',
    aiSuggested: r.aiSuggested,
    userOverridden: r.userOverridden,
    ...(r.criticality ? { criticality: r.criticality as StoredMapping['criticality'] } : {}),
    ...(r.dataFormat ? { dataFormat: r.dataFormat } : {}),
    ...(r.sla ? { sla: r.sla } : {}),
    ...(r.qualityRequirement ? { qualityRequirement: r.qualityRequirement } : {}),
    ...(r.fulfillsExpected ? { fulfillsExpected: r.fulfillsExpected } : {}),
    createdBy: r.createdBy ?? '',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredMapping>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (row.id !== undefined) data.id = row.id;
  if (row.orgId !== undefined) data.orgId = row.orgId;
  if (row.processStepId !== undefined) data.processStepId = row.processStepId;
  if (row.dataAssetId !== undefined) data.dataAssetId = row.dataAssetId || null;
  if (row.policyId !== undefined) data.policyId = row.policyId || null;
  if (row.attachmentId !== undefined) data.attachmentId = row.attachmentId || null;
  if (row.linkType !== undefined) data.linkType = row.linkType || null;
  if (row.notes !== undefined) data.notes = row.notes || null;
  if (row.aiSuggested !== undefined) data.aiSuggested = row.aiSuggested;
  if (row.userOverridden !== undefined) data.userOverridden = row.userOverridden;
  if (row.criticality !== undefined) data.criticality = row.criticality ?? null;
  if (row.dataFormat !== undefined) data.dataFormat = row.dataFormat ?? null;
  if (row.sla !== undefined) data.sla = row.sla ?? null;
  if (row.qualityRequirement !== undefined) data.qualityRequirement = row.qualityRequirement ?? null;
  if (row.fulfillsExpected !== undefined) data.fulfillsExpected = row.fulfillsExpected ?? null;
  if (row.createdBy !== undefined) data.createdBy = row.createdBy || null;
  if (row.createdAt !== undefined) data.createdAt = new Date(row.createdAt);
  // updatedAt is Prisma-managed.
  return data;
}

export function prismaMappingsRepository(
  clientFactory: () => { mapping: PrismaMappingDelegate } = getPrisma as unknown as () => { mapping: PrismaMappingDelegate },
): Repository<StoredMapping> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.mapping.findMany({ where: { orgId: filter.orgId } })
        : await client.mapping.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.mapping.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.mapping.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.mapping.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.mapping.delete({ where: { id } });
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
 * Pick the right Mapping repository for the current runtime.
 * Postgres when DATABASE_URL is set; JSON otherwise.
 */
export function getMappingsRepository(store: StoredMapping[]): Repository<StoredMapping> {
  return hasDatabase()
    ? prismaMappingsRepository()
    : jsonMappingsRepository(store);
}
