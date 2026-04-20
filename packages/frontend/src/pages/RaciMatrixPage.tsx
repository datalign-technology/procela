import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';
import IconButton from '../components/IconButton';

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
  orgUnit: string;
}

interface RaciData {
  rows: RaciRow[];
  columns: RaciColumn[];
  matrix: Record<string, Record<string, string>>;
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

type ColumnGroupBy = 'name' | 'title' | 'orgUnit' | 'role';

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.5rem',
  textAlign: 'left',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border)',
};

const tdStyle: React.CSSProperties = {
  padding: '0.375rem 0.5rem',
  border: '1px solid var(--color-border)',
  fontSize: '0.8125rem',
};

export default function RaciMatrixPage() {
  const { activeOrgId } = useOrgContext();
  const [data, setData] = useState<RaciData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<ColumnGroupBy>('name');

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
      case 'title': return col.title || col.name;
      case 'orgUnit': return col.orgUnit || col.name;
      case 'role': return col.role.replace(/_/g, ' ') || col.name;
      default: return col.name;
    }
  };

  const getColumnSublabel = (col: RaciColumn): string => {
    switch (groupBy) {
      case 'title': return col.name;
      case 'orgUnit': return col.name;
      case 'role': return col.name;
      default: return col.title || col.role.replace(/_/g, ' ');
    }
  };

  // Sort columns by the selected groupBy
  const sortedColumns = data ? [...data.columns].sort((a, b) => {
    return getColumnLabel(a).localeCompare(getColumnLabel(b));
  }) : [];

  const handleExportCsv = () => {
    if (!data) return;
    const headers = ['Process', 'Level', 'Parent', ...sortedColumns.map((c) => `${c.name} (${getColumnLabel(c)})`)];
    const rows = data.rows.map((row) => {
      const cells = sortedColumns.map((col) => data.matrix[row.id]?.[col.personId] || '-');
      return [row.name, row.level, row.parentName || '-', ...cells];
    });
    exportCsv(`raci-matrix-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
  };

  const hasData = data && data.rows.length > 0 && data.columns.length > 0;
  const visibleRows = data ? data.rows.filter(isRowVisible) : [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>RACI Matrix</h1>
      </div>

      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1rem', maxWidth: 720 }}>
        Auto-generated Responsible, Accountable, Consulted, Informed matrix based on process ownership and governance role assignments.
        Expand value streams and processes to see sub-processes and activities.
      </p>

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

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading RACI matrix...</p>}
      {error && <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.75rem', fontSize: 13 }}>{error}</div>}
      {!loading && !error && !hasData && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '3rem 2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>No RACI data available. Define processes and assign governance roles to generate the RACI matrix.</p>
        </div>
      )}

      {!loading && !error && hasData && data && (
        <>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <IconButton icon="download" label="Export CSV" onClick={handleExportCsv} />
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
              <option value="orgUnit">Org Unit</option>
              <option value="role">Governance Role</option>
            </select>
          </div>

          {/* Table */}
          <div style={{ overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 2, background: 'var(--color-surface)', minWidth: 280 }}>
                    Process Hierarchy
                  </th>
                  {sortedColumns.map((col, ci) => {
                    const bgColors = ['#fef3c7', '#dbeafe', '#d1fae5', '#ede9fe', '#fce7f3', '#fee2e2', '#f0fdf4', '#e0e7ff'];
                    const bg = bgColors[ci % bgColors.length];
                    return (
                      <th key={col.personId} style={{
                        ...thStyle, padding: 0, height: 140, minWidth: 40, maxWidth: 44,
                        position: 'relative', overflow: 'hidden', background: bg,
                      }}>
                        <div style={{
                          position: 'absolute', bottom: 8, left: '50%',
                          transformOrigin: 'bottom left',
                          transform: 'rotate(-55deg)',
                          whiteSpace: 'nowrap', fontSize: 11, fontWeight: 500,
                          color: '#374151',
                        }}>
                          {getColumnLabel(col)}
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
                  return (
                    <tr key={row.id} style={{ background: row.level === 'VALUE_STREAM' ? '#fafbfc' : '' }}>
                      <td style={{
                        ...tdStyle,
                        position: 'sticky', left: 0, zIndex: 1,
                        background: row.level === 'VALUE_STREAM' ? '#fafbfc' : 'var(--color-surface)',
                        paddingLeft: 8 + cfg.indent,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {hasCh ? (
                            <span
                              onClick={() => toggleExpand(row.id)}
                              style={{ cursor: 'pointer', fontSize: 8, color: 'var(--color-text-muted)', width: 12, textAlign: 'center', flexShrink: 0 }}
                            >
                              {isExp ? '\u25BC' : '\u25B6'}
                            </span>
                          ) : (
                            <span style={{ width: 12, flexShrink: 0 }} />
                          )}
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                            background: cfg.badgeBg, color: cfg.badgeColor, flexShrink: 0,
                          }}>
                            {cfg.badge}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: cfg.weight }}>{row.name}</span>
                        </div>
                      </td>
                      {sortedColumns.map((col) => {
                        const value = data.matrix[row.id]?.[col.personId];
                        const colors = value ? RACI_COLORS[value] : null;
                        return (
                          <td key={col.personId} style={{
                            ...tdStyle, textAlign: 'center',
                            background: colors ? colors.bg : 'transparent',
                            color: colors ? colors.text : 'var(--color-text-muted)',
                            fontWeight: colors ? 700 : 400, fontSize: 13,
                          }}>
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
            {visibleRows.length} of {data.rows.length} rows visible | {sortedColumns.length} people | Grouped by {groupBy === 'orgUnit' ? 'org unit' : groupBy === 'title' ? 'job title' : groupBy}
          </div>
        </>
      )}
    </div>
  );
}
