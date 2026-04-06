import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

// ── Types ──

interface Step {
  id: string;
  name: string;
  description: string;
  orderIndex: number;
  status: string;
}

interface SubProcess {
  id: string;
  name: string;
  description: string;
  orderIndex: number;
  status: string;
  steps: Step[];
}

interface Process {
  id: string;
  name: string;
  description: string;
  orderIndex: number;
  status: string;
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

// ── Styles ──

const STATUSES = ['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'DEPRECATED'];

const statusColors: Record<string, { bg: string; color: string }> = {
  DRAFT: { bg: '#f1f5f9', color: '#64748b' },
  ACTIVE: { bg: '#d1f0eb', color: '#0f4f46' },
  UNDER_REVIEW: { bg: '#fef3c7', color: '#92400e' },
  DEPRECATED: { bg: '#fce7f3', color: '#9d174d' },
};

const badgeStyle = (status: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  background: statusColors[status]?.bg || '#f1f5f9',
  color: statusColors[status]?.color || '#64748b',
  cursor: 'pointer',
});

const btnIcon: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 6px',
  fontSize: 13,
  color: 'var(--color-text-muted)',
  borderRadius: 4,
};

const btnAdd: React.CSSProperties = {
  background: 'none',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 10px',
  fontSize: 12,
  color: 'var(--color-primary)',
  cursor: 'pointer',
  marginTop: 4,
};

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 13,
  width: '100%',
  background: 'var(--color-surface)',
};

// ── Inline Edit Component ──

function InlineEdit({
  value,
  onSave,
  fontSize = 14,
  fontWeight = 400,
  placeholder = 'Enter text...',
}: {
  value: string;
  onSave: (val: string) => void;
  fontSize?: number;
  fontWeight?: number;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value); setEditing(true); }}
        style={{ cursor: 'pointer', fontSize, fontWeight }}
        title="Click to edit"
      >
        {value || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{placeholder}</span>}
      </span>
    );
  }

  return (
    <input
      autoFocus
      style={{ ...inputStyle, fontSize, fontWeight }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { if (draft.trim() && draft !== value) onSave(draft.trim()); setEditing(false); }
        if (e.key === 'Escape') setEditing(false);
      }}
      placeholder={placeholder}
    />
  );
}

// ── Status Dropdown ──

function StatusSelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <span style={badgeStyle(value)} onClick={() => setOpen(true)} title="Click to change status">{value}</span>;
  }
  return (
    <select
      autoFocus
      value={value}
      onChange={(e) => { onChange(e.target.value); setOpen(false); }}
      onBlur={() => setOpen(false)}
      style={{ fontSize: 11, padding: '2px 4px', borderRadius: 4 }}
    >
      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// ── Add Item Form ──

function AddItemForm({ label, onAdd, onCancel }: { label: string; onAdd: (name: string, desc: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 12, marginTop: 6, marginBottom: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Add {label}</div>
      <input
        autoFocus
        style={{ ...inputStyle, marginBottom: 6 }}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onAdd(name.trim(), description.trim()); } if (e.key === 'Escape') onCancel(); }}
      />
      <input
        style={{ ...inputStyle, marginBottom: 8 }}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onAdd(name.trim(), description.trim()); } if (e.key === 'Escape') onCancel(); }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{ ...btnAdd, border: '1px solid var(--color-primary)', background: 'var(--color-primary)', color: '#fff' }}
          onClick={() => { if (name.trim()) onAdd(name.trim(), description.trim()); }}
          disabled={!name.trim()}
        >
          Add
        </button>
        <button style={{ ...btnAdd, color: 'var(--color-text-muted)' }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Main Component ──

export default function ProcessCatalogPage() {
  const navigate = useNavigate();
  const [valueStreams, setValueStreams] = useState<ValueStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingVs, setAddingVs] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null); // "proc:vsId" | "sp:vsId:procId" | "step:vsId:procId:spId"

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: ValueStream[] }>('/process-catalog/value-streams');
      setValueStreams(res.data || []);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  // ── Value Stream CRUD ──

  const addValueStream = async (name: string, description: string) => {
    await apiClient.post('/process-catalog/value-streams', { name, description });
    setAddingVs(false);
    fetchData();
  };

  const updateValueStream = async (id: string, data: Partial<ValueStream>) => {
    await apiClient.put(`/process-catalog/value-streams/${id}`, data);
    fetchData();
  };

  const deleteValueStream = async (id: string) => {
    await apiClient.delete(`/process-catalog/value-streams/${id}`);
    fetchData();
  };

  // ── Process CRUD ──

  const addProcess = async (vsId: string, name: string, description: string) => {
    await apiClient.post(`/process-catalog/value-streams/${vsId}/processes`, { name, description });
    setAddingTo(null);
    fetchData();
  };

  const updateProcess = async (vsId: string, procId: string, data: Record<string, any>) => {
    await apiClient.put(`/process-catalog/value-streams/${vsId}/processes/${procId}`, data);
    fetchData();
  };

  const deleteProcess = async (vsId: string, procId: string) => {
    await apiClient.delete(`/process-catalog/value-streams/${vsId}/processes/${procId}`);
    fetchData();
  };

  // ── SubProcess CRUD ──

  const addSubProcess = async (vsId: string, procId: string, name: string, description: string) => {
    await apiClient.post(`/process-catalog/value-streams/${vsId}/processes/${procId}/sub-processes`, { name, description });
    setAddingTo(null);
    fetchData();
  };

  const updateSubProcess = async (vsId: string, procId: string, spId: string, data: Record<string, any>) => {
    await apiClient.put(`/process-catalog/value-streams/${vsId}/processes/${procId}/sub-processes/${spId}`, data);
    fetchData();
  };

  const deleteSubProcess = async (vsId: string, procId: string, spId: string) => {
    await apiClient.delete(`/process-catalog/value-streams/${vsId}/processes/${procId}/sub-processes/${spId}`);
    fetchData();
  };

  // ── Step CRUD ──

  const addStep = async (vsId: string, procId: string, spId: string, name: string, description: string) => {
    await apiClient.post(`/process-catalog/value-streams/${vsId}/processes/${procId}/sub-processes/${spId}/steps`, { name, description });
    setAddingTo(null);
    fetchData();
  };

  const updateStep = async (vsId: string, procId: string, spId: string, stepId: string, data: Record<string, any>) => {
    await apiClient.put(`/process-catalog/value-streams/${vsId}/processes/${procId}/sub-processes/${spId}/steps/${stepId}`, data);
    fetchData();
  };

  const deleteStep = async (vsId: string, procId: string, spId: string, stepId: string) => {
    await apiClient.delete(`/process-catalog/value-streams/${vsId}/processes/${procId}/sub-processes/${spId}/steps/${stepId}`);
    fetchData();
  };

  // ── Stats ──

  const totalProcesses = valueStreams.reduce((sum, vs) => sum + vs.processes.length, 0);
  const totalSubProcesses = valueStreams.reduce((sum, vs) => sum + vs.processes.reduce((s, p) => s + p.subProcesses.length, 0), 0);
  const totalSteps = valueStreams.reduce((sum, vs) => sum + vs.processes.reduce((s, p) => s + p.subProcesses.reduce((s2, sp) => s2 + sp.steps.length, 0), 0), 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Process Catalog</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => navigate('/processes/wizard')}
            style={{ padding: '0.5rem 1rem', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            Generate from Template
          </button>
          <button
            onClick={() => setAddingVs(true)}
            style={{ padding: '0.5rem 1rem', background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            + Add Value Stream
          </button>
        </div>
      </div>

      {/* Stats */}
      {valueStreams.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          {[
            { label: 'Value Streams', value: valueStreams.length },
            { label: 'Processes', value: totalProcesses },
            { label: 'Sub-Processes', value: totalSubProcesses },
            { label: 'Steps', value: totalSteps },
          ].map((stat) => (
            <div key={stat.label} style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add Value Stream Form */}
      {addingVs && (
        <div style={{ marginBottom: 16 }}>
          <AddItemForm label="Value Stream" onAdd={addValueStream} onCancel={() => setAddingVs(false)} />
        </div>
      )}

      {/* Content */}
      <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', minHeight: 300 }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '4rem' }}>Loading...</p>
        ) : valueStreams.length === 0 && !addingVs ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>No value streams defined yet.</p>
            <button
              onClick={() => navigate('/processes/wizard')}
              style={{ padding: '10px 20px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
            >
              Generate from Industry Template
            </button>
          </div>
        ) : (
          valueStreams.map((vs) => {
            const isExpanded = expanded.has(vs.id);
            return (
              <div key={vs.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                {/* Value Stream Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px' }}>
                  <span
                    onClick={() => toggleExpand(vs.id)}
                    style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 16, cursor: 'pointer', userSelect: 'none' }}
                  >
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <InlineEdit value={vs.name} onSave={(name) => updateValueStream(vs.id, { name })} fontSize={15} fontWeight={600} placeholder="Value stream name" />
                    <div style={{ marginTop: 2 }}>
                      <InlineEdit value={vs.description} onSave={(description) => updateValueStream(vs.id, { description })} fontSize={13} placeholder="Add description..." />
                    </div>
                  </div>
                  <StatusSelect value={vs.status} onChange={(status) => updateValueStream(vs.id, { status })} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{vs.processes.length} proc</span>
                  <button style={btnIcon} onClick={() => deleteValueStream(vs.id)} title="Delete">&#x2715;</button>
                </div>

                {/* Expanded: Processes */}
                {isExpanded && (
                  <div style={{ padding: '0 20px 16px 48px' }}>
                    {vs.processes.map((proc) => (
                      <div key={proc.id} style={{ marginBottom: 10, borderLeft: '2px solid var(--color-border)', paddingLeft: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <div style={{ flex: 1 }}>
                            <InlineEdit value={proc.name} onSave={(name) => updateProcess(vs.id, proc.id, { name })} fontSize={14} fontWeight={500} placeholder="Process name" />
                          </div>
                          <StatusSelect value={proc.status} onChange={(status) => updateProcess(vs.id, proc.id, { status })} />
                          <button style={btnIcon} onClick={() => deleteProcess(vs.id, proc.id)} title="Delete">&#x2715;</button>
                        </div>
                        <div style={{ marginBottom: 4 }}>
                          <InlineEdit value={proc.description} onSave={(description) => updateProcess(vs.id, proc.id, { description })} fontSize={12} placeholder="Add description..." />
                        </div>

                        {/* Sub-Processes */}
                        {proc.subProcesses.map((sp) => (
                          <div key={sp.id} style={{ marginLeft: 16, marginBottom: 8, borderLeft: '2px solid var(--color-border)', paddingLeft: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                              <div style={{ flex: 1 }}>
                                <InlineEdit value={sp.name} onSave={(name) => updateSubProcess(vs.id, proc.id, sp.id, { name })} fontSize={13} fontWeight={500} placeholder="Sub-process name" />
                              </div>
                              <button style={btnIcon} onClick={() => deleteSubProcess(vs.id, proc.id, sp.id)} title="Delete">&#x2715;</button>
                            </div>
                            <div style={{ marginBottom: 4 }}>
                              <InlineEdit value={sp.description} onSave={(description) => updateSubProcess(vs.id, proc.id, sp.id, { description })} fontSize={12} placeholder="Add description..." />
                            </div>

                            {/* Steps */}
                            {sp.steps.map((step) => (
                              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16, marginBottom: 3 }}>
                                <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{'\u2022'}</span>
                                <div style={{ flex: 1 }}>
                                  <InlineEdit value={step.name} onSave={(name) => updateStep(vs.id, proc.id, sp.id, step.id, { name })} fontSize={12} placeholder="Step name" />
                                </div>
                                <button style={{ ...btnIcon, fontSize: 11 }} onClick={() => deleteStep(vs.id, proc.id, sp.id, step.id)} title="Delete">&#x2715;</button>
                              </div>
                            ))}

                            {/* Add Step */}
                            {addingTo === `step:${vs.id}:${proc.id}:${sp.id}` ? (
                              <div style={{ marginLeft: 16 }}>
                                <AddItemForm label="Step" onAdd={(name, desc) => addStep(vs.id, proc.id, sp.id, name, desc)} onCancel={() => setAddingTo(null)} />
                              </div>
                            ) : (
                              <button style={{ ...btnAdd, marginLeft: 16, fontSize: 11 }} onClick={() => setAddingTo(`step:${vs.id}:${proc.id}:${sp.id}`)}>
                                + Add Step
                              </button>
                            )}
                          </div>
                        ))}

                        {/* Add Sub-Process */}
                        {addingTo === `sp:${vs.id}:${proc.id}` ? (
                          <div style={{ marginLeft: 16 }}>
                            <AddItemForm label="Sub-Process" onAdd={(name, desc) => addSubProcess(vs.id, proc.id, name, desc)} onCancel={() => setAddingTo(null)} />
                          </div>
                        ) : (
                          <button style={{ ...btnAdd, marginLeft: 16 }} onClick={() => setAddingTo(`sp:${vs.id}:${proc.id}`)}>
                            + Add Sub-Process
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Add Process */}
                    {addingTo === `proc:${vs.id}` ? (
                      <AddItemForm label="Process" onAdd={(name, desc) => addProcess(vs.id, name, desc)} onCancel={() => setAddingTo(null)} />
                    ) : (
                      <button style={btnAdd} onClick={() => setAddingTo(`proc:${vs.id}`)}>
                        + Add Process
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
