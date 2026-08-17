import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { apiClient } from '../api/client';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Card from '../components/Card';
import { useOrgContext } from '../stores/orgContext';
import ExportMenu from '../components/ExportMenu';
import { usePermissions } from '../hooks/usePermissions';
import ConfirmDialog from '../components/ConfirmDialog';
import IconButton from '../components/IconButton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { renderNavIcon } from '../components/navIcons';
import { useToastStore } from '../stores/toastStore';
import TruncatedText from '../components/TruncatedText';
import { useSortedList } from '../hooks/useSortedList';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import InfoTip from '../components/InfoTip';
import { SkeletonRows } from '../components/Skeleton';
import BatchMappingWizard from '../components/BatchMappingWizard';

// ── Types ──

interface StepInfo {
  stepId: string;
  stepName: string;
  level: string;
  activityId: string;
  /** Backend-built breadcrumb: `Value Stream > Process > … > Activity`. */
  path: string;
}

interface AssetInfo {
  assetId: string;
  assetName: string;
  assetDescription: string;
  governanceTier: string;
  healthScore: number;
}

interface PolicyInfo {
  policyId: string;
  policyName: string;
  policyCode: string;
  documentType: string;
  status: string;
}

interface AttachmentInfo {
  attachmentId: string;
  name: string;
  type: string;
  fileName: string;
  url: string;
  mimeType: string;
  fileSize: number;
}

interface Mapping {
  id: string;
  processStepId: string;
  dataAssetId: string;
  policyId?: string;
  attachmentId?: string;
  linkType: string;
  notes: string;
  aiSuggested: boolean;
  userOverridden: boolean;
  createdAt: string;
  stepInfo: StepInfo | null;
  assetInfo: AssetInfo | null;
  policyInfo: PolicyInfo | null;
  attachmentInfo: AttachmentInfo | null;
}

interface FlatNode {
  id: string;
  parentId: string | null;
  level: string;
  name: string;
  orgId: string;
  orgIds: string[];
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

const LINK_TYPES = ['consumes', 'produces', 'transforms', 'references'];

// ── Helpers ──

/** Render the activity breadcrumb using the backend-supplied path. */
function formatStepPath(info: StepInfo): string {
  return info.path || info.stepName;
}

type MappingTarget =
  | { kind: 'asset';      label: string; sub: string | null }
  | { kind: 'policy';     label: string; sub: string | null }
  | { kind: 'attachment'; label: string; sub: string | null }
  | { kind: 'orphan';     label: string; sub: string | null }
  | { kind: 'unknown';    label: string; sub: string | null };

/** Resolve what this mapping points at — a data asset, a governance
 *  document, an attachment, or an orphan (target deleted). The
 *  Mapping table renders one "Target" column on top of this so the
 *  three legitimate link kinds and the orphan state all show up
 *  meaningfully. */
function resolveTarget(m: Mapping): MappingTarget {
  if (m.assetInfo) {
    return { kind: 'asset', label: m.assetInfo.assetName, sub: m.assetInfo.governanceTier || null };
  }
  if (m.policyInfo) {
    const sub = [m.policyInfo.policyCode, m.policyInfo.documentType].filter(Boolean).join(' · ') || null;
    return { kind: 'policy', label: m.policyInfo.policyName, sub };
  }
  if (m.attachmentInfo) {
    return { kind: 'attachment', label: m.attachmentInfo.name, sub: m.attachmentInfo.fileName || null };
  }
  // Carried an id but no info — the linked entity was deleted.
  if (m.dataAssetId) {
    return { kind: 'orphan', label: 'Data asset deleted', sub: shortId(m.dataAssetId) };
  }
  if (m.policyId) {
    return { kind: 'orphan', label: 'Governance document deleted', sub: shortId(m.policyId) };
  }
  if (m.attachmentId) {
    return { kind: 'orphan', label: 'Attachment deleted', sub: shortId(m.attachmentId) };
  }
  return { kind: 'unknown', label: '—', sub: null };
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// ── Component ──

export default function MappingsPage({
  embedded = false,
  actionsPortal,
}: {
  embedded?: boolean;
  /** When embedded in the Process ↔ Data map hub, the toolbar portals into
   *  this slot (on the Visual/Table toggle row) instead of a strip below. */
  actionsPortal?: HTMLElement | null;
} = {}) {
  const { activeOrgId } = useOrgContext();
  const { canWrite } = usePermissions();
  const addToast = useToastStore((s) => s.addToast);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [allNodes, setAllNodes] = useState<FlatNode[]>([]);
  const [dataAssets, setDataAssets] = useState<DataAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showBatchWizard, setShowBatchWizard] = useState(false);

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
      const [mappingsRes, nodesRes, assetsRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: Mapping[] }>(`/mappings${query}`),
        apiClient.get<{ success: boolean; data: FlatNode[] }>(`/process-catalog${query}`),
        apiClient.get<{ success: boolean; data: DataAsset[] }>(`/data-assets${query}`),
      ]);
      setMappings(mappingsRes.data || []);
      setAllNodes(nodesRes.data || []);
      setDataAssets(assetsRes.data || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load mappings');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Deep-link prefill: the Enterprise View "Connect data / system →" action
  // links here with ?newFor=<activityId>. Resolve the activity's ancestor chain
  // (value stream → process → sub-process → activity) to prime the cascading
  // selects and open the add-mapping form, then strip the param so a re-render
  // doesn't reopen it. Runs once, after the catalog nodes have loaded.
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillHandled = useRef(false);
  useEffect(() => {
    const newFor = searchParams.get('newFor');
    if (!newFor || prefillHandled.current || allNodes.length === 0) return;
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const target = byId.get(newFor);
    if (!target) return;
    prefillHandled.current = true;
    let vs = '', proc = '', sp = '', step = '';
    let cur: FlatNode | undefined = target;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.level === 'ACTIVITY' || cur.level === 'TASK' || cur.level === 'EXECUTION') { if (!step) step = cur.id; }
      else if (cur.level === 'SUBPROCESS') sp = cur.id;
      else if (cur.level === 'PROCESS') proc = cur.id;
      else if (cur.level === 'VALUE_STREAM') vs = cur.id;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (step) {
      setSelectedVsId(vs); setSelectedProcId(proc); setSelectedSpId(sp); setSelectedStepId(step);
      setSelectedAssetId(''); setLinkType('references'); setNotes('');
      setShowForm(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('newFor');
    setSearchParams(next, { replace: true });
  }, [searchParams, allNodes, setSearchParams]);

  // Cascading dropdowns based on flat node model with parentId relationships.
  // Each level filters by the parent's selection only — guarantees the
  // dropdown values are always valid children of the selected parent.
  const valueStreams = allNodes.filter((n) => n.level === 'VALUE_STREAM');
  const processes = selectedVsId
    ? allNodes.filter((n) => n.level === 'PROCESS' && n.parentId === selectedVsId)
    : [];
  const subProcesses = selectedProcId
    ? allNodes.filter((n) => n.level === 'SUBPROCESS' && n.parentId === selectedProcId)
    : [];
  // Activities can be direct children of PROCESS (skipping SUBPROCESS) or
  // children of SUBPROCESS. Show whichever is appropriate based on what's
  // selected.
  const steps = selectedSpId
    ? allNodes.filter((n) => n.level === 'ACTIVITY' && n.parentId === selectedSpId)
    : selectedProcId && subProcesses.length === 0
      ? allNodes.filter((n) => n.level === 'ACTIVITY' && n.parentId === selectedProcId)
      : [];

  // Gap indicators computed from existing data
  const mappedStepIds = useMemo(() => new Set(mappings.map((m) => m.processStepId)), [mappings]);
  const mappedAssetIds = useMemo(() => new Set(mappings.map((m) => m.dataAssetId)), [mappings]);
  const MAPPABLE_LEVELS = new Set(['ACTIVITY', 'TASK', 'EXECUTION']);
  const unmappedCount = useMemo(() => allNodes.filter((n) => MAPPABLE_LEVELS.has(n.level) && !mappedStepIds.has(n.id)).length, [allNodes, mappedStepIds]);
  const unlinkedCount = useMemo(() => dataAssets.filter((a) => !mappedAssetIds.has(a.id)).length, [dataAssets, mappedAssetIds]);

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
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    resetForm();
    setShowForm(true);
  };

  const handleCancel = () => {
    resetForm();
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!selectedStepId || !selectedAssetId) return;
    try {
      await apiClient.post('/mappings', {
        processStepId: selectedStepId,
        dataAssetId: selectedAssetId,
        linkType,
        notes,
        aiSuggested: false,
        ...(activeOrgId ? { orgId: activeOrgId } : {}),
      });
      addToast('success', 'Mapping created');
      setShowForm(false);
      resetForm();
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to create mapping');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/mappings/${id}`);
      addToast('success', 'Mapping deleted');
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to delete mapping');
    }
  };

  const handleBulkDelete = async () => {
    if (sel.count === 0) return;
    const count = sel.count;
    try {
      await Promise.all(Array.from(sel.selectedIds).map((id) => apiClient.delete(`/mappings/${id}`)));
      addToast('success', `Deleted ${count} mapping${count === 1 ? '' : 's'}`);
      sel.clear();
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Bulk delete failed');
      fetchData();
    }
  };

  // Orphans = mappings whose linked entity has been deleted. The activity
  // side and the target side are tracked separately because the user
  // experience is different — an orphan activity row is harder to
  // recover ("which activity did this point at?") than an orphan target.
  const orphans = useMemo(
    () => mappings.filter((m) => !m.stepInfo
      || (m.dataAssetId && !m.assetInfo)
      || (m.policyId && !m.policyInfo)
      || (m.attachmentId && !m.attachmentInfo)),
    [mappings],
  );
  const [confirmOrphanCleanup, setConfirmOrphanCleanup] = useState(false);

  const cleanupOrphans = async () => {
    setConfirmOrphanCleanup(false);
    if (orphans.length === 0) return;
    try {
      await Promise.all(orphans.map((m) => apiClient.delete(`/mappings/${m.id}`)));
      addToast('success', `Deleted ${orphans.length} orphaned mapping${orphans.length === 1 ? '' : 's'}.`);
      fetchData();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Orphan cleanup failed');
      fetchData();
    }
  };

  // Sort: comparators keyed by column name; URL persists ?sort=&dir=
  const { sorted, sortKey, sortDir, toggleSort } = useSortedList(
    mappings,
    {
      stepPath: (a, b) => {
        // Orphans sort to the end so the active rows stay together at the top.
        const ao = a.stepInfo ? 0 : 1;
        const bo = b.stepInfo ? 0 : 1;
        if (ao !== bo) return ao - bo;
        const pa = a.stepInfo ? formatStepPath(a.stepInfo) : a.processStepId;
        const pb = b.stepInfo ? formatStepPath(b.stepInfo) : b.processStepId;
        return pa.localeCompare(pb);
      },
      target: (a, b) => {
        const ta = resolveTarget(a);
        const tb = resolveTarget(b);
        // Orphans / unknowns to the end.
        const ao = ta.kind === 'orphan' || ta.kind === 'unknown' ? 1 : 0;
        const bo = tb.kind === 'orphan' || tb.kind === 'unknown' ? 1 : 0;
        if (ao !== bo) return ao - bo;
        return ta.label.localeCompare(tb.label);
      },
      linkType: (a, b) => a.linkType.localeCompare(b.linkType),
      ai: (a, b) => Number(b.aiSuggested) - Number(a.aiSuggested),
      notes: (a, b) => (a.notes || '').localeCompare(b.notes || ''),
    },
    'stepPath',
  );

  const sel = useRowSelection(sorted, (m) => m.id);

  const canSave = selectedStepId && selectedAssetId;

  const mappingColumns: DataTableColumn<Mapping>[] = [
    {
      key: 'stepPath', header: 'Process Activity', sortable: true, cellStyle: { fontWeight: 500, maxWidth: 300 },
      render: (m) => m.stepInfo ? (
        <TruncatedText text={formatStepPath(m.stepInfo)} />
      ) : (
        <span
          title={`Original processStepId: ${m.processStepId}\nThe activity this mapping pointed at no longer exists — likely deleted or regenerated. Delete the row to clean it up.`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '2px 8px', borderRadius: 4,
            fontSize: 12, fontWeight: 600,
            background: '#fee2e2', color: '#991b1b',
            border: '1px solid #fca5a5',
          }}
        >
          <span aria-hidden="true">⚠</span>
          Activity deleted ({shortId(m.processStepId)})
        </span>
      ),
    },
    {
      key: 'target', header: 'Target', sortable: true,
      render: (m) => {
        const t = resolveTarget(m);
        if (t.kind === 'orphan' || t.kind === 'unknown') {
          return (
            <span
              title={t.sub ? `Original id: ${t.sub}` : 'No target linked.'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '2px 8px', borderRadius: 4,
                fontSize: 12, fontWeight: 600,
                background: t.kind === 'orphan' ? '#fee2e2' : 'var(--color-bg)',
                color: t.kind === 'orphan' ? '#991b1b' : 'var(--color-text-muted)',
                border: t.kind === 'orphan' ? '1px solid #fca5a5' : '1px solid var(--color-border)',
              }}
            >
              {t.kind === 'orphan' && <span aria-hidden="true">⚠</span>}
              {t.label}
            </span>
          );
        }
        const kindLabel =
          t.kind === 'asset' ? 'Asset' :
          t.kind === 'policy' ? 'Document' :
          'Attachment';
        const kindColor =
          t.kind === 'asset' ? { bg: '#dbeafe', fg: '#1e40af' } :
          t.kind === 'policy' ? { bg: '#ede9fe', fg: '#5b21b6' } :
          { bg: '#fef3c7', fg: '#92400e' };
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: 3,
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                background: kindColor.bg, color: kindColor.fg,
                textTransform: 'uppercase',
              }}
            >
              {kindLabel}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{t.label}</div>
              {t.sub && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t.sub}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'linkType', header: 'Link Type', sortable: true,
      render: (m) => (
        <span
          style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 4,
            fontSize: 11, fontWeight: 500,
            background: 'var(--color-primary-light)', color: 'var(--color-primary)',
          }}
        >
          {m.linkType}
        </span>
      ),
    },
    {
      key: 'ai', header: 'AI Suggested', sortable: true,
      render: (m) => m.aiSuggested ? (
        <span
          style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 4,
            fontSize: 11, fontWeight: 500,
            background: '#dbeafe', color: '#1d4ed8',
          }}
        >
          AI Suggested
        </span>
      ) : (
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>Manual</span>
      ),
    },
    {
      key: 'notes', header: 'Notes', sortable: true, cellStyle: { maxWidth: 200 },
      render: (m) => (
        <TruncatedText text={m.notes} emptyPlaceholder="--" />
      ),
    },
    {
      key: 'actions', header: 'Actions', align: 'center' as const, width: 60,
      render: (m) => canWrite ? <IconButton size="sm" icon="trash" label="Delete" variant="danger" onClick={() => setConfirmDelete(m.id)} /> : null,
    },
  ];

  // Shared toolbar actions — rendered inside the PageHeader on the
  // standalone page, or as a right-aligned strip when embedded in the
  // combined Process ↔ Data map (which supplies its own header).
  const headerActions = (
    <>
      {canWrite && (
        <IconButton icon="settings" label="Batch mapping wizard" onClick={() => setShowBatchWizard(true)} />
      )}
      {mappings.length > 0 && (
        <ExportMenu build={() => ({
          filenameBase: 'mappings',
          sheetName: 'Mappings',
          headers: ['Process Activity', 'Target Kind', 'Target', 'Link Type', 'AI Suggested', 'Notes'],
          rows: mappings.map((m) => {
            const t = resolveTarget(m);
            const activityLabel = m.stepInfo
              ? formatStepPath(m.stepInfo)
              : `(deleted activity ${shortId(m.processStepId)})`;
            return [
              activityLabel,
              t.kind,
              t.label,
              m.linkType,
              m.aiSuggested ? 'Yes' : 'No',
              m.notes,
            ];
          }),
        })} />
      )}
      {canWrite && (
        <IconButton icon="plus" label="Add mapping" variant="primary" onClick={openForm} />
      )}
    </>
  );

  return (
    <div>
      {embedded ? (
        // Hub supplies actionsPortal (the toggle row) — portal the toolbar
        // onto it so it sits level with the Visual/Table switch, matching the
        // other hubs. Inline strip is only a fallback if no slot is supplied.
        actionsPortal !== undefined ? (
          actionsPortal ? createPortal(headerActions, actionsPortal) : null
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            {headerActions}
          </div>
        )
      ) : (
        <PageHeader
          title="Data Mapping"
          subtitle={
            <>Flat audit view of every activity ↔ data-asset mapping, with bulk add / delete and a batch wizard. The day-to-day place to <em>create</em> these links is inline on each activity in the Process Catalog — this page is for cross-process review and bulk edits.</>
          }
          actions={headerActions}
        >
          <InfoTip term="Mapping" />
        </PageHeader>
      )}

      {/* Coverage gaps */}
      {!loading && (unmappedCount > 0 || unlinkedCount > 0) && (
        <div style={{
          display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap',
        }}>
          {unmappedCount > 0 && (
            <Link
              to="/gap-detection"
              title="Review unmapped activities on Gap Detection"
              style={{ flex: 1, minWidth: 200, textDecoration: 'none' }}
            >
              <div
                style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: '#fef2f2', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--color-error)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#fca5a5'; }}
              >
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-error)' }}>{unmappedCount}</span>
                <span style={{ fontSize: 12, color: '#991b1b' }}>activities have no data asset linked</span>
                <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--color-error)', fontWeight: 700 }}>&rarr;</span>
              </div>
            </Link>
          )}
          {unlinkedCount > 0 && (
            <Link
              to="/data-assets?mapping=unmapped"
              title="View data assets not mapped to any process"
              style={{ flex: 1, minWidth: 200, textDecoration: 'none' }}
            >
              <div
                style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: '#fffbeb', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--color-warning)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#fcd34d'; }}
              >
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-warning)' }}>{unlinkedCount}</span>
                <span style={{ fontSize: 12, color: '#92400e' }}>data assets are not mapped to any process</span>
                <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--color-warning)', fontWeight: 700 }}>&rarr;</span>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Orphan mappings — usually the result of an activity / asset
          being deleted after a mapping was created (commonly: an agent
          draft was promoted, then the source activity got regenerated
          by the Process Wizard). Lets users clean these up in one click
          without hunting through the table. */}
      {!loading && orphans.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', marginBottom: 16,
          borderRadius: 'var(--radius-md)',
          background: '#fef2f2', border: '1px solid #fca5a5',
        }}>
          <span aria-hidden="true" style={{ fontSize: 16, color: 'var(--color-error)' }}>⚠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>
              {orphans.length} orphan mapping{orphans.length === 1 ? '' : 's'} found
            </div>
            <div style={{ fontSize: 11, color: '#7f1d1d' }}>
              Either the activity or the linked target has been deleted. Clean these up to keep the catalog accurate.
            </div>
          </div>
          {canWrite && (
            <Button
              variant="secondary"
              onClick={() => setConfirmOrphanCleanup(true)}
              style={{
                padding: '6px 12px',
                background: '#fff', borderColor: '#fca5a5', color: '#991b1b',
              }}
            >
              Delete all orphans
            </Button>
          )}
        </div>
      )}

      {/* Add Form */}
      {showForm && (
        <Card padding={20} marginBottom={20}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add New Mapping</h3>

          {/* Hierarchical step selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Value Stream *</label>
              <select
                aria-label="Value Stream"
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
                aria-label="Process"
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
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>
                Sub-Process {subProcesses.length > 0 ? '*' : <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>}
              </label>
              <select
                aria-label="Sub-Process"
                style={selectStyle}
                value={selectedSpId}
                disabled={!selectedProcId || subProcesses.length === 0}
                onChange={(e) => {
                  setSelectedSpId(e.target.value);
                  setSelectedStepId('');
                }}
              >
                <option value="">{subProcesses.length === 0 ? '-- No sub-processes --' : '-- Select sub-process --'}</option>
                {subProcesses.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Activity *</label>
              <select
                aria-label="Activity"
                style={selectStyle}
                value={selectedStepId}
                disabled={!selectedProcId || (subProcesses.length > 0 && !selectedSpId) || steps.length === 0}
                onChange={(e) => setSelectedStepId(e.target.value)}
              >
                <option value="">{steps.length === 0 && selectedProcId ? '-- No activities defined --' : '-- Select activity --'}</option>
                {steps.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Data Asset *</label>
              <select aria-label="Data Asset" style={selectStyle} value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}>
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
              <select aria-label="Link Type" style={selectStyle} value={linkType} onChange={(e) => setLinkType(e.target.value)}>
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
                aria-label="Notes"
                style={inputStyle}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this mapping"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canSave}
              onClick={handleSave}
            >
              Add Mapping
            </Button>
          </div>
        </Card>
      )}


      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <BulkActionButton variant="danger" onClick={() => setConfirmBulkDelete(true)}>Delete selected</BulkActionButton>
      </BulkActionBar>

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
        message={`Delete ${sel.count} selected items? This cannot be undone.`}
        confirmLabel="Delete Selected"
        onConfirm={async () => {
          setConfirmBulkDelete(false);
          await handleBulkDelete();
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      <ConfirmDialog
        open={confirmOrphanCleanup}
        title={`Delete ${orphans.length} orphan mapping${orphans.length === 1 ? '' : 's'}?`}
        message="Orphan mappings point at activities or targets that no longer exist. Deleting them only removes the broken rows — the surviving activities, assets, and documents are untouched."
        confirmLabel="Delete orphans"
        onConfirm={cleanupOrphans}
        onCancel={() => setConfirmOrphanCleanup(false)}
      />

      {/* Table */}
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'auto',
        }}
      >
        {loading ? (
          <SkeletonRows rows={5} columns={7} />
        ) : loadError && mappings.length === 0 ? (
          <ErrorState
            title="Couldn't load mappings"
            message={loadError}
            onRetry={() => { setLoadError(null); setLoading(true); fetchData(); }}
          />
        ) : mappings.length === 0 && !showForm ? (
          <EmptyState
            icon={renderNavIcon('/mappings')}
            title="No mappings yet"
            description="Mappings link your data assets to the process activities they support. They're how Procela knows which processes a piece of data flows through (and where the gaps are)."
            action={{ label: '+ Add Mapping', onClick: openForm }}
          />
        ) : (
          <DataTable
            rows={sorted}
            columns={mappingColumns}
            rowKey={(m) => m.id}
            selection={sel}
            sort={{ sortKey, sortDir, onSort: toggleSort }}
            selectAllLabel="Select all mappings"
            emptyMessage="No mappings match the current filters."
          />
        )}
      </div>

      <BatchMappingWizard
        open={showBatchWizard}
        onClose={() => setShowBatchWizard(false)}
        orgId={activeOrgId || ''}
        onCreated={fetchData}
      />
    </div>
  );
}
