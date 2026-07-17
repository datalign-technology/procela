// CalendarEvent repository — dayOfMonth / dayOfWeek numeric-nullable;
// nextOccurrence / lastOccurrence are String? in schema (not DateTime)
// and round-trip verbatim.

import type { StoredCalendarEvent } from '../routes/governance-calendar';
import { saveStore } from '../lib/persistence';
import { jsonRepository, Repository } from './repository';
import { getPrisma, hasDatabase } from './prisma';

export function jsonCalendarEventsRepository(store: StoredCalendarEvent[]): Repository<StoredCalendarEvent> {
  return jsonRepository<StoredCalendarEvent>(store, () => saveStore('calendarEvents', store));
}

type PrismaCalendarEventRow = {
  id: string;
  orgId: string;
  name: string;
  description: string;
  eventType: string;
  cadence: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  timeOfDay: string;
  durationMinutes: number;
  attendees: string[];
  agendaTemplate: string;
  nextOccurrence: string | null;
  lastOccurrence: string | null;
  autoCreateTasks: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface PrismaCalendarEventDelegate {
  findMany(arg?: { where?: { orgId?: string } }): Promise<PrismaCalendarEventRow[]>;
  findUnique(arg: { where: { id: string } }): Promise<PrismaCalendarEventRow | null>;
  create(arg: { data: Record<string, unknown> }): Promise<PrismaCalendarEventRow>;
  update(arg: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaCalendarEventRow>;
  delete(arg: { where: { id: string } }): Promise<PrismaCalendarEventRow>;
}

function fromPrisma(r: PrismaCalendarEventRow): StoredCalendarEvent {
  return {
    id: r.id,
    orgId: r.orgId,
    name: r.name,
    description: r.description ?? '',
    eventType: r.eventType as StoredCalendarEvent['eventType'],
    cadence: r.cadence as StoredCalendarEvent['cadence'],
    dayOfMonth: r.dayOfMonth ?? null,
    dayOfWeek: r.dayOfWeek ?? null,
    timeOfDay: r.timeOfDay ?? '',
    durationMinutes: r.durationMinutes,
    attendees: r.attendees ?? [],
    agendaTemplate: r.agendaTemplate ?? '',
    nextOccurrence: r.nextOccurrence ?? null,
    lastOccurrence: r.lastOccurrence ?? null,
    autoCreateTasks: r.autoCreateTasks,
    status: r.status as StoredCalendarEvent['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPrismaData(row: Partial<StoredCalendarEvent>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (row.id !== undefined) d.id = row.id;
  if (row.orgId !== undefined) d.orgId = row.orgId;
  if (row.name !== undefined) d.name = row.name;
  if (row.description !== undefined) d.description = row.description;
  if (row.eventType !== undefined) d.eventType = row.eventType;
  if (row.cadence !== undefined) d.cadence = row.cadence;
  if (row.dayOfMonth !== undefined) d.dayOfMonth = row.dayOfMonth ?? null;
  if (row.dayOfWeek !== undefined) d.dayOfWeek = row.dayOfWeek ?? null;
  if (row.timeOfDay !== undefined) d.timeOfDay = row.timeOfDay;
  if (row.durationMinutes !== undefined) d.durationMinutes = row.durationMinutes;
  if (row.attendees !== undefined) d.attendees = row.attendees;
  if (row.agendaTemplate !== undefined) d.agendaTemplate = row.agendaTemplate;
  if (row.nextOccurrence !== undefined) d.nextOccurrence = row.nextOccurrence ?? null;
  if (row.lastOccurrence !== undefined) d.lastOccurrence = row.lastOccurrence ?? null;
  if (row.autoCreateTasks !== undefined) d.autoCreateTasks = row.autoCreateTasks;
  if (row.status !== undefined) d.status = row.status;
  if (row.createdAt !== undefined) d.createdAt = new Date(row.createdAt);
  return d;
}

export function prismaCalendarEventsRepository(
  clientFactory: () => { calendarEvent: PrismaCalendarEventDelegate } = getPrisma as unknown as () => { calendarEvent: PrismaCalendarEventDelegate },
): Repository<StoredCalendarEvent> {
  return {
    async list(filter) {
      const client = clientFactory();
      const rows = filter?.orgId
        ? await client.calendarEvent.findMany({ where: { orgId: filter.orgId } })
        : await client.calendarEvent.findMany();
      return rows.map(fromPrisma);
    },
    async get(id) {
      const client = clientFactory();
      const row = await client.calendarEvent.findUnique({ where: { id } });
      return row ? fromPrisma(row) : null;
    },
    async create(row) {
      const client = clientFactory();
      const created = await client.calendarEvent.create({ data: toPrismaData(row) });
      return fromPrisma(created);
    },
    async update(id, patch) {
      const client = clientFactory();
      try {
        const data = toPrismaData(patch);
        delete data.updatedAt;
        const updated = await client.calendarEvent.update({ where: { id }, data });
        return fromPrisma(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        throw err;
      }
    },
    async delete(id) {
      const client = clientFactory();
      try {
        await client.calendarEvent.delete({ where: { id } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return false;
        throw err;
      }
    },
  };
}

export function getCalendarEventsRepository(store: StoredCalendarEvent[]): Repository<StoredCalendarEvent> {
  return hasDatabase()
    ? prismaCalendarEventsRepository()
    : jsonCalendarEventsRepository(store);
}
