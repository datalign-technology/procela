import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { INDUSTRIES } from '../types';
import { api } from '../api/client';

// ── Types for the AI-generated template ──

interface TemplateStep {
  name: string;
  description: string;
}

interface TemplateSubProcess {
  name: string;
  description: string;
  steps: TemplateStep[];
}

interface TemplateProcess {
  name: string;
  description: string;
  subProcesses: TemplateSubProcess[];
}

interface TemplateValueStream {
  name: string;
  description: string;
  processes: TemplateProcess[];
  selected: boolean;
}

interface GeneratedTemplate {
  valueStreams: TemplateValueStream[];
}

// ── Styles ──

const wizardShell: React.CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
};

const stepIndicator: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  marginBottom: 32,
};

const stepDot = (active: boolean, completed: boolean): React.CSSProperties => ({
  flex: 1,
  textAlign: 'center',
  padding: '12px 0',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? 'var(--color-primary)' : completed ? 'var(--color-text)' : 'var(--color-text-muted)',
  borderBottom: `3px solid ${active ? 'var(--color-primary)' : completed ? 'var(--color-primary)' : 'var(--color-border)'}`,
});

const card: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 24,
  boxShadow: 'var(--shadow-sm)',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 24px',
  background: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 24px',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

// ── Component ──

export default function ValueStreamWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState('');
  const [template, setTemplate] = useState<GeneratedTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedStreams, setExpandedStreams] = useState<Set<number>>(new Set());

  const steps = ['Select Industry', 'Preview Template', 'Apply'];

  const toggleStream = (idx: number) => {
    setExpandedStreams((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleStreamSelection = (idx: number) => {
    if (!template) return;
    setTemplate({
      ...template,
      valueStreams: template.valueStreams.map((vs, i) =>
        i === idx ? { ...vs, selected: !vs.selected } : vs
      ),
    });
  };

  const selectAll = () => {
    if (!template) return;
    const allSelected = template.valueStreams.every((vs) => vs.selected);
    setTemplate({
      ...template,
      valueStreams: template.valueStreams.map((vs) => ({ ...vs, selected: !allSelected })),
    });
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ success: boolean; data: { valueStreams: Omit<TemplateValueStream, 'selected'>[] } }>(
        '/ai/generate-template',
        { industry }
      );
      if (res.data) {
        setTemplate({
          valueStreams: res.data.valueStreams.map((vs) => ({ ...vs, selected: true })),
        });
        setExpandedStreams(new Set([0]));
        setStep(1);
      } else {
        setError('Unexpected response format. Please try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate template. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    // For now, navigate back to the process catalog.
    // In a full implementation this would POST the selected value streams to the backend.
    navigate('/processes', {
      state: {
        appliedTemplate: template
          ? {
              industry,
              valueStreams: template.valueStreams.filter((vs) => vs.selected),
            }
          : null,
      },
    });
  };

  const selectedCount = template?.valueStreams.filter((vs) => vs.selected).length ?? 0;

  return (
    <div style={wizardShell}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Value Stream Wizard</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Generate a process hierarchy based on your industry using AI.
      </p>

      {/* Step Indicator */}
      <div style={stepIndicator}>
        {steps.map((label, i) => (
          <div key={label} style={stepDot(i === step, i < step)}>
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {/* Step 0: Select Industry */}
      {step === 0 && (
        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Choose Your Industry</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
            Select your industry and Procela AI will generate a complete value stream hierarchy
            with processes, sub-processes, and steps as a starting point.
          </p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Industry
          </label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            style={selectStyle}
          >
            <option value="">-- Select an industry --</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>

          {error && (
            <p style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 12 }}>{error}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
            <button style={btnSecondary} onClick={() => navigate('/processes')}>
              Cancel
            </button>
            <button
              style={{ ...btnPrimary, opacity: !industry || loading ? 0.6 : 1 }}
              disabled={!industry || loading}
              onClick={handleGenerate}
            >
              {loading ? 'Generating...' : 'Generate Template'}
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Preview Template */}
      {step === 1 && template && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>
              Preview: {industry}
            </h2>
            <button style={{ ...btnSecondary, fontSize: 12, padding: '6px 14px' }} onClick={selectAll}>
              {template.valueStreams.every((vs) => vs.selected) ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
            Review the generated hierarchy. Check or uncheck value streams to include, and expand
            to see the full structure. You can edit everything after applying.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {template.valueStreams.map((vs, vsIdx) => {
              const isExpanded = expandedStreams.has(vsIdx);
              return (
                <div
                  key={vsIdx}
                  style={{
                    border: `1px solid ${vs.selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    background: vs.selected ? 'var(--color-primary-light)' : 'var(--color-bg)',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  {/* Value Stream Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleStream(vsIdx)}
                  >
                    <input
                      type="checkbox"
                      checked={vs.selected}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleStreamSelection(vsIdx);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 16, height: 16, accentColor: 'var(--color-primary)' }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)', userSelect: 'none' }}>
                      {isExpanded ? '\u25BC' : '\u25B6'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{vs.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                        {vs.description}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {vs.processes.length} processes
                    </span>
                  </div>

                  {/* Expanded Tree */}
                  {isExpanded && (
                    <div style={{ padding: '0 16px 16px 48px' }}>
                      {vs.processes.map((proc, pIdx) => (
                        <div key={pIdx} style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>
                            {proc.name}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                            {proc.description}
                          </div>
                          {proc.subProcesses.map((sp, spIdx) => (
                            <div key={spIdx} style={{ marginLeft: 20, marginBottom: 8 }}>
                              <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                                {sp.name}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                                {sp.description}
                              </div>
                              <ul style={{ listStyle: 'disc', paddingLeft: 18 }}>
                                {sp.steps.map((st, stIdx) => (
                                  <li
                                    key={stIdx}
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

          {error && (
            <p style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 12 }}>{error}</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
            <button style={btnSecondary} onClick={() => setStep(0)}>
              Back
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                style={btnSecondary}
                onClick={() => {
                  setTemplate(null);
                  setStep(0);
                }}
              >
                Regenerate
              </button>
              <button
                style={{ ...btnPrimary, opacity: selectedCount === 0 ? 0.6 : 1 }}
                disabled={selectedCount === 0}
                onClick={() => setStep(2)}
              >
                Continue ({selectedCount} selected)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Confirm & Apply */}
      {step === 2 && template && (
        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Confirm & Apply</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
            The following value streams will be added to your process catalog. You can edit,
            rename, or delete any of them afterwards.
          </p>

          <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
              Industry: <strong style={{ color: 'var(--color-text)' }}>{industry}</strong>
            </div>
            {template.valueStreams
              .filter((vs) => vs.selected)
              .map((vs, idx) => {
                const procCount = vs.processes.length;
                const spCount = vs.processes.reduce((sum, p) => sum + p.subProcesses.length, 0);
                const stepCount = vs.processes.reduce(
                  (sum, p) => sum + p.subProcesses.reduce((s2, sp) => s2 + sp.steps.length, 0),
                  0
                );
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{vs.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {vs.description}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {procCount} processes, {spCount} sub-processes, {stepCount} steps
                    </div>
                  </div>
                );
              })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button style={btnSecondary} onClick={() => setStep(1)}>
              Back
            </button>
            <button style={btnPrimary} onClick={handleApply}>
              Apply to Catalog
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
