import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { usePermissions } from '../hooks/usePermissions';
import { useRefreshOnFocus } from '../hooks/usePolling';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceFoundationPage — "Governance → Foundation".
//
// The program's foundation artifacts (scope, guiding principles, operating
// model, target dates) are authored on this page. The program's phase tracker
// and governed lifecycle live on the Get Started hub (/setup) — there is no
// separate Governance Program page — and its Govern-stage "Governance
// foundation" item deep-links here. Same `PUT /governance-program/:id` API —
// no data change — so it stays in sync with the phase status.
// ──────────────────────────────────────────────────────────────────────────

interface Program {
  id: string;
  scope: { inScope: string; outOfScope: string; boundaries: string; constraints: string };
  principles: { vision: string; principles: string[]; decisionRights: string; operatingModel: 'CENTRALIZED' | 'FEDERATED' | 'HYBRID' | '' };
  status: 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  launchedAt?: string | null;
}

interface IncompletePhase { phase: number; name: string; missing: string[] }

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, fontFamily: 'inherit', resize: 'vertical' };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

export default function GovernanceFoundationPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();

  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'scope' | 'principles'>('scope');
  // Launch flow (mirrors the governed transition on Get Started, scoped to
  // launching from PLANNING — later lifecycle changes live on Get Started).
  const [launching, setLaunching] = useState(false);
  const [earlyLaunchInfo, setEarlyLaunchInfo] = useState<IncompletePhase[] | null>(null);
  const [launchReason, setLaunchReason] = useState('');

  // Foundation (Phase 1) is complete when the *saved* program has scope,
  // at least one principle, and an operating model — the same three checks the
  // backend uses. Computed off the saved program so it matches what the server
  // will accept (unsaved edits don't count until saved).
  const foundationComplete = !!(
    program
    && (program.scope?.inScope || '').trim().length > 0
    && (program.principles?.principles || []).length > 0
    && (program.principles?.operatingModel || '') !== ''
  );

  const launchProgram = async (opts: { force?: boolean; reason?: string } = {}) => {
    if (!program) return;
    setLaunching(true);
    try {
      await apiClient.put(`/governance-program/${program.id}`, {
        status: 'ACTIVE',
        ...(opts.force ? { force: true } : {}),
        ...(opts.reason ? { reason: opts.reason } : {}),
      });
      addToast('success', 'Program launched.');
      setEarlyLaunchInfo(null);
      setLaunchReason('');
      fetchProgram();
    } catch (e: any) {
      const body = (e && typeof e === 'object' && 'body' in e ? e.body : null) || {};
      if (body?.requiresConfirmation && Array.isArray(body.incompletePhases)) {
        setEarlyLaunchInfo(body.incompletePhases);
      } else if (body?.blockingPhase) {
        addToast('error', `${body.error} Missing: ${(body.missing || []).join(', ')}`);
      } else {
        addToast('error', body?.error || errorMessage(e, 'Launch failed'));
      }
    } finally {
      setLaunching(false);
    }
  };

  const [inScope, setInScope] = useState('');
  const [outOfScope, setOutOfScope] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [vision, setVision] = useState('');
  const [principles, setPrinciples] = useState<string[]>([]);
  const [newPrinciple, setNewPrinciple] = useState('');
  const [decisionRights, setDecisionRights] = useState('');
  const [operatingModel, setOperatingModel] = useState<Program['principles']['operatingModel']>('');

  const hydrate = (p: Program) => {
    setInScope(p.scope?.inScope || '');
    setOutOfScope(p.scope?.outOfScope || '');
    // Boundaries absorbed the former separate Constraints field — fold any
    // existing constraints text in on load so nothing is lost.
    setBoundaries([p.scope?.boundaries, p.scope?.constraints].map((s) => (s || '').trim()).filter(Boolean).join('\n\n'));
    setVision(p.principles?.vision || '');
    setPrinciples(Array.isArray(p.principles?.principles) ? p.principles.principles : []);
    setDecisionRights(p.principles?.decisionRights || '');
    setOperatingModel(p.principles?.operatingModel || '');
  };

  const fetchProgram = useCallback(async () => {
    setLoading(true);
    try {
      const query = activeOrgId ? `?orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: Program }>(`/governance-program${query}`);
      setProgram(res.data);
      if (res.data) hydrate(res.data);
    } catch { /* API may not be running */ }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { fetchProgram(); }, [fetchProgram]);
  useRefreshOnFocus(fetchProgram);

  const handleSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!program) return;
    setSaving(true);
    try {
      const payload = {
        // constraints merged into boundaries; write it empty so the two
        // can't drift back apart.
        scope: { inScope, outOfScope, boundaries, constraints: '' },
        principles: { vision, principles, decisionRights, operatingModel },
      };
      const res = await apiClient.put<{ success: boolean; data: Program }>(`/governance-program/${program.id}`, payload);
      if (res.data) { setProgram(res.data); hydrate(res.data); }
      addToast('success', 'Foundation saved');
    } catch (err) {
      addToast('error', errorMessage(err, 'Failed to save foundation'));
    } finally {
      setSaving(false);
    }
  };

  const savePrinciples = (updated: string[], toast: string) => {
    setPrinciples(updated);
    if (!program) return;
    apiClient.put(`/governance-program/${program.id}`, {
      principles: { vision, principles: updated, decisionRights, operatingModel },
    }).then(() => addToast('success', toast)).catch(() => addToast('error', 'Failed to update principles'));
  };
  const addPrinciple = () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    const trimmed = newPrinciple.trim();
    if (!trimmed) return;
    savePrinciples([...principles, trimmed], 'Principle added');
    setNewPrinciple('');
  };
  const removePrinciple = (index: number) => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    savePrinciples(principles.filter((_, i) => i !== index), 'Principle removed');
  };

  return (
    <div>
      <PageHeader
        title="Foundation"
        subtitle="Define your governance program's scope, guiding principles, and operating model — the Phase 1 groundwork the rest of the program builds on."
      >
        <Link to="/setup" style={{ fontSize: 13, color: 'var(--color-primary)', fontWeight: 500 }}>&larr; Set up Procela</Link>
      </PageHeader>

      {loading && <Card padding={24} shadow="none"><Spinner center label="Loading…" /></Card>}

      {!loading && !program && (
        <Card padding={24} shadow="none" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No governance program found for this organization.
        </Card>
      )}

      {!loading && program && (
        <Card padding={24}>
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
            {(['scope', 'principles'] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)} style={{
                padding: '8px 16px', fontSize: 13,
                fontWeight: activeTab === t ? 600 : 500,
                background: 'transparent', border: 'none',
                borderBottom: activeTab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
                color: activeTab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                marginBottom: -1, cursor: 'pointer', textTransform: 'capitalize',
              }}>{t}</button>
            ))}
          </div>

          {activeTab === 'scope' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>In Scope</label><textarea aria-label="In Scope" style={textareaStyle} value={inScope} onChange={(e) => setInScope(e.target.value)} placeholder="What data, systems, and processes are governed by this program?" /></div>
              <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Out of Scope</label><textarea aria-label="Out of Scope" style={textareaStyle} value={outOfScope} onChange={(e) => setOutOfScope(e.target.value)} placeholder="What is explicitly excluded from this program?" /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Boundaries &amp; Constraints</label><textarea aria-label="Boundaries & Constraints" style={textareaStyle} value={boundaries} onChange={(e) => setBoundaries(e.target.value)} placeholder="Organizational / geographic / functional boundaries, plus budget, timeline, regulatory or resource constraints to respect" /></div>
            </div>
          )}

          {activeTab === 'principles' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Vision</label><textarea aria-label="Vision" style={textareaStyle} value={vision} onChange={(e) => setVision(e.target.value)} placeholder="What does success look like for your data governance program?" /></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Guiding Principles</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {principles.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No principles defined yet.</div>}
                  {principles.map((p, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', minWidth: 20 }}>{idx + 1}.</span>
                      <span style={{ flex: 1, fontSize: 13 }}>{p}</span>
                      <button type="button" onClick={() => removePrinciple(idx)} aria-label={`Remove principle ${p}`} title="Remove principle" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-muted)', padding: 2 }}><span aria-hidden="true">&times;</span></button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input aria-label="Guiding Principles" style={inputStyle} value={newPrinciple} onChange={(e) => setNewPrinciple(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPrinciple(); } }} placeholder="e.g. Data is a shared asset; treat it like one" />
                  <Button variant="secondary" onClick={addPrinciple}>Add</Button>
                </div>
              </div>
              {/* Decision Rights is a structured entity of its own — the free-text
                  box here duplicated it. Point at the dedicated page instead;
                  any stored text is retained. */}
              <div><label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Decision Rights</label><div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Defined on the <Link to="/decision-rights" style={{ color: 'var(--color-primary)', fontWeight: 500 }}>Decision Rights</Link> page — who decides / recommends / approves for each decision.</div></div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Operating Model</label>
                <select aria-label="Operating Model" style={selectStyle} value={operatingModel} onChange={(e) => setOperatingModel(e.target.value as Program['principles']['operatingModel'])}>
                  <option value="">-- Select --</option><option value="CENTRALIZED">Centralized</option><option value="FEDERATED">Federated</option><option value="HYBRID">Hybrid</option>
                </select>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>Centralized = one central team. Federated = domains self-govern. Hybrid = shared.</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
            <Button variant="secondary" onClick={() => navigate('/setup')}>Back to Setup</Button>
            <Button variant="primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        </Card>
      )}

      {/* Launch — Foundation is the prerequisite, so you can launch right here
          once it's complete. Later lifecycle changes live on Get Started. */}
      {program && program.status === 'PLANNING' && (
        <div style={{ marginTop: 16 }}>
          <Card padding={20}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>Launch the governance program</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  Foundation is the prerequisite. Structure, roles, and policies can follow — launching with those still incomplete asks you to confirm an early launch, recorded in the audit log.
                </div>
              </div>
              <Button
                variant="primary"
                disabled={!isAdmin || launching || !foundationComplete}
                title={!isAdmin ? 'Only an admin / program owner can launch the program'
                  : !foundationComplete ? 'Complete the Foundation — scope, at least one guiding principle, and an operating model — and save, before launching.'
                  : undefined}
                onClick={() => launchProgram()}
              >{launching ? 'Launching…' : 'Launch program'}</Button>
            </div>
          </Card>
        </div>
      )}

      {program && program.status !== 'PLANNING' && (
        <div style={{ marginTop: 16 }}>
          <Card padding={16}>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Program is <strong style={{ color: 'var(--color-text)' }}>{program.status.charAt(0) + program.status.slice(1).toLowerCase()}</strong>
              {program.launchedAt && <> · launched {new Date(program.launchedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</>}
              . Manage the lifecycle on <Link to="/setup" style={{ color: 'var(--color-primary)', fontWeight: 500 }}>Set up Procela</Link>.
            </div>
          </Card>
        </div>
      )}

      {/* Early-launch confirmation — phases 2–4 incomplete; the backend returned
          the gaps, an admin confirms to force it (recorded in the audit log). */}
      <ConfirmDialog
        open={!!earlyLaunchInfo}
        title="Launch with incomplete phases?"
        message="Foundation is in place, but the program isn't fully set up. Launching now marks it active in the scorecard and dashboards with these gaps:"
        confirmLabel="Launch anyway"
        variant="danger"
        onConfirm={() => launchProgram({ force: true, reason: launchReason })}
        onCancel={() => { setEarlyLaunchInfo(null); setLaunchReason(''); }}
      >
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          {(earlyLaunchInfo || []).map((p) => (
            <div key={p.phase} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Phase {p.phase} — {p.name}</div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {p.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ))}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 8, marginBottom: 4 }}>Reason (recorded in the audit log)</label>
          <input
            aria-label="Reason (recorded in the audit log)"
            value={launchReason}
            onChange={(e) => setLaunchReason(e.target.value)}
            placeholder="e.g. running a 30-day pilot ahead of full rollout"
            style={{ ...inputStyle, fontSize: 12 }}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
