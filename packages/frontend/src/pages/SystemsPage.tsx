import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import { usePolling } from '../hooks/usePolling';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import SortableTh from '../components/SortableTh';
import { SkeletonRows } from '../components/Skeleton';
import { useSortedList } from '../hooks/useSortedList';
import { useToastStore } from '../stores/toastStore';

interface SystemEntity {
  id: string;
  name: string;
  description: string;
  systemType: string;
  createdAt: string;
  updatedAt: string;
}

interface ConnectionSummary {
  id: string;
  systemId: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'UNTESTED';
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

const typeBadge: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: 11, fontWeight: 500, background: 'var(--color-primary-light)', color: 'var(--color-primary)',
};

interface FormData {
  name: string;
  description: string;
  systemType: string;
}

const emptyForm: FormData = { name: '', description: '', systemType: '' };

export default function SystemsPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const [systems, setSystems] = useState<SystemEntity[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [systemTypes, setSystemTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [sysRes, connRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: SystemEntity[]; systemTypes: string[] }>(`/systems${query}`),
        // Connections power the per-row count + shortcut; this fetch is
        // best-effort — a failure here must not block the systems list.
        apiClient.get<{ success: boolean; data: ConnectionSummary[] }>(`/connections${query}`).catch(() => ({ data: [] as ConnectionSummary[] })),
      ]);
      setSystems(sysRes.data || []);
      setSystemTypes(sysRes.systemTypes || []);
      setConnections(connRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  usePolling(fetchData, 30000);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };

  const openEdit = (sys: SystemEntity) => {
    setForm({ name: sys.name, description: sys.description, systemType: sys.systemType });
    setEditingId(sys.id); setShowForm(true);
  };

  const handleSave = async (keepOpen: boolean = false) => {
    if (!form.name.trim()) return;
    if (editingId) { await apiClient.put(`/systems/${editingId}`, form); }
    else { await apiClient.post('/systems', { ...form, ...(activeOrgId ? { orgId: activeOrgId } : {}) }); }
    if (keepOpen && !editingId) {
      setForm(emptyForm);
      fetchData();
      return;
    }
    setShowForm(false); setEditingId(null); setForm(emptyForm); fetchData();
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/systems/${id}`); fetchData();
  };

  const handleCancel = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const handleImport = async () => {
    if (!importText.trim()) return;
    if (!activeOrgId) { alert('Select an organization from the "Working in" dropdown first.'); return; }
    try {
      const body: any = { orgId: activeOrgId };
      if (importFormat === 'csv') { body.csv = importText; } else { body.systems = JSON.parse(importText); }
      await apiClient.post('/systems/import', body);
      setShowImport(false); setImportText(''); fetchData();
    } catch (e) { alert(e instanceof Error ? e.message : 'Import failed'); }
  };

  const handleFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(reader.result as string);
      if (file.name.endsWith('.json')) setImportFormat('json');
      if (file.name.endsWith('.csv')) setImportFormat('csv');
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === systems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(systems.map((s) => s.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    // Snapshot the systems we're about to delete so we can offer Undo.
    const toDelete = systems.filter((s) => selectedIds.has(s.id));
    const count = toDelete.length;
    await Promise.all(toDelete.map((s) => apiClient.delete(`/systems/${s.id}`)));
    setSelectedIds(new Set());
    fetchData();
    addToast('success', `Deleted ${count} system${count === 1 ? '' : 's'}`, {
      action: {
        label: 'Undo',
        // Restore by POSTing each record back. Since deletes cascade
        // connections in some backends, Undo only revives the systems
        // themselves — callers can reconnect afterwards.
        handler: async () => {
          await Promise.all(toDelete.map((s) =>
            apiClient.post('/systems', {
              name: s.name, description: s.description, systemType: s.systemType,
              ...(activeOrgId ? { orgId: activeOrgId } : {}),
            }).catch(() => {}),
          ));
          fetchData();
          addToast('success', 'Restored.');
        },
      },
    });
  };

  // Sort: comparators keyed by column name; URL persists ?sort=&dir=
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    systems,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      type: (a, b) => (a.systemType || '').localeCompare(b.systemType || ''),
      description: (a, b) => (a.description || '').localeCompare(b.description || ''),
      updated: (a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt),
    },
    'name',
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Systems</h1>
            <Link to="/help" style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--color-text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }} title="Help">?</Link>
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Applications and platforms where your organization's data lives.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {systems.length > 0 && (
            <IconButton icon="trash" label="Delete all systems" variant="danger"
              onClick={() => setShowDeleteAll(true)} />
          )}
          {systems.length > 0 && (
            <IconButton icon="download" label="Export CSV"
              onClick={() => exportCsv('systems.csv', ['Name', 'Type', 'Description'], systems.map((s) => [s.name, s.systemType, s.description]))} />
          )}
          <IconButton icon="upload" label="Import systems" onClick={() => setShowImport(true)} />
          <IconButton icon="plus" label="Add system" variant="primary" onClick={openAdd} />
        </div>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 16, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600 }}>Import Systems</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={importFormat === 'csv'} onChange={() => setImportFormat('csv')} /> CSV</label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}><input type="radio" checked={importFormat === 'json'} onChange={() => setImportFormat('json')} /> JSON</label>
            </div>
          </div>
          {!activeOrgId && (
            <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: 4, fontSize: 12, color: '#92400e', marginBottom: 10 }}>
              Select an organization from the "Working in" dropdown in the header before importing.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <input ref={fileInputRef} type="file" accept={importFormat === 'csv' ? '.csv,.txt' : '.json,.txt'} onChange={handleFileRead} style={{ display: 'none' }} />
            <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => fileInputRef.current?.click()}>Browse File</button>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>or paste below. Columns: Name (required), Description, Type</span>
          </div>
          <textarea
            style={{ ...inputStyle, width: '100%', minHeight: 100, fontFamily: 'var(--font-mono)', fontSize: 11 }}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={importFormat === 'csv'
              ? 'Name,Description,Type\nSAP ERP,Enterprise resource planning,ERP\nSalesforce,Customer relationship management,CRM\nArcGIS,Geographic information system,GIS'
              : '[{ "name": "SAP ERP", "description": "Enterprise resource planning", "systemType": "ERP" }]'}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={() => { setShowImport(false); setImportText(''); }}>Cancel</button>
            <button style={{ ...btnPrimary, opacity: !importText.trim() || !activeOrgId ? 0.6 : 1 }} disabled={!importText.trim() || !activeOrgId} onClick={handleImport}>Import</button>
          </div>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit System' : 'Add New System'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
              <input autoFocus style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. SAP ERP, Salesforce CRM" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>System Type</label>
              <select style={selectStyle} value={form.systemType} onChange={(e) => setForm({ ...form, systemType: e.target.value })}>
                <option value="">-- Select type --</option>
                {systemTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description of what this system does" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button style={btnSecondary} onClick={handleCancel}>Cancel</button>
            {!editingId && (
              <button
                style={{ ...btnSecondary, opacity: !form.name.trim() ? 0.6 : 1 }}
                disabled={!form.name.trim()}
                onClick={() => handleSave(true)}
                title="Save this system and keep the form open to add another"
              >
                Save & Add Another
              </button>
            )}
            <button style={{ ...btnPrimary, opacity: !form.name.trim() ? 0.6 : 1 }} disabled={!form.name.trim()} onClick={() => handleSave(false)}>
              {editingId ? 'Save Changes' : 'Add System'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {systems.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{systems.length}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Systems</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{new Set(systems.map((s) => s.systemType).filter(Boolean)).size}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>System Types</div>
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
        title="Delete All Systems?"
        message={`This will permanently delete all ${systems.length} systems. This cannot be undone.`}
        confirmLabel="Delete All"
        requireTypedConfirmation="DELETE"
        onConfirm={async () => {
          setShowDeleteAll(false);
          await apiClient.delete('/systems/all');
          setSelectedIds(new Set());
          fetchData();
        }}
        onCancel={() => setShowDeleteAll(false)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete System?"
        message="This will permanently delete this system. This cannot be undone."
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
        title="Delete Selected Systems?"
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
          <SkeletonRows rows={5} columns={5} />
        ) : systems.length === 0 && !showForm ? (
          <EmptyState
            icon={'\u2699'}
            title="No systems defined yet"
            description="Systems are the applications and platforms where your data lives — ERP, CRM, GIS, and so on. Define them first so you can connect and map data assets to each one."
            action={{ label: '+ Add System', onClick: openAdd }}
            secondaryAction={{ label: 'Import from CSV', onClick: () => setShowImport(true) }}
          />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={{ ...thStyle, width: 40, textAlign: 'center' }}>
                  <input type="checkbox" checked={systems.length > 0 && selectedIds.size === systems.length} onChange={toggleSelectAll} aria-label="Select all systems" />
                </th>
                <SortableTh sortKey="name" active={sortKey} dir={sortDir} onClick={toggleSort}>Name</SortableTh>
                <SortableTh sortKey="type" active={sortKey} dir={sortDir} onClick={toggleSort}>Type</SortableTh>
                <SortableTh sortKey="description" active={sortKey} dir={sortDir} onClick={toggleSort}>Description</SortableTh>
                <th style={{ ...thStyle, width: 140 }}>Connections</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((sys) => {
                const sysConnections = connections.filter((c) => c.systemId === sys.id);
                const connectedCount = sysConnections.filter((c) => c.status === 'CONNECTED').length;
                return (
                  <tr key={sys.id} style={{ transition: 'background 0.1s', background: selectedIds.has(sys.id) ? '#f0f9ff' : '' }}
                    onMouseEnter={(e) => { if (!selectedIds.has(sys.id)) e.currentTarget.style.background = 'var(--color-bg)'; }}
                    onMouseLeave={(e) => { if (!selectedIds.has(sys.id)) e.currentTarget.style.background = ''; }}>
                    <td style={{ ...tdStyle, textAlign: 'center', width: 40 }}>
                      <input type="checkbox" checked={selectedIds.has(sys.id)} onChange={() => toggleSelect(sys.id)} />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{sys.name}</td>
                    <td style={tdStyle}>
                      {sys.systemType ? <span style={typeBadge}>{sys.systemType}</span> : <span style={{ color: 'var(--color-text-muted)' }}>--</span>}
                    </td>
                    <td style={{ ...tdStyle, color: sys.description ? 'var(--color-text-secondary)' : 'var(--color-text-muted)', maxWidth: 400 }}>
                      {sys.description || '--'}
                    </td>
                    <td style={tdStyle}>
                      {sysConnections.length > 0 ? (
                        <button
                          onClick={() => navigate(`/connections?systemId=${encodeURIComponent(sys.id)}`)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-primary)', fontSize: 12, textDecoration: 'underline' }}
                          title="View connections for this system"
                        >
                          {sysConnections.length} configured{connectedCount > 0 ? ` · ${connectedCount} live` : ''}
                        </button>
                      ) : (
                        <button
                          onClick={() => navigate(`/connections?systemId=${encodeURIComponent(sys.id)}&open=1`)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12 }}
                          title="Add a connection for this system"
                        >
                          + Add
                        </button>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(sys)} />
                        <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(sys.id)} />
                      </div>
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
