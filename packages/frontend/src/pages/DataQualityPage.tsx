import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import { usePolling } from '../hooks/usePolling';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToastStore } from '../stores/toastStore';

interface QualityRule {
  id: string;
  orgId: string;
  dataAssetId: string;
  dimension: string;
  name: string;
  description: string;
  threshold: number;
  currentScore: number;
  weight: number;
  status: string;
  lastMeasured: string | null;
  dataAssetName: string;
  createdAt: string;
  updatedAt: string;
}

interface DataAssetRef {
  id: string;
  name: string;
}

interface FormData {
  dataAssetId: string;
  dimension: string;
  name: string;
  description: string;
  threshold: number;
  currentScore: number;
  weight: number;
}

const emptyForm: FormData = {
  dataAssetId: '',
  dimension: 'COMPLETENESS',
  name: '',
  description: '',
  threshold: 80,
  currentScore: 0,
  weight: 5,
};

const QUALITY_DIMENSIONS = ['COMPLETENESS', 'ACCURACY', 'TIMELINESS', 'CONSISTENCY', 'UNIQUENESS', 'VALIDITY'];

const DIMENSION_BADGES: Record<string, { bg: string; color: string }> = {
  COMPLETENESS: { bg: '#dbeafe', color: '#1e40af' },
  ACCURACY: { bg: '#d1f0eb', color: '#0f4f46' },
  TIMELINESS: { bg: '#fef3c7', color: '#92400e' },
  CONSISTENCY: { bg: '#ede9fe', color: '#5b21b6' },
  UNIQUENESS: { bg: '#e0e7ff', color: '#3730a3' },
  VALIDITY: { bg: '#f1f5f9', color: '#64748b' },
};

const STATUS_BADGES: Record<string, { bg: string; color: string }> = {
  PASSING: { bg: '#d1f0eb', color: '#0f4f46' },
  WARNING: { bg: '#fef3c7', color: '#92400e' },
  FAILING: { bg: '#fce7f3', color: '#9d174d' },
  NOT_MEASURED: { bg: '#f1f5f9', color: '#64748b' },
};

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

function Badge({ label, colors }: { label: string; colors: { bg: string; color: string } }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 9999,
      fontSize: 11,
      fontWeight: 600,
      background: colors.bg,
      color: colors.color,
    }}>
      {label.replace(/_/g, ' ')}
    </span>
  );
}

function ScoreBar({ score, threshold }: { score: number; threshold: number }) {
  const barColor = score >= threshold ? '#059669' : score >= threshold - 10 ? '#d97706' : '#dc2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4,
        position: 'relative', minWidth: 60, maxWidth: 120,
      }}>
        <div style={{
          width: `${score}%`, height: '100%', background: barColor,
          borderRadius: 4, transition: 'width 0.3s',
        }} />
        {/* Threshold marker */}
        <div style={{
          position: 'absolute', left: `${threshold}%`, top: -2,
          width: 2, height: 12, background: '#374151', borderRadius: 1,
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: barColor, minWidth: 32 }}>{score}%</span>
    </div>
  );
}

export default function DataQualityPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [rules, setRules] = useState<QualityRule[]>([]);
  const [assetsList, setAssetsList] = useState<DataAssetRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [filterAssetId, setFilterAssetId] = useState('');
  const [filterDimension, setFilterDimension] = useState('');
  const [computingHealth, setComputingHealth] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [rulesRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: QualityRule[] }>(`/data-quality${query}`),
        apiClient.get<{ success: boolean; data: DataAssetRef[] }>(`/data-assets${query}`),
      ]);
      setRules(rulesRes.data || []);
      setAssetsList(assetsRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  usePolling(fetchData, 30000);

  // Apply local filters
  let filteredRules = rules;
  if (filterAssetId) filteredRules = filteredRules.filter((r) => r.dataAssetId === filterAssetId);
  if (filterDimension) filteredRules = filteredRules.filter((r) => r.dimension === filterDimension);

  // Stats
  const totalRules = rules.length;
  const passingCount = rules.filter((r) => r.status === 'PASSING').length;
  const warningCount = rules.filter((r) => r.status === 'WARNING').length;
  const failingCount = rules.filter((r) => r.status === 'FAILING').length;
  const avgScore = totalRules > 0 ? Math.round(rules.reduce((sum, r) => sum + r.currentScore, 0) / totalRules) : 0;

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (rule: QualityRule) => {
    setForm({
      dataAssetId: rule.dataAssetId,
      dimension: rule.dimension,
      name: rule.name,
      description: rule.description,
      threshold: rule.threshold,
      currentScore: rule.currentScore,
      weight: rule.weight,
    });
    setEditingId(rule.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.dataAssetId) {
      addToast('error', 'Name and Data Asset are required');
      return;
    }
    try {
      if (editingId) {
        await apiClient.put(`/data-quality/${editingId}`, form);
        addToast('success', 'Quality rule updated');
      } else {
        await apiClient.post('/data-quality', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
        addToast('success', 'Quality rule created');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      fetchData();
    } catch {
      addToast('error', 'Failed to save quality rule');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/data-quality/${id}`);
      addToast('success', 'Quality rule deleted');
      fetchData();
    } catch {
      addToast('error', 'Failed to delete quality rule');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleComputeHealth = async (assetId: string) => {
    setComputingHealth(assetId);
    try {
      const res = await apiClient.post<{ success: boolean; data: { healthScore: number; rulesCount: number } }>(`/data-quality/compute-health/${assetId}`);
      const score = res.data.healthScore;
      const assetName = assetsList.find((a) => a.id === assetId)?.name || 'Asset';
      addToast('success', `${assetName} health score computed: ${score}%`);
      fetchData();
    } catch {
      addToast('error', 'Failed to compute health score');
    } finally {
      setComputingHealth(null);
    }
  };

  const updateField = (field: keyof FormData, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Get unique asset IDs from rules that have rules for Compute Health buttons
  const assetsWithRules = [...new Set(rules.map((r) => r.dataAssetId))];

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Quality Rules</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Define quality rules per data asset and compute health scores.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {rules.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
            >
              Delete All
            </button>
          )}
          {rules.length > 0 && (
            <button
              onClick={() => exportCsv('data-quality-rules.csv', ['Data Asset', 'Rule Name', 'Dimension', 'Threshold', 'Current Score', 'Weight', 'Status', 'Last Measured'], rules.map((r) => [
                r.dataAssetName,
                r.name,
                r.dimension,
                String(r.threshold),
                String(r.currentScore),
                String(r.weight),
                r.status,
                r.lastMeasured || '',
              ]))}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              Export CSV
            </button>
          )}
          <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Add Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      {rules.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{totalRules}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Rules</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#059669' }}>{passingCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Passing</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#d97706' }}>{warningCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Warning</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#dc2626' }}>{failingCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Failing</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{avgScore}%</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Avg Score</div>
          </div>
        </div>
      )}

      {/* Filters */}
      {rules.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Data Asset:</label>
            <select style={{ ...selectStyle, width: 'auto', minWidth: 180 }} value={filterAssetId} onChange={(e) => setFilterAssetId(e.target.value)}>
              <option value="">All</option>
              {assetsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Dimension:</label>
            <select style={{ ...selectStyle, width: 'auto', minWidth: 150 }} value={filterDimension} onChange={(e) => setFilterDimension(e.target.value)}>
              <option value="">All</option>
              {QUALITY_DIMENSIONS.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Compute Health Buttons */}
      {assetsWithRules.length > 0 && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          marginBottom: 16,
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Compute Health Scores
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {assetsWithRules.map((assetId) => {
              const asset = assetsList.find((a) => a.id === assetId);
              const ruleCount = rules.filter((r) => r.dataAssetId === assetId).length;
              return (
                <button
                  key={assetId}
                  onClick={() => handleComputeHealth(assetId)}
                  disabled={computingHealth === assetId}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 500,
                    background: computingHealth === assetId ? '#e5e7eb' : '#eff6ff',
                    color: computingHealth === assetId ? '#9ca3af' : '#1e40af',
                    border: '1px solid #bfdbfe',
                    borderRadius: 'var(--radius-md)',
                    cursor: computingHealth === assetId ? 'not-allowed' : 'pointer',
                  }}
                >
                  {computingHealth === assetId ? 'Computing...' : `Compute: ${asset?.name || assetId} (${ruleCount} rules)`}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
            {editingId ? 'Edit Quality Rule' : 'Add New Quality Rule'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Asset *</label>
              <select style={selectStyle} value={form.dataAssetId} onChange={(e) => updateField('dataAssetId', e.target.value)}>
                <option value="">-- Select data asset --</option>
                {assetsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Dimension</label>
              <select style={selectStyle} value={form.dimension} onChange={(e) => updateField('dimension', e.target.value)}>
                {QUALITY_DIMENSIONS.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Rule Name *</label>
              <input
                autoFocus
                style={inputStyle}
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Email field completeness"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                Threshold: {form.threshold}%
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={form.threshold}
                  onChange={(e) => updateField('threshold', Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.threshold}
                  onChange={(e) => updateField('threshold', Math.max(0, Math.min(100, Number(e.target.value))))}
                  style={{ ...inputStyle, width: 60, textAlign: 'center' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                Current Score: {form.currentScore}%
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={form.currentScore}
                  onChange={(e) => updateField('currentScore', Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.currentScore}
                  onChange={(e) => updateField('currentScore', Math.max(0, Math.min(100, Number(e.target.value))))}
                  style={{ ...inputStyle, width: 60, textAlign: 'center' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                Weight: {form.weight}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={form.weight}
                  onChange={(e) => updateField('weight', Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.weight}
                  onChange={(e) => updateField('weight', Math.max(1, Math.min(10, Number(e.target.value))))}
                  style={{ ...inputStyle, width: 60, textAlign: 'center' }}
                />
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe what this quality rule checks"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: (!form.name.trim() || !form.dataAssetId) ? 0.6 : 1 }}
              disabled={!form.name.trim() || !form.dataAssetId}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Rule'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={showDeleteAll}
        title="Delete All Quality Rules?"
        message={`This will permanently delete all ${rules.length} quality rules. This cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/data-quality/all');
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Quality Rule?"
        message="Are you sure you want to delete this quality rule?"
        confirmLabel="Delete"
        onConfirm={() => { if (confirmDelete) handleDelete(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Table */}
      {filteredRules.length === 0 ? (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 40,
          textAlign: 'center',
          color: 'var(--color-text-muted)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{'\u2713'}</div>
          <div>{rules.length === 0 ? 'No quality rules defined yet. Click "+ Add Rule" to get started.' : 'No rules match the current filters.'}</div>
        </div>
      ) : (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>Data Asset</th>
                <th style={thStyle}>Rule Name</th>
                <th style={thStyle}>Dimension</th>
                <th style={thStyle}>Threshold</th>
                <th style={thStyle}>Current Score</th>
                <th style={thStyle}>Weight</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last Measured</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule) => (
                <tr key={rule.id}>
                  <td style={tdStyle}>{rule.dataAssetName || rule.dataAssetId}</td>
                  <td style={tdStyle}>{rule.name}</td>
                  <td style={tdStyle}>
                    <Badge label={rule.dimension} colors={DIMENSION_BADGES[rule.dimension] || DIMENSION_BADGES.VALIDITY} />
                  </td>
                  <td style={tdStyle}>{rule.threshold}%</td>
                  <td style={tdStyle}>
                    <ScoreBar score={rule.currentScore} threshold={rule.threshold} />
                  </td>
                  <td style={tdStyle}>{rule.weight}</td>
                  <td style={tdStyle}>
                    <Badge label={rule.status} colors={STATUS_BADGES[rule.status] || STATUS_BADGES.NOT_MEASURED} />
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {rule.lastMeasured ? new Date(rule.lastMeasured).toLocaleDateString() : '--'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => openEdit(rule)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-primary)', padding: '2px 6px' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(rule.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#dc2626', padding: '2px 6px' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
