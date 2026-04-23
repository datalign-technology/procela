import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { SkeletonRows } from '../components/Skeleton';
import PageTabNav, { GOVERNANCE_TABS } from '../components/PageTabNav';

// ── Types ──

interface Policy {
  id: string; orgId: string; code: string; name: string; description: string;
  status: string; ownerAssignmentId: string | null; ownerName: string | null;
  category: string; reviewFrequency: string; nextReviewDate: string | null;
  content: string; createdAt: string; updatedAt: string;
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
}

interface ControlForm {
  name: string; description: string; controlType: string;
  automationMode: string; evidenceRequired: boolean;
}

const emptyPolicyForm: PolicyForm = {
  name: '', description: '', category: 'GENERAL', status: 'DRAFT',
  ownerAssignmentId: '', reviewFrequency: 'ANNUAL', content: '',
};

const emptyControlForm: ControlForm = {
  name: '', description: '', controlType: 'DETECTIVE',
  automationMode: 'HUMAN', evidenceRequired: false,
};

const CATEGORIES = ['DATA_QUALITY', 'SECURITY', 'PRIVACY', 'RETENTION', 'ACCESS', 'CLASSIFICATION', 'GOVERNANCE', 'GENERAL'] as const;
const STATUSES = ['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'DEPRECATED'] as const;
const REVIEW_FREQUENCIES = ['QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'BIENNIAL', 'NONE'] as const;
const CONTROL_TYPES = ['PREVENTIVE', 'DETECTIVE', 'CORRECTIVE'] as const;
const AUTOMATION_MODES = ['HUMAN', 'AGENT', 'HYBRID'] as const;

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

// ── Component ──

export default function GovernancePoliciesPage() {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const { addToast } = useToastStore();

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyPolicyForm);
  const [expandedPolicyId, setExpandedPolicyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Control form state
  const [showControlForm, setShowControlForm] = useState(false);
  const [editingControlId, setEditingControlId] = useState<string | null>(null);
  const [controlForm, setControlForm] = useState<ControlForm>(emptyControlForm);
  const [confirmDeleteControl, setConfirmDeleteControl] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [polRes, ctlRes, pplRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Policy[] }>(`/governance-policies${query}`),
        apiClient.get<{ success: boolean; data: Control[] }>(`/governance-controls${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
      ]);
      setPolicies(polRes.data || []);
      setControls(ctlRes.data || []);
      setPeople(pplRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Policy CRUD ──

  const openAdd = () => { setForm(emptyPolicyForm); setEditingId(null); setShowForm(true); };
  const openEdit = (p: Policy) => {
    setForm({ name: p.name, description: p.description, category: p.category, status: p.status,
      ownerAssignmentId: p.ownerAssignmentId || '', reviewFrequency: p.reviewFrequency, content: p.content });
    setEditingId(p.id); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyPolicyForm); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = { ...form, ownerAssignmentId: form.ownerAssignmentId || null,
        ...(activeOrgId ? { orgId: activeOrgId } : {}) };
      if (editingId) {
        await apiClient.put(`/governance-policies/${editingId}`, payload);
        addToast('success', 'Policy updated');
      } else {
        await apiClient.post('/governance-policies', payload);
        addToast('success', 'Policy created');
      }
      closeForm(); fetchData();
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Failed to save policy');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/governance-policies/${id}`);
      addToast('success', 'Policy deleted');
      if (expandedPolicyId === id) setExpandedPolicyId(null);
      fetchData();
    } catch (err: any) { addToast('error', err?.response?.data?.error || 'Failed to delete policy'); }
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
    } catch (err: any) {
      addToast('error', err?.response?.data?.error || 'Failed to save control');
    }
  };

  const handleDeleteControl = async (id: string) => {
    try {
      await apiClient.delete(`/governance-controls/${id}`);
      addToast('success', 'Control deleted'); fetchData();
    } catch (err: any) { addToast('error', err?.response?.data?.error || 'Failed to delete control'); }
  };

  const controlsForPolicy = (policyId: string) => controls.filter((c) => c.policyId === policyId);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString() : '--';

  return (
    <div>
      <PageTabNav tabs={GOVERNANCE_TABS} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Policies &amp; Controls</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Define governance policies and the controls that enforce them.
          </p>
        </div>
        {canWrite && <IconButton icon="plus" label="Add policy" variant="primary" onClick={openAdd} />}
      </div>

      <ConfirmDialog open={confirmDelete !== null} title="Delete Policy?"
        message="This will permanently delete this policy and orphan its controls." confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)} />

      <ConfirmDialog open={confirmDeleteControl !== null} title="Delete Control?"
        message="This will permanently delete this control." confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDeleteControl; setConfirmDeleteControl(null); if (id) await handleDeleteControl(id); }}
        onCancel={() => setConfirmDeleteControl(null)} />

      {/* Add/Edit Policy Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Policy' : 'Add New Policy'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Data Classification Policy" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Description</label>
              <textarea style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={selectStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Owner</label>
              <select style={selectStyle} value={form.ownerAssignmentId} onChange={(e) => setForm({ ...form, ownerAssignmentId: e.target.value })}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Review Frequency</label>
              <select style={selectStyle} value={form.reviewFrequency} onChange={(e) => setForm({ ...form, reviewFrequency: e.target.value })}>
                {REVIEW_FREQUENCIES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Content</label>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Full policy text..." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={closeForm}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }} disabled={!form.name.trim()} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Policy'}
            </button>
          </div>
        </div>
      )}

      {/* Policies Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <SkeletonRows rows={5} columns={8} />
        ) : policies.length === 0 && !showForm ? (
          <EmptyState icon={'📋'} title="No governance policies yet"
            description="Policies define the rules and standards for data governance. Create your first policy to get started."
            action={canWrite ? { label: '+ Add Policy', onClick: openAdd } : undefined} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Owner</th>
                <th style={thStyle}>Review Due</th>
                <th style={thStyle}>Controls</th>
                <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((pol) => {
                const policyControls = controlsForPolicy(pol.id);
                const isExpanded = expandedPolicyId === pol.id;
                return (
                  <tr key={pol.id} style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = ''; }}
                    onClick={() => { setExpandedPolicyId(isExpanded ? null : pol.id); closeControlForm(); }}>
                    <td style={{ ...tdStyle, fontWeight: 500, fontFamily: 'monospace', fontSize: 12 }}>{pol.code}</td>
                    <td style={{ ...tdStyle, fontWeight: 500, color: 'var(--color-primary)' }}>{pol.name}</td>
                    <td style={tdStyle}><span style={badgeStyle(CATEGORY_COLORS[pol.category] || CATEGORY_COLORS.GENERAL)}>{pol.category.replace(/_/g, ' ')}</span></td>
                    <td style={tdStyle}><span style={badgeStyle(STATUS_COLORS[pol.status] || STATUS_COLORS.DRAFT)}>{pol.status.replace(/_/g, ' ')}</span></td>
                    <td style={tdStyle}>{pol.ownerName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>}</td>
                    <td style={tdStyle}>{formatDate(pol.nextReviewDate)}</td>
                    <td style={tdStyle}><span style={{ fontSize: 12, fontWeight: 600 }}>{policyControls.length}</span></td>
                    <td style={{ ...tdStyle, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {canWrite && <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(pol)} />}
                        {canWrite && <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(pol.id)} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Expanded Controls Section */}
      {expandedPolicyId && (
        <div style={{ marginTop: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>
              Controls for {policies.find((p) => p.id === expandedPolicyId)?.name || 'Policy'}
            </h3>
            {canWrite && <button style={{ ...btnPrimary, padding: '6px 12px', fontSize: 12 }} onClick={openAddControl}>+ Add Control</button>}
          </div>

          {/* Control Add/Edit Form */}
          {showControlForm && (
            <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{editingControlId ? 'Edit Control' : 'Add Control'}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Name *</label>
                  <input autoFocus style={inputStyle} value={controlForm.name} onChange={(e) => setControlForm({ ...controlForm, name: e.target.value })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Description</label>
                  <textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} value={controlForm.description} onChange={(e) => setControlForm({ ...controlForm, description: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Control Type</label>
                  <select style={selectStyle} value={controlForm.controlType} onChange={(e) => setControlForm({ ...controlForm, controlType: e.target.value })}>
                    {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Automation Mode</label>
                  <select style={selectStyle} value={controlForm.automationMode} onChange={(e) => setControlForm({ ...controlForm, automationMode: e.target.value })}>
                    {AUTOMATION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                  <input type="checkbox" checked={controlForm.evidenceRequired} onChange={(e) => setControlForm({ ...controlForm, evidenceRequired: e.target.checked })} />
                  <label style={{ fontSize: 12, fontWeight: 500 }}>Evidence Required</label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button style={{ ...btnSecondary, padding: '6px 12px', fontSize: 12 }} onClick={closeControlForm}>Cancel</button>
                <button style={{ ...btnPrimary, padding: '6px 12px', fontSize: 12, opacity: !controlForm.name.trim() ? 0.6 : 1 }}
                  disabled={!controlForm.name.trim()} onClick={handleSaveControl}>
                  {editingControlId ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          )}

          {/* Controls Table */}
          {controlsForPolicy(expandedPolicyId).length === 0 && !showControlForm ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>No controls defined for this policy.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Mode</th>
                  <th style={thStyle}>Evidence</th>
                  <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {controlsForPolicy(expandedPolicyId).map((ctl) => (
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
          )}
        </div>
      )}
    </div>
  );
}
