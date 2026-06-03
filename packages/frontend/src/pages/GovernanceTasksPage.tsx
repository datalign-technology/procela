import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import { useSortedList } from '../hooks/useSortedList';
import SortableTh from '../components/SortableTh';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
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

interface TaskSummary {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  overdue: number;
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
const LINKED_OBJECT_TYPES = ['', 'DATA_ASSET', 'DATA_DOMAIN', 'PROCESS', 'SYSTEM'] as const;

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
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [tasksRes, summaryRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceTask[] }>(`/governance-tasks${query}`),
        apiClient.get<{ success: boolean; data: TaskSummary }>(`/governance-tasks/summary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setTasks(tasksRes.data || []);
      setSummary(summaryRes.data || null);
      setPeople(peopleRes.data || []);
    } catch { /* API may not be running */ }
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
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to save task';
      addToast('error', msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-tasks/${id}`);
      addToast('success', 'Task deleted');
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Failed to delete task');
    }
  };

  const handleStatusTransition = async (taskId: string, newStatus: string) => {
    try {
      await apiClient.put(`/governance-tasks/${taskId}`, { status: newStatus });
      addToast('success', `Task status changed to ${newStatus.replace(/_/g, ' ')}`);
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Failed to update status');
    }
  };

  // ── Bulk select ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(sorted.map((t) => t.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/governance-tasks/${id}`)));
      addToast('success', `Deleted ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}`);
      setSelectedIds(new Set());
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

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Governance Tasks"
        subtitle="Track and manage governance tasks, reviews, and approvals."
        meta={summary ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{summary.total} tasks</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span>{summary.open} open</span>
            <span style={{ color: 'var(--color-border)' }}>&middot;</span>
            <span style={{ color: summary.overdue > 0 ? '#dc2626' : undefined }}>{summary.overdue} overdue</span>
          </div>
        ) : undefined}
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
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
          />
          <select style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            <option value="">All Priorities</option>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <select style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
            <option value="">All Assignees</option>
            {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
          </select>
          {(filterStatus || filterPriority || filterType || filterAssignee || searchQuery) && (
            <>
              <button
                style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
                onClick={() => { setFilterStatus(''); setFilterPriority(''); setFilterType(''); setFilterAssignee(''); setSearchQuery(''); }}
              >
                Clear Filters
              </button>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Showing {filtered.length} of {tasks.length}
              </span>
            </>
          )}
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Delete Selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Clear Selection
          </button>
        </div>
      )}

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
        message={`Delete ${selectedIds.size} selected task${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
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
                style={inputStyle}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Review customer data quality report"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the task in detail..."
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
              <select style={selectStyle} value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Priority</label>
              <select style={selectStyle} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assignee</label>
              <select style={selectStyle} value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Due Date</label>
              <input
                type="date"
                style={inputStyle}
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Automation Mode</label>
              <select style={selectStyle} value={form.automationMode} onChange={(e) => setForm({ ...form, automationMode: e.target.value })}>
                {AUTOMATION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Linked Object Type</label>
              <select style={selectStyle} value={form.linkedObjectType} onChange={(e) => setForm({ ...form, linkedObjectType: e.target.value, linkedObjectId: '' })}>
                {LINKED_OBJECT_TYPES.map((t) => <option key={t} value={t}>{t ? t.replace(/_/g, ' ') : '-- None --'}</option>)}
              </select>
            </div>
            {form.linkedObjectType && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Linked Object ID</label>
                <input
                  style={inputStyle}
                  value={form.linkedObjectId}
                  onChange={(e) => setForm({ ...form, linkedObjectId: e.target.value })}
                  placeholder="Object ID"
                />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={closeForm}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.title.trim() ? 0.6 : 1, cursor: !form.title.trim() ? 'not-allowed' : 'pointer' }}
              disabled={!form.title.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Task'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {loading ? (
          <SkeletonRows rows={5} columns={8} />
        ) : tasks.length === 0 && !showForm ? (
          <EmptyState
            icon={'☑'}
            title="No governance tasks yet"
            description="Governance tasks track reviews, approvals, remediations, and other work items. Create your first task to get started."
            action={canWrite ? { label: '+ Add Task', onClick: openAdd } : undefined}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th scope="col" style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={sorted.length > 0 && selectedIds.size === sorted.length}
                    onChange={toggleSelectAll} />
                </th>
                {taskCols.isVisible('title') && <SortableTh sortKey="title" active={sortKey} dir={sortDir} onClick={toggleSort}>Title</SortableTh>}
                {taskCols.isVisible('type') && <SortableTh sortKey="type" active={sortKey} dir={sortDir} onClick={toggleSort}>Type</SortableTh>}
                {taskCols.isVisible('status') && <SortableTh sortKey="status" active={sortKey} dir={sortDir} onClick={toggleSort}>Status</SortableTh>}
                {taskCols.isVisible('priority') && <SortableTh sortKey="priority" active={sortKey} dir={sortDir} onClick={toggleSort}>Priority</SortableTh>}
                {taskCols.isVisible('assignee') && <SortableTh sortKey="assignee" active={sortKey} dir={sortDir} onClick={toggleSort}>Assignee</SortableTh>}
                {taskCols.isVisible('dueDate') && <SortableTh sortKey="dueDate" active={sortKey} dir={sortDir} onClick={toggleSort}>Due Date</SortableTh>}
                {taskCols.isVisible('mode') && <th scope="col" style={thStyle}>Mode</th>}
                <th scope="col" style={{ ...thStyle, width: 140, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>
                    No tasks match the current filters.
                  </td>
                </tr>
              ) : sorted.map((task) => {
                const isSelected = selectedIds.has(task.id);
                const overdue = isOverdue(task);
                const transitions = STATUS_TRANSITIONS[task.status] || [];
                return (
                  <tr key={task.id} style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                    <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(task.id)} />
                    </td>
                    {taskCols.isVisible('title') && (
                      <td style={{ ...tdStyle, fontWeight: 500 }}>
                        <span style={{ color: 'var(--color-primary)' }}>{task.title}</span>
                        {overdue && <span style={{ marginLeft: 6, fontSize: 10, color: '#dc2626', fontWeight: 600 }}>OVERDUE</span>}
                      </td>
                    )}
                    {taskCols.isVisible('type') && (
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{task.taskType.replace(/_/g, ' ')}</span>
                      </td>
                    )}
                    {taskCols.isVisible('status') && (
                      <td style={tdStyle}>
                        <span style={badge(task.status.replace(/_/g, ' '), STATUS_COLORS[task.status] || { bg: '#f3f4f6', color: '#6b7280' })}>
                          {task.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    )}
                    {taskCols.isVisible('priority') && (
                      <td style={tdStyle}>
                        <span style={badge(task.priority, PRIORITY_COLORS[task.priority] || { bg: '#f3f4f6', color: '#6b7280' })}>
                          {task.priority}
                        </span>
                      </td>
                    )}
                    {taskCols.isVisible('assignee') && (
                      <td style={tdStyle}>
                        {task.assigneeName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>}
                      </td>
                    )}
                    {taskCols.isVisible('dueDate') && (
                      <td style={{ ...tdStyle, color: overdue ? '#dc2626' : undefined, fontWeight: overdue ? 600 : undefined }}>
                        {formatDate(task.dueDate)}
                      </td>
                    )}
                    {taskCols.isVisible('mode') && (
                      <td style={tdStyle}>
                        <span style={badge(task.automationMode, MODE_COLORS[task.automationMode] || { bg: '#f3f4f6', color: '#6b7280' })}>
                          {task.automationMode}
                        </span>
                      </td>
                    )}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {transitions.map((tr) => (
                          <button
                            key={tr.target}
                            onClick={() => handleStatusTransition(task.id, tr.target)}
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
                        {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(task)} />}
                        {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(task.id)} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
