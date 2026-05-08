import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import { usePolling } from '../hooks/usePolling';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';

interface LineageLink {
  id: string;
  orgId: string;
  sourceSystemId: string;
  targetSystemId: string;
  dataAssetId: string | null;
  description: string;
  flowType: string;
  frequency: string;
  status: string;
  sourceSystemName: string;
  targetSystemName: string;
  dataAssetName: string;
  createdAt: string;
  updatedAt: string;
}

interface SystemRef {
  id: string;
  name: string;
  systemType: string;
}

interface DataAssetRef {
  id: string;
  name: string;
}

interface VisNode {
  id: string;
  name: string;
  systemType: string;
  inboundCount: number;
  outboundCount: number;
}

interface VisLink {
  id: string;
  sourceSystemId: string;
  targetSystemId: string;
  flowType: string;
  frequency: string;
  status: string;
  dataAssetName: string;
}

interface FormData {
  sourceSystemId: string;
  targetSystemId: string;
  dataAssetId: string;
  flowType: string;
  frequency: string;
  status: string;
  description: string;
}

const emptyForm: FormData = {
  sourceSystemId: '',
  targetSystemId: '',
  dataAssetId: '',
  flowType: 'ETL',
  frequency: 'ON_DEMAND',
  status: 'ACTIVE',
  description: '',
};

const FLOW_TYPES = ['ETL', 'API', 'FILE_TRANSFER', 'REPLICATION', 'MANUAL', 'STREAMING'];
const FREQUENCIES = ['REAL_TIME', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'ON_DEMAND'];

const FLOW_TYPE_BADGES: Record<string, { bg: string; color: string }> = {
  ETL: { bg: '#dbeafe', color: '#1e40af' },
  API: { bg: '#d1f0eb', color: '#0f4f46' },
  FILE_TRANSFER: { bg: '#fef3c7', color: '#92400e' },
  REPLICATION: { bg: '#ede9fe', color: '#5b21b6' },
  MANUAL: { bg: '#f1f5f9', color: '#64748b' },
  STREAMING: { bg: '#d1fae5', color: '#065f46' },
};

const FREQUENCY_BADGES: Record<string, { bg: string; color: string }> = {
  REAL_TIME: { bg: '#d1fae5', color: '#065f46' },
  HOURLY: { bg: '#dbeafe', color: '#1e40af' },
  DAILY: { bg: '#dbeafe', color: '#1e40af' },
  WEEKLY: { bg: '#fef3c7', color: '#92400e' },
  MONTHLY: { bg: '#fef3c7', color: '#92400e' },
  ON_DEMAND: { bg: '#f1f5f9', color: '#64748b' },
};

const STATUS_BADGES: Record<string, { bg: string; color: string }> = {
  ACTIVE: { bg: '#d1f0eb', color: '#0f4f46' },
  INACTIVE: { bg: '#fef3c7', color: '#92400e' },
  DEPRECATED: { bg: '#fce7f3', color: '#9d174d' },
};

const FLOW_ARROW_COLORS: Record<string, string> = {
  ETL: '#2563eb',
  API: '#059669',
  FILE_TRANSFER: '#d97706',
  REPLICATION: '#7c3aed',
  MANUAL: '#94a3b8',
  STREAMING: '#0d9488',
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

type LineageColId = 'source' | 'target' | 'asset' | 'flowType' | 'frequency' | 'status' | 'description';
const LINEAGE_COLUMN_DEFS: Array<{ id: LineageColId; label: string; defaultVisible: boolean }> = [
  { id: 'source',      label: 'Source System', defaultVisible: true  },
  { id: 'target',      label: 'Target System', defaultVisible: true  },
  { id: 'asset',       label: 'Data Asset',    defaultVisible: true  },
  { id: 'flowType',    label: 'Flow Type',     defaultVisible: true  },
  { id: 'frequency',   label: 'Frequency',     defaultVisible: true  },
  { id: 'status',      label: 'Status',        defaultVisible: true  },
  { id: 'description', label: 'Description',   defaultVisible: false },
];

export default function DataLineagePage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const lineageCols = useColumnPicker<LineageColId>('procela.dataLineage.visibleCols.v1', LINEAGE_COLUMN_DEFS);
  const [links, setLinks] = useState<LineageLink[]>([]);
  const [systemsList, setSystemsList] = useState<SystemRef[]>([]);
  const [assetsList, setAssetsList] = useState<DataAssetRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'visualization'>('table');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Visualization data
  const [visNodes, setVisNodes] = useState<VisNode[]>([]);
  const [visLinks, setVisLinks] = useState<VisLink[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [linksRes, systemsRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: LineageLink[] }>(`/data-lineage${query}`),
        apiClient.get<{ success: boolean; data: SystemRef[] }>(`/systems${query}`),
        apiClient.get<{ success: boolean; data: DataAssetRef[] }>(`/data-assets${query}`),
      ]);
      setLinks(linksRes.data || []);
      setSystemsList(systemsRes.data || []);
      setAssetsList(assetsRes.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  const fetchVisualization = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: { nodes: VisNode[]; links: VisLink[] } }>(`/data-lineage/visualization${query}`);
      setVisNodes(res.data.nodes || []);
      setVisLinks(res.data.links || []);
    } catch { /* */ }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (viewMode === 'visualization') fetchVisualization(); }, [viewMode, fetchVisualization]);
  usePolling(fetchData, 30000);

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (link: LineageLink) => {
    setForm({
      sourceSystemId: link.sourceSystemId,
      targetSystemId: link.targetSystemId,
      dataAssetId: link.dataAssetId || '',
      flowType: link.flowType,
      frequency: link.frequency,
      status: link.status,
      description: link.description,
    });
    setEditingId(link.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.sourceSystemId || !form.targetSystemId) {
      addToast('error', 'Source and target systems are required');
      return;
    }
    if (form.sourceSystemId === form.targetSystemId) {
      addToast('error', 'Source and target systems cannot be the same');
      return;
    }
    try {
      if (editingId) {
        await apiClient.put(`/data-lineage/${editingId}`, form);
        addToast('success', 'Lineage flow updated');
      } else {
        await apiClient.post('/data-lineage', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
        addToast('success', 'Lineage flow created');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      fetchData();
      if (viewMode === 'visualization') fetchVisualization();
    } catch {
      addToast('error', 'Failed to save lineage flow');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/data-lineage/${id}`);
      addToast('success', 'Lineage flow deleted');
      fetchData();
      if (viewMode === 'visualization') fetchVisualization();
    } catch {
      addToast('error', 'Failed to delete lineage flow');
    }
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
    if (selectedIds.size === links.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(links.map((l) => l.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/data-lineage/${id}`)));
      addToast('success', `Deleted ${selectedIds.size} lineage flows`);
      setSelectedIds(new Set());
      fetchData();
      if (viewMode === 'visualization') fetchVisualization();
    } catch {
      addToast('error', 'Bulk delete failed');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <SkeletonRows rows={5} columns={4} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Lineage</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Track how data flows between systems — which system feeds which.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <ColumnPicker state={lineageCols} />
          {links.length > 0 && (
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('data-lineage.csv', ['Source System', 'Target System', 'Data Asset', 'Flow Type', 'Frequency', 'Status', 'Description'], links.map((l) => [
                l.sourceSystemName,
                l.targetSystemName,
                l.dataAssetName,
                l.flowType,
                l.frequency,
                l.status,
                l.description,
              ]))} />
          )}
          <IconButton icon="eye" label={viewMode === 'table' ? 'Visualize' : 'Table view'}
            onClick={() => setViewMode(viewMode === 'table' ? 'visualization' : 'table')} />
          <IconButton icon="plus" label="Add flow" variant="primary" onClick={openAdd} />
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
            {editingId ? 'Edit Lineage Flow' : 'Add New Lineage Flow'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Source System *</label>
              <select style={selectStyle} value={form.sourceSystemId} onChange={(e) => updateField('sourceSystemId', e.target.value)}>
                <option value="">-- Select source system --</option>
                {systemsList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target System *</label>
              <select style={selectStyle} value={form.targetSystemId} onChange={(e) => updateField('targetSystemId', e.target.value)}>
                <option value="">-- Select target system --</option>
                {systemsList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {form.sourceSystemId && form.targetSystemId && form.sourceSystemId === form.targetSystemId && (
                <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>Source and target cannot be the same system</div>
              )}
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Asset (optional)</label>
              <select style={selectStyle} value={form.dataAssetId} onChange={(e) => updateField('dataAssetId', e.target.value)}>
                <option value="">-- None --</option>
                {assetsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Flow Type</label>
              <select style={selectStyle} value={form.flowType} onChange={(e) => updateField('flowType', e.target.value)}>
                {FLOW_TYPES.map((ft) => <option key={ft} value={ft}>{ft.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Frequency</label>
              <select style={selectStyle} value={form.frequency} onChange={(e) => updateField('frequency', e.target.value)}>
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select style={selectStyle} value={form.status} onChange={(e) => updateField('status', e.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="DEPRECATED">Deprecated</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe this data flow"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: (!form.sourceSystemId || !form.targetSystemId || form.sourceSystemId === form.targetSystemId) ? 0.6 : 1, cursor: (!form.sourceSystemId || !form.targetSystemId || form.sourceSystemId === form.targetSystemId) ? 'not-allowed' : 'pointer' }}
              disabled={!form.sourceSystemId || !form.targetSystemId || form.sourceSystemId === form.targetSystemId}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Flow'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Lineage Flow?"
        message="Are you sure you want to delete this lineage flow?"
        confirmLabel="Delete"
        onConfirm={() => { if (confirmDelete) handleDelete(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Lineage Flows?"
        message={`Delete ${selectedIds.size} selected flows? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && viewMode === 'table' && (
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

      {viewMode === 'table' ? (
        <>
          {/* Table */}
          {links.length === 0 ? (
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 40,
              textAlign: 'center',
              color: 'var(--color-text-muted)',
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{'\u21C4'}</div>
              <div>No lineage flows defined yet. Click "+ Add Flow" to get started.</div>
            </div>
          ) : (
            <div style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'auto',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                      <input type="checkbox"
                        checked={links.length > 0 && selectedIds.size === links.length}
                        onChange={toggleSelectAll} />
                    </th>
                    {lineageCols.isVisible('source') && <th style={thStyle}>Source System</th>}
                    {lineageCols.isVisible('target') && <th style={thStyle}>Target System</th>}
                    {lineageCols.isVisible('asset') && <th style={thStyle}>Data Asset</th>}
                    {lineageCols.isVisible('flowType') && <th style={thStyle}>Flow Type</th>}
                    {lineageCols.isVisible('frequency') && <th style={thStyle}>Frequency</th>}
                    {lineageCols.isVisible('status') && <th style={thStyle}>Status</th>}
                    {lineageCols.isVisible('description') && <th style={thStyle}>Description</th>}
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => {
                    const isSelected = selectedIds.has(link.id);
                    return (
                    <tr key={link.id} style={{ background: isSelected ? '#f0f9ff' : '' }}>
                      <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(link.id)} />
                      </td>
                      {lineageCols.isVisible('source') && <td style={tdStyle}>{link.sourceSystemName || link.sourceSystemId}</td>}
                      {lineageCols.isVisible('target') && <td style={tdStyle}>{link.targetSystemName || link.targetSystemId}</td>}
                      {lineageCols.isVisible('asset') && (
                        <td style={tdStyle}>
                          {link.dataAssetName ? (
                            <span style={{ color: 'var(--color-text-secondary)' }}>{link.dataAssetName}</span>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>--</span>
                          )}
                        </td>
                      )}
                      {lineageCols.isVisible('flowType') && (
                        <td style={tdStyle}>
                          <Badge label={link.flowType} colors={FLOW_TYPE_BADGES[link.flowType] || FLOW_TYPE_BADGES.MANUAL} />
                        </td>
                      )}
                      {lineageCols.isVisible('frequency') && (
                        <td style={tdStyle}>
                          <Badge label={link.frequency} colors={FREQUENCY_BADGES[link.frequency] || FREQUENCY_BADGES.ON_DEMAND} />
                        </td>
                      )}
                      {lineageCols.isVisible('status') && (
                        <td style={tdStyle}>
                          <Badge label={link.status} colors={STATUS_BADGES[link.status] || STATUS_BADGES.ACTIVE} />
                        </td>
                      )}
                      {lineageCols.isVisible('description') && (
                        <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {link.description || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>--</span>}
                        </td>
                      )}
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(link)} />
                          <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(link.id)} />
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* Visualization View */
        <LineageVisualization nodes={visNodes} links={visLinks} />
      )}
    </div>
  );
}

/* ---- Visualization Component ---- */

function LineageVisualization({ nodes, links }: { nodes: VisNode[]; links: VisLink[] }) {
  if (nodes.length === 0) {
    return (
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 40,
        textAlign: 'center',
        color: 'var(--color-text-muted)',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{'\u21C4'}</div>
        <div>No lineage data to visualize. Add some flows first.</div>
      </div>
    );
  }

  const BOX_W = 160;
  const BOX_H = 80;
  const PADDING = 80;

  // Arrange nodes in a grid
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);
  const svgW = cols * (BOX_W + PADDING) + PADDING;
  const svgH = rows * (BOX_H + PADDING) + PADDING + 40;

  const nodePositions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    nodePositions[node.id] = {
      x: PADDING + col * (BOX_W + PADDING),
      y: PADDING + row * (BOX_H + PADDING),
    };
  });

  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'auto',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        <defs>
          {Object.entries(FLOW_ARROW_COLORS).map(([type, color]) => (
            <marker
              key={type}
              id={`arrow-${type}`}
              viewBox="0 0 10 6"
              refX="10"
              refY="3"
              markerWidth="10"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 3 L 0 6 z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* Links */}
        {links.map((link) => {
          const from = nodePositions[link.sourceSystemId];
          const to = nodePositions[link.targetSystemId];
          if (!from || !to) return null;

          const x1 = from.x + BOX_W / 2;
          const y1 = from.y + BOX_H / 2;
          const x2 = to.x + BOX_W / 2;
          const y2 = to.y + BOX_H / 2;
          const color = FLOW_ARROW_COLORS[link.flowType] || '#94a3b8';
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          // Offset endpoint to box edge
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const startX = x1 + Math.cos(angle) * (BOX_W / 2 + 4);
          const startY = y1 + Math.sin(angle) * (BOX_H / 2 + 4);
          const endX = x2 - Math.cos(angle) * (BOX_W / 2 + 12);
          const endY = y2 - Math.sin(angle) * (BOX_H / 2 + 12);

          return (
            <g key={link.id}>
              <line
                x1={startX} y1={startY} x2={endX} y2={endY}
                stroke={color}
                strokeWidth={2}
                markerEnd={`url(#arrow-${link.flowType})`}
                opacity={link.status === 'DEPRECATED' ? 0.3 : link.status === 'INACTIVE' ? 0.5 : 1}
                strokeDasharray={link.status === 'DEPRECATED' ? '4,4' : link.status === 'INACTIVE' ? '6,3' : undefined}
              />
              {/* Animated flowing particle */}
              {link.status === 'ACTIVE' && (
                <circle r="3" fill={color} opacity="0.8">
                  <animateMotion
                    dur={`${2 + Math.random()}s`}
                    repeatCount="indefinite"
                    path={`M ${startX} ${startY} L ${endX} ${endY}`}
                  />
                </circle>
              )}
              {/* Second staggered particle for busy flows */}
              {link.status === 'ACTIVE' && link.frequency !== 'MANUAL' && (
                <circle r="2" fill={color} opacity="0.5">
                  <animateMotion
                    dur={`${2.5 + Math.random()}s`}
                    repeatCount="indefinite"
                    begin="1s"
                    path={`M ${startX} ${startY} L ${endX} ${endY}`}
                  />
                </circle>
              )}
              <text
                x={midX} y={midY - 6}
                textAnchor="middle"
                fontSize={9}
                fill={color}
                fontWeight={600}
              >
                {link.flowType.replace(/_/g, ' ')}
              </text>
              <text
                x={midX} y={midY + 6}
                textAnchor="middle"
                fontSize={8}
                fill="#94a3b8"
              >
                {link.frequency.replace(/_/g, ' ')}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = nodePositions[node.id];
          return (
            <g key={node.id}>
              <rect
                x={pos.x} y={pos.y}
                width={BOX_W} height={BOX_H}
                rx={8} ry={8}
                fill="#ffffff"
                stroke="#d1d5db"
                strokeWidth={1.5}
              />
              <text
                x={pos.x + BOX_W / 2} y={pos.y + 22}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill="#111827"
              >
                {node.name.length > 18 ? node.name.substring(0, 16) + '...' : node.name}
              </text>
              {node.systemType && (
                <text
                  x={pos.x + BOX_W / 2} y={pos.y + 38}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#6b7280"
                >
                  {node.systemType}
                </text>
              )}
              <text
                x={pos.x + BOX_W / 2} y={pos.y + 58}
                textAnchor="middle"
                fontSize={10}
                fill="#94a3b8"
              >
                {'\u2193'}{node.inboundCount} in / {'\u2191'}{node.outboundCount} out
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
