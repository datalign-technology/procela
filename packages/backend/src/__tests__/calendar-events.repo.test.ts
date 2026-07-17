import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  jsonCalendarEventsRepository,
  prismaCalendarEventsRepository,
  type PrismaCalendarEventDelegate,
} from '../db/calendar-events.repo';
import type { StoredCalendarEvent } from '../routes/governance-calendar';

const make = (over: Partial<StoredCalendarEvent> = {}): StoredCalendarEvent => ({
  id: `id-${Math.random().toString(36).slice(2, 10)}`,
  orgId: 'o1',
  name: 'Council',
  description: '',
  eventType: 'COUNCIL_MEETING' as StoredCalendarEvent['eventType'],
  cadence: 'MONTHLY' as StoredCalendarEvent['cadence'],
  dayOfMonth: null,
  dayOfWeek: null,
  timeOfDay: '',
  durationMinutes: 60,
  attendees: [],
  agendaTemplate: '',
  nextOccurrence: null,
  lastOccurrence: null,
  autoCreateTasks: false,
  status: 'ACTIVE' as StoredCalendarEvent['status'],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  ...over,
});

describe('jsonCalendarEventsRepository', () => {
  let store: StoredCalendarEvent[];
  beforeEach(() => { store = []; });

  it('list filters by orgId', async () => {
    const repo = jsonCalendarEventsRepository(store);
    store.push(make({ id: 'a', orgId: 'o1' }), make({ id: 'b', orgId: 'o2' }));
    const rows = await repo.list({ orgId: 'o1' });
    assert.deepStrictEqual(rows.map((r) => r.id), ['a']);
  });

  it('update returns null when row missing', async () => {
    const repo = jsonCalendarEventsRepository(store);
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});

describe('prismaCalendarEventsRepository', () => {
  function delegate(over: Partial<PrismaCalendarEventDelegate> = {}): PrismaCalendarEventDelegate {
    return {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error('stub'); },
      update: async () => { throw new Error('stub'); },
      delete: async () => { throw new Error('stub'); },
      ...over,
    };
  }

  it('list preserves null day fields and string occurrences', async () => {
    const d = delegate({
      findMany: async () => [{
        id: 'a1', orgId: 'o1', name: 'x', description: '',
        eventType: 'COUNCIL_MEETING', cadence: 'MONTHLY',
        dayOfMonth: null, dayOfWeek: null,
        timeOfDay: '', durationMinutes: 30,
        attendees: [], agendaTemplate: '',
        nextOccurrence: '2026-08-15', lastOccurrence: null,
        autoCreateTasks: false, status: 'ACTIVE',
        createdAt: new Date('2026-07-15T00:00:00.000Z'),
        updatedAt: new Date('2026-07-15T00:00:00.000Z'),
      }],
    });
    const repo = prismaCalendarEventsRepository(() => ({ calendarEvent: d }));
    const rows = await repo.list();
    assert.strictEqual(rows[0].dayOfMonth, null);
    assert.strictEqual(rows[0].nextOccurrence, '2026-08-15');
  });

  it('update returns null on P2025', async () => {
    const d = delegate({
      update: async () => {
        const e: Error & { code?: string } = new Error('nf'); e.code = 'P2025'; throw e;
      },
    });
    const repo = prismaCalendarEventsRepository(() => ({ calendarEvent: d }));
    assert.strictEqual(await repo.update('gone', { name: 'x' }), null);
  });
});
