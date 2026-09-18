import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import ConfirmDialog from '../components/ConfirmDialog';
import ScorecardTargetsPanel from '../components/ScorecardTargetsPanel';
import StatusBadge, { type StatusBadgeVariant } from '../components/StatusBadge';
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
  scope: {
    inScope: string; outOfScope: string; boundaries: string; constraints: string;
    systemIds?: string[]; domainIds?: string[]; valueStreamIds?: string[];
  };
  principles: { vision: string; principles: string[]; decisionRights: string; operatingModel: 'CENTRALIZED' | 'FEDERATED' | 'HYBRID' | '' };
  status: 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  launchedAt?: string | null;
}

interface CatalogItem { id: string; name: string }

interface IncompletePhase { phase: number; name: string; missing: string[] }

interface Ratio { covered: number; total: number; pct: number }
interface ScopeCoverageData {
  applied: boolean;
  entities: { systems: number; dataDomains: number; valueStreamNodes: number; dataAssets: number } | null;
  coverage: { assets: number; mapped: Ratio; governed: Ratio; owned: Ratio } | null;
  // Catalogued entities outside the resolved scope — the "connected, not
  // governed" backlog.
  backlog: { systems: number; dataDomains: number; dataAssets: number; valueStreams: number } | null;
}

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, fontFamily: 'inherit', resize: 'vertical' };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

// Program status → header pill styling/label. Drives the single status pill
// that replaced the per-tab launch banner.
const STATUS_META: Record<Program['status'], { label: string; variant: StatusBadgeVariant }> = {
  PLANNING: { label: 'Planning', variant: 'warning' },
  ACTIVE: { label: 'Active', variant: 'success' },
  PAUSED: { label: 'Paused', variant: 'warning' },
  COMPLETED: { label: 'Completed', variant: 'info' },
};

// ScopeSelector — one catalog's in-scope picker: a coverage read-out, the
// selected entities as removable chips, and an "add" dropdown of what's left.
// Turns the free-text scope into references the rest of the platform can read.
function ScopeSelector({ label, items, selectedIds, onChange }: {
  label: string; items: CatalogItem[]; selectedIds: string[]; onChange: (ids: string[]) => void;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  // Only ids that still resolve to a catalog item (an entity deleted after
  // being scoped is dropped rather than shown as "Unknown").
  const selected = selectedIds.filter((id) => byId.has(id));
  const available = items.filter((i) => !selectedIds.includes(i.id)).sort((a, b) => a.name.localeCompare(b.name));
  const add = (id: string) => { if (id && !selectedIds.includes(id)) onChange([...selectedIds, id]); };
  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 500 }}>{label}</label>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {items.length === 0 ? 'none in catalog' : `${selected.length} of ${items.length} in scope`}
        </span>
      </div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selected.map((id) => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 6px 3px 10px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', borderRadius: 999 }}>
              {byId.get(id)!.name}
              <button type="button" onClick={() => remove(id)} aria-label={`Remove ${byId.get(id)!.name}`} title="Remove from scope" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0 }}><span aria-hidden="true">&times;</span></button>
            </span>
          ))}
        </div>
      )}
      <select
        aria-label={`Add ${label} to scope`}
        style={{ ...selectStyle, color: available.length === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}
        value=""
        disabled={available.length === 0}
        onChange={(e) => { add(e.target.value); e.target.value = ''; }}
      >
        <option value="" disabled>
          {items.length === 0 ? `No ${label.toLowerCase()} catalogued yet` : available.length === 0 ? `All ${label.toLowerCase()} in scope` : `Add ${label.toLowerCase().replace(/s$/, '')}…`}
        </option>
        {available.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </div>
  );
}

export default function GovernanceFoundationPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();

  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'scope' | 'principles' | 'targets'>('scope');
  // Launch flow (mirrors the governed transition on Get Started, scoped to
  // launching from PLANNING — later lifecycle changes live on Get Started).
  const [launching, setLaunching] = useState(false);
  const [earlyLaunchInfo, setEarlyLaunchInfo] = useState<IncompletePhase[] | null>(null);
  const [launchReason, setLaunchReason] = useState('');

  // Foundation (Phase 1) is complete when the *saved* program has scope,
  // at least one principle, and an operating model — the same three checks the
  // backend uses. Computed off the saved program so it matches what the server
  // will accept (unsaved edits don't count until saved). "Scope defined" now
  // means at least one governed entity is selected (legacy free-text still
  // counts for programs authored before the structured picker).
  const foundationComplete = !!(
    program
    && (
      (program.scope?.systemIds?.length || 0) > 0
      || (program.scope?.domainIds?.length || 0) > 0
      || (program.scope?.valueStreamIds?.length || 0) > 0
      || (program.scope?.inScope || '').trim().length > 0
    )
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
  // Structured scope — the catalog entities the program governs, by id, plus
  // the catalogs to resolve them to names / drive the coverage read-out.
  const [systemIds, setSystemIds] = useState<string[]>([]);
  const [domainIds, setDomainIds] = useState<string[]>([]);
  const [valueStreamIds, setValueStreamIds] = useState<string[]>([]);
  const [systems, setSystems] = useState<CatalogItem[]>([]);
  const [domains, setDomains] = useState<CatalogItem[]>([]);
  const [valueStreams, setValueStreams] = useState<CatalogItem[]>([]);
  // How governed the *saved* scope is — a live read-out under Governed entities.
  const [scopeCov, setScopeCov] = useState<ScopeCoverageData | null>(null);

  const hydrate = (p: Program) => {
    setInScope(p.scope?.inScope || '');
    setOutOfScope(p.scope?.outOfScope || '');
    // Boundaries absorbed the former separate Constraints field — fold any
    // existing constraints text in on load so nothing is lost.
    setBoundaries([p.scope?.boundaries, p.scope?.constraints].map((s) => (s || '').trim()).filter(Boolean).join('\n\n'));
    setSystemIds(Array.isArray(p.scope?.systemIds) ? p.scope!.systemIds! : []);
    setDomainIds(Array.isArray(p.scope?.domainIds) ? p.scope!.domainIds! : []);
    setValueStreamIds(Array.isArray(p.scope?.valueStreamIds) ? p.scope!.valueStreamIds! : []);
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

  // Load the catalogs that the structured scope selects from. Independent of
  // the program fetch and best-effort: a failing list just yields an empty
  // picker, never blocks the page. Value streams come back as a nested tree;
  // only the top-level id + name are needed here.
  const fetchCatalogs = useCallback(async () => {
    const [sysRes, domRes, vsRes] = await Promise.allSettled([
      apiClient.get<{ data: CatalogItem[] }>('/systems'),
      apiClient.get<{ data: CatalogItem[] }>('/data-domains'),
      apiClient.get<{ data: CatalogItem[] }>('/value-streams'),
    ]);
    if (sysRes.status === 'fulfilled') setSystems((sysRes.value.data || []).map((s) => ({ id: s.id, name: s.name })));
    if (domRes.status === 'fulfilled') setDomains((domRes.value.data || []).map((d) => ({ id: d.id, name: d.name })));
    if (vsRes.status === 'fulfilled') setValueStreams((vsRes.value.data || []).map((v) => ({ id: v.id, name: v.name })));
  }, []);
  useEffect(() => { fetchCatalogs(); }, [fetchCatalogs, activeOrgId]);

  // Scope coverage — governed/mapped/owned share of the assets the *saved*
  // scope reaches. Re-fetched on org change and after each save (scope edits
  // move it). Best-effort: a failure just hides the read-out.
  const fetchScopeCoverage = useCallback(async () => {
    if (!activeOrgId) { setScopeCov(null); return; }
    try {
      const res = await apiClient.get<{ data: ScopeCoverageData }>(`/governance-program/scope-coverage?orgId=${activeOrgId}`);
      setScopeCov(res.data || null);
    } catch { setScopeCov(null); }
  }, [activeOrgId]);
  useEffect(() => { fetchScopeCoverage(); }, [fetchScopeCoverage]);

  const handleSave = async () => {
    if (!activeOrgId) { addToast('error', 'Select an organization from the header first.'); return; }
    if (!program) return;
    setSaving(true);
    try {
      const payload = {
        // constraints merged into boundaries; write it empty so the two
        // can't drift back apart.
        scope: { inScope, outOfScope, boundaries, constraints: '', systemIds, domainIds, valueStreamIds },
        principles: { vision, principles, decisionRights, operatingModel },
      };
      const res = await apiClient.put<{ success: boolean; data: Program }>(`/governance-program/${program.id}`, payload);
      if (res.data) { setProgram(res.data); hydrate(res.data); }
      fetchScopeCoverage();  // scope edits move the read-out
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
        actions={program ? (
          <>
            <StatusBadge
              variant={STATUS_META[program.status].variant}
              size="md"
              title={program.launchedAt && program.status !== 'PLANNING'
                ? `Launched ${new Date(program.launchedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                : undefined}
            >{STATUS_META[program.status].label}</StatusBadge>
            {program.status === 'PLANNING' ? (
              <Button
                variant="primary"
                disabled={!isAdmin || launching || !foundationComplete}
                title={!isAdmin ? 'Only an admin / program owner can launch the program'
                  : !foundationComplete ? 'Complete the Foundation — scope (at least one governed entity), one guiding principle, and an operating model — and save, before launching.'
                  : 'Foundation is the prerequisite. Structure, roles, and policies can follow — launching with those still incomplete asks you to confirm, recorded in the audit log.'}
                onClick={() => launchProgram()}
              >{launching ? 'Launching…' : 'Launch program'}</Button>
            ) : (
              <Link to="/setup" style={{ fontSize: 13, color: 'var(--color-primary)', fontWeight: 500 }}>Manage lifecycle &rarr;</Link>
            )}
          </>
        ) : (
          <Link to="/setup" style={{ fontSize: 13, color: 'var(--color-primary)', fontWeight: 500 }}>&larr; Set up Procela</Link>
        )}
      />
      {program && program.status === 'PLANNING' && !foundationComplete && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -6, marginBottom: 12, lineHeight: 1.4 }}>
          Complete the Foundation below — pick at least one governed entity, add a guiding principle, and select an operating model — then save to enable launch.
        </div>
      )}

      {loading && <Card padding={24} shadow="none"><Spinner center label="Loading…" /></Card>}

      {!loading && !program && (
        <Card padding={24} shadow="none" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No governance program found for this organization.
        </Card>
      )}

      {!loading && program && (
        <Card padding={24}>
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
            {(['scope', 'principles', 'targets'] as const).map((t) => (
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
              {/* Structured scope — pick the catalogued entities this program
                  governs. This IS the program's scope: selecting the systems,
                  data domains, and value streams here is what marks Phase 1's
                  "Scope defined" complete (the old free-text In / Out of Scope
                  boxes duplicated this and were removed). */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Governed entities</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                  Select the systems, data domains, and value streams this program governs, straight from your catalog. This defines what's in scope.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  <ScopeSelector label="Systems" items={systems} selectedIds={systemIds} onChange={setSystemIds} />
                  <ScopeSelector label="Data Domains" items={domains} selectedIds={domainIds} onChange={setDomainIds} />
                  <ScopeSelector label="Value Streams" items={valueStreams} selectedIds={valueStreamIds} onChange={setValueStreamIds} />
                </div>

                {/* Scope coverage — how governed the assets this scope reaches
                    actually are. Reflects the *saved* scope, so it updates after
                    Save. Hidden until scope is defined (no anchors ⇒ nothing to
                    measure). */}
                {scopeCov?.applied && scopeCov.coverage && scopeCov.entities && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--color-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Scope coverage</div>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {scopeCov.entities.dataAssets} assets · {scopeCov.entities.dataDomains} domains · {scopeCov.entities.systems} systems in scope
                      </span>
                    </div>
                    {scopeCov.coverage.assets === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        No data assets in scope yet — coverage appears once your scoped domains or systems hold assets.
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
                        {[
                          { label: 'Mapped', r: scopeCov.coverage.mapped },
                          { label: 'Governed', r: scopeCov.coverage.governed },
                          { label: 'Owned', r: scopeCov.coverage.owned },
                        ].map(({ label, r }) => (
                          <div key={label}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                              <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{label}</span>
                              <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{r.covered}/{r.total} · {r.pct}%</span>
                            </div>
                            <div style={{ height: 5, borderRadius: 999, background: 'var(--color-bg)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${r.pct}%`, background: 'var(--color-primary)' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.4 }}>
                      Share of the assets your scope reaches that are linked to a process, governed to a managed tier, and have an owner. <Link to="/gap-detection" style={{ color: 'var(--color-primary)' }}>See in-scope gaps &rarr;</Link>
                    </div>
                  </div>
                )}

                {/* Connected, not governed — catalogued entities outside the
                    scope. The on-ramp to expanding scope, and proof nothing is
                    silently dropped when scope narrows. */}
                {scopeCov?.applied && scopeCov.backlog && (() => {
                  const b = scopeCov.backlog;
                  const total = b.systems + b.dataDomains + b.dataAssets + b.valueStreams;
                  const parts = [
                    b.valueStreams ? { n: b.valueStreams, label: b.valueStreams === 1 ? 'value stream' : 'value streams', to: '/processes' } : null,
                    b.systems ? { n: b.systems, label: b.systems === 1 ? 'system' : 'systems', to: '/systems' } : null,
                    b.dataDomains ? { n: b.dataDomains, label: b.dataDomains === 1 ? 'data domain' : 'data domains', to: '/data-domains' } : null,
                    b.dataAssets ? { n: b.dataAssets, label: b.dataAssets === 1 ? 'data asset' : 'data assets', to: '/data-assets' } : null,
                  ].filter(Boolean) as Array<{ n: number; label: string; to: string }>;
                  return (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--color-border)', fontSize: 11.5, lineHeight: 1.5 }}>
                      {total === 0 ? (
                        <span style={{ color: 'var(--color-text-muted)' }}>Everything catalogued for this organization is in scope.</span>
                      ) : (
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                          <span style={{ fontWeight: 600 }}>Connected, not governed</span> — catalogued but outside your scope:{' '}
                          {parts.map((p, i) => (
                            <React.Fragment key={p.to}>
                              <Link to={p.to} style={{ color: 'var(--color-primary)' }}>{p.n} {p.label}</Link>{i < parts.length - 1 ? ' · ' : ''}
                            </React.Fragment>
                          ))}. Add them above to bring them into scope.
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div style={{ paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Boundaries &amp; Constraints</label>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                  Guardrails the program operates within — distinct from what's in scope above.
                </div>
                <textarea aria-label="Boundaries & Constraints" style={textareaStyle} value={boundaries} onChange={(e) => setBoundaries(e.target.value)} placeholder="Organizational / geographic / functional boundaries, plus budget, timeline, regulatory or resource constraints to respect" />
              </div>
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

          {activeTab === 'targets' && (
            // Council Scorecard thresholds — moved here from Settings. Its own
            // Save/Reset live inside the panel (they hit a different endpoint
            // than the program Save Changes below), so the shared footer is
            // hidden on this tab.
            <ScorecardTargetsPanel />
          )}

          {activeTab !== 'targets' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <Button variant="secondary" onClick={() => navigate('/setup')}>Back to Setup</Button>
              <Button variant="primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save Changes'}</Button>
            </div>
          )}
        </Card>
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
