// Scheduler daily stats-snapshot boundary — the guard that makes the
// capture sweep run at most once per UTC calendar day. Building up >= 2
// real snapshots is what lets /dashboard/trends return real history
// instead of the synthesized (illustrative) fallback series.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { __test__ } from '../services/scheduler.service';

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('scheduler daily stats-snapshot boundary', () => {
  beforeEach(async () => { await __test__.resetSchedulerState(); });

  it('captures when no snapshot day has been recorded yet', async () => {
    assert.strictEqual(await __test__.shouldCaptureSnapshots(Date.now()), true);
  });

  it('does not re-capture within the same UTC day, but does on the next day', async () => {
    const now = Date.UTC(2026, 7, 25, 10, 0, 0); // 2026-08-25T10:00:00Z
    await __test__.setLastStatsSnapshotDay(dayOf(now));

    // Same calendar day (even 12h later) → no re-capture.
    assert.strictEqual(await __test__.shouldCaptureSnapshots(now), false);
    assert.strictEqual(await __test__.shouldCaptureSnapshots(now + 12 * 3600_000), false);

    // Next UTC day → capture again.
    assert.strictEqual(await __test__.shouldCaptureSnapshots(now + 24 * 3600_000), true);
  });

  it('resetSchedulerState clears the recorded day so capture resumes', async () => {
    await __test__.setLastStatsSnapshotDay(dayOf(Date.now()));
    assert.strictEqual(await __test__.shouldCaptureSnapshots(Date.now()), false);
    await __test__.resetSchedulerState();
    assert.strictEqual(await __test__.shouldCaptureSnapshots(Date.now()), true);
  });
});
