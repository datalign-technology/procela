import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useRef, useState } from 'react';
import EmbeddablePageHeader from '../components/EmbeddablePageHeader';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ExportMenu from '../components/ExportMenu';
import { ExportPayload } from '../lib/export';
import { installPrintFit } from '../lib/printFit';
import DependencyBanner, { useDependencyChecks } from '../components/DependencyBanner';
import EmptyState from '../components/EmptyState';
import { renderNavIcon } from '../components/navIcons';
import { clickable, activateOnKey } from '../lib/a11y';

interface RaciRow {
  id: string;
  name: string;
  level: string;
  parentId: string | null;
  parentName: string | null;
}

interface RaciColumn {
  personId: string;
  name: string;
  role: string;
  title: string;
  jobRole: string;
  orgUnit: string;
}

interface RaciData {
  rows: RaciRow[];
  columns: RaciColumn[];
  matrix: Record<string, Record<string, string>>;
  reasons: Record<string, Record<string, string>>;
}

// Letter styling by weight: A reads loudest (solid primary), R a filled blue,
// C a quiet amber, I an outlined chip, and an empty cell a faint dot.
const RACI_STYLE: Record<string, { bg: string; fg: string; bd: string; name: string; desc: string }> = {
  R: { bg: '#e6eef9', fg: '#24508f', bd: '1px solid #9db6dd', name: 'Responsible', desc: 'Does the work.' },
  A: { bg: 'var(--color-primary)', fg: '#ffffff', bd: '1px solid var(--color-primary)', name: 'Accountable', desc: 'Signs off and answers for the result. Only one per row.' },
  C: { bg: '#fbe9d9', fg: '#9a4a0e', bd: '1px solid #fbe9d9', name: 'Consulted', desc: 'Asked for input before the work is done.' },
  I: { bg: 'var(--color-surface)', fg: 'var(--color-text-secondary)', bd: '1px dashed #b8b3a7', name: 'Informed', desc: 'Told about the outcome afterwards.' },
};
const EMPTY_STYLE = { bg: 'transparent', fg: 'var(--color-text-muted)', bd: '1px solid transparent' };
const RACI_LETTERS = ['R', 'A', 'C', 'I'] as const;

const LEVEL_LABEL: Record<string, string> = {
  VALUE_STREAM: 'Value stream', PROCESS: 'Process', SUBPROCESS: 'Sub-process', ACTIVITY: 'Activity',
};
const LEVEL_INDENT: Record<string, number> = { VALUE_STREAM: 8, PROCESS: 28, SUBPROCESS: 48, ACTIVITY: 68 };

type ColumnGroupBy = 'name' | 'title' | 'jobRole' | 'orgUnit';

const RACI_PRINT_STYLE_ID = 'procela-raci-print-styles';

function ensureRaciPrintStyles() {
  if (document.getElementById(RACI_PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = RACI_PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      nav, aside.app-aside,
      .sidebar, [class*="sidebar"], [class*="Sidebar"],
      [class*="chatPanel"], [class*="ChatPanel"],
      [class*="sessionTimeout"], [class*="toast"],
      [class*="shell"] > aside {
        display: none !important;
      }
      [class*="shell"], [class*="main"], [class*="content"] {
        display: block !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      .raci-print-hide { display: none !important; }
      .raci-scroll-area { overflow: visible !important; }
      [data-print-fit] {
        transform: scale(var(--print-fit)) !important;
        transform-origin: top left !important;
      }
      body { background: white !important; }
      @page { margin: 0.5in; size: landscape; }
    }
  `;
  document.head.appendChild(style);
}

function firstLast(name: string): { first: string; last: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

// The RACI endpoint returns nodes in store order, which interleaves value
// streams and their processes — so a process can render above the value
// stream it belongs to and the tree reads scrambled. Re-emit the rows
// depth-first: each value stream immediately followed by its descendants
// (process → sub-process → activity), regardless of store order. Intra-level
// order is preserved. Any node whose parent isn't present (filtered out /
// orphaned) is still appended so nothing silently disappears.
function orderTreeRows(rows: RaciRow[]): RaciRow[] {
  const byParent = new Map<string | null, RaciRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId);
    if (list) list.push(r); else byParent.set(r.parentId, [r]);
  }
  const out: RaciRow[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const r of byParent.get(parentId) || []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      walk(r.id);
    }
  };
  walk(null);
  for (const r of rows) if (!seen.has(r.id)) out.push(r);
  return out;
}

export default function RaciMatrixPage({
  embedded = false,
  actionsPortal,
}: {
  embedded?: boolean;
  actionsPortal?: HTMLElement | null;
} = {}) {
  const { activeOrgId } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const deps = useDependencyChecks();
  const [data, setData] = useState<RaciData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<ColumnGroupBy>('name');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [sectionFilter, setSectionFilter] = useState<'all' | 'business' | 'governance'>('all');
  // A highlighted letter dims every cell that isn't that letter, so you can
  // read "where is everyone Accountable?" at a glance.
  const [highlight, setHighlight] = useState<string | null>(null);
  // The cell whose detail/edit panel is open. Clicking a cell selects it
  // (it no longer cycles the value on click — that made accidental edits easy).
  const [selected, setSelected] = useState<{ rowId: string; personId: string } | null>(null);
  const printFitRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    ensureRaciPrintStyles();
    return installPrintFit(() => printFitRef.current);
  }, []);

  const reload = async () => {
    const orgParam = activeOrgId ? `?orgId=${activeOrgId}` : '';
    const res = await apiClient.get<{ success: boolean; data: RaciData }>(`/dashboard/raci${orgParam}`);
    setData(res.data);
    return res.data;
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        await reload();
        // Start collapsed at the value-stream level — the top level is the
        // value stream and the user expands it to reveal its processes,
        // matching the process catalog's top-down model.
        setExpanded(new Set());
      } catch (err) {
        setError(errorMessage(err, 'Failed to load RACI matrix'));
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const expandAll = () => { if (data) setExpanded(new Set(data.rows.map((r) => r.id))); };
  const collapseAll = () => setExpanded(new Set());

  const isRowVisible = (row: RaciRow): boolean => {
    if (!row.parentId) return true;
    let current = row;
    while (current.parentId) {
      if (!expanded.has(current.parentId)) return false;
      const parent = data?.rows.find((r) => r.id === current.parentId);
      if (!parent) return true;
      current = parent;
    }
    return true;
  };
  const hasChildren = (id: string): boolean => data?.rows.some((r) => r.parentId === id) || false;

  const getColumnLabel = (col: RaciColumn): string => {
    switch (groupBy) {
      case 'title': return col.title || '(no title)';
      case 'jobRole': return col.jobRole || '(no job role)';
      case 'orgUnit': return col.orgUnit || '(no org)';
      default: return col.name;
    }
  };

  const sortedColumns = data ? [...data.columns].sort((a, b) => getColumnLabel(a).localeCompare(getColumnLabel(b))) : [];

  // Governance-section detection (for the Processes filter).
  const governanceVsIds = new Set<string>();
  if (data) {
    for (const r of data.rows) {
      if (r.level === 'VALUE_STREAM' && (r.name.includes('Governance') || r.name.includes('Data Management'))) governanceVsIds.add(r.id);
    }
  }
  const isGovernanceRow = (row: RaciRow): boolean => {
    if (governanceVsIds.has(row.id)) return true;
    let current = row;
    while (current.parentId) {
      if (governanceVsIds.has(current.parentId)) return true;
      const parent = data?.rows.find((r) => r.id === current.parentId);
      if (!parent) break;
      current = parent;
    }
    return false;
  };

  const setCellValue = async (nodeId: string, personId: string, value: string) => {
    try {
      await apiClient.post('/dashboard/raci/override', { nodeId, personId, value: value || null });
      await reload();
      addToast('success', 'RACI assignment updated');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to update assignment');
    }
  };

  const hasData = !!data && data.rows.length > 0 && data.columns.length > 0;
  // Depth-first tree order so value streams head their own processes.
  const orderedRows = data ? orderTreeRows(data.rows) : [];
  const sectionFilteredRows = orderedRows.filter((r) => {
    if (sectionFilter === 'all') return true;
    const isGov = isGovernanceRow(r);
    return sectionFilter === 'governance' ? isGov : !isGov;
  });
  const treeFilteredRows = sectionFilteredRows.filter(isRowVisible);

  const activeColumns = sortedColumns.filter((col) => {
    if (!hideEmpty || !data) return true;
    return treeFilteredRows.some((row) => data.matrix[row.id]?.[col.personId]);
  });

  const visibleRows = !hideEmpty || !data
    ? treeFilteredRows
    : treeFilteredRows.filter((row) => {
        if (data.rows.some((r) => r.parentId === row.id)) return true;
        const cells = data.matrix[row.id] || {};
        return activeColumns.some((col) => cells[col.personId]);
      });

  // Per-row "Check": exactly one A, at least one R.
  const rowCheck = (rowId: string): { label: string; ok: boolean } => {
    const cells = data?.matrix[rowId] || {};
    const values = Object.values(cells);
    const nA = values.filter((v) => v === 'A').length;
    const nR = values.filter((v) => v === 'R').length;
    if (nA === 1 && nR >= 1) return { label: 'OK', ok: true };
    if (nA === 0) return { label: 'No A', ok: false };
    if (nA > 1) return { label: `${nA} As`, ok: false };
    return { label: 'No R', ok: false };
  };

  const buildExport = (): ExportPayload | null => {
    if (!data) return null;
    const headers = ['Process', 'Level', 'Parent', 'Check', ...activeColumns.map((c) => `${c.name} (${getColumnLabel(c)})`)];
    const rows = sectionFilteredRows.map((row) => {
      const cells = activeColumns.map((col) => data.matrix[row.id]?.[col.personId] || '-');
      return [row.name, row.level, row.parentName || '-', rowCheck(row.id).label, ...cells];
    });
    return { filenameBase: `raci-matrix-${new Date().toISOString().split('T')[0]}`, sheetName: 'RACI', headers, rows };
  };

  // Default side-panel observations — computed, not hard-coded.
  const observations: string[] = [];
  if (data) {
    for (const col of activeColumns) {
      let any = false, aCount = 0;
      for (const row of visibleRows) {
        const v = data.matrix[row.id]?.[col.personId];
        if (v) any = true;
        if (v === 'A') aCount++;
      }
      if (!any) observations.push(`${col.name} has no letter on any process.`);
      else if (visibleRows.length > 1 && aCount === visibleRows.length) observations.push(`${col.name} is Accountable for every row. Check that is intended.`);
      if (observations.length >= 4) break;
    }
  }

  // Resolve the selected cell into display data.
  const selectedInfo = (() => {
    if (!selected || !data) return null;
    const row = data.rows.find((r) => r.id === selected.rowId);
    const col = data.columns.find((c) => c.personId === selected.personId);
    if (!row || !col) return null;
    const value = data.matrix[row.id]?.[col.personId] || '';
    const reason = data.reasons?.[row.id]?.[col.personId] || '';
    return { row, col, value, reason };
  })();

  const controls = (
    <div className="raci-print-hide" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 16 }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Columns</span>
        <select aria-label="Show columns by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as ColumnGroupBy)} style={{ height: 38, padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', font: 'inherit', fontSize: 13 }}>
          <option value="name">People</option>
          <option value="title">Job titles</option>
          <option value="jobRole">Job roles</option>
          <option value="orgUnit">Org units</option>
        </select>
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Processes</span>
        <select aria-label="Show processes" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value as any)} style={{ height: 38, padding: '0 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', font: 'inherit', fontSize: 13 }}>
          <option value="all">All</option>
          <option value="business">Business only</option>
          <option value="governance">Governance only</option>
        </select>
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', fontSize: 14 }}>
        <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--color-primary)' }} />
        Hide people with no letters
      </label>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <ExportMenu build={buildExport} disabled={!data} />
        <button type="button" onClick={expandAll} style={{ height: 36, padding: '0 10px', border: 0, background: 'transparent', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>Expand all</button>
        <button type="button" onClick={collapseAll} style={{ height: 36, padding: '0 10px', border: 0, background: 'transparent', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', cursor: 'pointer' }}>Collapse all</button>
      </span>
    </div>
  );

  return (
    <div>
      <DependencyBanner phase="RACI depends on domains and governance structure being defined first." checks={[
        { label: 'Create at least one data domain', met: deps.hasDomains, link: '/data-domains' },
        { label: 'Establish governance groups', met: deps.hasGroups, link: '/governance' },
        { label: 'Assign governance roles', met: deps.hasRoles, link: '/people' },
      ]} />
      <EmbeddablePageHeader
        embedded={embedded}
        actionsPortal={actionsPortal}
        title="RACI Matrix"
        subtitle="Who's Responsible, Accountable, Consulted, and Informed for every activity — auto-generated from process ownership and governance role assignments."
      />

      {/* What RACI means — plain definitions; click a letter to highlight it. */}
      <Card padding={0} marginBottom={0}>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>What RACI means</h2>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Built automatically from process owners and role assignments. Click a letter to highlight it.</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
            {RACI_LETTERS.map((k) => {
              const st = RACI_STYLE[k];
              const active = highlight === k;
              return (
                <button key={k} type="button" onClick={() => setHighlight(active ? null : k)} aria-pressed={active}
                  style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', padding: 12, borderRadius: 'var(--radius-md)', cursor: 'pointer', background: active ? 'var(--color-primary-light)' : 'var(--color-surface)', border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}` }}>
                  <span aria-hidden="true" style={{ flex: 'none', width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono, monospace)', fontSize: 15, fontWeight: 600, background: st.bg, color: st.fg, border: st.bd }}>{k}</span>
                  <span><span style={{ display: 'block', fontWeight: 600 }}>{st.name}</span><span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-secondary)' }}>{st.desc}</span></span>
                </button>
              );
            })}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>Rule of thumb: every activity needs <strong>exactly one A</strong> and <strong>at least one R</strong>.</p>
        </div>
      </Card>

      {controls}

      {loading && <Card style={{ marginTop: 12 }}><SkeletonRows rows={5} columns={4} /></Card>}
      {error && <div style={{ marginTop: 12, color: 'var(--color-error)', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.75rem', fontSize: 13 }}>{error}</div>}
      {!loading && !error && !hasData && (
        <div style={{ marginTop: 12 }}>
          <EmptyState icon={renderNavIcon('/dama-roles')} title="No RACI data available" description="Define processes and assign governance roles to generate the RACI matrix." />
        </div>
      )}

      {!loading && !error && hasData && data && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 12, alignItems: 'flex-start' }}>
          {/* Matrix */}
          <main style={{ flex: '999 1 640px', minWidth: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div className="raci-scroll-area" style={{ overflowX: 'auto' }}>
              <table ref={printFitRef} style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 14, minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--color-surface)', textAlign: 'left', padding: '12px 16px', minWidth: 260, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', verticalAlign: 'bottom' }}>Process</th>
                    <th scope="col" title="Does this row have one A and at least one R?" style={{ padding: '12px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', verticalAlign: 'bottom', textAlign: 'left', whiteSpace: 'nowrap' }}>Check</th>
                    {activeColumns.map((col) => {
                      const nm = firstLast(col.name);
                      return (
                        <th scope="col" key={col.personId} title={`${col.name}${getColumnLabel(col) !== col.name ? ` — ${getColumnLabel(col)}` : ''}`} style={{ padding: '10px 4px', width: 64, minWidth: 64, borderBottom: '1px solid var(--color-border)', verticalAlign: 'bottom', fontWeight: 500 }}>
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <Avatar name={col.name} size="sm" />
                            {groupBy === 'name' ? (
                              <span style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.2, textAlign: 'center' }}>{nm.first}<span style={{ display: 'block', color: 'var(--color-text-muted)' }}>{nm.last}</span></span>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.2, textAlign: 'center', maxWidth: 60, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{getColumnLabel(col)}</span>
                            )}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const isExp = expanded.has(row.id);
                    const hasCh = hasChildren(row.id);
                    const isVs = row.level === 'VALUE_STREAM';
                    const chk = rowCheck(row.id);
                    const headBg = isVs ? 'var(--color-bg)' : 'var(--color-surface)';
                    return (
                      <tr key={row.id} className="raci-row">
                        <th scope="row" style={{ position: 'sticky', left: 0, zIndex: 1, background: headBg, textAlign: 'left', padding: `0 16px 0 ${LEVEL_INDENT[row.level] ?? 8}px`, height: 48, borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', fontWeight: isVs ? 600 : 500 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {hasCh ? (
                              <span {...clickable(() => toggleExpand(row.id), { label: isExp ? `Collapse ${row.name}` : `Expand ${row.name}` })} aria-expanded={isExp} style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}>
                                <span aria-hidden="true" style={{ display: 'inline-block', transform: `rotate(${isExp ? 90 : 0}deg)`, transition: 'transform 0.12s', fontSize: 11 }}>&#9654;</span>
                              </span>
                            ) : <span style={{ width: 24, flexShrink: 0 }} />}
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block' }}>{row.name}</span>
                              <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>{LEVEL_LABEL[row.level] || row.level}</span>
                            </span>
                          </span>
                        </th>
                        <td style={{ padding: '0 10px', borderBottom: '1px solid var(--color-border)', borderRight: '1px solid var(--color-border)', whiteSpace: 'nowrap', fontSize: 13 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: chk.ok ? 'var(--color-success)' : 'var(--color-error)' }}>
                            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: 'currentColor' }} />{chk.label}
                          </span>
                        </td>
                        {activeColumns.map((col) => {
                          const value = data.matrix[row.id]?.[col.personId] || '';
                          const st = value ? RACI_STYLE[value] : EMPTY_STYLE;
                          const isSel = selected?.rowId === row.id && selected?.personId === col.personId;
                          const dim = highlight && value !== highlight;
                          return (
                            <td key={col.personId} style={{ padding: 4, borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                              <button
                                type="button"
                                aria-label={`${col.name}, ${row.name}: ${value ? RACI_STYLE[value].name : 'no role'}. Activate to inspect or change.`}
                                onClick={() => setSelected({ rowId: row.id, personId: col.personId })}
                                onKeyDown={activateOnKey(() => setSelected({ rowId: row.id, personId: col.personId }))}
                                style={{ width: 44, height: 36, borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-mono, monospace)', fontSize: 15, fontWeight: 500, background: st.bg, color: st.fg, border: st.bd, opacity: dim ? 0.25 : 1, boxShadow: isSel ? '0 0 0 2px var(--color-text)' : 'none', transition: 'opacity 0.1s' }}
                                title={value ? (data.reasons?.[row.id]?.[col.personId] ? `${RACI_STYLE[value].name}: ${data.reasons[row.id][col.personId]}` : RACI_STYLE[value].name) : 'No role — click to assign'}
                              >
                                {value || '·'}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px', fontSize: 13, color: 'var(--color-text-muted)', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
              <span>Rows {visibleRows.length} of {sectionFilteredRows.length} · People {activeColumns.length} of {sortedColumns.length}{hideEmpty ? ' (empty hidden)' : ''}</span>
              <span>Click any cell to see why, or to change it.</span>
            </div>
          </main>

          {/* Selected-cell side panel */}
          <aside aria-label="Selected cell" className="raci-print-hide" style={{ flex: '1 1 280px' }}>
            <Card padding={0}>
              <div style={{ padding: '16px 18px' }}>
                {selectedInfo ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Selected cell</div>
                    <h2 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 600 }}>{selectedInfo.col.name}</h2>
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>on {selectedInfo.row.name}</p>
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 36, height: 36, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono, monospace)', fontSize: 16, background: selectedInfo.value ? RACI_STYLE[selectedInfo.value].bg : EMPTY_STYLE.bg, color: selectedInfo.value ? RACI_STYLE[selectedInfo.value].fg : EMPTY_STYLE.fg, border: selectedInfo.value ? RACI_STYLE[selectedInfo.value].bd : EMPTY_STYLE.bd }}>{selectedInfo.value || '·'}</span>
                      <span style={{ fontWeight: 600 }}>{selectedInfo.value ? RACI_STYLE[selectedInfo.value].name : 'No role'}</span>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--color-text)' }}>Why:</strong> {selectedInfo.reason || 'No stated reason — set manually or inherited from process ownership.'}
                    </div>
                    <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Change to</div>
                    <div role="group" aria-label="Change RACI value" style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {[...RACI_LETTERS, 'None'].map((k) => {
                        const letter = k === 'None' ? '' : k;
                        const isCurrent = selectedInfo.value === letter;
                        return (
                          <button key={k} type="button" title={letter ? RACI_STYLE[letter].name : 'Clear'} disabled={isCurrent}
                            onClick={() => setCellValue(selectedInfo.row.id, selectedInfo.col.personId, letter)}
                            style={{ height: 36, minWidth: 40, padding: '0 10px', border: `1px solid ${isCurrent ? 'var(--color-primary)' : 'var(--color-border)'}`, background: isCurrent ? 'var(--color-primary-light)' : 'var(--color-surface)', color: isCurrent ? 'var(--color-primary)' : 'var(--color-text)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono, monospace)', fontSize: 14, cursor: isCurrent ? 'default' : 'pointer' }}>{k}</button>
                        );
                      })}
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>A manual change overrides the automatic value and is logged.</p>
                  </>
                ) : (
                  <>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Pick a cell</h2>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>Click any letter in the grid to see why that person has it and to change it.</p>
                    {observations.length > 0 && (
                      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>Worth a look</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {observations.map((o, i) => <li key={i}>{o}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
