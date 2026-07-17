// DataQualityRule repository — DQ rows carry two JSONB payloads
// (parameters + lastRun) plus the standard scalar catalog fields.
// The JSON blobs are round-tripped as-is so the DQ engine sees the
// same shape whether the row came from Postgres or the JSON store.

import type { DataQualityRule } from '../routes/data-quality';
import type { RuleType, RuleParameters, RuleRunResult } from '../services/dq-engine';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

// ── JSON path ──

export function jsonDataQualityRulesRepository(store: DataQualityRule[]): Repository<DataQualityRule> {
  return jsonRepository<DataQualityRule>(store, () => saveStore('dataQualityRules', store));
}

// ── Postgres path ──

type PrismaDataQualityRuleRow = {
  id: string;
  orgId: string;
  dataAssetId: string;
  columnId: string | null;
  columnName: string | null;
  dimension: string;
  name: string;
  description: string;
  threshold: number;
  currentScore: number;
  weight: number;
  status: string;
  lastMeasured: string | null;
  ruleType: string | null;
  parameters: unknown;
  lastRun: unknown;
  templateId: string | null;
  scheduleFrequency: string | null;
  nextRunAt: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaDataQualityRuleDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaDataQualityRuleRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaDataQualityRuleRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaDataQualityRuleRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaDataQualityRuleRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaDataQualityRuleRow>;
}

function fromPrisma(r: PrismaDataQualityRuleRow): DataQualityRule {
  return {
    id: r.id,
    orgId: r.orgId,
    dataAssetId: r.dataAssetId,
    ...(r.columnId ? { columnId: r.columnId } : {}),
    ...(r.columnName ? { columnName: r.columnName } : {}),
    dimension: r.dimension as DataQualityRule['dimension'],
    name: r.name,
    description: r.description ?? '',
    threshold: r.threshold,
    currentScore: r.currentScore,
    weight: r.weight,
    status: r.status as DataQualityRule['status'],
    lastMeasured: r.lastMeasured ?? null,
    ...(r.ruleType ? { ruleType: r.ruleType as RuleType } : {}),
    ...(r.parameters != null ? { parameters: r.parameters as RuleParameters } : {}),
    ...(r.lastRun != null ? { lastRun: r.lastRun as RuleRunResult } : {}),
    ...(r.templateId ? { templateId: r.templateId } : {}),
    ...(r.scheduleFrequency ? { scheduleFrequency: r.scheduleFrequency as DataQualityRule['scheduleFrequency'] } : {}),
    ...(r.nextRunAt !== null ? { nextRunAt: r.nextRunAt } : {}),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<DataQualityRule>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.dataAssetId !== undefined) d.dataAssetId = row.dataAssetId;
  if (row.columnId !== undefined) d.columnId = row.columnId || null;
  if (row.columnName !== undefined) d.columnName = row.columnName || null;
  if (row.dimension !== undefined) d.dimension = row.dimension;
  if (row.name !== undefined) d.name = row.name;
  if (row.description !== undefined) d.description = row.description ?? '';
  if (row.threshold !== undefined) d.threshold = row.threshold;
  if (row.currentScore !== undefined) d.currentScore = row.currentScore;
  if (row.weight !== undefined) d.weight = row.weight;
  if (row.status !== undefined) d.status = row.status;
  if (row.lastMeasured !== undefined) d.lastMeasured = row.lastMeasured ?? null;
  if (row.ruleType !== undefined) d.ruleType = row.ruleType ?? null;
  if (row.parameters !== undefined) d.parameters = row.parameters ?? null;
  if (row.lastRun !== undefined) d.lastRun = row.lastRun ?? null;
  if (row.templateId !== undefined) d.templateId = row.templateId || null;
  if (row.scheduleFrequency !== undefined) d.scheduleFrequency = row.scheduleFrequency ?? null;
  if (row.nextRunAt !== undefined) d.nextRunAt = row.nextRunAt ?? null;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaDataQualityRulesRepository(
  clientFactory: () => { dataQualityRule: PrismaDataQualityRuleDelegate } = getPrisma as unknown as () => { dataQualityRule: PrismaDataQualityRuleDelegate },
): Repository<DataQualityRule> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.dataQualityRule.findMany({ where: { orgId: filter.orgId } })
        : await client.dataQualityRule.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.dataQualityRule.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.dataQualityRule.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.dataQualityRule.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.dataQualityRule.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getDataQualityRulesRepository(store: DataQualityRule[]): Repository<DataQualityRule> {
  return hasDatabase()
    ? prismaDataQualityRulesRepository()
    : jsonDataQualityRulesRepository(store);
}
