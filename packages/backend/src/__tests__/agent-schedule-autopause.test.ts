import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { runScheduleNow, agentSchedules, type StoredAgentSchedule } from '../routes/agent-schedules';

// A scheduled agent run whose config can never succeed (here: an agent/activity
// that doesn't exist, so runAgentExecution throws a 4xx) must not re-fire and
// spam the log every tick — the scheduler auto-pauses it instead. Regression
// for the seeded demo schedule that pointed an agent at a non-governance
// activity and errored once a minute forever.

const make = (over: Partial<StoredAgentSchedule> = {}): StoredAgentSchedule => ({
  id: `autopause-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o-autopause',
  agentId: 'agent-does-not-exist',
  agentName: 'Phantom Agent',
  activityId: 'activity-does-not-exist',
  activityName: 'Nowhere',
  roleType: 'DATA_STEWARD',
  frequency: 'DAILY',
  status: 'ACTIVE',
  startAt: '2026-01-01T00:00:00.000Z',
  nextRunAt: '2026-01-02T00:00:00.000Z',
  lastRunAt: null,
  runCount: 0,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('agent schedule auto-pause on non-retryable error', () => {
  beforeEach(() => { agentSchedules.length = 0; });

  it('pauses an ACTIVE schedule after a 4xx run failure instead of re-firing', async () => {
    const sched = make();
    agentSchedules.push(sched);

    await runScheduleNow(sched);

    assert.strictEqual(sched.status, 'PAUSED', 'schedule should auto-pause after a non-retryable failure');
    assert.strictEqual(sched.runCount, 1, 'the attempt still counts as a run');
    assert.ok(sched.lastRunAt, 'lastRunAt is stamped');
    // Paused, so it must not have rolled nextRunAt forward to keep firing.
    assert.strictEqual(sched.nextRunAt, '2026-01-02T00:00:00.000Z', 'nextRunAt is not advanced for a paused schedule');
  });
});
