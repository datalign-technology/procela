import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonAnalysisReportsRepository,
  prismaAnalysisReportsRepository,
  type PrismaAnalysisReportDelegate,
} from '../db/analysis-reports.repo';
import type { StoredAnalysisReport } from '../routes/analysis-reports';

const make = (over: Partial<StoredAnalysisReport> = {}): StoredAnalysisReport => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'r',
  description: null,
  ownerId: null,
  ownerName: null,
  config: {},
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonAnalysisReportsRepository', () => {
  let store: StoredAnalysisReport[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonAnalysisReportsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonAnalysisReportsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});

describe('prismaAnalysisReportsRepository', () => {
  function delegate(over: Partial<PrismaAnalysisReportDelegate> = {}): PrismaAnalysisReportDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list preserves null description/ownerId/ownerName', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', name: 'x',
        description: null, ownerId: null, ownerName: null,
        config: { chart: 'bar' },
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaAnalysisReportsRepository(() => ({ analysisReport: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].description, null);
    assert.strictEqual(rows[0].ownerId, null);
    assert.deepStrictEqual(rows[0].config, { chart: 'bar' });
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaAnalysisReportsRepository(() => ({ analysisReport: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
