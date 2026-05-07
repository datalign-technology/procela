import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';

// ── Types ──

interface SopStep {
  order: number;
  title: string;
  description: string;
  estimatedMinutes: number;
}

interface Sop {
  id: string;
  orgId: string;
  code: string;
  title: string;
  purpose: string;
  category: string;
  applicableRoles: string[];
  triggerEvent: string;
  steps: SopStep[];
  status: string;
  version: number;
  ownerPersonId: string | null;
  ownerName: string | null;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Person { id: string; name: string; }

interface SopForm {
  title: string;
  purpose: string;
  category: string;
  applicableRoles: string[];
  triggerEvent: string;
  steps: SopStep[];
  status: string;
  ownerPersonId: string;
}

const emptyForm: SopForm = {
  title: '', purpose: '', category: 'OTHER', applicableRoles: [], triggerEvent: '',
  steps: [{ order: 1, title: '', description: '', estimatedMinutes: 15 }],
  status: 'DRAFT', ownerPersonId: '',
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
};

const CATEGORIES = ['ONBOARDING', 'QUALITY', 'INCIDENT', 'ACCESS', 'REQUEST', 'REVIEW', 'ESCALATION', 'OTHER'];
const CATEGORY_LABELS: Record<string, string> = {
  ONBOARDING: 'Onboarding', QUALITY: 'Quality', INCIDENT: 'Incident', ACCESS: 'Access',
  REQUEST: 'Request', REVIEW: 'Review', ESCALATION: 'Escalation', OTHER: 'Other',
};
const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  ONBOARDING: { bg: '#dbeafe', color: '#1e40af' },
  QUALITY: { bg: '#d1f0eb', color: '#0f4f46' },
  INCIDENT: { bg: '#fce7f3', color: '#9d174d' },
  ACCESS: { bg: '#ede9fe', color: '#5b21b6' },
  REQUEST: { bg: '#e0e7ff', color: '#3730a3' },
  REVIEW: { bg: '#fef3c7', color: '#92400e' },
  ESCALATION: { bg: '#fee2e2', color: '#991b1b' },
  OTHER: { bg: '#f1f5f9', color: '#64748b' },
};

const STATUSES = ['DRAFT', 'ACTIVE', 'DEPRECATED'];
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DRAFT: { bg: '#f1f5f9', color: '#64748b' },
  ACTIVE: { bg: '#d1f0eb', color: '#0f4f46' },
  DEPRECATED: { bg: '#fee2e2', color: '#991b1b' },
};

import { DAMA_ROLE_LABELS } from '../types';
import { formatPersonLabel } from '../lib/personLabel';
import { useRefreshOnFocus } from '../hooks/usePolling';

const DAMA_ROLES = Object.keys(DAMA_ROLE_LABELS);
const ROLE_LABELS = DAMA_ROLE_LABELS;

const badge = (colors: { bg: string; color: string }): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em',
  background: colors.bg, color: colors.color,
});

export default function SopsPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();
  const [sops, setSops] = useState<Sop[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SopForm>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [sopsRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Sop[] }>(`/sops${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setSops(sopsRes.data || []);
      setPeople(peopleRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useRefreshOnFocus(fetchData);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (sop: Sop) => {
    setForm({
      title: sop.title,
      purpose: sop.purpose,
      category: sop.category,
      applicableRoles: sop.applicableRoles || [],
      triggerEvent: sop.triggerEvent,
      steps: sop.steps.length > 0 ? sop.steps : [{ order: 1, title: '', description: '', estimatedMinutes: 15 }],
      status: sop.status,
      ownerPersonId: sop.ownerPersonId || '',
    });
    setEditingId(sop.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    const payload = {
      ...form,
      orgId: activeOrgId,
      ownerPersonId: form.ownerPersonId || null,
      steps: form.steps.filter((s) => s.title.trim().length > 0).map((s, i) => ({ ...s, order: i + 1 })),
    };
    try {
      if (editingId) {
        await apiClient.put(`/sops/${editingId}`, payload);
        addToast('success', 'SOP updated');
      } else {
        await apiClient.post('/sops', payload);
        addToast('success', 'SOP created');
      }
      setShowForm(false); setEditingId(null); setForm(emptyForm);
      fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Failed to save SOP');
    }
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/sops/${id}`);
    addToast('success', 'SOP deleted');
    fetchData();
  };

  const handleSeed = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setSeeding(true);
    try {
      await apiClient.post(`/sops/seed`, { orgId: activeOrgId });
      addToast('success', 'Standard SOPs created');
      fetchData();
    } catch { addToast('error', 'Failed to seed SOPs'); }
    finally { setSeeding(false); }
  };

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      applicableRoles: f.applicableRoles.includes(role)
        ? f.applicableRoles.filter((r) => r !== role)
        : [...f.applicableRoles, role],
    }));
  };

  const addStep = () => {
    setForm((f) => ({
      ...f,
      steps: [...f.steps, { order: f.steps.length + 1, title: '', description: '', estimatedMinutes: 15 }],
    }));
  };

  const removeStep = (idx: number) => {
    setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== idx) }));
  };

  const updateStep = (idx: number, patch: Partial<SopStep>) => {
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setForm((f) => {
      const next = [...f.steps];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return f;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...f, steps: next.map((s, i) => ({ ...s, order: i + 1 })) };
    });
  };

  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    if (selectedIds.size === sops.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(sops.map((i) => i.id)));
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => apiClient.delete(`/sops/${id}`)));
    addToast('success', `Deleted ${ids.length} SOP${ids.length === 1 ? '' : 's'}`);
    setSelectedIds(new Set());
    fetchData();
  };

  const filtered = sops.filter((s) => {
    if (filterCategory && s.category !== filterCategory) return false;
    if (filterStatus && s.status !== filterStatus) return false;
    if (filterOwner && (s.ownerPersonId || '') !== filterOwner) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !s.title.toLowerCase().includes(q) &&
        !(s.code || '').toLowerCase().includes(q) &&
        !(s.purpose || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const activeCount = sops.filter((s) => s.status === 'ACTIVE').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Standard Operating Procedures</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Step-by-step procedures for common governance activities.
          </p>
          {sops.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <span>{sops.length} procedures</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{activeCount} active</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canWrite && <IconButton icon="plus" label="Add SOP" variant="primary" onClick={openAdd} />}
        </div>
      </div>

      {/* Filters (left-aligned, mirrors Data Assets) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search SOPs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px', fontSize: 12, background: 'var(--color-surface)', width: 200 }}
        />
        <select style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 130 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 140 }} value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)}>
          <option value="">All Owners</option>
          {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
        </select>
        {(filterCategory || filterStatus || filterOwner || searchQuery) && (
          <>
            <button
              onClick={() => { setFilterCategory(''); setFilterStatus(''); setFilterOwner(''); setSearchQuery(''); }}
              style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
            >
              Clear Filters
            </button>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Showing {filtered.length} of {sops.length}
            </span>
          </>
        )}
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{editingId ? 'Edit SOP' : 'Add New SOP'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Title *</label>
              <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Onboard a new data asset" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Category</label>
              <select style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Purpose</label>
              <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit' }} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="What this SOP achieves..." />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Trigger Event</label>
              <input style={inputStyle} value={form.triggerEvent} onChange={(e) => setForm({ ...form, triggerEvent: e.target.value })} placeholder="What triggers running this SOP..." />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Owner</label>
              <select style={selectStyle} value={form.ownerPersonId} onChange={(e) => setForm({ ...form, ownerPersonId: e.target.value })}>
                <option value="">-- No owner --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{formatPersonLabel(p)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Applicable Roles</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {DAMA_ROLES.map((r) => (
                  <label key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 4, background: form.applicableRoles.includes(r) ? 'var(--color-primary-light, #dbeafe)' : 'var(--color-surface)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.applicableRoles.includes(r)} onChange={() => toggleRole(r)} style={{ cursor: 'pointer' }} />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Steps editor */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Steps ({form.steps.length})</label>
              <button onClick={addStep} style={{ ...btnSecondary, fontSize: 11, padding: '4px 10px' }}>+ Add Step</button>
            </div>
            {form.steps.map((step, idx) => (
              <div key={idx} style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: 10, marginBottom: 6, background: 'var(--color-bg)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4 }}>
                    <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 10, color: idx === 0 ? 'var(--color-border)' : 'var(--color-text-muted)' }}>▲</button>
                    <span style={{ fontSize: 11, fontWeight: 700, textAlign: 'center' }}>{idx + 1}</span>
                    <button onClick={() => moveStep(idx, 1)} disabled={idx === form.steps.length - 1} style={{ background: 'none', border: 'none', cursor: idx === form.steps.length - 1 ? 'default' : 'pointer', fontSize: 10, color: idx === form.steps.length - 1 ? 'var(--color-border)' : 'var(--color-text-muted)' }}>▼</button>
                  </div>
                  <div style={{ flex: 1 }}>
                    <input style={{ ...inputStyle, marginBottom: 4 }} value={step.title} onChange={(e) => updateStep(idx, { title: e.target.value })} placeholder="Step title" />
                    <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'inherit', marginBottom: 4 }} value={step.description} onChange={(e) => updateStep(idx, { description: e.target.value })} placeholder="What to do in this step" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    </div>
                  </div>
                  <button onClick={() => removeStep(idx)} disabled={form.steps.length <= 1} style={{ background: 'none', border: 'none', cursor: form.steps.length <= 1 ? 'default' : 'pointer', color: form.steps.length <= 1 ? 'var(--color-border)' : 'var(--color-error, #dc2626)', fontSize: 14, padding: 4 }}>×</button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.title.trim() ? 0.6 : 1, cursor: !form.title.trim() ? 'not-allowed' : 'pointer' }} disabled={!form.title.trim()} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Create SOP'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedIds.size} SOP${selectedIds.size === 1 ? '' : 's'}?`}
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

      {/* Table */}
      {loading ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <SkeletonRows rows={5} columns={5} />
        </div>
      ) : sops.length === 0 ? (
        <EmptyState
          icon="☑"
          title="No SOPs yet"
          description="Standard Operating Procedures document the step-by-step work your stewards do. Start with the 5 standard SOPs or create your own."
          action={{ label: seeding ? 'Seeding...' : 'Seed Standard SOPs', onClick: handleSeed }}
          secondaryAction={canWrite ? { label: '+ Create SOP', onClick: openAdd } : undefined}
        />
      ) : (
        <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 40, textAlign: 'center' }}>
                  <input type="checkbox" checked={sops.length > 0 && selectedIds.size === sops.length} onChange={toggleSelectAll} />
                </th>
                <th style={{ ...thStyle, width: 80 }}>Code</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Roles</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Steps</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Owner</th>
                <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sop) => {
                const isExpanded = expandedId === sop.id;
                return (
                  <>
                    <tr key={sop.id} onClick={() => setExpandedId(isExpanded ? null : sop.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...tdStyle, textAlign: 'center', width: 40 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(sop.id)} onChange={() => toggleSelect(sop.id)} />
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{sop.code}</td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginRight: 6 }}>{isExpanded ? '▼' : '▶'}</span>
                        {sop.title}
                      </td>
                      <td style={tdStyle}>
                        <span style={badge(CATEGORY_COLORS[sop.category] || CATEGORY_COLORS.OTHER)}>{CATEGORY_LABELS[sop.category] || sop.category}</span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {(sop.applicableRoles || []).slice(0, 3).map((r) => ROLE_LABELS[r] || r).join(', ')}
                        {sop.applicableRoles && sop.applicableRoles.length > 3 && ` +${sop.applicableRoles.length - 3}`}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{sop.steps?.length || 0}</td>
                      <td style={tdStyle}>
                        <span style={badge(STATUS_COLORS[sop.status] || STATUS_COLORS.DRAFT)}>{sop.status}</span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12 }}>{sop.ownerName || <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(sop)} />}
                          {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(sop.id)} />}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--color-bg)', padding: 16, borderTop: '1px solid var(--color-border)' }}>
                          <div style={{ maxWidth: 800 }}>
                            {sop.purpose && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Purpose</div>
                                <div style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--color-text-secondary)' }}>{sop.purpose}</div>
                              </div>
                            )}
                            {sop.triggerEvent && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Trigger</div>
                                <div style={{ fontSize: 13 }}>{sop.triggerEvent}</div>
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Steps</div>
                              {canWrite && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const newStep = { order: (sop.steps?.length || 0) + 1, title: 'New step', description: '', estimatedMinutes: 0 };
                                    const updatedSteps = [...(sop.steps || []), newStep];
                                    await apiClient.put(`/sops/${sop.id}`, { steps: updatedSteps });
                                    addToast('success', 'Step added');
                                    fetchData();
                                  }}
                                  style={{ ...btnSecondary, fontSize: 11, padding: '3px 10px' }}
                                >+ Add Step</button>
                              )}
                            </div>
                            <ol style={{ paddingLeft: 0, listStyle: 'none', margin: 0 }}>
                              {(sop.steps || []).map((step, stepIdx) => (
                                <li key={step.order} style={{ display: 'flex', gap: 12, padding: '10px 12px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 6 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{step.order}</div>
                                    {canWrite && (
                                      <>
                                        <button disabled={stepIdx === 0} onClick={async (e) => {
                                          e.stopPropagation();
                                          const steps = [...sop.steps];
                                          [steps[stepIdx - 1], steps[stepIdx]] = [steps[stepIdx], steps[stepIdx - 1]];
                                          await apiClient.put(`/sops/${sop.id}`, { steps: steps.map((s, i) => ({ ...s, order: i + 1 })) });
                                          fetchData();
                                        }} style={{ background: 'none', border: 'none', cursor: stepIdx === 0 ? 'default' : 'pointer', fontSize: 9, color: stepIdx === 0 ? 'var(--color-border)' : 'var(--color-text-muted)', padding: 0 }}>&#9650;</button>
                                        <button disabled={stepIdx === sop.steps.length - 1} onClick={async (e) => {
                                          e.stopPropagation();
                                          const steps = [...sop.steps];
                                          [steps[stepIdx], steps[stepIdx + 1]] = [steps[stepIdx + 1], steps[stepIdx]];
                                          await apiClient.put(`/sops/${sop.id}`, { steps: steps.map((s, i) => ({ ...s, order: i + 1 })) });
                                          fetchData();
                                        }} style={{ background: 'none', border: 'none', cursor: stepIdx === sop.steps.length - 1 ? 'default' : 'pointer', fontSize: 9, color: stepIdx === sop.steps.length - 1 ? 'var(--color-border)' : 'var(--color-text-muted)', padding: 0 }}>&#9660;</button>
                                      </>
                                    )}
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{step.title}</div>
                                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{step.description}</div>
                                  </div>
                                  {canWrite && (
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const updatedSteps = sop.steps.filter((_, i) => i !== stepIdx).map((s, i) => ({ ...s, order: i + 1 }));
                                        await apiClient.put(`/sops/${sop.id}`, { steps: updatedSteps });
                                        addToast('success', 'Step removed');
                                        fetchData();
                                      }}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error, #dc2626)', fontSize: 14, padding: 4, flexShrink: 0, alignSelf: 'flex-start' }}
                                      title="Remove step"
                                    >&times;</button>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete SOP?"
        message="This will permanently delete the procedure. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
