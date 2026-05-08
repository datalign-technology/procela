import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { usePolling } from '../hooks/usePolling';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from './../components/IconButton';
import EmptyState from './../components/EmptyState';
import SortableTh from '../components/SortableTh';
import { useSortedList } from '../hooks/useSortedList';
import { SkeletonRows } from '../components/Skeleton';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionProfile {
  id: string;
  orgId: string;
  /** Legacy single-system field, mirrored from systemIds[0] for older
   *  callers. Use systemIds for the authoritative set. */
  systemId: string;
  /** All systems this connection serves (many-to-many). Populated by
   *  the backend from the connectionSystemLinks join table. */
  systemIds?: string[];
  name: string;
  connectionType: string;
  config: Record<string, any> & {
    // LOCAL file storage fields populated by the upload endpoint
    localFilePath?: string;
    originalFileName?: string;
    fileSize?: number;
    rowCount?: number;
    columns?: string[];
    lastUploadedAt?: string;
  };
  credentials: Record<string, any>;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'UNTESTED';
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SystemEntity {
  id: string;
  name: string;
  description: string;
  systemType: string;
}

interface DiscoveredAsset {
  name: string;
  type: string;
  rowCount?: number;
  lastModified?: string;
  columns?: string[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Badge colors
// ---------------------------------------------------------------------------

const STATUS_BADGES: Record<string, { bg: string; color: string }> = {
  CONNECTED: { bg: '#d1f0eb', color: '#0f4f46' },
  DISCONNECTED: { bg: '#f1f5f9', color: '#64748b' },
  ERROR: { bg: '#fce7f3', color: '#9d174d' },
  UNTESTED: { bg: '#fef3c7', color: '#92400e' },
};

const TYPE_BADGES: Record<string, { bg: string; color: string }> = {
  DATABASE: { bg: '#dbeafe', color: '#1e40af' },
  FILE_STORAGE: { bg: '#fef3c7', color: '#92400e' },
  API: { bg: '#d1f0eb', color: '#0f4f46' },
  DATA_WAREHOUSE: { bg: '#ede9fe', color: '#5b21b6' },
  SPREADSHEET: { bg: '#f1f5f9', color: '#64748b' },
};

const TYPE_LABELS: Record<string, string> = {
  DATABASE: 'Database',
  FILE_STORAGE: 'File Storage',
  API: 'API',
  DATA_WAREHOUSE: 'Data Warehouse',
  SPREADSHEET: 'Spreadsheet',
};

// ---------------------------------------------------------------------------
// Form interface
// ---------------------------------------------------------------------------

interface FormData {
  name: string;
  systemIds: string[];
  connectionType: string;
  config: Record<string, any>;
  credentials: Record<string, any>;
}

const emptyForm: FormData = {
  name: '', systemIds: [], connectionType: 'DATABASE',
  config: {}, credentials: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function configSummary(conn: ConnectionProfile): string {
  const c = conn.config;
  if (conn.connectionType === 'DATABASE') {
    const parts = [c.host, c.port ? `:${c.port}` : '', c.database ? `/${c.database}` : ''];
    return parts.join('') || '--';
  }
  if (conn.connectionType === 'FILE_STORAGE') {
    if (c.storageType === 'LOCAL') {
      return c.originalFileName
        ? `LOCAL://${c.originalFileName} (${formatBytes(c.fileSize)})`
        : 'LOCAL (no file uploaded)';
    }
    return c.bucket ? `${c.storageType || ''}://${c.bucket}${c.path ? '/' + c.path : ''}` : '--';
  }
  if (conn.connectionType === 'API') return c.baseUrl || '--';
  if (conn.connectionType === 'DATA_WAREHOUSE') {
    return c.account ? `${c.warehouseType || ''}://${c.account}${c.warehouse ? '/' + c.warehouse : ''}` : '--';
  }
  if (conn.connectionType === 'SPREADSHEET') return c.documentUrl || '--';
  return '--';
}

function timeAgo(iso: string | null): string {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ConnColId = 'system' | 'name' | 'type' | 'config' | 'status' | 'lastTested';
const CONN_COLUMN_DEFS: Array<{ id: ConnColId; label: string; defaultVisible: boolean }> = [
  { id: 'system',     label: 'System',         defaultVisible: true  },
  { id: 'name',       label: 'Connection Name',defaultVisible: true  },
  { id: 'type',       label: 'Type',           defaultVisible: true  },
  { id: 'config',     label: 'Config',         defaultVisible: false },
  { id: 'status',     label: 'Status',         defaultVisible: true  },
  { id: 'lastTested', label: 'Last Tested',    defaultVisible: true  },
];

export default function ConnectionsPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [searchParams, setSearchParams] = useSearchParams();
  // System filter read from / synced to the URL so Systems-tab shortcuts
  // (`?systemId=<id>`) and in-page dropdown changes share a single source
  // of truth.
  const systemFilter = searchParams.get('systemId') || '';
  const setSystemFilter = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('systemId', next); else params.delete('systemId');
    params.delete('open');
    setSearchParams(params, { replace: true });
  };

  const connCols = useColumnPicker<ConnColId>('procela.connections.visibleCols.v1', CONN_COLUMN_DEFS);
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [systems, setSystems] = useState<SystemEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  // Local-file upload staging — the File is attached to the form but not sent
  // until Save (we need the connection id the POST/PUT returns).
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [discoveredAssets, setDiscoveredAssets] = useState<DiscoveredAsset[]>([]);
  const [discoverModal, setDiscoverModal] = useState<{ connId: string; systemId: string; systemName: string } | null>(null);
  const [formTestResult, setFormTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [formTesting, setFormTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterConnType, setFilterConnType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Which assets in the Discover modal are expanded to show their columns.
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());

  // Connection type options from server
  const [connectionTypes, setConnectionTypes] = useState<string[]>([]);
  const [dbTypes, setDbTypes] = useState<string[]>([]);
  const [storageTypes, setStorageTypes] = useState<string[]>([]);
  const [authTypes, setAuthTypes] = useState<string[]>([]);
  const [warehouseTypes, setWarehouseTypes] = useState<string[]>([]);

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [connRes, sysRes] = await Promise.all([
        apiClient.get<{
          success: boolean;
          data: ConnectionProfile[];
          connectionTypes: string[];
          dbTypes: string[];
          storageTypes: string[];
          authTypes: string[];
          warehouseTypes: string[];
        }>(`/connections${query}`),
        apiClient.get<{ success: boolean; data: SystemEntity[] }>(`/systems${query}`),
      ]);
      setConnections(connRes.data || []);
      setConnectionTypes(connRes.connectionTypes || []);
      setDbTypes(connRes.dbTypes || []);
      setStorageTypes(connRes.storageTypes || []);
      setAuthTypes(connRes.authTypes || []);
      setWarehouseTypes(connRes.warehouseTypes || []);
      setSystems(sysRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  usePolling(fetchData, 30000);

  // When we arrive with `?open=1`, auto-open the Add form with the system
  // pre-selected (from `?systemId=`). We clear `open` afterwards so a page
  // reload doesn't re-trigger the form.
  useEffect(() => {
    if (searchParams.get('open') === '1') {
      const sid = searchParams.get('systemId') || '';
      setForm({ ...emptyForm, systemIds: sid ? [sid] : [] });
      setEditingId(null);
      setShowForm(true);
      const params = new URLSearchParams(searchParams);
      params.delete('open');
      setSearchParams(params, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  const openAdd = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; } setFormTestResult(null);
    // Pre-fill systemIds from the active filter so "+ Add Connection" under a
    // System filter keeps the user's context.
    setForm({ ...emptyForm, systemIds: systemFilter ? [systemFilter] : [] });
    setEditingId(null);
    setPendingFile(null);
    setShowForm(true);
  };

  const openEdit = (conn: ConnectionProfile) => {
    setForm({
      name: conn.name,
      systemIds: conn.systemIds && conn.systemIds.length > 0
        ? [...conn.systemIds]
        : (conn.systemId ? [conn.systemId] : []),
      connectionType: conn.connectionType,
      config: { ...conn.config },
      credentials: { ...conn.credentials },
    });
    setEditingId(conn.id);
    setPendingFile(null);
    setShowForm(true);
  };

  // Duplicate — pre-fills the create form with the source's values,
  // nudges the name with a "(copy)" suffix so the user isn't forced
  // to pick something unique immediately.
  const openDuplicate = (conn: ConnectionProfile) => {
    setForm({
      name: `${conn.name} (copy)`,
      systemIds: conn.systemIds && conn.systemIds.length > 0
        ? [...conn.systemIds]
        : (conn.systemId ? [conn.systemId] : []),
      connectionType: conn.connectionType,
      config: { ...conn.config },
      credentials: { ...conn.credentials },
    });
    setEditingId(null);
    setPendingFile(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!form.name.trim()) return;
    try {
      setUploading(!!pendingFile);
      let savedId: string | null = editingId;
      if (editingId) {
        await apiClient.put(`/connections/${editingId}`, form);
        addToast('success', 'Connection profile updated');
      } else {
        // New connections don't have an id yet; grab it from the response so
        // a staged local file can be uploaded against the right profile.
        const res = await apiClient.post<{ success: boolean; data: ConnectionProfile }>(
          '/connections',
          { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) },
        );
        savedId = res.data?.id || null;
        addToast('success', 'Connection profile created');
      }

      // Upload the staged file for LOCAL file-storage connections after the
      // profile exists, so the backend has an id to key the upload dir on.
      if (pendingFile && savedId && form.connectionType === 'FILE_STORAGE' && form.config.storageType === 'LOCAL') {
        try {
          const uploadRes = await apiClient.upload<{ success: boolean; data: { parseError: string | null } }>(
            `/connections/${savedId}/upload`,
            pendingFile,
          );
          if (uploadRes.data?.parseError) {
            addToast('error', `File saved but parse failed: ${uploadRes.data.parseError}`);
          } else {
            addToast('success', `Uploaded ${pendingFile.name}`);
          }
        } catch (e) {
          addToast('error', e instanceof Error ? e.message : 'Upload failed');
        }
      }

      setShowForm(false); setEditingId(null); setForm(emptyForm); setPendingFile(null);
      // After adding a new connection, drop the user back on the unfiltered
      // default view so the row they just created is visible regardless of
      // any system/type filter that was active during creation.
      if (!editingId) {
        setSearchParams(new URLSearchParams(), { replace: true });
        setFilterConnType('');
      }
      fetchData();
      return savedId;
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Save failed');
    } finally {
      setUploading(false);
    }
  };

  const handleTest = async () => {
    if (!form.name.trim()) return;
    setFormTesting(true);
    setFormTestResult(null);
    try {
      // Pre-save LOCAL file upload: send the staged file bytes to a
      // dedicated test endpoint that parses against an OS tmp file and
      // immediately deletes it, so the user can validate the file
      // without needing to Save first.
      const useStagedTest =
        form.connectionType === 'FILE_STORAGE' &&
        form.config.storageType === 'LOCAL' &&
        !!pendingFile;
      const res = useStagedTest
        ? await apiClient.upload<{ success: boolean; data: { success: boolean; message: string } }>(
            // apiClient.upload appends ?filename=… automatically; passing
            // it again here would produce a duplicate param that the
            // backend rejects with 400.
            '/connections/test-file',
            pendingFile!,
          )
        : await apiClient.post<{ success: boolean; data: { success: boolean; message: string } }>(
            '/connections/test',
            {
              ...(editingId ? { id: editingId } : {}),
              connectionType: form.connectionType,
              config: form.config,
              credentials: form.credentials,
            },
          );
      setFormTestResult({ success: res.data.success, message: res.data.message });
      if (res.data.success) {
        addToast('success', `Test passed: ${res.data.message}`);
      } else {
        addToast('error', `Test failed: ${res.data.message}`);
      }
    } catch (err: any) {
      const detail = err?.message && err.message !== 'Connection test failed' ? `: ${err.message}` : '';
      setFormTestResult({ success: false, message: `Connection test failed${detail}` });
      addToast('error', `Connection test failed${detail}`);
    } finally {
      setFormTesting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/connections/${id}`);
      addToast('success', 'Connection deleted');
      fetchData();
    } catch { addToast('error', 'Delete failed'); }
  };

  // ── Bulk select handlers ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => apiClient.delete(`/connections/${id}`)));
      addToast('success', `Deleted ${selectedIds.size} connections`);
      setSelectedIds(new Set());
      fetchData();
    } catch { addToast('error', 'Bulk delete failed'); }
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); setPendingFile(null); setFormTestResult(null); };

  // -----------------------------------------------------------------------
  // Test
  // -----------------------------------------------------------------------

  const handleRowTest = async (id: string) => {
    setTestingIds((prev) => new Set(prev).add(id));
    try {
      const res = await apiClient.post<{ success: boolean; data: { success: boolean; message: string; latencyMs: number; profile: ConnectionProfile } }>(`/connections/${id}/test`);
      if (res.data.success) {
        addToast('success', `Connected: ${res.data.message}`);
      } else {
        addToast('error', `Failed: ${res.data.message}`);
      }
      fetchData();
    } catch (err: any) {
      // Surface the backend's actual reason instead of a generic toast.
      // The ApiError carries the parsed `error` field from the response.
      const detail = err?.message && err.message !== 'Connection test failed' ? `: ${err.message}` : '';
      addToast('error', `Connection test failed${detail}`);
      fetchData();
    } finally {
      setTestingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  // -----------------------------------------------------------------------
  // Discover
  // -----------------------------------------------------------------------

  const handleDiscover = async (conn: ConnectionProfile) => {
    // Discovery surfaces assets under one system; if a connection serves
    // multiple, pick the first link as the default landing spot.
    const ids = conn.systemIds && conn.systemIds.length > 0 ? conn.systemIds : (conn.systemId ? [conn.systemId] : []);
    const primaryId = ids[0] || '';
    const sys = systems.find((s) => s.id === primaryId);
    setDiscoverModal({ connId: conn.id, systemId: primaryId, systemName: sys?.name || 'Unknown System' });
    setDiscoveringId(conn.id);
    setDiscoveredAssets([]);
    try {
      const res = await apiClient.post<{ success: boolean; data: { success: boolean; details?: { assets?: DiscoveredAsset[] } } }>(`/connections/${conn.id}/discover`);
      setDiscoveredAssets(res.data.details?.assets || []);
    } catch {
      addToast('error', 'Discovery failed');
      setDiscoverModal(null);
    } finally {
      setDiscoveringId(null);
    }
  };

  // Note: the Discover modal is informational only now. Creating Data
  // Assets + binding them to a column happens from DataAssetsPage via
  // the Link flow, so there's no import/select shortcut here anymore.

  const toggleAssetExpanded = (assetName: string) => {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetName)) next.delete(assetName); else next.add(assetName);
      return next;
    });
  };

  // -----------------------------------------------------------------------
  // Filtering + Stats
  // -----------------------------------------------------------------------

  // Stats and the table both operate on the system-filtered view so the
  // numbers line up with what the user is looking at.
  const visibleConnections = connections.filter((c) => {
    if (systemFilter) {
      const ids = c.systemIds && c.systemIds.length > 0 ? c.systemIds : (c.systemId ? [c.systemId] : []);
      if (!ids.includes(systemFilter)) return false;
    }
    if (filterConnType && c.connectionType !== filterConnType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const sysName = systems.find((s) => s.id === c.systemId)?.name || '';
      if (
        !c.name.toLowerCase().includes(q) &&
        !sysName.toLowerCase().includes(q) &&
        !(c.connectionType || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });
  const connectedCount = visibleConnections.filter((c) => c.status === 'CONNECTED').length;
  const errorCount = visibleConnections.filter((c) => c.status === 'ERROR' || c.status === 'DISCONNECTED').length;
  const untestedCount = visibleConnections.filter((c) => c.status === 'UNTESTED').length;
  const filterSystem = systemFilter ? systems.find((s) => s.id === systemFilter) : null;

  // Sort: comparators keyed by column name; URL persists ?sort=&dir=
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    visibleConnections,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      connectionType: (a, b) => a.connectionType.localeCompare(b.connectionType),
      status: (a, b) => a.status.localeCompare(b.status),
    },
    'name',
    'asc',
    'c_',
  );

  // -----------------------------------------------------------------------
  // Form fields by connection type
  // -----------------------------------------------------------------------

  const updateConfig = (key: string, value: any) => setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));
  const updateCreds = (key: string, value: any) => setForm((f) => ({ ...f, credentials: { ...f.credentials, [key]: value } }));

  const renderTypeFields = () => {
    const fieldRow = (label: string, content: React.ReactNode, fullWidth = false) => (
      <div style={fullWidth ? { gridColumn: '1 / -1' } : undefined}>
        <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>{label}</label>
        {content}
      </div>
    );

    switch (form.connectionType) {
      case 'DATABASE':
        return (
          <>
            {fieldRow('Database Type', (
              <select style={selectStyle} value={form.config.dbType || ''} onChange={(e) => updateConfig('dbType', e.target.value)}>
                <option value="">-- Select --</option>
                {dbTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ))}
            {fieldRow('Host', <input style={inputStyle} value={form.config.host || ''} onChange={(e) => updateConfig('host', e.target.value)} placeholder="e.g. db.example.com" />)}
            {fieldRow('Port', <input style={inputStyle} type="number" value={form.config.port || ''} onChange={(e) => updateConfig('port', e.target.value ? parseInt(e.target.value) : '')} placeholder="e.g. 5432" />)}
            {fieldRow('Database', <input style={inputStyle} value={form.config.database || ''} onChange={(e) => updateConfig('database', e.target.value)} placeholder="e.g. production_db" />)}
            {fieldRow('Schema', <input style={inputStyle} value={form.config.schema || ''} onChange={(e) => updateConfig('schema', e.target.value)} placeholder="e.g. public" />)}
            {fieldRow('Username', <input style={inputStyle} value={form.credentials.username || ''} onChange={(e) => updateCreds('username', e.target.value)} placeholder="Database username" />)}
            {fieldRow('Password', <input style={inputStyle} type="password" value={form.credentials.password || ''} onChange={(e) => updateCreds('password', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'Database password'} />)}
          </>
        );

      case 'FILE_STORAGE': {
        const isLocal = form.config.storageType === 'LOCAL';
        const existingFile = form.config.originalFileName;
        return (
          <>
            {fieldRow('Storage Type', (
              <select style={selectStyle} value={form.config.storageType || ''} onChange={(e) => updateConfig('storageType', e.target.value)}>
                <option value="">-- Select --</option>
                {storageTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ))}
            {isLocal ? (
              fieldRow('File', (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      id="local-file-input"
                      type="file"
                      accept=".csv,.tsv,.json,.jsonl,.ndjson,text/csv,application/json"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setPendingFile(f);
                        // Reset the input so picking the same file again re-fires onChange.
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      style={{ ...btnSecondary, padding: '6px 12px', fontSize: 12 }}
                      onClick={() => document.getElementById('local-file-input')?.click()}
                    >
                      {pendingFile || existingFile ? 'Choose Different File' : 'Browse\u2026'}
                    </button>
                    {pendingFile ? (
                      <span style={{ fontSize: 12, color: 'var(--color-text)' }}>
                        <strong>{pendingFile.name}</strong> ({formatBytes(pendingFile.size)})
                        <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>— will upload on Save</span>
                      </span>
                    ) : existingFile ? (
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        Current: <strong>{existingFile}</strong>
                        {form.config.fileSize != null && ` (${formatBytes(form.config.fileSize)})`}
                        {form.config.rowCount != null && ` — ${form.config.rowCount.toLocaleString()} rows`}
                        {form.config.columns && form.config.columns.length > 0 && ` × ${form.config.columns.length} columns`}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No file selected yet. CSV, TSV, JSON, JSONL up to 50 MB.</span>
                    )}
                  </div>
                  {form.config.columns && form.config.columns.length > 0 && !pendingFile && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Columns: {form.config.columns.slice(0, 10).join(', ')}{form.config.columns.length > 10 ? `, +${form.config.columns.length - 10} more` : ''}
                    </div>
                  )}
                </div>
              ), true)
            ) : (
              <>
                {fieldRow('Bucket / Container', <input style={inputStyle} value={form.config.bucket || ''} onChange={(e) => updateConfig('bucket', e.target.value)} placeholder="e.g. my-data-bucket" />)}
                {fieldRow('Path', <input style={inputStyle} value={form.config.path || ''} onChange={(e) => updateConfig('path', e.target.value)} placeholder="e.g. /data/exports" />)}
                {fieldRow('API Key / Access Key', <input style={inputStyle} type="password" value={form.credentials.apiKey || ''} onChange={(e) => updateCreds('apiKey', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'Access key'} />)}
              </>
            )}
          </>
        );
      }

      case 'API':
        return (
          <>
            {fieldRow('Base URL', <input style={inputStyle} value={form.config.baseUrl || ''} onChange={(e) => updateConfig('baseUrl', e.target.value)} placeholder="e.g. https://api.example.com" />, true)}
            {fieldRow('Auth Type', (
              <select style={selectStyle} value={form.config.authType || 'NONE'} onChange={(e) => updateConfig('authType', e.target.value)}>
                {authTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ))}
            {(form.config.authType === 'API_KEY') && fieldRow('API Key', <input style={inputStyle} type="password" value={form.credentials.apiKey || ''} onChange={(e) => updateCreds('apiKey', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'API key'} />)}
            {(form.config.authType === 'OAUTH2') && fieldRow('Token', <input style={inputStyle} type="password" value={form.credentials.token || ''} onChange={(e) => updateCreds('token', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'OAuth2 token'} />)}
            {(form.config.authType === 'BASIC') && (
              <>
                {fieldRow('Username', <input style={inputStyle} value={form.credentials.username || ''} onChange={(e) => updateCreds('username', e.target.value)} placeholder="Username" />)}
                {fieldRow('Password', <input style={inputStyle} type="password" value={form.credentials.password || ''} onChange={(e) => updateCreds('password', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'Password'} />)}
              </>
            )}
          </>
        );

      case 'DATA_WAREHOUSE':
        return (
          <>
            {fieldRow('Warehouse Type', (
              <select style={selectStyle} value={form.config.warehouseType || ''} onChange={(e) => updateConfig('warehouseType', e.target.value)}>
                <option value="">-- Select --</option>
                {warehouseTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ))}
            {fieldRow('Account', <input style={inputStyle} value={form.config.account || ''} onChange={(e) => updateConfig('account', e.target.value)} placeholder="e.g. org-account.snowflakecomputing.com" />)}
            {fieldRow('Warehouse', <input style={inputStyle} value={form.config.warehouse || ''} onChange={(e) => updateConfig('warehouse', e.target.value)} placeholder="e.g. COMPUTE_WH" />)}
            {fieldRow('Username', <input style={inputStyle} value={form.credentials.username || ''} onChange={(e) => updateCreds('username', e.target.value)} placeholder="Username" />)}
            {fieldRow('Password', <input style={inputStyle} type="password" value={form.credentials.password || ''} onChange={(e) => updateCreds('password', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'Password'} />)}
          </>
        );

      case 'SPREADSHEET':
        return (
          <>
            {fieldRow('Spreadsheet Type', (
              <select style={selectStyle} value={form.config.spreadsheetType || ''} onChange={(e) => updateConfig('spreadsheetType', e.target.value)}>
                <option value="">-- Select --</option>
                <option value="SHAREPOINT">SharePoint</option>
                <option value="GOOGLE_SHEETS">Google Sheets</option>
              </select>
            ))}
            {fieldRow('Document URL', <input style={inputStyle} value={form.config.documentUrl || ''} onChange={(e) => updateConfig('documentUrl', e.target.value)} placeholder="e.g. https://docs.google.com/spreadsheets/d/..." />, true)}
            {fieldRow('Token / API Key', <input style={inputStyle} type="password" value={form.credentials.token || ''} onChange={(e) => updateCreds('token', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'Auth token'} />)}
          </>
        );

      default:
        return null;
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const systemNameMap: Record<string, string> = {};
  systems.forEach((s) => { systemNameMap[s.id] = s.name; });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Connections</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {filterSystem
              ? <>Showing connections for <strong>{filterSystem.name}</strong>. <button onClick={() => setSystemFilter('')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: 0, fontSize: 13, textDecoration: 'underline' }}>Show all</button></>
              : 'Connect to external data sources. Test verifies reachability (TCP or HTTP probe); credential validation happens when real drivers are wired in.'}
          </p>
          {connections.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <span>{connections.length} connections</span>
              <span style={{ color: 'var(--color-border)' }}>&middot;</span>
              <span>{connectedCount} connected</span>
              {errorCount > 0 && <><span style={{ color: 'var(--color-border)' }}>&middot;</span><span style={{ color: '#dc2626' }}>{errorCount} error</span></>}
              {untestedCount > 0 && <><span style={{ color: 'var(--color-border)' }}>&middot;</span><span>{untestedCount} untested</span></>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <ColumnPicker state={connCols} />
          <IconButton icon="plus" label="Add connection" variant="primary" onClick={openAdd} />
        </div>
      </div>

      {/* Two-column layout: Type sidebar + content */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Connection Types Sidebar */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 10,
          position: 'sticky',
          top: 12,
          maxHeight: 'calc(100vh - 180px)',
          overflowY: 'auto',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, padding: '0 4px' }}>
            Connection Types
          </div>
          <div
            onClick={() => setFilterConnType('')}
            style={{
              padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
              fontWeight: !filterConnType ? 600 : 400,
              background: !filterConnType ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
              color: !filterConnType ? 'var(--color-primary)' : 'var(--color-text)',
            }}
            onMouseEnter={(e) => { if (filterConnType) e.currentTarget.style.background = 'var(--color-bg)'; }}
            onMouseLeave={(e) => { if (filterConnType) e.currentTarget.style.background = 'transparent'; }}
          >
            All Connections ({connections.length})
          </div>
          {connectionTypes.map((t) => {
            const count = connections.filter((c) => c.connectionType === t).length;
            if (count === 0) return null;
            const isActive = filterConnType === t;
            const label = t.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
            return (
              <div
                key={t}
                onClick={() => setFilterConnType(isActive ? '' : t)}
                style={{
                  padding: '5px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer', marginBottom: 2,
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--color-primary-light, #dbeafe)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span>{label}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg)', padding: '0 5px', borderRadius: 8, fontWeight: 500 }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Content Area */}
        <div>
          {/* Filters (left-aligned, mirrors Data Assets) */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 200 }}>
              <input
                type="text"
                placeholder="Search connections..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && searchQuery) setSearchQuery(''); }}
                style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 28px 5px 10px', fontSize: 12, background: 'var(--color-surface)', width: '100%', boxSizing: 'border-box' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                  style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1,
                    padding: '2px 6px', borderRadius: 3,
                  }}
                >
                  &times;
                </button>
              )}
            </div>
            <select style={{ ...selectStyle, width: 'auto', minWidth: 160 }} value={systemFilter} onChange={(e) => setSystemFilter(e.target.value)}>
              <option value="">All Systems</option>
              {systems.map((s) => <option key={s.id} value={s.id}>{s.name}{s.systemType ? ` (${s.systemType})` : ''}</option>)}
            </select>
            {(searchQuery || systemFilter || filterConnType) && (
              <>
                <button
                  onClick={() => { setSearchQuery(''); setSystemFilter(''); setFilterConnType(''); }}
                  style={{ ...btnSecondary, padding: '5px 12px', fontSize: 12 }}
                >
                  Clear Filters
                </button>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  Showing {visibleConnections.length} of {connections.length}
                </span>
              </>
            )}
          </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Connection' : 'Add New Connection'}
          </h3>

          {/* Core fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Connection Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Production DB, CRM API" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                Systems
                <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                  one or more — leave empty if not yet assigned
                </span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6, minHeight: 24 }}>
                {form.systemIds.length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                    No systems linked yet.
                  </span>
                )}
                {form.systemIds.map((sid) => {
                  const s = systems.find((sys) => sys.id === sid);
                  return (
                    <span key={sid} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                      background: '#dbeafe', color: '#1e40af',
                    }}>
                      {s?.name || sid}
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, systemIds: form.systemIds.filter((id) => id !== sid) })}
                        aria-label={`Remove ${s?.name || sid}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 14, lineHeight: 1 }}
                      >
                        &times;
                      </button>
                    </span>
                  );
                })}
              </div>
              <select
                style={selectStyle}
                value=""
                onChange={(e) => {
                  const sid = e.target.value;
                  if (sid && !form.systemIds.includes(sid)) {
                    setForm({ ...form, systemIds: [...form.systemIds, sid] });
                  }
                }}
              >
                <option value="">-- Add a system --</option>
                {systems
                  .filter((s) => !form.systemIds.includes(s.id))
                  .map((s) => <option key={s.id} value={s.id}>{s.name}{s.systemType ? ` (${s.systemType})` : ''}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Connection Type *</label>
              <select
                style={selectStyle}
                value={form.connectionType}
                onChange={(e) => setForm({ ...form, connectionType: e.target.value, config: {}, credentials: {} })}
              >
                {(connectionTypes.length > 0 ? connectionTypes : ['DATABASE', 'FILE_STORAGE', 'API', 'DATA_WAREHOUSE', 'SPREADSHEET']).map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Type-specific fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, padding: 16, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {TYPE_LABELS[form.connectionType] || form.connectionType} Configuration
            </div>
            {renderTypeFields()}
          </div>

          {/* Test result */}
          {formTestResult && (
            <div style={{
              marginBottom: 12, padding: '10px 14px', borderRadius: 'var(--radius-md)',
              background: formTestResult.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${formTestResult.success ? '#86efac' : '#fca5a5'}`,
              fontSize: 13, color: formTestResult.success ? '#166534' : '#991b1b',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 16 }}>{formTestResult.success ? '\u2713' : '\u2717'}</span>
              {formTestResult.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel} disabled={uploading || formTesting}>Cancel</button>
            <button
              style={{ ...btnSecondary, opacity: !form.name.trim() || uploading || formTesting ? 0.6 : 1, cursor: !form.name.trim() || uploading || formTesting ? 'not-allowed' : 'pointer' }}
              disabled={!form.name.trim() || uploading || formTesting}
              title={!form.name.trim() ? 'Enter a connection name first.' : ''}
              onClick={handleTest}
            >
              {formTesting ? 'Testing\u2026' : 'Test'}
            </button>
            <button
              style={{ ...btnPrimary, opacity: !form.name.trim() || uploading ? 0.6 : 1, cursor: !form.name.trim() || uploading ? 'not-allowed' : 'pointer' }}
              disabled={!form.name.trim() || uploading}
              onClick={handleSave}
            >
              {uploading ? 'Uploading\u2026' : editingId ? 'Save Changes' : 'Add Connection'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Connection?"
        message="This will permanently delete this connection profile. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Selected Connections?"
        message={`Delete ${selectedIds.size} selected connections? This cannot be undone.`}
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

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
        {loading ? (
          <SkeletonRows rows={5} columns={4} />
        ) : visibleConnections.length === 0 && !showForm ? (
          <EmptyState
            icon={'\u26A1'}
            title={filterSystem ? `No connections for ${filterSystem.name} yet` : 'No connections configured yet'}
            description="Connections are the bridge between a system and its actual data — a database, a file, a warehouse. Add one, test it, and then discover and link assets from it."
            action={{ label: '+ Add Connection', onClick: openAdd }}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 32, textAlign: 'center' }}>
                  <input type="checkbox"
                    checked={visibleConnections.length > 0 && selectedIds.size === visibleConnections.length}
                    onChange={() => {
                      if (selectedIds.size === visibleConnections.length) setSelectedIds(new Set());
                      else setSelectedIds(new Set(visibleConnections.map((c) => c.id)));
                    }} />
                </th>
                {connCols.isVisible('system') && <th style={thStyle}>System</th>}
                {connCols.isVisible('name') && <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Connection Name</SortableTh>}
                {connCols.isVisible('type') && <SortableTh sortKey="connectionType" active={sortKey} dir={sortDir} onClick={toggleSort}>Type</SortableTh>}
                {connCols.isVisible('config') && <th style={thStyle}>Config</th>}
                {connCols.isVisible('status') && <SortableTh sortKey="status" active={sortKey} dir={sortDir} onClick={toggleSort}>Status</SortableTh>}
                {connCols.isVisible('lastTested') && <th style={thStyle}>Last Tested</th>}
                <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((conn) => {
                const statusBadge = STATUS_BADGES[conn.status] || STATUS_BADGES.UNTESTED;
                const typeBadge = TYPE_BADGES[conn.connectionType] || TYPE_BADGES.DATABASE;
                const isTesting = testingIds.has(conn.id);
                const isSelected = selectedIds.has(conn.id);

                return (
                  <tr
                    key={conn.id}
                    style={{ transition: 'background 0.1s', background: isSelected ? '#f0f9ff' : '' }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
                  >
                    <td style={{ ...tdStyle, textAlign: 'center', width: 32 }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(conn.id)} />
                    </td>
                    {connCols.isVisible('system') && (
                      <td style={{ ...tdStyle, fontWeight: 500 }}>
                        {(() => {
                          const ids = conn.systemIds && conn.systemIds.length > 0
                            ? conn.systemIds
                            : (conn.systemId ? [conn.systemId] : []);
                          if (ids.length === 0) {
                            return <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Unassigned</span>;
                          }
                          const names = ids.map((id) => systemNameMap[id]).filter(Boolean);
                          if (names.length === 0) return <span style={{ color: 'var(--color-text-muted)' }}>--</span>;
                          if (names.length === 1) return names[0];
                          return (
                            <span title={names.join(', ')}>
                              {names[0]} <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>+{names.length - 1}</span>
                            </span>
                          );
                        })()}
                      </td>
                    )}
                    {connCols.isVisible('name') && <td style={{ ...tdStyle, fontWeight: 500 }}>{conn.name}</td>}
                    {connCols.isVisible('type') && (
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: typeBadge.bg, color: typeBadge.color }}>
                          {TYPE_LABELS[conn.connectionType] || conn.connectionType}
                        </span>
                      </td>
                    )}
                    {connCols.isVisible('config') && (
                      <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                        {configSummary(conn)}
                      </td>
                    )}
                    {connCols.isVisible('status') && (
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: statusBadge.bg, color: statusBadge.color }}>
                          {conn.status}
                        </span>
                      </td>
                    )}
                    {connCols.isVisible('lastTested') && (
                      <td style={{ ...tdStyle, color: 'var(--color-text-muted)', fontSize: 12 }}>
                        {timeAgo(conn.lastTestedAt)}
                      </td>
                    )}
                    <td style={{ ...tdStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <IconButton size="sm" icon={isTesting ? 'refresh' : 'play'}
                          label={isTesting ? 'Testing...' : 'Test connection'}
                          disabled={isTesting}
                          onClick={() => !isTesting && handleRowTest(conn.id)} />
                        {conn.status === 'CONNECTED' && (
                          <IconButton size="sm" icon="search" label="Discover assets" onClick={() => handleDiscover(conn)} />
                        )}
                        <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(conn)} />
                        <IconButton size="sm" icon="copy" label="Duplicate" onClick={() => openDuplicate(conn)} />
                        <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(conn.id)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Discover Modal */}
      {discoverModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
          onClick={() => { setDiscoverModal(null); setDiscoveredAssets([]); setExpandedAssets(new Set()); }}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', padding: 24, maxWidth: 640, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Discovered Assets — {discoverModal.systemName}</h3>
              <button
                onClick={() => { setDiscoverModal(null); setDiscoveredAssets([]); setExpandedAssets(new Set()); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)', padding: '0 4px' }}
              >
                &times;
              </button>
            </div>

            {discoveringId ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                Discovering assets...
              </div>
            ) : discoveredAssets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                No assets discovered.
              </div>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  {'Click an asset to drill into its columns. To link a column to a Data Asset, go to Data Assets \u2192 Link.'}
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg)' }}>
                      <th style={{ ...thStyle, width: 28 }}></th>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Rows</th>
                      <th style={thStyle}>Columns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discoveredAssets.map((asset) => {
                      const isExpanded = expandedAssets.has(asset.name);
                      const columns = asset.columns || [];
                      const hasColumns = columns.length > 0;
                      return (
                        <React.Fragment key={asset.name}>
                          <tr
                            onClick={() => hasColumns && toggleAssetExpanded(asset.name)}
                            style={{ cursor: hasColumns ? 'pointer' : 'default' }}
                          >
                            <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 10, userSelect: 'none' }}>
                              {hasColumns ? (isExpanded ? '\u25BC' : '\u25B6') : ''}
                            </td>
                            <td style={{ ...tdStyle, fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{asset.name}</td>
                            <td style={tdStyle}>
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: '#f1f5f9', color: '#64748b' }}>
                                {asset.type}
                              </span>
                            </td>
                            <td style={{ ...tdStyle, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                              {asset.rowCount != null ? asset.rowCount.toLocaleString() : '--'}
                            </td>
                            <td style={{ ...tdStyle, fontSize: 12, color: 'var(--color-text-muted)' }}>
                              {hasColumns ? columns.length : '--'}
                            </td>
                          </tr>
                          {isExpanded && columns.map((col) => (
                            <tr key={`${asset.name}.${col}`} style={{ background: '#fafafa' }}>
                              <td style={{ ...tdStyle, border: 'none' }}></td>
                              <td
                                style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: 12, paddingLeft: 24, color: 'var(--color-text)', border: 'none' }}
                                colSpan={4}
                              >
                                <span style={{ color: 'var(--color-text-muted)', marginRight: 6 }}>{'\u21B3'}</span>
                                <strong>{col}</strong>
                                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>column</span>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={btnSecondary} onClick={() => { setDiscoverModal(null); setDiscoveredAssets([]); }}>Close</button>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
