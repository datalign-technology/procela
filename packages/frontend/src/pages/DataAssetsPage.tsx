import React, { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import { usePolling } from '../hooks/usePolling';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import SortableTh from '../components/SortableTh';
import HelpPopover from '../components/HelpPopover';
import { SkeletonRows } from '../components/Skeleton';
import { useSortedList } from '../hooks/useSortedList';
import { useToastStore } from '../stores/toastStore';
import { errorToast } from '../lib/errorToast';
import LinkConnectionModal from '../components/LinkConnectionModal';

interface DataAssetEntity {
  id: string;
  name: string;
  description: string;
  systemId: string;
  owner?: string;
  steward?: string;
  governanceTier?: 'BRONZE' | 'SILVER' | 'GOLD';
  healthScore?: number;
  sourceConnectionId?: string;
  sourceAsset?: string;
  sourceColumn?: string;
  createdAt: string;
  updatedAt: string;
  // Enriched by the list endpoint so the table can render inline.
  domainName?: string | null;
  ownerName?: string | null;
  stewardName?: string | null;
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
}

const emptyForm: FormData = {
  name: '',
  description: '',
  systemId: '',
};

interface DataAssetColumn {
  id: string;
  dataAssetId: string;
  columnName: string;
  dataType?: string;
  description?: string;
  sourceConnectionId?: string;
  sourceAsset?: string;
  sourceColumn?: string;
}

export default function DataAssetsPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
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

  // Column state — expandable per-asset
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [columnsMap, setColumnsMap] = useState<Record<string, DataAssetColumn[]>>({});
  const [columnsLoading, setColumnsLoading] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [assetComments, setAssetComments] = useState<CommentEntry[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentUserName, setCommentUserName] = useState('');

  // Binding state: one primary binding per asset is the common case. We
  // fetch them in one roundtrip keyed by asset id and expose tiny bits
  // (connection name + column) inline on each row.
  interface BindingRow {
    id: string;
    connectionId: string;
    sourceAsset: string;
    sourceColumn?: string;
    isPrimary: boolean;
  }
  const [bindingsByAsset, setBindingsByAsset] = useState<Record<string, BindingRow[]>>({});
  const [connectionNameById, setConnectionNameById] = useState<Record<string, string>>({});
  const [linkModalAsset, setLinkModalAsset] = useState<DataAssetEntity | null>(null);
  const [linkModalMode, setLinkModalMode] = useState<'new' | 'change'>('new');

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [assetRes, connRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: DataAssetEntity[]; systems: SystemRef[] }>(`/data-assets${query}`),
        apiClient.get<{ success: boolean; data: Array<{ id: string; name: string }> }>(`/connections${query}`),
      ]);
      const nextAssets = assetRes.data || [];
      setAssets(nextAssets);
      setSystems(assetRes.systems || []);
      // Build a lookup of connection names so the binding column can show
      // "<conn-name> / <asset>.<col>" without a second trip per row.
      const cmap: Record<string, string> = {};
      for (const c of connRes.data || []) cmap[c.id] = c.name;
      setConnectionNameById(cmap);
      // Fan-out: fetch bindings per asset in parallel. Small N in practice;
      // if this grows we'll add a bulk endpoint.
      const entries = await Promise.all(nextAssets.map(async (a) => {
        try {
          const res = await apiClient.get<{ success: boolean; data: BindingRow[] }>(`/data-assets/${a.id}/bindings`);
          return [a.id, res.data || []] as const;
        } catch { return [a.id, [] as BindingRow[]] as const; }
      }));
      const map: Record<string, BindingRow[]> = {};
      for (const [id, bs] of entries) map[id] = bs;
      setBindingsByAsset(map);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  const primaryBindingOf = (assetId: string): BindingRow | undefined => {
    const list = bindingsByAsset[assetId] || [];
    return list.find((b) => b.isPrimary) || list[0];
  };

  const unlinkPrimary = async (asset: DataAssetEntity) => {
    const b = primaryBindingOf(asset.id);
    if (!b) return;
    try {
      await apiClient.delete(`/data-assets/${asset.id}/bindings/${b.id}`);
      fetchData();
    } catch { /* */ }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  usePolling(fetchData, 30000);

  const systemName = (systemId: string) => {
    const sys = systems.find((s) => s.id === systemId);
    return sys ? sys.name : '';
  };

  // URL-persisted sort.
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    assets,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      system: (a, b) => systemName(a.systemId).localeCompare(systemName(b.systemId)),
      domain: (a, b) => (a.domainName || '').localeCompare(b.domainName || ''),
      owner: (a, b) => (a.ownerName || '').localeCompare(b.ownerName || ''),
      updated: (a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt),
    },
    'name',
  );

  // Column management
  const toggleExpandColumns = async (assetId: string) => {
    if (expandedAssetId === assetId) { setExpandedAssetId(null); return; }
    setExpandedAssetId(assetId);
    // Fetch columns if we haven't already (or refresh)
    setColumnsLoading(assetId);
    try {
      const res = await apiClient.get<{ success: boolean; data: DataAssetColumn[] }>(`/data-assets/${assetId}/columns`);
      setColumnsMap((prev) => ({ ...prev, [assetId]: res.data || [] }));
    } catch { /* */ }
    finally { setColumnsLoading(null); }
  };

  const autoDiscoverColumns = async (assetId: string) => {
    setDiscovering(assetId);
    try {
      const res = await apiClient.post<{ success: boolean; data: DataAssetColumn[]; message: string }>(`/data-assets/${assetId}/columns/auto-discover`, {});
      if (res.data?.length > 0) {
        addToast('success', res.message || `Discovered ${res.data.length} columns`);
      } else {
        addToast('info', res.message || 'No new columns found.');
      }
      // Refresh column list
      const listRes = await apiClient.get<{ success: boolean; data: DataAssetColumn[] }>(`/data-assets/${assetId}/columns`);
      setColumnsMap((prev) => ({ ...prev, [assetId]: listRes.data || [] }));
    } catch (err) {
      errorToast(err, 'Column discovery failed');
    } finally {
      setDiscovering(null);
    }
  };

  const deleteColumn = async (assetId: string, colId: string) => {
    try {
      await apiClient.delete(`/data-assets/${assetId}/columns/${colId}`);
      setColumnsMap((prev) => ({
        ...prev,
        [assetId]: (prev[assetId] || []).filter((c) => c.id !== colId),
      }));
    } catch (err) {
      errorToast(err, 'Failed to delete column');
    }
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
    });
    setEditingId(asset.id);
    setShowForm(true);
  };

  // Duplicate — seed the create form from an existing asset's values.
  const openDuplicate = (asset: DataAssetEntity) => {
    setForm({
      name: `${asset.name} (copy)`,
      description: asset.description,
      systemId: asset.systemId,
    });
    setEditingId(null);
    setShowForm(true);
  };

  const handleSave = async (keepOpen: boolean = false) => {
    if (!form.name.trim()) return;
    if (editingId) {
      await apiClient.put(`/data-assets/${editingId}`, form);
    } else {
      await apiClient.post('/data-assets', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
    }
    // "Save and add another": keep the form open with fresh inputs so
    // the user can keep keying in new assets without clicking Add each
    // time. The original form state isn't reset on edit (keepOpen only
    // applies to create flow).
    if (keepOpen && !editingId) {
      setForm(emptyForm);
      fetchData();
      return;
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

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Assets</h1>
            <HelpPopover id="data-assets-overview" title="Data assets">
              Define your data in business terms first ("Customer accounts",
              "Billing records") — then link each one to where it actually
              lives via a connection. Asset identity stays stable even when
              the storage location changes.
            </HelpPopover>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Data assets described in business terms, linked to the systems that hold them.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {assets.length > 0 && (
            <IconButton icon="trash" label="Delete all data assets" variant="danger"
              onClick={() => setShowDeleteAll(true)} />
          )}
          {assets.length > 0 && (
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('data-assets.csv', ['Name', 'Description', 'System', 'Source', 'Domain', 'Owner', 'Steward'], assets.map((a) => [
                a.name,
                a.description,
                systemName(a.systemId),
                a.sourceAsset ? `${a.sourceAsset}${a.sourceColumn ? '.' + a.sourceColumn : ''}` : '',
                a.domainName || '',
                a.ownerName || '',
                a.stewardName || '',
              ]))} />
          )}
          <IconButton icon="plus" label="Add data asset" variant="primary" onClick={openAdd} />
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
          </div>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 12 }}>
            Ownership &amp; stewardship are managed on the Governance page. Data quality and health live on the Data Quality page.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            {!editingId && (
              <button
                style={{ ...btnSecondary, opacity: !form.name.trim() ? 0.6 : 1 }}
                disabled={!form.name.trim()}
                onClick={() => handleSave(true)}
                title="Save this asset and keep the form open to add another"
              >
                Save & Add Another
              </button>
            )}
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }}
              disabled={!form.name.trim()}
              onClick={() => handleSave(false)}
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
        requireTypedConfirmation="DELETE"
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
          <SkeletonRows rows={5} columns={4} />
        ) : assets.length === 0 && !showForm ? (
          <EmptyState
            icon={'\u26C1'}
            title="No data assets yet"
            description="Data assets describe your information in business terms — customer accounts, billing records, inventory levels. Define them first, then link each one to where the data actually lives."
            action={{ label: '+ Add Data Asset', onClick: openAdd }}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 40, textAlign: 'center' }}>
                  <input type="checkbox" checked={assets.length > 0 && selectedIds.size === assets.length} onChange={toggleSelectAll} aria-label="Select all assets" />
                </th>
                <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Name</SortableTh>
                <SortableTh sortKey="system" active={sortKey} dir={sortDir} onClick={toggleSort}>System</SortableTh>
                <th style={thStyle}>Source</th>
                <SortableTh sortKey="domain" active={sortKey} dir={sortDir} onClick={toggleSort}>Domain</SortableTh>
                <SortableTh sortKey="owner" active={sortKey} dir={sortDir} onClick={toggleSort}>Owner</SortableTh>
                <th style={thStyle}>Steward</th>
                <th style={{ ...thStyle, width: 180, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((asset) => {
                const binding = primaryBindingOf(asset.id);
                const connName = binding ? connectionNameById[binding.connectionId] : undefined;
                const isExpanded = expandedAssetId === asset.id;
                const cols = columnsMap[asset.id] || [];
                return (
                  <React.Fragment key={asset.id}>
                  <tr style={{ transition: 'background 0.1s', background: selectedIds.has(asset.id) ? '#f0f9ff' : '' }} onMouseEnter={(e) => { if (!selectedIds.has(asset.id)) e.currentTarget.style.background = 'var(--color-bg)'; }} onMouseLeave={(e) => { if (!selectedIds.has(asset.id)) e.currentTarget.style.background = ''; }}>
                    <td style={{ ...tdStyle, textAlign: 'center', width: 40 }}>
                      <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={() => toggleSelect(asset.id)} />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => toggleExpandColumns(asset.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 10, padding: 0, width: 14, flexShrink: 0 }}
                          title={isExpanded ? 'Collapse columns' : 'Expand columns'}
                        >
                          {isExpanded ? '\u25BC' : '\u25B6'}
                        </button>
                        <div style={{ minWidth: 0 }}>
                          {asset.name}
                          {asset.description && (
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                              {asset.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {systemName(asset.systemId) || <span style={{ color: 'var(--color-text-muted)' }}>{'--'}</span>}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {binding ? (
                        <span title={`Linked to connection ${connName || binding.connectionId}`}>
                          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                            {binding.sourceAsset}{binding.sourceColumn ? `.${binding.sourceColumn}` : ''}
                          </code>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>{'--'}</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {asset.domainName || <span style={{ color: 'var(--color-text-muted)' }}>{'--'}</span>}
                    </td>
                    <td style={tdStyle}>
                      {asset.ownerName || <span style={{ color: 'var(--color-text-muted)' }}>{'--'}</span>}
                    </td>
                    <td style={tdStyle}>
                      {asset.stewardName || <span style={{ color: 'var(--color-text-muted)' }}>{'--'}</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <IconButton size="sm" icon="eye" label="View 360" onClick={() => open360(asset.id)} />
                        {binding ? (
                          <>
                            <IconButton size="sm" icon="refresh" label="Change connection or column" onClick={() => { setLinkModalAsset(asset); setLinkModalMode('change'); }} />
                            <IconButton size="sm" icon="unlink" label="Unlink from location" onClick={() => unlinkPrimary(asset)} />
                          </>
                        ) : (
                          <IconButton size="sm" icon="link" label="Link to connection" variant="primary" onClick={() => { setLinkModalAsset(asset); setLinkModalMode('new'); }} />
                        )}
                        <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(asset)} />
                        <IconButton size="sm" icon="copy" label="Duplicate" onClick={() => openDuplicate(asset)} />
                        <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(asset.id)} />
                      </div>
                    </td>
                  </tr>
                  {/* Expanded columns section */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, background: '#fafbfc', borderTop: 'none' }}>
                        <div style={{ padding: '12px 20px 12px 60px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Columns ({cols.length})
                            </span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {binding && (
                                <button
                                  onClick={() => autoDiscoverColumns(asset.id)}
                                  disabled={discovering === asset.id}
                                  style={{
                                    padding: '4px 10px', fontSize: 11, fontWeight: 500,
                                    background: 'var(--color-primary)', color: '#fff',
                                    border: 'none', borderRadius: 4, cursor: discovering === asset.id ? 'default' : 'pointer',
                                    opacity: discovering === asset.id ? 0.6 : 1,
                                  }}
                                >
                                  {discovering === asset.id ? 'Discovering\u2026' : 'Auto-discover columns'}
                                </button>
                              )}
                            </div>
                          </div>
                          {columnsLoading === asset.id ? (
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 8 }}>{'Loading\u2026'}</div>
                          ) : cols.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 8 }}>
                              {binding
                                ? 'No columns yet. Click "Auto-discover columns" to populate from the linked connection.'
                                : 'No columns yet. Link this asset to a connection first, then discover its columns.'}
                            </div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ background: 'var(--color-bg)' }}>
                                  <th style={{ ...thStyle, fontSize: 10, padding: '6px 10px' }}>Column</th>
                                  <th style={{ ...thStyle, fontSize: 10, padding: '6px 10px' }}>Data Type</th>
                                  <th style={{ ...thStyle, fontSize: 10, padding: '6px 10px' }}>Description</th>
                                  <th style={{ ...thStyle, fontSize: 10, padding: '6px 10px' }}>Source</th>
                                  <th style={{ ...thStyle, fontSize: 10, padding: '6px 10px', width: 50, textAlign: 'center' }}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {cols.map((col) => (
                                  <tr key={col.id}>
                                    <td style={{ padding: '5px 10px', borderTop: '1px solid var(--color-border)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{col.columnName}</td>
                                    <td style={{ padding: '5px 10px', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>{col.dataType || '\u2014'}</td>
                                    <td style={{ padding: '5px 10px', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>{col.description || '\u2014'}</td>
                                    <td style={{ padding: '5px 10px', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                      {col.sourceAsset ? `${col.sourceAsset}.${col.sourceColumn || col.columnName}` : '\u2014'}
                                    </td>
                                    <td style={{ padding: '5px 10px', borderTop: '1px solid var(--color-border)', textAlign: 'center' }}>
                                      <IconButton size="sm" icon="trash" label="Remove column" variant="danger" onClick={() => deleteColumn(asset.id, col.id)} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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
                  {viewing360.system && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '3px 10px', borderRadius: 4 }}>
                      System: {viewing360.system.name} {viewing360.system.systemType ? `(${viewing360.system.systemType})` : ''}
                    </span>
                  )}
                  {viewing360.asset.sourceAsset && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '3px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>
                      Source: {viewing360.asset.sourceAsset}{viewing360.asset.sourceColumn ? `.${viewing360.asset.sourceColumn}` : ''}
                    </span>
                  )}
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
                {/* Footer Close — keyboard / mobile users may not discover
                    the header X or backdrop click; an explicit button is
                    the predictable affordance. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                  <button
                    onClick={() => setViewing360(null)}
                    style={{
                      padding: '8px 16px', background: 'var(--color-bg)', color: 'var(--color-text)',
                      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {linkModalAsset && (
        <LinkConnectionModal
          asset={{ id: linkModalAsset.id, name: linkModalAsset.name }}
          activeOrgId={activeOrgId}
          existingBinding={linkModalMode === 'change' ? (() => {
            const b = primaryBindingOf(linkModalAsset.id);
            return b ? { id: b.id, connectionId: b.connectionId, sourceAsset: b.sourceAsset, sourceColumn: b.sourceColumn } : undefined;
          })() : undefined}
          onClose={() => setLinkModalAsset(null)}
          onLinked={fetchData}
        />
      )}
    </div>
  );
}
