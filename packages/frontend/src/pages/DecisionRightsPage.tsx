import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage, errorToast, successToast } from '../lib/errorToast';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { HeaderEditActions } from '../components/DetailEditActions';
import PageHeader from '../components/PageHeader';
import SectionLabel from '../components/SectionLabel';
import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import TruncatedText from '../components/TruncatedText';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';
import { SkeletonRows } from '../components/Skeleton';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';
import { useSortedList } from '../hooks/useSortedList';
import SavedViewsMenu from '../components/SavedViewsMenu';
import ExportMenu from '../components/ExportMenu';
import ListToolbar from '../components/ListToolbar';

// ── Types ──

type DeciderType = 'PERSON' | 'ROLE' | 'GROUP';

type DecisionCategory =
  | 'POLICY' | 'EXCEPTION' | 'ISSUE' | 'CLASSIFICATION'
  | 'ACCESS' | 'SCOPE' | 'ROLE' | 'OTHER';

export interface DecisionRight {
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

export interface DecisionPerson { id: string; name: string; }
interface Person extends DecisionPerson {}

export interface DecisionGroup { id: string; name: string; }
interface GovernanceGroup extends DecisionGroup {}

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

export const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  POLICY: 'Policy',
  EXCEPTION: 'Exception',
  ISSUE: 'Issue',
  CLASSIFICATION: 'Classification',
  ACCESS: 'Access',
  SCOPE: 'Scope',
  ROLE: 'Role',
  OTHER: 'Other',
};

// Plain-English hint per decision area, shown on the area cards.
const CATEGORY_HINT: Record<DecisionCategory, string> = {
  POLICY:         'Approving or changing policies',
  EXCEPTION:      'Allowing a rule to be broken for a time',
  ISSUE:          'Settling problems and disputes',
  CLASSIFICATION: 'How sensitive data is labelled',
  ACCESS:         'Who may see or use data',
  SCOPE:          'What the program covers',
  ROLE:           'Who holds governance roles',
  OTHER:          'Anything else',
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
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 };

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

// Row "⋯" overflow button + its dropdown (shared list-row menu pattern).
const rowMenuBtnStyle: React.CSSProperties = {
  width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8,
  color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
};
const rowMenuStyle: React.CSSProperties = {
  position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 150,
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
  padding: 6, textAlign: 'left',
};
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
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
      <SectionLabel marginBottom={4}>
        {label}
      </SectionLabel>
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

// Decision and Decides are always shown; the picker manages the rest of the
// accountability chain. Category folds into the Decision cell's sub-line, so
// it is no longer a toggle. (v2 — new column set.)
type DecisionColId = 'recommends' | 'approves' | 'informed' | 'escalation';
const DECISION_COLUMN_DEFS: Array<{ id: DecisionColId; label: string; defaultVisible: boolean }> = [
  { id: 'recommends', label: 'Recommends',  defaultVisible: true },
  { id: 'approves',   label: 'Approves',    defaultVisible: true },
  { id: 'informed',   label: 'Informed',    defaultVisible: true },
  { id: 'escalation', label: 'If disputed', defaultVisible: true },
];

// ── Component ──

// The decision-right field grid — shared by the top "Add" form (create) and
// the in-row edit (ExpandedDecisionRight). deciderOptions depends on the
// chosen deciderType, so it's computed here from the current form value.
function DecisionRightFields({ form, setForm, people, groups }: {
  form: DecisionForm;
  setForm: (next: DecisionForm) => void;
  people: Person[];
  groups: GovernanceGroup[];
}) {
  const deciderOptions = form.deciderType === 'PERSON'
    ? people.map((p) => ({ value: p.id, label: p.name }))
    : form.deciderType === 'GROUP'
      ? groups.map((g) => ({ value: g.id, label: g.name }))
      : DAMA_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] || r }));
  const allParticipantOptions = [
    ...DAMA_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] || r })),
    ...people.map((p) => ({ value: p.id, label: p.name + ' (Person)' })),
    ...groups.map((g) => ({ value: g.id, label: g.name + ' (Group)' })),
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Decision *</label>
        <input aria-label="Decision" style={inputStyle} value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })} placeholder="e.g. Approve a new data policy" />
      </div>
      <div>
        <label style={labelStyle}>Category</label>
        <select aria-label="Category" style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as DecisionCategory })}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Decider Type</label>
        <div style={{ display: 'flex', gap: 12, paddingTop: 6 }}>
          {(['PERSON', 'ROLE', 'GROUP'] as DeciderType[]).map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
              <input type="radio" name={`deciderType-${form.decision}`} checked={form.deciderType === t} onChange={() => setForm({ ...form, deciderType: t, decider: '' })} />
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Description</label>
        <textarea aria-label="Description" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this decision entails..." />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Decider ({form.deciderType.toLowerCase()})</label>
        <select aria-label="Decider" style={selectStyle} value={form.decider} onChange={(e) => setForm({ ...form, decider: e.target.value })}>
          <option value="">-- Select --</option>
          {deciderOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Recommends</label>
        <MultiSelect options={allParticipantOptions} value={form.recommends} onChange={(next) => setForm({ ...form, recommends: next })} />
      </div>
      <div>
        <label style={labelStyle}>Approves</label>
        <MultiSelect options={allParticipantOptions} value={form.approves} onChange={(next) => setForm({ ...form, approves: next })} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Informed</label>
        <MultiSelect options={allParticipantOptions} value={form.informed} onChange={(next) => setForm({ ...form, informed: next })} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Escalation Path</label>
        <textarea aria-label="Escalation Path" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.escalationPath} onChange={(e) => setForm({ ...form, escalationPath: e.target.value })} placeholder="Describe how this decision escalates if not resolved..." />
      </div>
    </div>
  );
}

// The expanded row: read-only RACI detail with a view/edit toggle. Edit flips
// the SAME panel into the field grid and one Save writes PUT /decision-rights/
// :id — the row's own in-place editor (there's no separate edit form anymore).
export function ExpandedDecisionRight({ row, people, groups, orgId, canEdit, onSaved, showRecommends, showApproves, showInformed, showEscalation, actionsSlot }: {
  row: DecisionRight;
  people: Person[];
  groups: GovernanceGroup[];
  orgId: string | null;
  canEdit: boolean;
  onSaved: () => void;
  showRecommends: boolean;
  showApproves: boolean;
  showInformed: boolean;
  showEscalation: boolean;
  /** When set, the Edit / Save·Cancel cluster renders into the page header's
   *  actions slot (the detail-page placement) instead of inline. */
  actionsSlot?: HTMLElement | null;
}) {
  const m = useDetailEditMode<DecisionForm>(
    {
      decision: row.decision,
      category: row.category,
      description: row.description,
      decider: row.decider || '',
      deciderType: row.deciderType,
      recommends: [...row.recommends],
      approves: [...row.approves],
      informed: [...row.informed],
      escalationPath: row.escalationPath,
    },
    async (draft) => {
      if (!draft.decision.trim()) { errorToast(null, 'Decision is required'); throw new Error('no-decision'); }
      try {
        await apiClient.put(`/decision-rights/${row.id}`, {
          ...draft,
          decider: draft.decider || null,
          ...(orgId ? { orgId } : {}),
        });
        successToast('Decision right updated');
        onSaved();
      } catch (err) { errorToast(err, 'Failed to update decision right'); throw err; }
    },
  );
  return (
    <div>
      <HeaderEditActions
        slot={actionsSlot}
        editing={m.isEditing}
        canEdit={canEdit}
        dirty={m.dirty}
        saving={m.saving}
        onEdit={m.enter}
        onCancel={m.cancel}
        onSave={m.save}
      />
      {m.isEditing ? (
        <DecisionRightFields form={m.draft} setForm={(next) => m.patch(next)} people={people} groups={groups} />
      ) : (
        <ExpandedRaciDetails
          row={row}
          people={people}
          groups={groups}
          showRecommends={showRecommends}
          showApproves={showApproves}
          showInformed={showInformed}
          showEscalation={showEscalation}
        />
      )}
    </div>
  );
}

export default function DecisionRightsPage() {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  // Decision Rights is a governance surface: the backend gates every write
  // (seed / add / edit / delete) on `governance:write`, which only admins
  // hold. Gate the write affordances on `isAdmin` so editors get a clean
  // read-only view instead of buttons the API rejects with a 403.
  const { isAdmin } = usePermissions();
  const { addToast } = useToastStore();

  const decisionCols = useColumnPicker<DecisionColId>('procela.decisionRights.visibleCols.v2', DECISION_COLUMN_DEFS);
  const [rows, setRows] = useState<DecisionRight[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [groups, setGroups] = useState<GovernanceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'ALL' | DecisionCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DecisionForm>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Per-row "⋯" overflow menu (Open / Duplicate / Delete).
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
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
      const [rowsRes, pplRes, grpRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DecisionRight[] }>(`/decision-rights${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: GovernanceGroup[] }>(`/governance-groups${query}`).catch(() => ({ success: true, data: [] as GovernanceGroup[] })),
      ]);
      setRows(rowsRes.data || []);
      setPeople(pplRes.data || []);
      setGroups(grpRes.data || []);
    } catch (err) { setLoadError(errorMessage(err, 'Failed to load decision rights.')); }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setForm(emptyForm); setEditingId(null); setShowForm(true); };
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
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to save decision right'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/decision-rights/${id}`);
      addToast('success', 'Decision right deleted');
      fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to delete decision right'));
    }
  };

  const handleDuplicate = async (r: DecisionRight) => {
    try {
      await apiClient.post('/decision-rights', {
        decision: `${r.decision} (copy)`,
        category: r.category,
        description: r.description,
        decider: r.decider || null,
        deciderType: r.deciderType,
        recommends: r.recommends,
        approves: r.approves,
        informed: r.informed,
        escalationPath: r.escalationPath,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      });
      addToast('success', 'Decision duplicated');
      fetchData();
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to duplicate decision'));
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
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to seed decisions'));
    } finally {
      setSeeding(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(sel.selectedIds);
    await Promise.all(ids.map((id) => apiClient.delete(`/decision-rights/${id}`)));
    addToast('success', `Deleted ${ids.length} decision right${ids.length === 1 ? '' : 's'}`);
    sel.clear();
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

  // Sort — URL-persisted via ?sort=&dir=. Category sorts by the resolved
  // display label; "Decides" sorts by the resolved decider label (what the
  // cell shows), with unassigned rows last regardless of direction. The
  // RACI detail (Recommends / Approves / Informed / Escalation) lives in the
  // row expansion, not as sortable columns.
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    filteredRows,
    {
      decision: (a, b) => (a.decision || '').localeCompare(b.decision || ''),
      category: (a, b) => (CATEGORY_LABELS[a.category] || '').localeCompare(CATEGORY_LABELS[b.category] || ''),
      decides: (a, b) => {
        const al = a.deciderName || (a.decider ? labelFor(a.decider, people, groups) : '');
        const bl = b.deciderName || (b.decider ? labelFor(b.decider, people, groups) : '');
        if (!al && !bl) return 0;
        if (!al) return 1;
        if (!bl) return -1;
        return al.localeCompare(bl);
      },
    },
    'decision',
  );

  const sel = useRowSelection(sorted, (r) => r.id);

  const categoryCounts: Record<DecisionCategory | 'ALL', number> = { ALL: rows.length } as any;
  for (const c of CATEGORIES) categoryCounts[c] = 0;
  for (const r of rows) categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;

  // One accountability-chain cell (Recommends / Approves / Informed): the
  // resolved role/person/group names, joined and ellipsised, or a muted dash.
  const chainCell = (values: string[]) => (
    <TruncatedText text={(values || []).map((v) => labelFor(v, people, groups)).join(', ')} emptyPlaceholder="—" />
  );

  const decisionColumns = ([
    {
      // Decision + its category on a muted sub-line (the category badge used
      // to be a red/pink pill that read like an error; plain text reads as a
      // label).
      key: 'decision', header: 'Decision', sortable: true, cellStyle: { verticalAlign: 'middle' },
      render: (r: DecisionRight) => (
        <div>
          <button
            type="button"
            onClick={() => navigate(`/decision-rights/${r.id}`)}
            title={r.description || undefined}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
          >
            {r.decision}
          </button>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{CATEGORY_LABELS[r.category]}</span>
        </div>
      ),
    },
    {
      // Who decides — a person (round avatar) or a group / role (square),
      // with the kind spelled out in plain text below.
      key: 'decides', header: 'Decides', sortable: true,
      render: (r: DecisionRight) => {
        const label = r.deciderName || (r.decider ? labelFor(r.decider, people, groups) : null);
        if (!label) return <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>Unassigned</span>;
        const isPerson = r.deciderType === 'PERSON';
        const kind = isPerson ? 'Person' : r.deciderType === 'GROUP' ? 'Group' : 'Role';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <Avatar name={label} size="sm" style={isPerson ? undefined : { borderRadius: 6 }} />
            <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{kind}</span>
            </span>
          </span>
        );
      },
    },
    decisionCols.isVisible('recommends') && {
      key: 'recommends', header: 'Recommends', render: (r: DecisionRight) => chainCell(r.recommends),
    },
    decisionCols.isVisible('approves') && {
      key: 'approves', header: 'Approves', render: (r: DecisionRight) => chainCell(r.approves),
    },
    decisionCols.isVisible('informed') && {
      key: 'informed', header: 'Informed', render: (r: DecisionRight) => chainCell(r.informed),
    },
    decisionCols.isVisible('escalation') && {
      key: 'escalation', header: 'If disputed',
      render: (r: DecisionRight) => <TruncatedText text={r.escalationPath} emptyPlaceholder="—" />,
    },
    {
      key: 'actions', header: 'Actions', align: 'right' as const, width: 70,
      render: (r: DecisionRight) => (
        <span style={{ position: 'relative', display: 'inline-flex' }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button" aria-label={`More actions for ${r.decision}`} aria-haspopup="menu" aria-expanded={rowMenuId === r.id}
            onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === r.id ? null : r.id); }}
            style={rowMenuBtnStyle}
          >⋯</button>
          {rowMenuId === r.id && (
            <div role="menu" onClick={(e) => e.stopPropagation()} style={rowMenuStyle}>
              <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); navigate(`/decision-rights/${r.id}`); }}>Open</button>
              {isAdmin && <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); handleDuplicate(r); }}>Duplicate</button>}
              {isAdmin && <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); setConfirmDelete(r.id); }}>Delete</button>}
            </div>
          )}
        </span>
      ),
    },
  ].filter(Boolean) as DataTableColumn<DecisionRight>[]);

  return (
    <div>

      {/* Header */}
      <PageHeader
        title="Decision Rights"
        actions={
          <ListToolbar
            views={
              <SavedViewsMenu
                pageKey="decision-rights"
                currentFilters={{ categoryFilter, searchQuery }}
                onApply={(f) => {
                  setCategoryFilter(((f.categoryFilter as 'ALL' | DecisionCategory) || 'ALL'));
                  setSearchQuery((f.searchQuery as string) || '');
                }}
              />
            }
            export={
              rows.length > 0 ? (
                <ExportMenu
                  build={() => ({
                    filenameBase: 'decision-rights',
                    sheetName: 'Decision Rights',
                    headers: ['Decision', 'Category', 'Decides', 'Recommends', 'Approves', 'Informed', 'Escalation path'],
                    rows: rows.map((r) => [
                      r.decision,
                      CATEGORY_LABELS[r.category] || r.category,
                      r.deciderName || (r.decider ? labelFor(r.decider, people, groups) : ''),
                      (r.recommends || []).map((v) => labelFor(v, people, groups)).join('; '),
                      (r.approves || []).map((v) => labelFor(v, people, groups)).join('; '),
                      (r.informed || []).map((v) => labelFor(v, people, groups)).join('; '),
                      r.escalationPath || '',
                    ]),
                  })}
                />
              ) : undefined
            }
            columns={<ColumnPicker state={decisionCols} />}
            extra={isAdmin && rows.length === 0 ? (
              <Button
                variant="secondary"
                disabled={seeding}
                onClick={handleSeed}
              >
                {seeding ? 'Seeding...' : 'Seed Standard Decisions'}
              </Button>
            ) : undefined}
            primary={isAdmin ? <Button variant="primary" onClick={openAdd}>+ Add decision</Button> : undefined}
          />
        }
      />

      {/* The five-role definition up front — the whole chain, not just the
          decider, is what this page captures. */}
      <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', maxWidth: 820, fontSize: 13.5, lineHeight: 1.5 }}>
        For each recurring decision: who <strong style={{ color: 'var(--color-text)' }}>decides</strong>, who <strong style={{ color: 'var(--color-text)' }}>recommends</strong>, who <strong style={{ color: 'var(--color-text)' }}>approves</strong>, who is <strong style={{ color: 'var(--color-text)' }}>informed</strong>, and where it goes if people disagree.
      </p>

      {/* Search + row-expansion controls. Category filter moved into the
       *  sidebar; expand/collapse-all replaces the visual noise of always
       *  rendering every RACI column. */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            aria-label="Search decisions" placeholder="Search decisions, decider, escalation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: '1 1 280px', maxWidth: 420,
              fontSize: 13, padding: '6px 10px',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>
            <span>{filteredRows.length} of {rows.length} decisions</span>
            {categoryFilter !== 'ALL' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 4px 0 10px', borderRadius: 12, background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontWeight: 600 }}>
                {CATEGORY_LABELS[categoryFilter]}
                <button type="button" aria-label="Remove category filter" onClick={() => setCategoryFilter('ALL')} style={{ width: 18, height: 18, border: 0, borderRadius: 9, background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1 }}>×</button>
              </span>
            )}
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
        <Card padding={20} marginBottom={20}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add Decision Right</h3>
          <DecisionRightFields form={form} setForm={setForm} people={people} groups={groups} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={closeForm}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.decision.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Decision Right'}
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${sel.count} decision right${sel.count === 1 ? '' : 's'}?`}
        message="This cannot be undone."
        confirmLabel={`Delete ${sel.count}`}
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

      {/* Decision areas — the eight common areas governance covers. A covered
          area shows its count; an uncovered one reads "Not defined" on a
          dashed card, so the gaps are as legible as the coverage. Clicking a
          card filters the table (and clicking the active one clears). */}
      <div>
        {rows.length > 0 && (
          <section aria-label="Decision areas" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <SectionLabel marginBottom={0}>Decision areas</SectionLabel>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Covered {CATEGORIES.filter((c) => (categoryCounts[c] || 0) > 0).length} of {CATEGORIES.length} · Click an area to filter
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              {CATEGORIES.map((c) => {
                const n = categoryCounts[c] || 0;
                const active = categoryFilter === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setCategoryFilter(active ? 'ALL' : c)}
                    title={CATEGORY_HINT[c]}
                    style={{
                      textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px',
                      minHeight: 62, display: 'flex', flexDirection: 'column', gap: 2,
                      border: `1px ${n ? 'solid' : 'dashed'} ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      background: active ? 'var(--color-primary-light)' : (n ? 'var(--color-surface)' : 'var(--color-bg)'),
                      boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'none',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{CATEGORY_LABELS[c]}</span>
                    <span style={{ fontSize: 12, color: n ? 'var(--color-text-secondary)' : 'var(--color-warning)' }}>
                      {n ? `Decisions ${n}` : 'Not defined'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
          {loadError ? (
            <ErrorState message={loadError} onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }} />
          ) : loading ? (
            <SkeletonRows rows={5} columns={6} />
          ) : rows.length === 0 && !showForm ? (
            <EmptyState
              icon={renderNavIcon('/decision-rights')}
              title="No decision rights defined yet"
              description={isAdmin
                ? 'Who has authority to decide, recommend, approve, and be informed. Seed the standard set or add your own.'
                : 'Who has authority to decide, recommend, approve, and be informed. An administrator can seed the standard set.'}
              action={isAdmin ? { label: 'Seed Standard Decisions', onClick: handleSeed } : undefined}
            />
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
              {searchQuery.trim() ? 'No decisions match your search.' : 'No decisions match the selected category.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <DataTable
                rows={sorted}
                columns={decisionColumns}
                rowKey={(r) => r.id}
                // Selection drives the bulk-delete bar, an admin-only write, so
                // editors get no checkboxes (read-only governance view).
                selection={isAdmin ? sel : undefined}
                sort={{ sortKey, sortDir, onSort: toggleSort }}
                onRowClick={(r) => navigate(`/decision-rights/${r.id}`)}
                selectAllLabel="Select all decision rights"
                emptyMessage="No decisions match the current filters."
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', fontSize: 12, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
                <span>Decisions {filteredRows.length}</span>
                <span>Round avatar = person · Square = group or role</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
