import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';

interface DataAssetEntity {
  id: string;
  name: string;
  description: string;
  systemId: string;
  owner: string;
  steward: string;
  governanceTier: 'BRONZE' | 'SILVER' | 'GOLD';
  healthScore: number;
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

const TIER_COLORS: Record<string, { bg: string; color: string }> = {
  BRONZE: { bg: '#f0e6d3', color: '#92600a' },
  SILVER: { bg: '#e8eaed', color: '#555d6e' },
  GOLD: { bg: '#fef3c7', color: '#92400e' },
};

const TIER_LABELS: Record<string, string> = {
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
};

interface FormData {
  name: string;
  description: string;
  systemId: string;
  owner: string;
  steward: string;
  governanceTier: 'BRONZE' | 'SILVER' | 'GOLD';
  healthScore: number;
}

const emptyForm: FormData = {
  name: '',
  description: '',
  systemId: '',
  owner: '',
  steward: '',
  governanceTier: 'BRONZE',
  healthScore: 50,
};

export default function DataAssetsPage() {
  const [assets, setAssets] = useState<DataAssetEntity[]>([]);
  const [systems, setSystems] = useState<SystemRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: DataAssetEntity[]; systems: SystemRef[] }>('/data-assets');
      setAssets(res.data || []);
      setSystems(res.systems || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      governanceTier: asset.governanceTier,
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
      await apiClient.post('/data-assets', form);
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

  // Stats
  const totalAssets = assets.length;
  const bronzeCount = assets.filter((a) => a.governanceTier === 'BRONZE').length;
  const silverCount = assets.filter((a) => a.governanceTier === 'SILVER').length;
  const goldCount = assets.filter((a) => a.governanceTier === 'GOLD').length;
  const avgHealth = totalAssets > 0 ? Math.round(assets.reduce((sum, a) => sum + a.healthScore, 0) / totalAssets) : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Assets</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Data assets described in business terms, linked to the systems that hold them.
          </p>
        </div>
        <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
          + Add Data Asset
        </button>
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
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Governance Tier</label>
              <select style={selectStyle} value={form.governanceTier} onChange={(e) => updateField('governanceTier', e.target.value)}>
                <option value="BRONZE">Bronze</option>
                <option value="SILVER">Silver</option>
                <option value="GOLD">Gold</option>
              </select>
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
              <input
                style={inputStyle}
                value={form.owner}
                onChange={(e) => updateField('owner', e.target.value)}
                placeholder="Business owner name"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Steward</label>
              <input
                style={inputStyle}
                value={form.steward}
                onChange={(e) => updateField('steward', e.target.value)}
                placeholder="Data steward name"
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
            <div style={{ fontSize: 22, fontWeight: 700, color: '#92600a' }}>{bronzeCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Bronze</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#555d6e' }}>{silverCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Silver</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#92400e' }}>{goldCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Gold</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{avgHealth}%</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Avg Health</div>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : assets.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>No data assets defined yet.</p>
            <button onClick={openAdd} style={btnPrimary}>+ Add Your First Data Asset</button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>System</th>
                <th style={thStyle}>Governance Tier</th>
                <th style={thStyle}>Health Score</th>
                <th style={thStyle}>Owner</th>
                <th style={thStyle}>Steward</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const tierStyle = TIER_COLORS[asset.governanceTier] || TIER_COLORS.BRONZE;
                const healthColor = asset.healthScore >= 80 ? '#16a34a' : asset.healthScore >= 50 ? '#ca8a04' : '#dc2626';
                return (
                  <tr key={asset.id} style={{ transition: 'background 0.1s' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{asset.name}</td>
                    <td style={tdStyle}>
                      {systemName(asset.systemId) || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        background: tierStyle.bg,
                        color: tierStyle.color,
                      }}>
                        {TIER_LABELS[asset.governanceTier] || asset.governanceTier}
                      </span>
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
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                        onClick={() => openEdit(asset)}
                        title="Edit"
                      >
                        Edit
                      </button>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }}
                        onClick={() => handleDelete(asset.id)}
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
    </div>
  );
}
