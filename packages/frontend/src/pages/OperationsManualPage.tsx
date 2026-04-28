import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { usePermissions } from '../hooks/usePermissions';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import IconButton from '../components/IconButton';
import { SkeletonRows } from '../components/Skeleton';
import PageTabNav, { OPERATE_TABS } from '../components/PageTabNav';

// ── Types ──
interface OperationsManual {
  id: string; orgId: string; roleType: string; label: string; purpose: string;
  daily: string[]; weekly: string[]; monthly: string[]; quarterly: string[];
  escalation: string[]; customContent: string; isCustom: boolean;
  createdAt: string; updatedAt: string;
}

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
const btnPrimary: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 500, background: 'var(--color-primary)',
  color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 500, background: 'var(--color-surface)',
  color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnDanger: React.CSSProperties = { ...btnSecondary, color: '#dc2626', borderColor: '#fca5a5' };
const card: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)',
};

export default function OperationsManualPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const { canWrite } = usePermissions();
  const [manuals, setManuals] = useState<OperationsManual[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addInputs, setAddInputs] = useState<Record<string, string>>({});
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [headerForm, setHeaderForm] = useState({ label: '', purpose: '' });
  const [showAddManual, setShowAddManual] = useState(false);
  const [newManualLabel, setNewManualLabel] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const fetchManuals = useCallback(async () => {
    if (!activeOrgId) { setManuals([]); setLoading(false); return; }
    try {
      const res = await apiClient.get<{ success: boolean; data: OperationsManual[] }>(`/operations-manuals?orgId=${activeOrgId}`);
      setManuals(res.data || []);
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

  const startEditHeader = (m: OperationsManual) => { setHeaderForm({ label: m.label, purpose: m.purpose }); setEditingHeader(m.id); };
  const saveHeader = async (id: string) => {
    if (!headerForm.label.trim()) return;
    await updateManual(id, { label: headerForm.label, purpose: headerForm.purpose });
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
  const handleDeleteAll = async () => {
    const count = manuals.length;
    await Promise.all(manuals.map((m) => apiClient.delete(`/operations-manuals/${m.id}`)));
    setSelectedIds(new Set()); setShowDeleteAll(false);
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
      await apiClient.post('/operations-manuals', { orgId: activeOrgId, label: newManualLabel.trim(), roleType: 'CUSTOM', isCustom: true });
      addToast('success', 'Manual created'); setNewManualLabel(''); setShowAddManual(false); await fetchManuals();
    } catch { addToast('error', 'Failed to create manual'); }
  };

  function renderAddManualDialog() {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowAddManual(false)}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }} onClick={(e) => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>New Manual</h3>
          <input style={inputStyle} value={newManualLabel} onChange={(e) => setNewManualLabel(e.target.value)} placeholder="Manual name" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAddManual()} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSecondary} onClick={() => { setShowAddManual(false); setNewManualLabel(''); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !newManualLabel.trim() ? 0.6 : 1, cursor: !newManualLabel.trim() ? 'not-allowed' : 'pointer' }} onClick={handleAddManual} disabled={!newManualLabel.trim()}>Create</button>
          </div>
        </div>
      </div>
    );
  }

  // Total items across all sections for a manual
  const totalItems = (m: OperationsManual) => SECTIONS.reduce((sum, s) => sum + m[s.key].length, 0);

  // ── Render ──
  if (loading) return <div><PageTabNav tabs={OPERATE_TABS} /><SkeletonRows rows={5} /></div>;
  if (!activeOrgId) return (
    <div><PageTabNav tabs={OPERATE_TABS} />
      <EmptyState title="No organization selected" description="Select an organization from the header to view operations manuals." />
    </div>
  );

  const seedLabel = seeding ? 'Generating...' : 'Generate Standard Manuals';

  return (
    <div>
      <PageTabNav tabs={OPERATE_TABS} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Operations Manual</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>Role-specific guidance for running your governance program.</p>
          {manuals.length > 0 && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              {manuals.length} manual{manuals.length === 1 ? '' : 's'} &middot; Click a card to expand
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {manuals.length > 0 && canWrite && <IconButton icon="trash" label="Delete all manuals" variant="danger" onClick={() => setShowDeleteAll(true)} />}
          <button style={btnSecondary} onClick={handleSeed} disabled={seeding}>{seedLabel}</button>
          {canWrite && <button style={btnPrimary} onClick={() => setShowAddManual(true)}>+ Add Manual</button>}
        </div>
      </div>

      {manuals.length === 0 ? (
        <>
          <EmptyState title="No operations manuals yet" description="Generate the standard DAMA role manuals to get started, or create a custom manual."
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
            <button style={{ ...btnSecondary, padding: '4px 12px', fontSize: 11 }} onClick={() => setExpandedCards(new Set(manuals.map((m) => m.id)))}>Expand All</button>
            <button style={{ ...btnSecondary, padding: '4px 12px', fontSize: 11 }} onClick={() => setExpandedCards(new Set())}>Collapse All</button>
          </div>

          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
              <button style={{ ...btnDanger, fontSize: 12, padding: '4px 12px' }} onClick={() => setConfirmBulkDelete(true)}>Delete Selected</button>
              <button style={{ ...btnSecondary, fontSize: 12, padding: '4px 12px' }} onClick={() => setSelectedIds(new Set())}>Clear Selection</button>
            </div>
          )}

          {/* 2-column card grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {manuals.map((m) => {
              const isExpanded = expandedCards.has(m.id);
              const isSelected = selectedIds.has(m.id);
              return (
                <div key={m.id} style={{
                  ...card,
                  gridColumn: isExpanded ? '1 / -1' : undefined,
                  border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}>
                  {/* Card header */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
                      cursor: 'pointer', userSelect: 'none',
                      borderBottom: isExpanded ? '1px solid var(--color-border)' : 'none',
                    }}
                    onClick={() => toggleCard(m.id)}
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
                          <input style={{ ...inputStyle, marginBottom: 8, fontWeight: 600, fontSize: 16 }} value={headerForm.label} onChange={(e) => setHeaderForm((f) => ({ ...f, label: e.target.value }))} placeholder="Label" />
                          <textarea style={{ ...inputStyle, minHeight: 80 }} value={headerForm.purpose} onChange={(e) => setHeaderForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="Purpose" />
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button style={btnPrimary} onClick={() => saveHeader(m.id)}>Save</button>
                            <button style={btnSecondary} onClick={() => setEditingHeader(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : m.purpose ? (
                        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, fontStyle: 'italic', lineHeight: 1.5 }}>{m.purpose}</p>
                      ) : null}

                      {/* Sections in 2-column grid when card is expanded */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        {SECTIONS.map((s) => {
                          const items = m[s.key];
                          const sectionKey = `${m.id}-${s.key}`;
                          const expanded = expandedSections.has(sectionKey);
                          return (
                            <div key={s.key} style={{ borderLeft: `3px solid ${s.accentColor}`, padding: '10px 12px', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                              <div onClick={() => toggleSection(m.id, s.key)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
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
                                      <input style={{ ...inputStyle, flex: 1, fontSize: 12, padding: '4px 8px' }} value={addInputs[sectionKey] || ''} onChange={(e) => setAddInputs((p) => ({ ...p, [sectionKey]: e.target.value }))}
                                        placeholder="Add item..." onKeyDown={(e) => e.key === 'Enter' && addItem(m.id, s.key)} />
                                      <button style={{ ...btnPrimary, padding: '4px 10px', fontSize: 11, opacity: !(addInputs[sectionKey] || '').trim() ? 0.6 : 1, cursor: !(addInputs[sectionKey] || '').trim() ? 'not-allowed' : 'pointer' }}
                                        onClick={() => addItem(m.id, s.key)} disabled={!(addInputs[sectionKey] || '').trim()}>Add</button>
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
                        <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit', lineHeight: 1.6, fontSize: 12 }} value={m.customContent}
                          onChange={(e) => { const v = e.target.value; setManuals((prev) => prev.map((x) => x.id === m.id ? { ...x, customContent: v } : x)); }}
                          onBlur={(e) => saveCustomContent(m.id, e.target.value)} placeholder="Paste or type additional content here..." readOnly={!canWrite} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <ConfirmDialog open={!!confirmDeleteId} title="Delete Manual" message="Are you sure you want to delete this operations manual? This cannot be undone."
            confirmLabel="Delete" variant="danger" onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)} onCancel={() => setConfirmDeleteId(null)} />
          <ConfirmDialog open={confirmBulkDelete} title="Delete Selected Manuals"
            message={`This will permanently delete ${selectedIds.size} manual${selectedIds.size === 1 ? '' : 's'}. This cannot be undone.`}
            confirmLabel="Delete" variant="danger" onConfirm={handleBulkDelete} onCancel={() => setConfirmBulkDelete(false)} />
          <ConfirmDialog open={showDeleteAll} title="Delete All Manuals?"
            message={`This will permanently delete all ${manuals.length} manual${manuals.length === 1 ? '' : 's'}. This cannot be undone.`}
            confirmLabel="Delete All" variant="danger" onConfirm={handleDeleteAll} onCancel={() => setShowDeleteAll(false)} />
          {showAddManual && renderAddManualDialog()}
        </>
      )}
    </div>
  );
}
