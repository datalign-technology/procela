import { Fragment, useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';
import SavedViewsMenu from '../components/SavedViewsMenu';

// ── Types ──

type DeciderType = 'PERSON' | 'ROLE' | 'GROUP';

type DecisionCategory =
  | 'POLICY' | 'EXCEPTION' | 'ISSUE' | 'CLASSIFICATION'
  | 'ACCESS' | 'SCOPE' | 'ROLE' | 'OTHER';

interface DecisionRight {
  id: string;
  orgId: string;
  decision: string;
  category: DecisionCategory;
  description: string;
  decider: string | null;
  deciderType: DeciderType;
  deciderName?: string | null;
  recommends: string[];
  approves: string[];
  informed: string[];
  escalationPath: string;
  createdAt: string;
  updatedAt: string;
}

interface Person { id: string; name: string; }

interface GovernanceGroup { id: string; name: string; }

interface DecisionForm {
  decision: string;
  category: DecisionCategory;
  description: string;
  decider: string;
  deciderType: DeciderType;
  recommends: string[];
  approves: string[];
  informed: string[];
  escalationPath: string;
}

const emptyForm: DecisionForm = {
  decision: '',
  category: 'POLICY',
  description: '',
  decider: '',
  deciderType: 'ROLE',
  recommends: [],
  approves: [],
  informed: [],
  escalationPath: '',
};

const CATEGORIES: DecisionCategory[] = [
  'POLICY', 'EXCEPTION', 'ISSUE', 'CLASSIFICATION', 'ACCESS', 'SCOPE', 'ROLE', 'OTHER',
];

const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  POLICY: 'Policy',
  EXCEPTION: 'Exception',
  ISSUE: 'Issue',
  CLASSIFICATION: 'Classification',
  ACCESS: 'Access',
  SCOPE: 'Scope',
  ROLE: 'Role',
  OTHER: 'Other',
};

const CATEGORY_COLORS: Record<DecisionCategory, { bg: string; color: string }> = {
  POLICY:         { bg: '#dbeafe', color: '#1e40af' },
  EXCEPTION:      { bg: '#fef3c7', color: '#92400e' },
  ISSUE:          { bg: '#fee2e2', color: '#991b1b' },
  CLASSIFICATION: { bg: '#fce7f3', color: '#9d174d' },
  ACCESS:         { bg: '#ccfbf1', color: '#115e59' },
  SCOPE:          { bg: '#ede9fe', color: '#5b21b6' },
  ROLE:           { bg: '#e0e7ff', color: '#3730a3' },
  OTHER:          { bg: '#f3f4f6', color: '#6b7280' },
};

const DAMA_ROLES = [
  'CDO', 'DATA_GOVERNANCE_LEAD', 'DATA_OWNER', 'BUSINESS_DATA_STEWARD',
  'TECHNICAL_DATA_STEWARD', 'DATA_QUALITY_ANALYST', 'DATA_CUSTODIAN',
  'DATA_ARCHITECT', 'DATA_ENGINEER', 'DATABASE_ADMINISTRATOR',
];

const ROLE_LABELS: Record<string, string> = {
  CDO: 'Chief Data Officer',
  DATA_GOVERNANCE_LEAD: 'Data Governance Lead',
  DATA_OWNER: 'Data Owner',
  BUSINESS_DATA_STEWARD: 'Business Data Steward',
  TECHNICAL_DATA_STEWARD: 'Technical Data Steward',
  DATA_QUALITY_ANALYST: 'Data Quality Analyst',
  DATA_CUSTODIAN: 'Data Custodian',
  DATA_ARCHITECT: 'Data Architect',
  DATA_ENGINEER: 'Data Engineer',
  DATABASE_ADMINISTRATOR: 'Database Administrator',
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
  verticalAlign: 'top',
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

function badgeStyle(colors: { bg: string; color: string }): React.CSSProperties {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color, whiteSpace: 'nowrap',
  };
}

const textBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: '2px 4px',
  color: 'var(--color-primary)', cursor: 'pointer',
  fontSize: 12, fontFamily: 'inherit',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 500,
  background: '#eef2ff',
  color: '#3730a3',
  marginRight: 4,
  marginBottom: 2,
  whiteSpace: 'nowrap',
};

// ── Helpers ──

function labelFor(value: string, people: Person[], groups: GovernanceGroup[]): string {
  if (ROLE_LABELS[value]) return ROLE_LABELS[value];
  const person = people.find((p) => p.id === value);
  if (person) return person.name;
  const group = groups.find((g) => g.id === value);
  if (group) return group.name;
  return value;
}

function Chips({ values, people, groups }: { values: string[]; people: Person[]; groups: GovernanceGroup[] }) {
  if (!values || values.length === 0) {
    return <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>--</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {values.map((v) => (
        <span key={v} style={chipStyle}>{labelFor(v, people, groups)}</span>
      ))}
    </div>
  );
}

// Single sidebar entry — All Categories or one named category, with count
// and active-state highlighting. Mirrors the sidebar items on /data-assets
// and /systems so the scan pattern is consistent across the app.
function SidebarItem({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '0 5px', borderRadius: 8, fontWeight: 500 }}>{count}</span>
    </div>
  );
}

// Expanded RACI panel - the recommends/approves/informed/escalation
// detail revealed when a row is expanded. ColumnPicker toggles still
// control which of the four sections render, so users who hide one
// permanently won't see it even when expanded.
function ExpandedRaciDetails({ row, people, groups, showRecommends, showApproves, showInformed, showEscalation }: {
  row: DecisionRight;
  people: Person[];
  groups: GovernanceGroup[];
  showRecommends: boolean;
  showApproves: boolean;
  showInformed: boolean;
  showEscalation: boolean;
}) {
  const Item = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
      {showRecommends && <Item label="Recommends">  <Chips values={row.recommends} people={people} groups={groups} /></Item>}
      {showApproves   && <Item label="Approves">    <Chips values={row.approves}   people={people} groups={groups} /></Item>}
      {showInformed   && <Item label="Informed">    <Chips values={row.informed}   people={people} groups={groups} /></Item>}
      {showEscalation && (
        <Item label="Escalation Path">
          {row.escalationPath
            ? <span style={{ color: 'var(--color-text-secondary)' }}>{row.escalationPath}</span>
            : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>--</span>}
        </Item>
      )}
    </div>
  );
}

// Multi-select component that lets the user check multiple roles/people
function MultiSelect({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 4,
      padding: 6,
      maxHeight: 140,
      overflowY: 'auto',
      background: 'var(--color-surface)',
      fontSize: 12,
    }}>
      {options.length === 0 && (
        <div style={{ color: 'var(--color-text-muted)', padding: 4 }}>No options</div>
      )}
      {options.map((opt) => (
        <label key={opt.value} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={() => toggle(opt.value)}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

type DecisionColId = 'decision' | 'category' | 'decides' | 'recommends' | 'approves' | 'informed' | 'escalation';
const DECISION_COLUMN_DEFS: Array<{ id: DecisionColId; label: string; defaultVisible: boolean }> = [
  { id: 'decision',   label: 'Decision',    defaultVisible: true  },
  { id: 'category',   label: 'Category',    defaultVisible: true  },
  { id: 'decides',    label: 'Decides',     defaultVisible: true  },
  { id: 'recommends', label: 'Recommends',  defaultVisible: false },
  { id: 'approves',   label: 'Approves',    defaultVisible: true  },
  { id: 'informed',   label: 'Informed',    defaultVisible: false },
  { id: 'escalation', label: 'Escalation',  defaultVisible: false },
];

// ── Component ──

export default function DecisionRightsPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const decisionCols = useColumnPicker<DecisionColId>('procela.decisionRights.visibleCols.v1', DECISION_COLUMN_DEFS);
  const [rows, setRows] = useState<DecisionRight[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [groups, setGroups] = useState<GovernanceGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState<'ALL' | DecisionCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DecisionForm>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [rowsRes, pplRes, grpRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DecisionRight[] }>(`/decision-rights${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: GovernanceGroup[] }>(`/governance-groups${query}`).catch(() => ({ success: true, data: [] as GovernanceGroup[] })),
      ]);
      setRows(rowsRes.data || []);
      setPeople(pplRes.data || []);
      setGroups(grpRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setForm(emptyForm); setEditingId(null); setShowForm(true); };
  const openEdit = (r: DecisionRight) => {
    setForm({
      decision: r.decision,
      category: r.category,
      description: r.description,
      decider: r.decider || '',
      deciderType: r.deciderType,
      recommends: [...r.recommends],
      approves: [...r.approves],
      informed: [...r.informed],
      escalationPath: r.escalationPath,
    });
    setEditingId(r.id);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const handleSave = async () => {
    if (!form.decision.trim()) return;
    try {
      const payload = {
        ...form,
        decider: form.decider || null,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      };
      if (editingId) {
        await apiClient.put(`/decision-rights/${editingId}`, payload);
        addToast('success', 'Decision right updated');
      } else {
        await apiClient.post('/decision-rights', payload);
        addToast('success', 'Decision right created');
      }
      closeForm();
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to save decision right');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/decision-rights/${id}`);
      addToast('success', 'Decision right deleted');
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to delete decision right');
    }
  };

  const handleSeed = async () => {
    if (!activeOrgId) {
      addToast('error', 'Please select an organization first');
      return;
    }
    setSeeding(true);
    try {
      const res = await apiClient.post<{
        success: boolean; created: number; skipped: number;
      }>('/decision-rights/seed', { orgId: activeOrgId });
      addToast('success', `Seeded ${res.created} standard decisions${res.skipped ? ` (${res.skipped} already existed)` : ''}`);
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to seed decisions');
    } finally {
      setSeeding(false);
    }
  };

  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map((i) => i.id)));
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => apiClient.delete(`/decision-rights/${id}`)));
    addToast('success', `Deleted ${ids.length} decision right${ids.length === 1 ? '' : 's'}`);
    setSelectedIds(new Set());
    fetchData();
  };

  const filteredRows = rows.filter((r) => {
    if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${r.decision} ${r.description} ${r.deciderName || ''} ${r.escalationPath || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const expandAll = () => setExpandedIds(new Set(filteredRows.map((r) => r.id)));
  const collapseAll = () => setExpandedIds(new Set());

  const categoryCounts: Record<DecisionCategory | 'ALL', number> = { ALL: rows.length } as any;
  for (const c of CATEGORIES) categoryCounts[c] = 0;
  for (const r of rows) categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;

  // Build multi-select option list based on decider type (for recommends/approves/informed we allow any)
  const allParticipantOptions: { value: string; label: string }[] = [
    ...DAMA_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] || r })),
    ...people.map((p) => ({ value: p.id, label: p.name + ' (Person)' })),
    ...groups.map((g) => ({ value: g.id, label: g.name + ' (Group)' })),
  ];

  const deciderOptions = (() => {
    switch (form.deciderType) {
      case 'PERSON':
        return people.map((p) => ({ value: p.id, label: p.name }));
      case 'GROUP':
        return groups.map((g) => ({ value: g.id, label: g.name }));
      case 'ROLE':
      default:
        return DAMA_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] || r }));
    }
  })();

  return (
    <div>

      {/* Header */}
      <PageHeader
        title="Decision Rights"
        subtitle="Who has authority to decide, recommend, approve, and be informed for governance decisions."
        actions={
          <>
            {canWrite && rows.length === 0 && (
              <button
                style={{ ...btnSecondary, opacity: seeding ? 0.6 : 1, cursor: seeding ? 'not-allowed' : 'pointer' }}
                disabled={seeding}
                onClick={handleSeed}
              >
                {seeding ? 'Seeding...' : 'Seed Standard Decisions'}
              </button>
            )}
            <SavedViewsMenu
              pageKey="decision-rights"
              currentFilters={{ categoryFilter, searchQuery }}
              onApply={(f) => {
                setCategoryFilter(((f.categoryFilter as 'ALL' | DecisionCategory) || 'ALL'));
                setSearchQuery((f.searchQuery as string) || '');
              }}
            />
            <ColumnPicker state={decisionCols} />
            {canWrite && <IconButton icon="plus" label="Add decision" variant="primary" onClick={openAdd} />}
          </>
        }
      />

      {/* Search + row-expansion controls. Category filter moved into the
       *  sidebar; expand/collapse-all replaces the visual noise of always
       *  rendering every RACI column. */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search decisions, decider, escalation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: '1 1 280px', maxWidth: 420,
              fontSize: 13, padding: '6px 10px',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
            }}
          />
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            <button onClick={expandAll}  style={textBtnStyle}>Expand all</button>
            <span style={{ color: 'var(--color-border)' }}>·</span>
            <button onClick={collapseAll} style={textBtnStyle}>Collapse all</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            {filteredRows.length} of {rows.length} decisions
            {categoryFilter !== 'ALL' && ` · ${CATEGORY_LABELS[categoryFilter]}`}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Decision Right?"
        message="This will permanently delete this decision right entry."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Decision Right' : 'Add Decision Right'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Decision *</label>
              <input
                autoFocus
                style={inputStyle}
                value={form.decision}
                onChange={(e) => setForm({ ...form, decision: e.target.value })}
                placeholder="e.g. Approve a new data policy"
              />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select
                style={selectStyle}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as DecisionCategory })}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Decider Type</label>
              <div style={{ display: 'flex', gap: 12, paddingTop: 6 }}>
                {(['PERSON', 'ROLE', 'GROUP'] as DeciderType[]).map((t) => (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="deciderType"
                      checked={form.deciderType === t}
                      onChange={() => setForm({ ...form, deciderType: t, decider: '' })}
                    />
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Description</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this decision entails..."
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Decider ({form.deciderType.toLowerCase()})</label>
              <select
                style={selectStyle}
                value={form.decider}
                onChange={(e) => setForm({ ...form, decider: e.target.value })}
              >
                <option value="">-- Select --</option>
                {deciderOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Recommends</label>
              <MultiSelect
                options={allParticipantOptions}
                value={form.recommends}
                onChange={(next) => setForm({ ...form, recommends: next })}
              />
            </div>
            <div>
              <label style={labelStyle}>Approves</label>
              <MultiSelect
                options={allParticipantOptions}
                value={form.approves}
                onChange={(next) => setForm({ ...form, approves: next })}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Informed</label>
              <MultiSelect
                options={allParticipantOptions}
                value={form.informed}
                onChange={(next) => setForm({ ...form, informed: next })}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Escalation Path</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={form.escalationPath}
                onChange={(e) => setForm({ ...form, escalationPath: e.target.value })}
                placeholder="Describe how this decision escalates if not resolved..."
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={closeForm}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.decision.trim() ? 0.6 : 1, cursor: !form.decision.trim() ? 'not-allowed' : 'pointer' }}
              disabled={!form.decision.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Decision Right'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} decision right${selectedIds.size === 1 ? '' : 's'}?`}
        message="This cannot be undone."
        confirmLabel={`Delete ${selectedIds.size}`}
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
          <button onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            Delete Selected
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            Clear Selection
          </button>
        </div>
      )}

      {/* Two-column layout: Categories sidebar + content. Mirrors
       *  DataAssetsPage / SystemsPage so users get the same scan pattern
       *  across the app. */}
      <div style={{ display: 'grid', gridTemplateColumns: rows.length > 0 ? '220px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
        {rows.length > 0 && (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 10,
            position: 'sticky', top: 12,
            maxHeight: 'calc(100vh - 180px)',
            overflowY: 'auto',
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, padding: '0 4px' }}>
              Categories
            </div>
            <SidebarItem
              label="All Categories"
              count={rows.length}
              active={categoryFilter === 'ALL'}
              onClick={() => setCategoryFilter('ALL')}
            />
            {CATEGORIES.map((c) => {
              const n = categoryCounts[c] || 0;
              if (n === 0) return null;
              return (
                <SidebarItem
                  key={c}
                  label={CATEGORY_LABELS[c]}
                  count={n}
                  active={categoryFilter === c}
                  onClick={() => setCategoryFilter(categoryFilter === c ? 'ALL' : c)}
                />
              );
            })}
          </div>
        )}

        <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
          {loading ? (
            <SkeletonRows rows={5} columns={5} />
          ) : rows.length === 0 && !showForm ? (
            <EmptyState
              icon={'⚖️'}
              title="No decision rights defined yet"
              description="Decision rights document who has authority to decide, recommend, approve, and be informed for governance decisions. Start by seeding the standard set or add your own."
              action={canWrite ? { label: 'Seed Standard Decisions', onClick: handleSeed } : undefined}
            />
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
              {searchQuery.trim() ? 'No decisions match your search.' : 'No decisions match the selected category.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th scope="col" style={{ ...thStyle, width: 40, textAlign: 'center' }}>
                      <input type="checkbox" checked={rows.length > 0 && selectedIds.size === rows.length} onChange={toggleSelectAll} />
                    </th>
                    <th scope="col" style={{ ...thStyle, width: 32 }} />
                    {decisionCols.isVisible('decision') && <th scope="col" style={thStyle}>Decision</th>}
                    {decisionCols.isVisible('category') && <th scope="col" style={thStyle}>Category</th>}
                    {decisionCols.isVisible('decides') && <th scope="col" style={thStyle}>Decides</th>}
                    <th scope="col" style={{ ...thStyle, width: 100, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const decidesLabel = r.deciderName
                      || (r.decider ? labelFor(r.decider, people, groups) : null);
                    const isExpanded = expandedIds.has(r.id);
                    // 4 always-rendered columns (select, chevron, actions) + the
                    // 3 toggleable ones - keep the expanded row spanning them all.
                    const colSpan =
                      3 +
                      (decisionCols.isVisible('decision') ? 1 : 0) +
                      (decisionCols.isVisible('category') ? 1 : 0) +
                      (decisionCols.isVisible('decides') ? 1 : 0);
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td style={{ ...tdStyle, textAlign: 'center', width: 40 }}>
                            <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                          </td>
                          <td style={{ ...tdStyle, width: 32, padding: '4px 0' }}>
                            <button
                              type="button"
                              onClick={() => toggleExpand(r.id)}
                              aria-label={isExpanded ? 'Collapse' : 'Expand'}
                              title={isExpanded ? 'Hide RACI details' : 'Show RACI details'}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 11, color: 'var(--color-text-muted)',
                                padding: '4px 6px', borderRadius: 4,
                                transform: isExpanded ? 'rotate(90deg)' : 'none',
                                transition: 'transform 0.1s',
                              }}
                            >
                              {'▶'}
                            </button>
                          </td>
                          {decisionCols.isVisible('decision') && (
                            <td style={{ ...tdStyle, fontWeight: 500 }}>
                              <button
                                type="button"
                                onClick={() => toggleExpand(r.id)}
                                style={{
                                  background: 'none', border: 'none', padding: 0,
                                  color: 'var(--color-text)', cursor: 'pointer',
                                  font: 'inherit', textAlign: 'left',
                                }}
                              >
                                {r.decision}
                              </button>
                              {r.description && (
                                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, maxWidth: 480 }}>
                                  {r.description}
                                </div>
                              )}
                            </td>
                          )}
                          {decisionCols.isVisible('category') && (
                            <td style={tdStyle}>
                              <span style={badgeStyle(CATEGORY_COLORS[r.category] || CATEGORY_COLORS.OTHER)}>
                                {CATEGORY_LABELS[r.category]}
                              </span>
                            </td>
                          )}
                          {decisionCols.isVisible('decides') && (
                            <td style={tdStyle}>
                              {decidesLabel ? (
                                <div>
                                  <span style={chipStyle}>{decidesLabel}</span>
                                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                    {r.deciderType.toLowerCase()}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>Unassigned</span>
                              )}
                            </td>
                          )}
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', gap: 4 }}>
                              {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(r)} />}
                              {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(r.id)} />}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={colSpan} style={{
                              padding: '12px 18px 16px', background: 'var(--color-bg)',
                              borderBottom: '1px solid var(--color-border)',
                            }}>
                              <ExpandedRaciDetails
                                row={r}
                                people={people}
                                groups={groups}
                                showRecommends={decisionCols.isVisible('recommends')}
                                showApproves={decisionCols.isVisible('approves')}
                                showInformed={decisionCols.isVisible('informed')}
                                showEscalation={decisionCols.isVisible('escalation')}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
