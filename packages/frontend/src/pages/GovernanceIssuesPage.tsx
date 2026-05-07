import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
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

interface IssueSummary {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byIssueType: Record<string, number>;
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

// ── Component ──

export default function GovernanceIssuesPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const [issues, setIssues] = useState<GovernanceIssue[]>([]);
  const [summary, setSummary] = useState<IssueSummary | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [issuesRes, summaryRes, peopleRes, domainsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: GovernanceIssue[] }>(`/governance-issues${query}`),
        apiClient.get<{ success: boolean; data: IssueSummary }>(`/governance-issues/summary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataDomain[] }>(`/data-domains${query}`),
      ]);
      setIssues(issuesRes.data || []);
      setSummary(summaryRes.data || null);
      setPeople(peopleRes.data || []);
      setDomains(domainsRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to save issue';
      addToast('error', msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-issues/${id}`);
      addToast('success', 'Issue deleted');
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Failed to delete issue');
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
    else setSelectedIds(new Set(sorted.map((i) => i.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/governance-issues/${id}`)));
      addToast('success', `Deleted ${selectedIds.size} issue${selectedIds.size === 1 ? '' : 's'}`);
      setSelectedIds(new Set());
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

  const openCount = summary ? (summary.byStatus['OPEN'] || 0) : 0;
  const criticalCount = summary ? (summary.bySeverity['CRITICAL'] || 0) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Governance Issues</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Track and resolve data governance issues across your organization.
          </p>
          {summary && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <span>{summary.total} issues</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{openCount} open</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span style={{ color: criticalCount > 0 ? '#dc2626' : undefined }}>{criticalCount} critical</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canWrite && (
            <IconButton icon="plus" label="Add issue" variant="primary" onClick={openAdd} />
          )}
        </div>
      </div>

      {/* Filters (left-aligned, mirrors Data Assets) */}
      {issues.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
          />
          <select style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select style={{ ...selectStyle, width: 'auto', minWidth: 120 }} value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
            <option value="">All Severities</option>
            {ISSUE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          {(filterStatus || filterSeverity || filterType || searchQuery) && (
            <>
              <button
                style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
                onClick={() => { setFilterStatus(''); setFilterSeverity(''); setFilterType(''); setSearchQuery(''); }}
              >
                Clear Filters
              </button>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Showing {filtered.length} of {issues.length}
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
        message={`Delete ${selectedIds.size} selected issue${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
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
                style={inputStyle}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Missing metadata on customer records"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the issue in detail..."
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Issue Type</label>
              <select style={selectStyle} value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })}>
                {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Severity</label>
              <select style={selectStyle} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {ISSUE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Domain</label>
              <select style={selectStyle} value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })}>
                <option value="">-- No Domain --</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Assigned To</label>
              <select style={selectStyle} value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
            </div>
            {editingId && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
                <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
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
              {editingId ? 'Save Changes' : 'Add Issue'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {loading ? (
          <SkeletonRows rows={5} columns={9} />
        ) : issues.length === 0 && !showForm ? (
          <EmptyState
            icon={'!'}
            title="No governance issues yet"
            description="Governance issues track data quality problems, policy violations, and other concerns. Create your first issue to get started."
            action={canWrite ? { label: '+ Add Issue', onClick: openAdd } : undefined}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={sorted.length > 0 && selectedIds.size === sorted.length}
                    onChange={toggleSelectAll} />
                </th>
                <SortableTh sortKey="title" active={sortKey} dir={sortDir} onClick={toggleSort}>Title</SortableTh>
                <SortableTh sortKey="type" active={sortKey} dir={sortDir} onClick={toggleSort}>Type</SortableTh>
                <SortableTh sortKey="severity" active={sortKey} dir={sortDir} onClick={toggleSort}>Severity</SortableTh>
                <SortableTh sortKey="status" active={sortKey} dir={sortDir} onClick={toggleSort}>Status</SortableTh>
                <SortableTh sortKey="domain" active={sortKey} dir={sortDir} onClick={toggleSort}>Domain</SortableTh>
                <SortableTh sortKey="assignee" active={sortKey} dir={sortDir} onClick={toggleSort}>Assigned To</SortableTh>
                <SortableTh sortKey="created" active={sortKey} dir={sortDir} onClick={toggleSort}>Created</SortableTh>
                <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: 24 }}>
                    No issues match the current filters.
                  </td>
                </tr>
              ) : sorted.map((issue) => {
                const isSelected = selectedIds.has(issue.id);
                return (
                  <tr key={issue.id} style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                    <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(issue.id)} />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      <span style={{ color: 'var(--color-primary)' }}>{issue.title}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={badge(issue.issueType.replace(/_/g, ' '), ISSUE_TYPE_COLORS[issue.issueType] || { bg: '#f3f4f6', color: '#6b7280' })}>
                        {issue.issueType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={badge(issue.severity, SEVERITY_COLORS[issue.severity] || { bg: '#f3f4f6', color: '#6b7280' })}>
                        {issue.severity}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={badge(issue.status.replace(/_/g, ' '), STATUS_COLORS[issue.status] || { bg: '#f3f4f6', color: '#6b7280' })}>
                        {issue.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {issue.domainName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>--</span>}
                    </td>
                    <td style={tdStyle}>
                      {issue.assigneeName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>}
                    </td>
                    <td style={tdStyle}>
                      {formatDate(issue.createdAt)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                        {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(issue)} />}
                        {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(issue.id)} />}
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
