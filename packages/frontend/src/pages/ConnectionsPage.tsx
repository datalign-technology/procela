import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { usePolling } from '../hooks/usePolling';
import ConfirmDialog from '../components/ConfirmDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionProfile {
  id: string;
  orgId: string;
  systemId: string;
  name: string;
  connectionType: string;
  config: Record<string, any>;
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
  systemId: string;
  connectionType: string;
  config: Record<string, any>;
  credentials: Record<string, any>;
}

const emptyForm: FormData = {
  name: '', systemId: '', connectionType: 'DATABASE',
  config: {}, credentials: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configSummary(conn: ConnectionProfile): string {
  const c = conn.config;
  if (conn.connectionType === 'DATABASE') {
    const parts = [c.host, c.port ? `:${c.port}` : '', c.database ? `/${c.database}` : ''];
    return parts.join('') || '--';
  }
  if (conn.connectionType === 'FILE_STORAGE') {
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

export default function ConnectionsPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);

  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [systems, setSystems] = useState<SystemEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [discoveredAssets, setDiscoveredAssets] = useState<DiscoveredAsset[]>([]);
  const [discoverModal, setDiscoverModal] = useState<{ connId: string; systemId: string; systemName: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [importingAsset, setImportingAsset] = useState<string | null>(null);

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

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };

  const openEdit = (conn: ConnectionProfile) => {
    setForm({
      name: conn.name,
      systemId: conn.systemId,
      connectionType: conn.connectionType,
      config: { ...conn.config },
      credentials: { ...conn.credentials },
    });
    setEditingId(conn.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingId) {
        await apiClient.put(`/connections/${editingId}`, form);
        addToast('success', 'Connection profile updated');
      } else {
        await apiClient.post('/connections', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) });
        addToast('success', 'Connection profile created');
      }
      setShowForm(false); setEditingId(null); setForm(emptyForm); fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Save failed');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/connections/${id}`);
      addToast('success', 'Connection deleted');
      fetchData();
    } catch { addToast('error', 'Delete failed'); }
  };

  const handleDeleteAll = async () => {
    try {
      await apiClient.delete('/connections/all');
      addToast('success', 'All connections deleted');
      fetchData();
    } catch { addToast('error', 'Delete all failed'); }
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  // -----------------------------------------------------------------------
  // Test
  // -----------------------------------------------------------------------

  const handleTest = async (id: string) => {
    setTestingIds((prev) => new Set(prev).add(id));
    try {
      const res = await apiClient.post<{ success: boolean; data: { success: boolean; message: string; latencyMs: number; profile: ConnectionProfile } }>(`/connections/${id}/test`);
      if (res.data.success) {
        addToast('success', `Connected: ${res.data.message}`);
      } else {
        addToast('error', `Failed: ${res.data.message}`);
      }
      fetchData();
    } catch {
      addToast('error', 'Connection test failed');
      fetchData();
    } finally {
      setTestingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  // -----------------------------------------------------------------------
  // Discover
  // -----------------------------------------------------------------------

  const handleDiscover = async (conn: ConnectionProfile) => {
    const sys = systems.find((s) => s.id === conn.systemId);
    setDiscoverModal({ connId: conn.id, systemId: conn.systemId, systemName: sys?.name || 'Unknown System' });
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

  const handleImportAsDataAsset = async (asset: DiscoveredAsset) => {
    if (!discoverModal) return;
    setImportingAsset(asset.name);
    try {
      await apiClient.post('/data-assets', {
        name: asset.name,
        description: `Discovered ${asset.type.toLowerCase()} from ${discoverModal.systemName}${asset.rowCount ? ` (${asset.rowCount.toLocaleString()} rows)` : ''}`,
        systemId: discoverModal.systemId,
        governanceTier: 'BRONZE',
        healthScore: 50,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      });
      addToast('success', `Imported "${asset.name}" as data asset`);
    } catch {
      addToast('error', `Failed to import "${asset.name}"`);
    } finally {
      setImportingAsset(null);
    }
  };

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  const connectedCount = connections.filter((c) => c.status === 'CONNECTED').length;
  const errorCount = connections.filter((c) => c.status === 'ERROR' || c.status === 'DISCONNECTED').length;
  const untestedCount = connections.filter((c) => c.status === 'UNTESTED').length;

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

      case 'FILE_STORAGE':
        return (
          <>
            {fieldRow('Storage Type', (
              <select style={selectStyle} value={form.config.storageType || ''} onChange={(e) => updateConfig('storageType', e.target.value)}>
                <option value="">-- Select --</option>
                {storageTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ))}
            {fieldRow('Bucket / Container', <input style={inputStyle} value={form.config.bucket || ''} onChange={(e) => updateConfig('bucket', e.target.value)} placeholder="e.g. my-data-bucket" />)}
            {fieldRow('Path', <input style={inputStyle} value={form.config.path || ''} onChange={(e) => updateConfig('path', e.target.value)} placeholder="e.g. /data/exports" />)}
            {fieldRow('API Key / Access Key', <input style={inputStyle} type="password" value={form.credentials.apiKey || ''} onChange={(e) => updateCreds('apiKey', e.target.value)} placeholder={editingId ? '(unchanged if left blank)' : 'Access key'} />)}
          </>
        );

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
            Connect to external data sources to discover and import data assets.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {connections.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              style={{ ...btnSecondary, padding: '0.5rem 1rem', fontSize: '0.875rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
            >
              Delete All
            </button>
          )}
          <button onClick={openAdd} style={{ ...btnPrimary, padding: '0.5rem 1rem', fontSize: '0.875rem' }}>
            + Add Connection
          </button>
        </div>
      </div>

      {/* Stats */}
      {connections.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{connections.length}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Connections</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0f4f46' }}>{connectedCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Connected</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#9d174d' }}>{errorCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Error / Disconnected</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#92400e' }}>{untestedCount}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Untested</div>
          </div>
        </div>
      )}

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
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>System</label>
              <select style={selectStyle} value={form.systemId} onChange={(e) => setForm({ ...form, systemId: e.target.value })}>
                <option value="">-- Select system --</option>
                {systems.map((s) => <option key={s.id} value={s.id}>{s.name}{s.systemType ? ` (${s.systemType})` : ''}</option>)}
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

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }} disabled={!form.name.trim()} onClick={handleSave}>
              {editingId ? 'Save Changes' : 'Add Connection'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={showDeleteAll}
        title="Delete All Connections?"
        message={`This will permanently delete all ${connections.length} connection profiles. This cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={async () => { setShowDeleteAll(false); await handleDeleteAll(); }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete Connection?"
        message="This will permanently delete this connection profile. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => { const id = confirmDelete; setConfirmDelete(null); if (id) await handleDelete(id); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Table */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : connections.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>No connections configured yet.</p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Use the "+ Add Connection" button above to connect to your data sources.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={thStyle}>System</th>
                <th style={thStyle}>Connection Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Config</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last Tested</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => {
                const statusBadge = STATUS_BADGES[conn.status] || STATUS_BADGES.UNTESTED;
                const typeBadge = TYPE_BADGES[conn.connectionType] || TYPE_BADGES.DATABASE;
                const isTesting = testingIds.has(conn.id);

                return (
                  <tr
                    key={conn.id}
                    style={{ transition: 'background 0.1s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      {systemNameMap[conn.systemId] || <span style={{ color: 'var(--color-text-muted)' }}>--</span>}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{conn.name}</td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: typeBadge.bg, color: typeBadge.color }}>
                        {TYPE_LABELS[conn.connectionType] || conn.connectionType}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                      {configSummary(conn)}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: statusBadge.bg, color: statusBadge.color }}>
                        {conn.status}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {timeAgo(conn.lastTestedAt)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        style={{ background: 'none', border: 'none', cursor: isTesting ? 'default' : 'pointer', color: isTesting ? 'var(--color-text-muted)' : '#0f766e', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                        onClick={() => !isTesting && handleTest(conn.id)}
                        disabled={isTesting}
                        title="Test connection"
                      >
                        {isTesting ? 'Testing...' : 'Test'}
                      </button>
                      {conn.status === 'CONNECTED' && (
                        <button
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5b21b6', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                          onClick={() => handleDiscover(conn)}
                          title="Discover assets"
                        >
                          Discover
                        </button>
                      )}
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, padding: '2px 6px', marginRight: 4 }}
                        onClick={() => openEdit(conn)}
                      >
                        Edit
                      </button>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 12, padding: '2px 6px' }}
                        onClick={() => setConfirmDelete(conn.id)}
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

      {/* Discover Modal */}
      {discoverModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
          onClick={() => { setDiscoverModal(null); setDiscoveredAssets([]); }}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', padding: 24, maxWidth: 640, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Discovered Assets — {discoverModal.systemName}</h3>
              <button
                onClick={() => { setDiscoverModal(null); setDiscoveredAssets([]); }}
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
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)' }}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Rows</th>
                    <th style={thStyle}>Last Modified</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {discoveredAssets.map((asset) => (
                    <tr key={asset.name}>
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
                        {asset.lastModified ? timeAgo(asset.lastModified) : '--'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <button
                          style={{
                            ...btnPrimary,
                            padding: '4px 10px', fontSize: 11,
                            opacity: importingAsset === asset.name ? 0.6 : 1,
                          }}
                          disabled={importingAsset === asset.name}
                          onClick={() => handleImportAsDataAsset(asset)}
                        >
                          {importingAsset === asset.name ? 'Importing...' : 'Import as Data Asset'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={btnSecondary} onClick={() => { setDiscoverModal(null); setDiscoveredAssets([]); }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
