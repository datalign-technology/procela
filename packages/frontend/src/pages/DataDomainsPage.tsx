import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';

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
  status: 'ACTIVE' | 'DRAFT';
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
  status: 'ACTIVE' | 'DRAFT';
}

const emptyForm: FormData = { name: '', description: '', status: 'DRAFT' };

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
    setForm({ name: domain.name, description: domain.description, status: domain.status });
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

  const statusBadge = (status: string): React.CSSProperties => {
    const c = status === 'ACTIVE'
      ? { bg: '#d1f0eb', color: '#0f4f46' }
      : { bg: '#f1f5f9', color: '#64748b' };
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color,
    };
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Domains</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Organize data assets into governed domains with assigned owners and stewards.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {domains.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
            >
              Delete All
            </button>
          )}
          <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Add Domain
          </button>
        </div>
      </div>

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
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/data-domains/all');
          setSelectedDomain(null);
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

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
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'DRAFT' })}>
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the purpose and scope of this data domain"
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
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>
              No data domains defined yet. Use the + Add Domain button above to get started.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
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
              {domains.map((domain) => (
                <tr key={domain.id} style={{ transition: 'background 0.1s', cursor: 'pointer' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
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
                  <td style={tdStyle} onClick={() => openDetail(domain)}>
                    <span style={statusBadge(domain.status)}>{domain.status}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                      onClick={() => openDetail(domain)}
                      title="Details"
                    >
                      Details
                    </button>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                      onClick={() => openEdit(domain)}
                      title="Edit"
                    >
                      Edit
                    </button>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }}
                      onClick={() => setConfirmDelete(domain.id)}
                      title="Delete"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
