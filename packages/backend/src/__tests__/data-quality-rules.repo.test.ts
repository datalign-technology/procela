import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonDataQualityRulesRepository,
  prismaDataQualityRulesRepository,
  type PrismaDataQualityRuleDelegate,
} from '../db/data-quality-rules.repo';
import type { DataQualityRule } from '../routes/data-quality';

const make = (over: Partial<DataQualityRule> = {}): DataQualityRule => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  dataAssetId: 'a1',
  dimension: 'COMPLETENESS',
  name: 'not null email',
  description: '',
  threshold: 95,
  currentScore: 0,
  weight: 1,
  status: 'NOT_MEASURED',
  lastMeasured: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonDataQualityRulesRepository', () => {
  let store: DataQualityRule[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonDataQualityRulesRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonDataQualityRulesRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });

  it('create round-trips JSONB parameters and lastRun', async () => {
    const repo = jsonDataQualityRulesRepository(store);
    const rule = make({
      id: 'r1',
      ruleType: 'REGEX_MATCH',
      parameters: { pattern: '^\\S+@\\S+$' },
      lastRun: {
        ranAt: '2026-07-16T00:00:00.000Z',
        simulated: false,
        totalRows: 10,
        passCount: 9,
        failCount: 1,
        passRate: 90,
        failureSamples: ['bad'],
        message: 'ok',
      },
    });
    await repo.create(rule);
    const [row] = await repo.list({ orgId: 'o1' });
    assert.strictEqual(row.parameters?.pattern, '^\\S+@\\S+$');
    assert.strictEqual(row.lastRun?.passRate, 90);
  });
});

describe('prismaDataQualityRulesRepository', () => {
  function delegate(over: Partial<PrismaDataQualityRuleDelegate> = {}): PrismaDataQualityRuleDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps nulls to undefined/empty', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'r1', orgId: 'o1', dataAssetId: 'a1',
        columnId: null, columnName: null,
        dimension: 'COMPLETENESS', name: 'nn', description: '',
        threshold: 95, currentScore: 0, weight: 1, status: 'NOT_MEASURED',
        lastMeasured: null, ruleType: null, parameters: null, lastRun: null,
        templateId: null, scheduleFrequency: null, nextRunAt: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaDataQualityRulesRepository(() => ({ dataQualityRule: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].columnId, undefined);
    assert.strictEqual(rows[0].ruleType, undefined);
    assert.strictEqual(rows[0].parameters, undefined);
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaDataQualityRulesRepository(() => ({ dataQualityRule: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
