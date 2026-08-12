import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
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
import FilterBar from '../components/FilterBar';
import Button from '../components/Button';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceIssuesPage — full CRUD list page for governance issues. Supports
// filtering, sorting, bulk selection, and inline add/edit form. Embedded
// inside GovernanceWorkPage as a tab.
// ──────────────────────────────────────────────────────────────────────────

// ── Types ──

interface GovernanceIssue {
  id: string;
  orgId: string;
  title: string;
  description: string;
  issueType: string;
  severity: string;
  status: string;
  domainId: string | null;
  domainName: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
}


interface Person {
  id: string;
  name: string;
}

interface DataDomain {
  id: string;
  name: string;
}

interface FormData {
  title: string;
  description: string;
  issueType: string;
  severity: string;
  status: string;
  domainId: string;
  assignedTo: string;
}

const emptyForm: FormData = {
  title: '', description: '', issueType: 'METADATA', severity: 'MEDIUM',
  status: 'OPEN', domainId: '', assignedTo: '',
};

// ── Constants ──

const ISSUE_STATUSES = ['OPEN', 'INVESTIGATING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'WONT_FIX'] as const;
const ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const ISSUE_TYPES = ['METADATA', 'DATA_QUALITY', 'CLASSIFICATION', 'OWNERSHIP', 'POLICY', 'ACCESS', 'LINEAGE', 'COMPLIANCE', 'WORKFLOW'] as const;

// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

// ── Badge helpers ──

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  OPEN:          { bg: '#dbeafe', color: '#1e40af' },
  INVESTIGATING: { bg: '#ede9fe', color: '#5b21b6' },
  IN_PROGRESS:   { bg: '#fef3c7', color: '#92400e' },
  RESOLVED:      { bg: '#d1fae5', color: '#065f46' },
  CLOSED:        { bg: '#f3f4f6', color: '#6b7280' },
  WONT_FIX:      { bg: '#f3f4f6', color: '#6b7280' },
};

const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  LOW:      { bg: '#f3f4f6', color: '#6b7280' },
  MEDIUM:   { bg: '#dbeafe', color: '#1e40af' },
  HIGH:     { bg: '#fef3c7', color: '#92400e' },
  CRITICAL: { bg: '#fee2e2', color: '#991b1b' },
};

const ISSUE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  METADATA:       { bg: '#dbeafe', color: '#1e40af' },
  DATA_QUALITY:   { bg: '#fef3c7', color: '#92400e' },
  CLASSIFICATION: { bg: '#ede9fe', color: '#5b21b6' },
  OWNERSHIP:      { bg: '#fce7f3', color: '#9d174d' },
  POLICY:         { bg: '#ccfbf1', color: '#115e59' },
  ACCESS:         { bg: '#fee2e2', color: '#991b1b' },
  LINEAGE:        { bg: '#e0e7ff', color: '#3730a3' },
  COMPLIANCE:     { bg: '#fef9c3', color: '#854d0e' },
  WORKFLOW:       { bg: '#d1fae5', color: '#065f46' },
};

function badge(_text: string, colors: { bg: string; color: string }): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color,
    whiteSpace: 'nowrap',
  };
}

type IssueColId = 'title' | 'type' | 'severity' | 'status' | 'domain' | 'assignee' | 'created';
const ISSUE_COLUMN_DEFS: Array<{ id: IssueColId; label: string; defaultVisible: boolean }> = [
  { id: 'title',    label: 'Title',       defaultVisible: true  },
  { id: 'type',     label: 'Type',        defaultVisible: true  },
  { id: 'severity', label: 'Severity',    defaultVisible: true  },
  { id: 'status',   label: 'Status',      defaultVisible: true  },
  { id: 'domain',   label: 'Domain',      defaultVisible: true  },
  { id: 'assignee', label: 'Assigned To', defaultVisible: true  },
  { id: 'created',  label: 'Created',     defaultVisible: false },
];

// ── Component ──

export default function GovernanceIssuesPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const issueCols = useColumnPicker<IssueColId>('procela.governanceIssues.visibleCols.v1', ISSUE_COLUMN_DEFS);
  const [issues, setIssues] = useState<GovernanceIssue[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [issuesRes, peopleRes, domainsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceIssue[] }>(`/governance-issues${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataDomain[] }>(`/data-domains${query}`),
      ]);
      setIssues(issuesRes.data || []);
      setPeople(peopleRes.data || []);
      setDomains(domainsRes.data || []);
    } catch (err) { setLoadError(errorMessage(err, 'Failed to load governance issues.')); }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  // ── Filtering ──
  const filtered = issues.filter((i) => {
    if (filterStatus && i.status !== filterStatus) return false;
    if (filterSeverity && i.severity !== filterSeverity) return false;
    if (filterType && i.issueType !== filterType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!i.title.toLowerCase().includes(q) && !(i.description || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Sorting ──
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    filtered,
    {
      title:    (a, b) => a.title.localeCompare(b.title),
      type:     (a, b) => a.issueType.localeCompare(b.issueType),
      severity: (a, b) => {
        const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (order[a.severity as keyof typeof order] ?? 4) - (order[b.severity as keyof typeof order] ?? 4);
      },
      status:   (a, b) => a.status.localeCompare(b.status),
      domain:   (a, b) => (a.domainName || '').localeCompare(b.domainName || ''),
      assignee: (a, b) => (a.assigneeName || '').localeCompare(b.assigneeName || ''),
      created:  (a, b) => a.createdAt.localeCompare(b.createdAt),
    },
    'title',
  );

  const sel = useRowSelection(sorted, (i) => i.id);

  // ── CRUD ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (issue: GovernanceIssue) => {
    setForm({
      title: issue.title,
      description: issue.description,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      domainId: issue.domainId || '',
      assignedTo: issue.assignedTo || '',
    });
    setEditingId(issue.id);
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
        domainId: form.domainId || null,
        assignedTo: form.assignedTo || null,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      };
      if (editingId) {
        await apiClient.put(`/governance-issues/${editingId}`, payload);
        addToast('success', 'Issue updated');
      } else {
        await apiClient.post('/governance-issues', payload);
        addToast('success', 'Issue created');
      }
      closeForm();
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      const msg = e?.response?.data?.error || errorMessage(err, 'Failed to save issue');
      addToast('error', msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-issues/${id}`);
      addToast('success', 'Issue deleted');
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to delete issue'));
    }
  };

  // ── Bulk select ──
  const handleBulkDelete = async () => {
    if (sel.count === 0) return;
    try {
      await Promise.all(Array.from(sel.selectedIds).map((id) => apiClient.delete(`/governance-issues/${id}`)));
      addToast('success', `Deleted ${sel.count} issue${sel.count === 1 ? '' : 's'}`);
      sel.clear();
      fetchData();
    } catch {
      addToast('error', 'Some issues could not be deleted');
      fetchData();
    }
  };

  // ── Helpers ──
  const formatDate = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleDateString();
  };

  const mutedDash = <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>--</span>;
  const issueColumns = ([
    issueCols.isVisible('title') && {
      key: 'title', header: 'Title', sortable: true, cellStyle: { fontWeight: 500 },
      render: (i: GovernanceIssue) => <span style={{ color: 'var(--color-primary)' }}>{i.title}</span>,
    },
    issueCols.isVisible('type') && {
      key: 'type', header: 'Type', sortable: true,
      render: (i: GovernanceIssue) => <span style={badge(i.issueType, ISSUE_TYPE_COLORS[i.issueType] || { bg: '#f3f4f6', color: '#6b7280' })}>{i.issueType.replace(/_/g, ' ')}</span>,
    },
    issueCols.isVisible('severity') && {
      key: 'severity', header: 'Severity', sortable: true,
      render: (i: GovernanceIssue) => <span style={badge(i.severity, SEVERITY_COLORS[i.severity] || { bg: '#f3f4f6', color: '#6b7280' })}>{i.severity}</span>,
    },
    issueCols.isVisible('status') && {
      key: 'status', header: 'Status', sortable: true,
      render: (i: GovernanceIssue) => <span style={badge(i.status, STATUS_COLORS[i.status] || { bg: '#f3f4f6', color: '#6b7280' })}>{i.status.replace(/_/g, ' ')}</span>,
    },
    issueCols.isVisible('domain') && {
      key: 'domain', header: 'Domain', sortable: true,
      render: (i: GovernanceIssue) => i.domainName || mutedDash,
    },
    issueCols.isVisible('assignee') && {
      key: 'assignee', header: 'Assigned To', sortable: true,
      render: (i: GovernanceIssue) => i.assigneeName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>,
    },
    issueCols.isVisible('created') && {
      key: 'created', header: 'Created', sortable: true,
      render: (i: GovernanceIssue) => formatDate(i.createdAt),
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const, width: 100,
      render: (i: GovernanceIssue) => (
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
          {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(i)} />}
          {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(i.id)} />}
        </div>
      ),
    },
  ].filter(Boolean) as DataTableColumn<GovernanceIssue>[]);

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Governance Issues"
        subtitle="Track and resolve data governance issues across your organization."
        actions={
          <>
            <ColumnPicker state={issueCols} />
            {canWrite && (
              <IconButton icon="plus" label="Add issue" variant="primary" onClick={openAdd} />
            )}
          </>
        }
      />

      {issues.length > 0 && (
        <FilterBar
          search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search issues…', width: 200 }}
          filters={[
            { id: 'status',   label: 'All Statuses',   value: filterStatus,   onChange: setFilterStatus,   width: 140, options: ISSUE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })) },
            { id: 'severity', label: 'All Severities', value: filterSeverity, onChange: setFilterSeverity, width: 140, options: ISSUE_SEVERITIES.map((s) => ({ value: s, label: s })) },
            { id: 'type',     label: 'All Types',      value: filterType,     onChange: setFilterType,     width: 160, options: ISSUE_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })) },
          ]}
          leftActions={(filterStatus || filterSeverity || filterType || searchQuery) ? (
            <>
              <Button size="sm" onClick={() => { setFilterStatus(''); setFilterSeverity(''); setFilterType(''); setSearchQuery(''); }}>
                Clear Filters
              </Button>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Showing {filtered.length} of {issues.length}
              </span>
            </>
          ) : null}
        />
      )}

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Issue?"
        message="This will permanently delete this governance issue. This cannot be undone."
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
        title="Delete Selected Issues?"
        message={`Delete ${sel.count} selected issue${sel.count === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Issue' : 'Add New Issue'}
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
                placeholder="e.g. Missing metadata on customer records"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                aria-label="Description"
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the issue in detail..."
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Issue Type</label>
              <select aria-label="Issue Type" style={selectStyle} value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })}>
                {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Severity</label>
              <select aria-label="Severity" style={selectStyle} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {ISSUE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Domain</label>
              <select aria-label="Domain" style={selectStyle} value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })}>
                <option value="">-- No Domain --</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assigned To</label>
              <select aria-label="Assigned To" style={selectStyle} value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
            </div>
            {editingId && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
                <select aria-label="Status" style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.title.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Issue'}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
        ) : loading ? (
          <SkeletonRows rows={5} columnWidths={[32, null, null, null, null, null, null, null, 100]} />
        ) : issues.length === 0 && !showForm ? (
          <EmptyState
            icon={renderNavIcon('/governance-work')}
            title="No governance issues yet"
            description="Governance issues track data quality problems, policy violations, and other concerns. Create your first issue to get started."
            action={canWrite ? { label: '+ Add Issue', onClick: openAdd } : undefined}
          />
        ) : (
          <DataTable
            rows={sorted}
            columns={issueColumns}
            rowKey={(i) => i.id}
            selection={sel}
            sort={{ sortKey, sortDir, onSort: toggleSort }}
            selectAllLabel="Select all issues"
            emptyMessage="No issues match the current filters."
          />
        )}
      </div>
    </div>
  );
}
