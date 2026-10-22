import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import { apiClient } from '../api/client';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { HeaderEditActions } from '../components/DetailEditActions';
import { thStyle, tdStyle } from '../lib/tableStyles';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import SecondaryButton from '../components/SecondaryButton';
import Tabs from '../components/Tabs';
import ActivityFeed from '../components/ActivityFeed';
import StatusBadge from '../components/StatusBadge';
import Button from '../components/Button';
import OwnerCell from '../components/OwnerCell';
import { relativeTime, absoluteTime } from '../lib/relativeTime';
import { useOrgContext } from '../stores/orgContext';
import AttachmentsPanel from '../components/AttachmentsPanel';
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
import ExportMenu from '../components/ExportMenu';
import ListToolbar from '../components/ListToolbar';
import SavedViewsMenu from '../components/SavedViewsMenu';
import { useSortedList } from '../hooks/useSortedList';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import { exportData } from '../lib/export';
import { useFormValidation } from '../hooks/useFormValidation';

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

// The procedures (SOPs) that implement a document — the reverse of the
// procedure→document link authored on the Procedures page.
interface SopRef { id: string; code: string; title: string; governancePolicyId: string | null; }

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
    textTransform: 'uppercase', letterSpacing: '0.03em',
  };
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

const docMenuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};
const filterSelectStyle: React.CSSProperties = {
  height: 34, padding: '0 8px', fontSize: 13, border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)',
};

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

// Detail-page section card (used across the document detail tabs).
const panelStyle: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', padding: 20,
};
// Inline mini-form (Link existing / New procedure) inside a section.
const inlineFormBox: React.CSSProperties = {
  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', padding: 12, marginTop: 10,
};
// A single clickable reference row (procedure, mapped step, exception).
const rowLinkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 520,
  background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', cursor: 'pointer', font: 'inherit', fontSize: 13, color: 'var(--color-primary)',
  textDecoration: 'none', textAlign: 'left',
};
// The header "⋯" overflow button + its dropdown (matches the list row menu).
const headerMenuBtnStyle: React.CSSProperties = {
  width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8,
  color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
};
const headerMenuStyle: React.CSSProperties = {
  position: 'absolute', top: 36, right: 0, zIndex: 30, minWidth: 180,
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
  padding: 6, textAlign: 'left',
};

// Code + category fold into the name cell's sub-line, type is plain text, and
// Next review is surfaced — so the picker manages the optional columns only.
type PolicyColId = 'type' | 'status' | 'owner' | 'controls' | 'nextReview' | 'updated';
const POLICY_COLUMN_DEFS: Array<{ id: PolicyColId; label: string; defaultVisible: boolean }> = [
  { id: 'type',       label: 'Type',        defaultVisible: true },
  { id: 'status',     label: 'Status',      defaultVisible: true },
  { id: 'owner',      label: 'Owner',       defaultVisible: true },
  { id: 'controls',   label: 'Controls',    defaultVisible: true },
  { id: 'nextReview', label: 'Next review', defaultVisible: true },
  { id: 'updated',    label: 'Updated',     defaultVisible: true },
];

// Plain-English hint for each document type card.
const DOCUMENT_TYPE_HINT: Record<DocumentType, string> = {
  CHARTER:   'Why the program exists and who has authority.',
  FRAMEWORK: 'How the program is organised and run.',
  STANDARD:  'Measurable rules data must meet.',
  POLICY:    'What people must or must not do, with controls.',
};

// Longer "what this document is" copy for the detail-page explainer rail.
const DOCUMENT_TYPE_EXPLAINER: Record<DocumentType, string> = {
  CHARTER:   'A charter sets out why the governance program exists, its scope, and who holds authority. It sits at the top of the document hierarchy — frameworks, standards and policies all answer to it.',
  FRAMEWORK: 'A framework describes how the program is organised and run: the operating model, roles and decision forums that put the charter into practice.',
  STANDARD:  'A standard sets measurable rules data must meet — thresholds, formats, tiers. Standards are testable, and policies point to them.',
  POLICY:    'A policy states what people must or must not do, and carries the controls that enforce it. Policies are the only document type with controls.',
};

// Review cadence → plain label, for the Facts rail and the review-schedule card.
const REVIEW_FREQUENCY_LABEL: Record<string, string> = {
  QUARTERLY: 'Quarterly', SEMI_ANNUAL: 'Every 6 months', ANNUAL: 'Annually',
  BIENNIAL: 'Every 2 years', NONE: 'Not scheduled',
};

// ── Component ──

// The document field grid — shared by the top "Add" form (create) and the
// in-row editor (PolicyDetailsPanel).
function PolicyFields({ form, setForm, people }: {
  form: PolicyForm;
  setForm: (next: PolicyForm) => void;
  people: Person[];
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Name *</label>
        <input aria-label="Name" style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Classification Policy" />
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
    </div>
  );
}

// The document-details panel at the top of a policy's expansion: read-only
// fields with a view/edit toggle. Edit flips to PolicyFields in place and one
// Save writes PUT /governance-policies/:id (round-tripping the stored content /
// reviewFrequency that the form doesn't surface). Replaces the per-row Edit
// icon → top-of-page form.
function PolicyDetailsPanel({ policy, people, canEdit, orgId, onSaved, actionsSlot, hideViewBody }: {
  policy: Policy;
  people: Person[];
  canEdit: boolean;
  orgId: string | null;
  onSaved: () => void;
  /** When set, the Edit / Save·Cancel cluster renders into the page header's
   *  actions slot (the detail-page placement) instead of in the card header. */
  actionsSlot?: HTMLElement | null;
  /** Detail-page mode: the read-only fields live in the Facts rail, so at rest
   *  this renders nothing but the portaled Edit button. Clicking Edit flips to
   *  the in-place form card. */
  hideViewBody?: boolean;
}) {
  const m = useDetailEditMode<PolicyForm>(
    {
      name: policy.name,
      description: policy.description,
      category: policy.category,
      status: policy.status,
      ownerAssignmentId: policy.ownerAssignmentId || '',
      reviewFrequency: policy.reviewFrequency,
      content: policy.content,
      documentType: policy.documentType || 'POLICY',
    },
    async (draft) => {
      if (!draft.name.trim()) { errorToast(null, 'Name is required'); throw new Error('no-name'); }
      try {
        await apiClient.put(`/governance-policies/${policy.id}`, {
          ...draft,
          ownerAssignmentId: draft.ownerAssignmentId || null,
          ...(orgId ? { orgId } : {}),
        });
        successToast(`${DOCUMENT_TYPE_LABEL[draft.documentType] || 'Document'} updated`);
        onSaved();
      } catch (err) { errorToast(err, 'Failed to update document'); throw err; }
    },
  );
  const typeColors = DOCUMENT_TYPE_COLORS[policy.documentType || 'POLICY'];
  const catColors = CATEGORY_COLORS[policy.category] || CATEGORY_COLORS.GENERAL;
  const statusColors = STATUS_COLORS[policy.status] || STATUS_COLORS.DRAFT;
  const metaItem = (label: string, node: React.ReactNode) => (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13 }}>{node}</div>
    </div>
  );
  const emptyEm = <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>—</span>;
  // Detail-page: facts are in the rail, so at rest surface only the Edit
  // button (portaled into the header). Editing falls through to the form card.
  if (hideViewBody && !m.isEditing) {
    return <HeaderEditActions slot={actionsSlot} editing={m.isEditing} canEdit={canEdit} dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />;
  }
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: m.isEditing ? 12 : 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>{m.isEditing ? 'Edit document' : 'Document details'}</h3>
        <HeaderEditActions slot={actionsSlot} editing={m.isEditing} canEdit={canEdit} dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
      </div>
      {m.isEditing ? (
        <PolicyFields form={m.draft} setForm={(next) => m.patch(next)} people={people} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            {metaItem('Type', <span style={badgeStyle(typeColors)}>{DOCUMENT_TYPE_LABEL[policy.documentType || 'POLICY']}</span>)}
            {metaItem('Category', <span style={badgeStyle(catColors)}>{policy.category.replace(/_/g, ' ')}</span>)}
            {metaItem('Status', <span style={badgeStyle(statusColors)}>{policy.status.replace(/_/g, ' ')}</span>)}
            {metaItem('Owner', policy.ownerName || emptyEm)}
          </div>
          {metaItem('Description', policy.description ? <span style={{ color: 'var(--color-text-secondary)' }}>{policy.description}</span> : emptyEm)}
        </div>
      )}
    </div>
  );
}

export default function GovernancePoliciesPage({ focusPolicyId }: { focusPolicyId?: string } = {}) {
  const { activeOrgId } = useOrgContext();
  // Governance CRUD (policies + controls) needs governance:write = admins.
  // Attachments go through the collaboration:write route (editors too), so
  // that panel keeps the looser canWrite gate.
  const { canWrite, isAdmin } = usePermissions();
  const deps = useDependencyChecks();
  const { addToast } = useToastStore();
  const navigate = useNavigate();

  // v3 — code/category folded into the name sub-line; Next review surfaced.
  const policyCols = useColumnPicker<PolicyColId>('procela.governancePolicies.visibleCols.v3', POLICY_COLUMN_DEFS);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [sops, setSops] = useState<SopRef[]>([]);
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
  // documentType filter — chosen via the type-explainer cards.
  // 'ALL' shows everything; the four document types narrow the view.
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'ALL'>('ALL');
  // Toolbar filters: free-text search + Status / Category / Owner.
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  // Per-row "⋯" actions menu.
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyPolicyForm);
  const validation = useFormValidation({ name: (v) => !(v as string)?.trim() ? 'Name is required' : null });
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  // Header slot the document detail panel portals its Edit / Save·Cancel
  // cluster into on the /governance-policies/:id route (People-style header).
  const [docActionsSlot, setDocActionsSlot] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Control form state
  const [showControlForm, setShowControlForm] = useState(false);
  const [editingControlId, setEditingControlId] = useState<string | null>(null);
  const [controlForm, setControlForm] = useState<ControlForm>(emptyControlForm);
  const [confirmDeleteControl, setConfirmDeleteControl] = useState<string | null>(null);

  // ── Detail-page (/governance-policies/:id) state ──
  // Live attachment count drives the "source linked" completeness card; the
  // AttachmentsPanel keeps it in sync via onCount once Overview is mounted.
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  // Reverse-links for the "Used by" tab: process steps mapped to this document
  // and governance exceptions filed against it. Fetched only on the detail page.
  const [policyMappings, setPolicyMappings] = useState<any[]>([]);
  const [policyExceptions, setPolicyExceptions] = useState<any[]>([]);
  // Header "⋯" overflow menu (Finish review / Delete).
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  useEffect(() => {
    if (!docMenuOpen) return;
    const close = () => setDocMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [docMenuOpen]);
  // "Link existing" / "New procedure" inline actions in the Procedures section.
  const [procAction, setProcAction] = useState<'none' | 'link' | 'new'>('none');
  const [linkProcId, setLinkProcId] = useState('');
  const [newProcTitle, setNewProcTitle] = useState('');
  const [procSaving, setProcSaving] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoadError(null);
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      // Shape we need from /agent-executions for the join. The endpoint
      // already returns these fields; we only consume a subset.
      type ExecRow = { id: string; agentName: string; activityId: string; activityName: string; reviewedBy: string | null; reviewedAt: string | null; promotedDocumentId?: string | null };
      const [polRes, ctlRes, pplRes, execRes, sopRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Policy[] }>(`/governance-policies${query}`),
        apiClient.get<{ success: boolean; data: Control[] }>(`/governance-controls${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: ExecRow[] }>(`/agent-executions${query}`).catch(() => ({ data: [] as ExecRow[] })),
        apiClient.get<{ success: boolean; data: SopRef[] }>(`/sops${query}`).catch(() => ({ data: [] as SopRef[] })),
      ]);
      setPolicies(polRes.data || []);
      setControls(ctlRes.data || []);
      setPeople(pplRes.data || []);
      setSops(sopRes.data || []);
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

  // On the detail route (/governance-policies/:id) the control CRUD handlers
  // target `expandedPolicyId`, so point it at the focused document; the trail
  // ends on the document name ("Dashboard › Documents › Data Classification").
  useEffect(() => { if (focusPolicyId) setExpandedPolicyId(focusPolicyId); }, [focusPolicyId]);
  const focusedPolicy = focusPolicyId ? policies.find((p) => p.id === focusPolicyId) : null;
  useBreadcrumbLeaf(focusedPolicy?.name);

  // Detail-page reverse-links + attachment count — only the /:id route pays
  // for these, so the list load stays lean.
  useEffect(() => {
    if (!focusPolicyId) { setAttachmentCount(null); return; }
    apiClient.get<{ data: Array<unknown> }>(`/attachments?entityType=GovernancePolicy&entityId=${focusPolicyId}`)
      .then((r) => setAttachmentCount((r.data || []).length))
      .catch(() => setAttachmentCount(null));
  }, [focusPolicyId]);
  useEffect(() => {
    if (!focusPolicyId) return;
    const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
    Promise.all([
      apiClient.get<{ data: any[] }>(`/mappings${query}`).catch(() => ({ data: [] as any[] })),
      apiClient.get<{ data: any[] }>(`/governance-exceptions${query}`).catch(() => ({ data: [] as any[] })),
    ]).then(([m, e]) => {
      setPolicyMappings((m.data || []).filter((row: any) => row?.policyId === focusPolicyId));
      setPolicyExceptions((e.data || []).filter((row: any) => row?.policyId === focusPolicyId));
    });
  }, [focusPolicyId, activeOrgId]);

  // ── Policy CRUD ──

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setForm(emptyPolicyForm); setEditingId(null); setShowForm(true); };
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

  // Mark an under-review document as active (the "Finish review" row action).
  const finishReview = async (pol: Policy) => {
    try {
      await apiClient.put(`/governance-policies/${pol.id}`, { status: 'ACTIVE', ...(activeOrgId ? { orgId: activeOrgId } : {}) });
      addToast('success', `${DOCUMENT_TYPE_LABEL[pol.documentType || 'POLICY']} marked active`);
      fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to update document'));
    }
  };

  // ── Procedures (SOPs) implementing this document ──
  // Link an existing standalone procedure, or create a new one already
  // pointed at this document — so a user never has to leave the page to make
  // the procedure→document connection.
  const handleLinkProcedure = async (pol: Policy) => {
    if (!linkProcId) return;
    setProcSaving(true);
    try {
      await apiClient.put(`/sops/${linkProcId}`, { governancePolicyId: pol.id });
      addToast('success', 'Procedure linked');
      setProcAction('none'); setLinkProcId('');
      await fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to link procedure'));
    } finally { setProcSaving(false); }
  };
  const handleCreateProcedure = async (pol: Policy) => {
    if (!newProcTitle.trim()) return;
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setProcSaving(true);
    try {
      await apiClient.post('/sops', { title: newProcTitle.trim(), orgId: activeOrgId, governancePolicyId: pol.id });
      addToast('success', 'Procedure created and linked');
      setProcAction('none'); setNewProcTitle('');
      await fetchData();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || errorMessage(err, 'Failed to create procedure'));
    } finally { setProcSaving(false); }
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

  // Bulk setters (board F8): set status / assign owner across the selection,
  // through the same PUT the per-document editor uses.
  const bulkSetStatus = async (status: string) => {
    const ids = Array.from(sel.selectedIds);
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => apiClient.put(`/governance-policies/${id}`, { status, ...(activeOrgId ? { orgId: activeOrgId } : {}) })));
      addToast('success', `Set ${ids.length} document${ids.length === 1 ? '' : 's'} to ${status.replace(/_/g, ' ')}`);
      sel.clear();
      fetchData();
    } catch (err) {
      errorToast(err, 'Failed to set status');
    }
  };

  const bulkAssignOwner = async (ownerAssignmentId: string) => {
    const ids = Array.from(sel.selectedIds);
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => apiClient.put(`/governance-policies/${id}`, { ownerAssignmentId, ...(activeOrgId ? { orgId: activeOrgId } : {}) })));
      const ownerName = people.find((p) => p.id === ownerAssignmentId)?.name || 'selected owner';
      addToast('success', `Assigned ${ownerName} to ${ids.length} document${ids.length === 1 ? '' : 's'}`);
      sel.clear();
      fetchData();
    } catch (err) {
      errorToast(err, 'Failed to assign owner');
    }
  };

  // Export just the selected documents — same columns as the toolbar export.
  const bulkExport = () => {
    const chosen = policies.filter((p) => sel.isSelected(p.id));
    if (chosen.length === 0) return;
    exportData('csv', {
      filenameBase: 'governance-documents-selection',
      sheetName: 'Documents',
      headers: ['Code', 'Name', 'Category', 'Status', 'Owner', 'Controls'],
      rows: chosen.map((pol) => [
        pol.code, pol.name, (pol.category || '').replace(/_/g, ' '),
        (pol.status || '').replace(/_/g, ' '), pol.ownerName || '', controlsForPolicy(pol.id).length,
      ]),
    });
  };

  const controlsForPolicy = (policyId: string) => controls.filter((c) => c.policyId === policyId);
  const proceduresForPolicy = (policyId: string) => sops.filter((s) => s.governancePolicyId === policyId);

  // The rows the table actually renders (type filter + agent-promoted
  // filter). Selection is built over THIS list so select-all matches the
  // visible rows, not the unfiltered catalog.
  const q = searchQuery.trim().toLowerCase();
  const filteredPolicies = policies
    .filter((p) => typeFilter === 'ALL' || p.documentType === typeFilter)
    .filter((p) => !showAgentPromotedOnly || !!promotionsByPolicy[p.id])
    .filter((p) => !statusFilter || p.status === statusFilter)
    .filter((p) => !categoryFilter || p.category === categoryFilter)
    .filter((p) => !ownerFilter || p.ownerAssignmentId === ownerFilter)
    .filter((p) => !q || `${p.name} ${p.code} ${p.ownerName || ''} ${p.category}`.toLowerCase().includes(q));
  const anyToolbarFilter = !!(q || statusFilter || categoryFilter || ownerFilter);
  // Sort — URL-persisted via ?sort=&dir=. Owner sorts by the resolved
  // owner name (what the cell shows); unassigned rows sort last regardless
  // of direction. Controls sorts by the joined control count.
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    filteredPolicies,
    {
      name: (a, b) => (a.name || '').localeCompare(b.name || ''),
      type: (a, b) => (a.documentType || '').localeCompare(b.documentType || ''),
      status: (a, b) => (a.status || '').localeCompare(b.status || ''),
      owner: (a, b) => {
        const an = a.ownerName || '';
        const bn = b.ownerName || '';
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn);
      },
      controls: (a, b) => controlsForPolicy(a.id).length - controlsForPolicy(b.id).length,
      nextReview: (a, b) => (a.nextReviewDate || '￿').localeCompare(b.nextReviewDate || '￿'),
      updated: (a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt),
    },
    'name',
  );
  const sel = useRowSelection(sorted, (p) => p.id);

  const policyColumns = ([
    // Name always shows; code + category live on a muted sub-line beneath it.
    {
      key: 'name', header: 'Document', sortable: true, cellStyle: { fontWeight: 500 },
      render: (pol: Policy) => {
        const promo = promotionsByPolicy[pol.id];
        return (
          <div style={{ minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => navigate(`/governance-policies/${pol.id}`)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>{pol.name}</button>
              {promo && (
                <StatusBadge variant="agent" size="md" outlined icon={<Bot size={11} strokeWidth={2.4} />} title={`Promoted from agent draft "${promo.activityName}" by ${promo.agentName}${promo.reviewedBy ? `, approved by ${promo.reviewedBy}` : ''}`}>from agent draft</StatusBadge>
              )}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{pol.code}</span> · {pol.category.replace(/_/g, ' ').toLowerCase()}
            </span>
          </div>
        );
      },
    },
    policyCols.isVisible('type') && {
      key: 'type', header: 'Type', sortable: true,
      render: (pol: Policy) => <span style={{ color: 'var(--color-text-secondary)' }}>{DOCUMENT_TYPE_LABEL[pol.documentType || 'POLICY']}</span>,
    },
    policyCols.isVisible('status') && {
      key: 'status', header: 'Status', sortable: true,
      render: (pol: Policy) => {
        const c = STATUS_COLORS[pol.status] || STATUS_COLORS.DRAFT;
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 13, fontSize: 13, fontWeight: 600, background: c.bg, color: c.color }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />{pol.status.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}</span>;
      },
    },
    policyCols.isVisible('owner') && {
      key: 'owner', header: 'Owner', sortable: true,
      render: (pol: Policy) => <OwnerCell name={pol.ownerName} emptyLabel="Unassigned" />,
    },
    policyCols.isVisible('controls') && {
      key: 'controls', header: 'Controls', sortable: true,
      // Only policies carry controls; charters / frameworks / standards don't.
      render: (pol: Policy) => (pol.documentType || 'POLICY') === 'POLICY'
        ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{controlsForPolicy(pol.id).length}</span>
        : <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
    },
    policyCols.isVisible('nextReview') && {
      key: 'nextReview', header: 'Next review', sortable: true, width: 130,
      render: (pol: Policy) => pol.nextReviewDate
        ? <span title={absoluteTime(pol.nextReviewDate)} style={{ color: 'var(--color-text-secondary)' }}>{new Date(pol.nextReviewDate).toLocaleDateString()}</span>
        : (isAdmin ? <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/governance-policies/${pol.id}`); }} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 13, color: 'var(--color-primary)', cursor: 'pointer' }}>Set review date</button> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>),
    },
    policyCols.isVisible('updated') && {
      key: 'updated', header: 'Updated', sortable: true, width: 110,
      render: (pol: Policy) => <span title={absoluteTime(pol.updatedAt)}>{relativeTime(pol.updatedAt)}</span>,
    },
    {
      key: 'actions', header: 'Actions', align: 'right' as const, width: 160,
      render: (pol: Policy) => (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
          {isAdmin && pol.status === 'UNDER_REVIEW' && (
            <Button variant="secondary" size="sm" onClick={() => finishReview(pol)}>Finish review</Button>
          )}
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <button type="button" aria-label={`More actions for ${pol.name}`} aria-haspopup="menu" aria-expanded={rowMenuId === pol.id} onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === pol.id ? null : pol.id); }} style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
            {rowMenuId === pol.id && (
              <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 160, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); navigate(`/governance-policies/${pol.id}`); }} style={docMenuItemStyle}>Open</button>
                {isAdmin && <button type="button" role="menuitem" onClick={() => { setRowMenuId(null); setConfirmDelete(pol.id); }} style={{ ...docMenuItemStyle, color: 'var(--color-error)' }}>Delete</button>}
              </div>
            )}
          </span>
        </div>
      ),
    },
  ].filter(Boolean) as DataTableColumn<Policy>[]);

  // Every document is expandable — the expansion always carries a "Linked
  // documents" panel (point at the real file on SharePoint, a web page, a file
  // server, or upload a copy), plus Controls (POLICY docType) and a Source
  // panel (promoted from an agent draft) when those apply.
  // ── Document-detail section helpers (the /:id route) ──
  // Each builds one card/panel; the focus block below composes them into the
  // two-column Overview and the Content / Used by / Activity tabs.

  const twoColDetail = (main: React.ReactNode, aside: React.ReactNode) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <main style={{ flex: '999 1 540px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{main}</main>
      <aside style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 16 }}>{aside}</aside>
    </div>
  );

  // One completeness/gap card for the strip under the document header.
  const gapCard = (tone: 'warn' | 'ok' | 'info', title: string, detail: React.ReactNode) => {
    const palette = tone === 'warn'
      ? { bg: 'var(--color-warning-light, #fffbeb)', border: '#fcd9a5', color: 'var(--color-warning)' }
      : tone === 'ok'
        ? { bg: '#ecfdf5', border: '#a7f3d0', color: 'var(--color-success)' }
        : { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' };
    return (
      <div style={{ flex: '1 1 200px', minWidth: 180, background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: palette.color, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{detail}</div>
      </div>
    );
  };

  const renderGapStrip = (pol: Policy) => {
    const procs = proceduresForPolicy(pol.id);
    const hasSource = (attachmentCount ?? 0) > 0;
    const freq = pol.reviewFrequency || 'NONE';
    const hasSchedule = freq !== 'NONE' && !!pol.nextReviewDate;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        {hasSource
          ? gapCard('ok', 'Source linked', <>{attachmentCount} source {attachmentCount === 1 ? 'link' : 'links'} on file.</>)
          : gapCard('warn', 'No source linked', <>Point this document at the file people actually read. <strong>Link a source in Overview.</strong></>)}
        {procs.length > 0
          ? gapCard('ok', 'Put into practice', <>{procs.length} procedure{procs.length === 1 ? '' : 's'} carr{procs.length === 1 ? 'ies' : 'y'} this out.</>)
          : gapCard('warn', 'No procedures put it into practice', <>A document no procedure carries out is just words. <strong>Link or add one in Overview.</strong></>)}
        {hasSchedule
          ? gapCard('info', 'Review schedule', <>{REVIEW_FREQUENCY_LABEL[freq]} · next {new Date(pol.nextReviewDate!).toLocaleDateString()}.</>)
          : gapCard('warn', 'No review schedule', <>Nothing says when this is re-checked, so it can quietly go stale.</>)}
      </div>
    );
  };

  const factRow = (label: string, node: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{node}</span>
    </div>
  );

  const renderFactsRail = (pol: Policy) => {
    const docType = pol.documentType || 'POLICY';
    const freq = pol.reviewFrequency || 'NONE';
    const dash = <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>—</span>;
    return (
      <Card>
        <SectionLabel>Facts</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 2 }}>
          {factRow('Type', <span style={badgeStyle(DOCUMENT_TYPE_COLORS[docType])}>{DOCUMENT_TYPE_LABEL[docType]}</span>)}
          {factRow('Category', <span style={badgeStyle(CATEGORY_COLORS[pol.category] || CATEGORY_COLORS.GENERAL)}>{pol.category.replace(/_/g, ' ')}</span>)}
          {factRow('Status', <span style={badgeStyle(STATUS_COLORS[pol.status] || STATUS_COLORS.DRAFT)}>{pol.status.replace(/_/g, ' ')}</span>)}
          {factRow('Owner', pol.ownerName || dash)}
          {factRow('Reviewed', REVIEW_FREQUENCY_LABEL[freq] || freq)}
          {factRow('Next review', pol.nextReviewDate ? <span title={absoluteTime(pol.nextReviewDate)}>{new Date(pol.nextReviewDate).toLocaleDateString()}</span> : dash)}
          {factRow('Updated', <span title={absoluteTime(pol.updatedAt)}>{relativeTime(pol.updatedAt)}</span>)}
        </div>
      </Card>
    );
  };

  const renderExplainer = (pol: Policy) => {
    const docType = pol.documentType || 'POLICY';
    return (
      <Card>
        <SectionLabel>What a {DOCUMENT_TYPE_LABEL[docType].toLowerCase()} is</SectionLabel>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55, margin: '2px 0 0' }}>
          {DOCUMENT_TYPE_EXPLAINER[docType]}
        </p>
      </Card>
    );
  };

  const renderSourceSection = (pol: Policy) => (
    <div style={panelStyle}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Source document</h3>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 10px' }}>
        Point to where the real document lives (SharePoint, a web page, a file server) or upload a copy. Procela stores the link, not the document&rsquo;s contents.
      </p>
      <AttachmentsPanel entityType="GovernancePolicy" entityId={pol.id} orgId={activeOrgId ?? undefined} disabled={!canWrite} hideHeader onCount={setAttachmentCount} />
    </div>
  );

  const renderProceduresSection = (pol: Policy) => {
    const procs = proceduresForPolicy(pol.id);
    const unlinked = sops.filter((s) => !s.governancePolicyId);
    return (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Procedures implementing this</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
              Step-by-step procedures that carry out this document.
            </p>
          </div>
          {canWrite && procAction === 'none' && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <SecondaryButton onClick={() => { setProcAction('link'); setLinkProcId(''); }}>Link existing</SecondaryButton>
              <Button variant="primary" size="sm" onClick={() => { setProcAction('new'); setNewProcTitle(''); }}>+ New procedure</Button>
            </div>
          )}
        </div>

        {procAction === 'link' && (
          <div style={inlineFormBox}>
            {unlinked.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
                Every procedure is already linked to a document. Create a new one instead.
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select aria-label="Procedure to link" style={{ ...selectStyle, maxWidth: 360, width: 'auto' }} value={linkProcId} onChange={(e) => setLinkProcId(e.target.value)}>
                  <option value="">— Choose a procedure —</option>
                  {unlinked.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.title}</option>)}
                </select>
                <Button variant="primary" size="sm" disabled={!linkProcId || procSaving} onClick={() => handleLinkProcedure(pol)}>Link</Button>
                <SecondaryButton onClick={() => { setProcAction('none'); setLinkProcId(''); }}>Cancel</SecondaryButton>
              </div>
            )}
          </div>
        )}

        {procAction === 'new' && (
          <div style={inlineFormBox}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input autoFocus aria-label="New procedure title" placeholder="e.g. Classify a new data asset" style={{ ...inputStyle, maxWidth: 360, width: 'auto', flex: '1 1 240px' }} value={newProcTitle} onChange={(e) => setNewProcTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProcedure(pol); }} />
              <Button variant="primary" size="sm" disabled={!newProcTitle.trim() || procSaving} onClick={() => handleCreateProcedure(pol)}>Create &amp; link</Button>
              <SecondaryButton onClick={() => { setProcAction('none'); setNewProcTitle(''); }}>Cancel</SecondaryButton>
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
              Creates a draft procedure already linked to this document. Add its steps on the Procedures page.
            </p>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          {procs.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>No procedures implement this document yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {procs.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate('/documentation?tab=procedures'); }}
                    title={`Open ${s.code} on the Procedures page`}
                    style={rowLinkStyle}
                  >
                    <span style={{ display: 'inline-flex', flexShrink: 0 }}>{renderNavIcon('/documentation', { size: 13 })}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flexShrink: 0 }}>{s.code}</span>
                    <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                    <span aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>&rarr;</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const renderControlsSection = (pol: Policy) => (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>Controls for {pol.name}</h3>
        {isAdmin && <Button variant="primary" size="sm" onClick={openAddControl}>+ Add Control</Button>}
      </div>

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
            <Button variant="primary" size="sm" disabled={!controlForm.name.trim()} onClick={handleSaveControl}>
              {editingControlId ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      )}

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
                      {isAdmin && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEditControl(ctl)} />}
                      {isAdmin && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDeleteControl(ctl.id)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderProvenance = (pol: Policy) => {
    const promo = promotionsByPolicy[pol.id];
    if (!promo) return null;
    return (
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
          <strong>{pol.name}</strong> was created by promoting an approved AI-generated draft from the activity above. The draft&rsquo;s source-status note is preserved in the document&rsquo;s <em>Description</em>.
        </p>
      </div>
    );
  };

  const renderContent = (pol: Policy) => (
    <div style={panelStyle}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Document content</h3>
      {pol.content && pol.content.trim() ? (
        <div style={{ fontSize: 13.5, color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{pol.content}</div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
          This document has no body text stored in Procela. The full text usually lives in the linked source file — add it under <strong>Overview → Source document</strong>.
        </p>
      )}
    </div>
  );

  const renderUsedBy = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={panelStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Process steps governed by this</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 10px' }}>
          Steps in the process catalog mapped to this document.
        </p>
        {policyMappings.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>No process steps reference this document yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {policyMappings.map((m: any) => {
              const info = m.stepInfo;
              const label = info?.path || info?.stepName || 'Process step';
              return (
                <li key={m.id}>
                  <a href={info?.activityId ? `/processes?node=${encodeURIComponent(info.activityId)}` : '/processes'} title="Open in the Process Catalog" style={rowLinkStyle}>
                    <span style={{ display: 'inline-flex', flexShrink: 0 }}>{renderNavIcon('/processes', { size: 13 })}</span>
                    <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    <span aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>&rarr;</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div style={panelStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Exceptions against this</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 10px' }}>
          Where this document is knowingly not met, for a named reason and a set expiry.
        </p>
        {policyExceptions.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>No exceptions filed against this document.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {policyExceptions.map((ex: any) => (
              <li key={ex.id}>
                <button type="button" onClick={() => navigate('/governance-exceptions')} title="Open the Exceptions register" style={rowLinkStyle}>
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>{renderNavIcon('/governance-exceptions', { size: 13 })}</span>
                  <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.title}</span>
                  <span style={badgeStyle(ex.status === 'ACTIVE' ? { bg: '#fef3c7', color: '#92400e' } : { bg: '#f3f4f6', color: '#6b7280' })}>{ex.status === 'ACTIVE' ? 'Active' : 'Closed'}</span>
                  {ex.expiresAt && <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>expires {new Date(ex.expiresAt).toLocaleDateString()}</span>}
                  <span aria-hidden="true" style={{ marginLeft: 'auto', flexShrink: 0 }}>&rarr;</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  // ── Single-document detail (the /governance-policies/:id route) ──
  // A tabbed detail page: header (code + status) → completeness strip → the
  // Edit-in-place panel → Overview / Content / Used by / Activity tabs.
  if (focusPolicyId) {
    const backLink = <Link to="/governance-policies" style={backLinkStyle}>{'←'} Back to Documents</Link>;
    if (loadError) {
      return <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />;
    }
    if (loading) {
      return (
        <div>
          <PageHeader kicker="Governance document" title="Loading…" actions={backLink} />
          <Card><SkeletonRows rows={4} columns={2} /></Card>
        </div>
      );
    }
    if (!focusedPolicy) {
      return (
        <EmptyState
          title="Couldn't load this document"
          description="It may have been deleted, or belongs to a different organization."
          action={{ label: 'Back to Documents', onClick: () => navigate('/governance-policies') }}
        />
      );
    }
    const pol = focusedPolicy;
    const docType = pol.documentType || 'POLICY';
    const typeLabel = DOCUMENT_TYPE_LABEL[docType];
    const promo = promotionsByPolicy[pol.id];

    const header = (
      <PageHeader
        kicker={`Governance document · ${typeLabel}`}
        title={pol.name}
        copyId={pol.id}
        copyLabel="Copy document ID"
        subtitle={pol.description || undefined}
        meta={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 7px' }}>{pol.code}</span>
            <span style={badgeStyle(STATUS_COLORS[pol.status] || STATUS_COLORS.DRAFT)}>{pol.status.replace(/_/g, ' ')}</span>
          </div>
        }
        actions={<>
          {backLink}
          <span ref={setDocActionsSlot} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} />
          {isAdmin && (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button type="button" aria-label="More document actions" aria-haspopup="menu" aria-expanded={docMenuOpen}
                onClick={(e) => { e.stopPropagation(); setDocMenuOpen((o) => !o); }} style={headerMenuBtnStyle}>⋯</button>
              {docMenuOpen && (
                <div role="menu" onClick={(e) => e.stopPropagation()} style={headerMenuStyle}>
                  {pol.status === 'UNDER_REVIEW' && (
                    <button type="button" role="menuitem" style={docMenuItemStyle} onClick={() => { setDocMenuOpen(false); finishReview(pol); }}>Finish review</button>
                  )}
                  {promo && (
                    <button type="button" role="menuitem" style={docMenuItemStyle} onClick={() => { setDocMenuOpen(false); navigate(`/processes?node=${encodeURIComponent(promo.activityId)}`); }}>Open source activity</button>
                  )}
                  <button type="button" role="menuitem" style={{ ...docMenuItemStyle, color: 'var(--color-error)' }} onClick={() => { setDocMenuOpen(false); setConfirmDeleteDoc(true); }}>Delete document</button>
                </div>
              )}
            </span>
          )}
        </>}
      />
    );

    return (
      <div>
        <ConfirmDialog open={confirmDeleteControl !== null} title="Delete Control?"
          message="This will permanently delete this control." confirmLabel="Delete"
          onConfirm={async () => { const id = confirmDeleteControl; setConfirmDeleteControl(null); if (id) await handleDeleteControl(id); }}
          onCancel={() => setConfirmDeleteControl(null)} />
        <ConfirmDialog open={confirmDeleteDoc} title={`Delete ${typeLabel.toLowerCase()}?`}
          message={`This permanently deletes "${pol.name}"${docType === 'POLICY' ? ' and its controls' : ''}.`} confirmLabel="Delete"
          onConfirm={async () => { setConfirmDeleteDoc(false); await handleDelete(pol.id); navigate('/governance-policies'); }}
          onCancel={() => setConfirmDeleteDoc(false)} />

        {header}
        {renderGapStrip(pol)}
        {/* At rest this renders only the header Edit button; Edit flips to the
            in-place field form here, above the tabs. */}
        <div style={{ marginBottom: 16 }}>
          <PolicyDetailsPanel policy={pol} people={people} canEdit={isAdmin} orgId={activeOrgId} onSaved={fetchData} actionsSlot={docActionsSlot} hideViewBody />
        </div>

        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview', render: () => twoColDetail(
              <>
                {renderSourceSection(pol)}
                {renderProceduresSection(pol)}
                {docType === 'POLICY' && renderControlsSection(pol)}
                {renderProvenance(pol)}
              </>,
              <>
                {renderFactsRail(pol)}
                {renderExplainer(pol)}
              </>,
            ) },
            { id: 'content', label: 'Content', render: () => renderContent(pol) },
            { id: 'used-by', label: `Used by ${policyMappings.length + policyExceptions.length}`, render: () => renderUsedBy() },
            { id: 'activity', label: 'Activity', render: () => (
              <div style={panelStyle}>
                <ActivityFeed entityType="GovernancePolicy" entityId={pol.id} inline initialRows={20} />
              </div>
            ) },
          ]}
        />
      </div>
    );
  }

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
          <ListToolbar
            views={
              <SavedViewsMenu
                pageKey="governance-documents"
                currentFilters={{ typeFilter }}
                onApply={(f) => {
                  setTypeFilter(((f.typeFilter as DocumentType | 'ALL') || 'ALL'));
                }}
              />
            }
            export={
              policies.length > 0 ? (
                <ExportMenu
                  label="Export documents"
                  build={() => ({
                    filenameBase: 'governance-documents',
                    sheetName: 'Documents',
                    headers: ['Code', 'Name', 'Category', 'Status', 'Owner', 'Controls'],
                    rows: policies.map((pol) => [
                      pol.code,
                      pol.name,
                      (pol.category || '').replace(/_/g, ' '),
                      (pol.status || '').replace(/_/g, ' '),
                      pol.ownerName || '',
                      controlsForPolicy(pol.id).length,
                    ]),
                  })}
                />
              ) : undefined
            }
            columns={<ColumnPicker state={policyCols} />}
            primary={isAdmin ? <Button variant="primary" onClick={openAdd}>+ Add document</Button> : undefined}
          />
        }
      />

      {/* Document types — four explained cards, broadest to most specific.
          Clicking one filters the list; empty types read "None yet". */}
      <section aria-label="Document types" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Document types</h2>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>From broadest to most specific. Click one to filter.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {DOCUMENT_TYPES.map((t) => {
            const n = policies.filter((p) => (p.documentType || 'POLICY') === t).length;
            const active = typeFilter === t;
            return (
              <button key={t} type="button" onClick={() => setTypeFilter(active ? 'ALL' : t)} aria-pressed={active}
                style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 82, boxSizing: 'border-box', border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, background: active ? 'var(--color-primary-light)' : 'var(--color-surface)', boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'var(--shadow-sm)' }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: n > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{n}</span>
                  {n === 0 && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--color-warning)' }}>None yet</span>}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{DOCUMENT_TYPE_LABEL[t]}</span>
                <span className="na-card-hint" title={DOCUMENT_TYPE_HINT[t]}>{DOCUMENT_TYPE_HINT[t]}</span>
              </button>
            );
          })}
        </div>
      </section>

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
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add New {DOCUMENT_TYPE_LABEL[form.documentType] || 'Document'}</h3>
          <PolicyFields form={form} setForm={setForm} people={people} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button variant="primary" disabled={!form.name.trim()} onClick={handleSave}>
              Add {DOCUMENT_TYPE_LABEL[form.documentType] || 'Document'}
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
        <select
          aria-label="Set status"
          onChange={(e) => { if (e.target.value) bulkSetStatus(e.target.value); e.target.value = ''; }}
          style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
        >
          <option value="">Set status…</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select
          aria-label="Assign owner"
          onChange={(e) => { if (e.target.value) bulkAssignOwner(e.target.value); e.target.value = ''; }}
          style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
        >
          <option value="">Assign owner…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
        </select>
        <BulkActionButton onClick={bulkExport}>Export</BulkActionButton>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      {/* Documents table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
        ) : loading ? (
          <div style={{ padding: 8 }}><SkeletonRows rows={5} columns={7} /></div>
        ) : policies.length === 0 && !showForm ? (
          <EmptyState icon={renderNavIcon('/governance-policies')} title="No governance documents yet"
            description="Charters, policies, standards, and frameworks that define the governance program."
            action={isAdmin ? { label: '+ Add Document', onClick: openAdd } : undefined} />
        ) : (
          <>
            {/* Search + Status / Category / Owner filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ flex: '1 1 220px', minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', background: 'var(--color-surface)' }}>
                <span aria-hidden="true" style={{ fontSize: 13 }}>&#128269;</span>
                <input type="search" aria-label="Search documents" placeholder="Search by name or code" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ border: 0, outline: 'none', flex: 1, font: 'inherit', fontSize: 13, color: 'var(--color-text)', background: 'transparent', minWidth: 0 }} />
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text-muted)' }}>Status
                <select aria-label="Filter by status" style={filterSelectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}</option>)}
                </select>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text-muted)' }}>Category
                <select aria-label="Filter by category" style={filterSelectStyle} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="">All</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}</option>)}
                </select>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-text-muted)' }}>Owner
                <select aria-label="Filter by owner" style={filterSelectStyle} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                  <option value="">All</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
                </select>
              </label>
              {Object.keys(promotionsByPolicy).length > 0 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                  <input type="checkbox" checked={showAgentPromotedOnly} onChange={(e) => setShowAgentPromotedOnly(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Bot size={12} strokeWidth={2.4} style={{ color: '#5b21b6' }} /> Agent-promoted</span>
                </label>
              )}
              {anyToolbarFilter && (
                <button type="button" onClick={() => { setSearchQuery(''); setStatusFilter(''); setCategoryFilter(''); setOwnerFilter(''); }} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>Clear filters</button>
              )}
            </div>
            <DataTable
              rows={sorted}
              columns={policyColumns}
              rowKey={(p) => p.id}
              selection={isAdmin ? sel : undefined}
              sort={{ sortKey, sortDir, onSort: toggleSort }}
              selectAllLabel="Select all documents"
              emptyMessage="No documents match the current filters."
              onRowClick={(p) => navigate(`/governance-policies/${p.id}`)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', fontSize: 13, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
              <span>Documents {sorted.length}</span>
              <span>Charters, frameworks and standards have no controls; only policies do.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
