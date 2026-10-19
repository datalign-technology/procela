import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import AttachmentsPanel from '../components/AttachmentsPanel';
import { useToastStore } from '../stores/toastStore';
import { usePermissions } from '../hooks/usePermissions';
import ConfirmDialog from '../components/ConfirmDialog';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import EmbeddablePageHeader from '../components/EmbeddablePageHeader';
import Button from '../components/Button';
import Card from '../components/Card';
import TruncatedText from '../components/TruncatedText';
import { SkeletonRows } from '../components/Skeleton';
import SectionLabel from '../components/SectionLabel';
import DetailEditActions from '../components/DetailEditActions';
import { useDetailEditMode } from '../hooks/useDetailEditMode';
import { DAMA_ROLE_TYPES, DAMA_ROLE_LABELS } from '../types';

// ── Types ──
interface OperationsManual {
  id: string; orgId: string; roleType: string; label: string; purpose: string;
  daily: string[]; weekly: string[]; monthly: string[]; quarterly: string[];
  escalation: string[]; customContent: string; isCustom: boolean;
  createdAt: string; updatedAt: string;
}

// A manual's role is the DAMA role it documents, or 'CUSTOM' for one that
// maps to no standard role. The picker offers the standard roles plus Custom.
const CUSTOM_ROLE = 'CUSTOM';
const roleLabel = (roleType: string) => DAMA_ROLE_LABELS[roleType] || roleType;

// DAMA role assignment as returned enriched by GET /dama-roles?orgId=.
interface RoleAssignment { roleType: string; personName: string | null; agentName: string | null; }

// A procedure (SOP) — code + status, for the "Uses procedures" column and the
// right-rail list. Manual activity text references a procedure by its code
// (e.g. "Run access recertification (SOP-003)").
interface SopRef { id: string; code: string; title: string; status: string }
const SOP_CODE_RE = /SOP-\d+/g;

// The four recurring cadences shown as count columns (escalation is a path,
// not a cadence, so it sits apart in the "Empty cadence slots" tally).
const CADENCES: Array<{ key: 'daily' | 'weekly' | 'monthly' | 'quarterly'; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
];

type SectionKey = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'escalation';
interface SectionDef { key: SectionKey; name: string; accentColor: string; description: string; }

const SECTIONS: SectionDef[] = [
  { key: 'daily', name: 'Daily activities', accentColor: '#22c55e', description: 'Ongoing, every-day responsibilities' },
  { key: 'weekly', name: 'Weekly activities', accentColor: '#3b82f6', description: 'Recurring work to track momentum and unblock teams' },
  { key: 'monthly', name: 'Monthly activities', accentColor: '#8b5cf6', description: 'Reviews, reporting, and committee-level engagement' },
  { key: 'quarterly', name: 'Quarterly activities', accentColor: '#f59e0b', description: 'Strategic reviews and roadmap planning' },
  { key: 'escalation', name: 'Escalation paths', accentColor: '#dc2626', description: 'When to escalate and to whom' },
];

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13, border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', width: '100%',
};

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};

interface ManualEditable { label: string; purpose: string; roleType: string; customContent: string; }

// Soft per-cadence pill palette for the reader section headers.
const SECTION_PILL: Record<SectionKey, { bg: string; color: string }> = {
  daily: { bg: '#dcefe5', color: '#17604b' },
  weekly: { bg: '#e6eef9', color: '#24508f' },
  monthly: { bg: '#e5ecf3', color: '#364a5e' },
  quarterly: { bg: '#fbe9d9', color: '#9a4a0e' },
  escalation: { bg: '#fbe4e4', color: '#a4262c' },
};
const SOP_READER_STATUS: Record<string, { bg: string; color: string }> = {
  ACTIVE: { bg: '#d1fae5', color: '#065f46' },
  DRAFT: { bg: '#fef3c7', color: '#92400e' },
  DEPRECATED: { bg: '#f3f4f6', color: '#6b7280' },
};

const readerPanel: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
};

// The full reading view of one manual: a header with Role / Held-by, every
// cadence as a labelled always-visible section (not collapsed behind a click),
// procedure references rendered as links with status, free-form notes and
// linked documents. Edit flips the scalar fields in place; the activity lists
// stay live quick-edit. Delete / duplicate live in the "⋯" menu.
function ManualReader({ manual, roleHolders, canWrite, orgId, onUpdate, onSaved, sops, onDuplicate, onDelete }: {
  manual: OperationsManual;
  roleHolders: Record<string, string[]>;
  canWrite: boolean;
  orgId: string | null;
  onUpdate: (id: string, patch: Partial<OperationsManual>) => void;
  onSaved: () => void;
  sops: SopRef[];
  onDuplicate: (m: OperationsManual) => void;
  onDelete: (id: string) => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [addInputs, setAddInputs] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const m = useDetailEditMode<ManualEditable>(
    {
      label: manual.label,
      purpose: manual.purpose,
      roleType: manual.roleType || CUSTOM_ROLE,
      customContent: manual.customContent,
    },
    async (draft) => {
      if (!draft.label.trim()) { addToast('error', 'Label is required'); throw new Error('no-label'); }
      try {
        await apiClient.put(`/operations-manuals/${manual.id}`, {
          label: draft.label, purpose: draft.purpose, roleType: draft.roleType, customContent: draft.customContent,
        });
        addToast('success', 'Manual updated');
        onSaved();
      } catch (e) { addToast('error', 'Failed to save changes'); throw e; }
    },
  );

  const addItem = (section: SectionKey) => {
    const text = (addInputs[section] || '').trim();
    if (!text) return;
    onUpdate(manual.id, { [section]: [...manual[section], text] });
    setAddInputs((p) => ({ ...p, [section]: '' }));
  };
  const removeItem = (section: SectionKey, idx: number) =>
    onUpdate(manual.id, { [section]: manual[section].filter((_, i) => i !== idx) });

  const roleOptions = (
    <>
      <option value={CUSTOM_ROLE}>Custom (no specific role)</option>
      {DAMA_ROLE_TYPES.map((rt) => <option key={rt} value={rt}>{DAMA_ROLE_LABELS[rt]}</option>)}
    </>
  );

  const sopByCode = new Map(sops.map((s) => [s.code, s]));
  const total = SECTIONS.reduce((n, s) => n + manual[s.key].length, 0);
  const holders = roleHolders[manual.roleType] || [];
  const holderText = manual.roleType && manual.roleType !== CUSTOM_ROLE
    ? (holders.length > 0 ? holders.slice(0, 3).join(', ') + (holders.length > 3 ? ` +${holders.length - 3}` : '') : 'Not assigned yet')
    : '—';

  // Split an activity line so a trailing "(SOP-003)" / "SOP-003" renders as a
  // status-badged link to the procedure.
  const renderItemText = (text: string) => {
    const code = (text.match(SOP_CODE_RE) || [])[0];
    if (!code) return <span style={{ flex: 1 }}>{text}</span>;
    const sop = sopByCode.get(code) || null;
    const stripped = text.replace(new RegExp(`\\s*\\(?${code}\\)?`), '').trim();
    return (
      <span style={{ flex: 1, display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span>{stripped}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'var(--color-primary)' }}>{code}</span>
          {sop && <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, ...(SOP_READER_STATUS[sop.status] || SOP_READER_STATUS.DEPRECATED) }}>{sop.status.charAt(0) + sop.status.slice(1).toLowerCase()}</span>}
        </span>
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header card */}
      <section style={{ ...readerPanel, padding: '20px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Operations manual</div>
            {m.isEditing ? (
              <>
                <input aria-label="Label" style={{ ...inputStyle, margin: '6px 0 8px', fontWeight: 600, fontSize: 18 }} value={m.draft.label} onChange={(e) => m.set('label', e.target.value)} placeholder="Label" />
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>Role this manual is for</label>
                <select aria-label="Role" style={{ ...inputStyle, marginBottom: 8 }} value={m.draft.roleType} onChange={(e) => m.set('roleType', e.target.value)}>{roleOptions}</select>
                <textarea aria-label="Purpose" style={{ ...inputStyle, minHeight: 70 }} value={m.draft.purpose} onChange={(e) => m.set('purpose', e.target.value)} placeholder="Purpose" />
              </>
            ) : (
              <>
                <h2 style={{ margin: '4px 0 6px', fontSize: 20, fontWeight: 600 }}>{manual.label}</h2>
                {manual.purpose && <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{manual.purpose}</p>}
              </>
            )}
          </div>
          {canWrite && (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <DetailEditActions editing={m.isEditing} canEdit dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
              {!m.isEditing && (
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <button type="button" aria-label="More actions for this manual" aria-haspopup="menu" aria-expanded={menuOpen}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                    style={{ width: 34, height: 34, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 8, color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                  {menuOpen && (
                    <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 38, right: 0, zIndex: 30, minWidth: 150, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                      <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setMenuOpen(false); onDuplicate(manual); }}>Duplicate</button>
                      <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setMenuOpen(false); onDelete(manual.id); }}>Delete</button>
                    </div>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
        {!m.isEditing && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-border)', fontSize: 13 }}>
            <span><span style={{ color: 'var(--color-text-muted)' }}>Role </span><strong style={{ fontWeight: 600 }}>{manual.roleType && manual.roleType !== CUSTOM_ROLE ? roleLabel(manual.roleType) : 'Custom'}</strong></span>
            <span><span style={{ color: 'var(--color-text-muted)' }}>Held by </span><strong style={{ fontWeight: 600 }}>{holderText}</strong></span>
            <span><span style={{ color: 'var(--color-text-muted)' }}>Activities </span><strong style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{total}</strong></span>
          </div>
        )}
      </section>

      {/* Cadence sections — every one visible, no second click to read. */}
      {SECTIONS.map((s) => {
        const items = manual[s.key];
        const pill = SECTION_PILL[s.key];
        const addId = `add-${manual.id}-${s.key}`;
        return (
          <section key={s.key} style={readerPanel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', borderRadius: 13, fontSize: 12, fontWeight: 600, background: pill.bg, color: pill.color }}>{s.name.replace(/ activities| paths/i, '')}</span>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</span>
              </div>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{items.length}</span>
            </div>
            {items.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
                {items.map((item, idx) => (
                  <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 16px', fontSize: 13.5, lineHeight: 1.5 }}>
                    <span aria-hidden="true" style={{ flex: 'none', marginTop: 6, width: 5, height: 5, borderRadius: '50%', background: 'var(--color-text-muted)' }} />
                    {renderItemText(item)}
                    {canWrite && <button type="button" onClick={() => removeItem(s.key, idx)} aria-label={`Remove: ${item}`} title="Remove"
                      style={{ flexShrink: 0, background: 'none', border: 0, color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '14px 16px', background: 'var(--color-warning-light, #fffbeb)' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>No {s.name.replace(/ activities| paths/i, '').toLowerCase()} activities for this role yet. Is that intentional?</span>
                {canWrite && <button type="button" onClick={() => { const el = document.getElementById(addId) as HTMLInputElement | null; el?.focus(); }}
                  style={{ height: 32, padding: '0 12px', border: '1px solid var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-primary)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add activity</button>}
              </div>
            )}
            {canWrite && (
              <div style={{ display: 'flex', gap: 6, padding: '8px 16px', borderTop: items.length > 0 ? '1px solid var(--color-border)' : 'none' }}>
                <input id={addId} aria-label={`Add ${s.name} item`} style={{ ...inputStyle, flex: 1, fontSize: 13 }} value={addInputs[s.key] || ''}
                  onChange={(e) => setAddInputs((p) => ({ ...p, [s.key]: e.target.value }))} placeholder="Add an activity…" onKeyDown={(e) => e.key === 'Enter' && addItem(s.key)} />
                <Button variant="secondary" size="sm" onClick={() => addItem(s.key)} disabled={!(addInputs[s.key] || '').trim()}>Add</Button>
              </div>
            )}
          </section>
        );
      })}

      {/* Notes + linked documents */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <section style={{ ...readerPanel, padding: 16 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>Additional notes</h3>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>Free-form guidance that does not fit a cadence, such as context or tips.</p>
          {m.isEditing ? (
            <textarea aria-label="Additional notes" style={{ ...inputStyle, minHeight: 80, lineHeight: 1.6 }} value={m.draft.customContent} onChange={(e) => m.set('customContent', e.target.value)} placeholder="Paste or type additional guidance…" />
          ) : manual.customContent ? (
            <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{manual.customContent}</div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No notes yet. Use Edit to add guidance.</div>
          )}
        </section>
        <section style={{ ...readerPanel, padding: 16 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>Linked documents</h3>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-text-muted)' }}>Point to the official copy (SharePoint, intranet, file share) or upload one.</p>
          <AttachmentsPanel entityType="OperationsManual" entityId={manual.id} orgId={orgId ?? undefined} disabled={!canWrite} hideHeader />
        </section>
      </div>
    </div>
  );
}

export default function OperationsManualPage({
  embedded = false,
  actionsPortal,
}: {
  embedded?: boolean;
  actionsPortal?: HTMLElement | null;
} = {}) {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const { canWrite } = usePermissions();
  const navigate = useNavigate();
  const [manuals, setManuals] = useState<OperationsManual[]>([]);
  const [sops, setSops] = useState<SopRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAddManual, setShowAddManual] = useState(false);
  const [newManualLabel, setNewManualLabel] = useState('');
  const [newManualRole, setNewManualRole] = useState<string>(CUSTOM_ROLE);
  // roleType → names of the people/agents currently holding that DAMA role in
  // this org, so a manual can show who actually operates it.
  const [roleHolders, setRoleHolders] = useState<Record<string, string[]>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // The manual open in the reader (two-pane view); null shows the cadence
  // overview table.
  const [selectedManualId, setSelectedManualId] = useState<string | null>(null);
  // Per-row "⋯" overflow menu (Open & edit / Duplicate / Delete).
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  const fetchManuals = useCallback(async () => {
    if (!activeOrgId) { setManuals([]); setRoleHolders({}); setLoading(false); return; }
    try {
      // Manuals plus the org's DAMA role assignments, so each manual can show
      // who currently holds the role it documents.
      const [manualsRes, rolesRes, sopsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OperationsManual[] }>(`/operations-manuals?orgId=${activeOrgId}`),
        apiClient.get<{ success: boolean; data: RoleAssignment[] }>(`/dama-roles?orgId=${activeOrgId}`).catch(() => ({ data: [] as RoleAssignment[] })),
        apiClient.get<{ success: boolean; data: SopRef[] }>(`/sops?orgId=${activeOrgId}`).catch(() => ({ data: [] as SopRef[] })),
      ]);
      setManuals(manualsRes.data || []);
      setSops(sopsRes.data || []);
      const holders: Record<string, string[]> = {};
      for (const r of rolesRes.data || []) {
        const name = r.personName || r.agentName;
        if (!name) continue;
        (holders[r.roleType] ||= []).push(name);
      }
      setRoleHolders(holders);
    } catch { /* */ } finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { setLoading(true); fetchManuals(); }, [fetchManuals]);

  const handleSeed = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization first.'); return; }
    setSeeding(true);
    try { await apiClient.post('/operations-manuals/seed', { orgId: activeOrgId }); addToast('success', 'Standard manuals generated'); await fetchManuals(); }
    catch { addToast('error', 'Failed to generate manuals'); } finally { setSeeding(false); }
  };

  const updateManual = async (id: string, patch: Partial<OperationsManual>) => {
    try {
      const res = await apiClient.put<{ success: boolean; data: OperationsManual }>(`/operations-manuals/${id}`, patch);
      setManuals((prev) => prev.map((m) => m.id === id ? res.data : m));
    } catch { addToast('error', 'Failed to save changes'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/operations-manuals/${id}`); addToast('success', 'Manual deleted'); setConfirmDeleteId(null);
      if (selectedManualId === id) setSelectedManualId(null);
      const next = new Set(selectedIds); next.delete(id); setSelectedIds(next); await fetchManuals();
    } catch { addToast('error', 'Failed to delete manual'); }
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    await Promise.all([...selectedIds].map((id) => apiClient.delete(`/operations-manuals/${id}`)));
    setSelectedIds(new Set()); setConfirmBulkDelete(false);
    addToast('success', `Deleted ${count} manual${count === 1 ? '' : 's'}`); await fetchManuals();
  };
  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === manuals.length ? new Set() : new Set(manuals.map((m) => m.id)));
  };

  const handleAddManual = async () => {
    if (!activeOrgId || !newManualLabel.trim()) return;
    try {
      await apiClient.post('/operations-manuals', { orgId: activeOrgId, label: newManualLabel.trim(), roleType: newManualRole, isCustom: true });
      addToast('success', 'Manual created'); setNewManualLabel(''); setNewManualRole(CUSTOM_ROLE); setShowAddManual(false); await fetchManuals();
    } catch { addToast('error', 'Failed to create manual'); }
  };

  // <select> options: each standard DAMA role (that has no manual yet is not
  // enforced — multiple manuals per role are allowed) plus a Custom fallback.
  const roleOptions = (
    <>
      <option value={CUSTOM_ROLE}>Custom (no specific role)</option>
      {DAMA_ROLE_TYPES.map((rt) => <option key={rt} value={rt}>{DAMA_ROLE_LABELS[rt]}</option>)}
    </>
  );

  function renderAddManualDialog() {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowAddManual(false)}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 400, width: '100%', boxShadow: 'var(--shadow-xl)' }} onClick={(e) => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Add Manual</h3>
          <input aria-label="Manual name" style={inputStyle} value={newManualLabel} onChange={(e) => setNewManualLabel(e.target.value)} placeholder="Manual name" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAddManual()} />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '12px 0 4px' }}>Role this manual is for</label>
          <select aria-label="Role" style={inputStyle} value={newManualRole} onChange={(e) => setNewManualRole(e.target.value)}>{roleOptions}</select>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="secondary" onClick={() => { setShowAddManual(false); setNewManualLabel(''); setNewManualRole(CUSTOM_ROLE); }}>Cancel</Button>
            <Button variant="primary" onClick={handleAddManual} disabled={!newManualLabel.trim()}>Add</Button>
          </div>
        </div>
      </div>
    );
  }

  // Total items across all sections for a manual
  const totalItems = (m: OperationsManual) => SECTIONS.reduce((sum, s) => sum + m[s.key].length, 0);

  // Procedures (SOPs) a manual references by code in any activity line.
  const sopByCode = new Map(sops.map((s) => [s.code, s]));
  const sopsForManual = (m: OperationsManual) => {
    const text = [...m.daily, ...m.weekly, ...m.monthly, ...m.quarterly, ...m.escalation].join(' ');
    const codes = Array.from(new Set(text.match(SOP_CODE_RE) || []));
    return codes.map((code) => ({ code, sop: sopByCode.get(code) || null }));
  };
  const SOP_STATUS_COLOR: Record<string, { bg: string; color: string }> = {
    ACTIVE: { bg: '#d1fae5', color: '#065f46' },
    DRAFT: { bg: '#fef3c7', color: '#92400e' },
    DEPRECATED: { bg: '#f3f4f6', color: '#6b7280' },
  };

  const handleDuplicateManual = async (m: OperationsManual) => {
    if (!activeOrgId) return;
    try {
      await apiClient.post('/operations-manuals', {
        orgId: activeOrgId, label: `${m.label} (copy)`, roleType: m.roleType, purpose: m.purpose,
        daily: m.daily, weekly: m.weekly, monthly: m.monthly, quarterly: m.quarterly,
        escalation: m.escalation, customContent: m.customContent, isCustom: true,
      });
      addToast('success', 'Manual duplicated'); await fetchManuals();
    } catch { addToast('error', 'Failed to duplicate manual'); }
  };

  // ── Render ──
  if (loading) return <SkeletonRows rows={5} />;
  if (!activeOrgId) return (
    <EmptyState icon={renderNavIcon('/organizations')} title="No organization selected" description="Select an organization from the header to view operations manuals." />
  );

  const seedLabel = seeding ? 'Generating…' : 'Generate standard manuals';

  // Needs-attention tallies — computed live from the manuals.
  const emptySlotExamples: string[] = [];
  for (const m of manuals) {
    for (const c of CADENCES) {
      if (m[c.key].length === 0) emptySlotExamples.push(`${roleLabel(m.roleType)} has no ${c.label.toLowerCase()} work`);
    }
  }
  const draftRefExamples: string[] = [];
  for (const m of manuals) {
    for (const { code, sop } of sopsForManual(m)) {
      if (sop && sop.status === 'DRAFT') draftRefExamples.push(`${m.label} runs ${code}, which is still Draft`);
    }
  }
  const totalActivities = manuals.reduce((sum, m) => sum + totalItems(m), 0);

  const thStyle: React.CSSProperties = { padding: 12, fontWeight: 600, borderBottom: '1px solid var(--color-border)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' };
  const tdStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--color-border)', verticalAlign: 'middle' };
  const countCell = (n: number, m: OperationsManual) => (n > 0
    ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</span>
    : (
      <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedManualId(m.id); }} title="No activities at this frequency yet — open the manual to add some"
        style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', border: '1px dashed var(--color-warning)', borderRadius: 13, color: 'var(--color-warning)', background: 'transparent', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>None set</button>
    ));

  const headerActions = (
    <>
      <Button variant="secondary" onClick={handleSeed} disabled={seeding} title="Creates the standard manual for each governance role that doesn't have one yet. Existing manuals are left untouched.">{seedLabel}</Button>
      {canWrite && <Button variant="primary" onClick={() => setShowAddManual(true)}>+ Add manual</Button>}
    </>
  );

  // ── Reader (two-pane): a manual is selected — pick on the left, read on the
  //    right, so opening one no longer pushes the whole list down. ──
  const selectedManual = selectedManualId ? manuals.find((mm) => mm.id === selectedManualId) : null;
  if (selectedManual) {
    const gapNote = (mm: OperationsManual) => {
      const g = CADENCES.filter((c) => mm[c.key].length === 0).map((c) => c.label.toLowerCase());
      return g.length ? `No ${g.join(', ')} activities` : '';
    };
    return (
      <div>
        <EmbeddablePageHeader embedded={embedded} actionsPortal={actionsPortal} title="Operations Manual"
          subtitle="Role-specific guidance for running your governance program." actions={headerActions} />
        <button type="button" onClick={() => setSelectedManualId(null)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 0, padding: '0 0 12px', font: 'inherit', fontSize: 13, color: 'var(--color-primary)', cursor: 'pointer' }}>&larr; All manuals</button>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <aside style={{ flex: '1 1 240px', maxWidth: 320, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 8px', boxSizing: 'border-box' }}>
            <SectionLabel style={{ padding: '0 8px', marginBottom: 8 }}>Role manuals</SectionLabel>
            {manuals.map((mm) => {
              const active = mm.id === selectedManualId;
              const note = gapNote(mm);
              return (
                <button key={mm.id} type="button" onClick={() => setSelectedManualId(mm.id)} aria-pressed={active}
                  style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, border: 0, borderRadius: 8, cursor: 'pointer', textAlign: 'left', padding: '10px', marginBottom: 2, background: active ? 'var(--color-primary-light)' : 'transparent', boxShadow: active ? 'inset 3px 0 0 var(--color-primary)' : 'none' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--color-primary)' : 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{mm.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{mm.roleType && mm.roleType !== CUSTOM_ROLE ? roleLabel(mm.roleType) : 'Custom'} · {totalItems(mm)} activities</span>
                  {note && <span style={{ fontSize: 12, color: 'var(--color-warning)', fontWeight: 600 }}>{note}</span>}
                </button>
              );
            })}
            <div style={{ margin: '12px 8px 0', paddingTop: 12, borderTop: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>Each manual describes one governance role&rsquo;s recurring work. Select one to read it.</div>
          </aside>
          <main style={{ flex: '999 1 540px', minWidth: 0 }}>
            <ManualReader manual={selectedManual} roleHolders={roleHolders} canWrite={canWrite} orgId={activeOrgId}
              onUpdate={updateManual} onSaved={fetchManuals} sops={sops} onDuplicate={handleDuplicateManual}
              onDelete={(id) => setConfirmDeleteId(id)} />
          </main>
        </div>
        <ConfirmDialog open={!!confirmDeleteId} title="Delete Manual" message="Are you sure you want to delete this operations manual? This cannot be undone."
          confirmLabel="Delete" variant="danger" onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)} onCancel={() => setConfirmDeleteId(null)} />
        {showAddManual && renderAddManualDialog()}
      </div>
    );
  }

  return (
    <div>
      <EmbeddablePageHeader
        embedded={embedded}
        actionsPortal={actionsPortal}
        title="Operations Manual"
        subtitle="Role-specific guidance for running your governance program."
        actions={headerActions}
      />

      {manuals.length === 0 ? (
        <>
          <EmptyState icon={renderNavIcon('/documentation')} title="No operations manuals yet" description="Generate the standard DAMA role manuals, or create a custom one."
            action={{ label: seedLabel, onClick: handleSeed }}
            secondaryAction={canWrite ? { label: '+ Add manual', onClick: () => setShowAddManual(true) } : undefined} />
          {showAddManual && renderAddManualDialog()}
        </>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <main style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Needs attention */}
            {(emptySlotExamples.length > 0 || draftRefExamples.length > 0) && (
              <section aria-label="Needs attention" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Needs attention</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {emptySlotExamples.length > 0 && (
                    <div style={{ borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 82, boxSizing: 'border-box', border: '1px solid var(--color-border)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{emptySlotExamples.length}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--color-warning)' }}>Review</span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Empty cadence slots</span>
                      <span className="na-card-hint" title={emptySlotExamples.join('; ')}>{emptySlotExamples.slice(0, 2).join('; ')}{emptySlotExamples.length > 2 ? '; …' : ''}</span>
                    </div>
                  )}
                  {draftRefExamples.length > 0 && (
                    <button type="button" onClick={() => navigate('/documentation?tab=procedures')} style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 82, boxSizing: 'border-box', border: '1px solid var(--color-border)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{draftRefExamples.length}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--color-warning)' }}>Fix first</span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Manual points to a draft procedure</span>
                      <span className="na-card-hint" title={draftRefExamples.join('; ')}>{draftRefExamples.slice(0, 2).join('; ')}</span>
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Cadence table */}
            <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Role manuals at a glance</h2>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>How many activities each role owns, by how often they happen. Open a manual to read or edit it.</p>
              </div>
              {canWrite && (
                <div style={{ display: 'flex', gap: 8, padding: '8px 16px', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selectedIds.size === manuals.length && manuals.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} /> Select all
                  </label>
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      {canWrite && <th style={{ ...thStyle, width: 40 }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Select</span></th>}
                      <th style={thStyle}>Manual</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Daily</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Weekly</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Monthly</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Quarterly</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Escalation</th>
                      <th style={thStyle}>Uses procedures</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manuals.map((m) => {
                      const isSelected = selectedIds.has(m.id);
                      const refs = sopsForManual(m);
                      return (
                          <tr key={m.id} style={{ background: isSelected ? 'var(--color-primary-light)' : 'transparent' }}>
                            {canWrite && (
                              <td style={tdStyle}>
                                <input type="checkbox" checked={isSelected} aria-label={`Select ${m.label}`}
                                  onChange={() => { const n = new Set(selectedIds); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); setSelectedIds(n); }}
                                  style={{ cursor: 'pointer' }} />
                              </td>
                            )}
                            <td style={tdStyle}>
                              <button type="button" onClick={() => setSelectedManualId(m.id)}
                                style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--color-text)', fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'block', maxWidth: 320 }}>
                                <TruncatedText text={m.label} style={{ fontWeight: 600 }} />
                              </button>
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                                Role: {m.roleType && m.roleType !== CUSTOM_ROLE ? roleLabel(m.roleType) : 'Custom'} · {totalItems(m)} activities
                              </span>
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{countCell(m.daily.length, m)}</td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{countCell(m.weekly.length, m)}</td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{countCell(m.monthly.length, m)}</td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{countCell(m.quarterly.length, m)}</td>
                            <td style={{ ...tdStyle, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{m.escalation.length || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                            <td style={tdStyle}>
                              {refs.length === 0
                                ? <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 13 }}>None linked</span>
                                : (
                                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                                    {refs.map(({ code, sop }) => (
                                      <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <button type="button" onClick={(e) => { e.stopPropagation(); navigate('/documentation?tab=procedures'); }}
                                          style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-primary)', cursor: 'pointer' }}>{code}</button>
                                        {sop && (
                                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 10, fontSize: 11, fontWeight: 600, ...(SOP_STATUS_COLOR[sop.status] || SOP_STATUS_COLOR.DEPRECATED) }}>{sop.status.charAt(0) + sop.status.slice(1).toLowerCase()}</span>
                                        )}
                                      </span>
                                    ))}
                                  </span>
                                )}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Button variant="secondary" size="sm" onClick={() => setSelectedManualId(m.id)}>Open</Button>
                                {canWrite && (
                                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                                    <button type="button" aria-label={`More actions for ${m.label}`} aria-haspopup="menu" aria-expanded={rowMenuId === m.id}
                                      onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === m.id ? null : m.id); }}
                                      style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                                    {rowMenuId === m.id && (
                                      <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 150, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                                        <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); setSelectedManualId(m.id); }}>Open &amp; edit</button>
                                        <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); handleDuplicateManual(m); }}>Duplicate</button>
                                        <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); setConfirmDeleteId(m.id); }}>Delete</button>
                                      </div>
                                    )}
                                  </span>
                                )}
                              </span>
                            </td>
                          </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', fontSize: 13, color: 'var(--color-text-muted)', background: 'var(--color-bg)' }}>
                <span>{manuals.length} manual{manuals.length === 1 ? '' : 's'} · {totalActivities} activities</span>
                <span>&ldquo;None set&rdquo; means the role has no activities at that frequency yet.</span>
              </div>
            </section>

            <BulkActionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
              <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete Selected</BulkActionButton>
            </BulkActionBar>
          </main>

          {/* Right rail — how manuals and procedures relate + the procedures list. */}
          <aside style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card>
              <SectionLabel>How the two fit together</SectionLabel>
              <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span aria-hidden="true" style={{ flex: 'none', width: 32, height: 32, borderRadius: 8, background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{renderNavIcon('/documentation', { size: 16 })}</span>
                <div><div style={{ fontWeight: 600 }}>Manual</div><div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>What one role does, and how often. One per role.</div></div>
              </div>
              <div style={{ display: 'flex', gap: 12, paddingTop: 10 }}>
                <span aria-hidden="true" style={{ flex: 'none', width: 32, height: 32, borderRadius: 8, background: '#e6eef9', color: '#24508f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{renderNavIcon('/documentation', { size: 16 })}</span>
                <div><div style={{ fontWeight: 600 }}>Procedure (SOP)</div><div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Step-by-step instructions for one job. A manual activity can point to one.</div></div>
              </div>
            </Card>
            {sops.length > 0 && (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <SectionLabel marginBottom={0}>Procedures</SectionLabel>
                  <button type="button" onClick={() => navigate('/documentation?tab=procedures')} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}>View all {sops.length}</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  {sops.slice(0, 6).map((s) => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{s.code}</span> {s.title}</span>
                      <span style={{ flexShrink: 0, fontWeight: 600, color: s.status === 'ACTIVE' ? 'var(--color-success)' : s.status === 'DRAFT' ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </aside>

          <ConfirmDialog open={!!confirmDeleteId} title="Delete Manual" message="Are you sure you want to delete this operations manual? This cannot be undone."
            confirmLabel="Delete" variant="danger" onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)} onCancel={() => setConfirmDeleteId(null)} />
          <ConfirmDialog open={confirmBulkDelete} title="Delete Selected Manuals"
            message={`This will permanently delete ${selectedIds.size} manual${selectedIds.size === 1 ? '' : 's'}. This cannot be undone.`}
            confirmLabel="Delete" variant="danger" onConfirm={handleBulkDelete} onCancel={() => setConfirmBulkDelete(false)} />
          {showAddManual && renderAddManualDialog()}
        </div>
      )}
    </div>
  );
}
