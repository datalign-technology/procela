import { useEffect, useState, useCallback } from 'react';
import { Bot } from 'lucide-react';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { thStyle, tdStyle } from '../lib/tableStyles';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/Button';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';
import { SkeletonRows } from '../components/Skeleton';
import DependencyBanner, { useDependencyChecks } from '../components/DependencyBanner';
import { formatPersonLabel } from '../lib/personLabel';
import { useRefreshOnFocus } from '../hooks/usePolling';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import { useFormValidation, fieldErrorStyle, inputErrorBorder } from '../hooks/useFormValidation';

// ── Types ──

interface Policy {
  id: string; orgId: string; code: string; name: string; description: string;
  status: string; ownerAssignmentId: string | null; ownerName: string | null;
  category: string; reviewFrequency: string; nextReviewDate: string | null;
  content: string; createdAt: string; updatedAt: string;
  // CHARTER / FRAMEWORK / STANDARD / POLICY. Drives form variant
  // (charters skip the Controls panel, etc.) and gets a badge.
  documentType: 'CHARTER' | 'FRAMEWORK' | 'STANDARD' | 'POLICY';
}

interface Control {
  id: string; orgId: string; policyId: string; code: string; name: string;
  description: string; controlType: string; automationMode: string;
  status: string; evidenceRequired: boolean; createdAt: string; updatedAt: string;
}

interface Person { id: string; name: string; }

interface PolicyForm {
  name: string; description: string; category: string; status: string;
  ownerAssignmentId: string; reviewFrequency: string; content: string;
  documentType: 'CHARTER' | 'FRAMEWORK' | 'STANDARD' | 'POLICY';
}

interface ControlForm {
  name: string; description: string; controlType: string;
  automationMode: string; evidenceRequired: boolean;
}

const emptyPolicyForm: PolicyForm = {
  name: '', description: '', category: 'GENERAL', status: 'DRAFT',
  ownerAssignmentId: '', reviewFrequency: 'ANNUAL', content: '',
  documentType: 'POLICY',
};

const DOCUMENT_TYPES = ['CHARTER', 'FRAMEWORK', 'STANDARD', 'POLICY'] as const;
type DocumentType = typeof DOCUMENT_TYPES[number];

// Plain-English labels for the badge / filter / type selector.
const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  CHARTER:   'Charter',
  FRAMEWORK: 'Framework',
  STANDARD:  'Standard',
  POLICY:    'Policy',
};

const DOCUMENT_TYPE_COLORS: Record<DocumentType, { bg: string; color: string }> = {
  CHARTER:   { bg: '#e0e7ff', color: '#3730a3' },
  FRAMEWORK: { bg: '#dbeafe', color: '#1e40af' },
  STANDARD:  { bg: '#fef3c7', color: '#92400e' },
  POLICY:    { bg: '#d1fae5', color: '#065f46' },
};

const emptyControlForm: ControlForm = {
  name: '', description: '', controlType: 'DETECTIVE',
  automationMode: 'HUMAN', evidenceRequired: false,
};

const CATEGORIES = ['DATA_QUALITY', 'SECURITY', 'PRIVACY', 'RETENTION', 'ACCESS', 'CLASSIFICATION', 'GOVERNANCE', 'GENERAL'] as const;
const STATUSES = ['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'DEPRECATED'] as const;
const CONTROL_TYPES = ['PREVENTIVE', 'DETECTIVE', 'CORRECTIVE'] as const;
const AUTOMATION_MODES = ['HUMAN', 'AGENT', 'HYBRID'] as const;

// ── Styles ──

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DRAFT:        { bg: '#f3f4f6', color: '#6b7280' },
  ACTIVE:       { bg: '#d1fae5', color: '#065f46' },
  UNDER_REVIEW: { bg: '#fef3c7', color: '#92400e' },
  DEPRECATED:   { bg: '#fee2e2', color: '#991b1b' },
};

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  DATA_QUALITY:   { bg: '#dbeafe', color: '#1e40af' },
  SECURITY:       { bg: '#fee2e2', color: '#991b1b' },
  PRIVACY:        { bg: '#ede9fe', color: '#5b21b6' },
  RETENTION:      { bg: '#fef3c7', color: '#92400e' },
  ACCESS:         { bg: '#ccfbf1', color: '#115e59' },
  CLASSIFICATION: { bg: '#fce7f3', color: '#9d174d' },
  GOVERNANCE:     { bg: '#e0e7ff', color: '#3730a3' },
  GENERAL:        { bg: '#f3f4f6', color: '#6b7280' },
};

function badgeStyle(colors: { bg: string; color: string }): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color, whiteSpace: 'nowrap',
  };
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

type PolicyColId = 'code' | 'name' | 'category' | 'status' | 'owner' | 'controls';
const POLICY_COLUMN_DEFS: Array<{ id: PolicyColId; label: string; defaultVisible: boolean }> = [
  { id: 'code',      label: 'Code',       defaultVisible: true  },
  { id: 'name',      label: 'Name',       defaultVisible: true  },
  { id: 'category',  label: 'Category',   defaultVisible: true  },
  { id: 'status',    label: 'Status',     defaultVisible: true  },
  { id: 'owner',     label: 'Owner',      defaultVisible: true  },
  { id: 'controls',  label: 'Controls',   defaultVisible: true  },
];

// ── Component ──

export default function GovernancePoliciesPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const deps = useDependencyChecks();
  const { addToast } = useToastStore();

  const policyCols = useColumnPicker<PolicyColId>('procela.governancePolicies.visibleCols.v1', POLICY_COLUMN_DEFS);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  // Agent-promotion provenance — for any policy promoted from an agent
  // draft, the matching execution carries the back-link. We join by
  // execution.promotedDocumentId === policy.id at render time so neither
  // store needs a schema change.
  interface PromotionInfo {
    executionId: string;
    agentName: string;
    activityId: string;
    activityName: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
  }
  const [promotionsByPolicy, setPromotionsByPolicy] = useState<Record<string, PromotionInfo>>({});
  // Show-only-agent-promoted filter — defaults off; toggle persists in URL?
  // No, just session state for now (simple).
  const [showAgentPromotedOnly, setShowAgentPromotedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // documentType filter for the segmented control above the list.
  // 'ALL' shows everything; the four document types narrow the view.
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'ALL'>('ALL');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyPolicyForm);
  const validation = useFormValidation({ name: (v) => !(v as string)?.trim() ? 'Name is required' : null });
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Control form state
  const [showControlForm, setShowControlForm] = useState(false);
  const [editingControlId, setEditingControlId] = useState<string | null>(null);
  const [controlForm, setControlForm] = useState<ControlForm>(emptyControlForm);
  const [confirmDeleteControl, setConfirmDeleteControl] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      // Shape we need from /agent-executions for the join. The endpoint
      // already returns these fields; we only consume a subset.
      type ExecRow = { id: string; agentName: string; activityId: string; activityName: string; reviewedBy: string | null; reviewedAt: string | null; promotedDocumentId?: string | null };
      const [polRes, ctlRes, pplRes, execRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Policy[] }>(`/governance-policies${query}`),
        apiClient.get<{ success: boolean; data: Control[] }>(`/governance-controls${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: ExecRow[] }>(`/agent-executions${query}`).catch(() => ({ data: [] as ExecRow[] })),
      ]);
      setPolicies(polRes.data || []);
      setControls(ctlRes.data || []);
      setPeople(pplRes.data || []);
      // Build the promotedDocumentId → execution-summary lookup. Multiple
      // executions could theoretically map to the same doc (re-promotes are
      // rejected by the backend, but a manual reset could clear the
      // back-link); keep the most recent one.
      const byDoc: Record<string, PromotionInfo> = {};
      for (const e of (execRes.data || [])) {
        if (!e.promotedDocumentId) continue;
        const prev = byDoc[e.promotedDocumentId];
        if (!prev || (e.reviewedAt && (!prev.reviewedAt || e.reviewedAt > prev.reviewedAt))) {
          byDoc[e.promotedDocumentId] = {
            executionId: e.id, agentName: e.agentName,
            activityId: e.activityId, activityName: e.activityName,
            reviewedBy: e.reviewedBy, reviewedAt: e.reviewedAt,
          };
        }
      }
      setPromotionsByPolicy(byDoc);
    } catch (err) { setLoadError(errorMessage(err, 'Failed to load governance documents.')); }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  // ── Policy CRUD ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setForm(emptyPolicyForm); setEditingId(null); setShowForm(true); };
  const openEdit = (p: Policy) => {
    setForm({ name: p.name, description: p.description, category: p.category, status: p.status,
      ownerAssignmentId: p.ownerAssignmentId || '', reviewFrequency: p.reviewFrequency, content: p.content,
      documentType: p.documentType || 'POLICY' });
    setEditingId(p.id); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyPolicyForm); validation.clearErrors(); };

  const handleSave = async () => {
    if (!validation.validateAll(form)) return;
    try {
      const payload = { ...form, ownerAssignmentId: form.ownerAssignmentId || null,
        ...(activeOrgId ? { orgId: activeOrgId } : {}) };
      const typeLabel = DOCUMENT_TYPE_LABEL[form.documentType] || 'Document';
      if (editingId) {
        await apiClient.put(`/governance-policies/${editingId}`, payload);
        addToast('success', `${typeLabel} updated`);
      } else {
        await apiClient.post('/governance-policies', payload);
        addToast('success', `${typeLabel} created`);
      }
      closeForm(); fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to save document'));
    }
  };

  const handleDelete = async (id: string) => {
    const docType = policies.find((p) => p.id === id)?.documentType;
    const typeLabel = (docType && DOCUMENT_TYPE_LABEL[docType]) || 'Document';
    try {
      await apiClient.delete(`/governance-policies/${id}`);
      addToast('success', `${typeLabel} deleted`);
      if (expandedPolicyId === id) setExpandedPolicyId(null);
      fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to delete document')); }
  };

  // ── Control CRUD ──

  const openAddControl = () => { setControlForm(emptyControlForm); setEditingControlId(null); setShowControlForm(true); };
  const openEditControl = (c: Control) => {
    setControlForm({ name: c.name, description: c.description, controlType: c.controlType,
      automationMode: c.automationMode, evidenceRequired: c.evidenceRequired });
    setEditingControlId(c.id); setShowControlForm(true);
  };
  const closeControlForm = () => { setShowControlForm(false); setEditingControlId(null); setControlForm(emptyControlForm); };

  const handleSaveControl = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!controlForm.name.trim() || !expandedPolicyId) return;
    try {
      const payload = { ...controlForm, policyId: expandedPolicyId,
        ...(activeOrgId ? { orgId: activeOrgId } : {}) };
      if (editingControlId) {
        await apiClient.put(`/governance-controls/${editingControlId}`, payload);
        addToast('success', 'Control updated');
      } else {
        await apiClient.post('/governance-controls', payload);
        addToast('success', 'Control created');
      }
      closeControlForm(); fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to save control'));
    }
  };

  const handleDeleteControl = async (id: string) => {
    try {
      await apiClient.delete(`/governance-controls/${id}`);
      addToast('success', 'Control deleted'); fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to delete control')); }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(sel.selectedIds);
    await Promise.all(ids.map((id) => apiClient.delete(`/governance-policies/${id}`)));
    addToast('success', `Deleted ${ids.length} polic${ids.length === 1 ? 'y' : 'ies'}`);
    sel.clear();
    fetchData();
  };

  const controlsForPolicy = (policyId: string) => controls.filter((c) => c.policyId === policyId);

  // The rows the table actually renders (type filter + agent-promoted
  // filter). Selection is built over THIS list so select-all matches the
  // visible rows, not the unfiltered catalog.
  const filteredPolicies = policies
    .filter((p) => typeFilter === 'ALL' || p.documentType === typeFilter)
    .filter((p) => !showAgentPromotedOnly || !!promotionsByPolicy[p.id]);
  const sel = useRowSelection(filteredPolicies, (p) => p.id);

  const policyColumns = ([
    policyCols.isVisible('code') && {
      key: 'code', header: 'Code', cellStyle: { fontWeight: 500, fontFamily: 'monospace', fontSize: 12 },
      render: (pol: Policy) => pol.code,
    },
    policyCols.isVisible('name') && {
      key: 'name', header: 'Name', cellStyle: { fontWeight: 500, color: 'var(--color-primary)' },
      render: (pol: Policy) => {
        const docType = pol.documentType || 'POLICY';
        const promo = promotionsByPolicy[pol.id];
        return (
          <>
            <span>{pol.name}</span>
            <span style={{ ...badgeStyle(DOCUMENT_TYPE_COLORS[docType] || DOCUMENT_TYPE_COLORS.POLICY), marginLeft: 8 }}>{DOCUMENT_TYPE_LABEL[docType]}</span>
            {promo && (
              <StatusBadge
                variant="agent"
                size="md"
                outlined
                icon={<Bot size={11} strokeWidth={2.4} />}
                title={`Promoted from agent draft "${promo.activityName}" by ${promo.agentName}${promo.reviewedBy ? `, approved by ${promo.reviewedBy}` : ''}`}
                style={{ marginLeft: 8 }}
              >
                from agent draft
              </StatusBadge>
            )}
          </>
        );
      },
    },
    policyCols.isVisible('category') && {
      key: 'category', header: 'Category',
      render: (pol: Policy) => <span style={badgeStyle(CATEGORY_COLORS[pol.category] || CATEGORY_COLORS.GENERAL)}>{pol.category.replace(/_/g, ' ')}</span>,
    },
    policyCols.isVisible('status') && {
      key: 'status', header: 'Status',
      render: (pol: Policy) => <span style={badgeStyle(STATUS_COLORS[pol.status] || STATUS_COLORS.DRAFT)}>{pol.status.replace(/_/g, ' ')}</span>,
    },
    policyCols.isVisible('owner') && {
      key: 'owner', header: 'Owner',
      render: (pol: Policy) => pol.ownerName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>,
    },
    policyCols.isVisible('controls') && {
      key: 'controls', header: 'Controls',
      render: (pol: Policy) => <span style={{ fontSize: 12, fontWeight: 600 }}>{controlsForPolicy(pol.id).length}</span>,
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const, width: 100,
      render: (pol: Policy) => (
        <div style={{ display: 'inline-flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(pol)} />}
          {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(pol.id)} />}
        </div>
      ),
    },
  ].filter(Boolean) as DataTableColumn<Policy>[]);

  // A document is expandable only if it has something to show below the row:
  // a Controls panel (POLICY docType) or a Source panel (promoted from an
  // agent draft). Otherwise it shows no caret and never opens an empty row.
  const isPolicyExpandable = (p: Policy) =>
    (p.documentType || 'POLICY') === 'POLICY' || !!promotionsByPolicy[p.id];

  const renderPolicyExpansion = (pol: Policy) => {
    const promo = promotionsByPolicy[pol.id];
    const docType = pol.documentType || 'POLICY';
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Source / provenance — shown for ANY documentType promoted from an
            agent draft, so the round-trip to the source activity is reachable. */}
        {promo && (
          <div style={{ background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: 'var(--radius-md)', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <StatusBadge variant="agent" icon={<Bot size={12} strokeWidth={2.4} />}>Source</StatusBadge>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#5b21b6' }}>Promoted from agent draft</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 6, fontSize: 13 }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Source activity</span>
              <a href={`/processes?node=${encodeURIComponent(promo.activityId)}`} title="Open the activity in the Process Catalog" style={{ color: 'var(--color-primary)', fontWeight: 500, textDecoration: 'none' }}>{promo.activityName}</a>

              <span style={{ color: 'var(--color-text-muted)' }}>Agent</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Bot size={12} strokeWidth={2.4} style={{ color: '#5b21b6' }} /> {promo.agentName}</span>

              <span style={{ color: 'var(--color-text-muted)' }}>Approved by</span>
              <span>{promo.reviewedBy || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>—</span>}</span>

              <span style={{ color: 'var(--color-text-muted)' }}>Approved at</span>
              <span>{promo.reviewedAt ? new Date(promo.reviewedAt).toLocaleString() : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>—</span>}</span>
            </div>
            <p style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              <strong>{pol.name}</strong> was created by promoting an approved AI-generated draft from the activity above. The draft's source-status note is preserved in the document's <em>Description</em>.
            </p>
          </div>
        )}

        {/* Controls — only for documentType POLICY. Charters, frameworks and
            standards don't have rule-shaped controls hanging off them. */}
        {docType === 'POLICY' && (
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Controls for {pol.name}</h3>
              {canWrite && <Button variant="primary" size="sm" onClick={openAddControl}>+ Add Control</Button>}
            </div>

            {/* Control Add/Edit Form */}
            {showControlForm && (
              <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{editingControlId ? 'Edit Control' : 'Add Control'}</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Name *</label>
                    <input autoFocus aria-label="Name" style={inputStyle} value={controlForm.name} onChange={(e) => setControlForm({ ...controlForm, name: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Description</label>
                    <textarea aria-label="Description" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={controlForm.description} onChange={(e) => setControlForm({ ...controlForm, description: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Control Type</label>
                    <select aria-label="Control Type" style={selectStyle} value={controlForm.controlType} onChange={(e) => setControlForm({ ...controlForm, controlType: e.target.value })}>
                      {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Automation Mode</label>
                    <select aria-label="Automation Mode" style={selectStyle} value={controlForm.automationMode} onChange={(e) => setControlForm({ ...controlForm, automationMode: e.target.value })}>
                      {AUTOMATION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                    <input type="checkbox" checked={controlForm.evidenceRequired} onChange={(e) => setControlForm({ ...controlForm, evidenceRequired: e.target.checked })} />
                    <label style={{ fontSize: 12, fontWeight: 500 }}>Evidence Required</label>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                  <Button variant="secondary" size="sm" onClick={closeControlForm}>Cancel</Button>
                  <Button variant="primary" size="sm"
                    disabled={!controlForm.name.trim()} onClick={handleSaveControl}>
                    {editingControlId ? 'Save' : 'Add'}
                  </Button>
                </div>
              </div>
            )}

            {/* Controls Table */}
            {controlsForPolicy(pol.id).length === 0 && !showControlForm ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>No controls defined for this policy.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th scope="col" style={thStyle}>Code</th>
                    <th scope="col" style={thStyle}>Name</th>
                    <th scope="col" style={thStyle}>Type</th>
                    <th scope="col" style={thStyle}>Mode</th>
                    <th scope="col" style={thStyle}>Evidence</th>
                    <th scope="col" style={{ ...thStyle, width: 100, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {controlsForPolicy(pol.id).map((ctl) => (
                    <tr key={ctl.id} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{ctl.code}</td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{ctl.name}</td>
                      <td style={tdStyle}><span style={badgeStyle({ bg: '#e0e7ff', color: '#3730a3' })}>{ctl.controlType}</span></td>
                      <td style={tdStyle}><span style={badgeStyle({ bg: '#ccfbf1', color: '#115e59' })}>{ctl.automationMode}</span></td>
                      <td style={tdStyle}>{ctl.evidenceRequired ? 'Yes' : 'No'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEditControl(ctl)} />}
                          {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDeleteControl(ctl.id)} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <DependencyBanner phase="Governance documents should follow governance structure and domain definition." checks={[
        { label: 'Create data domains', met: deps.hasDomains, link: '/data-domains' },
        { label: 'Establish governance groups', met: deps.hasGroups, link: '/governance' },
      ]} />
      {/* Header */}
      <PageHeader
        title="Governance Documents"
        subtitle="Charters, frameworks, standards, and policies — every formal governance document with a lifecycle, owner, and review cadence."
        actions={
          <>
            <ColumnPicker state={policyCols} />
            {canWrite && <IconButton icon="plus" label="Add document" variant="primary" onClick={openAdd} />}
          </>
        }
      />

      {/* documentType filter — segmented control. "All" is the
          default so the page still reads as one combined list. */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['ALL', ...DOCUMENT_TYPES] as const).map((t) => {
          const active = typeFilter === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              style={{
                padding: '4px 12px', fontSize: 12, fontWeight: 500,
                borderRadius: 999, cursor: 'pointer',
                background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                color: active ? '#fff' : 'var(--color-text)',
                border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}
            >
              {t === 'ALL' ? 'All' : DOCUMENT_TYPE_LABEL[t]}
            </button>
          );
        })}
        {/* Agent-promoted toggle. Counts surface even when the toggle is
            off so the user knows there are AI-originated docs in the list. */}
        {Object.keys(promotionsByPolicy).length > 0 && (
          <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={showAgentPromotedOnly} onChange={(e) => setShowAgentPromotedOnly(e.target.checked)} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Bot size={12} strokeWidth={2.4} style={{ color: '#5b21b6' }} /> Show only agent-promoted ({Object.keys(promotionsByPolicy).length})</span>
          </label>
        )}
      </div>

      {(() => {
        const doc = confirmDelete ? policies.find((p) => p.id === confirmDelete) : null;
        const docType = doc?.documentType || 'POLICY';
        const typeLabel = DOCUMENT_TYPE_LABEL[docType] || 'Document';
        const controlCount = confirmDelete ? controlsForPolicy(confirmDelete).length : 0;
        const orphanClause = controlCount > 0
          ? ` and orphan its ${controlCount} control${controlCount === 1 ? '' : 's'}`
          : '';
        return (
          <ConfirmDialog open={confirmDelete !== null} title={`Delete ${typeLabel}?`}
            message={`This will permanently delete this ${typeLabel.toLowerCase()}${orphanClause}. This cannot be undone.`} confirmLabel="Delete"
            onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
            onCancel={() => setConfirmDelete(null)} />
        );
      })()}

      <ConfirmDialog open={confirmDeleteControl !== null} title="Delete Control?"
        message="This will permanently delete this control." confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDeleteControl; setConfirmDeleteControl(null); if (id) await handleDeleteControl(id); }}
        onCancel={() => setConfirmDeleteControl(null)} />

      {/* Add/Edit Document Form */}
      {showForm && (
        <Card padding={20} marginBottom={20}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingId ? `Edit ${DOCUMENT_TYPE_LABEL[form.documentType] || 'Document'}` : `Add New ${DOCUMENT_TYPE_LABEL[form.documentType] || 'Document'}`}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Name *</label>
              <input autoFocus
                aria-label="Name"
                style={{ ...inputStyle, border: validation.fieldError('name') ? inputErrorBorder : inputStyle.border }}
                value={form.name}
                onChange={(e) => { const v = e.target.value; setForm({ ...form, name: v }); if (validation.touched.name) validation.validateField('name', v, form); }}
                onBlur={() => { validation.touch('name'); validation.validateField('name', form.name, form); }}
                placeholder="e.g. Data Classification Policy" />
              {validation.fieldError('name') && <div style={fieldErrorStyle}>{validation.fieldError('name')}</div>}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Description</label>
              <textarea aria-label="Description" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Document Type</label>
              <select aria-label="Document Type" style={selectStyle} value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value as DocumentType })}>
                {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select aria-label="Category" style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select aria-label="Status" style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <select aria-label="Owner" style={selectStyle} value={form.ownerAssignmentId} onChange={(e) => setForm({ ...form, ownerAssignmentId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
            </div>
            {/* Review Frequency and Content removed: Review Frequency drove
                nothing (nextReviewDate was never computed from it, so the
                Review Due column always read "--"), and Content ("full policy
                text") had no read surface. Stored values are retained. */}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button variant="primary" disabled={!form.name.trim()} onClick={handleSave}>
              {editingId ? 'Save Changes' : `Add ${DOCUMENT_TYPE_LABEL[form.documentType] || 'Document'}`}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${sel.count} polic${sel.count === 1 ? 'y' : 'ies'}?`}
        message="This cannot be undone."
        confirmLabel={`Delete ${sel.count}`}
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      {/* Policies Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
        ) : loading ? (
          <SkeletonRows rows={5} columns={8} />
        ) : policies.length === 0 && !showForm ? (
          <EmptyState icon={renderNavIcon('/governance-policies')} title="No governance documents yet"
            description="Charters set the program's scope, policies set the rules, standards set the conventions, and frameworks set the structure. Create your first document to get started."
            action={canWrite ? { label: '+ Add Document', onClick: openAdd } : undefined} />
        ) : (
          <DataTable
            rows={filteredPolicies}
            columns={policyColumns}
            rowKey={(p) => p.id}
            selection={sel}
            selectAllLabel="Select all documents"
            emptyMessage="No documents match the current filters."
            expansion={{
              expandedIds: expandedPolicyId ? new Set([expandedPolicyId]) : new Set(),
              onToggleExpanded: (id) => {
                setExpandedPolicyId((prev) => (prev === id ? null : id));
                closeControlForm();
              },
              getRowExpandable: isPolicyExpandable,
              renderExpandedRow: renderPolicyExpansion,
              trigger: 'row-click',
            }}
          />
        )}
      </div>
    </div>
  );
}
