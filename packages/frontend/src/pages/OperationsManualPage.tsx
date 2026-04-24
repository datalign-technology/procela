import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import PageTabNav, { OPERATE_TABS } from '../components/PageTabNav';

// ── Types ──

interface OperationsManual {
  id: string;
  orgId: string;
  roleType: string;
  label: string;
  purpose: string;
  daily: string[];
  weekly: string[];
  monthly: string[];
  quarterly: string[];
  escalation: string[];
  customContent: string;
  isCustom: boolean;
  createdAt: string;
  updatedAt: string;
}

type SectionKey = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'escalation';

interface SectionDef {
  key: SectionKey;
  name: string;
  accentColor: string;
  description: string;
}

const SECTIONS: SectionDef[] = [
  { key: 'daily', name: 'Daily activities', accentColor: '#22c55e', description: 'Ongoing, every-day responsibilities' },
  { key: 'weekly', name: 'Weekly activities', accentColor: '#3b82f6', description: 'Recurring work to track momentum and unblock teams' },
  { key: 'monthly', name: 'Monthly activities', accentColor: '#8b5cf6', description: 'Reviews, reporting, and committee-level engagement' },
  { key: 'quarterly', name: 'Quarterly activities', accentColor: '#f59e0b', description: 'Strategic reviews and roadmap planning' },
  { key: 'escalation', name: 'Escalation paths', accentColor: '#dc2626', description: 'When to escalate and to whom' },
];

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13, border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
  color: 'var(--color-text)', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 500, background: 'var(--color-primary)',
  color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 500, background: 'var(--color-surface)',
  color: 'var(--color-text)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  ...btnSecondary, color: '#dc2626', borderColor: '#fca5a5',
};

export default function OperationsManualPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [manuals, setManuals] = useState<OperationsManual[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addInputs, setAddInputs] = useState<Record<string, string>>({});
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState({ label: '', purpose: '' });
  const [showAddManual, setShowAddManual] = useState(false);
  const [newManualLabel, setNewManualLabel] = useState('');

  const fetchManuals = useCallback(async () => {
    if (!activeOrgId) { setManuals([]); setLoading(false); return; }
    try {
      const res = await apiClient.get<{ success: boolean; data: OperationsManual[] }>(
        `/operations-manuals?orgId=${activeOrgId}`,
      );
      setManuals(res.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { setLoading(true); fetchManuals(); }, [fetchManuals]);

  // Auto-select first manual when list changes
  useEffect(() => {
    if (manuals.length > 0 && (!selectedId || !manuals.find((m) => m.id === selectedId))) {
      setSelectedId(manuals[0].id);
    } else if (manuals.length === 0) {
      setSelectedId(null);
    }
  }, [manuals, selectedId]);

  const manual = manuals.find((m) => m.id === selectedId) || null;

  // ── Seed ──
  const handleSeed = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization first.'); return; }
    setSeeding(true);
    try {
      await apiClient.post('/operations-manuals/seed', { orgId: activeOrgId });
      addToast('success', 'Standard manuals seeded');
      await fetchManuals();
    } catch { addToast('error', 'Failed to seed manuals'); }
    finally { setSeeding(false); }
  };

  // ── Add / Remove items ──
  const updateManual = async (id: string, patch: Partial<OperationsManual>) => {
    try {
      const res = await apiClient.put<{ success: boolean; data: OperationsManual }>(
        `/operations-manuals/${id}`, patch,
      );
      setManuals((prev) => prev.map((m) => m.id === id ? res.data : m));
    } catch { addToast('error', 'Failed to save changes'); }
  };

  const addItem = (section: SectionKey) => {
    const text = (addInputs[section] || '').trim();
    if (!text || !manual) return;
    const updated = [...manual[section], text];
    updateManual(manual.id, { [section]: updated });
    setAddInputs((p) => ({ ...p, [section]: '' }));
  };

  const removeItem = (section: SectionKey, idx: number) => {
    if (!manual) return;
    const updated = manual[section].filter((_, i) => i !== idx);
    updateManual(manual.id, { [section]: updated });
  };

  // ── Header edit ──
  const startEditHeader = () => {
    if (!manual) return;
    setHeaderForm({ label: manual.label, purpose: manual.purpose });
    setEditingHeader(true);
  };
  const saveHeader = async () => {
    if (!manual || !headerForm.label.trim()) return;
    await updateManual(manual.id, { label: headerForm.label, purpose: headerForm.purpose });
    setEditingHeader(false);
    addToast('success', 'Manual updated');
  };

  // ── Custom content ──
  const saveCustomContent = (value: string) => {
    if (!manual) return;
    updateManual(manual.id, { customContent: value });
  };

  // ── Delete ──
  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/operations-manuals/${id}`);
      addToast('success', 'Manual deleted');
      setConfirmDeleteId(null);
      await fetchManuals();
    } catch { addToast('error', 'Failed to delete manual'); }
  };

  // ── Add custom manual ──
  const handleAddManual = async () => {
    if (!activeOrgId || !newManualLabel.trim()) return;
    try {
      await apiClient.post('/operations-manuals', {
        orgId: activeOrgId, label: newManualLabel.trim(), roleType: 'CUSTOM', isCustom: true,
      });
      addToast('success', 'Manual created');
      setNewManualLabel('');
      setShowAddManual(false);
      await fetchManuals();
    } catch { addToast('error', 'Failed to create manual'); }
  };

  // ── Render ──
  if (loading) return <div><PageTabNav tabs={OPERATE_TABS} /><SkeletonRows rows={5} /></div>;

  if (!activeOrgId) return (
    <div>
      <PageTabNav tabs={OPERATE_TABS} />
      <EmptyState title="No organization selected" description="Select an organization from the header to view operations manuals." />
    </div>
  );

  if (manuals.length === 0) return (
    <div>
      <PageTabNav tabs={OPERATE_TABS} />
      <EmptyState
        title="No operations manuals yet"
        description="Seed the standard DAMA role manuals to get started, or create a custom manual."
        action={{ label: seeding ? 'Seeding...' : 'Seed Standard Manuals', onClick: handleSeed }}
        secondaryAction={{ label: '+ Add Manual', onClick: () => setShowAddManual(true) }}
      />
      {showAddManual && renderAddManualDialog()}
    </div>
  );

  function renderAddManualDialog() {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowAddManual(false)}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }} onClick={(e) => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>New Manual</h3>
          <input style={inputStyle} value={newManualLabel} onChange={(e) => setNewManualLabel(e.target.value)} placeholder="Manual name" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleAddManual()} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSecondary} onClick={() => { setShowAddManual(false); setNewManualLabel(''); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !newManualLabel.trim() ? 0.6 : 1 }} onClick={handleAddManual} disabled={!newManualLabel.trim()}>Create</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageTabNav tabs={OPERATE_TABS} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Operations Manual</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Role-specific guidance for running your governance program.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnSecondary} onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding...' : 'Seed Standard Manuals'}
          </button>
          <button style={btnPrimary} onClick={() => setShowAddManual(true)}>+ Add Manual</button>
        </div>
      </div>

      {/* Role selector tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {manuals.map((m) => {
          const isActive = m.id === selectedId;
          return (
            <button
              key={m.id}
              onClick={() => { setSelectedId(m.id); setEditingHeader(false); }}
              style={{
                padding: '8px 14px', fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
                color: isActive ? '#fff' : 'var(--color-text)',
                border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Selected role manual */}
      {manual && (
        <div>
          {/* Header card */}
          <div style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Role Manual{manual.isCustom ? ' (Custom)' : ''}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btnSecondary} onClick={startEditHeader}>Edit</button>
                <button style={btnDanger} onClick={() => setConfirmDeleteId(manual.id)}>Delete</button>
              </div>
            </div>
            {editingHeader ? (
              <div style={{ marginTop: 8 }}>
                <input style={{ ...inputStyle, marginBottom: 8, fontWeight: 600, fontSize: 16 }} value={headerForm.label} onChange={(e) => setHeaderForm((f) => ({ ...f, label: e.target.value }))} placeholder="Label" />
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={headerForm.purpose} onChange={(e) => setHeaderForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="Purpose" />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button style={btnPrimary} onClick={saveHeader}>Save</button>
                  <button style={btnSecondary} onClick={() => setEditingHeader(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{manual.label}</h2>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
                  {manual.purpose || 'No purpose defined.'}
                </p>
              </>
            )}
          </div>

          {/* Sections */}
          {SECTIONS.map((section) => {
            const items = manual[section.key];
            const inputKey = section.key;
            return (
              <div key={section.key} style={{
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderLeft: `4px solid ${section.accentColor}`, borderRadius: 'var(--radius-md)',
                padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: section.accentColor, flexShrink: 0 }} />
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{section.name}</h3>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10, marginLeft: 18 }}>
                  {section.description}
                </div>
                {items.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', marginLeft: 18, marginBottom: 8 }}>
                    No activities defined.
                  </div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 34, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                    {items.map((item, idx) => (
                      <li key={idx} style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ flex: 1 }}>{item}</span>
                        <button
                          onClick={() => removeItem(section.key, idx)}
                          title="Remove item"
                          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                        >
                          x
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ display: 'flex', gap: 6, marginLeft: 18 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={addInputs[inputKey] || ''}
                    onChange={(e) => setAddInputs((p) => ({ ...p, [inputKey]: e.target.value }))}
                    placeholder="Add item..."
                    onKeyDown={(e) => e.key === 'Enter' && addItem(section.key)}
                  />
                  <button
                    style={{ ...btnPrimary, opacity: !(addInputs[inputKey] || '').trim() ? 0.6 : 1 }}
                    onClick={() => addItem(section.key)}
                    disabled={!(addInputs[inputKey] || '').trim()}
                  >
                    Add
                  </button>
                </div>
              </div>
            );
          })}

          {/* Custom Content */}
          <div style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12, boxShadow: 'var(--shadow-sm)',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Custom Content</h3>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
              Free-form notes, pasted manual text, or any additional content for this role.
            </p>
            <textarea
              style={{ ...inputStyle, minHeight: 120, fontFamily: 'inherit', lineHeight: 1.6 }}
              value={manual.customContent}
              onChange={(e) => {
                const val = e.target.value;
                setManuals((prev) => prev.map((m) => m.id === manual.id ? { ...m, customContent: val } : m));
              }}
              onBlur={(e) => saveCustomContent(e.target.value)}
              placeholder="Paste or type additional content here..."
            />
          </div>
        </div>
      )}

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete Manual"
        message="Are you sure you want to delete this operations manual? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {showAddManual && renderAddManualDialog()}
    </div>
  );
}
