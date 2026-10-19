import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage, successToast, errorToast } from '../lib/errorToast';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { HeaderEditActions } from '../components/DetailEditActions';
import EmbeddablePageHeader from '../components/EmbeddablePageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import Button from '../components/Button';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { useSortedList } from '../hooks/useSortedList';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import Avatar from '../components/Avatar';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuthStore } from '../stores/authStore';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';
import { SkeletonRows } from '../components/Skeleton';
import { formatPersonLabel } from '../lib/personLabel';
import { useRefreshOnFocus } from '../hooks/usePolling';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceTasksPage — full CRUD list page for governance tasks. Supports
// filtering, sorting, bulk selection, status transitions, and inline
// add/edit form. Embedded inside GovernanceWorkPage as a tab.
// ──────────────────────────────────────────────────────────────────────────

// ── Types ──

export interface GovernanceTask {
  id: string;
  orgId: string;
  title: string;
  description: string;
  taskType: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  automationMode: string;
  linkedObjectType: string | null;
  linkedObjectId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Person {
  id: string;
  name: string;
}

interface FormData {
  title: string;
  description: string;
  taskType: string;
  priority: string;
  assigneeId: string;
  dueDate: string;
  automationMode: string;
  linkedObjectType: string;
  linkedObjectId: string;
}

const emptyForm: FormData = {
  title: '', description: '', taskType: 'REVIEW', priority: 'MEDIUM',
  assigneeId: '', dueDate: '', automationMode: 'HUMAN',
  linkedObjectType: '', linkedObjectId: '',
};

// ── Constants ──

export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const TASK_TYPES = ['REVIEW', 'APPROVAL', 'REMEDIATION', 'CERTIFICATION', 'DATA_QUALITY', 'POLICY_UPDATE', 'OTHER'] as const;
const AUTOMATION_MODES = ['HUMAN', 'AGENT', 'HYBRID'] as const;

export const STATUS_TRANSITIONS: Record<string, { label: string; target: string; style: 'primary' | 'secondary' | 'danger' }[]> = {
  OPEN:        [{ label: 'Start', target: 'IN_PROGRESS', style: 'primary' }, { label: 'Cancel', target: 'CANCELLED', style: 'danger' }],
  IN_PROGRESS: [{ label: 'Complete', target: 'COMPLETED', style: 'primary' }, { label: 'Cancel', target: 'CANCELLED', style: 'danger' }],
  COMPLETED:   [{ label: 'Reopen', target: 'OPEN', style: 'secondary' }],
  CANCELLED:   [{ label: 'Reopen', target: 'OPEN', style: 'secondary' }],
};

// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

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

// ── Badge helpers ──
// Dotted pills (leading status dot) matching the rest of the governance
// surface. Priority runs a cool→warm ramp; status uses the shared slate /
// blue / green set.

export const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  OPEN:        { bg: '#e5ecf3', color: '#364a5e' }, // slate — not started
  IN_PROGRESS: { bg: '#e6eef9', color: '#24508f' }, // blue — underway
  COMPLETED:   { bg: '#dcefe5', color: '#17604b' }, // green — done
  CANCELLED:   { bg: '#eef0f2', color: '#6b7280' }, // muted grey
};

export const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  LOW:      { bg: '#e5ecf3', color: '#364a5e' }, // slate
  MEDIUM:   { bg: '#e6eef9', color: '#24508f' }, // blue
  HIGH:     { bg: '#fbe9d9', color: '#9a4a0e' }, // amber
  CRITICAL: { bg: '#fbe4e4', color: '#9a1c1c' }, // red
};

export const MODE_COLORS: Record<string, { bg: string; color: string }> = {
  HUMAN:  { bg: '#e6eef9', color: '#24508f' },
  AGENT:  { bg: '#ede9fe', color: '#5b21b6' },
  HYBRID: { bg: '#ccfbf1', color: '#115e59' },
};

// Sentence-case a SCREAMING_SNAKE code: "IN_PROGRESS" → "In progress".
export function prettyLabel(code: string): string {
  const s = (code || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A sentence-case pill with a leading status dot. OPEN (not-yet-started) wears
// a hollow dot so an open task doesn't read as an active/closed state.
export function dotPill(colors: { bg: string; color: string }, label: string, hollow = false): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: colors.bg, color: colors.color }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: hollow ? 'transparent' : colors.color, boxShadow: hollow ? `inset 0 0 0 1.5px ${colors.color}` : undefined }} />{label}
    </span>
  );
}

type TaskColId = 'title' | 'type' | 'status' | 'priority' | 'assignee' | 'dueDate' | 'mode';
const TASK_COLUMN_DEFS: Array<{ id: TaskColId; label: string; defaultVisible: boolean }> = [
  { id: 'title',    label: 'Title',    defaultVisible: true  },
  { id: 'type',     label: 'Type',     defaultVisible: false },
  { id: 'status',   label: 'Status',   defaultVisible: true  },
  { id: 'priority', label: 'Priority', defaultVisible: true  },
  { id: 'assignee', label: 'Assignee', defaultVisible: true  },
  { id: 'dueDate',  label: 'Due Date', defaultVisible: true  },
  { id: 'mode',     label: 'Mode',     defaultVisible: false },
];

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

export function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Whole days from today to a due date, local calendar day (a date-only ISO is
// otherwise read as UTC midnight and lands a day early behind UTC).
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// "Overdue 3 days" / "Due today" / "in 3 days" — the urgency cue the US
// numeric date alone never gave. null for no due date.
export function relativeDue(iso: string | null): string | null {
  const n = daysUntil(iso);
  if (n == null) return null;
  if (n < 0) return `Overdue ${-n} day${n === -1 ? '' : 's'}`;
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return `in ${n} days`;
}

// Shared task field grid — used by both the top-of-page "Add" form (create)
// and the in-row editor (edit), so the two never drift. Status is deliberately
// absent: it's driven by the row's transition buttons, not a form field.
function TaskFields({ form, setForm, people }: {
  form: FormData;
  setForm: (next: FormData) => void;
  people: Person[];
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Title *</label>
        <input
          aria-label="Title"
          style={inputStyle}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Review customer data quality report"
        />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Description</label>
        <textarea
          aria-label="Description"
          style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe the task in detail..."
        />
      </div>
      <div>
        <label style={labelStyle}>Type</label>
        <select aria-label="Type" style={selectStyle} value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
          {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Priority</label>
        <select aria-label="Priority" style={selectStyle} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Assignee</label>
        <select aria-label="Assignee" style={selectStyle} value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
          <option value="">-- Unassigned --</option>
          {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Due Date</label>
        <input type="date" aria-label="Due Date" style={inputStyle} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
      </div>
      <div>
        <label style={labelStyle}>Automation Mode</label>
        <select aria-label="Automation Mode" style={selectStyle} value={form.automationMode} onChange={(e) => setForm({ ...form, automationMode: e.target.value })}>
          {AUTOMATION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  );
}

// The expanded row: read-only detail with a view/edit toggle. Edit flips the
// SAME panel into the field grid and one Save writes PUT /governance-tasks/:id
// — the row's own in-place editor (there's no separate edit form anymore).
export function ExpandedTask({ task, people, orgId, canEdit, onSaved, actionsSlot, hideMeta }: {
  task: GovernanceTask;
  people: Person[];
  orgId: string | null;
  canEdit: boolean;
  onSaved: () => void;
  /** When set, the Edit / Save·Cancel cluster renders into the page header's
   *  actions slot (the detail-page placement) instead of inline. */
  actionsSlot?: HTMLElement | null;
  /** Hide the bottom linked/created/updated meta row — the detail page owns
   *  those facts in its rail, so they'd otherwise duplicate. */
  hideMeta?: boolean;
}) {
  const m = useDetailEditMode<FormData>(
    {
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      priority: task.priority,
      assigneeId: task.assigneeId || '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      automationMode: task.automationMode,
      linkedObjectType: task.linkedObjectType || '',
      linkedObjectId: task.linkedObjectId || '',
    },
    async (draft) => {
      if (!draft.title.trim()) { errorToast(null, 'Title is required'); throw new Error('no-title'); }
      try {
        await apiClient.put(`/governance-tasks/${task.id}`, {
          ...draft,
          assigneeId: draft.assigneeId || null,
          dueDate: draft.dueDate || null,
          linkedObjectType: draft.linkedObjectType || null,
          linkedObjectId: draft.linkedObjectId || null,
          ...(orgId ? { orgId } : {}),
        });
        successToast('Task updated');
        onSaved();
      } catch (err) { errorToast(err, 'Failed to update task'); throw err; }
    },
  );
  return (
    <div>
      <HeaderEditActions slot={actionsSlot} editing={m.isEditing} canEdit={canEdit} dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
      {m.isEditing ? (
        <TaskFields form={m.draft} setForm={(next) => m.patch(next)} people={people} />
      ) : (
        <>
          <SectionLabel marginBottom={6}>Description</SectionLabel>
          <div style={{ fontSize: 12, color: task.description ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', fontStyle: task.description ? undefined : 'italic', whiteSpace: 'pre-wrap', marginBottom: hideMeta ? 0 : 12 }}>
            {task.description || 'No description provided.'}
          </div>
          {!hideMeta && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 11 }}>
              {task.linkedObjectType && (
                <div><span style={{ color: 'var(--color-text-muted)' }}>Linked to </span><span style={{ fontWeight: 500 }}>{task.linkedObjectType.replace(/_/g, ' ').toLowerCase()}</span></div>
              )}
              <div><span style={{ color: 'var(--color-text-muted)' }}>Created </span><span style={{ fontWeight: 500 }}>{fmtDate(task.createdAt)}</span></div>
              <div><span style={{ color: 'var(--color-text-muted)' }}>Updated </span><span style={{ fontWeight: 500 }}>{fmtDate(task.updatedAt)}</span></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Component ──

export default function GovernanceTasksPage({
  embedded = false,
  actionsPortal,
}: {
  embedded?: boolean;
  actionsPortal?: HTMLElement | null;
} = {}) {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const { isAdmin } = usePermissions();
  const { addToast } = useToastStore();
  const currentUser = useAuthStore((s) => s.user);

  const taskCols = useColumnPicker<TaskColId>('procela.governanceTasks.visibleCols.v1', TASK_COLUMN_DEFS);
  const [tasks, setTasks] = useState<GovernanceTask[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  // Row click opens a task's full detail on its own page (/governance-work/
  // tasks/:id), matching the People detail-page family.

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  // One-click "needs attention" lens: 'overdue' | 'dueThisWeek' | 'highPriority'.
  const [attention, setAttention] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Close the row ⋯ menu on any outside click.
  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [tasksRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceTask[] }>(`/governance-tasks${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setTasks(tasksRes.data || []);
      setPeople(peopleRes.data || []);
    } catch (err) { setLoadError(errorMessage(err, 'Failed to load governance tasks.')); }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  // The current user's person record (best-effort name match), so "Assigned to
  // me" works without a server-side me→person link.
  const myPersonId = currentUser ? (people.find((p) => p.name === currentUser.name)?.id ?? null) : null;
  const isMine = (t: GovernanceTask) =>
    (myPersonId != null && t.assigneeId === myPersonId) ||
    (!!currentUser && !!t.assigneeName && t.assigneeName === currentUser.name);

  const isOpenish = (t: GovernanceTask) => t.status === 'OPEN' || t.status === 'IN_PROGRESS';

  // ── Needs-attention counts (over the full task set, open work only) ──
  const overdueCount = tasks.filter((t) => isOpenish(t) && (daysUntil(t.dueDate) ?? 99) < 0).length;
  const dueThisWeekCount = tasks.filter((t) => {
    const n = daysUntil(t.dueDate);
    return isOpenish(t) && n != null && n >= 0 && n <= 7;
  }).length;
  const highPriorityCount = tasks.filter((t) => isOpenish(t) && (t.priority === 'HIGH' || t.priority === 'CRITICAL')).length;

  const matchesAttention = (t: GovernanceTask) => {
    if (!attention) return true;
    if (!isOpenish(t)) return false;
    if (attention === 'overdue') return (daysUntil(t.dueDate) ?? 99) < 0;
    if (attention === 'dueThisWeek') { const n = daysUntil(t.dueDate); return n != null && n >= 0 && n <= 7; }
    if (attention === 'highPriority') return t.priority === 'HIGH' || t.priority === 'CRITICAL';
    return true;
  };

  // ── Filtering ──
  const filtered = tasks.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterType && t.taskType !== filterType) return false;
    if (filterAssignee && t.assigneeId !== filterAssignee) return false;
    if (assignedToMe && !isMine(t)) return false;
    if (!matchesAttention(t)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Compact assignee options: only people who actually own a task, deduped by
  // id — avoids the full directory (and the duplicate-name confusion) in the
  // filter dropdown.
  const assigneeOptions = Array.from(
    new Map(tasks.filter((t) => t.assigneeId).map((t) => [t.assigneeId as string, t.assigneeName || 'Unknown'])).entries(),
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  // ── Sorting ──
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    filtered,
    {
      title:    (a, b) => a.title.localeCompare(b.title),
      type:     (a, b) => a.taskType.localeCompare(b.taskType),
      status:   (a, b) => a.status.localeCompare(b.status),
      priority: (a, b) => {
        const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (order[a.priority as keyof typeof order] ?? 4) - (order[b.priority as keyof typeof order] ?? 4);
      },
      assignee: (a, b) => (a.assigneeName || '').localeCompare(b.assigneeName || ''),
      // Soonest-due first; tasks with no due date sort to the bottom.
      dueDate:  (a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      },
      mode:     (a, b) => a.automationMode.localeCompare(b.automationMode),
    },
    'dueDate',
  );

  const sel = useRowSelection(sorted, (t) => t.id);

  // ── CRUD ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm);
  };

  // Create-only: existing tasks are edited inside their row's expanded detail.
  const handleSave = async () => {
    if (!form.title.trim()) return;
    try {
      const payload = {
        ...form,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        linkedObjectType: form.linkedObjectType || null,
        linkedObjectId: form.linkedObjectId || null,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      };
      await apiClient.post('/governance-tasks', payload);
      addToast('success', 'Task created');
      closeForm();
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e?.response?.data?.error || errorMessage(err, 'Failed to save task');
      addToast('error', msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-tasks/${id}`);
      addToast('success', 'Task deleted');
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to delete task'));
    }
  };

  const handleStatusTransition = async (taskId: string, newStatus: string) => {
    try {
      await apiClient.put(`/governance-tasks/${taskId}`, { status: newStatus });
      addToast('success', `Task status changed to ${newStatus.replace(/_/g, ' ')}`);
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to update status'));
    }
  };

  // ── Bulk select ──
  const handleBulkDelete = async () => {
    if (sel.count === 0) return;
    try {
      await Promise.all(Array.from(sel.selectedIds).map((id) => apiClient.delete(`/governance-tasks/${id}`)));
      addToast('success', `Deleted ${sel.count} task${sel.count === 1 ? '' : 's'}`);
      sel.clear();
      fetchData();
    } catch {
      addToast('error', 'Some tasks could not be deleted');
      fetchData();
    }
  };

  // ── Helpers ──
  const isOverdue = (t: GovernanceTask) => {
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return false;
    return (daysUntil(t.dueDate) ?? 99) < 0;
  };

  const taskColumns = ([
    taskCols.isVisible('title') && {
      key: 'title', header: 'Task', sortable: true,
      render: (t: GovernanceTask) => {
        // Sub-line: task type, and the item it's attached to when linked.
        const sub = t.linkedObjectType
          ? `${prettyLabel(t.taskType)} · on ${prettyLabel(t.linkedObjectType)}`
          : prettyLabel(t.taskType);
        return (
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={() => navigate(`/governance-work/tasks/${t.id}`)}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', cursor: 'pointer', font: 'inherit', fontWeight: 600, textAlign: 'left', display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {t.title}
            </button>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
          </div>
        );
      },
    },
    taskCols.isVisible('type') && {
      key: 'type', header: 'Type', sortable: true,
      render: (t: GovernanceTask) => <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{prettyLabel(t.taskType)}</span>,
    },
    taskCols.isVisible('status') && {
      key: 'status', header: 'Status', sortable: true,
      render: (t: GovernanceTask) => dotPill(STATUS_COLORS[t.status] || STATUS_COLORS.OPEN, prettyLabel(t.status), t.status === 'OPEN'),
    },
    taskCols.isVisible('priority') && {
      key: 'priority', header: 'Priority', sortable: true,
      render: (t: GovernanceTask) => dotPill(PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.LOW, prettyLabel(t.priority)),
    },
    taskCols.isVisible('assignee') && {
      key: 'assignee', header: 'Assignee', sortable: true,
      render: (t: GovernanceTask) => (
        t.assigneeName ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Avatar name={t.assigneeName} size="sm" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.assigneeName}</span>
          </span>
        ) : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>
      ),
    },
    taskCols.isVisible('dueDate') && {
      key: 'dueDate', header: 'Due', sortable: true,
      render: (t: GovernanceTask) => {
        if (!t.dueDate) return <span style={{ color: 'var(--color-text-muted)' }}>No due date</span>;
        const rel = relativeDue(t.dueDate);
        const overdue = isOverdue(t);
        const soon = !overdue && (daysUntil(t.dueDate) ?? 99) <= 7 && t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
        return (
          <div style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(t.dueDate)}</span>
            {rel && (
              <span style={{ display: 'block', fontSize: 11, fontWeight: overdue ? 700 : 500, color: overdue ? 'var(--color-error)' : soon ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>{rel}</span>
            )}
          </div>
        );
      },
    },
    taskCols.isVisible('mode') && {
      key: 'mode', header: 'Mode', sortable: true,
      render: (t: GovernanceTask) => dotPill(MODE_COLORS[t.automationMode] || MODE_COLORS.HUMAN, prettyLabel(t.automationMode)),
    },
    {
      key: 'actions', header: '', align: 'center' as const, width: 150,
      render: (t: GovernanceTask) => {
        // One primary action (Start / Complete / Reopen) per row; the rest —
        // Cancel, Delete — live in the ⋯ menu so the row isn't a cluster of
        // same-size buttons that are easy to mis-click.
        const trs = STATUS_TRANSITIONS[t.status] || [];
        const primary = trs.find((x) => x.style === 'primary') || trs[0];
        const rest = trs.filter((x) => x !== primary);
        const hasMenu = rest.length > 0 || isAdmin;
        return (
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {primary && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleStatusTransition(t.id, primary.target); }}
                title={`${primary.label} (${prettyLabel(primary.target)})`}
                style={{
                  padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', font: 'inherit',
                  border: primary.style === 'primary' ? 'none' : '1px solid var(--color-border)',
                  background: primary.style === 'primary' ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: primary.style === 'primary' ? '#fff' : 'var(--color-text)',
                }}
              >
                {primary.label}
              </button>
            )}
            {hasMenu && (
              <>
                <button
                  type="button" aria-label="More actions" aria-haspopup="menu"
                  onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === t.id ? null : t.id); }}
                  style={rowMenuBtnStyle}
                >⋯</button>
                {rowMenuId === t.id && (
                  <div role="menu" onClick={(e) => e.stopPropagation()} style={rowMenuStyle}>
                    {rest.map((tr) => (
                      <button
                        key={tr.target} type="button" role="menuitem" style={menuItemStyle}
                        onClick={() => { setRowMenuId(null); handleStatusTransition(t.id, tr.target); }}
                      >{tr.label}</button>
                    ))}
                    <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); navigate(`/governance-work/tasks/${t.id}`); }}>Open &amp; edit</button>
                    {isAdmin && <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); setConfirmDelete(t.id); }}>Delete</button>}
                  </div>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ].filter(Boolean) as DataTableColumn<GovernanceTask>[]);

  return (
    <div>
      {/* Header */}
      <EmbeddablePageHeader
        embedded={embedded}
        actionsPortal={actionsPortal}
        title="Governance Tasks"
        subtitle="Track and manage governance tasks, reviews, and approvals."
        actions={
          <>
            <ColumnPicker state={taskCols} />
            {isAdmin && (
              <Button variant="primary" size="sm" onClick={openAdd}>+ Add task</Button>
            )}
          </>
        }
      />

      {/* Needs attention — one tap filters the list to the work that can't wait. */}
      {tasks.length > 0 && (overdueCount > 0 || dueThisWeekCount > 0 || highPriorityCount > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[
            { key: 'overdue', count: overdueCount, label: 'Overdue', tag: 'Fix first' },
            { key: 'dueThisWeek', count: dueThisWeekCount, label: 'Due this week', tag: '' },
            { key: 'highPriority', count: highPriorityCount, label: 'High priority', tag: '' },
          ].filter((c) => c.count > 0).map((c) => {
            const active = attention === c.key;
            const hint = active ? 'Filtering · tap to clear' : 'Tap to filter';
            return (
              <button
                key={c.key} type="button"
                onClick={() => setAttention(active ? null : c.key)}
                aria-pressed={active}
                style={{
                  textAlign: 'left', cursor: 'pointer', font: 'inherit', borderRadius: 'var(--radius-md)', padding: '12px 14px',
                  display: 'flex', flexDirection: 'column', gap: 3, minHeight: 82, boxSizing: 'border-box',
                  background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
                  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'var(--shadow-sm)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                  {c.tag && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--color-warning)' }}>{c.tag}</span>}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{c.label}</span>
                <span className="na-card-hint" title={hint}>{hint}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters (left-aligned, mirrors Data Assets) */}
      {tasks.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            aria-label="Search tasks" placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
          />
          <select aria-label="Filter by status" style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{prettyLabel(s)}</option>)}
          </select>
          <select aria-label="Filter by priority" style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{prettyLabel(p)}</option>)}
          </select>
          <select aria-label="Filter by type" style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {TASK_TYPES.map((t) => <option key={t} value={t}>{prettyLabel(t)}</option>)}
          </select>
          {assigneeOptions.length > 0 && (
            <select aria-label="Filter by assignee" style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
              <option value="">All assignees</option>
              {assigneeOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {/* Compact "mine" toggle in place of selecting yourself in the dropdown. */}
          <button
            type="button" aria-pressed={assignedToMe}
            onClick={() => setAssignedToMe((v) => !v)}
            disabled={!currentUser}
            style={{
              font: 'inherit', fontSize: 12, fontWeight: 600, cursor: currentUser ? 'pointer' : 'not-allowed',
              padding: '6px 12px', borderRadius: 16,
              background: assignedToMe ? 'var(--color-primary)' : 'var(--color-surface)',
              color: assignedToMe ? '#fff' : 'var(--color-text-secondary)',
              border: `1px solid ${assignedToMe ? 'var(--color-primary)' : 'var(--color-border)'}`,
            }}
          >
            Assigned to me
          </button>
          {(filterStatus || filterPriority || filterType || filterAssignee || assignedToMe || attention || searchQuery) && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setFilterStatus(''); setFilterPriority(''); setFilterType(''); setFilterAssignee(''); setAssignedToMe(false); setAttention(null); setSearchQuery(''); }}
              >
                Clear filters
              </Button>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Showing {filtered.length} of {tasks.length}
              </span>
            </>
          )}
        </div>
      )}

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Task?"
        message="This will permanently delete this governance task. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) await handleDelete(id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Tasks?"
        message={`Delete ${sel.count} selected task${sel.count === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Add/Edit Form */}
      {showForm && (
        <Card padding={20} marginBottom={20}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add New Task</h3>
          {/* Linked Object Type/ID inputs are intentionally absent: the
              user-pickable vocabulary was read by nothing — the values actually
              consumed (dashboard / governance-calendar) are set programmatically
              with their own types. The DB columns + programmatic linkage stay. */}
          <TaskFields form={form} setForm={setForm} people={people} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.title.trim()}
              onClick={handleSave}
            >
              Add Task
            </Button>
          </div>
        </Card>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
        ) : loading ? (
          <SkeletonRows rows={5} columns={9} />
        ) : tasks.length === 0 && !showForm ? (
          <EmptyState
            icon={renderNavIcon('/governance-work')}
            title="No governance tasks yet"
            description="Reviews, approvals, remediations, and other work items are tracked here."
            action={isAdmin ? { label: '+ Add Task', onClick: openAdd } : undefined}
          />
        ) : (
          <DataTable
            rows={sorted}
            columns={taskColumns}
            rowKey={(t) => t.id}
            selection={isAdmin ? sel : undefined}
            sort={{ sortKey, sortDir, onSort: toggleSort }}
            selectAllLabel="Select all tasks"
            emptyMessage="No tasks match the current filters."
            onRowClick={(t) => navigate(`/governance-work/tasks/${t.id}`)}
          />
        )}
      </div>

      {!loading && !loadError && sorted.length > 0 && (
        <p style={{ margin: '10px 2px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {sorted.length} task{sorted.length === 1 ? '' : 's'} shown
          {sortKey === 'dueDate' && ' · sorted by due date'}
        </p>
      )}
    </div>
  );
}
