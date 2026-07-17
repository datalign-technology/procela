import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonAgentSchedulesRepository,
  prismaAgentSchedulesRepository,
  type PrismaAgentScheduleDelegate,
} from '../db/agent-schedules.repo';
import type { StoredAgentSchedule } from '../routes/agent-schedules';

const make = (over: Partial<StoredAgentSchedule> = {}): StoredAgentSchedule => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  agentId: 'ag1',
  agentName: 'Compliance Agent',
  activityId: 'act1',
  activityName: 'Quarterly review',
  roleType: 'DATA_STEWARD',
  frequency: 'WEEKLY',
  status: 'ACTIVE',
  startAt: '2026-07-15T00:00:00.000Z',
  nextRunAt: '2026-07-22T00:00:00.000Z',
  lastRunAt: null,
  runCount: 0,
  createdBy: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonAgentSchedulesRepository', () => {
  let store: StoredAgentSchedule[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonAgentSchedulesRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update merges patch', async () => {
    const repo = jsonAgentSchedulesRepository(store);
    await repo.create(make({ id: 's1', runCount: 0 }));
    const updated = await repo.update('s1', { runCount: 3, lastRunAt: '2026-07-16T00:00:00.000Z' });
    assert.strictEqual(updated?.runCount, 3);
    assert.strictEqual(updated?.lastRunAt, '2026-07-16T00:00:00.000Z');
  });

  it('delete returns false when row missing', async () => {
    const repo = jsonAgentSchedulesRepository(store);
    assert.strictEqual(await repo.delete('gone'), false);
  });
});

describe('prismaAgentSchedulesRepository', () => {
  function delegate(over: Partial<PrismaAgentScheduleDelegate> = {}): PrismaAgentScheduleDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list maps rows correctly', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 's1', orgId: 'o1', agentId: 'ag1', agentName: 'A',
        activityId: 'act1', activityName: 'x', roleType: 'DATA_STEWARD',
        frequency: 'DAILY', status: 'ACTIVE',
        startAt: '2026-07-15T00:00:00.000Z',
        nextRunAt: '2026-07-16T00:00:00.000Z',
        lastRunAt: null, runCount: 0, createdBy: null,
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaAgentSchedulesRepository(() => ({ agentSchedule: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].frequency, 'DAILY');
    assert.strictEqual(rows[0].lastRunAt, null);
  });

  it('delete returns false on P2025', async () => {
    const d = delegate({
      delete: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaAgentSchedulesRepository(() => ({ agentSchedule: d }));
    assert.strictEqual(await repo.delete('gone'), false);
  });
});
