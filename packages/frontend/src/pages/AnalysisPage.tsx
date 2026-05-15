import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import HelpPopover from '../components/HelpPopover';
import EmptyState from '../components/EmptyState';
import ExportMenu from '../components/ExportMenu';
import Button from '../components/Button';
import IconButton from '../components/IconButton';
import ConfirmDialog from '../components/ConfirmDialog';
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

interface DimensionDef {
  id: Dim;
  label: string;
  icon: string;
  description: string;
}

interface CubeResponse {
  rowDim: Dim;
  colDim: Dim;
  rows: Array<{ id: string; label: string; total: number }>;
  cols: Array<{ id: string; label: string; total: number }>;
  grid: Array<{ rowId: string; rowLabel: string; cells: Array<{ colId: string; colLabel: string; count: number; factIds: string[] }> }>;
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
  config: { rowDim?: Dim; colDim?: Dim; filters?: Array<{ dim: Dim; value: string; label?: string }> };
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

export default function AnalysisPage() {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [searchParams, setSearchParams] = useSearchParams();

  const [dimensions, setDimensions] = useState<DimensionDef[]>([]);
  const [rowDim, setRowDim] = useState<Dim | null>((searchParams.get('row') as Dim) || null);
  const [colDim, setColDim] = useState<Dim | null>((searchParams.get('col') as Dim) || null);
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

  // ── Persist (rowDim, colDim) to URL so reloads and shared links keep state ──
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (rowDim) next.set('row', rowDim); else next.delete('row');
    if (colDim) next.set('col', colDim); else next.delete('col');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowDim, colDim]);

  // ── Run the cube whenever the config changes ──
  const runCube = useCallback(async () => {
    if (!rowDim || !colDim) { setCube(null); return; }
    if (rowDim === colDim) { setError('Rows and Columns must be different dimensions.'); setCube(null); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await apiClient.post<{ success: boolean; data: CubeResponse }>('/analysis/cube', {
        orgId: activeOrgId || undefined,
        rowDim, colDim,
        filters: filters.map((f) => ({ dim: f.dim, value: f.value })),
      });
      setCube(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cube query failed');
      setCube(null);
    } finally {
      setLoading(false);
    }
  }, [rowDim, colDim, filters, activeOrgId]);
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
  const onZoneDrop = (zone: 'row' | 'col' | 'filter') => (e: React.DragEvent) => {
    e.preventDefault();
    const dim = e.dataTransfer.getData(DND_TYPE) as Dim;
    if (!dim) return;
    setActiveReportId(null);  // user is deviating from any loaded report
    if (zone === 'row') setRowDim(dim);
    else if (zone === 'col') setColDim(dim);
    else {
      // Adding a filter requires picking a value too. For v1, we just
      // open a chooser inline — the user picks a row off the cube to
      // turn it into a filter (handled by clicking a row label).
      addToast('info', `Click any ${dimensionLabel(dim)} row label in the grid to filter by it.`);
    }
  };

  const clearZone = (zone: 'row' | 'col') => () => {
    if (zone === 'row') setRowDim(null);
    else setColDim(null);
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
          config: { rowDim, colDim, filters },
        });
        addToast('success', 'Report updated.');
        setReports((prev) => prev.map((p) => p.id === r.data.id ? r.data : p));
      } else {
        const r = await apiClient.post<{ success: boolean; data: SavedReport }>('/analysis-reports', {
          orgId: activeOrgId || undefined,
          name: saveName.trim(),
          description: saveDesc.trim() || null,
          config: { rowDim, colDim, filters },
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
    if (r.config.rowDim) setRowDim(r.config.rowDim);
    if (r.config.colDim) setColDim(r.config.colDim);
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
  const dimensionIcon = (id: Dim): string => dimensions.find((d) => d.id === id)?.icon || '·';

  const exportPayload = useMemo(() => () => {
    if (!cube) return null;
    const headers = [dimensionLabel(cube.rowDim) + ' \\ ' + dimensionLabel(cube.colDim), ...cube.cols.map((c) => c.label), 'Total'];
    const rows = cube.grid.map((r) => {
      const rowTotal = r.cells.reduce((s, c) => s + c.count, 0);
      return [r.rowLabel, ...r.cells.map((c) => c.count), rowTotal] as Array<string | number>;
    });
    const colTotalsRow = ['Total', ...cube.cols.map((c) => c.total), cube.cols.reduce((s, c) => s + c.total, 0)] as Array<string | number>;
    rows.push(colTotalsRow);
    const filterSuffix = filters.length > 0
      ? '_' + filters.map((f) => `${f.dim}=${f.label}`).join('_').replace(/[^a-z0-9_-]/gi, '_')
      : '';
    return {
      filenameBase: `analysis_${cube.rowDim}_x_${cube.colDim}${filterSuffix}`,
      sheetName: `${dimensionLabel(cube.rowDim)} × ${dimensionLabel(cube.colDim)}`,
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
      <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{d.icon}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</span>
    </div>
  );

  const DropZone = ({
    label, value, onDrop, onClear, hint,
  }: { label: string; value: Dim | null; onDrop: (e: React.DragEvent) => void; onClear: () => void; hint: string }) => (
    <div
      onDragOver={onZoneDragOver}
      onDrop={onDrop}
      style={{
        flex: 1, minWidth: 0,
        padding: 12,
        background: value ? 'var(--color-bg)' : 'transparent',
        border: `1.5px dashed ${value ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        minHeight: 56,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {dimensionIcon(value)} {dimensionLabel(value)}
          </span>
          <button onClick={onClear} aria-label={`Clear ${label.toLowerCase()}`}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 16 }}>
            ×
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{hint}</div>
      )}
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Analysis</h1>
          <HelpPopover id="analysis-intro" title="Cube-style analysis" showInitially>
            Drag dimensions into Rows and Columns to pivot the org's catalog. Each cell shows how many records connect both. Click a cell to drill down to the matching entities. Click a row label to use that value as a filter. Saved reports persist your configuration and can be shared via link.
          </HelpPopover>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Pivot any two dimensions to see how the org connects. Drag from the palette into Rows and Columns.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Left palette */}
        <aside style={{ width: 220, flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Dimensions
          </div>
          {dimensions.map((d) => <Tile key={d.id} d={d} />)}

          <div style={{ marginTop: 16, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Saved Reports</span>
            <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>{reports.length}</span>
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
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 14, padding: 2 }}>
                  ×
                </button>
              </div>
            );
          })}
        </aside>

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Drop zones + action bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <DropZone label="Rows" value={rowDim} onDrop={onZoneDrop('row')} onClear={clearZone('row')} hint="Drag a dimension here for the y-axis." />
            <DropZone label="Columns" value={colDim} onDrop={onZoneDrop('col')} onClear={clearZone('col')} hint="Drag a dimension here for the x-axis." />
          </div>

          {/* Filter chips */}
          {filters.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filters</span>
              {filters.map((f, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontSize: 11 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>{dimensionLabel(f.dim)}:</span>
                  <strong>{f.label}</strong>
                  <button onClick={() => setFilters((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove filter"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted)', fontSize: 12 }}>×</button>
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
            <Button variant="primary" size="sm" onClick={runCube} disabled={!rowDim || !colDim || loading}>
              {loading ? 'Running…' : 'Run'}
            </Button>
            <Button size="sm" onClick={() => { setSaveName(''); setSaveDesc(''); setActiveReportId(null); setShowSave(true); }} disabled={!rowDim || !colDim}>
              Save as new
            </Button>
            {activeReportId && (
              <Button size="sm" onClick={() => setShowSave(true)}>
                Update saved
              </Button>
            )}
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
          {!rowDim || !colDim ? (
            <EmptyState
              icon={'⊞'}
              title="Pick two dimensions"
              description="Drag one dimension into Rows and another into Columns. The grid below will show how many records connect them."
            />
          ) : cube && cube.totalFacts === 0 ? (
            <EmptyState
              icon={'⊟'}
              title="No data for this pivot"
              description={`No ${dimensionLabel(rowDim)} link to ${dimensionLabel(colDim)} under the current filters.`}
            />
          ) : cube ? (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'auto' }}>
              {(cube.truncated.rows || cube.truncated.cols) && (
                <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                  Showing {cube.rows.length} of {cube.totalRows} rows and {cube.cols.length} of {cube.totalCols} columns. Add filters to narrow further.
                </div>
              )}
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th scope="col" style={thStyle()}>
                      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>
                        {dimensionLabel(cube.rowDim)} ↓ / {dimensionLabel(cube.colDim)} →
                      </span>
                    </th>
                    {cube.cols.map((c) => (
                      <th scope="col" key={c.id} style={thStyle()} title={`Total: ${c.total}`}>
                        <button
                          onClick={() => setFilters((prev) => [...prev.filter((f) => f.dim !== cube.colDim), { dim: cube.colDim, value: c.id, label: c.label }])}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left' }}
                          title="Click to add as filter"
                        >
                          {c.label}
                        </button>
                      </th>
                    ))}
                    <th scope="col" style={{ ...thStyle(), background: 'var(--color-bg)' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cube.grid.map((r) => {
                    const rowTotal = r.cells.reduce((s, c) => s + c.count, 0);
                    return (
                      <tr key={r.rowId}>
                        <th scope="row" style={thRowStyle()}>
                          <button
                            onClick={() => setFilters((prev) => [...prev.filter((f) => f.dim !== cube.rowDim), { dim: cube.rowDim, value: r.rowId, label: r.rowLabel }])}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0, textAlign: 'left' }}
                            title="Click to add as filter"
                          >
                            {r.rowLabel}
                          </button>
                        </th>
                        {r.cells.map((cell) => (
                          <td key={cell.colId} style={tdStyle(cell.count)}>
                            {cell.count > 0 ? (
                              <button
                                onClick={() => openDrill(r.rowLabel, cell.colLabel, cell.count, cell.factIds)}
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
                  <tr>
                    <th scope="row" style={{ ...thRowStyle(), background: 'var(--color-bg)' }}>Total</th>
                    {cube.cols.map((c) => (
                      <td key={c.id} style={{ ...tdStyle(c.total), background: 'var(--color-bg)', fontWeight: 600 }}>{c.total}</td>
                    ))}
                    <td style={{ ...tdStyle(cube.totalFacts), background: 'var(--color-bg)', fontWeight: 700 }}>{cube.totalFacts}</td>
                  </tr>
                </tbody>
              </table>
            </div>
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

// ── DrillPanel ──
function DrillPanel({
  rowLabel, colLabel, count, rows, loading, dimensionLabel, onClose,
}: {
  rowLabel: string; colLabel: string; count: number; rows: DrillRow[]; loading: boolean;
  dimensionLabel: (d: Dim) => string; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  useScrollLock(true);
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)', zIndex: 200, display: 'flex', flexDirection: 'column' }}
      ref={ref} role="dialog" aria-modal="true" aria-label="Cell drill-down">
      <header style={{ padding: 16, borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
              Drill-down
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {rowLabel} × {colLabel}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {count} matching record{count === 1 ? '' : 's'}
            </div>
          </div>
          <IconButton icon="check" label="Close" onClick={onClose} />
        </div>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No records returned.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((r) => (
              <li key={r.factId} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 2 }}>
                  {r.factType.replace(/-/g, ' ')}
                </div>
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
      </div>
    </div>
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
        <input value={name} onChange={(e) => onChangeName(e.target.value)} autoFocus
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 6, marginBottom: 12 }} />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Description (optional)</label>
        <textarea value={description} onChange={(e) => onChangeDesc(e.target.value)} rows={2}
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
