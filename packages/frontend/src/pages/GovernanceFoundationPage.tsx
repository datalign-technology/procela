import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { errorMessage } from '../lib/errorToast';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import SectionLabel from '../components/SectionLabel';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import SecondaryButton from '../components/SecondaryButton';
import ScorecardTargetsPanel from '../components/ScorecardTargetsPanel';
import RoiModelPanel from '../components/RoiModelPanel';
import Tabs from '../components/Tabs';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import { useRefreshOnFocus } from '../hooks/usePolling';

// ──────────────────────────────────────────────────────────────────────────
// GovernanceFoundationPage — "Governance → Foundation".
//
// The program's foundation artifacts (scope, guiding principles, operating
// model) are authored on this page. There is no program lifecycle to manage —
// a program is simply live once its Foundation is defined — and no separate
// Governance Program page; the old /governance-program URL redirects here.
// ──────────────────────────────────────────────────────────────────────────

interface Program {
  id: string;
  scope: {
    inScope: string; outOfScope: string; boundaries: string; constraints: string;
    systemIds?: string[]; domainIds?: string[]; valueStreamIds?: string[];
    includeIds?: string[]; excludeIds?: string[];
  };
  principles: { vision: string; principles: string[]; decisionRights: string; operatingModel: 'CENTRALIZED' | 'FEDERATED' | 'HYBRID' | '' };
  status: 'PLANNING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  launchedAt?: string | null;
}

interface CatalogItem { id: string; name: string }

interface Ratio { covered: number; total: number; pct: number }
interface ScopeCoverageData {
  applied: boolean;
  entities: { systems: number; dataDomains: number; valueStreamNodes: number; dataAssets: number } | null;
  coverage: { assets: number; mapped: Ratio; governed: Ratio; owned: Ratio } | null;
  // Catalogued entities outside the resolved scope — the "connected, not
  // governed" backlog.
  backlog: { systems: number; dataDomains: number; dataAssets: number; valueStreams: number } | null;
  // Scope version this coverage was measured against (bumps when the governed
  // entity set changes), so trends can be compared apples-to-apples.
  version: { number: number; changedAt: string | null } | null;
}

// A stable fingerprint of the scope form, so the Save bar can tell whether
// there are unsaved edits (ids compared order-independent).
const scopeKey = (sys: string[], dom: string[], vs: string[], inc: string[], exc: string[], bnd: string) =>
  JSON.stringify([[...sys].sort(), [...dom].sort(), [...vs].sort(), [...inc].sort(), [...exc].sort(), bnd]);

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 4,
  padding: '6px 10px', fontSize: 13, width: '100%', background: 'var(--color-surface)',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, fontFamily: 'inherit', resize: 'vertical' };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'auto' as any };

// ScopeTickList — one catalog's in-scope picker as a tick-list: a header with a
// live "In scope N of M" count, Select all / Clear, and a scrollable list of
// checkboxes. Replaces the old add-from-dropdown picker so the whole catalog is
// visible at once (and new users can see what they're choosing between). Names
// that occur more than once in a catalog carry a "Duplicate name" badge so two
// identically-named entities can be told apart before either is scoped.
function ScopeTickList({ label, items, selectedIds, onChange }: {
  label: string; items: CatalogItem[]; selectedIds: string[]; onChange: (ids: string[]) => void;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  // Only ids that still resolve to a catalog item (an entity deleted after
  // being scoped is dropped rather than counted).
  const selectedSet = new Set(selectedIds.filter((id) => byId.has(id)));
  const nameCounts = new Map<string, number>();
  items.forEach((i) => { const n = i.name.trim().toLowerCase(); nameCounts.set(n, (nameCounts.get(n) || 0) + 1); });
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const emit = (set: Set<string>) => onChange(items.filter((i) => set.has(i.id)).map((i) => i.id));
  const toggle = (id: string) => { const next = new Set(selectedSet); if (next.has(id)) next.delete(id); else next.add(id); emit(next); };
  return (
    <fieldset style={{ margin: 0, padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', minWidth: 0 }}>
      <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{label}</legend>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {items.length === 0 ? 'none in catalog' : <>In scope <strong style={{ color: 'var(--color-text)' }}>{selectedSet.size}</strong> of {items.length}</>}
        </span>
      </div>
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '7px 12px', borderBottom: '1px solid var(--color-border)' }}>
          <SecondaryButton onClick={() => emit(new Set(items.map((i) => i.id)))} disabled={selectedSet.size === items.length}>Select all</SecondaryButton>
          <SecondaryButton onClick={() => emit(new Set())} disabled={selectedSet.size === 0}>Clear</SecondaryButton>
        </div>
      )}
      <div style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>No {label.toLowerCase()} catalogued yet.</div>
        ) : sorted.map((it) => {
          const on = selectedSet.has(it.id);
          const dup = (nameCounts.get(it.name.trim().toLowerCase()) || 0) > 1;
          return (
            <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', cursor: 'pointer', background: on ? 'var(--color-primary-light)' : 'transparent' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(it.id)} style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
              {dup && (
                <span title="Another entry shares this name. Rename one so people can tell them apart." style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 7px', borderRadius: 999, background: 'var(--color-warning-light)', color: 'var(--color-warning)', fontSize: 10.5, fontWeight: 600, flex: 'none' }}>
                  <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--color-warning)' }} />Duplicate name
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// OverridePicker — a chip + dropdown for the explicit include/exclude scope
// overrides. Same shape as ScopeSelector but with include (primary) or exclude
// (red) tone and override-appropriate copy, over the data-asset catalog.
function OverridePicker({ label, hint, items, selectedIds, onChange, tone }: {
  label: string; hint: string; items: CatalogItem[]; selectedIds: string[]; onChange: (ids: string[]) => void; tone: 'include' | 'exclude';
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const selected = selectedIds.filter((id) => byId.has(id));
  const available = items.filter((i) => !selectedIds.includes(i.id)).sort((a, b) => a.name.localeCompare(b.name));
  const add = (id: string) => { if (id && !selectedIds.includes(id)) onChange([...selectedIds, id]); };
  const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));
  const chip = tone === 'include'
    ? { bg: 'var(--color-primary-light)', fg: 'var(--color-primary)', border: 'var(--color-primary)' }
    : { bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' };
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>{hint}</div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selected.map((id) => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 6px 3px 10px', background: chip.bg, color: chip.fg, border: `1px solid ${chip.border}`, borderRadius: 999 }}>
              {byId.get(id)!.name}
              <button type="button" onClick={() => remove(id)} aria-label={`Remove ${byId.get(id)!.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0 }}><span aria-hidden="true">&times;</span></button>
            </span>
          ))}
        </div>
      )}
      <select
        aria-label={label}
        style={{ ...selectStyle, color: available.length === 0 ? 'var(--color-text-muted)' : 'var(--color-text)' }}
        value=""
        disabled={available.length === 0}
        onChange={(e) => { add(e.target.value); e.target.value = ''; }}
      >
        <option value="" disabled>
          {items.length === 0 ? 'No data assets catalogued yet' : available.length === 0 ? 'All assets selected' : 'Add a data asset…'}
        </option>
        {available.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </div>
  );
}

export default function GovernanceFoundationPage() {
  const { activeOrgId } = useOrgContext();
  const { addToast } = useToastStore();
  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Deep-linkable tab (?tab=value opens the value model straight from the
  // scorecard's "set your value model" prompt).

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
  // Explicit overrides — force specific data assets in/out of scope, for the
  // edges the anchor cascade gets wrong. Backend supports any entity id; the UI
  // exposes assets (systems/domains/value streams are already anchorable).
  const [includeIds, setIncludeIds] = useState<string[]>([]);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [assetCatalog, setAssetCatalog] = useState<CatalogItem[]>([]);
  const [showOverrides, setShowOverrides] = useState(false);
  // Fingerprint of the scope as last loaded/saved — drives the Save bar's
  // unsaved-changes state and the Discard button.
  const [savedScopeKey, setSavedScopeKey] = useState('');
  // How governed the *saved* scope is — a live read-out under Governed entities.
  const [scopeCov, setScopeCov] = useState<ScopeCoverageData | null>(null);

  const hydrate = (p: Program) => {
    setInScope(p.scope?.inScope || '');
    setOutOfScope(p.scope?.outOfScope || '');
    // Boundaries absorbed the former separate Constraints field — fold any
    // existing constraints text in on load so nothing is lost.
    const bnd = [p.scope?.boundaries, p.scope?.constraints].map((s) => (s || '').trim()).filter(Boolean).join('\n\n');
    const sys = Array.isArray(p.scope?.systemIds) ? p.scope!.systemIds! : [];
    const dom = Array.isArray(p.scope?.domainIds) ? p.scope!.domainIds! : [];
    const vs = Array.isArray(p.scope?.valueStreamIds) ? p.scope!.valueStreamIds! : [];
    const inc = Array.isArray(p.scope?.includeIds) ? p.scope!.includeIds! : [];
    const exc = Array.isArray(p.scope?.excludeIds) ? p.scope!.excludeIds! : [];
    setBoundaries(bnd);
    setSystemIds(sys);
    setDomainIds(dom);
    setValueStreamIds(vs);
    setIncludeIds(inc);
    setExcludeIds(exc);
    setSavedScopeKey(scopeKey(sys, dom, vs, inc, exc, bnd));
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
    const [sysRes, domRes, vsRes, assetRes] = await Promise.allSettled([
      apiClient.get<{ data: CatalogItem[] }>('/systems'),
      apiClient.get<{ data: CatalogItem[] }>('/data-domains'),
      // Value streams live under the process-catalog router
      // (/process-catalog/value-streams). Calling bare /value-streams 404s,
      // which silently left this picker empty even when value streams exist.
      apiClient.get<{ data: CatalogItem[] }>('/process-catalog/value-streams'),
      apiClient.get<{ data: CatalogItem[] }>('/data-assets'),
    ]);
    if (sysRes.status === 'fulfilled') setSystems((sysRes.value.data || []).map((s) => ({ id: s.id, name: s.name })));
    if (domRes.status === 'fulfilled') setDomains((domRes.value.data || []).map((d) => ({ id: d.id, name: d.name })));
    if (vsRes.status === 'fulfilled') setValueStreams((vsRes.value.data || []).map((v) => ({ id: v.id, name: v.name })));
    if (assetRes.status === 'fulfilled') setAssetCatalog((assetRes.value.data || []).map((a) => ({ id: a.id, name: a.name })));
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
        scope: { inScope, outOfScope, boundaries, constraints: '', systemIds, domainIds, valueStreamIds, includeIds, excludeIds },
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

  // Shared Save footer — shown on the Scope and Principles tabs (they write
  // the program). Targets and Value model have their own Save inside their
  // panels (different endpoints), so they don't carry this footer.
  const saveFooter = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
      <Button variant="primary" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save Changes'}</Button>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Foundation"
        subtitle="Define your governance program's scope, guiding principles, and operating model — the groundwork the rest of the program builds on."
      />

      {loading && <Card padding={24} shadow="none"><Spinner center label="Loading…" /></Card>}

      {!loading && !program && (
        <Card padding={24} shadow="none" style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No governance program found for this organization.
        </Card>
      )}

      {!loading && program && (
        <Tabs
          defaultTab="scope"
          tabs={[
            { id: 'scope', label: 'Scope', render: () => {
              const anyAnchor = systemIds.length + domainIds.length + valueStreamIds.length > 0;
              const scopeDirty = savedScopeKey !== scopeKey(systemIds, domainIds, valueStreamIds, includeIds, excludeIds, boundaries);
              const cov = scopeCov?.applied ? scopeCov.coverage : null;
              const b = scopeCov?.applied ? scopeCov.backlog : null;
              const backlogRows = [
                { label: 'Systems', n: b?.systems ?? 0, to: '/systems' },
                { label: 'Data domains', n: b?.dataDomains ?? 0, to: '/data-domains' },
                { label: 'Value streams', n: b?.valueStreams ?? 0, to: '/processes' },
                { label: 'Data assets', n: b?.dataAssets ?? 0, to: '/data-assets' },
              ];
              const backlogTotal = backlogRows.reduce((s, r) => s + r.n, 0);
              return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                {/* Main column — authoring */}
                <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Empty-scope banner — spells out what "no scope" means so a
                      new program never silently governs everything by accident. */}
                  {!anyAnchor && (
                    <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)' }}>
                      <span aria-hidden="true" style={{ flex: 'none', marginTop: 1, color: 'var(--color-warning)', fontSize: 18, lineHeight: 1 }}>&#9888;</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>No scope chosen, so the program governs everything catalogued</div>
                        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.45 }}>
                          That is all {systems.length} system{systems.length === 1 ? '' : 's'}, {domains.length} data domain{domains.length === 1 ? '' : 's'} and {valueStreams.length} value stream{valueStreams.length === 1 ? '' : 's'}. Tick what you actually commit to govern below, so gaps and scorecards measure the right things.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Governed entities — pick the catalogued anchors this program
                      governs. Everything they contain cascades into scope. */}
                  <Card padding={0}>
                    <div style={{ padding: '16px 18px 4px' }}>
                      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>What this program governs</h2>
                      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
                        Tick the systems, data domains and value streams from your catalog. Everything they contain — for example the data assets inside a domain — comes into scope automatically.
                      </p>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, padding: '14px 18px 18px' }}>
                      <ScopeTickList label="Systems" items={systems} selectedIds={systemIds} onChange={setSystemIds} />
                      <ScopeTickList label="Data domains" items={domains} selectedIds={domainIds} onChange={setDomainIds} />
                      <ScopeTickList label="Value streams" items={valueStreams} selectedIds={valueStreamIds} onChange={setValueStreamIds} />
                    </div>

                    {/* Exceptions — fine-tune the edges the cascade gets wrong.
                        Collapsed by default (advanced). */}
                    <div style={{ borderTop: '1px solid var(--color-border)', padding: '14px 18px' }}>
                      <button
                        type="button"
                        onClick={() => setShowOverrides((v) => !v)}
                        aria-expanded={showOverrides}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: `rotate(${showOverrides ? 90 : 0}deg)`, transition: 'transform 0.12s' }}><path d="M9 6l6 6-6 6" /></svg>
                        Exceptions to the scope
                        <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12.5 }}>(optional) Include {includeIds.length} · Exclude {excludeIds.length}</span>
                      </button>
                      {showOverrides && (
                        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                          <OverridePicker
                            tone="include"
                            label="Also govern these assets"
                            hint="Single data assets to pull in even though nothing you ticked above contains them."
                            items={assetCatalog}
                            selectedIds={includeIds}
                            onChange={setIncludeIds}
                          />
                          <OverridePicker
                            tone="exclude"
                            label="Leave these assets out"
                            hint="Assets your scope pulled in that you want to defer for now."
                            items={assetCatalog}
                            selectedIds={excludeIds}
                            onChange={setExcludeIds}
                          />
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Boundaries & constraints */}
                  <Card padding={0}>
                    <div style={{ padding: '16px 18px 18px' }}>
                      <label htmlFor="foundation-boundaries" style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>Boundaries and constraints</label>
                      <p style={{ margin: '4px 0 10px', fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
                        Rules the program must work within, such as budget, deadlines or regulation. This is different from the scope above.
                      </p>
                      <textarea id="foundation-boundaries" aria-label="Boundaries and constraints" style={textareaStyle} value={boundaries} onChange={(e) => setBoundaries(e.target.value)} placeholder="Organizational / geographic / functional boundaries, plus budget, timeline, regulatory or resource constraints to respect" />
                    </div>
                  </Card>

                  {/* Save bar — unsaved-changes state + Discard + Save scope. */}
                  <Card padding={0}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 16px' }}>
                      <span style={{ fontSize: 12.5, color: scopeDirty ? 'var(--color-warning)' : 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: scopeDirty ? 'var(--color-warning)' : 'var(--color-text-muted)', flex: 'none' }} />
                        {scopeDirty ? 'Unsaved changes to scope' : 'All changes saved'}
                      </span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <SecondaryButton size="md" disabled={!scopeDirty || saving} onClick={() => program && hydrate(program)}>Discard</SecondaryButton>
                        <Button variant="primary" disabled={saving || !scopeDirty} onClick={handleSave}>{saving ? 'Saving…' : 'Save scope'}</Button>
                      </span>
                    </div>
                  </Card>
                </div>

                {/* Right rail — live scope summary */}
                <aside aria-label="Scope summary" style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Card padding={0}>
                    <div style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Scope summary</h2>
                        {scopeCov?.version && (
                          <span
                            title={scopeCov.version.changedAt ? `Scope last changed ${new Date(scopeCov.version.changedAt).toLocaleString()}` : 'Scope has not changed since the program was created'}
                            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '2px 8px' }}
                          >
                            v{scopeCov.version.number}
                          </span>
                        )}
                      </div>
                      <dl style={{ margin: '12px 0 0', display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 8, fontSize: 13 }}>
                        <dt style={{ color: 'var(--color-text-secondary)' }}>Systems</dt><dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{systemIds.length}</dd>
                        <dt style={{ color: 'var(--color-text-secondary)' }}>Data domains</dt><dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{domainIds.length}</dd>
                        <dt style={{ color: 'var(--color-text-secondary)' }}>Value streams</dt><dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{valueStreamIds.length}</dd>
                        <dt style={{ color: 'var(--color-text-secondary)' }}>Data assets reached</dt><dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{scopeCov?.entities ? scopeCov.entities.dataAssets : '—'}</dd>
                      </dl>
                    </div>
                    <div style={{ padding: '0 16px 14px' }}>
                      <div style={{ paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
                        <SectionLabel marginBottom={10}>Coverage after save</SectionLabel>
                        {cov && cov.assets > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                            {[
                              { label: 'Mapped', hint: 'Linked to a business process', r: cov.mapped },
                              { label: 'Governed', hint: 'At a managed or certified tier', r: cov.governed },
                              { label: 'Owned', hint: 'Has a named owner', r: cov.owned },
                            ].map(({ label, hint, r }) => (
                              <div key={label}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <span title={hint} style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{label}</span>
                                  <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{r.covered} of {r.total} · {r.pct}%</span>
                                </div>
                                <div style={{ height: 6, borderRadius: 999, background: 'var(--color-bg)', overflow: 'hidden', marginTop: 4 }}>
                                  <div style={{ height: '100%', width: `${r.pct}%`, background: 'var(--color-primary)' }} />
                                </div>
                              </div>
                            ))}
                            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                              Measured on the saved scope. <Link to="/gap-detection" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>See gaps in scope &rarr;</Link>
                            </p>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
                            {anyAnchor
                              ? 'Save your scope to see how much of it is mapped, governed and owned.'
                              : 'Coverage appears once you save a scope.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>

                  <Card padding={0}>
                    <div style={{ padding: '14px 16px' }}>
                      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Connected, not governed</h2>
                      <p style={{ margin: '4px 0 10px', fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
                        In your catalog but outside the scope. Tick them on the left to bring them in.
                      </p>
                      {!scopeCov?.applied ? (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Save a scope to see what's left out.</div>
                      ) : backlogTotal === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>Everything catalogued for this organization is in scope.</div>
                      ) : (
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                          {backlogRows.map((r) => (
                            <li key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <Link to={r.to} style={{ color: r.n > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>{r.label}</Link>
                              <span style={{ fontVariantNumeric: 'tabular-nums', color: r.n > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{r.n}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Card>
                </aside>
              </div>
              );
            } },
            { id: 'principles', label: 'Principles', render: () => (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                {/* Vision */}
                <Card padding={0} style={{ gridColumn: '1 / -1' }}>
                  <div style={{ padding: '16px 18px 18px' }}>
                    <label htmlFor="foundation-vision" style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>Vision</label>
                    <p style={{ margin: '4px 0 10px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>One or two sentences on what success looks like.</p>
                    <textarea id="foundation-vision" aria-label="Vision" style={textareaStyle} value={vision} onChange={(e) => setVision(e.target.value)} placeholder="What does success look like for your data governance program?" />
                  </div>
                </Card>

                {/* Guiding principles */}
                <Card padding={0} style={{ gridColumn: '1 / -1' }}>
                  <div style={{ padding: '16px 18px 18px' }}>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Guiding principles</h2>
                    <p style={{ margin: '4px 0 12px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>Short rules people can use to settle a disagreement.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      {principles.length === 0 && (
                        <div style={{ padding: 14, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', fontSize: 12.5 }}>No principles yet. Most programs start with three to five.</div>
                      )}
                      {principles.map((p, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', minWidth: 20, fontVariantNumeric: 'tabular-nums' }}>{idx + 1}.</span>
                          <span style={{ flex: 1, fontSize: 13 }}>{p}</span>
                          <button type="button" onClick={() => removePrinciple(idx)} aria-label={`Remove principle ${p}`} title="Remove principle" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-muted)', padding: 2 }}><span aria-hidden="true">&times;</span></button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input aria-label="New principle" style={inputStyle} value={newPrinciple} onChange={(e) => setNewPrinciple(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPrinciple(); } }} placeholder="e.g. Data is a shared asset; treat it like one" />
                      <Button variant="secondary" onClick={addPrinciple}>Add principle</Button>
                    </div>
                  </div>
                </Card>

                {/* Operating model — radio cards */}
                <Card padding={0}>
                  <div style={{ padding: '16px 18px 18px' }}>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Operating model</h2>
                    <p style={{ margin: '4px 0 12px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>Who runs governance day to day.</p>
                    <div role="radiogroup" aria-label="Operating model" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                      {([
                        { v: 'CENTRALIZED', t: 'Centralized', d: 'One central team sets and enforces the rules.' },
                        { v: 'FEDERATED', t: 'Federated', d: 'Each domain governs itself to shared standards.' },
                        { v: 'HYBRID', t: 'Hybrid', d: 'A central team plus domain stewards share the work.' },
                      ] as const).map(({ v, t, d }) => {
                        const on = operatingModel === v;
                        return (
                          <label key={v} style={{ display: 'flex', gap: 10, padding: '10px 12px', border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', background: on ? 'var(--color-primary-light)' : 'transparent', cursor: 'pointer' }}>
                            <input type="radio" name="operating-model" checked={on} onChange={() => setOperatingModel(v)} style={{ accentColor: 'var(--color-primary)', marginTop: 2, flex: 'none' }} />
                            <span><strong>{t}</strong><span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{d}</span></span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </Card>

                {/* Decision rights — structured entity of its own; link out. */}
                <Card padding={0}>
                  <div style={{ padding: '16px 18px 18px' }}>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Decision rights</h2>
                    <p style={{ margin: '4px 0 12px', fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>Who decides, recommends and approves each kind of decision lives on its own page.</p>
                    <Link to="/decision-rights" style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: 13 }}>Open decision rights &rarr;</Link>
                  </div>
                </Card>

                <div style={{ gridColumn: '1 / -1' }}>{saveFooter}</div>
              </div>
            ) },
            { id: 'targets', label: 'Targets', render: () => (
              // Council Scorecard thresholds — own Save/Reset inside the panel
              // (different endpoint), so no shared Save footer on this tab.
              <Card padding={24}><ScorecardTargetsPanel /></Card>
            ) },
            { id: 'value', label: 'Value model', render: () => (
              // ROI value model — own Save/Clear inside the panel (own
              // endpoint), so no shared Save footer on this tab.
              <Card padding={24}><RoiModelPanel /></Card>
            ) },
          ]}
        />
      )}
    </div>
  );
}
