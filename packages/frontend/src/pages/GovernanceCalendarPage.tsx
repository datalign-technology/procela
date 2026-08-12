import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import SectionCard from '../components/SectionCard';
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

const EVENT_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  COUNCIL_MEETING:     { bg: '#ede9fe', color: '#5b21b6' }, // purple
  COMMITTEE_MEETING:   { bg: '#dbeafe', color: '#1e40af' }, // blue
  STEWARDSHIP_SYNC:    { bg: '#ccfbf1', color: '#115e59' }, // teal
  POLICY_REVIEW:       { bg: '#fef3c7', color: '#92400e' }, // amber
  MATURITY_ASSESSMENT: { bg: '#ffedd5', color: '#9a3412' }, // orange
  CUSTOM:              { bg: '#f3f4f6', color: '#6b7280' }, // gray
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  ACTIVE: { bg: '#d1fae5', color: '#065f46' },
  PAUSED: { bg: '#fee2e2', color: '#991b1b' },
};

function badgeStyle(colors: { bg: string; color: string }): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color, whiteSpace: 'nowrap',
  };
}

function formatTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

function formatOccurrence(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDaysAway(days: number): string {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// ── Component ──

export default function GovernanceCalendarPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingOccurrence[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(emptyForm);
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

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setForm(emptyForm); setEditingId(null); setShowForm(true); };

  const openEdit = (e: CalendarEvent) => {
    setForm({
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
    });
    setEditingId(e.id);
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const handleSave = async () => {
    if (!eventValidation.validateAll(form)) return;
    try {
      const dayOfMonthNum = form.dayOfMonth.trim() === '' ? null : parseInt(form.dayOfMonth, 10);
      const dayOfWeekNum = form.dayOfWeek.trim() === '' ? null : parseInt(form.dayOfWeek, 10);
      const durationNum = parseInt(form.durationMinutes, 10);

      const payload: any = {
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
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      };

      if (editingId) {
        await apiClient.put(`/governance-calendar/${editingId}`, payload);
        addToast('success', 'Event updated');
      } else {
        await apiClient.post('/governance-calendar', payload);
        addToast('success', 'Event created');
      }
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

  const toggleAttendee = (id: string) => {
    setForm((f) => ({
      ...f,
      attendees: f.attendees.includes(id)
        ? f.attendees.filter((a) => a !== id)
        : [...f.attendees, id],
    }));
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
      key: 'name', header: 'Name', cellStyle: { fontWeight: 500, color: 'var(--color-primary)' },
      render: (ev) => (
        <>
          {ev.name}
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
      render: (ev) => (
        <span style={badgeStyle(EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.CUSTOM)}>
          {formatTypeLabel(ev.eventType)}
        </span>
      ),
    },
    { key: 'cadence', header: 'Cadence', render: (ev) => formatTypeLabel(ev.cadence) },
    { key: 'next', header: 'Next', render: (ev) => formatOccurrence(ev.nextOccurrence) },
    {
      key: 'status', header: 'Status',
      render: (ev) => (
        <span style={badgeStyle(STATUS_COLORS[ev.status] || STATUS_COLORS.ACTIVE)}>
          {ev.status}
        </span>
      ),
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const, width: 140,
      render: (ev) => (
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {canWrite && <IconButton size="sm" icon="check" label="Mark occurrence done" onClick={() => handleRun(ev.id)} />}
          <IconButton size="sm" icon="download" label="Add to calendar (.ics)" onClick={() => downloadIcs(ev)} />
          {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(ev)} />}
          {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(ev.id)} />}
        </div>
      ),
    },
  ];

  return (
    <div>

      <PageHeader
        title="Governance Calendar"
        subtitle="Recurring events and activities that keep your program running."
        actions={<>
          {events.length > 0 && (
            <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
              <button onClick={() => setViewMode('list')} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
                background: viewMode === 'list' ? 'var(--color-primary)' : 'var(--color-surface)',
                color: viewMode === 'list' ? '#fff' : 'var(--color-text)',
              }}>List</button>
              <button onClick={() => setViewMode('calendar')} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
                borderLeft: '1px solid var(--color-border)',
                background: viewMode === 'calendar' ? 'var(--color-primary)' : 'var(--color-surface)',
                color: viewMode === 'calendar' ? '#fff' : 'var(--color-text)',
              }}>Calendar</button>
            </div>
          )}
          {canWrite && events.length === 0 && (
            <Button variant="secondary" onClick={handleSeed}>Seed Standard Events</Button>
          )}
          {canWrite && <IconButton icon="plus" label="Add event" variant="primary" onClick={openAdd} />}
        </>}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Event?"
        message="This will permanently delete this calendar event."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Add/Edit Form */}
      {showForm && (
        <SectionCard title={editingId ? 'Edit Event' : 'Add New Event'}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Name *</label>
              <input
                autoFocus
                style={{ ...inputStyle, border: eventValidation.fieldError('name') ? inputErrorBorder : inputStyle.border }}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => { eventValidation.touch('name'); eventValidation.validateField('name', form.name, form); }}
                placeholder="e.g. Data Governance Council Meeting"
              />
              {eventValidation.fieldError('name') && <div style={fieldErrorStyle}>{eventValidation.fieldError('name')}</div>}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Description</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label style={labelStyle}>Event Type</label>
              <select
                style={selectStyle}
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value })}
              >
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{formatTypeLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cadence</label>
              <select
                style={selectStyle}
                value={form.cadence}
                onChange={(e) => setForm({ ...form, cadence: e.target.value })}
              >
                {CADENCES.map((c) => <option key={c} value={c}>{formatTypeLabel(c)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Day of Month (1-31)</label>
              <input
                type="number"
                min={1}
                max={31}
                style={inputStyle}
                value={form.dayOfMonth}
                onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                placeholder="For monthly+ cadences"
              />
            </div>
            <div>
              <label style={labelStyle}>Day of Week (0=Sun)</label>
              <input
                type="number"
                min={0}
                max={6}
                style={inputStyle}
                value={form.dayOfWeek}
                onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}
                placeholder="For weekly cadences"
              />
            </div>
            <div>
              <label style={labelStyle}>Time of Day (HH:MM)</label>
              <input
                style={inputStyle}
                value={form.timeOfDay}
                onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
                placeholder="14:00"
              />
            </div>
            <div>
              <label style={labelStyle}>Duration (minutes)</label>
              <input
                type="number"
                min={5}
                style={inputStyle}
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select
                style={selectStyle}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'PAUSED' })}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
              <input
                type="checkbox"
                id="autoCreateTasks"
                checked={form.autoCreateTasks}
                onChange={(e) => setForm({ ...form, autoCreateTasks: e.target.checked })}
              />
              <label htmlFor="autoCreateTasks" style={{ fontSize: 12, fontWeight: 500 }}>
                Auto-create governance tasks each occurrence
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Attendees</label>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8,
                border: '1px solid var(--color-border)', borderRadius: 4,
                maxHeight: 140, overflowY: 'auto', background: 'var(--color-surface)',
              }}>
                {people.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No people defined yet.</span>
                )}
                {people.map((p) => {
                  const selected = form.attendees.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleAttendee(p.id)}
                      style={{
                        padding: '4px 10px', fontSize: 12, borderRadius: 12, cursor: 'pointer',
                        border: '1px solid',
                        borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                        background: selected ? 'var(--color-primary)' : 'var(--color-bg)',
                        color: selected ? '#fff' : 'var(--color-text)',
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Agenda Template</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                value={form.agendaTemplate}
                onChange={(e) => setForm({ ...form, agendaTemplate: e.target.value })}
                placeholder="1. Program status&#10;2. Open items&#10;3. Decisions"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Event'}
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

      {/* Filters */}
      {events.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            style={{ ...selectStyle, width: 'auto', minWidth: 150 }}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All Types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{formatTypeLabel(t)}</option>)}
          </select>
          <select
            style={{ ...selectStyle, width: 'auto', minWidth: 130 }}
            value={filterCadence}
            onChange={(e) => setFilterCadence(e.target.value)}
          >
            <option value="">All Cadences</option>
            {CADENCES.map((c) => <option key={c} value={c}>{formatTypeLabel(c)}</option>)}
          </select>
          <select
            style={{ ...selectStyle, width: 'auto', minWidth: 120 }}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
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
      ) : viewMode === 'calendar' ? (
        /* ── Calendar Grid View ── */
        <Card padding={0} shadow="none" style={{ overflow: 'hidden' }}>
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
            <Button variant="secondary" size="sm" onClick={prevMonth}>&larr;</Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{calMonthLabel}</span>
              <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
            </div>
            <Button variant="secondary" size="sm" onClick={nextMonth}>&rarr;</Button>
          </div>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--color-border)' }}>
                {d}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {calendarDays.map((cell, idx) => {
              const isToday = cell.date != null && calYear === new Date().getFullYear() && calMonth === new Date().getMonth() && cell.date === new Date().getDate();
              return (
                <div key={idx} style={{
                  minHeight: 90, padding: '4px 6px',
                  borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid var(--color-border)',
                  borderBottom: '1px solid var(--color-border)',
                  background: cell.date == null ? 'var(--color-bg)' : isToday ? '#eff6ff' : 'var(--color-surface)',
                  opacity: cell.date == null ? 0.4 : 1,
                }}>
                  {cell.date != null && (
                    <>
                      <div style={{
                        fontSize: 12, fontWeight: isToday ? 700 : 500, marginBottom: 4,
                        color: isToday ? 'var(--color-primary)' : 'var(--color-text)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto',
                        borderRadius: isToday ? '50%' : 0,
                        background: isToday ? 'var(--color-primary)' : 'transparent',
                        ...(isToday ? { color: '#fff' } : {}),
                      }}>
                        {cell.date}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {cell.events.slice(0, 3).map((ev) => {
                          const colors = EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.CUSTOM;
                          return (
                            <div key={ev.id} title={`${ev.name} (${formatTypeLabel(ev.eventType)}) — ${ev.timeOfDay}`}
                              {...clickable(() => openEdit(ev), { label: `Edit ${ev.name}` })}
                              style={{
                                fontSize: 10, fontWeight: 500, padding: '1px 4px', borderRadius: 3, cursor: 'pointer',
                                background: colors.bg, color: colors.color,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                              {ev.name}
                            </div>
                          );
                        })}
                        {cell.events.length > 3 && (
                          <div style={{ fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 500 }}>+{cell.events.length - 3} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        /* ── List View (original two-column layout) ── */
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Upcoming panel */}
          <Card>
            <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 12 }}>
              Upcoming (next 30 days)
            </h3>
            {loading ? (
              <SkeletonRows rows={4} columns={1} />
            ) : upcoming.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                Nothing scheduled in the next 30 days.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {upcoming.map((o, i) => (
                  <li
                    key={`${o.eventId}-${i}`}
                    style={{
                      padding: 10, border: '1px solid var(--color-border)',
                      borderRadius: 4, background: 'var(--color-bg)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{o.name}</div>
                      <span style={badgeStyle(EVENT_TYPE_COLORS[o.eventType] || EVENT_TYPE_COLORS.CUSTOM)}>
                        {formatTypeLabel(o.eventType)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {formatOccurrence(o.occursAt)} &middot; {o.timeOfDay} &middot; {formatTypeLabel(o.cadence)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2, fontWeight: 500 }}>
                      {formatDaysAway(o.daysAway)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* All events table */}
          <Card padding={0} shadow="none" style={{ overflow: 'auto' }}>
            {loading ? (
              <SkeletonRows rows={5} columns={6} />
            ) : events.length === 0 && !showForm ? (
              <EmptyState
                icon={renderNavIcon('/governance-calendar')}
                title="No governance events yet"
                description="Set up recurring councils, committees, and reviews. Seed standard events or add your own."
                action={canWrite ? { label: 'Seed Standard Events', onClick: handleSeed } : undefined}
              />
            ) : filteredEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)', fontSize: 13 }}>
                No events match the current filters.
              </div>
            ) : (
              <DataTable
                rows={filteredEvents}
                columns={calendarColumns}
                rowKey={(e) => e.id}
                selection={sel}
                selectAllLabel="Select all events"
                emptyMessage="No events match the current filters."
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
