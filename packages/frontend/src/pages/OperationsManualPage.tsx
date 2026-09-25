import { useEffect, useState, useCallback } from 'react';
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
import IconButton from '../components/IconButton';
import EmbeddablePageHeader from '../components/EmbeddablePageHeader';
import Button from '../components/Button';
import ExpandCollapseControls from '../components/ExpandCollapseControls';
import Card from '../components/Card';
import { SkeletonRows } from '../components/Skeleton';
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
  const [manuals, setManuals] = useState<OperationsManual[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addInputs, setAddInputs] = useState<Record<string, string>>({});
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [headerForm, setHeaderForm] = useState({ label: '', purpose: '', roleType: CUSTOM_ROLE });
  const [showAddManual, setShowAddManual] = useState(false);
  const [newManualLabel, setNewManualLabel] = useState('');
  const [newManualRole, setNewManualRole] = useState<string>(CUSTOM_ROLE);
  // roleType → names of the people/agents currently holding that DAMA role in
  // this org, so a manual can show who actually operates it.
  const [roleHolders, setRoleHolders] = useState<Record<string, string[]>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const fetchManuals = useCallback(async () => {
    if (!activeOrgId) { setManuals([]); setRoleHolders({}); setLoading(false); return; }
    try {
      // Manuals plus the org's DAMA role assignments, so each manual can show
      // who currently holds the role it documents.
      const [manualsRes, rolesRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: OperationsManual[] }>(`/operations-manuals?orgId=${activeOrgId}`),
        apiClient.get<{ success: boolean; data: RoleAssignment[] }>(`/dama-roles?orgId=${activeOrgId}`).catch(() => ({ data: [] as RoleAssignment[] })),
      ]);
      setManuals(manualsRes.data || []);
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

  const addItem = (manualId: string, section: SectionKey) => {
    const inputKey = `${manualId}-${section}`;
    const text = (addInputs[inputKey] || '').trim();
    const manual = manuals.find((m) => m.id === manualId);
    if (!text || !manual) return;
    updateManual(manual.id, { [section]: [...manual[section], text] });
    setAddInputs((p) => ({ ...p, [inputKey]: '' }));
  };
  const removeItem = (manualId: string, section: SectionKey, idx: number) => {
    const manual = manuals.find((m) => m.id === manualId);
    if (!manual) return;
    updateManual(manual.id, { [section]: manual[section].filter((_, i) => i !== idx) });
  };

  const startEditHeader = (m: OperationsManual) => {
    setHeaderForm({ label: m.label, purpose: m.purpose, roleType: m.roleType || CUSTOM_ROLE });
    setEditingHeader(m.id);
    // The header-edit form lives inside the expanded card body, so a collapsed
    // card must expand for the editor to be visible (otherwise Edit header
    // silently does nothing).
    setExpandedCards((prev) => new Set(prev).add(m.id));
  };
  const saveHeader = async (id: string) => {
    if (!headerForm.label.trim()) return;
    await updateManual(id, { label: headerForm.label, purpose: headerForm.purpose, roleType: headerForm.roleType });
    setEditingHeader(null); addToast('success', 'Manual updated');
  };
  const saveCustomContent = (id: string, value: string) => { updateManual(id, { customContent: value }); };

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
  const toggleSection = (manualId: string, key: SectionKey) => {
    const compositeKey = `${manualId}-${key}`;
    setExpandedSections((prev) => { const n = new Set(prev); if (n.has(compositeKey)) n.delete(compositeKey); else n.add(compositeKey); return n; });
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

  // ── Render ──
  if (loading) return <SkeletonRows rows={5} />;
  if (!activeOrgId) return (
    <EmptyState icon={renderNavIcon('/organizations')} title="No organization selected" description="Select an organization from the header to view operations manuals." />
  );

  const seedLabel = seeding ? 'Generating…' : 'Generate Standard Manuals';

  return (
    <div>
      <EmbeddablePageHeader
        embedded={embedded}
        actionsPortal={actionsPortal}
        title="Operations Manual"
        subtitle="Role-specific guidance for running your governance program."
        actions={<>
          <Button variant="secondary" onClick={handleSeed} disabled={seeding}>{seedLabel}</Button>
          {canWrite && <Button variant="primary" onClick={() => setShowAddManual(true)}>+ Add Manual</Button>}
        </>}
      />

      {manuals.length === 0 ? (
        <>
          <EmptyState icon={renderNavIcon('/documentation')} title="No operations manuals yet" description="Generate the standard DAMA role manuals, or create a custom one."
            action={{ label: seedLabel, onClick: handleSeed }}
            secondaryAction={canWrite ? { label: '+ Add Manual', onClick: () => setShowAddManual(true) } : undefined} />
          {showAddManual && renderAddManualDialog()}
        </>
      ) : (
        <>
          {/* Bulk controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            {canWrite && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedIds.size === manuals.length && manuals.length > 0} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} /> Select all
              </label>
            )}
            <ExpandCollapseControls
              onExpandAll={() => setExpandedCards(new Set(manuals.map((m) => m.id)))}
              onCollapseAll={() => setExpandedCards(new Set())}
            />
          </div>

          <BulkActionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
            <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete Selected</BulkActionButton>
          </BulkActionBar>

          {/* 2-column card grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {manuals.map((m) => {
              const isExpanded = expandedCards.has(m.id);
              const isSelected = selectedIds.has(m.id);
              return (
                <Card key={m.id} padding={0} style={{
                  gridColumn: isExpanded ? '1 / -1' : undefined,
                  border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}>
                  {/* Card header */}
                  <div
                    {...clickable(() => toggleCard(m.id), { label: `Toggle manual ${m.label}` })}
                    aria-expanded={isExpanded}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
                      cursor: 'pointer', userSelect: 'none',
                      borderBottom: isExpanded ? '1px solid var(--color-border)' : 'none',
                    }}
                  >
                    {canWrite && (
                      <input type="checkbox" checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => { const n = new Set(selectedIds); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); setSelectedIds(n); }}
                        style={{ cursor: 'pointer', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{isExpanded ? '▼' : '▶'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                        {m.roleType && m.roleType !== CUSTOM_ROLE && (
                          <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap', flexShrink: 0 }}>{roleLabel(m.roleType)}</span>
                        )}
                        {m.isCustom && <span style={{ fontSize: 9, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase' }}>Custom</span>}
                      </div>
                      {!isExpanded && m.purpose && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.purpose}
                        </div>
                      )}
                    </div>
                    {/* Section dot indicators */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      {SECTIONS.map((s) => (
                        <div key={s.key} title={`${s.name}: ${m[s.key].length} items`} style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: m[s.key].length > 0 ? s.accentColor : 'var(--color-border)',
                          opacity: m[s.key].length > 0 ? 1 : 0.4,
                        }} />
                      ))}
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 4 }}>
                        {totalItems(m)} items
                      </span>
                    </div>
                    {canWrite && (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <IconButton size="sm" icon="edit" label="Edit header" onClick={() => startEditHeader(m)} />
                        <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDeleteId(m.id)} />
                      </div>
                    )}
                  </div>

                  {/* Expanded card body */}
                  {isExpanded && (
                    <div style={{ padding: 16 }}>
                      {/* Header editing */}
                      {editingHeader === m.id ? (
                        <div style={{ marginBottom: 16 }}>
                          <input aria-label="Label" style={{ ...inputStyle, marginBottom: 8, fontWeight: 600, fontSize: 16 }} value={headerForm.label} onChange={(e) => setHeaderForm((f) => ({ ...f, label: e.target.value }))} placeholder="Label" />
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>Role this manual is for</label>
                          <select aria-label="Role" style={{ ...inputStyle, marginBottom: 8 }} value={headerForm.roleType} onChange={(e) => setHeaderForm((f) => ({ ...f, roleType: e.target.value }))}>{roleOptions}</select>
                          <textarea aria-label="Purpose" style={{ ...inputStyle, minHeight: 80 }} value={headerForm.purpose} onChange={(e) => setHeaderForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="Purpose" />
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <Button variant="primary" onClick={() => saveHeader(m.id)}>Save</Button>
                            <Button variant="secondary" onClick={() => setEditingHeader(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Role & who holds it — the manual↔role link, made visible. */}
                          {m.roleType && m.roleType !== CUSTOM_ROLE && (() => {
                            const holders = roleHolders[m.roleType] || [];
                            const shown = holders.slice(0, 3).join(', ');
                            const extra = holders.length > 3 ? ` +${holders.length - 3}` : '';
                            return (
                              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: m.purpose ? 8 : 16 }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>Role: </span>
                                <span style={{ fontWeight: 600 }}>{roleLabel(m.roleType)}</span>
                                {' · '}
                                {holders.length > 0
                                  ? <span>Held by {shown}{extra}</span>
                                  : <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>not assigned to anyone yet — assign on the Roles page</span>}
                              </div>
                            );
                          })()}
                          {m.purpose && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, fontStyle: 'italic', lineHeight: 1.5 }}>{m.purpose}</p>}
                        </>
                      )}

                      {/* Sections in 2-column grid when card is expanded */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        {SECTIONS.map((s) => {
                          const items = m[s.key];
                          const sectionKey = `${m.id}-${s.key}`;
                          const expanded = expandedSections.has(sectionKey);
                          return (
                            <div key={s.key} style={{ borderLeft: `3px solid ${s.accentColor}`, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                              <div {...clickable(() => toggleSection(m.id, s.key), { label: `Toggle ${s.name} section` })} aria-expanded={expanded} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
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
                                            {canWrite && <button onClick={() => removeItem(m.id, s.key, idx)} title="Remove"
                                              style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, fontWeight: 700, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>x</button>}
                                          </li>
                                        ))}
                                      </ul>}
                                  {canWrite && (
                                    <div style={{ display: 'flex', gap: 4 }}>
                                      <input aria-label={`Add ${s.name} item`} style={{ ...inputStyle, flex: 1, fontSize: 12, padding: '4px 8px' }} value={addInputs[sectionKey] || ''} onChange={(e) => setAddInputs((p) => ({ ...p, [sectionKey]: e.target.value }))}
                                        placeholder="Add item..." onKeyDown={(e) => e.key === 'Enter' && addItem(m.id, s.key)} />
                                      <Button variant="primary" size="sm"
                                        onClick={() => addItem(m.id, s.key)} disabled={!(addInputs[sectionKey] || '').trim()}>Add</Button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Custom Content */}
                      <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                        <h4 style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px' }}>Custom Content</h4>
                        <textarea aria-label="Custom Content" style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit', lineHeight: 1.6, fontSize: 12 }} value={m.customContent}
                          onChange={(e) => { const v = e.target.value; setManuals((prev) => prev.map((x) => x.id === m.id ? { ...x, customContent: v } : x)); }}
                          onBlur={(e) => saveCustomContent(m.id, e.target.value)} placeholder="Paste or type additional content here..." readOnly={!canWrite} />
                      </div>

                      {/* Linked documents — point this manual at the real doc
                          wherever it lives (SharePoint, a web page, a file
                          server) or upload a copy. */}
                      <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                        <h4 style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px' }}>Linked documents</h4>
                        <AttachmentsPanel entityType="OperationsManual" entityId={m.id} orgId={activeOrgId ?? undefined} disabled={!canWrite} hideHeader />
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <ConfirmDialog open={!!confirmDeleteId} title="Delete Manual" message="Are you sure you want to delete this operations manual? This cannot be undone."
            confirmLabel="Delete" variant="danger" onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)} onCancel={() => setConfirmDeleteId(null)} />
          <ConfirmDialog open={confirmBulkDelete} title="Delete Selected Manuals"
            message={`This will permanently delete ${selectedIds.size} manual${selectedIds.size === 1 ? '' : 's'}. This cannot be undone.`}
            confirmLabel="Delete" variant="danger" onConfirm={handleBulkDelete} onCancel={() => setConfirmBulkDelete(false)} />
          {showAddManual && renderAddManualDialog()}
        </>
      )}
    </div>
  );
}
