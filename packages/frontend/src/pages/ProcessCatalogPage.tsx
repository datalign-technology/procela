import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

interface ProcessStep {
  id: string;
  name: string;
  description: string;
}

interface SubProcess {
  id: string;
  name: string;
  description: string;
  steps: ProcessStep[];
}

interface Process {
  id: string;
  name: string;
  description: string;
  subProcesses: SubProcess[];
}

interface ValueStream {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  processes: Process[];
}

const statusBadge = (status: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  background: status === 'ACTIVE' ? '#d1f0eb' : status === 'DRAFT' ? '#f1f5f9' : '#fef3c7',
  color: status === 'ACTIVE' ? '#0f4f46' : status === 'DRAFT' ? '#64748b' : '#92400e',
});

export default function ProcessCatalogPage() {
  const navigate = useNavigate();
  const [valueStreams, setValueStreams] = useState<ValueStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: ValueStream[] }>(
        '/process-catalog/value-streams'
      );
      setValueStreams(res.data || []);
    } catch {
      // API may not be running
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/process-catalog/value-streams/${id}`);
      setValueStreams((prev) => prev.filter((vs) => vs.id !== id));
    } catch {
      // handle error
    }
  };

  const totalProcesses = valueStreams.reduce((sum, vs) => sum + vs.processes.length, 0);
  const totalSubProcesses = valueStreams.reduce(
    (sum, vs) => sum + vs.processes.reduce((s, p) => s + p.subProcesses.length, 0),
    0
  );
  const totalSteps = valueStreams.reduce(
    (sum, vs) =>
      sum +
      vs.processes.reduce(
        (s, p) => s + p.subProcesses.reduce((s2, sp) => s2 + sp.steps.length, 0),
        0
      ),
    0
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process Catalog</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate('/processes/wizard')}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Generate from Template
          </button>
          <button
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + Add Value Stream
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {valueStreams.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 20,
          }}
        >
          {[
            { label: 'Value Streams', value: valueStreams.length },
            { label: 'Processes', value: totalProcesses },
            { label: 'Sub-Processes', value: totalSubProcesses },
            { label: 'Steps', value: totalSteps },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                flex: 1,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          minHeight: 300,
        }}
      >
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>
            Loading...
          </p>
        ) : valueStreams.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>
              No value streams defined yet.
            </p>
            <button
              onClick={() => navigate('/processes/wizard')}
              style={{
                padding: '10px 20px',
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Generate from Industry Template
            </button>
          </div>
        ) : (
          <div>
            {valueStreams.map((vs) => {
              const isExpanded = expanded.has(vs.id);
              return (
                <div
                  key={vs.id}
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  {/* Value Stream Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 20px',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleExpand(vs.id)}
                  >
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 16 }}>
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{vs.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                        {vs.description}
                      </div>
                    </div>
                    <span style={statusBadge(vs.status)}>{vs.status}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {vs.processes.length} processes
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(vs.id);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        fontSize: 14,
                        padding: '4px 8px',
                      }}
                      title="Delete value stream"
                    >
                      &#x2715;
                    </button>
                  </div>

                  {/* Expanded Hierarchy */}
                  {isExpanded && (
                    <div style={{ padding: '0 20px 16px 48px' }}>
                      {vs.processes.map((proc) => (
                        <div key={proc.id} style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>
                            {proc.name}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                            {proc.description}
                          </div>
                          {proc.subProcesses.map((sp) => (
                            <div key={sp.id} style={{ marginLeft: 20, marginBottom: 8 }}>
                              <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                {sp.name}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                                {sp.description}
                              </div>
                              <ul style={{ listStyle: 'disc', paddingLeft: 18 }}>
                                {sp.steps.map((st) => (
                                  <li
                                    key={st.id}
                                    style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}
                                  >
                                    {st.name}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
