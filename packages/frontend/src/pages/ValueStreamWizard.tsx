import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { INDUSTRIES } from '../types';
import { apiClient } from '../api/client';
import { useOrgContext, VALUE_STREAM_LEVELS } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';

// ── Types ──

interface TemplateActivity { name: string; description: string; }
interface TemplateProcess { name: string; description: string; purpose?: string; activities: TemplateActivity[]; subProcesses?: any[]; }
interface TemplateValueStream { name: string; description: string; purpose?: string; businessOutcome?: string; processes: TemplateProcess[]; selected: boolean; }
interface GeneratedTemplate { valueStreams: TemplateValueStream[]; }

// ── Styles ──

const card: React.CSSProperties = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: 'var(--shadow-sm)',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 24px', background: 'var(--color-primary)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 24px', background: 'var(--color-bg)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
};

// ── Component ──

export default function ValueStreamWizard() {
  const navigate = useNavigate();
  const { activeOrgId, activeOrgName, activeOrgType } = useOrgContext();
  const addToast = useToastStore((s) => s.addToast);
  const [industry, setIndustry] = useState('');
  const [orgIndustry, setOrgIndustry] = useState('');
  const [industrySource, setIndustrySource] = useState<'own' | 'inherited' | ''>('');
  const [template, setTemplate] = useState<GeneratedTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [expandedStreams, setExpandedStreams] = useState<Set<number>>(new Set());
  const [confirmIndustry, setConfirmIndustry] = useState('');
  const [existingCount, setExistingCount] = useState(0);
  // Parent org for the breadcrumb banner ("in Tidewater Utilities").
  const [parentName, setParentName] = useState('');
  // Immediate child divisions of the active org. When the active org is
  // a company with divisions, planting value streams at the company
  // level is almost always wrong — the divisions (Electric, Water…)
  // have genuinely different processes and should not share one
  // catalog. We block generation in that case and point the user at
  // the division picker. Single-tier companies (no divisions) still
  // work fine at the company level.
  const [childDivisions, setChildDivisions] = useState<string[]>([]);

  // Check existing value stream count to warn about duplicates
  useEffect(() => {
    const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
    apiClient.get<{ success: boolean; stats?: { byLevel?: Record<string, number> } }>(`/process-catalog${qp}`)
      .then((res) => { setExistingCount(res.stats?.byLevel?.VALUE_STREAM || 0); })
      .catch(() => { /* */ });
  }, [activeOrgId]);

  // Fetch org's industry (and capture parent's display name for the
  // breadcrumb in the context banner).
  useEffect(() => {
    if (!activeOrgId) { setParentName(''); return; }
    async function loadOrgIndustry() {
      try {
        const res = await apiClient.get<{ success: boolean; data: { industry?: string; parentId?: string | null } }>(`/organizations/${activeOrgId}`);
        const org = res.data;
        if (org?.industry) {
          setOrgIndustry(org.industry);
          setIndustry(org.industry);
          setIndustrySource('own');
        }
        if (org?.parentId) {
          try {
            const parentRes = await apiClient.get<{ success: boolean; data: { industry?: string; name?: string } }>(`/organizations/${org.parentId}`);
            if (parentRes.data?.name) setParentName(parentRes.data.name);
            if (!org.industry && parentRes.data?.industry) {
              setOrgIndustry(parentRes.data.industry);
              setIndustry(parentRes.data.industry);
              setIndustrySource('inherited');
            }
          } catch { /* */ }
        } else {
          setParentName('');
        }
      } catch { /* */ }
    }
    loadOrgIndustry();
  }, [activeOrgId]);

  // Fetch the active org's subtree so we can detect immediate child
  // divisions. Used by the top-level-blocking hint below.
  useEffect(() => {
    if (!activeOrgId) { setChildDivisions([]); return; }
    apiClient
      .get<{ success: boolean; data: Array<{ id: string; name: string; type: string; parentId?: string | null }> }>(`/organizations?scopeOrgId=${activeOrgId}`)
      .then((res) => {
        const divisions = (res.data || [])
          .filter((o) => o.parentId === activeOrgId && o.type === 'division')
          .map((o) => o.name);
        setChildDivisions(divisions);
      })
      .catch(() => { setChildDivisions([]); });
  }, [activeOrgId]);

  // Auto-generate when industry is resolved from org
  const handleGenerate = useCallback(async (ind: string) => {
    if (!ind || loading) return;
    setLoading(true);
    setError('');
    setTemplate(null);
    try {
      const res = await apiClient.post<{ success: boolean; data: { valueStreams: Omit<TemplateValueStream, 'selected'>[] } }>(
        '/ai/generate-template', { industry: ind }
      );
      if (res.data) {
        setTemplate({ valueStreams: res.data.valueStreams.map((vs) => ({ ...vs, selected: true })) });
        setExpandedStreams(new Set([0]));
      } else {
        setError('Unexpected response format. Please try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate. Is the API key configured?');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // No auto-generate — user must explicitly click Generate

  const toggleStream = (idx: number) => {
    setExpandedStreams((prev) => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });
  };

  const toggleStreamSelection = (idx: number) => {
    if (!template) return;
    setTemplate({ ...template, valueStreams: template.valueStreams.map((vs, i) => i === idx ? { ...vs, selected: !vs.selected } : vs) });
  };

  const selectAll = () => {
    if (!template) return;
    const allSelected = template.valueStreams.every((vs) => vs.selected);
    setTemplate({ ...template, valueStreams: template.valueStreams.map((vs) => ({ ...vs, selected: !allSelected })) });
  };

  const handleApply = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!template) return;
    setApplying(true);
    setError('');
    try {
      const selectedStreams = template.valueStreams.filter((vs) => vs.selected).map(({ selected: _, ...rest }) => rest);
      await apiClient.post('/process-catalog/apply-template', { industry, valueStreams: selectedStreams, orgId: activeOrgId || undefined });
      addToast('success', `Applied ${selectedStreams.length} value stream${selectedStreams.length === 1 ? '' : 's'}`);
      navigate('/processes');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply template.');
      setApplying(false);
    }
  };

  const selectedCount = template?.valueStreams.filter((vs) => vs.selected).length ?? 0;
  const totalProcesses = template ? template.valueStreams.filter((vs) => vs.selected).reduce((sum, vs) => sum + vs.processes.length, 0) : 0;
  const totalActivities = template ? template.valueStreams.filter((vs) => vs.selected).reduce((sum, vs) => sum + vs.processes.reduce((s, p) => s + (p.activities || []).length, 0), 0) : 0;

  // Scope guards. The wizard plants value streams under the active
  // org, so we need to stop two misuses up front:
  //   1. The active org is below the value-stream tier (department,
  //      team…). VALUE_STREAM_LEVELS already encodes which levels can
  //      host streams, so anything not in that list is blocked.
  //   2. The active org is a multi-division company (e.g. Tidewater
  //      Utilities with Electric / Water divisions). Generating at the
  //      parent in that case silently creates one shared catalog the
  //      divisions don't actually share. Single-tier companies (no
  //      divisions) keep working normally.
  const isCompanyWithDivisions = activeOrgType === 'company' && childDivisions.length > 0;
  const wrongLevel = !!activeOrgType && !VALUE_STREAM_LEVELS.includes(activeOrgType);
  const blocked = isCompanyWithDivisions || wrongLevel;
  const prettyType = (t: string) => t ? t.charAt(0).toUpperCase() + t.slice(1) : '';

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>
            {activeOrgName ? `Process Wizard — ${activeOrgName}` : 'Process Wizard'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            AI generates a complete process hierarchy (Value Streams → Processes → Activities) based on your industry.
          </p>
        </div>
        <button style={btnSecondary} onClick={() => navigate('/processes')}>Back to Processes</button>
      </div>

      {/* Warning banner when existing value streams exist */}
      {existingCount > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <strong style={{ color: '#92400e' }}>Heads up:</strong>{' '}
          <span style={{ color: '#92400e' }}>
            {existingCount} value stream{existingCount === 1 ? '' : 's'} already exist for this org. Applying this template will <em>add</em> new value streams alongside the existing ones — it will not replace them. If you want a clean slate, delete the existing value streams on the Processes page first.
          </span>
        </div>
      )}

      {/* Active-org context banner. Always visible on the wizard so
          "which org am I about to plant a catalog under" is never
          guessed from the header chrome. */}
      {activeOrgName && (
        <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: blocked ? 12 : 16, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <span style={{ color: 'var(--color-text-secondary)' }}>Generating processes for </span>
            <strong>{activeOrgName}</strong>
            {activeOrgType && (
              <span style={{ marginLeft: 6, padding: '1px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 999, fontSize: 11, color: 'var(--color-text-muted)' }}>
                {prettyType(activeOrgType)}
              </span>
            )}
            {parentName && (
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                in {parentName}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Wrong scope? Change <em>Working in&hellip;</em> in the header.
          </div>
        </div>
      )}

      {/* Top-level-blocking hint: company that has divisions. We
          stop here rather than generating because the alternative —
          one shared catalog at the parent — is almost always not what
          a multi-division company wants and is messy to unwind. */}
      {isCompanyWithDivisions && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ color: '#991b1b', fontWeight: 600, marginBottom: 4 }}>Pick a division first.</div>
          <div style={{ color: '#7f1d1d' }}>
            <strong>{activeOrgName}</strong> has{' '}
            {childDivisions.length === 1
              ? <>a division (<em>{childDivisions[0]}</em>)</>
              : <>{childDivisions.length} divisions ({childDivisions.slice(0, 3).map((n, i) => <em key={n}>{i > 0 ? ', ' : ''}{n}</em>)}{childDivisions.length > 3 ? <span>, &hellip;</span> : null})</>
            }. Value streams almost always live at the division level so each division gets its own process catalog instead of sharing one.
            <br />
            Change <em>Working in&hellip;</em> in the header to a division to continue. Use the company level only if every division genuinely shares the same end-to-end processes.
          </div>
        </div>
      )}

      {/* Wrong-level hint: the active org is below the value-stream
          tier (department, team, …). VALUE_STREAM_LEVELS is the
          single source of truth for which org types can host
          streams. */}
      {wrongLevel && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ color: '#991b1b', fontWeight: 600, marginBottom: 4 }}>This level can't host value streams.</div>
          <div style={{ color: '#7f1d1d' }}>
            <strong>{activeOrgName}</strong> is a {prettyType(activeOrgType)}. Value streams sit at the company or division level so processes don't get pinned to a single team. Pick a parent org from the <em>Working in&hellip;</em> header.
          </div>
        </div>
      )}

      {/* Step 1: Industry + Generate */}
      {!template && !loading && (
        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            {orgIndustry ? 'Generate Process Hierarchy' : 'Select Industry'}
          </h2>

          {orgIndustry ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                The Process Wizard uses AI to generate a complete process hierarchy for <strong>{orgIndustry}</strong>,
                including value streams, processes, and activities tailored to your industry. You will be able to
                review, select, and modify the generated structure before applying it to your catalog.
              </div>
              <div style={{ background: 'var(--color-primary-light)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                  Industry {industrySource === 'inherited' ? '(from parent organization)' : '(from organization)'}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-primary)' }}>{orgIndustry}</div>
                <button onClick={() => { setOrgIndustry(''); setIndustry(''); }} style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4, textDecoration: 'underline' }}>
                  Choose a different industry
                </button>
              </div>
              <button
                style={{ ...btnPrimary, opacity: blocked ? 0.5 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
                disabled={blocked}
                onClick={() => handleGenerate(orgIndustry)}
                title={blocked ? 'Resolve the scope warning above first.' : undefined}
              >
                Generate Processes
              </button>
            </>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
                <option value="">-- Select an industry --</option>
                {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
              </select>
            </div>
          )}

          {error && <p style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          {!orgIndustry && (
            <button
              style={{ ...btnPrimary, opacity: !industry || loading || blocked ? 0.6 : 1, cursor: !industry || loading || blocked ? 'not-allowed' : 'pointer' }}
              disabled={!industry || loading || blocked}
              onClick={() => setConfirmIndustry(industry)}
              title={blocked ? 'Resolve the scope warning above first.' : undefined}
            >
              {loading ? 'Generating\u2026' : 'Generate Processes'}
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ ...card, textAlign: 'center', padding: '3rem', border: '1px solid var(--color-primary)' }}>
          <div style={{ fontSize: 32, marginBottom: 12, animation: 'procelaGenSpin 2s linear infinite' }}>{'\u2699'}</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--color-primary)' }}>Generating process hierarchy...</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            AI is creating value streams, processes, and activities for {industry || orgIndustry}. This usually takes 10{'\u2013'}30 seconds.
          </p>
          <style>{`@keyframes procelaGenSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Step 2: Review & Apply (combined preview + confirm) */}
      {template && !loading && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Review & Apply</h2>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {selectedCount} value streams, {totalProcesses} processes, {totalActivities} activities selected
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...btnSecondary, fontSize: 12, padding: '6px 14px' }} onClick={selectAll}>
                {template.valueStreams.every((vs) => vs.selected) ? 'Deselect All' : 'Select All'}
              </button>
              <button style={{ ...btnSecondary, fontSize: 12, padding: '6px 14px' }} onClick={() => { setTemplate(null); }}>
                Regenerate
              </button>
            </div>
          </div>

          {/* Value Stream List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
            {template.valueStreams.map((vs, vsIdx) => {
              const isExpanded = expandedStreams.has(vsIdx);
              return (
                <div key={vsIdx} style={{
                  border: `1px solid ${vs.selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-md)', overflow: 'hidden',
                  background: vs.selected ? 'var(--color-primary-light)' : 'var(--color-bg)',
                  transition: 'border-color 0.15s, background 0.15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                    onClick={() => toggleStream(vsIdx)}>
                    <input type="checkbox" checked={vs.selected} onChange={(e) => { e.stopPropagation(); toggleStreamSelection(vsIdx); }}
                      onClick={(e) => e.stopPropagation()} style={{ width: 16, height: 16, accentColor: 'var(--color-primary)' }} />
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', userSelect: 'none' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{vs.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{vs.description}</div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {vs.processes.length} processes
                    </span>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '0 14px 12px 44px' }}>
                      {(vs.purpose || vs.businessOutcome) && (
                        <div style={{ fontSize: 11, padding: '6px 10px', background: '#f8fafc', borderRadius: 4, marginBottom: 10 }}>
                          {vs.purpose && <div><span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Purpose:</span> {vs.purpose}</div>}
                          {vs.businessOutcome && <div><span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Business Outcome:</span> {vs.businessOutcome}</div>}
                        </div>
                      )}
                      {vs.processes.map((proc, pIdx) => (
                        <div key={pIdx} style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>{proc.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{proc.description}</div>
                          {proc.purpose && (
                            <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 4, fontStyle: 'italic' }}>
                              Purpose: {proc.purpose}
                            </div>
                          )}
                          {(proc.activities || []).length > 0 && (
                            <div style={{ marginLeft: 16 }}>
                              {proc.activities.map((act, aIdx) => (
                                <div key={aIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
                                  <span style={{ color: '#065f46', fontSize: 9, marginTop: 2 }}>{'\u25B6'}</span>
                                  <div>
                                    <span style={{ fontSize: 11, fontWeight: 500 }}>{act.name}</span>
                                    {act.description && <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 4 }}>— {act.description}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {(proc.subProcesses || []).map((sp: any, spIdx: number) => (
                            <div key={spIdx} style={{ marginLeft: 16, marginBottom: 4 }}>
                              <div style={{ fontWeight: 500, fontSize: 11, color: 'var(--color-text-secondary)' }}>{sp.name}</div>
                              <ul style={{ listStyle: 'disc', paddingLeft: 16, margin: 0 }}>
                                {(sp.steps || sp.activities || []).map((st: any, stIdx: number) => (
                                  <li key={stIdx} style={{ fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{st.name}</li>
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

          {error && <p style={{ color: 'var(--color-error)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          {/* Apply */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button style={btnSecondary} onClick={() => navigate('/processes')}>Cancel</button>
            <button
              style={{ ...btnPrimary, opacity: selectedCount === 0 || applying ? 0.6 : 1, cursor: selectedCount === 0 || applying ? 'not-allowed' : 'pointer', padding: '12px 32px', fontSize: 15 }}
              disabled={selectedCount === 0 || applying}
              onClick={handleApply}
            >
              {applying ? 'Applying...' : `Apply ${selectedCount} Value Stream${selectedCount !== 1 ? 's' : ''} to Catalog`}
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmIndustry}
        title="Generate Process Hierarchy?"
        message={`AI will generate value streams, processes, and activities for the ${confirmIndustry} industry. You'll be able to preview and customize everything before applying. This usually takes 10–30 seconds.`}
        confirmLabel="Generate"
        variant="primary"
        onConfirm={() => { const ind = confirmIndustry; setConfirmIndustry(''); handleGenerate(ind); }}
        onCancel={() => setConfirmIndustry('')}
      />
    </div>
  );
}
