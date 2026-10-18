import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import AttachmentsPanel from '../components/AttachmentsPanel';
import { useToastStore } from '../stores/toastStore';
import { usePermissions } from '../hooks/usePermissions';
import { clickable } from '../lib/a11y';
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

// The expanded body of one manual card. The manual's own scalar fields —
// label, role, purpose and custom content — edit as one staged Edit→Save
// unit (useDetailEditMode + DetailEditActions), the same view/edit model as
// every other detail surface. The section activity lists and linked documents
// below are live quick-edit controls and stay immediate.
function ExpandedManual({ manual, roleHolders, canWrite, orgId, onUpdate, onSaved }: {
  manual: OperationsManual;
  roleHolders: Record<string, string[]>;
  canWrite: boolean;
  orgId: string | null;
  onUpdate: (id: string, patch: Partial<OperationsManual>) => void;
  onSaved: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [addInputs, setAddInputs] = useState<Record<string, string>>({});
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set());

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

  const toggleSection = (key: SectionKey) =>
    setExpandedSections((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
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

  return (
    <div style={{ padding: 16 }}>
      {canWrite && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: m.isEditing ? 12 : 8 }}>
          <DetailEditActions editing={m.isEditing} canEdit dirty={m.dirty} saving={m.saving} onEdit={m.enter} onCancel={m.cancel} onSave={m.save} />
        </div>
      )}

      {/* Header scalar fields — edit vs view */}
      {m.isEditing ? (
        <div style={{ marginBottom: 16 }}>
          <input aria-label="Label" style={{ ...inputStyle, marginBottom: 8, fontWeight: 600, fontSize: 16 }} value={m.draft.label} onChange={(e) => m.set('label', e.target.value)} placeholder="Label" />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>Role this manual is for</label>
          <select aria-label="Role" style={{ ...inputStyle, marginBottom: 8 }} value={m.draft.roleType} onChange={(e) => m.set('roleType', e.target.value)}>{roleOptions}</select>
          <textarea aria-label="Purpose" style={{ ...inputStyle, minHeight: 80 }} value={m.draft.purpose} onChange={(e) => m.set('purpose', e.target.value)} placeholder="Purpose" />
        </div>
      ) : (
        <>
          {/* Role & who holds it — the manual↔role link, made visible. */}
          {manual.roleType && manual.roleType !== CUSTOM_ROLE && (() => {
            const holders = roleHolders[manual.roleType] || [];
            const shown = holders.slice(0, 3).join(', ');
            const extra = holders.length > 3 ? ` +${holders.length - 3}` : '';
            return (
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: manual.purpose ? 8 : 16 }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Role: </span>
                <span style={{ fontWeight: 600 }}>{roleLabel(manual.roleType)}</span>
                {' · '}
                {holders.length > 0
                  ? <span>Held by {shown}{extra}</span>
                  : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>not assigned to anyone yet — assign on the Roles page</span>}
              </div>
            );
          })()}
          {manual.purpose && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, fontStyle: 'italic', lineHeight: 1.5 }}>{manual.purpose}</p>}
        </>
      )}

      {/* Sections in 2-column grid — live quick-edit */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {SECTIONS.map((s) => {
          const items = manual[s.key];
          const expanded = expandedSections.has(s.key);
          return (
            <div key={s.key} style={{ borderLeft: `3px solid ${s.accentColor}`, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <div {...clickable(() => toggleSection(s.key), { label: `Toggle ${s.name} section` })} aria-expanded={expanded} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{expanded ? '▼' : '▶'}</span>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: s.accentColor, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{s.name}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{items.length}</span>
              </div>
              {expanded && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6 }}>{s.description}</div>
                  {items.length === 0
                    ? <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic', marginBottom: 6 }}>No activities defined.</div>
                    : <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                        {items.map((item, idx) => (
                          <li key={idx} style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                            <span style={{ flex: 1 }}>{item}</span>
                            {canWrite && <button onClick={() => removeItem(s.key, idx)} title="Remove"
                              style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, fontWeight: 700, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>x</button>}
                          </li>
                        ))}
                      </ul>}
                  {canWrite && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input aria-label={`Add ${s.name} item`} style={{ ...inputStyle, flex: 1, fontSize: 12, padding: '4px 8px' }} value={addInputs[s.key] || ''} onChange={(e) => setAddInputs((p) => ({ ...p, [s.key]: e.target.value }))}
                        placeholder="Add item..." onKeyDown={(e) => e.key === 'Enter' && addItem(s.key)} />
                      <Button variant="primary" size="sm"
                        onClick={() => addItem(s.key)} disabled={!(addInputs[s.key] || '').trim()}>Add</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom Content — part of the staged Edit→Save unit */}
      <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
        <SectionLabel marginBottom={6}>Custom Content</SectionLabel>
        {m.isEditing ? (
          <textarea aria-label="Custom Content" style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit', lineHeight: 1.6, fontSize: 12 }} value={m.draft.customContent}
            onChange={(e) => m.set('customContent', e.target.value)} placeholder="Paste or type additional content here..." />
        ) : manual.customContent ? (
          <div style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{manual.customContent}</div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No custom content. Use Edit to add notes.</div>
        )}
      </div>

      {/* Linked documents — point this manual at the real doc wherever it
          lives (SharePoint, a web page, a file server) or upload a copy. */}
      <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
        <SectionLabel marginBottom={6}>Linked documents</SectionLabel>
        <AttachmentsPanel entityType="OperationsManual" entityId={manual.id} orgId={orgId ?? undefined} disabled={!canWrite} hideHeader />
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
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
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
  const toggleCard = (id: string) => {
    setExpandedCards((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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
      <button type="button" onClick={(e) => { e.stopPropagation(); toggleCard(m.id); }} title="No activities at this frequency yet"
        style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', border: '1px dashed var(--color-warning)', borderRadius: 13, color: 'var(--color-warning)', background: 'transparent', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>None set</button>
    ));

  return (
    <div>
      <EmbeddablePageHeader
        embedded={embedded}
        actionsPortal={actionsPortal}
        title="Operations Manual"
        subtitle="Role-specific guidance for running your governance program."
        actions={<>
          <Button variant="secondary" onClick={handleSeed} disabled={seeding} title="Creates the standard manual for each governance role that doesn't have one yet. Existing manuals are left untouched.">{seedLabel}</Button>
          {canWrite && <Button variant="primary" onClick={() => setShowAddManual(true)}>+ Add manual</Button>}
        </>}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                  {emptySlotExamples.length > 0 && (
                    <div style={{ borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{emptySlotExamples.length}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warning)' }}>Review</span>
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Empty cadence slots</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{emptySlotExamples.slice(0, 2).join('; ')}{emptySlotExamples.length > 2 ? '; …' : ''}</span>
                    </div>
                  )}
                  {draftRefExamples.length > 0 && (
                    <button type="button" onClick={() => navigate('/documentation?tab=procedures')} style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{draftRefExamples.length}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-warning)' }}>Fix first</span>
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Manual points to a draft procedure</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{draftRefExamples.slice(0, 2).join('; ')}</span>
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
                      const isExpanded = expandedCards.has(m.id);
                      const isSelected = selectedIds.has(m.id);
                      const refs = sopsForManual(m);
                      const colCount = (canWrite ? 1 : 0) + 8;
                      return (
                        <>
                          <tr key={m.id} style={{ background: isSelected ? 'var(--color-primary-light)' : 'transparent' }}>
                            {canWrite && (
                              <td style={tdStyle}>
                                <input type="checkbox" checked={isSelected} aria-label={`Select ${m.label}`}
                                  onChange={() => { const n = new Set(selectedIds); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); setSelectedIds(n); }}
                                  style={{ cursor: 'pointer' }} />
                              </td>
                            )}
                            <td style={tdStyle}>
                              <button type="button" onClick={() => toggleCard(m.id)} aria-expanded={isExpanded}
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
                                <Button variant="secondary" size="sm" onClick={() => toggleCard(m.id)}>{isExpanded ? 'Close' : 'Open'}</Button>
                                {canWrite && (
                                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                                    <button type="button" aria-label={`More actions for ${m.label}`} aria-haspopup="menu" aria-expanded={rowMenuId === m.id}
                                      onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === m.id ? null : m.id); }}
                                      style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                                    {rowMenuId === m.id && (
                                      <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 150, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))', padding: 6, textAlign: 'left' }}>
                                        <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); if (!isExpanded) toggleCard(m.id); }}>Open &amp; edit</button>
                                        <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); handleDuplicateManual(m); }}>Duplicate</button>
                                        <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); setConfirmDeleteId(m.id); }}>Delete</button>
                                      </div>
                                    )}
                                  </span>
                                )}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${m.id}-detail`}>
                              <td colSpan={colCount} style={{ padding: 0, background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                                <ExpandedManual
                                  manual={m}
                                  roleHolders={roleHolders}
                                  canWrite={canWrite}
                                  orgId={activeOrgId}
                                  onUpdate={updateManual}
                                  onSaved={fetchManuals}
                                />
                              </td>
                            </tr>
                          )}
                        </>
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
