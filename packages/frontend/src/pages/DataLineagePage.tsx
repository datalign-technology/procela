import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, ArrowLeftRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Card from '../components/Card';
import TruncatedText from '../components/TruncatedText';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import ExportMenu from '../components/ExportMenu';
import { usePolling } from '../hooks/usePolling';
import { useColumnPicker } from '../hooks/useColumnPicker';
import ColumnPicker from '../components/ColumnPicker';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToastStore } from '../stores/toastStore';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';

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

interface DbtImportSummary {
  assetsCreated: number;
  assetsMatched: number;
  edgesCreated: number;
  edgesTouched: number;
  edgesRemoved: number;
  /** dbt tests surfaced as Data Quality rules. Optional because older
   *  backends responded without these fields. */
  dqRulesCreated?: number;
  dqRulesTouched?: number;
  dqRulesRemoved?: number;
}

interface AssetLineageEdgeRow {
  id: string;
  orgId: string;
  sourceAssetId: string;
  targetAssetId: string;
  source: 'dbt' | 'manual';
  sourceRef?: string;
  sourceAssetName: string | null;
  targetAssetName: string | null;
  lastSeenAt: string;
  createdAt: string;
  /** Server-derived: true when lastSeenAt is older than staleAfterDays. */
  isStale?: boolean;
  staleAfterDays?: number;
}

type DbtPollFrequency = 'NEVER' | 'HOURLY' | 'DAILY' | 'WEEKLY';

interface DbtCloudConnectionRow {
  id: string;
  orgId: string;
  name: string;
  host: string;
  accountId: string;
  jobId: string;
  hasToken: boolean;
  lastRunAt: string | null;
  lastStatus: 'NEVER' | 'SUCCESS' | 'ERROR';
  lastError: string | null;
  lastSummary: DbtImportSummary | null;
  pollFrequency: DbtPollFrequency;
  nextPollAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteDbtConn, setConfirmDeleteDbtConn] = useState<DbtCloudConnectionRow | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'visualization'>('table');
  const [vizMode, setVizMode] = useState<'systems' | 'assets' | 'both'>('systems');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Visualization data
  const [visNodes, setVisNodes] = useState<VisNode[]>([]);
  const [visLinks, setVisLinks] = useState<VisLink[]>([]);
  // dbt manifest import state. The modal is closed by default; once a
  // file is dropped/selected it parses client-side and POSTs the JSON.
  const [showDbtImport, setShowDbtImport] = useState(false);
  const [dbtConnections, setDbtConnections] = useState<DbtCloudConnectionRow[]>([]);
  const [editingDbtConn, setEditingDbtConn] = useState<DbtCloudConnectionRow | null>(null);
  const [showDbtConnForm, setShowDbtConnForm] = useState(false);
  const [refreshingConnId, setRefreshingConnId] = useState<string | null>(null);
  const dbtModalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dbtModalRef, showDbtImport);
  const [dbtImporting, setDbtImporting] = useState(false);
  const [dbtImportSummary, setDbtImportSummary] = useState<DbtImportSummary | null>(null);
  const [dbtImportError, setDbtImportError] = useState<string | null>(null);
  // Asset-level edges derived from imports. Shown in a tabbed section
  // beneath the existing system-lineage table.
  const [assetEdges, setAssetEdges] = useState<AssetLineageEdgeRow[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const [linksRes, systemsRes, assetsRes, edgesRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: LineageLink[] }>(`/data-lineage${query}`),
        apiClient.get<{ success: boolean; data: SystemRef[] }>(`/systems${query}`),
        apiClient.get<{ success: boolean; data: DataAssetRef[] }>(`/data-assets${query}`),
        apiClient.get<{ success: boolean; data: AssetLineageEdgeRow[] }>(`/data-lineage/asset-edges${query}`),
      ]);
      setLinks(linksRes.data || []);
      setSystemsList(systemsRes.data || []);
      setAssetsList(assetsRes.data || []);
      setAssetEdges(edgesRes.data || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load data lineage');
    }
    finally { setLoading(false); }
  }, [activeOrgId]);

  // Parse the dropped/picked manifest file client-side (manifests can be
  // many MB so we don't want them in a multipart upload), then POST the
  // parsed JSON to the import endpoint.
  const handleDbtFile = async (file: File) => {
    setDbtImporting(true);
    setDbtImportError(null);
    setDbtImportSummary(null);
    try {
      const text = await file.text();
      let manifest: unknown;
      try { manifest = JSON.parse(text); }
      catch { throw new Error('That file isn\'t valid JSON.'); }
      const res = await apiClient.post<{ success: boolean; summary: DbtImportSummary; error?: string }>(
        '/data-lineage/import-dbt',
        { orgId: activeOrgId, manifest },
      );
      if (!res.success) throw new Error(res.error || 'Import failed');
      setDbtImportSummary(res.summary);
      // Refresh the catalog so new assets and edges show up.
      await fetchData();
    } catch (e) {
      setDbtImportError(errorMessage(e, 'Import failed'));
    } finally {
      setDbtImporting(false);
    }
  };

  const fetchDbtConnections = useCallback(async () => {
    const q = activeOrgId ? `?orgId=${activeOrgId}` : '';
    try {
      const res = await apiClient.get<{ success: boolean; data: DbtCloudConnectionRow[] }>(`/dbt-cloud-connections${q}`);
      setDbtConnections(res.data || []);
    } catch { /* */ }
  }, [activeOrgId]);

  useEffect(() => { void fetchDbtConnections(); }, [fetchDbtConnections]);

  const refreshDbtConnection = async (id: string) => {
    setRefreshingConnId(id);
    try {
      await apiClient.post(`/dbt-cloud-connections/${id}/refresh`);
    } catch { /* error is recorded on the connection's lastError; we just re-fetch */ }
    finally {
      setRefreshingConnId(null);
      await fetchDbtConnections();
      await fetchData();
    }
  };

  const deleteDbtConnection = async (id: string) => {
    try {
      await apiClient.delete(`/dbt-cloud-connections/${id}`);
      addToast('success', 'dbt Cloud connection deleted');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to delete dbt Cloud connection');
    }
    fetchDbtConnections();
  };

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

  const sel = useRowSelection(links, (l) => l.id);

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
  const handleBulkDelete = async () => {
    if (sel.count === 0) return;
    try {
      await Promise.all(Array.from(sel.selectedIds).map((id) => apiClient.delete(`/data-lineage/${id}`)));
      addToast('success', `Deleted ${sel.count} lineage flows`);
      sel.clear();
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

  const lineageColumns = ([
    lineageCols.isVisible('source') && {
      key: 'source', header: 'Source System',
      render: (link: LineageLink) => link.sourceSystemName || link.sourceSystemId,
    },
    lineageCols.isVisible('target') && {
      key: 'target', header: 'Target System',
      render: (link: LineageLink) => link.targetSystemName || link.targetSystemId,
    },
    lineageCols.isVisible('asset') && {
      key: 'asset', header: 'Data Asset',
      render: (link: LineageLink) => (
        link.dataAssetName ? (
          <span style={{ color: 'var(--color-text-secondary)' }}>{link.dataAssetName}</span>
        ) : (
          <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>--</span>
        )
      ),
    },
    lineageCols.isVisible('flowType') && {
      key: 'flowType', header: 'Flow Type',
      render: (link: LineageLink) => (
        <Badge label={link.flowType} colors={FLOW_TYPE_BADGES[link.flowType] || FLOW_TYPE_BADGES.MANUAL} />
      ),
    },
    lineageCols.isVisible('frequency') && {
      key: 'frequency', header: 'Frequency',
      render: (link: LineageLink) => (
        <Badge label={link.frequency} colors={FREQUENCY_BADGES[link.frequency] || FREQUENCY_BADGES.ON_DEMAND} />
      ),
    },
    lineageCols.isVisible('status') && {
      key: 'status', header: 'Status',
      render: (link: LineageLink) => (
        <Badge label={link.status} colors={STATUS_BADGES[link.status] || STATUS_BADGES.ACTIVE} />
      ),
    },
    lineageCols.isVisible('description') && {
      key: 'description', header: 'Description', cellStyle: { maxWidth: 200 },
      render: (link: LineageLink) => (
        <TruncatedText text={link.description} emptyPlaceholder="--" />
      ),
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const,
      render: (link: LineageLink) => (
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
          <IconButton size="sm" icon="edit" label="Edit" onClick={() => openEdit(link)} />
          <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(link.id)} />
        </div>
      ),
    },
  ].filter(Boolean) as DataTableColumn<LineageLink>[]);

  if (loading) {
    return (
      <div>
        <Card>
          <SkeletonRows rows={5} columns={4} />
        </Card>
      </div>
    );
  }

  if (loadError && links.length === 0) {
    return (
      <div>
        <PageHeader title="Data Lineage" />
        <ErrorState
          title="Couldn't load data lineage"
          message={loadError}
          onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Data Lineage"
        subtitle="Track how data flows between systems — which system feeds which."
        actions={
          <>
            <IconButton icon="eye" label={viewMode === 'table' ? 'Visualize' : 'Table view'}
              onClick={() => setViewMode(viewMode === 'table' ? 'visualization' : 'table')} />
            <IconButton icon="upload" label="Import dbt manifest" onClick={() => setShowDbtImport(true)} />
            {links.length > 0 && (
              <ExportMenu build={() => ({
                filenameBase: 'data-lineage',
                sheetName: 'Lineage',
                headers: ['Source System', 'Target System', 'Data Asset', 'Flow Type', 'Frequency', 'Status', 'Description'],
                rows: links.map((l) => [
                  l.sourceSystemName,
                  l.targetSystemName,
                  l.dataAssetName,
                  l.flowType,
                  l.frequency,
                  l.status,
                  l.description,
                ]),
              })} />
            )}
            <ColumnPicker state={lineageCols} />
            <IconButton icon="plus" label="Add flow" variant="primary" onClick={openAdd} />
          </>
        }
      />

      {/* Add/Edit Form */}
      {showForm && (
        <Card padding={20} marginBottom={20}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
            {editingId ? 'Edit Lineage Flow' : 'Add New Lineage Flow'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Source System *</label>
              <select aria-label="Source System" style={selectStyle} value={form.sourceSystemId} onChange={(e) => updateField('sourceSystemId', e.target.value)}>
                <option value="">-- Select source system --</option>
                {systemsList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target System *</label>
              <select aria-label="Target System" style={selectStyle} value={form.targetSystemId} onChange={(e) => updateField('targetSystemId', e.target.value)}>
                <option value="">-- Select target system --</option>
                {systemsList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {form.sourceSystemId && form.targetSystemId && form.sourceSystemId === form.targetSystemId && (
                <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4 }}>Source and target cannot be the same system</div>
              )}
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Asset (optional)</label>
              <select aria-label="Data Asset (optional)" style={selectStyle} value={form.dataAssetId} onChange={(e) => updateField('dataAssetId', e.target.value)}>
                <option value="">-- None --</option>
                {assetsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Flow Type</label>
              <select aria-label="Flow Type" style={selectStyle} value={form.flowType} onChange={(e) => updateField('flowType', e.target.value)}>
                {FLOW_TYPES.map((ft) => <option key={ft} value={ft}>{ft.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Frequency</label>
              <select aria-label="Frequency" style={selectStyle} value={form.frequency} onChange={(e) => updateField('frequency', e.target.value)}>
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Status</label>
              <select aria-label="Status" style={selectStyle} value={form.status} onChange={(e) => updateField('status', e.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="DEPRECATED">Deprecated</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input
                aria-label="Description"
                style={inputStyle}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe this data flow"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.sourceSystemId || !form.targetSystemId || form.sourceSystemId === form.targetSystemId}
              onClick={handleSave}
            >
              {editingId ? 'Save Changes' : 'Add Flow'}
            </Button>
          </div>
        </Card>
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
        message={`Delete ${sel.count} selected flows? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => { setConfirmBulkDelete(false); await handleBulkDelete(); }}
        onCancel={() => setConfirmBulkDelete(false)}
      />
      <ConfirmDialog
        open={!!confirmDeleteDbtConn}
        title="Delete dbt Cloud connection?"
        message={confirmDeleteDbtConn ? `Delete dbt Cloud connection "${confirmDeleteDbtConn.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        onConfirm={() => { if (confirmDeleteDbtConn) deleteDbtConnection(confirmDeleteDbtConn.id); setConfirmDeleteDbtConn(null); }}
        onCancel={() => setConfirmDeleteDbtConn(null)}
      />

      {/* Bulk Action Bar */}
      {viewMode === 'table' && (
        <BulkActionBar count={sel.count} onClear={sel.clear}>
          <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete Selected</BulkActionButton>
        </BulkActionBar>
      )}

      {viewMode === 'table' ? (
        <>
          {/* Table */}
          {links.length === 0 ? (
            <EmptyState
              icon={renderNavIcon('/data-lineage')}
              title="No lineage flows defined yet"
              description="Lineage flows track how data moves between systems — which system feeds which. Define the first flow to start building the picture."
              action={{ label: '+ Add Flow', onClick: openAdd }}
            />
          ) : (
            <Card padding={0} style={{ overflow: 'auto' }}>
              <DataTable
                rows={links}
                columns={lineageColumns}
                rowKey={(l) => l.id}
                selection={sel}
                selectAllLabel="Select all flows"
                emptyMessage="No flows match the current filters."
              />
            </Card>
          )}

          {/* Asset-level lineage edges (auto-derived from dbt manifest
            *  imports). Hidden when there are no edges yet so the page
            *  doesn't lead with an empty placeholder. */}
          {/* dbt Cloud connections - listed above the asset edges so
            *  users can refresh and see the resulting edge changes in
            *  the same scroll. Hidden when no connections are configured
            *  (the "Import dbt manifest" button still works for one-off
            *  uploads from dbt Core or other sources). */}
          {(dbtConnections.length > 0 || showDbtConnForm) && (
            <DbtCloudConnectionsPanel
              connections={dbtConnections}
              refreshingId={refreshingConnId}
              onRefresh={refreshDbtConnection}
              onEdit={(c) => { setEditingDbtConn(c); setShowDbtConnForm(true); }}
              onDelete={(id) => setConfirmDeleteDbtConn(dbtConnections.find((c) => c.id === id) || null)}
              onAdd={() => { setEditingDbtConn(null); setShowDbtConnForm(true); }}
            />
          )}
          {!dbtConnections.length && !showDbtConnForm && (
            <div style={{ marginTop: 24, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <button
                type="button"
                onClick={() => { setEditingDbtConn(null); setShowDbtConnForm(true); }}
                style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}
              >+ Connect a dbt Cloud job</button>
              {' '}to skip the manual upload step.
            </div>
          )}
          {assetEdges.length > 0 && (() => {
            const staleCount = assetEdges.filter((e) => e.isStale).length;
            const staleAfterDays = assetEdges[0]?.staleAfterDays ?? 30;
            return (
              <div style={{ marginTop: 32 }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
                  Asset-level lineage <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)' }}>({assetEdges.length} edges)</span>
                  {staleCount > 0 && (
                    <span style={{
                      marginLeft: 10, fontSize: 10, fontWeight: 700, padding: '2px 6px',
                      borderRadius: 3, background: '#fef3c7', color: '#92400e',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      {staleCount} stale
                    </span>
                  )}
                </h2>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 12 }}>
                  Auto-derived from imported source manifests (dbt). Re-importing the same manifest updates these in place. Edges not re-seen in {staleAfterDays} days are flagged stale.
                </p>
                <Card padding={0} shadow="none">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        <th scope="col" style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', textAlign: 'left' }}>Source asset</th>
                        <th scope="col" style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', textAlign: 'left' }}>Target asset</th>
                        <th scope="col" style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', textAlign: 'left' }}>Source</th>
                        <th scope="col" style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', textAlign: 'left' }}>Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetEdges.map((e) => (
                        <tr key={e.id} style={{ borderTop: '1px solid var(--color-border)', opacity: e.isStale ? 0.7 : 1 }}>
                          <td style={{ padding: '6px 12px', fontSize: 13 }}>{e.sourceAssetName || <span style={{ color: 'var(--color-text-muted)' }}>(deleted)</span>}</td>
                          <td style={{ padding: '6px 12px', fontSize: 13 }}>{e.targetAssetName || <span style={{ color: 'var(--color-text-muted)' }}>(deleted)</span>}</td>
                          <td style={{ padding: '6px 12px', fontSize: 11, color: 'var(--color-text-muted)' }}>{e.source}</td>
                          <td style={{ padding: '6px 12px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                            {new Date(e.lastSeenAt).toLocaleString()}
                            {e.isStale && (
                              <span style={{
                                marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px',
                                borderRadius: 3, background: '#fef3c7', color: '#92400e',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                              }}>stale</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            );
          })()}
        </>
      ) : (
        /* Visualization View - three lenses sharing the toolbar:
         *   systems = the existing flow graph
         *   assets  = the auto-derived asset edges (from dbt etc.)
         *   both    = stacked, systems on top, assets below
         */
        <div>
          <div role="group" aria-label="Visualization mode" style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 6, padding: 2, marginBottom: 12,
          }}>
            {(['systems', 'assets', 'both'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setVizMode(mode)}
                aria-pressed={vizMode === mode}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 500,
                  background: vizMode === mode ? 'var(--color-surface)' : 'transparent',
                  color: vizMode === mode ? 'var(--color-text)' : 'var(--color-text-muted)',
                  border: 'none', borderRadius: 4, cursor: 'pointer',
                  boxShadow: vizMode === mode ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {mode === 'systems' ? 'Systems' : mode === 'assets' ? 'Assets' : 'Both'}
              </button>
            ))}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
              {vizMode === 'systems' && `${visNodes.length} systems`}
              {vizMode === 'assets' && `${assetEdges.length} edges`}
              {vizMode === 'both' && `${visNodes.length} systems · ${assetEdges.length} asset edges`}
            </span>
          </div>
          {(vizMode === 'systems' || vizMode === 'both') && (
            <LineageVisualization nodes={visNodes} links={visLinks} />
          )}
          {(vizMode === 'assets' || vizMode === 'both') && (
            <div style={{ marginTop: vizMode === 'both' ? 16 : 0 }}>
              <AssetLineageVisualization edges={assetEdges} />
            </div>
          )}
        </div>
      )}

      {/* dbt Cloud connection form modal */}
      {showDbtConnForm && (
        <DbtCloudConnectionForm
          existing={editingDbtConn}
          orgId={activeOrgId}
          onClose={() => { setShowDbtConnForm(false); setEditingDbtConn(null); }}
          onSaved={() => { setShowDbtConnForm(false); setEditingDbtConn(null); fetchDbtConnections(); }}
        />
      )}

      {/* dbt manifest import modal. Lives at the page root so the
        *  backdrop can cover the whole viewport regardless of where the
        *  page's main content scrolls. */}
      {showDbtImport && (
        <div
          onClick={() => { if (!dbtImporting) { setShowDbtImport(false); setDbtImportSummary(null); setDbtImportError(null); } }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            ref={dbtModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dbt-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 90vw)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              padding: 20,
            }}
          >
            <h3 id="dbt-modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Import dbt manifest</h3>
            <p style={{ marginTop: 6, marginBottom: 14, fontSize: 12, color: 'var(--color-text-muted)' }}>
              Drop or pick a dbt-generated <code>manifest.json</code>. Procela will create or match data
              assets for each model, source, seed, and snapshot, then derive asset-to-asset lineage edges
              from the <code>depends_on</code> graph. Re-imports update the same assets and edges in place.
            </p>
            <FileDropZone disabled={dbtImporting} onFile={handleDbtFile} />
            {dbtImporting && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>Importing…</div>
            )}
            {dbtImportError && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: '#b91c1c', fontSize: 12 }}>
                {dbtImportError}
              </div>
            )}
            {dbtImportSummary && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: 4, color: '#065f46', fontSize: 12 }}>
                <div>
                  Imported manifest. Created {dbtImportSummary.assetsCreated} new assets,
                  matched {dbtImportSummary.assetsMatched} existing.
                </div>
                <div style={{ marginTop: 4 }}>
                  {dbtImportSummary.edgesCreated} new edges, {dbtImportSummary.edgesTouched} refreshed,
                  {' '}{dbtImportSummary.edgesRemoved} stale edges removed.
                </div>
                {(dbtImportSummary.dqRulesCreated !== undefined
                  || dbtImportSummary.dqRulesTouched !== undefined
                  || dbtImportSummary.dqRulesRemoved !== undefined) && (
                  <div style={{ marginTop: 4 }}>
                    {dbtImportSummary.dqRulesCreated || 0} Data Quality rules created from dbt tests,
                    {' '}{dbtImportSummary.dqRulesTouched || 0} refreshed,
                    {' '}{dbtImportSummary.dqRulesRemoved || 0} removed.
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => { setShowDbtImport(false); setDbtImportSummary(null); setDbtImportError(null); }}
                disabled={dbtImporting}
                style={{
                  padding: '6px 14px', fontSize: 13,
                  background: 'var(--color-bg)', color: 'var(--color-text)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  cursor: dbtImporting ? 'default' : 'pointer',
                }}
              >
                {dbtImportSummary ? 'Done' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── dbt Cloud connection panel ─────────────────────────────────────────
// A small table of configured dbt Cloud jobs with a per-row "Refresh now"
// button and the last-run status. Eliminates the manual manifest upload
// step that the parent page also supports.

function DbtCloudConnectionsPanel({
  connections, refreshingId, onRefresh, onEdit, onDelete, onAdd,
}: {
  connections: DbtCloudConnectionRow[];
  refreshingId: string | null;
  onRefresh: (id: string) => void;
  onEdit: (c: DbtCloudConnectionRow) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
          dbt Cloud connections <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-muted)' }}>({connections.length})</span>
        </h2>
        <button
          type="button"
          onClick={onAdd}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12 }}
        >
          + Add connection
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 8 }}>
        Each refresh pulls the manifest from the most recent successful run of the configured job and reconciles it like the manual upload would.
      </p>
      <Card padding={0} shadow="none">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)' }}>
              <th scope="col" style={connThStyle}>Name</th>
              <th scope="col" style={connThStyle}>Account / Job</th>
              <th scope="col" style={connThStyle}>Schedule</th>
              <th scope="col" style={connThStyle}>Last refresh</th>
              <th scope="col" style={connThStyle}>Status</th>
              <th scope="col" style={{ ...connThStyle, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={connTdStyle}><strong>{c.name}</strong><div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{c.host}</div></td>
                <td style={connTdStyle}>{c.accountId} / {c.jobId}</td>
                <td style={connTdStyle}>
                  {c.pollFrequency === 'NEVER' ? (
                    <span style={{ color: 'var(--color-text-muted)' }}>Manual only</span>
                  ) : (
                    <>
                      <div>{c.pollFrequency.charAt(0) + c.pollFrequency.slice(1).toLowerCase()}</div>
                      {c.nextPollAt && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                          next {formatRelative(c.nextPollAt)}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td style={connTdStyle}>{c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : <span style={{ color: 'var(--color-text-muted)' }}>never</span>}</td>
                <td style={connTdStyle}>
                  {c.lastStatus === 'SUCCESS' && (
                    <span style={statusBadge('#dcfce7', '#166534')}>Success</span>
                  )}
                  {c.lastStatus === 'ERROR' && (
                    <span title={c.lastError || ''} style={statusBadge('#fef2f2', '#b91c1c')}>Error</span>
                  )}
                  {c.lastStatus === 'NEVER' && (
                    <span style={statusBadge('var(--color-bg)', 'var(--color-text-muted)')}>Not yet run</span>
                  )}
                </td>
                <td style={{ ...connTdStyle, textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => onRefresh(c.id)}
                    disabled={refreshingId === c.id}
                    style={connBtnStyle}
                  >
                    {refreshingId === c.id ? 'Refreshing…' : 'Refresh now'}
                  </button>
                  <button type="button" onClick={() => onEdit(c)} style={connBtnStyle}>Edit</button>
                  <button type="button" onClick={() => onDelete(c.id)} style={{ ...connBtnStyle, color: 'var(--color-error)' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

const connThStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left',
};
const connTdStyle: React.CSSProperties = { padding: '6px 12px', fontSize: 12, color: 'var(--color-text)', verticalAlign: 'top' };
const connBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: '2px 6px', marginLeft: 4,
  color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12,
};
const statusBadge = (bg: string, color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 12,
  fontSize: 10, fontWeight: 600, background: bg, color,
});

/** "in 4h", "in 2 days", "in 12 minutes" - short relative offset for
 *  the next-poll-at hint under the schedule column. Past times render
 *  as "any moment" since the scheduler will catch up on the next tick. */
function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'any moment';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}

// ── dbt Cloud connection form ──────────────────────────────────────────
// Edits both new and existing connections. For existing connections the
// token field is left empty by default and only sent if the user types
// a replacement; the backend treats empty-token-on-PATCH as "keep the
// current token" so users never need to paste it again just to edit a
// label.

function DbtCloudConnectionForm({
  existing, orgId, onClose, onSaved,
}: {
  existing: DbtCloudConnectionRow | null;
  orgId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(existing?.host ?? 'cloud.getdbt.com');
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  const [jobId, setJobId] = useState(existing?.jobId ?? '');
  const [token, setToken] = useState('');
  const [pollFrequency, setPollFrequency] = useState<DbtPollFrequency>(existing?.pollFrequency ?? 'NEVER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim() && accountId.trim() && jobId.trim() && (existing ? true : token.trim());

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        orgId: orgId || undefined,
        name: name.trim(),
        host: host.trim(),
        accountId: accountId.trim(),
        jobId: jobId.trim(),
        pollFrequency,
      };
      if (token.trim()) body.token = token.trim();
      if (existing) {
        await apiClient.patch(`/dbt-cloud-connections/${existing.id}`, body);
      } else {
        await apiClient.post('/dbt-cloud-connections', body);
      }
      onSaved();
    } catch (e) {
      setError(errorMessage(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={() => { if (!saving) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'Edit dbt Cloud connection' : 'Add dbt Cloud connection'}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 90vw)', background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)', padding: 20,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{existing ? 'Edit dbt Cloud connection' : 'Add dbt Cloud connection'}</h3>
        <p style={{ marginTop: 6, marginBottom: 14, fontSize: 12, color: 'var(--color-text-muted)' }}>
          Procela polls the manifest for the most recent successful run of the configured job. Find <strong>Account ID</strong> in the dbt Cloud URL (<code>cloud.getdbt.com/accounts/&lt;id&gt;</code>) and <strong>Job ID</strong> on the job's settings page.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FormRow label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My dbt project"
              style={connInputStyle}
              autoFocus
              autoComplete="off"
              name="procela-dbt-connection-name"
            />
          </FormRow>
          <FormRow label="Host">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="cloud.getdbt.com"
              style={connInputStyle}
              autoComplete="off"
              name="procela-dbt-host"
            />
          </FormRow>
          <FormRow label="Account ID">
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="12345"
              style={connInputStyle}
              autoComplete="off"
              inputMode="numeric"
              name="procela-dbt-account-id"
            />
          </FormRow>
          <FormRow label="Job ID">
            <input
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="98765"
              style={connInputStyle}
              autoComplete="off"
              inputMode="numeric"
              name="procela-dbt-job-id"
            />
          </FormRow>
          <FormRow label={existing ? 'API token (leave blank to keep current)' : 'API token'}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={existing?.hasToken ? '••••••••' : 'dbtc_xxx...'}
              style={connInputStyle}
              autoComplete="new-password"
              name="procela-dbt-api-token"
            />
          </FormRow>
          <FormRow label="Polling schedule">
            <select
              value={pollFrequency}
              onChange={(e) => setPollFrequency(e.target.value as DbtPollFrequency)}
              style={connInputStyle}
            >
              <option value="NEVER">Manual only — refresh by clicking the button</option>
              <option value="HOURLY">Every hour</option>
              <option value="DAILY">Every day</option>
              <option value="WEEKLY">Every week</option>
            </select>
          </FormRow>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
            <AlertTriangle size={12} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Tokens are stored in plaintext in the prototype. Replace with secret-manager refs for production.</span>
          </div>
          {error && (
            <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, color: '#b91c1c', fontSize: 12 }}>{error}</div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ padding: '6px 14px', fontSize: 13, background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: saving ? 'default' : 'pointer' }}
          >Cancel</button>
          <button type="button" onClick={save} disabled={!canSave || saving}
            style={{ padding: '6px 14px', fontSize: 13, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: !canSave || saving ? 'default' : 'pointer', opacity: !canSave || saving ? 0.6 : 1 }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const connInputStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13, border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)',
};

// ── File drop zone ──────────────────────────────────────────────────────
// Small inline component (instead of pulling in a new shared one) since
// dbt manifest is the only file-drop case on this page so far. Click
// anywhere to open the file picker; drag-and-drop is also supported.
function FileDropZone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  return (
    // Rendered as a button so it's in the tab order and Enter/Space
    // activate the file picker the way Space activates a checkbox. The
    // drag-and-drop handlers are still on the same element since drag
    // events fire on whichever element the user drops onto.
    <button
      type="button"
      disabled={disabled}
      aria-label="Drop a dbt manifest.json file here or press Enter to pick a file"
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault(); setHover(false);
        if (disabled) return;
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{
        display: 'block', width: '100%', font: 'inherit', color: 'var(--color-text)',
        padding: '24px', textAlign: 'center', borderRadius: 'var(--radius-md)',
        border: `2px dashed ${hover ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: hover ? 'var(--color-bg)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
        Drop a manifest.json here
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
        or click to pick a file
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Reset so picking the same file twice still fires onChange.
          e.target.value = '';
        }}
      />
    </button>
  );
}

/* ---- Visualization Component ---- */

function LineageVisualization({ nodes, links }: { nodes: VisNode[]; links: VisLink[] }) {
  if (nodes.length === 0) {
    return (
      <Card padding={40} shadow="none" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{'\u21C4'}</div>
        <div>No lineage data to visualize. Add some flows first.</div>
      </Card>
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
    <Card padding={0} style={{ overflow: 'auto' }}>
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
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// AssetLineageVisualization - same grid-based SVG layout as the system
// lineage view, but rendered from asset edges. Auto-derived edges (dbt,
// future SQL log sources) populate this view; manual asset edges share
// the same shape so a future "draw an asset edge" feature would slot in
// without a render change.
// ──────────────────────────────────────────────────────────────────────────

interface AssetVizNode {
  id: string;
  name: string;
  /** Total edges this node participates in (in or out). Drives size so
   *  hubs stand out a bit in dense graphs. */
  degree: number;
}

function AssetLineageVisualization({ edges }: { edges: AssetLineageEdgeRow[] }) {
  if (edges.length === 0) {
    return (
      <Card padding={40} shadow="none" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: 'var(--color-text-muted)' }}><ArrowLeftRight size={32} strokeWidth={1.8} /></div>
        <div>No asset-level lineage yet. Import a dbt manifest to populate this view.</div>
      </Card>
    );
  }

  // Build the unique node list from the edge endpoints. We tally degree
  // here so the renderer can scale hub nodes proportionally without a
  // second pass over the edge list.
  const nodeMap = new Map<string, AssetVizNode>();
  for (const e of edges) {
    if (!nodeMap.has(e.sourceAssetId)) {
      nodeMap.set(e.sourceAssetId, { id: e.sourceAssetId, name: e.sourceAssetName || '(deleted)', degree: 0 });
    }
    if (!nodeMap.has(e.targetAssetId)) {
      nodeMap.set(e.targetAssetId, { id: e.targetAssetId, name: e.targetAssetName || '(deleted)', degree: 0 });
    }
    nodeMap.get(e.sourceAssetId)!.degree++;
    nodeMap.get(e.targetAssetId)!.degree++;
  }
  const nodes = Array.from(nodeMap.values()).sort((a, b) => b.degree - a.degree);

  const BOX_W = 140;
  const BOX_H = 50;
  const PADDING = 70;

  // Same grid arrangement as LineageVisualization. Sorting by descending
  // degree puts the busiest assets in the top-left where the eye lands
  // first.
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const svgW = cols * (BOX_W + PADDING) + PADDING;
  const rows = Math.ceil(nodes.length / cols);
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

  // Colour by edge source. Asset edges almost always come from dbt for
  // now; the conditional keeps the door open for snowflake / manual etc.
  const colourFor = (source: string) =>
    source === 'dbt' ? '#0ea5e9' : source === 'manual' ? '#22c55e' : '#94a3b8';

  return (
    <Card padding={0} style={{ overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#0ea5e9', borderRadius: 2, marginRight: 4 }} />dbt</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#22c55e', borderRadius: 2, marginRight: 4 }} />manual</span>
      </div>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        <defs>
          <marker id="asset-arrow-dbt" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="10" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 3 L 0 6 z" fill="#0ea5e9" />
          </marker>
          <marker id="asset-arrow-manual" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="10" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 3 L 0 6 z" fill="#22c55e" />
          </marker>
        </defs>

        {/* Edges first so node rectangles sit on top of arrow tails. */}
        {edges.map((e) => {
          const from = nodePositions[e.sourceAssetId];
          const to = nodePositions[e.targetAssetId];
          if (!from || !to) return null;
          const x1 = from.x + BOX_W / 2;
          const y1 = from.y + BOX_H / 2;
          const x2 = to.x + BOX_W / 2;
          const y2 = to.y + BOX_H / 2;
          const marker = e.source === 'manual' ? 'asset-arrow-manual' : 'asset-arrow-dbt';
          // Stale edges render dashed and faded so they're visually
          // distinct without losing colour-coding by source.
          const isStale = !!e.isStale;
          return (
            <line
              key={e.id}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={colourFor(e.source)} strokeWidth={1.5}
              strokeDasharray={isStale ? '4 3' : undefined}
              opacity={isStale ? 0.35 : 0.65}
              markerEnd={`url(#${marker})`}
            />
          );
        })}

        {nodes.map((node) => {
          const pos = nodePositions[node.id];
          return (
            <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
              <rect width={BOX_W} height={BOX_H} rx={6} ry={6}
                fill="var(--color-bg)"
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <text x={BOX_W / 2} y={BOX_H / 2 - 4} textAnchor="middle"
                fontSize={12} fontWeight={500}
                fill="var(--color-text)"
                style={{ pointerEvents: 'none' }}
              >
                {node.name.length > 22 ? node.name.slice(0, 21) + '…' : node.name}
              </text>
              <text x={BOX_W / 2} y={BOX_H / 2 + 12} textAnchor="middle"
                fontSize={10} fill="var(--color-text-muted)"
                style={{ pointerEvents: 'none' }}
              >
                {node.degree} edge{node.degree === 1 ? '' : 's'}
              </text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
