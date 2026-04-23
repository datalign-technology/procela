import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import PageTabNav, { OPERATE_TABS } from '../components/PageTabNav';

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
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 13, borderTop: '1px solid var(--color-border)',
};
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

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
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
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };

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
    if (!form.name.trim()) return;
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
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to save event');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-calendar/${id}`);
      addToast('success', 'Event deleted');
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to delete event');
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
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to mark occurrence');
    }
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
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to seed events');
    }
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

  const activeCount = useMemo(() => events.filter((e) => e.status === 'ACTIVE').length, [events]);

  const upcomingThisMonth = useMemo(() => {
    const now = new Date();
    const in30 = new Date(now); in30.setDate(in30.getDate() + 30);
    return upcoming.filter((o) => {
      const d = new Date(o.occursAt);
      return d >= now && d <= in30;
    }).length;
  }, [upcoming]);

  return (
    <div>
      <PageTabNav tabs={OPERATE_TABS} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Governance Calendar</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Recurring events and activities that keep your program running.
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
            {activeCount} active event{activeCount === 1 ? '' : 's'} &middot; {upcomingThisMonth} upcoming this month
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canWrite && events.length === 0 && (
            <button style={btnSecondary} onClick={handleSeed}>Seed Standard Events</button>
          )}
          {canWrite && <IconButton icon="plus" label="Add event" variant="primary" onClick={openAdd} />}
        </div>
      </div>

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
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)',
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Event' : 'Add New Event'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Name *</label>
              <input
                autoFocus
                style={inputStyle}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Data Governance Council Meeting"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Description</label>
              <textarea
                style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }}
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
            <button style={btnSecondary} onClick={closeForm}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }}
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Event'}
            </button>
          </div>
        </div>
      )}

      {/* Two-column layout: Upcoming + All */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Upcoming panel */}
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: 16,
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Upcoming (next 30 days)
          </h3>
          {loading ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading...</p>
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
        </div>

        {/* All events table */}
        <div style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)', overflow: 'hidden',
        }}>
          {loading ? (
            <SkeletonRows rows={5} columns={6} />
          ) : events.length === 0 && !showForm ? (
            <EmptyState
              icon={'📅'}
              title="No governance events yet"
              description="Set up recurring councils, committees, and reviews. Seed standard events or add your own."
              action={canWrite ? { label: 'Seed Standard Events', onClick: handleSeed } : undefined}
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Cadence</th>
                  <th style={thStyle}>Next</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, width: 140, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} style={{ transition: 'background 0.1s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                    <td style={{ ...tdStyle, fontWeight: 500, color: 'var(--color-primary)' }}>
                      {ev.name}
                      {ev.attendeeNames.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 2 }}>
                          {ev.attendeeNames.slice(0, 3).join(', ')}
                          {ev.attendeeNames.length > 3 && ` +${ev.attendeeNames.length - 3}`}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={badgeStyle(EVENT_TYPE_COLORS[ev.eventType] || EVENT_TYPE_COLORS.CUSTOM)}>
                        {formatTypeLabel(ev.eventType)}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatTypeLabel(ev.cadence)}</td>
                    <td style={tdStyle}>{formatOccurrence(ev.nextOccurrence)}</td>
                    <td style={tdStyle}>
                      <span style={badgeStyle(STATUS_COLORS[ev.status] || STATUS_COLORS.ACTIVE)}>
                        {ev.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {canWrite && (
                          <IconButton
                            size="sm"
                            icon="check"
                            label="Mark occurrence done"
                            onClick={() => handleRun(ev.id)}
                          />
                        )}
                        {canWrite && (
                          <IconButton
                            size="sm"
                            icon="edit"
                            label="Edit"
                            onClick={() => openEdit(ev)}
                          />
                        )}
                        {canWrite && (
                          <IconButton
                            size="sm"
                            icon="trash"
                            label="Delete"
                            variant="danger"
                            onClick={() => setConfirmDelete(ev.id)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
