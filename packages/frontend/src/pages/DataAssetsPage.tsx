import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import { usePolling } from '../hooks/usePolling';
import ConfirmDialog from '../components/ConfirmDialog';

interface DataAssetEntity {
  id: string;
  name: string;
  description: string;
  systemId: string;
  owner: string;
  steward: string;
  /** @deprecated kept for backward-compat with existing stored data; not shown or edited in UI */
  governanceTier?: 'BRONZE' | 'SILVER' | 'GOLD';
  healthScore: number;
  // Populated when the asset was imported from a connection column.
  sourceConnectionId?: string;
  sourceAsset?: string;
  sourceColumn?: string;
  createdAt: string;
  updatedAt: string;
}

interface SystemRef {
  id: string;
  name: string;
}

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  background: 'var(--color-surface)',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'auto' as any,
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 13,
  borderTop: '1px solid var(--color-border)',
};

interface Asset360Data {
  asset: DataAssetEntity;
  system: { id: string; name: string; systemType: string } | null;
  domain: { id: string; name: string; ownerName: string | null; stewards: { id: string; name: string }[] } | null;
  mappings: { id: string; processStepId: string; linkType: string; notes: string; processPath: string }[];
  ownerInfo: { id: string | null; name: string } | null;
  stewardInfo: { id: string | null; name: string } | null;
}

interface CommentEntry {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  userName: string;
  content: string;
  createdAt: string;
}

interface FormData {
  name: string;
  description: string;
  systemId: string;
  owner: string;
  steward: string;
  healthScore: number;
}

const emptyForm: FormData = {
  name: '',
  description: '',
  systemId: '',
  owner: '',
  steward: '',
  healthScore: 50,
};

export default function DataAssetsPage() {
  const { activeOrgId } = useOrgContext();
  const [assets, setAssets] = useState<DataAssetEntity[]>([]);
  const [systems, setSystems] = useState<SystemRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewing360, setViewing360] = useState<Asset360Data | null>(null);
  const [loading360, setLoading360] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [assetComments, setAssetComments] = useState<CommentEntry[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentUserName, setCommentUserName] = useState('');
  // Data-quality rules modal, opened per-asset via the Rules action button.
  const [rulesModalAsset, setRulesModalAsset] = useState<DataAssetEntity | null>(null);
  const [peopleList, setPeopleList] = useState<Array<{ id: string; name: string }>>([]);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [assetRes, peopleRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DataAssetEntity[]; systems: SystemRef[] }>(`/data-assets${query}`),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string }> }>('/people'),
      ]);
      setAssets(assetRes.data || []);
      setSystems(assetRes.systems || []);
      setPeopleList(peopleRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  usePolling(fetchData, 30000);

  const systemName = (systemId: string) => {
    const sys = systems.find((s) => s.id === systemId);
    return sys ? sys.name : '';
  };

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (asset: DataAssetEntity) => {
    setForm({
      name: asset.name,
      description: asset.description,
      systemId: asset.systemId,
      owner: asset.owner,
      steward: asset.steward,
      healthScore: asset.healthScore,
    });
    setEditingId(asset.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editingId) {
      await apiClient.put(`/data-assets/${editingId}`, form);
    } else {
      await apiClient.post('/data-assets', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
    }
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/data-assets/${id}`);
    fetchData();
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const updateField = (field: keyof FormData, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === assets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(assets.map((a) => a.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/data-assets/${id}`)));
    setSelectedIds(new Set());
    fetchData();
  };

  const open360 = async (id: string) => {
    setLoading360(true);
    setAssetComments([]);
    setNewComment('');
    try {
      const [res, commentsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Asset360Data }>(`/data-assets/${id}/360`),
        apiClient.get<{ success: boolean; data: CommentEntry[] }>(`/comments?entityType=DataAsset&entityId=${id}`),
      ]);
      setViewing360(res.data || null);
      setAssetComments(commentsRes.data || []);
    } catch { /* */ }
    finally { setLoading360(false); }
  };

  const fetchComments = async (entityId: string) => {
    try {
      const res = await apiClient.get<{ success: boolean; data: CommentEntry[] }>(`/comments?entityType=DataAsset&entityId=${entityId}`);
      setAssetComments(res.data || []);
    } catch { /* */ }
  };

  const addComment = async () => {
    if (!newComment.trim() || !viewing360) return;
    try {
      await apiClient.post('/comments', {
        entityType: 'DataAsset',
        entityId: viewing360.asset.id,
        content: newComment.trim(),
        userName: commentUserName.trim() || 'Anonymous',
        orgId: activeOrgId,
      });
      setNewComment('');
      fetchComments(viewing360.asset.id);
    } catch { /* */ }
  };

  const deleteComment = async (commentId: string) => {
    if (!viewing360) return;
    try {
      await apiClient.delete(`/comments/${commentId}`);
      fetchComments(viewing360.asset.id);
    } catch { /* */ }
  };

  // Stats
  const totalAssets = assets.length;
  const linkedCount = assets.filter((a) => !!a.sourceColumn).length;
  const avgHealth = totalAssets > 0 ? Math.round(assets.reduce((sum, a) => sum + a.healthScore, 0) / totalAssets) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Assets</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Data assets described in business terms, linked to the systems that hold them.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {assets.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
            >
              Delete All
            </button>
          )}
          {assets.length > 0 && (
            <button
              onClick={() => exportCsv('data-assets.csv', ['Name', 'System', 'Source', 'Health Score', 'Owner', 'Steward'], assets.map((a) => [
                a.name,
                systemName(a.systemId),
                a.sourceAsset ? `${a.sourceAsset}${a.sourceColumn ? '.' + a.sourceColumn : ''}` : '',
                String(a.healthScore),
                a.owner,
                a.steward,
              ]))}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              Export CSV
            </button>
          )}
          <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Add Data Asset
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
          marginBottom: 20,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Data Asset' : 'Add New Data Asset'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input
                autoFocus
                style={inputStyle}
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Customer Account Data"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>System</label>
              <select style={selectStyle} value={form.systemId} onChange={(e) => updateField('systemId', e.target.value)}>
                <option value="">-- Select system --</option>
                {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe this data asset in business terms"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                Health Score: {form.healthScore}%
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={form.healthScore}
                  onChange={(e) => updateField('healthScore', Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.healthScore}
                  onChange={(e) => updateField('healthScore', Math.max(0, Math.min(100, Number(e.target.value))))}
                  style={{ ...inputStyle, width: 60, textAlign: 'center' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Owner</label>
              <select
                style={{ ...inputStyle, appearance: 'auto' as any }}
                value={form.owner}
                onChange={(e) => updateField('owner', e.target.value)}
              >
                <option value="">-- Select owner --</option>
                {peopleList.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Steward</label>
              <select
                style={{ ...inputStyle, appearance: 'auto' as any }}
                value={form.steward}
                onChange={(e) => updateField('steward', e.target.value)}
              >
                <option value="">-- Select data steward --</option>
                {peopleList.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }}
              disabled={!form.name.trim()}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Data Asset'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {assets.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{totalAssets}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Assets</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{linkedCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Linked to a column</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{avgHealth}%</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Avg Health</div>
          </div>
        </div>
      )}

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
        open={showDeleteAll}
        title="Delete All Data Assets?"
        message={`This will permanently delete all ${assets.length} data assets. This cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/data-assets/all');
          setSelectedIds(new Set());
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Data Asset?"
        message="This will permanently delete this data asset. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) await handleDelete(id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Data Assets?"
        message={`Delete ${selectedIds.size} selected items? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => {
          setConfirmBulkDelete(false);
          await handleBulkDelete();
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : assets.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>No data assets defined yet. Use the + Add Data Asset button above to get started.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 40, textAlign: 'center' }}>
                  <input type="checkbox" checked={assets.length > 0 && selectedIds.size === assets.length} onChange={toggleSelectAll} />
                </th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>System</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Health Score</th>
                <th style={thStyle}>Owner</th>
                <th style={thStyle}>Steward</th>
                <th style={{ ...thStyle, width: 140, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const healthColor = asset.healthScore >= 80 ? '#16a34a' : asset.healthScore >= 50 ? '#ca8a04' : '#dc2626';
                return (
                  <tr key={asset.id} style={{ transition: 'background 0.1s', background: selectedIds.has(asset.id) ? '#f0f9ff' : '' }} onMouseEnter={(e) => { if (!selectedIds.has(asset.id)) e.currentTarget.style.background = 'var(--color-bg)'; }} onMouseLeave={(e) => { if (!selectedIds.has(asset.id)) e.currentTarget.style.background = ''; }}>
                    <td style={{ ...tdStyle, textAlign: 'center', width: 40 }}>
                      <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={() => toggleSelect(asset.id)} />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{asset.name}</td>
                    <td style={tdStyle}>
                      {systemName(asset.systemId) || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      {asset.sourceAsset ? (
                        <span title="Discovered from a connection">
                          {asset.sourceAsset}
                          {asset.sourceColumn && <><span style={{ color: 'var(--color-text-muted)' }}>.</span>{asset.sourceColumn}</>}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>--</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          flex: 1,
                          maxWidth: 80,
                          height: 6,
                          borderRadius: 3,
                          background: 'var(--color-border)',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${asset.healthScore}%`,
                            height: '100%',
                            borderRadius: 3,
                            background: healthColor,
                          }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: healthColor }}>
                          {asset.healthScore}%
                        </span>
                      </div>
                    </td>
                    <td style={tdStyle}>{asset.owner || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                    <td style={tdStyle}>{asset.steward || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                        onClick={() => open360(asset.id)}
                        title="View 360"
                      >
                        View
                      </button>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5b21b6', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                        onClick={() => setRulesModalAsset(asset)}
                        title="Data quality rules"
                      >
                        Rules
                      </button>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                        onClick={() => openEdit(asset)}
                        title="Edit"
                      >
                        Edit
                      </button>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }}
                        onClick={() => setConfirmDelete(asset.id)}
                        title="Delete"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Data Asset 360 View Modal */}
      {(viewing360 || loading360) && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => { if (!loading360) setViewing360(null); }}>
          <div style={{
            background: 'var(--color-surface)', borderRadius: 'var(--radius-md)',
            padding: 24, maxWidth: 700, width: '90vw', maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }} onClick={(e) => e.stopPropagation()}>
            {loading360 ? (
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem' }}>Loading...</p>
            ) : viewing360 ? (
              <>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{viewing360.asset.name}</h2>
                    {viewing360.asset.description && (
                      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>{viewing360.asset.description}</p>
                    )}
                  </div>
                  <button onClick={() => setViewing360(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)', padding: '0 4px' }}>x</button>
                </div>

                {/* Asset Info */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 80, height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${viewing360.asset.healthScore}%`, height: '100%', borderRadius: 3,
                        background: viewing360.asset.healthScore >= 80 ? '#16a34a' : viewing360.asset.healthScore >= 50 ? '#ca8a04' : '#dc2626',
                      }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{viewing360.asset.healthScore}% Health</span>
                  </div>
                  {viewing360.system && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '3px 10px', borderRadius: 4 }}>
                      System: {viewing360.system.name} {viewing360.system.systemType ? `(${viewing360.system.systemType})` : ''}
                    </span>
                  )}
                </div>

                {/* Ownership */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ownership</h3>
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Owner</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{viewing360.ownerInfo?.name || '--'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Steward</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{viewing360.stewardInfo?.name || '--'}</div>
                    </div>
                  </div>
                </div>

                {/* Data Domain */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data Domain</h3>
                  {viewing360.domain ? (
                    <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
                      <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>{viewing360.domain.name}</div>
                      {viewing360.domain.ownerName && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Owner: {viewing360.domain.ownerName}</div>}
                      {viewing360.domain.stewards.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Stewards: {viewing360.domain.stewards.map((s) => s.name).join(', ')}</div>
                      )}
                    </div>
                  ) : (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Not assigned to any domain</p>
                  )}
                </div>

                {/* Mappings */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Process Mappings ({viewing360.mappings.length})
                  </h3>
                  {viewing360.mappings.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No process mappings for this asset</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {viewing360.mappings.map((m) => (
                        <div key={m.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12 }}>{m.processPath}</span>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                            background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                          }}>{m.linkType}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Comments */}
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Comments ({assetComments.length})
                  </h3>
                  {assetComments.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>No comments yet</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                      {assetComments.map((c) => (
                        <div key={c.id} style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{c.userName}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{new Date(c.createdAt).toLocaleString()}</span>
                              <button onClick={() => deleteComment(c.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-error)', padding: '0 2px' }}
                                title="Delete comment">x</button>
                            </div>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>{c.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        style={{ ...inputStyle, width: 140 }}
                        placeholder="Your name"
                        value={commentUserName}
                        onChange={(e) => setCommentUserName(e.target.value)}
                      />
                    </div>
                    <textarea
                      style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                      placeholder="Add a comment..."
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment(); } }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={addComment}
                        disabled={!newComment.trim()}
                        style={{
                          ...btnPrimary,
                          padding: '6px 14px',
                          fontSize: 12,
                          opacity: !newComment.trim() ? 0.5 : 1,
                        }}
                      >
                        Add Comment
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {rulesModalAsset && (
        <DataQualityRulesModal
          asset={rulesModalAsset}
          onClose={() => setRulesModalAsset(null)}
          onAfterChange={fetchData}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Data Quality Rules modal
// ──────────────────────────────────────────────────────────────────────────

type RuleType = 'NOT_NULL' | 'UNIQUE' | 'REGEX_MATCH' | 'IN_SET' | 'NUMERIC_RANGE' | 'LENGTH_RANGE';

interface RuleTemplate {
  id: string;
  ruleType: RuleType;
  dimension: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
}

interface DQRule {
  id: string;
  dataAssetId: string;
  name: string;
  description: string;
  dimension: string;
  threshold: number;
  currentScore: number;
  status: 'PASSING' | 'FAILING' | 'WARNING' | 'NOT_MEASURED';
  lastMeasured: string | null;
  ruleType?: RuleType;
  parameters?: Record<string, any>;
  lastRun?: {
    ranAt: string;
    simulated: boolean;
    totalRows: number;
    passCount: number;
    failCount: number;
    passRate: number;
    failureSamples: string[];
    message: string;
  };
}

function DataQualityRulesModal({ asset, onClose, onAfterChange }: {
  asset: DataAssetEntity;
  onClose: () => void;
  onAfterChange: () => void;
}) {
  const [rules, setRules] = useState<DQRule[]>([]);
  const [suggested, setSuggested] = useState<RuleTemplate[]>([]);
  const [generic, setGeneric] = useState<RuleTemplate[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [configuringTemplateId, setConfiguringTemplateId] = useState<string | null>(null);
  const [configParams, setConfigParams] = useState<Record<string, any>>({});

  const columnName = asset.sourceColumn;

  const load = async () => {
    try {
      const [rulesRes, tmplRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DQRule[] }>(`/data-quality/by-asset/${asset.id}`),
        apiClient.get<{ success: boolean; data: { suggested: RuleTemplate[]; generic: RuleTemplate[] } }>(
          `/data-quality/templates${columnName ? `?column=${encodeURIComponent(columnName)}` : ''}`,
        ),
      ]);
      setRules(rulesRes.data || []);
      setSuggested(tmplRes.data?.suggested || []);
      setGeneric(tmplRes.data?.generic || []);
    } catch { /* */ }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [asset.id]);

  const needsConfig = (t: RuleTemplate): boolean => {
    if (t.ruleType === 'IN_SET') return !t.parameters.allowedValues || t.parameters.allowedValues.length === 0;
    if (t.ruleType === 'NUMERIC_RANGE') return t.parameters.min === undefined && t.parameters.max === undefined;
    if (t.ruleType === 'LENGTH_RANGE') return t.parameters.minLength === undefined && t.parameters.maxLength === undefined;
    return false;
  };

  const addFromTemplate = async (t: RuleTemplate, overrideParams?: Record<string, any>) => {
    try {
      const parameters = overrideParams ?? t.parameters;
      await apiClient.post('/data-quality', {
        dataAssetId: asset.id,
        name: columnName ? `${columnName}: ${t.name}` : t.name,
        description: t.description,
        dimension: t.dimension,
        ruleType: t.ruleType,
        parameters,
        threshold: 95,
      });
      setConfiguringTemplateId(null);
      setConfigParams({});
      await load();
      onAfterChange();
    } catch { /* */ }
  };

  const handleAddClick = (t: RuleTemplate) => {
    if (needsConfig(t)) {
      setConfiguringTemplateId(t.id);
      setConfigParams({ ...t.parameters });
    } else {
      addFromTemplate(t);
    }
  };

  const runRule = async (rule: DQRule) => {
    setRunningId(rule.id);
    try {
      await apiClient.post(`/data-quality/${rule.id}/run`);
      await load();
      onAfterChange();
    } catch { /* */ } finally {
      setRunningId(null);
    }
  };

  const deleteRule = async (rule: DQRule) => {
    try {
      await apiClient.delete(`/data-quality/${rule.id}`);
      await load();
      onAfterChange();
    } catch { /* */ }
  };

  const templateRow = (t: RuleTemplate) => {
    const isConfiguring = configuringTemplateId === t.id;
    return (
      <div key={t.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{t.description}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {t.ruleType}{t.parameters.pattern ? ` /${t.parameters.pattern}/` : ''}
            </div>
          </div>
          <button
            onClick={() => handleAddClick(t)}
            style={{ ...btnPrimary, padding: '4px 12px', fontSize: 11, whiteSpace: 'nowrap' }}
            disabled={isConfiguring}
          >
            {isConfiguring ? 'Configure \u2193' : '+ Add'}
          </button>
        </div>
        {isConfiguring && (
          <div style={{ marginTop: 10, padding: 10, background: 'var(--color-bg)', borderRadius: 4 }}>
            {t.ruleType === 'IN_SET' && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                  Allowed values (comma-separated)
                </label>
                <input
                  style={{ ...inputStyle, fontSize: 12 }}
                  placeholder="e.g. active, inactive, suspended"
                  value={(configParams.allowedValues || []).join(', ')}
                  onChange={(e) => setConfigParams({
                    ...configParams,
                    allowedValues: e.target.value.split(',').map((v) => v.trim()).filter(Boolean),
                  })}
                />
              </div>
            )}
            {t.ruleType === 'NUMERIC_RANGE' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Min</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.min ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Max</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.max ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              </div>
            )}
            {t.ruleType === 'LENGTH_RANGE' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Min length</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.minLength ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, minLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>Max length</label>
                  <input type="number" style={{ ...inputStyle, fontSize: 12 }}
                    value={configParams.maxLength ?? ''}
                    onChange={(e) => setConfigParams({ ...configParams, maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                style={{ ...btnSecondary, padding: '4px 12px', fontSize: 11 }}
                onClick={() => { setConfiguringTemplateId(null); setConfigParams({}); }}
              >Cancel</button>
              <button
                style={{ ...btnPrimary, padding: '4px 12px', fontSize: 11 }}
                onClick={() => addFromTemplate(t, configParams)}
              >Add rule</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', padding: 20, maxWidth: 820, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Data Quality Rules — {asset.name}</h3>
            {(asset.sourceAsset || columnName) && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                {asset.sourceAsset || ''}{columnName ? `.${columnName}` : ''}
              </p>
            )}
            {!columnName && (
              <p style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                This asset isn\u2019t bound to a specific column, so rules will run against the whole asset (simulated only).
              </p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}>&times;</button>
        </div>

        {/* Active rules */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Active rules ({rules.length})
          </div>
          {rules.length === 0 ? (
            <div style={{ padding: '12px 14px', border: '1px dashed var(--color-border)', borderRadius: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
              No rules yet. Pick a template below to add one.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--color-border)', borderRadius: 4 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Last Run</th>
                  <th style={thStyle}>Result</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const pr = r.lastRun?.passRate;
                  const prColor = pr === undefined ? '#64748b' : pr >= 95 ? '#16a34a' : pr >= 80 ? '#ca8a04' : '#dc2626';
                  return (
                    <tr key={r.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 500 }}>{r.name}</div>
                        {r.description && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.description}</div>}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 11, fontFamily: 'var(--font-mono)' }}>{r.ruleType || '\u2014'}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {r.lastRun ? new Date(r.lastRun.ranAt).toLocaleString() : 'Never'}
                        {r.lastRun?.simulated && <span style={{ marginLeft: 4, fontSize: 10, color: '#92400e' }}>(simulated)</span>}
                      </td>
                      <td style={tdStyle}>
                        {r.lastRun ? (
                          <div>
                            <div style={{ fontWeight: 600, color: prColor, fontSize: 13 }}>
                              {r.lastRun.passRate}% pass ({r.lastRun.passCount.toLocaleString()}/{r.lastRun.totalRows.toLocaleString()})
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.lastRun.message}</div>
                            {r.lastRun.failureSamples.length > 0 && (
                              <div style={{ fontSize: 10, color: '#7f1d1d', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                                Samples: {r.lastRun.failureSamples.slice(0, 3).join(', ')}{r.lastRun.failureSamples.length > 3 ? '\u2026' : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Not yet run</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <button
                          style={{ ...btnPrimary, padding: '3px 10px', fontSize: 11, marginRight: 4, opacity: !r.ruleType || runningId === r.id ? 0.6 : 1 }}
                          disabled={!r.ruleType || runningId === r.id}
                          onClick={() => runRule(r)}
                          title={r.ruleType ? 'Run rule against the data' : 'Legacy rule — no typed execution'}
                        >
                          {runningId === r.id ? 'Running\u2026' : 'Run'}
                        </button>
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 11 }}
                          onClick={() => deleteRule(r)}
                        >Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Templates */}
        <div style={{ marginTop: 20 }}>
          {suggested.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Suggested for {columnName ? <code>{columnName}</code> : 'this asset'}
              </div>
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, marginBottom: 16 }}>
                {suggested.map(templateRow)}
              </div>
            </>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            All rule templates
          </div>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 4 }}>
            {generic.map(templateRow)}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={btnSecondary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
