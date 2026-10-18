import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';
import PageHeader from '../components/PageHeader';
import ExportMenu from '../components/ExportMenu';
import SegmentedControl from '../components/SegmentedControl';
import ListToolbar from '../components/ListToolbar';
import Modal from '../components/Modal';
import Card from '../components/Card';
import Button from '../components/Button';
import SectionCard from '../components/SectionCard';
import SectionLabel from '../components/SectionLabel';
import DetailEditActions from '../components/DetailEditActions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { SkeletonRows } from '../components/Skeleton';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';
import { clickable } from '../lib/a11y';

// ── Types ──

interface CalendarEvent {
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
  attendeeNames: string[];
  agendaTemplate: string;
  nextOccurrence: string | null;
  lastOccurrence: string | null;
  autoCreateTasks: boolean;
  status: 'ACTIVE' | 'PAUSED';
  createdAt: string;
  updatedAt: string;
}

interface UpcomingOccurrence {
  eventId: string;
  name: string;
  description: string;
  eventType: string;
  cadence: string;
  durationMinutes: number;
  timeOfDay: string;
  occursAt: string;
  daysAway: number;
  attendeeNames: string[];
}

interface Person { id: string; name: string; }

interface EventForm {
  name: string;
  description: string;
  eventType: string;
  cadence: string;
  dayOfMonth: string;        // input, parsed to number or null
  dayOfWeek: string;
  timeOfDay: string;
  durationMinutes: string;
  attendees: string[];
  agendaTemplate: string;
  autoCreateTasks: boolean;
  status: 'ACTIVE' | 'PAUSED';
}

const emptyForm: EventForm = {
  name: '',
  description: '',
  eventType: 'CUSTOM',
  cadence: 'MONTHLY',
  dayOfMonth: '',
  dayOfWeek: '',
  timeOfDay: '14:00',
  durationMinutes: '60',
  attendees: [],
  agendaTemplate: '',
  autoCreateTasks: false,
  status: 'ACTIVE',
};

const EVENT_TYPES = [
  'COUNCIL_MEETING',
  'COMMITTEE_MEETING',
  'STEWARDSHIP_SYNC',
  'POLICY_REVIEW',
  'MATURITY_ASSESSMENT',
  'CUSTOM',
] as const;

const CADENCES = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
] as const;

const STATUSES = ['ACTIVE', 'PAUSED'] as const;

// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

const rowMenuBtnStyle: React.CSSProperties = {
  width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8,
  color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
};
const rowMenuStyle: React.CSSProperties = {
  position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 170,
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
  padding: 6, textAlign: 'left',
};
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};

const EVENT_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  COUNCIL_MEETING:     { bg: '#ede9fe', color: '#5b21b6' }, // purple
  COMMITTEE_MEETING:   { bg: '#dbeafe', color: '#1e40af' }, // blue
  STEWARDSHIP_SYNC:    { bg: '#ccfbf1', color: '#115e59' }, // teal
  POLICY_REVIEW:       { bg: '#fef3c7', color: '#92400e' }, // amber
  MATURITY_ASSESSMENT: { bg: '#ffedd5', color: '#9a3412' }, // orange
  CUSTOM:              { bg: '#f3f4f6', color: '#6b7280' }, // gray
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  ACTIVE: { bg: '#dcefe5', color: '#17604b' },
  PAUSED: { bg: '#e5ecf3', color: '#364a5e' },
};


function formatTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

// Sentence-case a SCREAMING_SNAKE code: "COMMITTEE_MEETING" → "Committee
// meeting", "SEMI_ANNUAL" → "Semi annual". Used for every type/cadence/status
// label and filter option, in place of the raw all-caps codes.
function prettyLabel(code: string): string {
  const s = (code || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse an occurrence date as a LOCAL calendar day. A date-only ISO string
// ("2026-10-16") is otherwise read as UTC midnight and renders a day early in
// timezones behind UTC — the off-by-one the calendar showed ("tomorrow"
// labelled "today"). Pin to the local calendar day instead.
function parseLocalDate(iso: string | null): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
function localDaysAway(iso: string | null): number {
  const d = parseLocalDate(iso);
  if (!d) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function formatOccurrence(iso: string | null): string {
  const d = parseLocalDate(iso);
  if (!d) return '--';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDaysAway(days: number): string {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// A sentence-case pill with a leading status dot.
function dotPill(colors: { bg: string; color: string }, label: string): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: colors.bg, color: colors.color }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: colors.color }} />{label}
    </span>
  );
}

// "Weekly · Fri 09:00" / "Monthly · day 15 · 14:00" — a plain schedule hint.
function scheduleHint(ev: CalendarEvent): string {
  const parts = [prettyLabel(ev.cadence)];
  if ((ev.cadence === 'WEEKLY' || ev.cadence === 'BIWEEKLY') && ev.dayOfWeek != null) {
    parts.push(`${DOW_SHORT[ev.dayOfWeek] || ''} ${ev.timeOfDay || ''}`.trim());
  } else if (ev.dayOfMonth != null) {
    parts.push(`day ${ev.dayOfMonth}`);
    if (ev.timeOfDay) parts.push(ev.timeOfDay);
  } else if (ev.timeOfDay) {
    parts.push(ev.timeOfDay);
  }
  return parts.filter(Boolean).join(' · ');
}

function eventToForm(e: CalendarEvent): EventForm {
  return {
    name: e.name,
    description: e.description,
    eventType: e.eventType,
    cadence: e.cadence,
    dayOfMonth: e.dayOfMonth == null ? '' : String(e.dayOfMonth),
    dayOfWeek: e.dayOfWeek == null ? '' : String(e.dayOfWeek),
    timeOfDay: e.timeOfDay || '14:00',
    durationMinutes: String(e.durationMinutes || 60),
    attendees: e.attendees || [],
    agendaTemplate: e.agendaTemplate || '',
    autoCreateTasks: !!e.autoCreateTasks,
    status: e.status,
  };
}

function formToPayload(form: EventForm, orgId: string | null) {
  const dayOfMonthNum = form.dayOfMonth.trim() === '' ? null : parseInt(form.dayOfMonth, 10);
  const dayOfWeekNum = form.dayOfWeek.trim() === '' ? null : parseInt(form.dayOfWeek, 10);
  const durationNum = parseInt(form.durationMinutes, 10);
  return {
    name: form.name,
    description: form.description,
    eventType: form.eventType,
    cadence: form.cadence,
    dayOfMonth: Number.isFinite(dayOfMonthNum as number) ? dayOfMonthNum : null,
    dayOfWeek: Number.isFinite(dayOfWeekNum as number) ? dayOfWeekNum : null,
    timeOfDay: form.timeOfDay,
    durationMinutes: Number.isFinite(durationNum) ? durationNum : 60,
    attendees: form.attendees,
    agendaTemplate: form.agendaTemplate,
    autoCreateTasks: form.autoCreateTasks,
    status: form.status,
    ...(orgId ? { orgId } : {}),
  };
}

// The event's own fields, shared by the create form and the in-row edit
// panel. `onChange` merges a partial patch; the create form threads a name
// validation error/blur, the edit panel does not.
function EventFields({ form, onChange, people, nameError, onNameBlur }: {
  form: EventForm;
  onChange: (patch: Partial<EventForm>) => void;
  people: Person[];
  nameError?: string | null;
  onNameBlur?: () => void;
}) {
  const toggleAttendee = (id: string) =>
    onChange({ attendees: form.attendees.includes(id) ? form.attendees.filter((a) => a !== id) : [...form.attendees, id] });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Name *</label>
        <input
          autoFocus
          aria-label="Name"
          style={{ ...inputStyle, border: nameError ? inputErrorBorder : inputStyle.border }}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onBlur={onNameBlur}
          placeholder="e.g. Data Governance Council Meeting"
        />
        {nameError && <div style={fieldErrorStyle}>{nameError}</div>}
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Description</label>
        <textarea aria-label="Description" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>
      <div>
        <label style={labelStyle}>Event Type</label>
        <select aria-label="Event Type" style={selectStyle} value={form.eventType} onChange={(e) => onChange({ eventType: e.target.value })}>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{prettyLabel(t)}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Cadence</label>
        <select aria-label="Cadence" style={selectStyle} value={form.cadence} onChange={(e) => onChange({ cadence: e.target.value })}>
          {CADENCES.map((c) => <option key={c} value={c}>{prettyLabel(c)}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Day of Month (1-31)</label>
        <input type="number" min={1} max={31} aria-label="Day of Month (1-31)" style={inputStyle} value={form.dayOfMonth} onChange={(e) => onChange({ dayOfMonth: e.target.value })} placeholder="For monthly+ cadences" />
      </div>
      <div>
        <label style={labelStyle}>Day of Week (0=Sun)</label>
        <input type="number" min={0} max={6} aria-label="Day of Week (0=Sun)" style={inputStyle} value={form.dayOfWeek} onChange={(e) => onChange({ dayOfWeek: e.target.value })} placeholder="For weekly cadences" />
      </div>
      <div>
        <label style={labelStyle}>Time of Day (HH:MM)</label>
        <input aria-label="Time of Day (HH:MM)" style={inputStyle} value={form.timeOfDay} onChange={(e) => onChange({ timeOfDay: e.target.value })} placeholder="14:00" />
      </div>
      <div>
        <label style={labelStyle}>Duration (minutes)</label>
        <input type="number" min={5} aria-label="Duration (minutes)" style={inputStyle} value={form.durationMinutes} onChange={(e) => onChange({ durationMinutes: e.target.value })} />
      </div>
      <div>
        <label style={labelStyle}>Status</label>
        <select aria-label="Status" style={selectStyle} value={form.status} onChange={(e) => onChange({ status: e.target.value as 'ACTIVE' | 'PAUSED' })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
        <input type="checkbox" id={`autoCreateTasks-${form.name || 'new'}`} checked={form.autoCreateTasks} onChange={(e) => onChange({ autoCreateTasks: e.target.checked })} />
        <label htmlFor={`autoCreateTasks-${form.name || 'new'}`} style={{ fontSize: 12, fontWeight: 500 }}>Auto-create governance tasks each occurrence</label>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Attendees</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, border: '1px solid var(--color-border)', borderRadius: 4, maxHeight: 140, overflowY: 'auto', background: 'var(--color-surface)' }}>
          {people.length === 0 && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No people defined yet.</span>}
          {people.map((p) => {
            const selected = form.attendees.includes(p.id);
            return (
              <button key={p.id} type="button" onClick={() => toggleAttendee(p.id)}
                style={{ padding: '4px 10px', fontSize: 12, borderRadius: 12, cursor: 'pointer', border: '1px solid', borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)', background: selected ? 'var(--color-primary)' : 'var(--color-bg)', color: selected ? '#fff' : 'var(--color-text)' }}>
                {p.name}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Agenda Template</label>
        <textarea aria-label="Agenda Template" style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} value={form.agendaTemplate} onChange={(e) => onChange({ agendaTemplate: e.target.value })} placeholder="1. Program status&#10;2. Open items&#10;3. Decisions" />
      </div>
    </div>
  );
}

// The expanded detail row for one event. View mode summarises the schedule;
// Edit flips the EventFields into a staged edit, one Save PUTs them. The
// row's mark-done / .ics / delete quick-actions stay in the list row.
function ExpandedEvent({ event, people, canWrite, orgId, onSaved }: {
  event: CalendarEvent;
  people: Person[];
  canWrite: boolean;
  orgId: string | null;
  onSaved: () => void;
}) {
  const { addToast } = useToastStore();
  const m = useDetailEditMode<EventForm>(
    eventToForm(event),
    async (draft) => {
      if (!draft.name.trim()) { addToast('error', 'Event name is required.'); throw new Error('no-name'); }
      try {
        await apiClient.put(`/governance-calendar/${event.id}`, formToPayload(draft, orgId));
        addToast('success', 'Event updated');
        onSaved();
      } catch (err) { addToast('error', errorMessage(err, 'Failed to save event')); throw err; }
    },
  );
  const scheduleText = (() => {
    if (event.cadence === 'WEEKLY' || event.cadence === 'BIWEEKLY') {
      const dow = event.dayOfWeek == null ? null : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][event.dayOfWeek];
      return dow ? `${formatTypeLabel(event.cadence)} on ${dow}` : formatTypeLabel(event.cadence);
    }
    return event.dayOfMonth != null ? `${formatTypeLabel(event.cadence)}, day ${event.dayOfMonth}` : formatTypeLabel(event.cadence);
  })();
  return (
    <div>
      {canWrite && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: m.isEditing ? 12 : 8 }}>
          <DetailEditActions editing={m.isEditing} canEdit dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
        </div>
      )}
      {m.isEditing ? (
        <EventFields form={m.draft} onChange={m.patch} people={people} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <div>
            <SectionLabel marginBottom={4}>Schedule</SectionLabel>
            <div style={{ fontSize: 13 }}>{scheduleText} · {event.timeOfDay} · {event.durationMinutes} min</div>
          </div>
          <div>
            <SectionLabel marginBottom={4}>Next occurrence</SectionLabel>
            <div style={{ fontSize: 13 }}>{formatOccurrence(event.nextOccurrence)}</div>
          </div>
          <div>
            <SectionLabel marginBottom={4}>Auto-create tasks</SectionLabel>
            <div style={{ fontSize: 13 }}>{event.autoCreateTasks ? 'Yes' : 'No'}</div>
          </div>
          {event.description && (
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionLabel marginBottom={4}>Description</SectionLabel>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{event.description}</div>
            </div>
          )}
          {event.attendeeNames.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionLabel marginBottom={4}>Attendees ({event.attendeeNames.length})</SectionLabel>
              <div style={{ fontSize: 13 }}>{event.attendeeNames.join(', ')}</div>
            </div>
          )}
          {event.agendaTemplate && (
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionLabel marginBottom={4}>Agenda template</SectionLabel>
              <pre style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: 0, color: 'var(--color-text-secondary)' }}>{event.agendaTemplate}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ──

export default function GovernanceCalendarPage() {
  const { activeOrgId } = useOrgContext();
  const { isAdmin } = usePermissions();
  const { addToast } = useToastStore();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingOccurrence[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EventForm>(emptyForm);
  // Row click opens one event's detail in a modal.
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Per-row "⋯" overflow menu.
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);
  const eventValidation = useFormValidation({
    name: (v: any) => !v?.trim() ? 'Event name is required.' : null,
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterCadence, setFilterCadence] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const upQuery = activeOrgId ? `?orgId=${activeOrgId}&days=30` : '?days=30';
      const [evRes, upRes, pplRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: CalendarEvent[] }>(`/governance-calendar${query}`),
        apiClient.get<{ success: boolean; data: UpcomingOccurrence[] }>(`/governance-calendar/upcoming${upQuery}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setEvents(evRes.data || []);
      setUpcoming(upRes.data || []);
      setPeople(pplRes.data || []);
    } catch (err) { setLoadError(errorMessage(err, 'Failed to load the governance calendar.')); }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Create-only: editing an event happens in the row's expanded detail.
  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setForm(emptyForm); setShowForm(true); };

  const closeForm = () => { setShowForm(false); setForm(emptyForm); };

  const handleSave = async () => {
    if (!eventValidation.validateAll(form)) return;
    try {
      await apiClient.post('/governance-calendar', formToPayload(form, activeOrgId));
      addToast('success', 'Event created');
      closeForm();
      fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to save event'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-calendar/${id}`);
      addToast('success', 'Event deleted');
      fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to delete event'));
    }
  };

  const handleRun = async (id: string) => {
    try {
      const res = await apiClient.post<{ success: boolean; data: { createdTaskIds: string[] } }>(
        `/governance-calendar/${id}/run`,
        {},
      );
      const taskCount = res.data?.createdTaskIds?.length || 0;
      addToast(
        'success',
        taskCount > 0
          ? `Occurrence recorded, ${taskCount} task${taskCount === 1 ? '' : 's'} created`
          : 'Occurrence recorded',
      );
      fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to mark occurrence'));
    }
  };

  const handleSetStatus = async (ev: CalendarEvent, status: 'ACTIVE' | 'PAUSED') => {
    try {
      await apiClient.put(`/governance-calendar/${ev.id}`, { ...formToPayload(eventToForm({ ...ev, status }), activeOrgId) });
      addToast('success', status === 'PAUSED' ? 'Event paused' : 'Event resumed');
      fetchData();
    } catch (err) { addToast('error', errorMessage(err, 'Failed to update event')); }
  };

  const downloadIcs = (ev: CalendarEvent) => {
    const nextDate = ev.nextOccurrence ? new Date(ev.nextOccurrence) : new Date();
    const endDate = new Date(nextDate.getTime() + (ev.durationMinutes || 60) * 60000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Procela//Governance Calendar//EN',
      'BEGIN:VEVENT',
      `DTSTART:${fmt(nextDate)}`,
      `DTEND:${fmt(endDate)}`,
      `SUMMARY:${ev.name}`,
      `DESCRIPTION:${(ev.description || '').replace(/\n/g, '\\n')}`,
      `UID:${ev.id}@procela`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ev.name.replace(/[^a-zA-Z0-9]/g, '-')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSeed = async () => {
    if (!activeOrgId) {
      addToast('error', 'Select an organization first');
      return;
    }
    try {
      const res = await apiClient.post<{ success: boolean; data: { created: CalendarEvent[]; skipped: string[] } }>(
        '/governance-calendar/seed',
        { orgId: activeOrgId },
      );
      const createdCount = res.data?.created?.length || 0;
      addToast('success', `Seeded ${createdCount} standard event${createdCount === 1 ? '' : 's'}`);
      fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to seed events'));
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(sel.selectedIds);
    await Promise.all(ids.map((id) => apiClient.delete(`/governance-calendar/${id}`)));
    addToast('success', `Deleted ${ids.length} event${ids.length === 1 ? '' : 's'}`);
    sel.clear();
    fetchData();
  };

  // ── Derived ──

  const filteredEvents = useMemo(() => {
    let result = events;
    if (filterType) result = result.filter((e) => e.eventType === filterType);
    if (filterCadence) result = result.filter((e) => e.cadence === filterCadence);
    if (filterStatus) result = result.filter((e) => e.status === filterStatus);
    return result;
  }, [events, filterType, filterCadence, filterStatus]);

  const hasActiveFilters = !!(filterType || filterCadence || filterStatus);

  const sel = useRowSelection(filteredEvents, (e) => e.id);

  // The next occurrence (for the "Next up" hero), plus its event record for
  // agenda / attendees / automation.
  const nextUp = upcoming[0] || null;
  const nextUpEvent = nextUp ? (events.find((e) => e.id === nextUp.eventId) || null) : null;
  const agendaItems = (nextUpEvent?.agendaTemplate || '').split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);

  // Calendar grid: compute which events fall on which days of the displayed month
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const startOffset = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const cells: { date: number | null; events: CalendarEvent[] }[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        cells.push({ date: null, events: [] });
      } else {
        const dayDate = new Date(calYear, calMonth, dayNum);
        const dayOfWeek = dayDate.getDay();
        const matching = filteredEvents.filter((ev) => {
          if (ev.status === 'PAUSED') return false;
          // Check nextOccurrence date match
          if (ev.nextOccurrence) {
            const next = new Date(ev.nextOccurrence);
            if (next.getFullYear() === calYear && next.getMonth() === calMonth && next.getDate() === dayNum) return true;
          }
          // Cadence-based matching
          if (ev.cadence === 'WEEKLY' && ev.dayOfWeek != null && ev.dayOfWeek === dayOfWeek) return true;
          if (ev.cadence === 'BIWEEKLY' && ev.dayOfWeek != null && ev.dayOfWeek === dayOfWeek) {
            // Approximate: show on 1st and 3rd matching weekday
            const weekInMonth = Math.ceil(dayNum / 7);
            return weekInMonth === 1 || weekInMonth === 3;
          }
          if ((ev.cadence === 'MONTHLY' || ev.cadence === 'QUARTERLY' || ev.cadence === 'SEMI_ANNUAL' || ev.cadence === 'ANNUAL') && ev.dayOfMonth != null && ev.dayOfMonth === dayNum) {
            if (ev.cadence === 'MONTHLY') return true;
            if (ev.cadence === 'QUARTERLY') return calMonth % 3 === 0;
            if (ev.cadence === 'SEMI_ANNUAL') return calMonth % 6 === 0;
            if (ev.cadence === 'ANNUAL') return calMonth === 0;
          }
          return false;
        });
        cells.push({ date: dayNum, events: matching });
      }
    }
    return cells;
  }, [calYear, calMonth, filteredEvents]);

  const calMonthLabel = new Date(calYear, calMonth).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(calMonth - 1); };
  const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(calMonth + 1); };
  const goToday = () => { const now = new Date(); setCalYear(now.getFullYear()); setCalMonth(now.getMonth()); };

  const calendarColumns: DataTableColumn<CalendarEvent>[] = [
    {
      key: 'name', header: 'Name', cellStyle: { fontWeight: 500 },
      render: (ev) => (
        <>
          <button
            type="button"
            onClick={() => setViewingId(ev.id)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', cursor: 'pointer', font: 'inherit', fontWeight: 500, textAlign: 'left' }}
          >
            {ev.name}
          </button>
          {ev.attendeeNames.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 2 }}>
              {ev.attendeeNames.slice(0, 3).join(', ')}
              {ev.attendeeNames.length > 3 && ` +${ev.attendeeNames.length - 3}`}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'type', header: 'Type',
      render: (ev) => dotPill(EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.CUSTOM, prettyLabel(ev.eventType)),
    },
    { key: 'cadence', header: 'Repeats', render: (ev) => <span style={{ color: 'var(--color-text-secondary)' }}>{scheduleHint(ev)}</span> },
    {
      key: 'next', header: 'Next',
      render: (ev) => {
        if (!ev.nextOccurrence) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        const rel = formatDaysAway(localDaysAway(ev.nextOccurrence));
        return <span title={formatOccurrence(ev.nextOccurrence)} style={{ color: 'var(--color-text-secondary)' }}>{rel.charAt(0).toUpperCase() + rel.slice(1)}</span>;
      },
    },
    {
      key: 'status', header: 'Status',
      render: (ev) => dotPill(STATUS_COLORS[ev.status] || STATUS_COLORS.ACTIVE, prettyLabel(ev.status)),
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const, width: 70,
      render: (ev) => (
        <span style={{ position: 'relative', display: 'inline-flex' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label={`More actions for ${ev.name}`} aria-haspopup="menu" aria-expanded={rowMenuId === ev.id}
            onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === ev.id ? null : ev.id); }} style={rowMenuBtnStyle}>⋯</button>
          {rowMenuId === ev.id && (
            <div role="menu" onClick={(e) => e.stopPropagation()} style={rowMenuStyle}>
              {isAdmin && <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); handleRun(ev.id); }}>Mark as held</button>}
              <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); downloadIcs(ev); }}>Add to calendar (.ics)</button>
              {isAdmin && <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); handleSetStatus(ev, ev.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED'); }}>{ev.status === 'PAUSED' ? 'Resume' : 'Pause'}</button>}
              <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); setViewingId(ev.id); }}>Open &amp; edit</button>
              {isAdmin && <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); setConfirmDelete(ev.id); }}>Delete</button>}
            </div>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>

      <PageHeader
        title="Governance Calendar"
        subtitle="Recurring meetings and reviews that keep the governance program running."
        actions={
          <ListToolbar
            export={
              events.length > 0 ? (
                <ExportMenu
                  label="Export calendar"
                  build={() => ({
                    filenameBase: 'governance-calendar',
                    sheetName: 'Calendar',
                    headers: ['Name', 'Type', 'Cadence', 'Next date', 'Status'],
                    rows: events.map((ev) => [
                      ev.name,
                      formatTypeLabel(ev.eventType),
                      formatTypeLabel(ev.cadence),
                      formatOccurrence(ev.nextOccurrence),
                      ev.status,
                    ]),
                  })}
                />
              ) : undefined
            }
            extra={
              <>
                {events.length > 0 && (
                  <SegmentedControl
                    ariaLabel="Calendar view"
                    value={viewMode}
                    onChange={setViewMode}
                    options={[
                      { value: 'list', label: 'List' },
                      { value: 'calendar', label: 'Month' },
                    ]}
                  />
                )}
                {isAdmin && events.length === 0 && (
                  <Button variant="secondary" onClick={handleSeed}>Seed standard events</Button>
                )}
              </>
            }
            primary={isAdmin ? <Button variant="primary" onClick={openAdd}>+ Add event</Button> : undefined}
          />
        }
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Event?"
        message="This will permanently delete this calendar event."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Add Event form (editing an event happens in the row's expanded detail) */}
      {showForm && (
        <SectionCard title="Add New Event">
          <EventFields
            form={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            people={people}
            nameError={eventValidation.fieldError('name')}
            onNameBlur={() => { eventValidation.touch('name'); eventValidation.validateField('name', form.name, form); }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              Add Event
            </Button>
          </div>
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${sel.count} event${sel.count === 1 ? '' : 's'}?`}
        message="This cannot be undone."
        confirmLabel={`Delete ${sel.count}`}
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      {/* Next up — the single most imminent occurrence, with its agenda. */}
      {!loading && nextUp && (() => {
        const d = parseLocalDate(nextUp.occursAt);
        const rel = formatDaysAway(localDaysAway(nextUp.occursAt));
        const end = (() => {
          const m = /^(\d{2}):(\d{2})/.exec(nextUpEvent?.timeOfDay || nextUp.timeOfDay || '');
          if (!m) return '';
          const total = (+m[1]) * 60 + (+m[2]) + (nextUpEvent?.durationMinutes || nextUp.durationMinutes || 60);
          return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
        })();
        const names = nextUp.attendeeNames || [];
        return (
          <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '18px 20px', display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 16 }}>
            <div style={{ flex: 'none', width: 76, height: 84, borderRadius: 10, background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em' }}>{d ? `${DOW_SHORT[d.getDay()].toUpperCase()} ${MON_SHORT[d.getMonth()].toUpperCase()}` : ''}</span>
              <span style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{d ? d.getDate() : '—'}</span>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{rel}</span>
            </div>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Next up</div>
              <h2 style={{ margin: '2px 0 6px', fontSize: 18, fontWeight: 600 }}>{nextUp.name}</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                <span>{nextUpEvent?.timeOfDay || nextUp.timeOfDay}{end ? ` to ${end}` : ''} · {prettyLabel(nextUp.cadence)}</span>
                <span>{prettyLabel(nextUp.eventType)}</span>
                {names.length > 0 && <span>{names.length} attendee{names.length === 1 ? '' : 's'}: {names.slice(0, 4).join(', ')}{names.length > 4 ? ` +${names.length - 4}` : ''}</span>}
              </div>
              {agendaItems.length > 0 && (
                <>
                  <div style={{ marginTop: 12, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Agenda</div>
                  <ol style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13, color: 'var(--color-text-secondary)', columns: agendaItems.length > 3 ? 2 : 1, columnGap: 24 }}>
                    {agendaItems.map((a, i) => <li key={i}>{a}</li>)}
                  </ol>
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
              {nextUpEvent && <Button variant="secondary" size="sm" onClick={() => downloadIcs(nextUpEvent)}>Add to my calendar</Button>}
              {isAdmin && nextUpEvent && <Button variant="secondary" size="sm" onClick={() => handleRun(nextUpEvent.id)}>Mark as held</Button>}
            </div>
          </section>
        );
      })()}

      {/* Filters */}
      {events.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            aria-label="Filter by type"
            style={{ ...selectStyle, width: 'auto', minWidth: 150 }}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{prettyLabel(t)}</option>)}
          </select>
          <select
            aria-label="Filter by cadence"
            style={{ ...selectStyle, width: 'auto', minWidth: 130 }}
            value={filterCadence}
            onChange={(e) => setFilterCadence(e.target.value)}
          >
            <option value="">All repeats</option>
            {CADENCES.map((c) => <option key={c} value={c}>{prettyLabel(c)}</option>)}
          </select>
          <select
            aria-label="Filter by status"
            style={{ ...selectStyle, width: 'auto', minWidth: 120 }}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{prettyLabel(s)}</option>)}
          </select>
          {hasActiveFilters && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setFilterType(''); setFilterCadence(''); setFilterStatus(''); }}
            >
              Clear Filters
            </Button>
          )}
          {hasActiveFilters && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Showing {filteredEvents.length} of {events.length}
            </span>
          )}
        </div>
      )}

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <main style={{ flex: '999 1 540px', minWidth: 0 }}>
            {viewMode === 'calendar' ? (
              /* ── Month grid view ── */
              <Card padding={0} shadow="none" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{calMonthLabel}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button variant="secondary" size="sm" onClick={prevMonth} aria-label="Previous month">&larr;</Button>
                    <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
                    <Button variant="secondary" size="sm" onClick={nextMonth} aria-label="Next month">&rarr;</Button>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: 640 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                        <div key={d} style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--color-border)' }}>{d}</div>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                      {calendarDays.map((cell, idx) => {
                        const isToday = cell.date != null && calYear === new Date().getFullYear() && calMonth === new Date().getMonth() && cell.date === new Date().getDate();
                        return (
                          <div key={idx} style={{
                            minHeight: 84, padding: '6px 8px',
                            borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid var(--color-border)',
                            borderBottom: '1px solid var(--color-border)',
                            background: cell.date == null ? 'var(--color-bg)' : 'var(--color-surface)',
                          }}>
                            {cell.date != null && (
                              <>
                                <span style={{
                                  display: 'inline-flex', width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
                                  borderRadius: 12, fontSize: 13, fontWeight: isToday ? 700 : 500,
                                  color: isToday ? '#fff' : 'var(--color-text)', background: isToday ? 'var(--color-primary)' : 'transparent',
                                }}>{cell.date}</span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                                  {cell.events.slice(0, 3).map((ev) => {
                                    const colors = EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.CUSTOM;
                                    return (
                                      <div key={ev.id} title={`${ev.name} (${prettyLabel(ev.eventType)}) — ${ev.timeOfDay}`}
                                        {...clickable(() => setViewingId(ev.id), { label: `Open ${ev.name}` })}
                                        style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 6, cursor: 'pointer', background: colors.bg, color: colors.color, borderLeft: `3px solid ${colors.color}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ev.timeOfDay} {ev.name}
                                      </div>
                                    );
                                  })}
                                  {cell.events.length > 3 && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 500 }}>+{cell.events.length - 3} more</div>}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              /* ── List view ── */
              <Card padding={0} shadow="none" style={{ overflow: 'hidden' }}>
                {loading ? (
                  <SkeletonRows rows={5} columns={6} />
                ) : events.length === 0 && !showForm ? (
                  <EmptyState
                    icon={renderNavIcon('/governance-calendar')}
                    title="No governance events yet"
                    description="Set up recurring councils, committees, and reviews. Seed standard events or add your own."
                    action={isAdmin ? { label: 'Seed standard events', onClick: handleSeed } : undefined}
                  />
                ) : filteredEvents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)', fontSize: 13 }}>No events match the current filters.</div>
                ) : (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        rows={filteredEvents}
                        columns={calendarColumns}
                        rowKey={(e) => e.id}
                        selection={isAdmin ? sel : undefined}
                        selectAllLabel="Select all events"
                        emptyMessage="No events match the current filters."
                        onRowClick={(ev) => setViewingId(ev.id)}
                      />
                    </div>
                    {isAdmin && events.length <= 1 && !hasActiveFilters && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
                        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Only one recurring event so far. Most programs also run a monthly stewardship sync and a quarterly policy review.</span>
                        <Button variant="secondary" size="sm" onClick={handleSeed}>Add standard events</Button>
                      </div>
                    )}
                  </>
                )}
              </Card>
            )}
          </main>

          {/* Rail — compact next-30 list + automation. */}
          <aside style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card>
              <SectionLabel marginBottom={10}>Next 30 days · {upcoming.length}</SectionLabel>
              {loading ? (
                <SkeletonRows rows={4} columns={1} />
              ) : upcoming.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>Nothing scheduled in the next 30 days.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {upcoming.map((o, i) => {
                    const d = parseLocalDate(o.occursAt);
                    return (
                      <li key={`${o.eventId}-${i}`} {...clickable(() => setViewingId(o.eventId), { label: `Open ${o.name}` })}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)', cursor: 'pointer' }}>
                        <span style={{ flex: 'none', width: 44, textAlign: 'center' }}>
                          <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{d ? MON_SHORT[d.getMonth()].toUpperCase() : ''}</span>
                          <span style={{ display: 'block', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{d ? d.getDate() : '—'}</span>
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>{o.timeOfDay} · {formatDaysAway(localDaysAway(o.occursAt))}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            {nextUpEvent && (
              <Card>
                <SectionLabel marginBottom={8}>Automation</SectionLabel>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                  Auto-create tasks is <strong style={{ fontWeight: 600, color: 'var(--color-text)' }}>{nextUpEvent.autoCreateTasks ? 'on' : 'off'}</strong> for {nextUpEvent.name}.{' '}
                  {nextUpEvent.autoCreateTasks ? 'A governance task is raised for each occurrence.' : 'Turn it on to raise a governance task for each occurrence.'}
                </p>
                <div style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => setViewingId(nextUpEvent.id)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}>Change in event settings</button>
                </div>
              </Card>
            )}
          </aside>
        </div>
      )}

      {/* Event detail modal — opened on row click (list) or event-chip click
       *  (calendar). The event's schedule summary with a view→Edit→Save editor.
       *  Looked up fresh from state so it stays current after a save/refetch. */}
      {(() => {
        const ev = viewingId ? events.find((e) => e.id === viewingId) : null;
        if (!ev) return null;
        return (
          <Modal
            open
            onClose={() => setViewingId(null)}
            kicker="Calendar event"
            title={ev.name}
            subtitle={formatTypeLabel(ev.eventType)}
            size="lg"
          >
            <ExpandedEvent event={ev} people={people} canWrite={isAdmin} orgId={activeOrgId} onSaved={fetchData} />
          </Modal>
        );
      })()}
    </div>
  );
}
