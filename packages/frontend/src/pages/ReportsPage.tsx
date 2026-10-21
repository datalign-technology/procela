import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { SkeletonRows } from '../components/Skeleton';
import PageHeader from '../components/PageHeader';
import { useBreadcrumbLeaf } from '../components/BreadcrumbContext';
import ExportMenu from '../components/ExportMenu';
import ListToolbar from '../components/ListToolbar';
import DataTable, { type DataTableColumn } from '../components/DataTable';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPicker, type ColumnPickerState } from '../hooks/useColumnPicker';
import Modal from '../components/Modal';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';
import IconButton, { Icon } from '../components/IconButton';
import SecondaryButton from '../components/SecondaryButton';
import Button from '../components/Button';
import TruncatedText from '../components/TruncatedText';
import { renderNavIcon } from '../components/navIcons';
import { useSortedList } from '../hooks/useSortedList';
import { useRowSelection } from '../hooks/useRowSelection';
import BulkActionBar, { BulkActionButton } from '../components/BulkActionBar';
import type { Cell, ExportPayload } from '../lib/export';
import { exportData } from '../lib/export';
import { fetchReportFolders, NO_FOLDER, type ReportFolder } from '../lib/reportFolders';
import { useSortable, DragHandle, sortableIndicatorStyle, type DropMode } from '../components/Sortable';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { useBrandingStore } from '../stores/brandingStore';
import { useAuthStore } from '../stores/authStore';

interface UserReportSummary {
  id: string;
  name: string;
  description: string;
  visibility: 'private' | 'org';
  folderId: string | null;
  primaryEntity: string;
  columnCount: number;
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  runCount: number;
  scheduleFrequency: 'off' | 'daily' | 'weekly' | 'monthly';
  updatedAt: string;
}

// Column-picker set — the Report (name) and Actions columns are always shown;
// the rest are user-toggleable (defaulting on, so the list is unchanged until
// a user hides something).
// The name column carries the description as a sub-line and the Sharing column
// folds in the folder, so neither is a separate toggle any more.
type ReportColId = 'sharing' | 'source' | 'columns' | 'lastRun';
const REPORT_COLUMN_DEFS: Array<{ id: ReportColId; label: string; defaultVisible: boolean }> = [
  { id: 'source',  label: 'Source',  defaultVisible: true },
  { id: 'sharing', label: 'Sharing', defaultVisible: true },
  { id: 'columns', label: 'Columns', defaultVisible: true },
  { id: 'lastRun', label: 'Last run', defaultVisible: true },
];

// Friendly fallback for a data-model entity id when /data-model hasn't resolved
// a label yet: "dataAssets" → "Data assets".
function prettifyEntity(id: string): string {
  const s = (id || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const rowMenuBtnStyle: React.CSSProperties = {
  width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8,
  color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
};
const rowMenuStyle: React.CSSProperties = {
  position: 'absolute', top: 34, right: 0, zIndex: 30, minWidth: 160,
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 12px 24px rgba(0,0,0,0.12))',
  padding: 6, textAlign: 'left',
};
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', fontSize: 13, color: 'var(--color-text)',
  background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
};
const filterSelectStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4, padding: '5px 10px',
  fontSize: 12, background: 'var(--color-surface)', color: 'var(--color-text)', appearance: 'auto',
};

interface RunResult {
  columns: Array<{ field: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  totalMatched: number;
}

// The stored report definition (GET /reports/:id → data.definition), used by
// the detail modal to show what the report selects without opening the Builder.
interface ReportColumn { field: string; label?: string }
interface ReportFilter { field: string; op: string; value?: string | number | boolean }
interface ReportDefinition {
  entity: string;
  columns: ReportColumn[];
  filters: ReportFilter[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}
interface ReportDetail {
  definition: ReportDefinition;
  schedule?: { frequency?: string } | null;
}

// Plain-English operator words, so a filter reads as a sentence
// ("Governance tier is Bronze") instead of a field code + symbol.
const FILTER_OP_WORDS: Record<string, string> = {
  eq: 'is', neq: 'is not', gt: 'is greater than', gte: 'is at least',
  lt: 'is less than', lte: 'is at most', contains: 'contains',
  startsWith: 'starts with', endsWith: 'ends with', in: 'is one of',
  notIn: 'is not one of', isNull: 'is empty', isNotNull: 'is not empty',
};

// Turn a field key into a readable label: "governanceTier" → "Governance
// tier", "owner.name" → "Owner name" (joined-field path flattened).
// Render a result cell as readable text for the inline results table.
function formatReportCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function prettyField(key: string): string {
  return (key || '')
    .split('.')
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '))
    .join(' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

// Download formats offered in the results modal (Print is a separate action,
// so PDF is not listed here — see the decoupled Print button).
const DOWNLOAD_FORMATS = ['csv', 'xlsx', 'json', 'clipboard'] as const;

function toExportCell(v: unknown): Cell {
  if (v == null) return '';
  if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Turn an already-run result into an export payload — used by both Download
// and Print so neither re-runs the report (run and export are decoupled).
// The `logoUrl` (tenant branding) rides along in `header` so the PDF/print
// output carries the same letterhead the results modal shows on screen; the
// data-only formats (CSV/XLSX/JSON) ignore it.
function resultToPayload(
  report: UserReportSummary,
  result: RunResult,
  opts?: { logoUrl?: string; companyName?: string; userName?: string },
): ExportPayload {
  const name = report.name;
  const headers = result.columns.map((c) => c.label);
  const rows: Cell[][] = result.rows.map((row) => result.columns.map((c) => toExportCell(row[c.field])));
  const base = (name || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
  const footer = [
    opts?.companyName,
    name || 'Report',
    `Generated ${new Date().toLocaleDateString()}`,
    opts?.userName ? `by ${opts.userName}` : null,
  ].filter(Boolean).join('  ·  ');
  return {
    filenameBase: base, headers, rows, sheetName: name || 'Report',
    header: { title: name || 'Report', description: report.description || undefined, logoUrl: opts?.logoUrl, companyName: opts?.companyName },
    footer,
  };
}

const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
  marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: bg, color, whiteSpace: 'nowrap',
});

const backLinkStyle: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--color-surface)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none',
};

// A folder row in the rail. A module-level component (not an inline render
// function) so its useSortable state survives a parent re-render mid-drag.
// User folders get a drag handle and are reorder targets; the system Public
// folder is pinned first — a spacer keeps its label aligned, but it can't be
// dragged or dropped onto.
function FolderRailRow({ folder, active, count, onSelect, onEdit, onReorder }: {
  folder: ReportFolder;
  active: boolean;
  count: number;
  onSelect: () => void;
  onEdit: () => void;
  onReorder: (draggedId: string, targetId: string, mode: DropMode) => void;
}) {
  const isUser = folder.kind === 'user';
  // Reorder-only: no canDropInside, so the middle zone is never offered.
  const { dragging, dropMode, handleProps, rowProps } = useSortable<Record<string, never>>({
    id: folder.id, group: 'report-folders', data: {}, draggable: isUser, onMove: onReorder,
  });
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      {...(isUser ? rowProps : {})}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', fontSize: 13, borderRadius: 6, cursor: 'pointer', marginBottom: 2,
        fontWeight: 600,
        background: active ? 'var(--color-primary-light)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text)',
        ...(isUser ? sortableIndicatorStyle(dropMode, dragging) : {}),
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-bg)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {isUser
        ? <DragHandle {...handleProps} size={12} title={`Drag to reorder ${folder.name}`} onClick={(e) => e.stopPropagation()} />
        : <span style={{ width: 12, flexShrink: 0 }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{folder.name}</span>
        {folder.shared && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-primary)', letterSpacing: '0.04em', flexShrink: 0 }}>SHARED</span>}
      </span>
      {isUser && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Edit folder ${folder.name}`}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onEdit(); } }}
          style={{ flexShrink: 0, display: 'inline-flex', color: 'var(--color-text-muted)', cursor: 'pointer' }}
        >
          <Icon name="edit" size={12} />
        </span>
      )}
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </div>
  );
}

// ── User Reports — saved Report Builder definitions ────────────────────────

function UserReportsTab({ focusReportId, reportCols }: { focusReportId?: string; reportCols: ColumnPickerState<ReportColId> }) {
  const navigate = useNavigate();
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  // Brand logo + company name for the report letterhead (shown in the results
  // modal and the printed/PDF output), and the signed-in user for the footer's
  // "generated by" provenance.
  const logoUrl = useBrandingStore((s) => s.branding.logoUrl);
  const rawCompanyName = useBrandingStore((s) => s.branding.companyName);
  // A report is a customer-facing artifact, so don't stamp Procela's own name
  // (the shipped branding default) on its letterhead/footer. A tenant that set
  // its own company name still gets it; the default is treated as "unset".
  const companyName = rawCompanyName && rawCompanyName !== 'Procela' ? rawCompanyName : undefined;
  const userName = useAuthStore((s) => s.user?.name);
  const [reports, setReports] = useState<UserReportSummary[] | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  // The produced report shown in the results modal — the result of a Run.
  // Download/Print in the modal act on this cached data, never re-running.
  const [result, setResult] = useState<{ report: UserReportSummary; data: RunResult } | null>(null);
  // Row click opens a read-only detail "window" for the report definition,
  // with Run + Edit (→ Builder) in the header — the Data Assets / Systems
  // detail-modal pattern. `detail` holds the fetched definition + schedule.
  const [viewingReport, setViewingReport] = useState<UserReportSummary | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Detail page (/reports/:id): Results / Definition / Schedule tabs, and the
  // report run inline on the page (no pop-up) under the Results tab.
  const [detailTab, setDetailTab] = useState<'results' | 'definition' | 'schedule'>('results');
  const [inlineRun, setInlineRun] = useState<RunResult | null>(null);
  const [inlineRunning, setInlineRunning] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Folder rail: the org's folders, the selected filter, and the two folder
  // dialogs (create/edit a folder; move a report into a folder).
  const [folders, setFolders] = useState<ReportFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('all'); // 'all' | NO_FOLDER | folderId
  const [folderModal, setFolderModal] = useState<{ mode: 'create' | 'edit'; id?: string; name: string; shared: boolean } | null>(null);
  const [moveReport, setMoveReport] = useState<UserReportSummary | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>(''); // '' = no folder
  const [busy, setBusy] = useState(false);

  // Friendly source labels pulled from the live data model (same source the
  // Builder uses), so the list shows "Data assets", not the code "dataAssets".
  const [entityLabels, setEntityLabels] = useState<Record<string, string>>({});
  const entityLabel = (id: string) => entityLabels[id] || prettifyEntity(id);
  // Full entity list (id · label · description) for the empty-state starter
  // cards ("start from what you want to list").
  const [starterEntities, setStarterEntities] = useState<{ id: string; label: string; description: string }[]>([]);

  // Above-the-table filters + search.
  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterSharing, setFilterSharing] = useState('');
  const [filterSchedule, setFilterSchedule] = useState('');

  // Row ⋯ overflow menu.
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  useEffect(() => {
    apiClient.get<{ success: boolean; data: { entities: Array<{ id: string; label: string; description?: string }> } }>('/data-model')
      .then((r) => {
        const es = r.data?.entities || [];
        setEntityLabels(Object.fromEntries(es.map((e) => [e.id, e.label])));
        setStarterEntities(es.map((e) => ({ id: e.id, label: e.label, description: e.description || '' })));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!activeOrgId) { setReports([]); return; }
    apiClient.get<{ success: boolean; data: UserReportSummary[] }>(`/reports?orgId=${activeOrgId}`)
      .then((r) => setReports(r.data || []))
      .catch(() => setReports([]));
  }, [activeOrgId]);

  const loadFolders = useCallback(() => {
    if (!activeOrgId) { setFolders([]); return; }
    fetchReportFolders(activeOrgId).then(setFolders).catch(() => setFolders([]));
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadFolders(); }, [loadFolders]);

  // Fetch the full definition (columns / filters / sort / schedule) when a
  // report's detail window opens.
  useEffect(() => {
    if (!viewingReport) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    apiClient.get<{ success: boolean; data: ReportDetail }>(`/reports/${viewingReport.id}`)
      .then((r) => { if (!cancelled) setDetail(r.data); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [viewingReport]);

  // Run the report inline on the detail page (no pop-up). Uses the preview
  // endpoint against the saved definition so the Results tab shows live rows.
  const runInline = useCallback(async () => {
    if (!activeOrgId || !detail) return;
    setInlineRunning(true); setInlineError(null);
    try {
      const res = await apiClient.post<{ success: boolean; data: RunResult }>(`/reports/preview`, {
        orgId: activeOrgId, definition: { ...detail.definition, limit: 100 },
      });
      setInlineRun(res.data);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setInlineError(e?.response?.data?.error || 'Run failed'); setInlineRun(null);
    } finally { setInlineRunning(false); }
  }, [activeOrgId, detail]);

  // Auto-run once the definition loads on the detail page, so Results isn't empty.
  useEffect(() => {
    setInlineRun(null); setInlineError(null);
    if (focusReportId && detail) runInline();
  }, [focusReportId, detail, runInline]);

  // Detail route (/reports/:id): once the list has loaded, select the focused
  // report so the definition-fetch effect above runs; end the trail on its name.
  useEffect(() => {
    if (!focusReportId || !reports) return;
    const r = reports.find((x) => x.id === focusReportId);
    if (r) setViewingReport(r);
  }, [focusReportId, reports]);
  useBreadcrumbLeaf(focusReportId ? viewingReport?.name : undefined);

  const folderName = (id: string | null): string | null =>
    (id ? folders.find((f) => f.id === id)?.name ?? null : null);

  const countFor = (key: string): number => {
    if (!reports) return 0;
    if (key === 'all') return reports.length;
    if (key === NO_FOLDER) return reports.filter((r) => !r.folderId).length;
    return reports.filter((r) => r.folderId === key).length;
  };

  // Drag-to-reorder the user folders in the rail. Splices the dragged folder to
  // its new position, renumbers the user folders 0..n-1, and PATCHes only the
  // ones that moved (orderIndex is a positional change, not owner-gated). The
  // system Public folder stays pinned first regardless.
  const reorderFolder = async (draggedId: string, targetId: string, mode: DropMode) => {
    if (!activeOrgId || draggedId === targetId || mode === 'inside') return;
    const list = folders.filter((f) => f.kind === 'user');
    const dragged = list.find((f) => f.id === draggedId);
    if (!dragged || !list.some((f) => f.id === targetId)) return;
    const arr = list.filter((f) => f.id !== draggedId);
    let insertAt = arr.findIndex((f) => f.id === targetId);
    if (insertAt < 0) return;
    if (mode === 'after') insertAt += 1;
    arr.splice(insertAt, 0, dragged);
    const updates = arr
      .map((f, i) => ({ f, i }))
      .filter(({ f, i }) => f.orderIndex !== i)
      .map(({ f, i }) => apiClient.patch(`/report-folders/${f.id}`, { orderIndex: i }));
    if (!updates.length) return;
    // Optimistic: show the new order immediately, then reconcile from the server.
    const rank = new Map(arr.map((f, i) => [f.id, i]));
    setFolders((prev) => [...prev].sort((a, b) => {
      if (a.kind === 'system') return -1;
      if (b.kind === 'system') return 1;
      return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
    }));
    try {
      await Promise.all(updates);
    } catch {
      addToast('error', 'Reorder failed');
    } finally {
      fetchReportFolders(activeOrgId).then(setFolders).catch(() => {});
    }
  };

  // Reports narrowed to the selected folder (the rail filter) plus the
  // above-the-table search / source / sharing / schedule filters.
  const visibleReports = useMemo(() => {
    let list = reports || [];
    if (selectedFolder === NO_FOLDER) list = list.filter((r) => !r.folderId);
    else if (selectedFolder !== 'all') list = list.filter((r) => r.folderId === selectedFolder);
    if (filterSource) list = list.filter((r) => r.primaryEntity === filterSource);
    if (filterSharing) list = list.filter((r) => r.visibility === filterSharing);
    if (filterSchedule) list = list.filter((r) => (filterSchedule === 'off' ? r.scheduleFrequency === 'off' : r.scheduleFrequency === filterSchedule));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
    }
    return list;
  }, [reports, selectedFolder, filterSource, filterSharing, filterSchedule, search]);

  // Distinct sources present, for the Source filter dropdown.
  const sourceOptions = useMemo(() => {
    const ids = Array.from(new Set((reports || []).map((r) => r.primaryEntity)));
    return ids.map((id) => ({ id, label: entityLabel(id) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [reports, entityLabels]);

  const hasFilters = !!(search || filterSource || filterSharing || filterSchedule);

  // Duplicate: fetch the full definition, then create a copy owned by the
  // current user (private, same folder) and refresh the list.
  const duplicate = async (r: UserReportSummary) => {
    if (!activeOrgId) return;
    try {
      const full = await apiClient.get<{ success: boolean; data: { definition: unknown; schedule?: unknown } }>(`/reports/${r.id}`);
      await apiClient.post('/reports', {
        orgId: activeOrgId,
        name: `${r.name} (copy)`,
        description: r.description || undefined,
        folderId: r.folderId || undefined,
        visibility: r.visibility,
        definition: full.data.definition,
      });
      addToast('success', `Duplicated "${r.name}".`);
      load();
    } catch {
      addToast('error', 'Could not duplicate the report.');
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      await apiClient.delete(`/reports/${id}`);
      addToast('success', `Deleted "${name}".`);
      load();
    } catch {
      addToast('error', 'Delete failed.');
    }
  };

  // Run (execute) a report: fetch its rows and open the results modal. Running
  // records a run server-side, so refresh the list for the updated "last run".
  const runReport = async (r: UserReportSummary) => {
    setRunningId(r.id);
    try {
      const res = await apiClient.post<{ success: boolean; data: RunResult }>(`/reports/${r.id}/run`, {});
      load(); // refresh run-history metadata
      setResult({ report: r, data: res.data });
    } catch (err) {
      addToast('error', `Run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningId(null);
    }
  };

  const printResult = () => {
    if (!result) return;
    if (result.data.rows.length === 0) { addToast('info', 'No rows to print.'); return; }
    exportData('pdf', resultToPayload(result.report, result.data, { logoUrl, companyName, userName })).catch((err) =>
      addToast('error', `Print failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  // ── Folder CRUD ──────────────────────────────────────────────────────────
  // Create or rename+re-share a folder from the folder dialog. A folder's
  // `shared` flag drives the audience of every report inside it, so on save we
  // refresh the reports too (their SHARED/PRIVATE badges may have flipped).
  const saveFolder = async () => {
    if (!folderModal || !activeOrgId) return;
    const name = folderModal.name.trim();
    if (!name) { addToast('error', 'Folder name is required.'); return; }
    setBusy(true);
    try {
      if (folderModal.mode === 'create') {
        const res = await apiClient.post<{ success: boolean; data: ReportFolder }>('/report-folders', { orgId: activeOrgId, name, shared: folderModal.shared });
        addToast('success', `Created folder "${name}".`);
        setSelectedFolder(res.data.id);
      } else if (folderModal.id) {
        await apiClient.patch(`/report-folders/${folderModal.id}`, { name, shared: folderModal.shared });
        addToast('success', `Updated folder "${name}".`);
      }
      setFolderModal(null);
      loadFolders();
      load();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || 'Could not save the folder.');
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async (id: string, name: string) => {
    if (!confirm(`Delete folder "${name}"? Reports inside it become uncategorized (private to their owner); the reports themselves are not deleted.`)) return;
    setBusy(true);
    try {
      await apiClient.delete(`/report-folders/${id}`);
      addToast('success', `Deleted folder "${name}".`);
      if (selectedFolder === id) setSelectedFolder('all');
      setFolderModal(null);
      loadFolders();
      load();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || 'Could not delete the folder.');
    } finally {
      setBusy(false);
    }
  };

  // Move a report into a folder (or out of all folders → private). The chosen
  // folder's shared flag re-derives the report's audience server-side.
  const moveTo = async () => {
    if (!moveReport) return;
    setBusy(true);
    try {
      await apiClient.put(`/reports/${moveReport.id}`, { folderId: moveTarget || null });
      addToast('success', `Moved "${moveReport.name}".`);
      setMoveReport(null);
      load();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      addToast('error', e?.response?.data?.error || 'Could not move the report.');
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'name', header: 'Report', sortable: true,
      render: (r: UserReportSummary) => (
        // Name on top, description as a muted sub-line beneath it (freed from
        // its own column so long names stop truncating early).
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          <span style={{ flexShrink: 0, display: 'inline-flex', color: 'var(--color-text-muted)', marginTop: 2 }}>{renderNavIcon('/reports', { size: 16 })}</span>
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={() => navigate(`/reports/${r.id}`)}
              title={r.name}
              style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text)', cursor: 'pointer', font: 'inherit', fontWeight: 600, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', display: 'block' }}
            >
              {r.name}
            </button>
            {r.description && <TruncatedText text={r.description} style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }} />}
          </div>
        </div>
      ),
    },
    reportCols.isVisible('source') && {
      key: 'source', header: 'Source', sortable: true, width: 150,
      render: (r: UserReportSummary) => <span style={{ color: 'var(--color-text-secondary)' }}>{entityLabel(r.primaryEntity)}</span>,
    },
    reportCols.isVisible('sharing') && {
      key: 'sharing', header: 'Sharing', width: 150,
      render: (r: UserReportSummary) => {
        const fname = folderName(r.folderId);
        const shared = r.visibility === 'org';
        // Board H1: a dot-pill reads sharing at a glance — teal for shared,
        // muted for private — with the folder as a sub-line beneath.
        return (
          <div style={{ minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 11, whiteSpace: 'nowrap', background: shared ? 'var(--color-primary-light)' : 'var(--color-bg)', color: shared ? 'var(--color-primary)' : 'var(--color-text-muted)', border: shared ? 'none' : '1px solid var(--color-border)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor', flexShrink: 0 }} />
              {shared ? 'Shared' : 'Private'}
            </span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fname ? fname : 'No folder'}
            </span>
          </div>
        );
      },
    },
    reportCols.isVisible('columns') && {
      key: 'columns', header: 'Columns', align: 'center', width: 90,
      render: (r: UserReportSummary) => <span style={{ color: 'var(--color-text-secondary)' }}>{r.columnCount}</span>,
    },
    reportCols.isVisible('lastRun') && {
      key: 'lastRun', header: 'Last run', sortable: true, width: 200,
      render: (r: UserReportSummary) => (
        <div style={{ color: 'var(--color-text-secondary)' }}>
          <span style={{ whiteSpace: 'nowrap' }}>
            {r.lastRunAt
              ? <>{timeAgo(r.lastRunAt)}{r.lastRunRowCount != null ? ` · ${r.lastRunRowCount.toLocaleString()} ${r.lastRunRowCount === 1 ? 'row' : 'rows'}` : ''}</>
              : <span style={{ color: 'var(--color-text-muted)' }}>Never run</span>}
          </span>
          {/* Board H1: a scheduled report wears an "Emailed {freq}" sub-line with
              a calendar glyph, not an UPPERCASE frequency tag. */}
          {r.scheduleFrequency !== 'off' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 12, color: 'var(--color-info)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="14" rx="2" /><path d="M3.5 9.5h17M8 3.5v4M16 3.5v4" /></svg>
              Emailed {r.scheduleFrequency}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions', header: '', align: 'center', width: 140,
      render: (r: UserReportSummary) => (
        // One Run button; move / edit / duplicate / delete live in the ⋯ menu
        // so a mis-click can't delete the report.
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <Button size="sm" variant="secondary" leadingIcon={<Icon name="play" size={12} />} disabled={runningId === r.id} onClick={() => runReport(r)}>
            {runningId === r.id ? 'Running…' : 'Run'}
          </Button>
          <button
            type="button" aria-label="More actions" aria-haspopup="menu"
            onClick={(e) => { e.stopPropagation(); setRowMenuId(rowMenuId === r.id ? null : r.id); }}
            style={rowMenuBtnStyle}
          >⋯</button>
          {rowMenuId === r.id && (
            <div role="menu" onClick={(e) => e.stopPropagation()} style={rowMenuStyle}>
              <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); navigate(`/reports/${r.id}`); }}>Open</button>
              <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); navigate(`/reports/builder/${r.id}`); }}>Edit in builder</button>
              <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); duplicate(r); }}>Duplicate</button>
              <button type="button" role="menuitem" style={menuItemStyle} onClick={() => { setRowMenuId(null); setMoveReport(r); setMoveTarget(r.folderId || ''); }}>Move to folder</button>
              {/* Board H1: a divider sets the destructive action apart. */}
              <div role="separator" style={{ height: 1, background: 'var(--color-border-subtle)', margin: '4px 0' }} />
              <button type="button" role="menuitem" style={{ ...menuItemStyle, color: 'var(--color-error)' }} onClick={() => { setRowMenuId(null); remove(r.id, r.name); }}>Delete report</button>
            </div>
          )}
        </div>
      ),
    },
  ].filter(Boolean) as DataTableColumn<UserReportSummary>[];

  const { sorted, sortKey, sortDir, toggleSort } = useSortedList<UserReportSummary>(
    visibleReports,
    {
      name: (a, b) => a.name.localeCompare(b.name),
      source: (a, b) => a.primaryEntity.localeCompare(b.primaryEntity),
      lastRun: (a, b) => (a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0) - (b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0),
    },
    'name',
  );

  // Row selection (over the visible/sorted rows, so select-all matches what's
  // on screen) + bulk move / delete. Cleared whenever the visible set changes
  // so a bulk action never touches rows you can no longer see.
  const sel = useRowSelection(sorted, (r) => r.id);
  useEffect(() => { sel.clear(); }, [selectedFolder, filterSource, filterSharing, filterSchedule, search, sel.clear]);
  const selectedReports = () => (reports || []).filter((r) => sel.selectedIds.has(r.id));

  const bulkDelete = async () => {
    const chosen = selectedReports();
    if (chosen.length === 0) return;
    if (!confirm(`Delete ${chosen.length} report${chosen.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    try {
      await Promise.all(chosen.map((r) => apiClient.delete(`/reports/${r.id}`)));
      addToast('success', `Deleted ${chosen.length} report${chosen.length === 1 ? '' : 's'}.`);
    } catch { addToast('error', 'Some reports could not be deleted.'); }
    sel.clear(); load();
  };

  const bulkMove = async (folderId: string) => {
    const chosen = selectedReports();
    if (chosen.length === 0) return;
    try {
      await Promise.all(chosen.map((r) => apiClient.put(`/reports/${r.id}`, { folderId: folderId || null })));
      const dest = folderId ? (folders.find((f) => f.id === folderId)?.name ?? 'folder') : 'No folder';
      addToast('success', `Moved ${chosen.length} report${chosen.length === 1 ? '' : 's'} to ${dest}.`);
    } catch { addToast('error', 'Some reports could not be moved.'); }
    sel.clear(); load();
  };

  // ── Folder rail row ────────────────────────────────────────────────────────
  const railRow = (key: string, label: string, opts?: { folder?: ReportFolder }) => {
    const active = selectedFolder === key;
    const folder = opts?.folder;
    return (
      <div
        key={key}
        onClick={() => setSelectedFolder(key)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedFolder(key); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', fontSize: 13, borderRadius: 6, cursor: 'pointer', marginBottom: 2,
          fontWeight: active ? 600 : 400,
          background: active ? 'var(--color-primary-light)' : 'transparent',
          color: active ? 'var(--color-primary)' : 'var(--color-text)',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-bg)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Aligns the label with the folder rows' drag handle (12px). */}
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          {folder?.shared && <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-primary)', letterSpacing: '0.04em', flexShrink: 0 }}>SHARED</span>}
        </span>
        {folder && folder.kind === 'user' && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Edit folder ${folder.name}`}
            onClick={(e) => { e.stopPropagation(); setFolderModal({ mode: 'edit', id: folder.id, name: folder.name, shared: folder.shared }); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setFolderModal({ mode: 'edit', id: folder.id, name: folder.name, shared: folder.shared }); } }}
            style={{ flexShrink: 0, display: 'inline-flex', color: 'var(--color-text-muted)', cursor: 'pointer' }}
          >
            <Icon name="edit" size={12} />
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{countFor(key)}</span>
      </div>
    );
  };

  const rail = (
    <Card padding={10} shadow="none" style={{ position: 'sticky', top: 12, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, padding: '0 4px' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Folders</span>
        <span
          role="button"
          tabIndex={0}
          aria-label="New folder"
          onClick={() => setFolderModal({ mode: 'create', name: '', shared: false })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFolderModal({ mode: 'create', name: '', shared: false }); } }}
          style={{ display: 'inline-flex', color: 'var(--color-text-muted)', cursor: 'pointer' }}
          title="New folder"
        >
          <Icon name="plus" size={14} />
        </span>
      </div>
      {railRow('all', 'All reports')}
      {folders.map((f) => (
        <FolderRailRow
          key={f.id}
          folder={f}
          active={selectedFolder === f.id}
          count={countFor(f.id)}
          onSelect={() => setSelectedFolder(f.id)}
          onEdit={() => setFolderModal({ mode: 'edit', id: f.id, name: f.name, shared: f.shared })}
          onReorder={reorderFolder}
        />
      ))}
      {/* Only surface the uncategorized bucket when something's actually in it. */}
      {countFor(NO_FOLDER) > 0 && railRow(NO_FOLDER, 'No folder')}
      {/* Board H1: explain how a folder's sharing maps to who sees its reports. */}
      <div style={{ margin: '10px 4px 0', paddingTop: 10, borderTop: '1px solid var(--color-border-subtle)', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
        A folder's sharing decides who sees its reports. Reports with no folder stay private to you.
      </div>
    </Card>
  );

  return (
    <>
      {/* List body — hidden on the single-report /reports/:id detail route. */}
      {!focusReportId && (
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' }}>
        {rail}
        <div>
          {reports === null ? (
            <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
              <SkeletonRows rows={4} columnWidths={[220, null, 120]} />
            </div>
          ) : reports.length === 0 ? (
            <Card padding={0}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, alignItems: 'center', padding: '40px 32px' }}>
                {/* Hero */}
                <div style={{ flex: '1 1 360px', minWidth: 0 }}>
                  <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {renderNavIcon('/reports', { size: 26 })}
                  </span>
                  <h2 style={{ margin: '16px 0 6px', fontSize: 20, fontWeight: 600 }}>Build your first report</h2>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.55, maxWidth: 520 }}>
                    A report is a saved list you can re-run any time — for example every uncertified data asset and its owner. Pick what to list, choose the columns, add filters, then share it with your organization or email it on a schedule.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
                    <Button onClick={() => navigate('/reports/builder')}>+ New report</Button>
                  </div>
                </div>
                {/* Start from an entity */}
                {starterEntities.length > 0 && (
                  <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>Or start from what you want to list</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                      {starterEntities.slice(0, 4).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => navigate(`/reports/builder?entity=${encodeURIComponent(e.id)}`)}
                          style={{ display: 'block', textAlign: 'left', cursor: 'pointer', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}
                        >
                          <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-text)' }}>{e.label}</span>
                          {e.description && <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</span>}
                        </button>
                      ))}
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      Opens the builder with that starting point picked.{starterEntities.length > 4 ? ` ${starterEntities.length - 4} more in the builder.` : ''}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <>
              {/* Bulk actions for the selected rows — move to a folder or delete. */}
              <BulkActionBar count={sel.count} onClear={sel.clear}>
                <select
                  aria-label="Move selected reports to folder"
                  defaultValue=""
                  onChange={(e) => { const v = e.target.value; e.currentTarget.value = ''; if (v) bulkMove(v === '__none__' ? '' : v); }}
                  style={{ height: 30, padding: '0 8px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="" disabled>Move to…</option>
                  <option value="__none__">No folder (private)</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}{f.shared ? ' · shared' : ''}</option>)}
                </select>
                <BulkActionButton variant="danger" onClick={bulkDelete}>Delete</BulkActionButton>
              </BulkActionBar>
              {/* List card (board H1): the search + Source / Sharing / Schedule
                  toolbar is the card's top row, with the table below it. */}
              <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                  <label style={{ flex: '1 1 200px', minWidth: 180, maxWidth: 320, height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
                    <input
                      type="search" aria-label="Search reports" placeholder="Search reports..."
                      value={search} onChange={(e) => setSearch(e.target.value)}
                      style={{ border: 0, outline: 'none', flex: 1, font: 'inherit', fontSize: 13, color: 'var(--color-text)', background: 'transparent', minWidth: 0 }}
                    />
                  </label>
                  <select aria-label="Filter by source" style={filterSelectStyle} value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
                    <option value="">All sources</option>
                    {sourceOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <select aria-label="Filter by sharing" style={filterSelectStyle} value={filterSharing} onChange={(e) => setFilterSharing(e.target.value)}>
                    <option value="">All sharing</option>
                    <option value="private">Private</option>
                    <option value="org">Shared</option>
                  </select>
                  <select aria-label="Filter by schedule" style={filterSelectStyle} value={filterSchedule} onChange={(e) => setFilterSchedule(e.target.value)}>
                    <option value="">Any schedule</option>
                    <option value="off">Not scheduled</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  {hasFilters && (
                    <>
                      <SecondaryButton onClick={() => { setSearch(''); setFilterSource(''); setFilterSharing(''); setFilterSchedule(''); }}>Clear filters</SecondaryButton>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Showing {visibleReports.length} of {reports.length}</span>
                    </>
                  )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    rows={sorted}
                    columns={columns}
                    rowKey={(r) => r.id}
                    selection={sel}
                    sort={{ sortKey, sortDir, onSort: toggleSort }}
                    emptyMessage={hasFilters ? 'No reports match these filters.' : 'No reports in this folder.'}
                    onRowClick={(r) => navigate(`/reports/${r.id}`)}
                  />
                </div>
                {/* Board H1: a persistent footer strip — the report count on the
                    left, a reminder of where row actions live on the right. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  <span>
                    {sorted.length} {sorted.length === 1 ? 'report' : 'reports'}
                    {hasFilters && reports.length !== sorted.length ? ` of ${reports.length}` : ''}
                  </span>
                  <span>Run from each row; edit, duplicate, move and delete live in its ⋯ menu.</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {result && (
        <Modal
          open
          onClose={() => setResult(null)}
          size="lg"
          kicker={result.report.primaryEntity}
          // The report name lives in the branded letterhead inside the body, so
          // the window chrome stays neutral (and keeps the name as its
          // accessible label) rather than printing the name twice.
          title="Report results"
          ariaLabel={result.report.name}
          subtitle={`${result.data.totalMatched.toLocaleString()} ${result.data.totalMatched === 1 ? 'row' : 'rows'} matched${result.data.totalMatched > result.data.rows.length ? ` · showing first ${result.data.rows.length.toLocaleString()}` : ''}`}
          actions={
            <>
              <IconButton size="sm" icon="printer" label="Print" onClick={printResult} />
              <ExportMenu label="Download" formats={[...DOWNLOAD_FORMATS]} build={() => resultToPayload(result.report, result.data, { logoUrl, companyName, userName })} />
            </>
          }
        >
          {/* Report letterhead — brand logo pinned left, report name centred,
              description centred below it. Mirrors the printed/PDF header so the
              on-screen report and the export read the same. */}
          <div style={{ position: 'relative', textAlign: 'center', paddingBottom: 12, marginBottom: 14, borderBottom: '2px solid var(--color-border)', minHeight: 40 }}>
            {logoUrl && <img src={logoUrl} alt="" style={{ position: 'absolute', left: 0, top: 0, maxHeight: 40, maxWidth: 160, objectFit: 'contain' }} />}
            {companyName && (
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 2 }}>{companyName}</div>
            )}
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{result.report.name}</div>
            {result.report.description && (
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px auto 0', maxWidth: '70%', lineHeight: 1.4 }}>{result.report.description}</div>
            )}
          </div>
          {result.data.rows.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
              No rows match this report.
            </div>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: '60vh', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {result.data.columns.map((c) => (
                      <th key={c.field} style={{ position: 'sticky', top: 0, background: 'var(--color-bg)', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-muted)', padding: '8px 12px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.rows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {result.data.columns.map((c) => (
                        <td key={c.field} style={{ padding: '6px 12px', whiteSpace: 'nowrap', color: 'var(--color-text)' }}>
                          {String(toExportCell(row[c.field]))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Provenance footer — mirrors the printed/PDF footer. */}
          <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--color-border)', fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            {[companyName, result.report.name, `Generated ${new Date().toLocaleDateString()}`, userName ? `by ${userName}` : null].filter(Boolean).join('  ·  ')}
          </div>
        </Modal>
      )}

      {/* Report detail — the /reports/:id route. Read-only view of what the
          report selects, with Run and Edit (→ Builder, the real editor) in the
          header; the report's query is edited in the Builder, not inline. */}
      {focusReportId && !viewingReport && (
        reports === null
          ? <div><PageHeader kicker="Report" title="Loading…" actions={<Link to="/reports" style={backLinkStyle}>{'←'} Back to Reports</Link>} /><SkeletonRows rows={3} columnWidths={[200, null]} /></div>
          : <EmptyState title="Couldn't load this report" description="It may have been deleted, or you don't have access to it." action={{ label: 'Back to Reports', onClick: () => navigate('/reports') }} />
      )}
      {focusReportId && viewingReport && (() => {
        const r = viewingReport;
        const fname = folderName(r.folderId);
        const labelStyle: React.CSSProperties = { fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' };
        const cols = detail?.definition.columns || [];
        const filters = detail?.definition.filters || [];
        const sort = detail?.definition.sort;
        const tabStyle = (t: string): React.CSSProperties => ({
          font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none',
          padding: '8px 12px', textTransform: 'capitalize', marginBottom: -1,
          color: detailTab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
          borderBottom: `2px solid ${detailTab === t ? 'var(--color-primary)' : 'transparent'}`,
        });
        const copyReportId = () => { navigator.clipboard?.writeText(r.id).then(() => addToast('success', 'Report ID copied'), () => {}); };
        return (
          <div>
            <PageHeader
              kicker={entityLabel(r.primaryEntity)}
              title={r.name}
              copyId={r.id}
              copyLabel="Copy report ID"
              subtitle={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {r.visibility === 'org'
                    ? <span style={badgeStyle('var(--color-primary-light)', 'var(--color-primary)')}>Shared</span>
                    : <span style={badgeStyle('var(--color-bg)', 'var(--color-text-muted)')}>Private</span>}
                  {r.scheduleFrequency !== 'off' && <span style={badgeStyle('var(--color-primary-light)', 'var(--color-primary)')}>Emailed {r.scheduleFrequency}</span>}
                  {fname && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)' }}><Icon name="folder" size={12} />{fname}</span>}
                </span>
              }
              actions={
                <>
                  <Link to="/reports" style={backLinkStyle}>{'←'} Back to Reports</Link>
                  <Button size="sm" variant="primary" leadingIcon={<Icon name="play" size={13} />} disabled={inlineRunning || !detail} onClick={() => { setDetailTab('results'); runInline(); }}>{inlineRunning ? 'Running…' : 'Run'}</Button>
                  <Button size="sm" leadingIcon={<Icon name="edit" size={13} />} onClick={() => navigate(`/reports/builder/${r.id}`)}>Edit</Button>
                </>
              }
            />

            {r.description && <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-secondary)', maxWidth: 680 }}>{r.description}</p>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
              <main style={{ flex: '999 1 540px', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
                  {(['results', 'definition', 'schedule'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setDetailTab(t)} style={tabStyle(t)}>{t}</button>
                  ))}
                </div>

                {/* Results — the report run inline on the page, no pop-up. */}
                {detailTab === 'results' && (
                  <Card>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {inlineRunning && !inlineRun ? 'Running…'
                          : inlineRun ? `${inlineRun.totalMatched.toLocaleString()} ${inlineRun.totalMatched === 1 ? 'row' : 'rows'} matched${inlineRun.totalMatched > inlineRun.rows.length ? ` · showing first ${inlineRun.rows.length.toLocaleString()}` : ''}` : ''}
                      </span>
                      {inlineRun && inlineRun.rows.length > 0 && (
                        <ExportMenu label="Download" formats={[...DOWNLOAD_FORMATS]} build={() => resultToPayload(r, inlineRun, { logoUrl, companyName, userName })} />
                      )}
                    </div>
                    {inlineError ? (
                      <div style={{ fontSize: 12, color: 'var(--color-error)', padding: '8px 10px', background: '#fee2e2', borderRadius: 4 }}>{inlineError}</div>
                    ) : inlineRunning && !inlineRun ? (
                      <SkeletonRows rows={5} columns={Math.max(2, (detail?.definition.columns.length || 3))} />
                    ) : !inlineRun || inlineRun.rows.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>No rows match this report's filters.</p>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: 'var(--color-bg)' }}>
                              {inlineRun.columns.map((c) => (
                                <th key={c.field} style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{c.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {inlineRun.rows.map((row, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                {inlineRun.columns.map((c) => <td key={c.field} style={{ padding: '6px 10px' }}>{formatReportCell(row[c.field])}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                )}

                {/* Definition — columns, filters (plain sentences), sort. */}
                {detailTab === 'definition' && (
                  <Card>
                    {detailLoading ? (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div>
                          <div style={labelStyle}>Columns ({cols.length})</div>
                          {cols.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No columns selected</div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {cols.map((c) => (
                                <span key={c.field} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--color-text)' }}>{c.label || prettyField(c.field)}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={labelStyle}>Filters</div>
                          {filters.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No filters — returns every {entityLabel(r.primaryEntity).toLowerCase()} row in this org.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {filters.map((f, i) => (
                                <div key={i} style={{ fontSize: 13, color: 'var(--color-text)' }}>
                                  <span style={{ fontWeight: 600 }}>{prettyField(f.field)}</span>{' '}
                                  <span style={{ color: 'var(--color-text-muted)' }}>{FILTER_OP_WORDS[f.op] || f.op}</span>
                                  {f.op !== 'isNull' && f.op !== 'isNotNull' && f.value !== undefined && f.value !== '' && <> <span style={{ fontWeight: 600 }}>{String(f.value)}</span></>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={labelStyle}>Sort</div>
                          <div style={{ fontSize: 13, color: sort ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                            {sort ? <>{prettyField(sort.field)} · {sort.direction === 'asc' ? 'ascending' : 'descending'}</> : 'No sort'}
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {/* Schedule — summary + a link into the builder, where delivery is edited. */}
                {detailTab === 'schedule' && (
                  <Card>
                    <div style={labelStyle}>Email delivery</div>
                    {r.scheduleFrequency === 'off' ? (
                      <>
                        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>This report isn't emailed on a schedule.</p>
                        <button type="button" onClick={() => navigate(`/reports/builder/${r.id}`)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}>Set up email delivery</button>
                      </>
                    ) : (
                      <>
                        <p style={{ fontSize: 13, color: 'var(--color-text)', margin: '0 0 8px' }}>Emailed <strong>{r.scheduleFrequency}</strong> to its recipients.</p>
                        <button type="button" onClick={() => navigate(`/reports/builder/${r.id}`)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', cursor: 'pointer' }}>Edit schedule</button>
                      </>
                    )}
                  </Card>
                )}
              </main>

              {/* Facts rail. */}
              <aside style={{ flex: '1 1 260px', minWidth: 0 }}>
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Facts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div><div style={labelStyle}>Source</div><div style={{ fontSize: 13 }}>{entityLabel(r.primaryEntity)}</div></div>
                    <div><div style={labelStyle}>Sharing</div><div style={{ fontSize: 13 }}>{r.visibility === 'org' ? 'Shared with the org' : 'Private to you'}{fname ? ` · ${fname}` : ''}</div></div>
                    <div><div style={labelStyle}>Columns</div><div style={{ fontSize: 13 }}>{r.columnCount}</div></div>
                    <div>
                      <div style={labelStyle}>Last run</div>
                      <div style={{ fontSize: 13 }}>
                        {r.lastRunAt
                          ? <>{timeAgo(r.lastRunAt)}{r.lastRunRowCount != null ? ` · ${r.lastRunRowCount.toLocaleString()} ${r.lastRunRowCount === 1 ? 'row' : 'rows'}` : ''}</>
                          : <span style={{ color: 'var(--color-text-muted)' }}>Never run</span>}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Report ID</div>
                      <button type="button" onClick={copyReportId} title="Copy report ID" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        {r.id.slice(0, 8)}…<Icon name="copy" size={12} />
                      </button>
                    </div>
                  </div>
                </Card>
              </aside>
            </div>
          </div>
        );
      })()}

      {/* Create / rename+re-share a folder. A folder's shared flag drives the
          audience of every report inside it. */}
      {folderModal && (
        <Modal
          open
          onClose={() => setFolderModal(null)}
          size="sm"
          title={folderModal.mode === 'create' ? 'New folder' : 'Edit folder'}
          footer={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }}>
              <div>
                {folderModal.mode === 'edit' && folderModal.id && (
                  <IconButton size="sm" icon="trash" label="Delete folder" variant="danger" disabled={busy} onClick={() => deleteFolder(folderModal.id!, folderModal.name)} />
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <SecondaryButton onClick={() => setFolderModal(null)}>Cancel</SecondaryButton>
                <button
                  onClick={saveFolder}
                  disabled={busy || !folderModal.name.trim()}
                  style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 'var(--radius-md)', cursor: busy || !folderModal.name.trim() ? 'default' : 'pointer', background: folderModal.name.trim() ? 'var(--color-primary)' : '#e5e7eb', color: folderModal.name.trim() ? '#fff' : 'var(--color-text-muted)' }}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          }
        >
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>Name</label>
          <input
            aria-label="Folder name"
            autoFocus
            value={folderModal.name}
            onChange={(e) => setFolderModal({ ...folderModal, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && folderModal.name.trim()) saveFolder(); }}
            placeholder="e.g. Compliance"
            style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', marginBottom: 14 }}
          />
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={folderModal.shared} onChange={(e) => setFolderModal({ ...folderModal, shared: e.target.checked })} style={{ marginTop: 2 }} />
            <span>
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>Share with everyone in the organization</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>Reports in a shared folder are visible to your whole org. A private folder keeps its reports visible only to their owner.</span>
            </span>
          </label>
        </Modal>
      )}

      {/* Move a report into a folder (or out of all folders → private). */}
      {moveReport && (
        <Modal
          open
          onClose={() => setMoveReport(null)}
          size="sm"
          title="Move to folder"
          subtitle={moveReport.name}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
              <SecondaryButton onClick={() => setMoveReport(null)}>Cancel</SecondaryButton>
              <button
                onClick={moveTo}
                disabled={busy || (moveTarget || '') === (moveReport.folderId || '')}
                style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 'var(--radius-md)', cursor: busy || (moveTarget || '') === (moveReport.folderId || '') ? 'default' : 'pointer', background: (moveTarget || '') !== (moveReport.folderId || '') ? 'var(--color-primary)' : '#e5e7eb', color: (moveTarget || '') !== (moveReport.folderId || '') ? '#fff' : 'var(--color-text-muted)' }}
              >
                {busy ? 'Moving…' : 'Move'}
              </button>
            </div>
          }
        >
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>Folder</label>
          <select
            aria-label="Target folder"
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            <option value="">No folder (private to me)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}{f.shared ? ' · shared' : ''}</option>
            ))}
          </select>
        </Modal>
      )}
    </>
  );
}

export default function ReportsPage({ focusReportId }: { focusReportId?: string } = {}) {
  const navigate = useNavigate();
  // Column-picker state lives here (the toolbar is on this page header) and is
  // passed into the tab, which owns the table.
  const reportCols = useColumnPicker<ReportColId>('procela.reports.visibleCols.v2', REPORT_COLUMN_DEFS);
  // Reports is the report catalog + Builder. The Executive Report and
  // Governance Maturity Scorecard tabs were removed, so there's no tab bar.
  // On the /reports/:id detail route the tab renders its own detail header,
  // so the list's "Reports" PageHeader is suppressed.
  if (focusReportId) {
    return <div><UserReportsTab focusReportId={focusReportId} reportCols={reportCols} /></div>;
  }
  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Reports you and your org have built against the Procela data model."
        actions={
          <ListToolbar
            columns={<ColumnPicker state={reportCols} />}
            primary={<Button variant="primary" leadingIcon={<Icon name="plus" size={13} />} onClick={() => navigate('/reports/builder')}>New report</Button>}
          />
        }
      />
      <UserReportsTab reportCols={reportCols} />
    </div>
  );
}
