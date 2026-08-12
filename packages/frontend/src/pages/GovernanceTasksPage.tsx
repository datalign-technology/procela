import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { useSortedList } from '../hooks/useSortedList';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
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

interface GovernanceTask {
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

const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const TASK_TYPES = ['REVIEW', 'APPROVAL', 'REMEDIATION', 'CERTIFICATION', 'DATA_QUALITY', 'POLICY_UPDATE', 'OTHER'] as const;
const AUTOMATION_MODES = ['HUMAN', 'AGENT', 'HYBRID'] as const;

const STATUS_TRANSITIONS: Record<string, { label: string; target: string; style: 'primary' | 'secondary' | 'danger' }[]> = {
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

// ── Badge helpers ──

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  OPEN:        { bg: '#dbeafe', color: '#1e40af' },
  IN_PROGRESS: { bg: '#fef3c7', color: '#92400e' },
  COMPLETED:   { bg: '#d1fae5', color: '#065f46' },
  CANCELLED:   { bg: '#f3f4f6', color: '#6b7280' },
};

const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  LOW:      { bg: '#f3f4f6', color: '#6b7280' },
  MEDIUM:   { bg: '#dbeafe', color: '#1e40af' },
  HIGH:     { bg: '#fef3c7', color: '#92400e' },
  CRITICAL: { bg: '#fee2e2', color: '#991b1b' },
};

const MODE_COLORS: Record<string, { bg: string; color: string }> = {
  HUMAN:  { bg: '#dbeafe', color: '#1e40af' },
  AGENT:  { bg: '#ede9fe', color: '#5b21b6' },
  HYBRID: { bg: '#ccfbf1', color: '#115e59' },
};

function badge(_text: string, colors: { bg: string; color: string }): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color,
    whiteSpace: 'nowrap',
  };
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

// ── Component ──

export default function GovernanceTasksPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const taskCols = useColumnPicker<TaskColId>('procela.governanceTasks.visibleCols.v1', TASK_COLUMN_DEFS);
  const [tasks, setTasks] = useState<GovernanceTask[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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

  // ── Filtering ──
  const filtered = tasks.filter((t) => {
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterType && t.taskType !== filterType) return false;
    if (filterAssignee && t.assigneeId !== filterAssignee) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

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
      dueDate:  (a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''),
    },
    'title',
  );

  const sel = useRowSelection(sorted, (t) => t.id);

  // ── CRUD ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (task: GovernanceTask) => {
    setForm({
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      priority: task.priority,
      assigneeId: task.assigneeId || '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      automationMode: task.automationMode,
      linkedObjectType: task.linkedObjectType || '',
      linkedObjectId: task.linkedObjectId || '',
    });
    setEditingId(task.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

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
      if (editingId) {
        await apiClient.put(`/governance-tasks/${editingId}`, payload);
        addToast('success', 'Task updated');
      } else {
        await apiClient.post('/governance-tasks', payload);
        addToast('success', 'Task created');
      }
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
    if (!t.dueDate || t.status === 'COMPLETED' || t.status === 'CANCELLED') return false;
    return new Date(t.dueDate) < new Date();
  };

  const formatDate = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleDateString();
  };

  const taskColumns = ([
    taskCols.isVisible('title') && {
      key: 'title', header: 'Title', sortable: true, cellStyle: { fontWeight: 500 },
      render: (t: GovernanceTask) => (
        <>
          <span style={{ color: 'var(--color-primary)' }}>{t.title}</span>
          {isOverdue(t) && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-error)', fontWeight: 600 }}>OVERDUE</span>}
        </>
      ),
    },
    taskCols.isVisible('type') && {
      key: 'type', header: 'Type', sortable: true,
      render: (t: GovernanceTask) => <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t.taskType.replace(/_/g, ' ')}</span>,
    },
    taskCols.isVisible('status') && {
      key: 'status', header: 'Status', sortable: true,
      render: (t: GovernanceTask) => <span style={badge(t.status, STATUS_COLORS[t.status] || { bg: '#f3f4f6', color: '#6b7280' })}>{t.status.replace(/_/g, ' ')}</span>,
    },
    taskCols.isVisible('priority') && {
      key: 'priority', header: 'Priority', sortable: true,
      render: (t: GovernanceTask) => <span style={badge(t.priority, PRIORITY_COLORS[t.priority] || { bg: '#f3f4f6', color: '#6b7280' })}>{t.priority}</span>,
    },
    taskCols.isVisible('assignee') && {
      key: 'assignee', header: 'Assignee', sortable: true,
      render: (t: GovernanceTask) => t.assigneeName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>,
    },
    taskCols.isVisible('dueDate') && {
      key: 'dueDate', header: 'Due Date', sortable: true,
      render: (t: GovernanceTask) => (
        <span style={{ color: isOverdue(t) ? 'var(--color-error)' : undefined, fontWeight: isOverdue(t) ? 600 : undefined }}>{formatDate(t.dueDate)}</span>
      ),
    },
    taskCols.isVisible('mode') && {
      key: 'mode', header: 'Mode',
      render: (t: GovernanceTask) => <span style={badge(t.automationMode, MODE_COLORS[t.automationMode] || { bg: '#f3f4f6', color: '#6b7280' })}>{t.automationMode}</span>,
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const, width: 140,
      render: (t: GovernanceTask) => (
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          {(STATUS_TRANSITIONS[t.status] || []).map((tr) => (
            <button
              key={tr.target}
              onClick={() => handleStatusTransition(t.id, tr.target)}
              title={`${tr.label} (${tr.target.replace(/_/g, ' ')})`}
              style={{
                padding: '2px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
                border: 'none',
                background: tr.style === 'primary' ? 'var(--color-primary)' : tr.style === 'danger' ? '#fee2e2' : 'var(--color-bg)',
                color: tr.style === 'primary' ? '#fff' : tr.style === 'danger' ? '#991b1b' : 'var(--color-text)',
              }}
            >
              {tr.label}
            </button>
          ))}
          {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(t)} />}
          {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(t.id)} />}
        </div>
      ),
    },
  ].filter(Boolean) as DataTableColumn<GovernanceTask>[]);

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Governance Tasks"
        subtitle="Track and manage governance tasks, reviews, and approvals."
        actions={
          <>
            <ColumnPicker state={taskCols} />
            {canWrite && (
              <IconButton icon="plus" label="Add task" variant="primary" onClick={openAdd} />
            )}
          </>
        }
      />

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
            <option value="">All Statuses</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select aria-label="Filter by priority" style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            <option value="">All Priorities</option>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select aria-label="Filter by type" style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <select aria-label="Filter by assignee" style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
            <option value="">All Assignees</option>
            {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
          </select>
          {(filterStatus || filterPriority || filterType || filterAssignee || searchQuery) && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setFilterStatus(''); setFilterPriority(''); setFilterType(''); setFilterAssignee(''); setSearchQuery(''); }}
              >
                Clear Filters
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
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Task' : 'Add New Task'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Title *</label>
              <input
                autoFocus
                aria-label="Title"
                style={inputStyle}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Review customer data quality report"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                aria-label="Description"
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the task in detail..."
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
              <select aria-label="Type" style={selectStyle} value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Priority</label>
              <select aria-label="Priority" style={selectStyle} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assignee</label>
              <select aria-label="Assignee" style={selectStyle} value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Due Date</label>
              <input
                type="date"
                aria-label="Due Date"
                style={inputStyle}
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Automation Mode</label>
              <select aria-label="Automation Mode" style={selectStyle} value={form.automationMode} onChange={(e) => setForm({ ...form, automationMode: e.target.value })}>
                {AUTOMATION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {/* Linked Object Type/ID inputs removed: the user-pickable
                vocabulary was read by nothing — the values actually consumed
                (dashboard / governance-calendar) are set programmatically with
                their own types. The DB columns and that programmatic linkage
                are retained. */}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.title.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Task'}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
        ) : loading ? (
          <SkeletonRows rows={5} columns={8} />
        ) : tasks.length === 0 && !showForm ? (
          <EmptyState
            icon={renderNavIcon('/governance-work')}
            title="No governance tasks yet"
            description="Governance tasks track reviews, approvals, remediations, and other work items. Create your first task to get started."
            action={canWrite ? { label: '+ Add Task', onClick: openAdd } : undefined}
          />
        ) : (
          <DataTable
            rows={sorted}
            columns={taskColumns}
            rowKey={(t) => t.id}
            selection={sel}
            sort={{ sortKey, sortDir, onSort: toggleSort }}
            selectAllLabel="Select all tasks"
            emptyMessage="No tasks match the current filters."
          />
        )}
      </div>
    </div>
  );
}
