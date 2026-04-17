import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { exportCsv } from '../lib/exportCsv';
import { errorToast } from '../lib/errorToast';
import { getStatusColor } from '../lib/statusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import HelpPopover from '../components/HelpPopover';

interface DataDomain {
  id: string;
  orgId: string;
  name: string;
  description: string;
  ownerId: string | null;
  ownerName: string | null;
  stewardIds: string[];
  stewards: { id: string; name: string }[];
  dataAssetIds: string[];
  assets: { id: string; name: string }[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface DomainSummary {
  total: number;
  governed: number;
  ungoverned: number;
  totalAssetsInDomains: number;
}

interface Person {
  id: string;
  name: string;
}

interface DataAssetOption {
  id: string;
  name: string;
}

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

interface FormData {
  name: string;
  description: string;
  status: string;
  scopeDefinition: string;
}

const emptyForm: FormData = { name: '', description: '', status: 'DRAFT', scopeDefinition: '' };

const DOMAIN_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['PROPOSED'],
  PROPOSED:     ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED:     ['ACTIVE', 'DRAFT'],
  ACTIVE:       ['UNDER_REVIEW', 'DEPRECATED'],
  DEPRECATED:   ['DRAFT'],
};
const DOMAIN_LOCKED = new Set(['UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DEPRECATED']);

export default function DataDomainsPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [domains, setDomains] = useState<DataDomain[]>([]);
  const [summary, setSummary] = useState<DomainSummary>({ total: 0, governed: 0, ungoverned: 0, totalAssetsInDomains: 0 });
  const [people, setPeople] = useState<Person[]>([]);
  const [allAssets, setAllAssets] = useState<DataAssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [selectedDomain, setSelectedDomain] = useState<DataDomain | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // AI generate state
  const [generating, setGenerating] = useState(false);
  const [generatedDomains, setGeneratedDomains] = useState<Array<{ name: string; description: string; selected: boolean }>>([]);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);

  // Detail editing state
  const [detailOwnerId, setDetailOwnerId] = useState<string>('');
  const [detailStewardIds, setDetailStewardIds] = useState<string[]>([]);
  const [detailAssetIds, setDetailAssetIds] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [domainsRes, summaryRes, peopleRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DataDomain[] }>(`/data-domains${query}`),
        apiClient.get<{ success: boolean; data: DomainSummary }>(`/data-domains/summary${query}`),
        apiClient.get<{ success: boolean; data: Person[] }>('/people'),
        apiClient.get<{ success: boolean; data: DataAssetOption[] }>(`/data-assets${query}`),
      ]);
      setDomains(domainsRes.data || []);
      setSummary(summaryRes.data || { total: 0, governed: 0, ungoverned: 0, totalAssetsInDomains: 0 });
      setPeople(peopleRes.data || []);
      setAllAssets(assetsRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setSelectedDomain(null);
    setShowForm(true);
  };

  const openEdit = (domain: DataDomain) => {
    setForm({ name: domain.name, description: domain.description, status: domain.status, scopeDefinition: (domain as any).scopeDefinition || '' });
    setEditingId(domain.id);
    setSelectedDomain(null);
    setShowForm(true);
  };

  const openDetail = (domain: DataDomain) => {
    setSelectedDomain(domain);
    setDetailOwnerId(domain.ownerId || '');
    setDetailStewardIds(domain.stewardIds || []);
    setDetailAssetIds(domain.dataAssetIds || []);
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingId) {
      await apiClient.put(`/data-domains/${editingId}`, form);
      addToast('success', 'Data domain updated');
    } else {
      await apiClient.post('/data-domains', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
      addToast('success', 'Data domain created');
    }
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/data-domains/${id}`);
    if (selectedDomain?.id === id) setSelectedDomain(null);
    addToast('success', 'Data domain deleted');
    fetchData();
  };

  // ── Bulk select handlers ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === domains.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(domains.map((d) => d.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/data-domains/${id}`)));
    addToast('success', `Deleted ${selectedIds.size} data domains`);
    setSelectedIds(new Set());
    setSelectedDomain(null);
    fetchData();
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const handleDetailSave = async () => {
    if (!selectedDomain) return;
    const res = await apiClient.put<{ success: boolean; data: DataDomain }>(`/data-domains/${selectedDomain.id}`, {
      ownerId: detailOwnerId || null,
      stewardIds: detailStewardIds,
      dataAssetIds: detailAssetIds,
    });
    if (res.data) setSelectedDomain(res.data);
    fetchData();
  };

  const toggleSteward = (personId: string) => {
    setDetailStewardIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    );
  };

  const toggleAsset = (assetId: string) => {
    setDetailAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    );
  };

  // ── AI-generate handler ──
  const handleGenerate = async () => {
    if (!activeOrgId) {
      errorToast(null, 'Select an organization from the "Working In" dropdown first.');
      return;
    }
    setGenerating(true);
    try {
      // Look up the active org's industry.
      const orgRes = await apiClient.get<{ success: boolean; data: Array<{ id: string; industry: string }> }>('/organizations');
      const activeOrg = (orgRes.data || []).find((o) => o.id === activeOrgId);
      // Walk up the parent chain to find an org with an industry set.
      let industry = activeOrg?.industry || '';
      if (!industry) {
        const allOrgs = orgRes.data || [];
        let current = activeOrg;
        while (current && !industry) {
          const parent = allOrgs.find((o: any) => o.id === (current as any).parentId);
          if (parent) industry = (parent as any).industry || '';
          current = parent;
        }
      }
      if (!industry) {
        errorToast(null, 'The active organization (and its ancestors) has no industry set. Set it on the Organizations page first.');
        setGenerating(false);
        return;
      }
      const res = await apiClient.post<{ success: boolean; data: Array<{ name: string; description: string }> }>('/data-domains/generate', { industry });
      const suggestions = (res.data || []).map((d) => ({ ...d, selected: true }));
      if (suggestions.length === 0) {
        errorToast(null, 'AI returned no suggestions. Try a different industry.');
        setGenerating(false);
        return;
      }
      setGeneratedDomains(suggestions);
      setShowGeneratePreview(true);
    } catch (err) {
      errorToast(err, 'AI generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleApplyGenerated = async () => {
    const toCreate = generatedDomains.filter((d) => d.selected);
    if (toCreate.length === 0) { setShowGeneratePreview(false); return; }
    try {
      await Promise.all(toCreate.map((d) =>
        apiClient.post('/data-domains', {
          name: d.name,
          description: d.description,
          status: 'DRAFT',
          ...(activeOrgId ? { orgId: activeOrgId } : {}),
        }),
      ));
      addToast('success', `Created ${toCreate.length} data domain${toCreate.length === 1 ? '' : 's'}`);
      setShowGeneratePreview(false);
      setGeneratedDomains([]);
      fetchData();
    } catch (err) {
      errorToast(err, 'Failed to create domains');
    }
  };

  const statusBadgeStyle = (status: string): React.CSSProperties => {
    const c = getStatusColor(status);
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color,
    };
  };

  const handleStatusChange = async (domainId: string, newStatus: string) => {
    try {
      await apiClient.put(`/data-domains/${domainId}`, { status: newStatus });
      addToast('success', `Status changed to ${newStatus.replace('_', ' ')}`);
      fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to update status';
      addToast('error', msg);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Domains</h1>
            <HelpPopover id="domains-intro" title="Data Domains">
              Domains group related data assets into governed categories (e.g. Customer Data, Financial Data).
              Each domain has an owner, stewards, and a scope definition. Status lifecycle applies —
              locked domains cannot be edited until moved back to Draft.
            </HelpPopover>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Organize data assets into governed domains with assigned owners and stewards.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {domains.length > 0 && (
            <IconButton icon="trash" label="Delete all domains" variant="danger"
              onClick={() => setShowDeleteAll(true)} />
          )}
          {domains.length > 0 && (
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('data-domains.csv', ['Name', 'Description', 'Owner', 'Stewards', 'Assets', 'Status'], domains.map((d) => [
                d.name,
                d.description,
                d.ownerName || '',
                d.stewards.map((s) => s.name).join('; '),
                d.assets.map((a) => a.name).join('; '),
                d.status,
              ]))} />
          )}
          <IconButton icon="settings" label={generating ? 'Generating\u2026' : 'Generate from industry'} disabled={generating} onClick={handleGenerate} />
          <IconButton icon="plus" label="Add domain" variant="primary" onClick={openAdd} />
        </div>
      </div>

      {/* AI generation loading indicator */}
      {generating && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '2.5rem',
          textAlign: 'center',
          marginBottom: 20,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12, animation: 'procelaGenSpin 2s linear infinite' }}>{'\u2699'}</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--color-primary)' }}>
            Generating data domains...
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            AI is suggesting data domains based on your organization's industry. This usually takes 10{'\u2013'}20 seconds.
          </p>
          <style>{`@keyframes procelaGenSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Domains</div>
        </div>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#0f4f46' }}>{summary.governed}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Governed (have owner)</div>
        </div>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#dc2626' }}>{summary.ungoverned}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Ungoverned</div>
        </div>
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.totalAssetsInDomains}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Assets in Domains</div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteAll}
        title="Delete All Data Domains?"
        message={`This will permanently delete all ${domains.length} data domains. This cannot be undone.`}
        confirmLabel="Delete All"
        requireTypedConfirmation="DELETE"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/data-domains/all');
          setSelectedDomain(null);
          setSelectedIds(new Set());
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Data Domains?"
        message={`Delete ${selectedIds.size} selected data domains? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>{selectedIds.size} selected</span>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Delete Selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 500, background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Clear Selection
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Data Domain?"
        message="This will permanently delete this data domain. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) await handleDelete(id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Data Domain' : 'Add New Data Domain'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input
                autoFocus
                style={inputStyle}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Customer Data, Financial Data"
              />
            </div>
            {!editingId && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
                <select style={selectStyle} value="DRAFT" disabled>
                  <option value="DRAFT">Draft</option>
                </select>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2, display: 'block' }}>New domains start as Draft</span>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the purpose and scope of this data domain"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>Scope Definition <HelpPopover id="domain-scope" title="Scope Definition">Define what data falls inside and outside this domain. Clear boundaries prevent overlap and ensure every asset has a governance home.</HelpPopover></label>
              <input
                style={inputStyle}
                value={form.scopeDefinition}
                onChange={(e) => setForm({ ...form, scopeDefinition: e.target.value })}
                placeholder="What data falls in/out of this domain? e.g. All customer-facing data excluding internal analytics"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }}
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Domain'}
            </button>
          </div>
        </div>
      )}

      {/* Domain Detail Panel */}
      {selectedDomain && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600 }}>
              {selectedDomain.name} — Governance Details
            </h3>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-text-muted)' }} onClick={() => setSelectedDomain(null)} title="Close">
              x
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Owner */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Owner (Data Owner)</label>
              <select style={selectStyle} value={detailOwnerId} onChange={(e) => setDetailOwnerId(e.target.value)}>
                <option value="">-- Unassigned --</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Stewards */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                Stewards ({detailStewardIds.length} selected)
              </label>
              <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 8, background: 'var(--color-bg)' }}>
                {people.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 4 }}>No people available</div>
                ) : people.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={detailStewardIds.includes(p.id)} onChange={() => toggleSteward(p.id)} />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Data Assets */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
                Data Assets ({detailAssetIds.length} assigned)
              </label>
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 4, padding: 8, background: 'var(--color-bg)' }}>
                {allAssets.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 4 }}>No data assets available. Create data assets first.</div>
                ) : allAssets.map((a) => (
                  <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '3px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={detailAssetIds.includes(a.id)} onChange={() => toggleAsset(a.id)} />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => setSelectedDomain(null)}>Close</button>
            <button style={btnPrimary} onClick={handleDetailSave}>Save Governance Details</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : domains.length === 0 && !showForm ? (
          <EmptyState
            icon={'\u2637'}
            title="No data domains defined yet"
            description="Data domains group related data assets under a single governance umbrella — owner, stewards, policies. Start with the big buckets (Customer, Finance, Product) and refine later."
            action={{ label: '+ Add Domain', onClick: openAdd }}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={domains.length > 0 && selectedIds.size === domains.length}
                    onChange={toggleSelectAll} />
                </th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Owner</th>
                <th style={thStyle}>Stewards</th>
                <th style={thStyle}>Assets</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, width: 140, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((domain) => {
                const isSelected = selectedIds.has(domain.id);
                return (
                <tr key={domain.id} style={{ transition: 'background 0.1s', cursor: 'pointer', background: isSelected ? '#f0f9ff' : '' }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                  <td style={{ ...tdStyle, textAlign: 'center', width: 32 }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(domain.id)} />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 500 }} onClick={() => openDetail(domain)}>{domain.name}</td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => openDetail(domain)}>
                    {domain.description || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}
                  </td>
                  <td style={tdStyle} onClick={() => openDetail(domain)}>
                    {domain.ownerName || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>}
                  </td>
                  <td style={tdStyle} onClick={() => openDetail(domain)}>
                    {domain.stewards.length > 0
                      ? <span style={{ fontSize: 12 }}>{domain.stewards.length} steward{domain.stewards.length !== 1 ? 's' : ''}</span>
                      : <span style={{ color: 'var(--color-text-muted)' }}>0</span>
                    }
                  </td>
                  <td style={tdStyle} onClick={() => openDetail(domain)}>
                    {domain.assets.length > 0
                      ? <span style={{ fontSize: 12 }}>{domain.assets.length} asset{domain.assets.length !== 1 ? 's' : ''}</span>
                      : <span style={{ color: 'var(--color-text-muted)' }}>0</span>
                    }
                  </td>
                  <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                    <select
                      value={domain.status}
                      onChange={(e) => { if (e.target.value !== domain.status) handleStatusChange(domain.id, e.target.value); }}
                      style={{ ...statusBadgeStyle(domain.status), border: 'none', cursor: 'pointer', appearance: 'auto' as any, paddingRight: 16 }}
                    >
                      <option value={domain.status}>{domain.status.replace('_', ' ')}</option>
                      {(DOMAIN_TRANSITIONS[domain.status] || []).map((s) => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <IconButton size="sm" icon="eye" label="Details" onClick={() => openDetail(domain)} />
                      {!DOMAIN_LOCKED.has(domain.status) && (
                        <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(domain)} />
                      )}
                      {!DOMAIN_LOCKED.has(domain.status) && (
                        <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(domain.id)} />
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* AI Generate Preview Modal */}
      {showGeneratePreview && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1050,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowGeneratePreview(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-surface)',
              borderRadius: 10,
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
              padding: 24,
              maxWidth: 600, width: '92vw', maxHeight: '85vh', overflowY: 'auto',
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Suggested Data Domains</h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
              AI-generated based on your organization's industry. Uncheck any you don't need; the rest will be created as DRAFT domains.
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button
                onClick={() => setGeneratedDomains((prev) => prev.map((d) => ({ ...d, selected: true })))}
                style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 500, padding: 0 }}
              >
                Select all
              </button>
              <span style={{ color: 'var(--color-text-muted)' }}>{'|'}</span>
              <button
                onClick={() => setGeneratedDomains((prev) => prev.map((d) => ({ ...d, selected: false })))}
                style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontWeight: 500, padding: 0 }}
              >
                Deselect all
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {generatedDomains.map((d, i) => (
                <label
                  key={i}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '10px 12px', borderRadius: 6,
                    border: '1px solid var(--color-border)',
                    background: d.selected ? 'var(--color-primary-light)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={() => setGeneratedDomains((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)),
                    )}
                    style={{ marginTop: 3, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{d.description}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setShowGeneratePreview(false)}
                style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleApplyGenerated}
                disabled={generatedDomains.filter((d) => d.selected).length === 0}
                style={{
                  padding: '8px 18px', fontSize: 13, fontWeight: 500,
                  background: generatedDomains.some((d) => d.selected) ? 'var(--color-primary)' : '#e5e7eb',
                  color: generatedDomains.some((d) => d.selected) ? '#fff' : '#9ca3af',
                  border: 'none', borderRadius: 6,
                  cursor: generatedDomains.some((d) => d.selected) ? 'pointer' : 'not-allowed',
                }}
              >
                Create {generatedDomains.filter((d) => d.selected).length} domain{generatedDomains.filter((d) => d.selected).length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
