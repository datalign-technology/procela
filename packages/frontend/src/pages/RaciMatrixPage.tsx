import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { exportCsv } from '../lib/exportCsv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RaciRow {
  id: string;
  name: string;
  level: string;
  parentName: string | null;
}

interface RaciColumn {
  personId: string;
  name: string;
  role: string;
}

interface RaciData {
  rows: RaciRow[];
  columns: RaciColumn[];
  matrix: Record<string, Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RACI_COLORS: Record<string, { bg: string; text: string }> = {
  R: { bg: '#dcfce7', text: '#166534' }, // Green
  A: { bg: '#dbeafe', text: '#1e40af' }, // Blue
  C: { bg: '#fef3c7', text: '#92400e' }, // Amber
  I: { bg: '#f3f4f6', text: '#4b5563' }, // Gray
};

const RACI_LABELS: Record<string, string> = {
  R: 'Responsible',
  A: 'Accountable',
  C: 'Consulted',
  I: 'Informed',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function RaciMatrixPage() {
  const { activeOrgId } = useOrgContext();
  const [data, setData] = useState<RaciData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const orgParam = activeOrgId ? `?orgId=${activeOrgId}` : '';
        const res = await apiClient.get<{ success: boolean; data: RaciData }>(`/dashboard/raci${orgParam}`);
        setData(res.data);
      } catch (err: any) {
        setError(err.message || 'Failed to load RACI matrix');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeOrgId]);

  const handleExportCsv = () => {
    if (!data) return;
    const headers = ['Process', 'Level', 'Parent', ...data.columns.map((c) => `${c.name} (${c.role})`)];
    const rows = data.rows.map((row) => {
      const cells = data.columns.map((col) => data.matrix[row.id]?.[col.personId] || '-');
      return [row.name, row.level, row.parentName || '-', ...cells];
    });
    exportCsv(`raci-matrix-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
  };

  const handlePrint = () => {
    window.print();
  };

  const hasData = data && data.rows.length > 0 && data.columns.length > 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>RACI Matrix</h1>
        <Link to="/help" style={helpIconStyle} title="Help">?</Link>
      </div>

      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem', maxWidth: 720 }}>
        Auto-generated Responsible, Accountable, Consulted, Informed matrix based on process ownership and governance role assignments.
      </p>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {Object.entries(RACI_COLORS).map(([letter, colors]) => (
          <div key={letter} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 'var(--radius-sm)',
              background: colors.bg, color: colors.text,
              fontWeight: 700, fontSize: '0.8125rem',
            }}>
              {letter}
            </span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
              {RACI_LABELS[letter]}
            </span>
          </div>
        ))}
      </div>

      {loading && (
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Loading RACI matrix...</p>
      )}

      {error && (
        <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {!loading && !error && !hasData && (
        <div style={{
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: '3rem 2rem', textAlign: 'center',
        }}>
          <p style={{ fontSize: '1rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            No RACI data available.
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Define processes and assign governance roles to generate the RACI matrix.
          </p>
        </div>
      )}

      {!loading && !error && hasData && data && (
        <>
          {/* Export buttons */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button onClick={handleExportCsv} style={exportBtnStyle}>Export CSV</button>
            <button onClick={handlePrint} style={exportBtnStyle}>Export PDF</button>
          </div>

          {/* Table container */}
          <div style={{
            overflow: 'auto', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', background: 'var(--color-surface)',
          }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{
                    ...thStyle,
                    position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--color-surface)', minWidth: 220,
                  }}>
                    Process / Value Stream
                  </th>
                  {data.columns.map((col) => (
                    <th key={col.personId} style={{ ...thStyle, minWidth: 56, maxWidth: 80 }}>
                      <div style={{
                        writingMode: 'vertical-lr',
                        transform: 'rotate(180deg)',
                        whiteSpace: 'nowrap',
                        fontSize: '0.75rem',
                        lineHeight: 1.2,
                        paddingBottom: 4,
                      }}>
                        {col.name}
                      </div>
                      <div style={{
                        fontSize: '0.625rem', color: 'var(--color-text-muted)',
                        writingMode: 'vertical-lr', transform: 'rotate(180deg)',
                        whiteSpace: 'nowrap',
                      }}>
                        {col.role.replace(/_/g, ' ')}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{
                      ...tdStyle,
                      position: 'sticky', left: 0, zIndex: 1,
                      background: 'var(--color-surface)',
                      fontWeight: row.level === 'VALUE_STREAM' ? 600 : 400,
                      paddingLeft: row.level === 'PROCESS' ? '2rem' : '0.75rem',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: '0.625rem', fontWeight: 600,
                          padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                          background: row.level === 'VALUE_STREAM' ? '#ede9fe' : '#e0e7ff',
                          color: row.level === 'VALUE_STREAM' ? '#6d28d9' : '#3730a3',
                          whiteSpace: 'nowrap',
                        }}>
                          {row.level === 'VALUE_STREAM' ? 'VS' : 'PROC'}
                        </span>
                        <span style={{ fontSize: '0.8125rem' }}>{row.name}</span>
                      </div>
                      {row.parentName && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginTop: 2, paddingLeft: 38 }}>
                          {row.parentName}
                        </div>
                      )}
                    </td>
                    {data.columns.map((col) => {
                      const value = data.matrix[row.id]?.[col.personId];
                      const colors = value ? RACI_COLORS[value] : null;
                      return (
                        <td
                          key={col.personId}
                          style={{
                            ...tdStyle,
                            textAlign: 'center',
                            background: colors ? colors.bg : 'transparent',
                            color: colors ? colors.text : 'var(--color-text-muted)',
                            fontWeight: colors ? 700 : 400,
                            fontSize: '0.8125rem',
                          }}
                        >
                          {value || '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div style={{ marginTop: '1rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            {data.rows.length} processes/value streams | {data.columns.length} people
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const helpIconStyle: React.CSSProperties = {
  width: 16, height: 16, borderRadius: '50%',
  border: '1px solid var(--color-text-muted)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 10, color: 'var(--color-text-muted)',
  textDecoration: 'none', cursor: 'pointer', flexShrink: 0,
};

const exportBtnStyle: React.CSSProperties = {
  padding: '0.375rem 1rem',
  fontSize: '0.8125rem',
  fontWeight: 500,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.5rem',
  textAlign: 'left',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  borderBottom: '2px solid var(--color-border)',
  verticalAlign: 'bottom',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.5rem',
  borderBottom: '1px solid var(--color-border)',
  fontSize: '0.8125rem',
  verticalAlign: 'middle',
};
