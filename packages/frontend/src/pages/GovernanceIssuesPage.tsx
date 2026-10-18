import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage, successToast, errorToast } from '../lib/errorToast';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { HeaderEditActions } from '../components/DetailEditActions';
import EmbeddablePageHeader from '../components/EmbeddablePageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
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
import Button from '../components/Button';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceIssuesPage — full CRUD list page for governance issues. Supports
// filtering, sorting, bulk selection, and inline add/edit form. Embedded
// inside GovernanceWorkPage as a tab.
// ──────────────────────────────────────────────────────────────────────────

// ── Types ──

export interface GovernanceIssue {
  id: string;
  orgId: string;
  title: string;
  description: string;
  issueType: string;
  severity: string;
  status: string;
  domainId: string | null;
  domainName: string | null;
  dataAssetId: string | null;
  dataAssetName: string | null;
  systemId: string | null;
  reportedBy: string | null;
  reporterName: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  resolutionSummary: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
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

// Still-open statuses — the ones that count toward "needs attention".
export const OPEN_ISSUE_STATUSES = new Set(['OPEN', 'INVESTIGATING', 'IN_PROGRESS']);

// One primary action per status drives the issue toward resolution; the rest
// (and "Won't fix") move into the row ⋯ menu.
export const ISSUE_STATUS_TRANSITIONS: Record<string, { label: string; target: string; style: 'primary' | 'secondary' | 'danger' }[]> = {
  OPEN:          [{ label: 'Investigate', target: 'INVESTIGATING', style: 'primary' }, { label: 'Start work', target: 'IN_PROGRESS', style: 'secondary' }, { label: "Won't fix", target: 'WONT_FIX', style: 'danger' }],
  INVESTIGATING: [{ label: 'Start work', target: 'IN_PROGRESS', style: 'primary' }, { label: 'Resolve', target: 'RESOLVED', style: 'secondary' }, { label: "Won't fix", target: 'WONT_FIX', style: 'danger' }],
  IN_PROGRESS:   [{ label: 'Resolve', target: 'RESOLVED', style: 'primary' }, { label: "Won't fix", target: 'WONT_FIX', style: 'danger' }],
  RESOLVED:      [{ label: 'Close', target: 'CLOSED', style: 'primary' }, { label: 'Reopen', target: 'OPEN', style: 'secondary' }],
  CLOSED:        [{ label: 'Reopen', target: 'OPEN', style: 'secondary' }],
  WONT_FIX:      [{ label: 'Reopen', target: 'OPEN', style: 'secondary' }],
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
// Dotted pills (leading status dot). Severity carries the warm cue; status and
// type stay neutral so colour reads as one signal, not three competing ones.

export const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  OPEN:          { bg: '#e5ecf3', color: '#364a5e' }, // slate — needs triage
  INVESTIGATING: { bg: '#ede9fe', color: '#5b21b6' }, // purple
  IN_PROGRESS:   { bg: '#e6eef9', color: '#24508f' }, // blue
  RESOLVED:      { bg: '#dcefe5', color: '#17604b' }, // green
  CLOSED:        { bg: '#eef0f2', color: '#6b7280' }, // grey
  WONT_FIX:      { bg: '#eef0f2', color: '#6b7280' }, // grey
};

export const SEVERITY_COLORS: Record<string, { bg: string; color: string }> = {
  LOW:      { bg: '#e5ecf3', color: '#364a5e' }, // slate
  MEDIUM:   { bg: '#e6eef9', color: '#24508f' }, // blue
  HIGH:     { bg: '#fbe9d9', color: '#9a4a0e' }, // amber
  CRITICAL: { bg: '#fbe4e4', color: '#9a1c1c' }, // red
};

// Sentence-case a SCREAMING_SNAKE code: "IN_PROGRESS" → "In progress".
export function prettyLabel(code: string): string {
  const s = (code || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A sentence-case pill with a leading status dot. OPEN (untriaged) wears a
// hollow dot so it doesn't read as an in-flight state.
export function dotPill(colors: { bg: string; color: string }, label: string, hollow = false): React.ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: colors.bg, color: colors.color }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: hollow ? 'transparent' : colors.color, boxShadow: hollow ? `inset 0 0 0 1.5px ${colors.color}` : undefined }} />{label}
    </span>
  );
}

// Issue type is deliberately NOT a coloured pill — a pink OWNERSHIP chip read
// as a severity. It rides the title sub-line as plain muted text instead.
type IssueColId = 'title' | 'type' | 'severity' | 'status' | 'domain' | 'assignee' | 'created';
const ISSUE_COLUMN_DEFS: Array<{ id: IssueColId; label: string; defaultVisible: boolean }> = [
  { id: 'title',    label: 'Issue',       defaultVisible: true  },
  { id: 'type',     label: 'Type',        defaultVisible: false },
  { id: 'severity', label: 'Severity',    defaultVisible: true  },
  { id: 'status',   label: 'Status',      defaultVisible: true  },
  { id: 'domain',   label: 'Domain',      defaultVisible: false },
  { id: 'assignee', label: 'Assigned To', defaultVisible: true  },
  { id: 'created',  label: 'Created',     defaultVisible: false },
];

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Shared issue field grid — used by both the top-of-page "Add" form (create,
// showStatus off → new issues default to OPEN) and the in-row editor (edit,
// showStatus on), so the two never drift.
function IssueFields({ form, setForm, people, domains, showStatus }: {
  form: FormData;
  setForm: (next: FormData) => void;
  people: Person[];
  domains: DataDomain[];
  showStatus?: boolean;
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
          placeholder="e.g. Missing metadata on customer records"
        />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Description</label>
        <textarea
          aria-label="Description"
          style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe the issue in detail..."
        />
      </div>
      <div>
        <label style={labelStyle}>Issue Type</label>
        <select aria-label="Issue Type" style={selectStyle} value={form.issueType} onChange={(e) => setForm({ ...form, issueType: e.target.value })}>
          {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Severity</label>
        <select aria-label="Severity" style={selectStyle} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
          {ISSUE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Domain</label>
        <select aria-label="Domain" style={selectStyle} value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })}>
          <option value="">-- No Domain --</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Assigned To</label>
        <select aria-label="Assigned To" style={selectStyle} value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
          <option value="">-- Unassigned --</option>
          {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
        </select>
      </div>
      {showStatus && (
        <div>
          <label style={labelStyle}>Status</label>
          <select aria-label="Status" style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// The expanded row: read-only detail with a view/edit toggle. Edit flips the
// SAME panel into the field grid and one Save writes PUT /governance-issues/
// :id — the row's own in-place editor (there's no separate edit form anymore).
export function ExpandedIssue({ issue, people, domains, orgId, canEdit, onSaved, actionsSlot, hideMeta }: {
  issue: GovernanceIssue;
  people: Person[];
  domains: DataDomain[];
  orgId: string | null;
  canEdit: boolean;
  onSaved: () => void;
  /** When set, the Edit / Save·Cancel cluster renders into the page header's
   *  actions slot (the detail-page placement) instead of inline. */
  actionsSlot?: HTMLElement | null;
  /** Hide the bottom domain/created/updated meta row — the detail page owns
   *  those facts in its rail, so they'd otherwise duplicate. */
  hideMeta?: boolean;
}) {
  const m = useDetailEditMode<FormData>(
    {
      title: issue.title,
      description: issue.description,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      domainId: issue.domainId || '',
      assignedTo: issue.assignedTo || '',
    },
    async (draft) => {
      if (!draft.title.trim()) { errorToast(null, 'Title is required'); throw new Error('no-title'); }
      try {
        await apiClient.put(`/governance-issues/${issue.id}`, {
          ...draft,
          domainId: draft.domainId || null,
          assignedTo: draft.assignedTo || null,
          ...(orgId ? { orgId } : {}),
        });
        successToast('Issue updated');
        onSaved();
      } catch (err) { errorToast(err, 'Failed to update issue'); throw err; }
    },
  );
  return (
    <div>
      <HeaderEditActions slot={actionsSlot} editing={m.isEditing} canEdit={canEdit} dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
      {m.isEditing ? (
        <IssueFields form={m.draft} setForm={(next) => m.patch(next)} people={people} domains={domains} showStatus />
      ) : (
        <>
          <SectionLabel marginBottom={6}>Description</SectionLabel>
          <div style={{ fontSize: 12, color: issue.description ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', fontStyle: issue.description ? undefined : 'italic', whiteSpace: 'pre-wrap', marginBottom: hideMeta ? 0 : 12 }}>
            {issue.description || 'No description provided.'}
          </div>
          {!hideMeta && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 11 }}>
              {issue.domainName && (
                <div><span style={{ color: 'var(--color-text-muted)' }}>Domain </span><span style={{ fontWeight: 500 }}>{issue.domainName}</span></div>
              )}
              <div><span style={{ color: 'var(--color-text-muted)' }}>Created </span><span style={{ fontWeight: 500 }}>{fmtDate(issue.createdAt)}</span></div>
              <div><span style={{ color: 'var(--color-text-muted)' }}>Updated </span><span style={{ fontWeight: 500 }}>{fmtDate(issue.updatedAt)}</span></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Component ──

export default function GovernanceIssuesPage({
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

  const issueCols = useColumnPicker<IssueColId>('procela.governanceIssues.visibleCols.v1', ISSUE_COLUMN_DEFS);
  const [issues, setIssues] = useState<GovernanceIssue[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  // Row click opens an issue's full detail on its own page (/governance-work/
  // issues/:id), matching the People detail-page family.

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  // One-click "needs attention" lens: 'triage' | 'highSeverity' | 'unassigned'.
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

  // The current user's person record (best-effort name match), so "Assigned to
  // me" works without a server-side me→person link.
  const myPersonId = currentUser ? (people.find((p) => p.name === currentUser.name)?.id ?? null) : null;
  const isMine = (i: GovernanceIssue) =>
    (myPersonId != null && i.assignedTo === myPersonId) ||
    (!!currentUser && !!i.assigneeName && i.assigneeName === currentUser.name);

  const isOpenIssue = (i: GovernanceIssue) => OPEN_ISSUE_STATUSES.has(i.status);
  const isHighSeverity = (i: GovernanceIssue) => i.severity === 'HIGH' || i.severity === 'CRITICAL';

  // ── Needs-attention counts (open issues only) ──
  const triageCount = issues.filter((i) => i.status === 'OPEN').length;
  const highSeverityCount = issues.filter((i) => isOpenIssue(i) && isHighSeverity(i)).length;
  const unassignedCount = issues.filter((i) => isOpenIssue(i) && !i.assignedTo).length;

  const matchesAttention = (i: GovernanceIssue) => {
    if (!attention) return true;
    if (attention === 'triage') return i.status === 'OPEN';
    if (attention === 'highSeverity') return isOpenIssue(i) && isHighSeverity(i);
    if (attention === 'unassigned') return isOpenIssue(i) && !i.assignedTo;
    return true;
  };

  // ── Filtering ──
  const filtered = issues.filter((i) => {
    if (filterStatus && i.status !== filterStatus) return false;
    if (filterSeverity && i.severity !== filterSeverity) return false;
    if (filterType && i.issueType !== filterType) return false;
    if (filterAssignee && i.assignedTo !== filterAssignee) return false;
    if (assignedToMe && !isMine(i)) return false;
    if (!matchesAttention(i)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!i.title.toLowerCase().includes(q) && !(i.description || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Compact assignee options: only people who actually own an issue, deduped by
  // id — avoids the full directory (and duplicate-name confusion) in the filter.
  const assigneeOptions = Array.from(
    new Map(issues.filter((i) => i.assignedTo).map((i) => [i.assignedTo as string, i.assigneeName || 'Unknown'])).entries(),
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

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
    'severity',
  );

  const sel = useRowSelection(sorted, (i) => i.id);

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

  // Create-only: existing issues are edited inside their row's expanded detail.
  const handleSave = async () => {
    if (!form.title.trim()) return;
    try {
      const payload = {
        ...form,
        domainId: form.domainId || null,
        assignedTo: form.assignedTo || null,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      };
      await apiClient.post('/governance-issues', payload);
      addToast('success', 'Issue created');
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

  const handleStatusTransition = async (issueId: string, newStatus: string) => {
    try {
      await apiClient.put(`/governance-issues/${issueId}`, { status: newStatus });
      addToast('success', `Issue status changed to ${prettyLabel(newStatus)}`);
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
      await Promise.all(Array.from(sel.selectedIds).map((id) => apiClient.delete(`/governance-issues/${id}`)));
      addToast('success', `Deleted ${sel.count} issue${sel.count === 1 ? '' : 's'}`);
      sel.clear();
      fetchData();
    } catch {
      addToast('error', 'Some issues could not be deleted');
      fetchData();
    }
  };

  const mutedDash = <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>--</span>;
  const issueColumns = ([
    issueCols.isVisible('title') && {
      key: 'title', header: 'Issue', sortable: true,
      render: (i: GovernanceIssue) => {
        // Sub-line: issue type (plain text, no coloured pill), then the thing
        // it affects (asset / domain) and who raised it, when known.
        const bits = [prettyLabel(i.issueType)];
        if (i.dataAssetName) bits.push(i.dataAssetName);
        else if (i.domainName) bits.push(i.domainName);
        if (i.reporterName) bits.push(`by ${i.reporterName}`);
        return (
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={() => navigate(`/governance-work/issues/${i.id}`)}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', cursor: 'pointer', font: 'inherit', fontWeight: 600, textAlign: 'left', display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {i.title}
            </button>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bits.join(' · ')}</span>
          </div>
        );
      },
    },
    issueCols.isVisible('type') && {
      key: 'type', header: 'Type', sortable: true,
      render: (i: GovernanceIssue) => <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{prettyLabel(i.issueType)}</span>,
    },
    issueCols.isVisible('severity') && {
      key: 'severity', header: 'Severity', sortable: true,
      render: (i: GovernanceIssue) => dotPill(SEVERITY_COLORS[i.severity] || SEVERITY_COLORS.LOW, prettyLabel(i.severity)),
    },
    issueCols.isVisible('status') && {
      key: 'status', header: 'Status', sortable: true,
      render: (i: GovernanceIssue) => dotPill(STATUS_COLORS[i.status] || STATUS_COLORS.OPEN, prettyLabel(i.status), i.status === 'OPEN'),
    },
    issueCols.isVisible('domain') && {
      key: 'domain', header: 'Domain', sortable: true,
      render: (i: GovernanceIssue) => i.domainName || mutedDash,
    },
    issueCols.isVisible('assignee') && {
      key: 'assignee', header: 'Assigned To', sortable: true,
      render: (i: GovernanceIssue) => (
        i.assigneeName ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Avatar name={i.assigneeName} size="sm" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.assigneeName}</span>
          </span>
        ) : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>
      ),
    },
    issueCols.isVisible('created') && {
      key: 'created', header: 'Created', sortable: true,
      render: (i: GovernanceIssue) => fmtDate(i.createdAt),
    },
    {
      key: 'actions', header: '', align: 'center' as const, width: 160,
      render: (i: GovernanceIssue) => {
        // One primary action (Investigate / Resolve / Close / Reopen) per row;
        // the rest — Won't fix, Delete — live in the ⋯ menu.
        const trs = ISSUE_STATUS_TRANSITIONS[i.status] || [];
        const primary = trs.find((x) => x.style === 'primary') || trs[0];
        const rest = trs.filter((x) => x !== primary);
        const hasMenu = rest.length > 0 || isAdmin;
        return (
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {primary && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleStatusTransition(i.id, primary.target); }}
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
                  onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === i.id ? null : i.id); }}
                  style={rowMenuBtnStyle}
                >⋯</button>
                {rowMenuId === i.id && (
                  <div role="menu" onClick={(e) => e.stopPropagation()} style={rowMenuStyle}>
                    {rest.map((tr) => (
                      <button
                        key={tr.target} type="button" role="menuitem"
                        style={tr.style === 'danger' ? { ...menuItemStyle, color: 'var(--color-error)' } : menuItemStyle}
                        onClick={() => { setRowMenuId(null); handleStatusTransition(i.id, tr.target); }}
                      >{tr.label}</button>
                    ))}
                    <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); navigate(`/governance-work/issues/${i.id}`); }}>Open &amp; edit</button>
                    {isAdmin && <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); setConfirmDelete(i.id); }}>Delete</button>}
                  </div>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ].filter(Boolean) as DataTableColumn<GovernanceIssue>[]);

  return (
    <div>
      {/* Header */}
      <EmbeddablePageHeader
        embedded={embedded}
        actionsPortal={actionsPortal}
        title="Governance Issues"
        subtitle="Track and resolve data governance issues across your organization."
        actions={
          <>
            <ColumnPicker state={issueCols} />
            {isAdmin && (
              <Button variant="primary" size="sm" onClick={openAdd}>+ Report issue</Button>
            )}
          </>
        }
      />

      {/* Needs attention — one tap filters to the issues that can't wait. */}
      {issues.length > 0 && (triageCount > 0 || highSeverityCount > 0 || unassignedCount > 0) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            { key: 'highSeverity', count: highSeverityCount, label: 'High severity', fg: '#9a1c1c', tint: '#fbe4e4' },
            { key: 'triage', count: triageCount, label: 'Awaiting triage', fg: '#9a4a0e', tint: 'var(--color-warning-light)' },
            { key: 'unassigned', count: unassignedCount, label: 'Unassigned', fg: 'var(--color-primary)', tint: 'var(--color-primary-light)' },
          ].filter((c) => c.count > 0).map((c) => {
            const active = attention === c.key;
            return (
              <button
                key={c.key} type="button"
                onClick={() => setAttention(active ? null : c.key)}
                aria-pressed={active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', font: 'inherit',
                  padding: '10px 14px', borderRadius: 'var(--radius-md)', textAlign: 'left',
                  background: active ? c.tint : 'var(--color-surface)',
                  border: `1px solid ${active ? c.fg : 'var(--color-border)'}`,
                }}
              >
                <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: c.fg, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{c.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{active ? 'Filtering · tap to clear' : 'Tap to filter'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters (left-aligned, mirrors the Tasks tab) */}
      {issues.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            aria-label="Search issues" placeholder="Search issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
          />
          <select aria-label="Filter by status" style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{prettyLabel(s)}</option>)}
          </select>
          <select aria-label="Filter by severity" style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
            <option value="">All severities</option>
            {ISSUE_SEVERITIES.map((s) => <option key={s} value={s}>{prettyLabel(s)}</option>)}
          </select>
          <select aria-label="Filter by type" style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{prettyLabel(t)}</option>)}
          </select>
          {assigneeOptions.length > 0 && (
            <select aria-label="Filter by assignee" style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
              <option value="">All assignees</option>
              {assigneeOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
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
          {(filterStatus || filterSeverity || filterType || filterAssignee || assignedToMe || attention || searchQuery) && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setFilterStatus(''); setFilterSeverity(''); setFilterType(''); setFilterAssignee(''); setAssignedToMe(false); setAttention(null); setSearchQuery(''); }}
              >
                Clear filters
              </Button>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Showing {filtered.length} of {issues.length}
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
        <Card padding={20} marginBottom={20}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add New Issue</h3>
          <IssueFields form={form} setForm={setForm} people={people} domains={domains} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.title.trim()}
              onClick={handleSave}
            >
              Add Issue
            </Button>
          </div>
        </Card>
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
            description="Data-quality problems, policy violations, and other concerns are tracked here."
            action={isAdmin ? { label: '+ Add Issue', onClick: openAdd } : undefined}
          />
        ) : (
          <DataTable
            rows={sorted}
            columns={issueColumns}
            rowKey={(i) => i.id}
            selection={isAdmin ? sel : undefined}
            sort={{ sortKey, sortDir, onSort: toggleSort }}
            selectAllLabel="Select all issues"
            emptyMessage="No issues match the current filters."
            onRowClick={(i) => navigate(`/governance-work/issues/${i.id}`)}
          />
        )}
      </div>

      {!loading && !loadError && sorted.length > 0 && (
        <p style={{ margin: '10px 2px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {sorted.length} issue{sorted.length === 1 ? '' : 's'} shown
          {sortKey === 'severity' && ' · sorted by severity'}
        </p>
      )}
    </div>
  );
}
