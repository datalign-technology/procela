// AnalysisReport repository — `config` is opaque JSON round-tripped
// as-is; description/ownerId are nullable strings. The owner display
// name is derived from ownerId via a people join in the route, not
// stored on the row.

import type { StoredAnalysisReport } from '../routes/analysis-reports';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonAnalysisReportsRepository(store: StoredAnalysisReport[]): Repository<StoredAnalysisReport> {
  return jsonRepository<StoredAnalysisReport>(store, () => saveStore('analysisReports', store));
}

type PrismaAnalysisReportRow = {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaAnalysisReportDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaAnalysisReportRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaAnalysisReportRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaAnalysisReportRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaAnalysisReportRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaAnalysisReportRow>;
}

function fromPrisma(r: PrismaAnalysisReportRow): StoredAnalysisReport {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description ?? null,
    ownerId: r.ownerId ?? null,
    config: (r.config ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredAnalysisReport>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.description !== undefined) d.description = row.description ?? null;
  if (row.ownerId !== undefined) d.ownerId = row.ownerId ?? null;
  if (row.config !== undefined) d.config = row.config;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaAnalysisReportsRepository(
  clientFactory: () => { analysisReport: PrismaAnalysisReportDelegate } = getPrisma as unknown as () => { analysisReport: PrismaAnalysisReportDelegate },
): Repository<StoredAnalysisReport> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.analysisReport.findMany({ where: { orgId: filter.orgId } })
        : await client.analysisReport.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.analysisReport.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.analysisReport.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.analysisReport.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.analysisReport.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getAnalysisReportsRepository(store: StoredAnalysisReport[]): Repository<StoredAnalysisReport> {
  return hasDatabase()
    ? prismaAnalysisReportsRepository()
    : jsonAnalysisReportsRepository(store);
}
