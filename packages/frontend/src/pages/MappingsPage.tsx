import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import ConfirmDialog from '../components/ConfirmDialog';

// ── Types ──

interface StepInfo {
  stepId: string;
  stepName: string;
  subProcessId: string;
  subProcessName: string;
  processId: string;
  processName: string;
  valueStreamId: string;
  valueStreamName: string;
}

interface AssetInfo {
  assetId: string;
  assetName: string;
  assetDescription: string;
  governanceTier: string;
  healthScore: number;
}

interface Mapping {
  id: string;
  processStepId: string;
  dataAssetId: string;
  linkType: string;
  notes: string;
  aiSuggested: boolean;
  userOverridden: boolean;
  createdAt: string;
  stepInfo: StepInfo | null;
  assetInfo: AssetInfo | null;
}

interface StoredStep {
  id: string;
  name: string;
  description: string;
}

interface StoredSubProcess {
  id: string;
  name: string;
  steps: StoredStep[];
}

interface StoredProcess {
  id: string;
  name: string;
  subProcesses: StoredSubProcess[];
}

interface StoredValueStream {
  id: string;
  name: string;
  processes: StoredProcess[];
}

interface DataAsset {
  id: string;
  name: string;
  description: string;
  governanceTier: string;
}

// ── Styles ──

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

const LINK_TYPES = ['consumes', 'produces', 'transforms', 'references'];

// ── Helpers ──

function formatStepPath(info: StepInfo): string {
  return `${info.valueStreamName} > ${info.processName} > ${info.subProcessName} > ${info.stepName}`;
}

// ── Component ──

export default function MappingsPage() {
  const { activeOrgId } = useOrgContext();
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [valueStreams, setValueStreams] = useState<StoredValueStream[]>([]);
  const [dataAssets, setDataAssets] = useState<DataAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Form state — hierarchical step selection
  const [selectedVsId, setSelectedVsId] = useState('');
  const [selectedProcId, setSelectedProcId] = useState('');
  const [selectedSpId, setSelectedSpId] = useState('');
  const [selectedStepId, setSelectedStepId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [linkType, setLinkType] = useState('references');
  const [notes, setNotes] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [mappingsRes, vsRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Mapping[] }>(`/mappings${query}`),
        apiClient.get<{ success: boolean; data: StoredValueStream[] }>(`/process-catalog/value-streams${query}`),
        apiClient.get<{ success: boolean; data: DataAsset[] }>(`/data-assets${query}`),
      ]);
      setMappings(mappingsRes.data || []);
      setValueStreams(vsRes.data || []);
      setDataAssets(assetsRes.data || []);
    } catch {
      /* API may not be running */
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derived selections for hierarchical dropdown
  const selectedVs = valueStreams.find((vs) => vs.id === selectedVsId);
  const processes = selectedVs?.processes || [];
  const selectedProc = processes.find((p) => p.id === selectedProcId);
  const subProcesses = selectedProc?.subProcesses || [];
  const selectedSp = subProcesses.find((sp) => sp.id === selectedSpId);
  const steps = selectedSp?.steps || [];

  const resetForm = () => {
    setSelectedVsId('');
    setSelectedProcId('');
    setSelectedSpId('');
    setSelectedStepId('');
    setSelectedAssetId('');
    setLinkType('references');
    setNotes('');
  };

  const openForm = () => {
    resetForm();
    setShowForm(true);
  };

  const handleCancel = () => {
    resetForm();
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!selectedStepId || !selectedAssetId) return;
    await apiClient.post('/mappings', {
      processStepId: selectedStepId,
      dataAssetId: selectedAssetId,
      linkType,
      notes,
      aiSuggested: false,
      ...(activeOrgId ? { orgId: activeOrgId } : {}),
    });
    setShowForm(false);
    resetForm();
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/mappings/${id}`);
    fetchData();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === mappings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(mappings.map((m) => m.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/mappings/${id}`)));
    setSelectedIds(new Set());
    fetchData();
  };

  // Stats
  const totalMappings = mappings.length;
  const aiSuggestedCount = mappings.filter((m) => m.aiSuggested).length;
  const manualCount = totalMappings - aiSuggestedCount;

  const canSave = selectedStepId && selectedAssetId;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process-Data Mappings</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Link data assets to process steps to track data dependencies across your organization.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {mappings.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
            >
              Delete All
            </button>
          )}
          {mappings.length > 0 && (
            <button
              onClick={() => exportCsv('mappings.csv', ['Process Step', 'Data Asset', 'Link Type', 'AI Suggested', 'Notes'], mappings.map((m) => [
                m.stepInfo ? formatStepPath(m.stepInfo) : m.processStepId,
                m.assetInfo ? m.assetInfo.assetName : m.dataAssetId,
                m.linkType,
                m.aiSuggested ? 'Yes' : 'No',
                m.notes,
              ]))}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}
            >
              Export CSV
            </button>
          )}
          <button onClick={openForm} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Add Mapping
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showForm && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 20,
            marginBottom: 20,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add New Mapping</h3>

          {/* Hierarchical step selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Value Stream *</label>
              <select
                style={selectStyle}
                value={selectedVsId}
                onChange={(e) => {
                  setSelectedVsId(e.target.value);
                  setSelectedProcId('');
                  setSelectedSpId('');
                  setSelectedStepId('');
                }}
              >
                <option value="">-- Select value stream --</option>
                {valueStreams.map((vs) => (
                  <option key={vs.id} value={vs.id}>
                    {vs.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Process *</label>
              <select
                style={selectStyle}
                value={selectedProcId}
                disabled={!selectedVsId}
                onChange={(e) => {
                  setSelectedProcId(e.target.value);
                  setSelectedSpId('');
                  setSelectedStepId('');
                }}
              >
                <option value="">-- Select process --</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Sub-Process *</label>
              <select
                style={selectStyle}
                value={selectedSpId}
                disabled={!selectedProcId}
                onChange={(e) => {
                  setSelectedSpId(e.target.value);
                  setSelectedStepId('');
                }}
              >
                <option value="">-- Select sub-process --</option>
                {subProcesses.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Step *</label>
              <select
                style={selectStyle}
                value={selectedStepId}
                disabled={!selectedSpId}
                onChange={(e) => setSelectedStepId(e.target.value)}
              >
                <option value="">-- Select step --</option>
                {steps.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Asset *</label>
              <select style={selectStyle} value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}>
                <option value="">-- Select data asset --</option>
                {dataAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Link Type</label>
              <select style={selectStyle} value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                {LINK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Notes</label>
              <input
                style={inputStyle}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this mapping"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>
              Cancel
            </button>
            <button
              style={{ ...btnPrimary, opacity: canSave ? 1 : 0.6 }}
              disabled={!canSave}
              onClick={handleSave}
            >
              Add Mapping
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {mappings.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div
            style={{
              flex: 1,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700 }}>{totalMappings}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Mappings</div>
          </div>
          <div
            style={{
              flex: 1,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700 }}>{aiSuggestedCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>AI Suggested</div>
          </div>
          <div
            style={{
              flex: 1,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700 }}>{manualCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Manual</div>
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
        title="Delete All Mappings?"
        message={`This will permanently delete all ${mappings.length} mappings. This cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/mappings/all');
          setSelectedIds(new Set());
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Mapping?"
        message="This will permanently delete this mapping. This cannot be undone."
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
        title="Delete Selected Mappings?"
        message={`Delete ${selectedIds.size} selected items? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => {
          setConfirmBulkDelete(false);
          await handleBulkDelete();
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Table */}
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : mappings.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>
              No mappings defined yet. Use the + Add Mapping button above to get started.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 40, textAlign: 'center' }}>
                  <input type="checkbox" checked={mappings.length > 0 && selectedIds.size === mappings.length} onChange={toggleSelectAll} />
                </th>
                <th style={thStyle}>Process Step</th>
                <th style={thStyle}>Data Asset</th>
                <th style={thStyle}>Link Type</th>
                <th style={thStyle}>AI Suggested</th>
                <th style={thStyle}>Notes</th>
                <th style={{ ...thStyle, width: 60, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr
                  key={m.id}
                  style={{ transition: 'background 0.1s', background: selectedIds.has(m.id) ? '#f0f9ff' : '' }}
                  onMouseEnter={(e) => { if (!selectedIds.has(m.id)) e.currentTarget.style.background = 'var(--color-bg)'; }}
                  onMouseLeave={(e) => { if (!selectedIds.has(m.id)) e.currentTarget.style.background = ''; }}
                >
                  <td style={{ ...tdStyle, textAlign: 'center', width: 40 }}>
                    <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleSelect(m.id)} />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 300 }}>
                    {m.stepInfo ? formatStepPath(m.stepInfo) : m.processStepId}
                  </td>
                  <td style={tdStyle}>
                    {m.assetInfo ? m.assetInfo.assetName : m.dataAssetId}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        background: 'var(--color-primary-light)',
                        color: 'var(--color-primary)',
                      }}
                    >
                      {m.linkType}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {m.aiSuggested ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 500,
                          background: '#dbeafe',
                          color: '#1d4ed8',
                        }}
                      >
                        AI Suggested
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Manual</span>
                    )}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      color: m.notes ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                      maxWidth: 200,
                    }}
                  >
                    {m.notes || '--'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-error)',
                        fontSize: 12,
                        padding: '2px 6px',
                      }}
                      onClick={() => setConfirmDelete(m.id)}
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
