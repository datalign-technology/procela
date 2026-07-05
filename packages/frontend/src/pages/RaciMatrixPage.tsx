import { SkeletonRows } from '../components/Skeleton';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ExportMenu from '../components/ExportMenu';
import { ExportPayload } from '../lib/export';
import IconButton from '../components/IconButton';
import InfoTip from '../components/InfoTip';
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

const RACI_COLORS: Record<string, { bg: string; text: string }> = {
  R: { bg: '#dcfce7', text: '#166534' },
  A: { bg: '#dbeafe', text: '#1e40af' },
  C: { bg: '#fef3c7', text: '#92400e' },
  I: { bg: '#f3f4f6', text: '#4b5563' },
};

const RACI_LABELS: Record<string, string> = {
  R: 'Responsible',
  A: 'Accountable',
  C: 'Consulted',
  I: 'Informed',
};

const LEVEL_CONFIG: Record<string, { label: string; indent: number; weight: number; badge: string; badgeBg: string; badgeColor: string }> = {
  VALUE_STREAM: { label: 'VS', indent: 0, weight: 700, badge: 'VS', badgeBg: '#ede9fe', badgeColor: '#6d28d9' },
  PROCESS:      { label: 'PRO', indent: 20, weight: 600, badge: 'PRO', badgeBg: '#e0e7ff', badgeColor: '#3730a3' },
  SUBPROCESS:   { label: 'SP', indent: 40, weight: 500, badge: 'SP', badgeBg: '#f0fdf4', badgeColor: '#166534' },
  ACTIVITY:     { label: 'ACT', indent: 60, weight: 400, badge: 'ACT', badgeBg: '#fef3c7', badgeColor: '#92400e' },
};

type ColumnGroupBy = 'name' | 'title' | 'jobRole' | 'orgUnit';

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.5rem',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)',
};

const tdStyle: React.CSSProperties = {
  padding: '0.375rem 0.5rem',
  border: '1px solid var(--color-border)',
  fontSize: 13,
};

export default function RaciMatrixPage() {
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

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const orgParam = activeOrgId ? `?orgId=${activeOrgId}` : '';
        const res = await apiClient.get<{ success: boolean; data: RaciData }>(`/dashboard/raci${orgParam}`);
        setData(res.data);
        // Auto-expand value streams
        const vsIds = new Set((res.data?.rows || []).filter((r) => r.level === 'VALUE_STREAM').map((r) => r.id));
        setExpanded(vsIds);
      } catch (err: any) {
        setError(err.message || 'Failed to load RACI matrix');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeOrgId]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    if (!data) return;
    setExpanded(new Set(data.rows.map((r) => r.id)));
  };

  const collapseAll = () => setExpanded(new Set());

  // Build tree structure from flat rows
  const isRowVisible = (row: RaciRow): boolean => {
    if (!row.parentId) return true;
    // Check if all ancestors are expanded
    let current = row;
    while (current.parentId) {
      if (!expanded.has(current.parentId)) return false;
      const parent = data?.rows.find((r) => r.id === current.parentId);
      if (!parent) return true;
      current = parent;
    }
    return true;
  };

  const hasChildren = (id: string): boolean => {
    return data?.rows.some((r) => r.parentId === id) || false;
  };

  const getColumnLabel = (col: RaciColumn): string => {
    switch (groupBy) {
      case 'title': return col.title || '(no title)';
      case 'jobRole': return col.jobRole || '(no job role)';
      case 'orgUnit': return col.orgUnit || '(no org)';
      default: return col.name;
    }
  };

  // Sort columns by the selected groupBy
  const sortedColumns = data ? [...data.columns].sort((a, b) => {
    return getColumnLabel(a).localeCompare(getColumnLabel(b));
  }) : [];

  const buildExport = (): ExportPayload | null => {
    if (!data) return null;
    // Export respects the user's explicit filters (section filter,
    // Hide-Empty columns) but ignores tree-collapse, which is incidental
    // navigation rather than intent. Headers and cells now use the same
    // column set so the two never drift apart.
    const exportRows = sectionFilteredRows;
    const exportCols = activeColumns;
    const headers = ['Process', 'Level', 'Parent', ...exportCols.map((c) => `${c.name} (${getColumnLabel(c)})`)];
    const rows = exportRows.map((row) => {
      const cells = exportCols.map((col) => data.matrix[row.id]?.[col.personId] || '-');
      return [row.name, row.level, row.parentName || '-', ...cells];
    });
    return {
      filenameBase: `raci-matrix-${new Date().toISOString().split('T')[0]}`,
      sheetName: 'RACI',
      headers,
      rows,
    };
  };

  // Determine if a row belongs to a governance value stream
  const governanceVsIds = new Set<string>();
  if (data) {
    for (const r of data.rows) {
      if (r.level === 'VALUE_STREAM' && (r.name.includes('Governance') || r.name.includes('Data Management'))) {
        governanceVsIds.add(r.id);
      }
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

  // Manual override: cycle R → A → C → I → clear
  const handleCellClick = async (nodeId: string, personId: string, current: string | undefined) => {
    const cycle = ['R', 'A', 'C', 'I', ''];
    const nextIdx = (cycle.indexOf(current || '') + 1) % cycle.length;
    const nextVal = cycle[nextIdx] || null;
    try {
      await apiClient.post('/dashboard/raci/override', { nodeId, personId, value: nextVal });
      // Refresh
      const orgParam = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: RaciData }>(`/dashboard/raci${orgParam}`);
      setData(res.data);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to update assignment');
    }
  };

  const hasData = data && data.rows.length > 0 && data.columns.length > 0;
  // Apply section filter
  const sectionFilteredRows = data ? data.rows.filter((r) => {
    if (sectionFilter === 'all') return true;
    const isGov = isGovernanceRow(r);
    return sectionFilter === 'governance' ? isGov : !isGov;
  }) : [];
  const treeFilteredRows = sectionFilteredRows.filter(isRowVisible);

  // Hide empty columns: only show people with at least one assignment in
  // currently-visible rows (before the row-empty pass, otherwise the two
  // filters loop on each other).
  const activeColumns = sortedColumns.filter((col) => {
    if (!hideEmpty || !data) return true;
    return treeFilteredRows.some((row) => data.matrix[row.id]?.[col.personId]);
  });

  // Hide empty rows: when Hide-Empty is on, drop rows that have no
  // assignment in any active column. Parents are kept either way so
  // the tree structure remains navigable even when intermediate nodes
  // are blank - hiding a parent would orphan its visible children.
  const visibleRows = !hideEmpty || !data
    ? treeFilteredRows
    : treeFilteredRows.filter((row) => {
        const hasChildren = data.rows.some((r) => r.parentId === row.id);
        if (hasChildren) return true;
        const cells = data.matrix[row.id] || {};
        return activeColumns.some((col) => cells[col.personId]);
      });

  // Validation warnings per row
  const rowWarnings = data ? visibleRows.map((row) => {
    const cells = data.matrix[row.id] || {};
    const values = Object.values(cells);
    const hasR = values.includes('R');
    const hasA = values.includes('A');
    const aCount = values.filter((v) => v === 'A').length;
    const warnings: string[] = [];
    if (!hasR) warnings.push('No R (Responsible)');
    if (!hasA) warnings.push('No A (Accountable)');
    if (aCount > 1) warnings.push(`${aCount} A's (should be 1)`);
    return { id: row.id, warnings };
  }) : [];
  const warningMap = new Map(rowWarnings.map((w) => [w.id, w.warnings]));
  const totalWarnings = rowWarnings.reduce((sum, w) => sum + w.warnings.length, 0);

  return (
    <div>
      <DependencyBanner phase="RACI depends on domains and governance structure being defined first." checks={[
        { label: 'Create at least one data domain', met: deps.hasDomains, link: '/data-domains' },
        { label: 'Establish governance groups', met: deps.hasGroups, link: '/governance' },
        { label: 'Assign governance roles', met: deps.hasRoles, link: '/people' },
      ]} />
      <PageHeader
        title="RACI Matrix"
        subtitle="Who's Responsible, Accountable, Consulted, and Informed for every activity — auto-generated from process ownership and governance role assignments."
      >
        <InfoTip term="RACI" />
      </PageHeader>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(RACI_COLORS).map(([letter, colors]) => (
          <div key={letter} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 4,
              background: colors.bg, color: colors.text,
              fontWeight: 700, fontSize: 12,
            }}>
              {letter}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{RACI_LABELS[letter]}</span>
          </div>
        ))}
      </div>

      {loading && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
          <SkeletonRows rows={5} columns={4} />
        </div>
      )}
      {error && <div style={{ color: 'var(--color-error)', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.75rem', fontSize: 13 }}>{error}</div>}
      {!loading && !error && !hasData && (
        <EmptyState
          icon={renderNavIcon('/dama-roles')}
          title="No RACI data available"
          description="Define processes and assign governance roles to generate the RACI matrix."
        />
      )}

      {!loading && !error && hasData && data && (
        <>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <ExportMenu build={buildExport} disabled={!data} />
            <IconButton icon="download" label="Print / PDF" variant="primary" onClick={() => window.print()} />
            <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' }} />
            <button onClick={expandAll} style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-primary)' }}>Expand All</button>
            <button onClick={collapseAll} style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-primary)' }}>Collapse All</button>
            <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' }} />
            <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Show columns by:</label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as ColumnGroupBy)}
              style={{ fontSize: 12, padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}
            >
              <option value="name">Person Name</option>
              <option value="title">Job Title</option>
              <option value="jobRole">Job Role</option>
              <option value="orgUnit">Org Unit</option>
            </select>
            <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' }} />
            <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
              Hide empty columns
            </label>
            <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' }} />
            <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Show:</label>
            <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value as any)}
              style={{ fontSize: 12, padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 4, background: 'var(--color-surface)' }}>
              <option value="all">All Processes</option>
              <option value="business">Business Only</option>
              <option value="governance">Governance Only</option>
            </select>
          </div>

          {/* Validation warnings summary */}
          {totalWarnings > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', marginBottom: 12,
              background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)', fontSize: 12,
            }}>
              <span style={{ color: '#92400e', fontWeight: 600 }}>{totalWarnings} warning{totalWarnings === 1 ? '' : 's'}</span>
              <span style={{ color: '#92400e' }}>
                {rowWarnings.filter((w) => w.warnings.length > 0).length} row{rowWarnings.filter((w) => w.warnings.length > 0).length === 1 ? '' : 's'} missing R or A assignments.
                Click any cell to manually assign.
              </span>
            </div>
          )}

          {/* Table */}
          <div style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th scope="col" style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, background: 'var(--color-surface)', minWidth: 280 }}>
                    Process Hierarchy
                  </th>
                  {activeColumns.map((col, ci) => {
                    const bgColors = ['#fef3c7', '#dbeafe', '#d1fae5', '#ede9fe', '#fce7f3', '#fee2e2', '#f0fdf4', '#e0e7ff'];
                    const bg = bgColors[ci % bgColors.length];
                    const label = getColumnLabel(col);
                    return (
                      <th scope="col" key={col.personId} style={{
                        ...thStyle, padding: 0, minWidth: 36, maxWidth: 40,
                        verticalAlign: 'bottom', background: bg,
                      }}>
                        <div style={{
                          height: Math.max(120, label.length * 5.5 + 40),
                          position: 'relative',
                          width: '100%',
                        }}>
                          <div style={{
                            position: 'absolute',
                            bottom: 6,
                            left: '50%',
                            transformOrigin: 'bottom left',
                            transform: 'rotate(-55deg)',
                            whiteSpace: 'nowrap',
                            fontSize: 11,
                            fontWeight: 500,
                            color: '#374151',
                            padding: '2px 4px',
                          }}>
                            {label}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const cfg = LEVEL_CONFIG[row.level] || LEVEL_CONFIG.ACTIVITY;
                  const isExp = expanded.has(row.id);
                  const hasCh = hasChildren(row.id);
                  const isGov = isGovernanceRow(row);
                  return (
                    <tr key={row.id} style={{ background: row.level === 'VALUE_STREAM' ? (isGov ? '#eff6ff' : '#fafbfc') : (isGov ? '#f8fbff' : '') }}>
                      <td style={{
                        ...tdStyle,
                        position: 'sticky', left: 0, zIndex: 1,
                        background: row.level === 'VALUE_STREAM' ? (isGov ? '#eff6ff' : '#fafbfc') : (isGov ? '#f8fbff' : 'var(--color-surface)'),
                        borderLeft: isGov ? '3px solid #3b82f6' : undefined,
                        paddingLeft: 8 + cfg.indent,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {hasCh ? (
                            <span
                              {...clickable(() => toggleExpand(row.id), { label: isExp ? `Collapse ${row.name}` : `Expand ${row.name}` })}
                              aria-expanded={isExp}
                              style={{ cursor: 'pointer', fontSize: 8, color: 'var(--color-text-muted)', width: 12, textAlign: 'center', flexShrink: 0 }}
                            >
                              {isExp ? '\u25BC' : '\u25B6'}
                            </span>
                          ) : (
                            <span style={{ width: 12, flexShrink: 0 }} />
                          )}
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                            background: isGov ? '#dbeafe' : cfg.badgeBg,
                            color: isGov ? '#1e40af' : cfg.badgeColor, flexShrink: 0,
                          }}>
                            {isGov ? 'GOV' : cfg.badge}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: cfg.weight }}>{row.name}</span>
                          {(warningMap.get(row.id) || []).length > 0 && (
                            <span title={(warningMap.get(row.id) || []).join(', ')}
                              style={{ color: 'var(--color-warning)', marginLeft: 4, flexShrink: 0, display: 'inline-flex' }}>
                              <AlertTriangle size={11} strokeWidth={2.2} />
                            </span>
                          )}
                        </div>
                      </td>
                      {activeColumns.map((col) => {
                        const value = data.matrix[row.id]?.[col.personId];
                        const reason = data.reasons?.[row.id]?.[col.personId];
                        const colors = value ? RACI_COLORS[value] : null;
                        return (
                          <td key={col.personId}
                            role="button"
                            tabIndex={0}
                            aria-label={`${row.name} — ${value ? RACI_LABELS[value] || value : 'unassigned'}. Activate to change.`}
                            onClick={() => handleCellClick(row.id, col.personId, value)}
                            onKeyDown={activateOnKey(() => handleCellClick(row.id, col.personId, value))}
                            style={{
                              ...tdStyle, textAlign: 'center', cursor: 'pointer',
                              background: colors ? colors.bg : 'transparent',
                              color: colors ? colors.text : 'var(--color-text-muted)',
                              fontWeight: colors ? 700 : 400, fontSize: 13,
                            }}
                            title={reason ? `${RACI_LABELS[value || ''] || ''}: ${reason}` : 'Click to assign'}
                          >
                            {value || '-'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
            {visibleRows.length} of {data.rows.length} rows | {activeColumns.length} of {sortedColumns.length} people{hideEmpty ? ' (empty hidden)' : ''} | {sectionFilter !== 'all' ? sectionFilter + ' processes' : 'all processes'} | Click any cell to override
          </div>
        </>
      )}
    </div>
  );
}
