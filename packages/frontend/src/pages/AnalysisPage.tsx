import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import HelpPopover from '../components/HelpPopover';
import PageHeader from '../components/PageHeader';
import SectionLabel from '../components/SectionLabel';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ExportMenu from '../components/ExportMenu';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import { renderNavIcon } from '../components/navIcons';
import ConfirmDialog from '../components/ConfirmDialog';
import DetailDrawer from '../components/DetailDrawer';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useScrollLock } from '../hooks/useScrollLock';
import { useRef } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// AnalysisPage — cube-style pivot builder. Users drag entity types from a
// left palette into Rows / Columns / Filters drop zones; the grid below
// updates with counts. Click a cell to drill down to matching entities.
//
// Saved reports persist the (rowDim, colDim, filters) config and can be
// shared across the org. The current builder state is also mirrored to
// the URL so reloads keep the user in place and links are shareable.
// ──────────────────────────────────────────────────────────────────────────

type Dim = 'systems' | 'dataAssets' | 'domains' | 'processes' | 'roles' | 'people' | 'connections';

// Each dimension maps to the sidebar route whose icon represents that
// entity, so the palette tiles and axis chips render the same SVG icons
// as the rest of the app (via renderNavIcon) instead of the ad-hoc glyphs
// the API happens to ship. Keeps the Analysis page consistent with the
// sidebar and every other page that references these entities.
const DIM_ROUTE: Record<Dim, string> = {
  systems: '/systems',
  dataAssets: '/data-assets',
  domains: '/data-domains',
  processes: '/processes',
  roles: '/dama-roles',
  people: '/people',
  connections: '/connections',
};
const dimIcon = (dim: Dim, size: number) => renderNavIcon(DIM_ROUTE[dim], { size });

interface DimensionDef {
  id: Dim;
  label: string;
  // The API still ships a glyph here for back-compat; the UI ignores it
  // and renders the sidebar icon via DIM_ROUTE instead.
  icon: string;
  description: string;
}

interface CubeResponse {
  rowDims: Dim[];
  colDims: Dim[];
  // Back-compat — still present in responses so old clients reading
  // rowDim/colDim keep working. Use rowDims/colDims directly.
  rowDim: Dim;
  colDim: Dim;
  rows: Array<{ path: string[]; labels: string[]; total: number }>;
  cols: Array<{ path: string[]; labels: string[]; total: number }>;
  grid: Array<{
    rowPath: string[]; rowLabels: string[];
    cells: Array<{ colPath: string[]; colLabels: string[]; count: number; factIds: string[] }>;
  }>;
  truncated: { rows: boolean; cols: boolean };
  totalRows: number;
  totalCols: number;
  totalFacts: number;
}

interface DrillRow {
  factId: string;
  factType: string;
  refs: Partial<Record<Dim, { id: string; label: string }>>;
}

interface SavedReport {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  // Modern shape uses rowDims/colDims; legacy rowDim/colDim are still
  // honoured on load so reports saved before sub-grouping shipped
  // continue to work.
  config: {
    rowDims?: Dim[]; colDims?: Dim[];
    rowDim?: Dim; colDim?: Dim;
    filters?: Array<{ dim: Dim; value: string; label?: string }>;
  };
  createdAt: string;
  updatedAt: string;
}

interface FilterEntry {
  dim: Dim;
  value: string;
  label: string;
}

// DnD payload key — kept off `text/plain` so accidental drags from
// outside the page don't collide.
const DND_TYPE = 'application/x-procela-dim';

// Mirrors the backend cap. v1 supports 1 or 2 dimensions per axis.
const MAX_DIMS_PER_AXIS = 2;

export default function AnalysisPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [searchParams, setSearchParams] = useSearchParams();

  const [dimensions, setDimensions] = useState<DimensionDef[]>([]);
  // Up to MAX_DIMS_PER_AXIS dimensions per axis. Primary is index 0;
  // index 1 is the sub-group nested under the primary. Initial state
  // comes from the URL (comma-separated) so reloads keep place and
  // links survive.
  const parseDims = (s: string | null): Dim[] => s
    ? (s.split(',').filter(Boolean) as Dim[]).slice(0, MAX_DIMS_PER_AXIS)
    : [];
  const [rowDims, setRowDims] = useState<Dim[]>(parseDims(searchParams.get('row')));
  const [colDims, setColDims] = useState<Dim[]>(parseDims(searchParams.get('col')));
  const [filters, setFilters] = useState<FilterEntry[]>([]);
  const [cube, setCube] = useState<CubeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drill-down state — when a cell is clicked we open a side panel.
  const [drill, setDrill] = useState<{
    rowLabel: string; colLabel: string; count: number; factIds: string[]; rows: DrillRow[]; loading: boolean;
  } | null>(null);

  // Saved reports
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedReport | null>(null);

  // ── Load dimension catalog once ──
  useEffect(() => {
    apiClient.get<{ success: boolean; data: DimensionDef[] }>('/analysis/dimensions')
      .then((r) => setDimensions(r.data || []))
      .catch(() => setError('Could not load dimension catalog'));
  }, []);

  // ── Load saved reports for active org ──
  const fetchReports = useCallback(() => {
    const q = activeOrgId ? `?orgId=${encodeURIComponent(activeOrgId)}` : '';
    apiClient.get<{ success: boolean; data: SavedReport[] }>(`/analysis-reports${q}`)
      .then((r) => setReports(r.data || []))
      .catch(() => { /* fail silently — saved reports are non-critical */ });
  }, [activeOrgId]);
  useEffect(() => { fetchReports(); }, [fetchReports]);

  // ── Persist (rowDims, colDims) to URL so reloads and shared links keep state ──
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (rowDims.length > 0) next.set('row', rowDims.join(',')); else next.delete('row');
    if (colDims.length > 0) next.set('col', colDims.join(',')); else next.delete('col');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowDims, colDims]);

  // ── Run the cube whenever the config changes ──
  const runCube = useCallback(async () => {
    if (rowDims.length === 0 || colDims.length === 0) { setCube(null); return; }
    // Same dim on both axes (or sub-grouped by the same dim) is nonsense
    // — the engine 400s on it; surface a friendly message instead of
    // round-tripping just to error.
    const all = [...rowDims, ...colDims];
    if (new Set(all).size !== all.length) {
      setError('Each dimension can appear on only one axis.');
      setCube(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await apiClient.post<{ success: boolean; data: CubeResponse }>('/analysis/cube', {
        orgId: activeOrgId || undefined,
        rowDims, colDims,
        filters: filters.map((f) => ({ dim: f.dim, value: f.value })),
      });
      setCube(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cube query failed');
      setCube(null);
    } finally {
      setLoading(false);
    }
  }, [rowDims, colDims, filters, activeOrgId]);
  useEffect(() => { runCube(); }, [runCube]);

  // ── DnD handlers ──
  const onTileDragStart = (e: React.DragEvent, dimId: Dim) => {
    e.dataTransfer.setData(DND_TYPE, dimId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onZoneDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DND_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };
  // Append the dropped dim to the zone's array. Caps at MAX_DIMS_PER_AXIS
  // and rejects duplicates within the same zone — the user can still
  // remove and re-add to reorder.
  const onZoneDrop = (zone: 'row' | 'col' | 'filter') => (e: React.DragEvent) => {
    e.preventDefault();
    const dim = e.dataTransfer.getData(DND_TYPE) as Dim;
    if (!dim) return;
    setActiveReportId(null);  // user is deviating from any loaded report
    if (zone === 'row' || zone === 'col') {
      const setter = zone === 'row' ? setRowDims : setColDims;
      const current = zone === 'row' ? rowDims : colDims;
      const other = zone === 'row' ? colDims : rowDims;
      if (current.includes(dim)) {
        addToast('info', `${dimensionLabel(dim)} is already on ${zone === 'row' ? 'Rows' : 'Columns'}.`);
        return;
      }
      if (other.includes(dim)) {
        addToast('info', `${dimensionLabel(dim)} is already on the other axis. Remove it there first.`);
        return;
      }
      if (current.length >= MAX_DIMS_PER_AXIS) {
        addToast('info', `Up to ${MAX_DIMS_PER_AXIS} dimensions per axis. Remove one before adding another.`);
        return;
      }
      setter([...current, dim]);
    } else {
      addToast('info', `Click any ${dimensionLabel(dim)} row label in the grid to filter by it.`);
    }
  };

  // Remove a single dim from a zone (by index — order matters for sub-grouping).
  const removeFromZone = (zone: 'row' | 'col', index: number) => {
    if (zone === 'row') setRowDims((prev) => prev.filter((_, i) => i !== index));
    else setColDims((prev) => prev.filter((_, i) => i !== index));
    setActiveReportId(null);
  };

  // Pivot rows ↔ columns. Keeps the dim order within each axis, so a
  // (Systems > Domains) row pivot becomes (Systems > Domains) on
  // columns; the existing filter chips travel with them.
  const pivotAxes = () => {
    setRowDims(colDims);
    setColDims(rowDims);
    setActiveReportId(null);
  };

  // ── Drill-down ──
  const openDrill = async (rowLabel: string, colLabel: string, count: number, factIds: string[]) => {
    setDrill({ rowLabel, colLabel, count, factIds, rows: [], loading: true });
    try {
      const r = await apiClient.post<{ success: boolean; data: DrillRow[] }>('/analysis/drill', {
        orgId: activeOrgId || undefined,
        factIds,
      });
      setDrill({ rowLabel, colLabel, count, factIds, rows: r.data || [], loading: false });
    } catch {
      setDrill({ rowLabel, colLabel, count, factIds, rows: [], loading: false });
    }
  };

  // ── Save / Load reports ──
  const handleSave = async () => {
    if (!saveName.trim()) return;
    try {
      if (activeReportId) {
        const r = await apiClient.patch<{ success: boolean; data: SavedReport }>(`/analysis-reports/${activeReportId}`, {
          name: saveName.trim(),
          description: saveDesc.trim() || null,
          config: { rowDims, colDims, filters },
        });
        addToast('success', 'Report updated.');
        setReports((prev) => prev.map((p) => p.id === r.data.id ? r.data : p));
      } else {
        const r = await apiClient.post<{ success: boolean; data: SavedReport }>('/analysis-reports', {
          orgId: activeOrgId || undefined,
          name: saveName.trim(),
          description: saveDesc.trim() || null,
          config: { rowDims, colDims, filters },
        });
        addToast('success', 'Report saved.');
        setReports((prev) => [r.data, ...prev]);
        setActiveReportId(r.data.id);
      }
      setShowSave(false);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Save failed');
    }
  };

  const loadReport = (r: SavedReport) => {
    // Honour both modern (rowDims) and legacy (rowDim) configs so older
    // reports keep working after the sub-group rollout.
    const rd = r.config.rowDims && r.config.rowDims.length > 0
      ? r.config.rowDims
      : r.config.rowDim ? [r.config.rowDim] : [];
    const cd = r.config.colDims && r.config.colDims.length > 0
      ? r.config.colDims
      : r.config.colDim ? [r.config.colDim] : [];
    setRowDims(rd);
    setColDims(cd);
    setFilters((r.config.filters || []).map((f) => ({ dim: f.dim, value: f.value, label: f.label || f.value })));
    setActiveReportId(r.id);
    setSaveName(r.name);
    setSaveDesc(r.description || '');
  };

  const deleteReport = async (r: SavedReport) => {
    try {
      await apiClient.delete(`/analysis-reports/${r.id}`);
      setReports((prev) => prev.filter((p) => p.id !== r.id));
      if (activeReportId === r.id) setActiveReportId(null);
      addToast('success', 'Report deleted.');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setConfirmDelete(null);
    }
  };

  // ── Helpers ──
  const dimensionLabel = (id: Dim): string => dimensions.find((d) => d.id === id)?.label || id;

  const exportPayload = useMemo(() => () => {
    if (!cube) return null;
    // Header row: one cell per row-dimension (e.g. "System", "Domain")
    // followed by each column's flattened label (joined with " / " when
    // sub-grouped), plus a trailing Total column.
    const rowDimHeaders = cube.rowDims.map((d) => dimensionLabel(d));
    const colHeaders = cube.cols.map((c) => c.labels.join(' / '));
    const headers = [...rowDimHeaders, ...colHeaders, 'Total'];

    const rows = cube.grid.map((r) => {
      const rowTotal = r.cells.reduce((s, c) => s + c.count, 0);
      // Pad row-labels to rowDims length so the leading columns stay aligned
      // even if (for some reason) the path is shorter than the dim list.
      const padded = cube.rowDims.map((_, i) => r.rowLabels[i] || '');
      return [...padded, ...r.cells.map((c) => c.count), rowTotal] as Array<string | number>;
    });
    const totalLeader = ['Total', ...Array(Math.max(0, cube.rowDims.length - 1)).fill('')];
    const colTotalsRow = [...totalLeader, ...cube.cols.map((c) => c.total), cube.cols.reduce((s, c) => s + c.total, 0)] as Array<string | number>;
    rows.push(colTotalsRow);

    const filterSuffix = filters.length > 0
      ? '_' + filters.map((f) => `${f.dim}=${f.label}`).join('_').replace(/[^a-z0-9_-]/gi, '_')
      : '';
    return {
      filenameBase: `analysis_${cube.rowDims.join('-')}_x_${cube.colDims.join('-')}${filterSuffix}`,
      sheetName: `${cube.rowDims.map(dimensionLabel).join(' / ')} × ${cube.colDims.map(dimensionLabel).join(' / ')}`,
      headers,
      rows,
    };
  }, [cube, filters, dimensions]);

  // ── Render ──
  const Tile = ({ d }: { d: DimensionDef }) => (
    <div
      draggable
      onDragStart={(e) => onTileDragStart(e, d.id)}
      title={d.description}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 6, cursor: 'grab', userSelect: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', width: 20, justifyContent: 'center', color: 'var(--color-text-secondary)', flexShrink: 0 }}>{dimIcon(d.id, 16)}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</span>
    </div>
  );

  const DropZone = ({
    label, values, onDrop, onRemove, hint, secondaryHint,
  }: {
    label: string;
    values: Dim[];
    onDrop: (e: React.DragEvent) => void;
    onRemove: (index: number) => void;
    hint: string;
    secondaryHint: string;
  }) => {
    const hasAny = values.length > 0;
    return (
      <div
        onDragOver={onZoneDragOver}
        onDrop={onDrop}
        style={{
          flex: 1, minWidth: 0,
          padding: 12,
          background: hasAny ? 'var(--color-bg)' : 'transparent',
          border: `1.5px dashed ${hasAny ? 'var(--color-primary)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          minHeight: 56,
        }}
      >
        <SectionLabel marginBottom={6}>
          {label}
          {hasAny && values.length < MAX_DIMS_PER_AXIS && (
            <span style={{ marginLeft: 8, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-muted)' }}>
              · drop another to sub-group
            </span>
          )}
        </SectionLabel>
        {hasAny ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {values.map((dim, i) => (
              <span key={dim}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-primary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13, fontWeight: 600,
                }}
                title={i === 0 ? 'Primary dimension' : 'Sub-group nested under the primary'}
              >
                <span style={{ display: 'inline-flex', color: 'var(--color-text-secondary)' }}>{dimIcon(dim, 14)}</span>
                <span>{dimensionLabel(dim)}</span>
                {i > 0 && (
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--color-bg)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                    Sub
                  </span>
                )}
                <button onClick={() => onRemove(i)} aria-label={`Remove ${dimensionLabel(dim)}`}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1, display: 'inline-flex' }}>
                  <X size={14} strokeWidth={2.4} />
                </button>
              </span>
            ))}
            {values.length < MAX_DIMS_PER_AXIS && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{secondaryHint}</span>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{hint}</div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Analysis"
        subtitle="Pivot any two dimensions to see how the org connects. Drag from the palette into Rows and Columns."
      >
        <HelpPopover id="analysis-intro" title="Cube-style analysis" showInitially>
          Drag dimensions into Rows and Columns to pivot the org's catalog. Each cell shows how many records connect both. Click a cell to drill down to the matching entities. Click a row label to use that value as a filter. Saved reports persist your configuration and can be shared via link.
        </HelpPopover>
      </PageHeader>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Left palette */}
        <aside style={{ width: 220, flexShrink: 0 }}>
          <SectionLabel>
            Dimensions
          </SectionLabel>
          {dimensions.map((d) => <Tile key={d.id} d={d} />)}

          <SectionLabel style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Saved Reports</span>
            <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>{reports.length}</span>
          </SectionLabel>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Also listed under <Link to="/reports?tab=analysis" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>Reports → Analysis</Link>.
          </div>
          {reports.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '6px 0' }}>
              No saved reports yet. Configure rows/columns and save.
            </div>
          )}
          {reports.map((r) => {
            const isActive = activeReportId === r.id;
            return (
              <div key={r.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                  padding: '6px 8px',
                  background: isActive ? 'var(--color-bg)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`,
                  borderRadius: 4,
                  marginBottom: 4,
                }}
              >
                <button
                  onClick={() => loadReport(r)}
                  style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit' }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{r.name}</div>
                  {r.description && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>}
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>by {r.ownerName || '—'}</div>
                </button>
                <button onClick={() => setConfirmDelete(r)} aria-label="Delete report"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2, display: 'inline-flex' }}>
                  <X size={14} strokeWidth={2.4} />
                </button>
              </div>
            );
          })}
        </aside>

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Drop zones + pivot toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'stretch' }}>
            <DropZone
              label="Rows"
              values={rowDims}
              onDrop={onZoneDrop('row')}
              onRemove={(i) => removeFromZone('row', i)}
              hint="Drag a dimension here for the y-axis."
              secondaryHint="+ drag again for a sub-group"
            />
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconButton
                icon="refresh"
                label="Pivot rows and columns"
                onClick={pivotAxes}
                disabled={rowDims.length === 0 && colDims.length === 0}
              />
            </div>
            <DropZone
              label="Columns"
              values={colDims}
              onDrop={onZoneDrop('col')}
              onRemove={(i) => removeFromZone('col', i)}
              hint="Drag a dimension here for the x-axis."
              secondaryHint="+ drag again for a sub-group"
            />
          </div>

          {/* Filter chips */}
          {filters.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <SectionLabel marginBottom={0}>Filters</SectionLabel>
              {filters.map((f, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: 11 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>{dimensionLabel(f.dim)}:</span>
                  <strong>{f.label}</strong>
                  <button onClick={() => setFilters((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove filter"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', display: 'inline-flex' }}><X size={12} strokeWidth={2.4} /></button>
                </span>
              ))}
              <button onClick={() => setFilters([])}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-text-muted)', textDecoration: 'underline' }}>
                Clear all
              </button>
            </div>
          )}

          {/* Action bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Button variant="primary" size="sm" onClick={runCube} disabled={rowDims.length === 0 || colDims.length === 0 || loading}>
              {loading ? 'Running…' : 'Run'}
            </Button>
            <Button size="sm" onClick={() => { setSaveName(''); setSaveDesc(''); setActiveReportId(null); setShowSave(true); }} disabled={rowDims.length === 0 || colDims.length === 0}>
              Save as new
            </Button>
            {activeReportId && (
              <Button size="sm" onClick={() => setShowSave(true)}>
                Update saved
              </Button>
            )}
            {/* Reset the builder back to a blank slate — clears the chosen
                rows, columns, filters, any loaded-report binding, and the
                last cube result. Saved reports themselves are untouched. */}
            <span title="Clear rows, columns, filters, and the current result. Saved reports are not deleted.">
              <Button
                size="sm"
                onClick={() => {
                  setRowDims([]);
                  setColDims([]);
                  setFilters([]);
                  setActiveReportId(null);
                  setCube(null);
                  setDrill(null);
                  setError(null);
                }}
                disabled={rowDims.length === 0 && colDims.length === 0 && filters.length === 0 && !activeReportId && !cube}
              >
                Reset
              </Button>
            </span>
            <div style={{ marginLeft: 'auto' }}>
              {cube && exportPayload && <ExportMenu build={exportPayload} />}
            </div>
          </div>

          {/* Grid */}
          {error && (
            <div style={{ padding: 12, marginBottom: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', fontSize: 13, borderRadius: 'var(--radius-md)' }}>
              {error}
            </div>
          )}
          {rowDims.length === 0 || colDims.length === 0 ? (
            <div>
              <EmptyState
                icon={renderNavIcon('/analysis', { size: 28 })}
                title="Pick dimensions to pivot"
                description="Drag at least one dimension into Rows and one into Columns. Drag a second into either zone to create a sub-group — or start from an example below."
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 }}>
                {([
                  { label: 'Data Assets by System', row: ['systems'], col: ['dataAssets'] },
                  { label: 'Roles by Person', row: ['roles'], col: ['people'] },
                  { label: 'Assets by Domain', row: ['domains'], col: ['dataAssets'] },
                  { label: 'Processes by System', row: ['processes'], col: ['systems'] },
                ] as Array<{ label: string; row: Dim[]; col: Dim[] }>).map((p) => (
                  <button
                    key={p.label}
                    onClick={() => { setRowDims(p.row); setColDims(p.col); }}
                    style={{
                      fontSize: 12, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                      border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                      color: 'var(--color-text)',
                    }}
                  >
                    Try: {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : cube && cube.totalFacts === 0 ? (
            <EmptyState
              icon={renderNavIcon('/analysis', { size: 28 })}
              title="No data for this pivot"
              description={`No ${rowDims.map(dimensionLabel).join(' / ')} link to ${colDims.map(dimensionLabel).join(' / ')} under the current filters.`}
            />
          ) : cube ? (
            <CubeGrid
              cube={cube}
              dimensionLabel={dimensionLabel}
              onCellClick={(rowLabels, colLabels, count, factIds) => openDrill(
                rowLabels.join(' / '), colLabels.join(' / '), count, factIds,
              )}
              onAddRowFilter={(dim, value, label) => setFilters((prev) => [
                ...prev.filter((f) => !(f.dim === dim && f.value === value)),
                { dim, value, label },
              ])}
              onAddColFilter={(dim, value, label) => setFilters((prev) => [
                ...prev.filter((f) => !(f.dim === dim && f.value === value)),
                { dim, value, label },
              ])}
            />
          ) : null}
        </div>
      </div>

      {/* Drill panel */}
      {drill && (
        <DrillPanel
          rowLabel={drill.rowLabel}
          colLabel={drill.colLabel}
          count={drill.count}
          rows={drill.rows}
          loading={drill.loading}
          dimensionLabel={dimensionLabel}
          onClose={() => setDrill(null)}
        />
      )}

      {/* Save dialog */}
      {showSave && (
        <SaveDialog
          name={saveName}
          description={saveDesc}
          isUpdate={!!activeReportId}
          onChangeName={setSaveName}
          onChangeDesc={setSaveDesc}
          onCancel={() => setShowSave(false)}
          onSubmit={handleSave}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete saved report?"
        message={confirmDelete ? `Delete "${confirmDelete.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteReport(confirmDelete)}
      />
    </div>
  );
}

// ── Cell styling helpers ──
function thStyle(): React.CSSProperties {
  return {
    padding: '8px 12px', fontSize: 11, fontWeight: 600, textAlign: 'left',
    background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)',
    position: 'sticky', top: 0, zIndex: 1,
  };
}
function thRowStyle(): React.CSSProperties {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 500, textAlign: 'left',
    borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)',
    position: 'sticky', left: 0, background: 'var(--color-surface)', zIndex: 1,
  };
}
function tdStyle(count: number): React.CSSProperties {
  // Light heat-map shading: more = darker blue tint.
  const intensity = Math.min(1, count / 20);
  const bg = count === 0 ? 'transparent' : `rgba(37, 99, 235, ${0.05 + intensity * 0.18})`;
  return {
    padding: '6px 12px', fontSize: 12, textAlign: 'center',
    borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)',
    background: bg,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// CubeGrid — pivot table with sub-grouped headers and merged cells.
//
// For a one-dim axis it renders a plain header row / row-label column.
// For a two-dim axis it merges adjacent cells that share the first-level
// id (rowspan for sub-grouped rows, colspan for sub-grouped columns) so
// the parent group reads as one block. Sub-group totals are inserted at
// every parent boundary so users can compare blocks at a glance.
// ──────────────────────────────────────────────────────────────────────────

interface CubeGridProps {
  cube: CubeResponse;
  dimensionLabel: (d: Dim) => string;
  onCellClick: (rowLabels: string[], colLabels: string[], count: number, factIds: string[]) => void;
  onAddRowFilter: (dim: Dim, value: string, label: string) => void;
  onAddColFilter: (dim: Dim, value: string, label: string) => void;
}

function CubeGrid({ cube, dimensionLabel, onCellClick, onAddRowFilter, onAddColFilter }: CubeGridProps) {
  // Precompute row spans: for the first dim, group consecutive rows that
  // share the primary id so we can render the parent label with
  // rowspan=N. For 1-dim axes this collapses to rowspan=1.
  const rowSpans = useMemo(() => {
    const spans: number[] = []; // spans[i] = how many rows the parent at i covers; 0 = covered by a previous span
    if (cube.rowDims.length === 1) {
      cube.grid.forEach(() => spans.push(1));
      return spans;
    }
    let i = 0;
    while (i < cube.grid.length) {
      const primary = cube.grid[i].rowPath[0];
      let j = i + 1;
      while (j < cube.grid.length && cube.grid[j].rowPath[0] === primary) j++;
      spans.push(j - i);
      for (let k = i + 1; k < j; k++) spans.push(0);
      i = j;
    }
    return spans;
  }, [cube]);

  // Same idea for columns. colSpans[i] = number of columns spanned by
  // the parent header above column i; 0 means "this col is under a
  // span that started earlier".
  const colSpans = useMemo(() => {
    const spans: number[] = [];
    if (cube.colDims.length === 1) {
      cube.cols.forEach(() => spans.push(1));
      return spans;
    }
    let i = 0;
    while (i < cube.cols.length) {
      const primary = cube.cols[i].path[0];
      let j = i + 1;
      while (j < cube.cols.length && cube.cols[j].path[0] === primary) j++;
      spans.push(j - i);
      for (let k = i + 1; k < j; k++) spans.push(0);
      i = j;
    }
    return spans;
  }, [cube]);

  // Aggregate column totals for the per-primary sub-totals (only
  // meaningful when col-sub-grouping is in play).
  const colPrimaryTotals = useMemo(() => {
    const map = new Map<string, number>();
    cube.cols.forEach((c) => {
      const k = c.path[0];
      map.set(k, (map.get(k) || 0) + c.total);
    });
    return map;
  }, [cube]);

  const rowDimsCount = cube.rowDims.length;
  const colDimsCount = cube.colDims.length;

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
      {(cube.truncated.rows || cube.truncated.cols) && (
        <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
          Showing {cube.rows.length} of {cube.totalRows} row-{cube.totalRows === 1 ? 'group' : 'groups'} and {cube.cols.length} of {cube.totalCols} column-{cube.totalCols === 1 ? 'group' : 'groups'}. Add filters to narrow further.
        </div>
      )}
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          {/* Primary header row — shows the first-level column dim. For
              1-dim columns this is the only header row. */}
          <tr>
            <th scope="col" colSpan={rowDimsCount} rowSpan={colDimsCount} style={thStyle()}>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, fontSize: 11 }}>
                {cube.rowDims.map(dimensionLabel).join(' / ')} ↓
                <br />
                {cube.colDims.map(dimensionLabel).join(' / ')} →
              </span>
            </th>
            {cube.cols.map((c, i) => {
              if (colSpans[i] === 0) return null;
              const label = c.labels[0];
              const dim = cube.colDims[0];
              return (
                <th scope="col" key={`p-${c.path[0]}-${i}`} colSpan={colSpans[i]} style={thStyle()} title={`Total: ${colPrimaryTotals.get(c.path[0]) || 0}`}>
                  <button
                    onClick={() => onAddColFilter(dim, c.path[0], label)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left', fontWeight: 600 }}
                    title="Click to add as filter"
                  >
                    {label}
                  </button>
                </th>
              );
            })}
            <th scope="col" rowSpan={colDimsCount} style={{ ...thStyle(), background: 'var(--color-bg)' }}>Total</th>
          </tr>
          {/* Sub header row — only rendered when columns are sub-grouped. */}
          {colDimsCount > 1 && (
            <tr>
              {cube.cols.map((c, i) => {
                const dim = cube.colDims[1];
                const label = c.labels[1];
                return (
                  <th scope="col" key={`s-${c.path.join('-')}-${i}`} style={{ ...thStyle(), fontSize: 11, fontWeight: 500 }} title={`Total: ${c.total}`}>
                    <button
                      onClick={() => onAddColFilter(dim, c.path[1], label)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left' }}
                      title="Click to add as filter"
                    >
                      {label}
                    </button>
                  </th>
                );
              })}
            </tr>
          )}
        </thead>
        <tbody>
          {cube.grid.map((r, ri) => {
            const rowTotal = r.cells.reduce((s, c) => s + c.count, 0);
            const span = rowSpans[ri];
            return (
              <tr key={r.rowPath.join('\x00')}>
                {/* Primary row label: rendered only when this row starts
                    a new primary group (span > 0). Skipped otherwise so
                    the previous row's rowspan covers the cell. */}
                {span > 0 && (
                  <th scope="row" rowSpan={span} style={{ ...thRowStyle(), verticalAlign: 'top' }}>
                    <button
                      onClick={() => onAddRowFilter(cube.rowDims[0], r.rowPath[0], r.rowLabels[0])}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left', fontWeight: 600 }}
                      title="Click to add as filter"
                    >
                      {r.rowLabels[0]}
                    </button>
                  </th>
                )}
                {rowDimsCount > 1 && (
                  <th scope="row" style={{ ...thRowStyle(), fontSize: 11, fontWeight: 500, paddingLeft: 18 }}>
                    <button
                      onClick={() => onAddRowFilter(cube.rowDims[1], r.rowPath[1], r.rowLabels[1])}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left' }}
                      title="Click to add as filter"
                    >
                      {r.rowLabels[1]}
                    </button>
                  </th>
                )}
                {r.cells.map((cell, ci) => (
                  <td key={`${cell.colPath.join('\x00')}-${ci}`} style={tdStyle(cell.count)}>
                    {cell.count > 0 ? (
                      <button
                        onClick={() => onCellClick(r.rowLabels, cell.colLabels, cell.count, cell.factIds)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, fontWeight: 600 }}
                        title="Drill down"
                      >
                        {cell.count}
                      </button>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                    )}
                  </td>
                ))}
                <td style={{ ...tdStyle(rowTotal), background: 'var(--color-bg)', fontWeight: 600 }}>{rowTotal}</td>
              </tr>
            );
          })}
          {/* Grand total row */}
          <tr>
            <th scope="row" colSpan={rowDimsCount} style={{ ...thRowStyle(), background: 'var(--color-bg)' }}>Total</th>
            {cube.cols.map((c, i) => (
              <td key={`tot-${c.path.join('\x00')}-${i}`} style={{ ...tdStyle(c.total), background: 'var(--color-bg)', fontWeight: 600 }}>{c.total}</td>
            ))}
            <td style={{ ...tdStyle(cube.totalFacts), background: 'var(--color-bg)', fontWeight: 700 }}>{cube.totalFacts}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── DrillPanel ──
// Uses the shared DetailDrawer in panel mode (no scrim) so the user can
// still see and interact with the pivot table behind the drill-down while
// inspecting which records make up a cell.
function DrillPanel({
  rowLabel, colLabel, count, rows, loading, dimensionLabel, onClose,
}: {
  rowLabel: string; colLabel: string; count: number; rows: DrillRow[]; loading: boolean;
  dimensionLabel: (d: Dim) => string; onClose: () => void;
}) {
  useScrollLock(true);
  return (
    <DetailDrawer
      open
      onClose={onClose}
      mode="panel"
      width={420}
      kicker="Drill-down"
      title={`${rowLabel} × ${colLabel}`}
      subtitle={`${count} matching record${count === 1 ? '' : 's'}`}
      ariaLabel="Cell drill-down"
    >
      {loading ? (
        <Spinner label="Loading…" />
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No records returned.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r) => (
            <li key={r.factId} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
              <SectionLabel marginBottom={2}>
                {r.factType.replace(/-/g, ' ')}
              </SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(r.refs).map(([dim, v]) => v ? (
                  <span key={dim} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>{dimensionLabel(dim as Dim)}:</span> <strong>{v.label}</strong>
                  </span>
                ) : null)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </DetailDrawer>
  );
}

// ── SaveDialog ──
function SaveDialog({
  name, description, isUpdate, onChangeName, onChangeDesc, onCancel, onSubmit,
}: {
  name: string; description: string; isUpdate: boolean;
  onChangeName: (v: string) => void; onChangeDesc: (v: string) => void;
  onCancel: () => void; onSubmit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  useScrollLock(true);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onCancel}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={isUpdate ? 'Update saved report' : 'Save report'}
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', padding: 24, maxWidth: 460, width: '100%' }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>
          {isUpdate ? 'Update saved report' : 'Save report'}
        </h3>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Name</label>
        <input aria-label="Name" value={name} onChange={(e) => onChangeName(e.target.value)} autoFocus
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 6, marginBottom: 12 }} />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Description (optional)</label>
        <textarea aria-label="Description" value={description} onChange={(e) => onChangeDesc(e.target.value)} rows={2}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 6, marginBottom: 16, resize: 'vertical' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={!name.trim()}>
            {isUpdate ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
