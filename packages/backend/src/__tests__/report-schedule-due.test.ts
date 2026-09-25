// Report scheduling — the pure cadence logic (day/time control).
//
// mostRecentFireMoment() and isScheduleDue() decide, for a given schedule and
// wall clock, whether a scheduled report is due to be delivered. They're pure
// over the schedule + clock + last-delivered marker, so we exercise them
// directly with fixed UTC instants (no timers, no email).
//
// Reference: 2026-09-25 and 2026-09-18 are both Fridays (dayOfWeek 5).

import { describe, it } from 'node:test';
import assert from 'node:assert';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mostRecentFireMoment, isScheduleDue } = require('../routes/reports');

const iso = (d: Date) => d.toISOString();

describe('mostRecentFireMoment', () => {
  it('daily — today at the send hour once the hour has passed, else yesterday', () => {
    const sched = { frequency: 'daily', hour: 9, recipients: ['a@x.com'] };
    assert.strictEqual(
      iso(mostRecentFireMoment(sched, new Date('2026-09-25T10:00:00Z'))),
      '2026-09-25T09:00:00.000Z',
    );
    assert.strictEqual(
      iso(mostRecentFireMoment(sched, new Date('2026-09-25T08:00:00Z'))),
      '2026-09-24T09:00:00.000Z',
    );
  });

  it('weekly — the most recent occurrence of the chosen weekday at the hour', () => {
    const sched = { frequency: 'weekly', dayOfWeek: 5, hour: 9, recipients: ['a@x.com'] };
    // Friday 10:00 → this Friday 09:00.
    assert.strictEqual(
      iso(mostRecentFireMoment(sched, new Date('2026-09-25T10:00:00Z'))),
      '2026-09-25T09:00:00.000Z',
    );
    // Friday 08:00 (before the hour) → last Friday 09:00.
    assert.strictEqual(
      iso(mostRecentFireMoment(sched, new Date('2026-09-25T08:00:00Z'))),
      '2026-09-18T09:00:00.000Z',
    );
    // Mid-week (Wednesday) → the preceding Friday.
    assert.strictEqual(
      iso(mostRecentFireMoment(sched, new Date('2026-09-23T12:00:00Z'))),
      '2026-09-18T09:00:00.000Z',
    );
  });

  it('monthly — the chosen day-of-month at the hour, this month or last', () => {
    const sched = { frequency: 'monthly', dayOfMonth: 15, hour: 6, recipients: ['a@x.com'] };
    // After the 15th → this month.
    assert.strictEqual(
      iso(mostRecentFireMoment(sched, new Date('2026-09-25T00:00:00Z'))),
      '2026-09-15T06:00:00.000Z',
    );
    // Before the 15th → previous month.
    assert.strictEqual(
      iso(mostRecentFireMoment(sched, new Date('2026-09-10T00:00:00Z'))),
      '2026-08-15T06:00:00.000Z',
    );
  });

  it('applies legacy defaults (Sunday 23:00 UTC) when day/hour are absent', () => {
    // A weekly schedule saved before day/time control existed.
    const legacy = { frequency: 'weekly', recipients: ['a@x.com'] };
    const fire = mostRecentFireMoment(legacy, new Date('2026-09-25T12:00:00Z'));
    assert.strictEqual(fire.getUTCDay(), 0, 'defaults to Sunday');
    assert.strictEqual(fire.getUTCHours(), 23, 'defaults to 23:00');
  });
});

describe('isScheduleDue', () => {
  const now = new Date('2026-09-25T10:00:00Z'); // Friday
  const daily = { frequency: 'daily', hour: 9, recipients: ['a@x.com'] };

  it('is never due when off or without recipients', () => {
    assert.strictEqual(isScheduleDue({ frequency: 'off', recipients: ['a@x.com'] }, now, null), false);
    assert.strictEqual(isScheduleDue({ frequency: 'daily', hour: 9, recipients: [] }, now, null), false);
    assert.strictEqual(isScheduleDue(null, now, null), false);
  });

  it('is due when never delivered and the fire moment has passed', () => {
    assert.strictEqual(isScheduleDue(daily, now, null), true);
  });

  it('is not due when already delivered after this period fire moment', () => {
    // Delivered at 09:30 today, after today's 09:00 fire.
    assert.strictEqual(isScheduleDue(daily, now, '2026-09-25T09:30:00.000Z'), false);
  });

  it('is due again once a new period fire moment passes', () => {
    // Last delivered yesterday; today's 09:00 fire has passed by 10:00.
    assert.strictEqual(isScheduleDue(daily, now, '2026-09-24T09:05:00.000Z'), true);
  });

  it('weekly does not re-fire within the same week', () => {
    const weekly = { frequency: 'weekly', dayOfWeek: 5, hour: 9, recipients: ['a@x.com'] };
    // Fire moment is this Friday 09:00; delivered at 09:10 → not due at 10:00.
    assert.strictEqual(isScheduleDue(weekly, now, '2026-09-25T09:10:00.000Z'), false);
    // Delivered last week → due.
    assert.strictEqual(isScheduleDue(weekly, now, '2026-09-18T09:10:00.000Z'), true);
  });
});
