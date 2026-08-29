import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { INDUSTRIES } from '../types';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useAiEnabled } from '../stores/aiConfigStore';
import { useValueStreamScope } from '../hooks/useValueStreamScope';
import { useToastStore } from '../stores/toastStore';
import ConfirmDialog from '../components/ConfirmDialog';
import StatusBadge from '../components/StatusBadge';
import Page from '../components/Page';
import WizardProgress from '../components/WizardProgress';
import { useAuthStore } from '../stores/authStore';
import Button from '../components/Button';
import Card from '../components/Card';

// Empirical guess for a full 5×5×6 hierarchy's serialised JSON
// length. Used to convert the running char count that the backend
// streams into a 0..1 progress bar. Real hierarchies over-run this
// occasionally — the UI clamps at 95% until the `done` event lands
// so an over-run doesn't stall at 100% for the remaining seconds.
const ESTIMATED_TEMPLATE_CHARS = 50000;

// Phased captions that tick along the elapsed time. Pure UI —
// Anthropic's stream doesn't expose which section it's currently
// emitting, so we lean on a rough time-based schedule that matches
// the model's typical generation cadence. Good enough to make the
// wait feel narrated instead of static.
const GENERATION_PHASES: readonly { atFill: number; label: string }[] = [
  { atFill: 0.0, label: 'Analysing industry context…' },
  { atFill: 0.15, label: 'Drafting value streams…' },
  { atFill: 0.4, label: 'Adding processes…' },
  { atFill: 0.7, label: 'Adding activities…' },
  { atFill: 0.9, label: 'Finalising hierarchy…' },
];
function captionForFill(fill: number): string {
  let out = GENERATION_PHASES[0].label;
  for (const p of GENERATION_PHASES) {
    if (fill >= p.atFill) out = p.label;
  }
  return out;
}

// ── Types ──

interface TemplateActivity { name: string; description: string; }
interface TemplateProcess { name: string; description: string; purpose?: string; activities: TemplateActivity[]; subProcesses?: any[]; }
interface TemplateValueStream { name: string; description: string; purpose?: string; businessOutcome?: string; processes: TemplateProcess[]; selected: boolean; }
interface GeneratedTemplate { valueStreams: TemplateValueStream[]; }

// ── Component ──

export default function ValueStreamWizard() {
  const navigate = useNavigate();
  const aiEnabled = useAiEnabled();
  const { activeOrgId, activeOrgName, activeOrgType, setActiveOrg } = useOrgContext();
  // parentName / divisions / blocked all come from the shared scope
  // hook so this surface and the Process Catalog's manual create
  // path can't drift apart.
  const { parentName, divisions: childDivisions, wrongLevel, companyWithDivisions: isCompanyWithDivisions, blocked } = useValueStreamScope();
  const addToast = useToastStore((s) => s.addToast);
  const [industry, setIndustry] = useState('');
  const [orgIndustry, setOrgIndustry] = useState('');
  const [industrySource, setIndustrySource] = useState<'own' | 'inherited' | ''>('');
  // Active org's description — fed to the AI prompt so generated
  // value streams reflect this specific org rather than the generic
  // industry. Empty string when the org has no description.
  const [orgDescription, setOrgDescription] = useState('');
  const [template, setTemplate] = useState<GeneratedTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [expandedStreams, setExpandedStreams] = useState<Set<number>>(new Set());
  const [confirmIndustry, setConfirmIndustry] = useState('');
  const [existingCount, setExistingCount] = useState(0);
  // Running char count from the AI stream. Drives the progress bar
  // during Generate — divided by ESTIMATED_TEMPLATE_CHARS and
  // clamped to 0..0.95 until the `done` event arrives.
  const [progressChars, setProgressChars] = useState(0);

  // Check existing value stream count to warn about duplicates
  useEffect(() => {
    const qp = activeOrgId ? `?orgId=${activeOrgId}` : '';
    apiClient.get<{ success: boolean; stats?: { byLevel?: Record<string, number> } }>(`/process-catalog${qp}`)
      .then((res) => { setExistingCount(res.stats?.byLevel?.VALUE_STREAM || 0); })
      .catch(() => { /* */ });
  }, [activeOrgId]);

  // Fetch the org's industry (and fall back to the parent's industry
  // if the active org has none of its own). Parent name and child
  // divisions for the scope banner live in useValueStreamScope so
  // this effect only deals with industry.
  useEffect(() => {
    if (!activeOrgId) return;
    async function loadOrgIndustry() {
      try {
        const res = await apiClient.get<{ success: boolean; data: { industry?: string; description?: string; parentId?: string | null } }>(`/organizations/${activeOrgId}`);
        const org = res.data;
        if (org?.description) setOrgDescription(org.description);
        if (org?.industry) {
          setOrgIndustry(org.industry);
          setIndustry(org.industry);
          setIndustrySource('own');
          return;
        }
        // Walk up the entire parent chain, not just one hop. A
        // Department scoped inside a Division inside a Company
        // should still resolve the Company's industry — one-hop
        // lookup missed that case. Guarded on a depth cap so a
        // corrupt cycle in the parent chain can't spin forever.
        let currentParent = org?.parentId || null;
        for (let depth = 0; currentParent && depth < 10; depth++) {
          try {
            const p = await apiClient.get<{ success: boolean; data: { industry?: string; parentId?: string | null } }>(`/organizations/${currentParent}`);
            if (p.data?.industry) {
              setOrgIndustry(p.data.industry);
              setIndustry(p.data.industry);
              setIndustrySource('inherited');
              return;
            }
            currentParent = p.data?.parentId || null;
          } catch { break; }
        }
      } catch { /* */ }
    }
    loadOrgIndustry();
  }, [activeOrgId]);

  // Where the current template came from — set after a successful
  // generate call. `cached: true` means the backend served the
  // stored version (instant); `cached: false` means it called
  // Claude and stashed a fresh copy. `specializedFor` carries the
  // org name the template was tailored to, so a Tidewater Electric
  // run shows "Cached · specialised for Tidewater Electric" and
  // users know they got electric-utility content, not generic
  // utilities. Drives the small badge on the review screen plus
  // the "Regenerate from AI" button.
  const [templateSource, setTemplateSource] = useState<{ cached: boolean; generatedAt: string; specializedFor?: string } | null>(null);

  // Stream the hierarchy from Anthropic via our SSE endpoint. This
  // replaced the fire-and-wait POST call so we can (a) drive a real
  // progress bar off the running char count instead of a mystery
  // spinner and (b) let the backend bump max_tokens above the
  // non-streaming ceiling for wider hierarchies. `refresh: true`
  // bypasses the cache on the server, used by "Regenerate from AI"
  // on the review screen. Active-org name/description/type ride
  // along so the prompt can specialise (Tidewater Electric ->
  // SCADA / outage management, not generic Utilities content).
  const handleGenerate = useCallback(async (ind: string, refresh: boolean = false) => {
    if (!ind || loading) return;
    setLoading(true);
    setError('');
    setTemplate(null);
    setTemplateSource(null);
    setProgressChars(0);
    try {
      const body: Record<string, unknown> = { industry: ind, refresh };
      if (activeOrgName) body.orgName = activeOrgName;
      if (orgDescription) body.orgDescription = orgDescription;
      if (activeOrgType) body.orgType = activeOrgType;

      const token = useAuthStore.getState().accessToken;
      const res = await fetch('/api/v1/ai/generate-template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        // Errors that fire BEFORE the SSE handshake (auth, 400, 5xx
        // from a middleware) still come back as JSON. Try to read a
        // structured message; fall back to the status text.
        let msg = `Request failed (${res.status})`;
        try {
          const errBody = await res.json();
          if (errBody?.error) msg = errBody.error;
        } catch { /* not JSON — leave the status text */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Same SSE-frame parser as ChatPanel. Frames are separated by
      // a blank line; a single read can split mid-frame.
      let done: {
        data: { valueStreams: Omit<TemplateValueStream, 'selected'>[] };
        cached?: boolean;
        generatedAt?: string;
        specializedFor?: string;
      } | null = null;
      let streamErr: string | null = null;
      outer: while (true) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += decoder.decode(value, { stream: true });
        let sep = buf.indexOf('\n\n');
        while (sep !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) dataStr += line.slice(6);
          }
          if (dataStr) {
            let parsed: {
              type?: string; chars?: number; error?: string;
              data?: { valueStreams: Omit<TemplateValueStream, 'selected'>[] };
              cached?: boolean; generatedAt?: string; specializedFor?: string;
            };
            try { parsed = JSON.parse(dataStr); } catch { parsed = {}; }
            if (parsed.type === 'progress' && typeof parsed.chars === 'number') {
              setProgressChars(parsed.chars);
            } else if (parsed.type === 'done' && parsed.data) {
              done = { data: parsed.data, cached: parsed.cached, generatedAt: parsed.generatedAt, specializedFor: parsed.specializedFor };
              break outer;
            } else if (parsed.type === 'error') {
              streamErr = parsed.error || 'stream error';
              break outer;
            }
          }
          sep = buf.indexOf('\n\n');
        }
      }
      if (streamErr) throw new Error(streamErr);
      if (!done) throw new Error('AI stream ended without a template.');

      setTemplate({ valueStreams: done.data.valueStreams.map((vs) => ({ ...vs, selected: true })) });
      setExpandedStreams(new Set([0]));
      setTemplateSource({
        cached: !!done.cached,
        generatedAt: done.generatedAt || new Date().toISOString(),
        specializedFor: done.specializedFor,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate. Is the API key configured?');
    } finally {
      setLoading(false);
    }
  }, [loading, activeOrgName, orgDescription, activeOrgType]);

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

  const prettyType = (t: string) => t ? t.charAt(0).toUpperCase() + t.slice(1) : '';

  // The Process Wizard is an AI-only flow (it generates the hierarchy with
  // Claude). When AI integration features are turned off, there's nothing to
  // run here — point the user at the manual path instead of a dead form.
  if (!aiEnabled) {
    return (
      <Page>
        <PageHeader title="Process Wizard" subtitle="Generate a process hierarchy" />
        <Card padding={24}>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            The Process Wizard uses AI to generate a starting hierarchy, and AI
            features are turned off for this deployment. You can build your value
            streams, processes, and activities directly in the Process Catalog.
          </p>
          <Button variant="primary" onClick={() => navigate('/processes')}>
            Go to Process Catalog
          </Button>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      {/* Header */}
      <PageHeader
        title={activeOrgName ? `Process Wizard — ${activeOrgName}` : 'Process Wizard'}
        subtitle="AI generates a complete process hierarchy (Value Streams → Processes → Activities) based on your industry."
        actions={<Button variant="secondary" onClick={() => navigate('/processes')}>Back to Processes</Button>}
      />

      {/* Step bar. The Generate step's active fill is driven by the
          same char count that feeds the big progress bar below when
          loading — that way the two indicators can't disagree. */}
      <WizardProgress
        steps={['Industry', 'Generate', 'Review', 'Apply']}
        current={applying ? 3 : template ? 2 : loading ? 1 : 0}
        activeFill={loading ? Math.min(0.95, progressChars / ESTIMATED_TEMPLATE_CHARS) : undefined}
      />

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
          a multi-division company wants and is messy to unwind.
          Division names render as one-click chips that switch the
          active org without forcing the user back to the header
          dropdown. */}
      {isCompanyWithDivisions && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ color: '#991b1b', fontWeight: 600, marginBottom: 4 }}>Pick a division first.</div>
          <div style={{ color: '#7f1d1d' }}>
            <strong>{activeOrgName}</strong> has {childDivisions.length === 1 ? 'a division' : `${childDivisions.length} divisions`}. Value streams almost always live at the division level so each division gets its own process catalog instead of sharing one.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <span style={{ color: '#7f1d1d', fontSize: 12, alignSelf: 'center', marginRight: 2 }}>Switch to:</span>
            {childDivisions.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setActiveOrg(d.id, d.name, 'division')}
                style={{
                  padding: '4px 10px', fontSize: 12, fontWeight: 500,
                  background: '#fff', color: '#991b1b',
                  border: '1px solid #fca5a5', borderRadius: 999, cursor: 'pointer',
                }}
              >
                {d.name}
              </button>
            ))}
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
        <Card radius="lg" padding={24}>
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
              <Button
                variant="primary"
                disabled={blocked}
                onClick={() => handleGenerate(orgIndustry)}
                title={blocked ? 'Resolve the scope warning above first.' : undefined}
              >
                Generate Processes
              </Button>
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
            <Button
              variant="primary"
              disabled={!industry || loading || blocked}
              onClick={() => setConfirmIndustry(industry)}
              title={blocked ? 'Resolve the scope warning above first.' : undefined}
            >
              {loading ? 'Generating\u2026' : 'Generate Processes'}
            </Button>
          )}
        </Card>
      )}

      {/* Loading \u2014 real progress bar driven by chars streamed from
          Anthropic. Divides the running char count by an empirical
          "full hierarchy" estimate; clamps at 95% until the `done`
          event lands so an overshoot doesn't stall at 100%. Cache
          hits skip this state entirely (they land straight in the
          review screen). */}
      {loading && (() => {
        const rawFill = progressChars / ESTIMATED_TEMPLATE_CHARS;
        const displayFill = Math.min(0.95, rawFill);
        const pct = Math.round(displayFill * 100);
        return (
          <Card radius="lg" borderColor="var(--color-primary)" style={{ textAlign: 'center', padding: '2.5rem 2rem' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, color: 'var(--color-primary)' }}>
              Generating process hierarchy
            </h2>
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              <div style={{
                height: 8, borderRadius: 4, background: 'var(--color-border)',
                overflow: 'hidden', marginBottom: 10,
              }}>
                <div
                  style={{
                    width: `${pct}%`, height: '100%',
                    background: 'var(--color-primary)',
                    transition: 'width 0.15s ease-out',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                <span>{captionForFill(displayFill)}</span>
                <span>{pct}%</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                AI is creating value streams, processes, and activities for {industry || orgIndustry}.
              </p>
            </div>
          </Card>
        );
      })()}

      {/* Step 2: Review & Apply (combined preview + confirm) */}
      {template && !loading && (
        <Card radius="lg" padding={24}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                Review & Apply
                {templateSource && (
                  <span
                    title={templateSource.cached
                      ? `Loaded from the template cache (generated ${new Date(templateSource.generatedAt).toLocaleDateString()}). Use "Regenerate from AI" to ask Claude for a fresh version.`
                      : `Generated fresh by Claude at ${new Date(templateSource.generatedAt).toLocaleString()}. Subsequent runs for the same scope will return this cached output unless you regenerate.`}
                    style={{
                      padding: '1px 8px', borderRadius: 999,
                      fontSize: 10, fontWeight: 600,
                      background: templateSource.cached ? '#dbeafe' : '#fef3c7',
                      color: templateSource.cached ? '#1e40af' : '#92400e',
                      border: `1px solid ${templateSource.cached ? '#93c5fd' : '#fcd34d'}`,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}
                  >
                    {templateSource.cached ? 'Cached' : 'Fresh from AI'}
                  </span>
                )}
                {templateSource?.specializedFor && (
                  <StatusBadge
                    variant="agent"
                    outlined
                    title={`The AI prompt was specialised for ${templateSource.specializedFor} (not just generic ${orgIndustry || industry}). Output reflects this org's specific operations.`}
                  >
                    Specialised: {templateSource.specializedFor}
                  </StatusBadge>
                )}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {selectedCount} value streams, {totalProcesses} processes, {totalActivities} activities selected
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={selectAll}>
                {template.valueStreams.every((vs) => vs.selected) ? 'Deselect All' : 'Select All'}
              </Button>
              {/* "Regenerate" keeps the cached path — clears the
                  template locally so the next call hits the cache
                  again (same input, same output). "Regenerate from
                  AI" forces a fresh Claude call and replaces the
                  cached entry server-side. Two buttons because the
                  cost / latency difference matters. */}
              <Button variant="secondary" size="sm" onClick={() => { setTemplate(null); setTemplateSource(null); }}>
                Regenerate
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleGenerate(orgIndustry || industry, true)}
                title="Bypass the cache and ask Claude for a fresh template. Replaces the stored version for this industry."
              >
                Regenerate from AI
              </Button>
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
                      {/* Purpose absorbed the former Business Outcome —
                          show them folded into one Purpose line so older
                          cached templates that still carry both don't lose
                          the outcome text. */}
                      {(vs.purpose || vs.businessOutcome) && (
                        <div style={{ fontSize: 11, padding: '6px 10px', background: '#f8fafc', borderRadius: 4, marginBottom: 10 }}>
                          <div><span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Purpose:</span> {[vs.purpose, vs.businessOutcome].map((s) => (s || '').trim()).filter(Boolean).join(' — ')}</div>
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
            <Button variant="secondary" onClick={() => navigate('/processes')}>Cancel</Button>
            <Button
              variant="primary"
              style={{ padding: '12px 32px', fontSize: 15 }}
              disabled={selectedCount === 0 || applying}
              onClick={handleApply}
            >
              {applying ? 'Applying...' : `Apply ${selectedCount} Value Stream${selectedCount !== 1 ? 's' : ''} to Catalog`}
            </Button>
          </div>
        </Card>
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
    </Page>
  );
}
