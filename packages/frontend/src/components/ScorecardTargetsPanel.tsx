import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import SecondaryButton from './SecondaryButton';

// ──────────────────────────────────────────────────────────────────────────
// ScorecardTargetsPanel — the per-tenant thresholds the Council Scorecard
// grades each division against. Unset on the org = the shipped defaults;
// changes take effect on the next scorecard load (saved snapshots keep the
// targets they were frozen with).
//
// Self-contained (reads its own org context + toast) so it can be dropped in
// anywhere. It lives on Governance → Foundation ("Targets" tab); it renders
// its own heading/description and Save/Reset buttons and no outer Card, so the
// host provides the container.
// ──────────────────────────────────────────────────────────────────────────

type ScorecardTargets = { coverage: number; classification: number; openIssues: number; exceptions: number; openIssuesDays: number };
const SCORECARD_TARGET_DEFAULTS: ScorecardTargets = { coverage: 80, classification: 70, openIssues: 0, exceptions: 0, openIssuesDays: 30 };
const SCORECARD_TARGET_FIELDS: Array<{ key: keyof ScorecardTargets; label: string; unit: '%' | 'count' | 'days'; hint: string }> = [
  { key: 'coverage',       label: 'Tier-1 coverage', unit: '%',     hint: 'Min share of Tier-1 domains with a named owner.' },
  { key: 'classification', label: 'Classification',  unit: '%',     hint: 'Min share of data assets carrying a sensitivity classification.' },
  { key: 'openIssues',     label: 'Open issues',     unit: 'count', hint: 'Max aged open issues before the division falls short.' },
  { key: 'exceptions',     label: 'Exceptions',      unit: 'count', hint: 'Max past-expiry exceptions allowed.' },
  { key: 'openIssuesDays', label: 'Open-issue age',  unit: 'days',  hint: 'How old (in days) an open issue must be to count.' },
];

export default function ScorecardTargetsPanel() {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const { addToast } = useToastStore();

  const [targets, setTargets] = useState<ScorecardTargets>(SCORECARD_TARGET_DEFAULTS);
  const [saved, setSaved] = useState<ScorecardTargets>(SCORECARD_TARGET_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    if (!activeOrgId) return;
    let alive = true;
    apiClient
      .get<{ success: boolean; data: { scorecardTargets?: Partial<ScorecardTargets> | null } }>(`/organizations/${activeOrgId}`)
      .then((res) => {
        if (!alive) return;
        const t = res.data?.scorecardTargets;
        const merged = { ...SCORECARD_TARGET_DEFAULTS, ...(t && typeof t === 'object' ? t : {}) };
        setTargets(merged);
        setSaved(merged);
        setCustom(!!t && typeof t === 'object');
      })
      .catch(() => { /* leave defaults in place */ });
    return () => { alive = false; };
  }, [activeOrgId]);

  const dirty = SCORECARD_TARGET_FIELDS.some((f) => targets[f.key] !== saved[f.key]);
  const setTarget = (key: keyof ScorecardTargets, value: number) => setTargets((p) => ({ ...p, [key]: value }));

  const save = async () => {
    if (!activeOrgId || busy) return;
    setBusy(true);
    try {
      const res = await apiClient.put<{ success: boolean; data: { scorecardTargets?: ScorecardTargets } }>(`/organizations/${activeOrgId}`, { scorecardTargets: targets });
      const next = res.data?.scorecardTargets ?? targets;
      setTargets(next);
      setSaved(next);
      setCustom(true);
      addToast('success', 'Scorecard targets saved.');
    } catch {
      addToast('error', 'Failed to save scorecard targets.');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!activeOrgId || busy) return;
    setBusy(true);
    try {
      await apiClient.put(`/organizations/${activeOrgId}`, { scorecardTargets: null });
      setTargets(SCORECARD_TARGET_DEFAULTS);
      setSaved(SCORECARD_TARGET_DEFAULTS);
      setCustom(false);
      addToast('success', 'Scorecard targets reset to the shipped defaults.');
    } catch {
      addToast('error', 'Failed to reset scorecard targets.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Council Scorecard targets</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
        The thresholds the <strong>{activeOrgName || 'this tenant'}</strong> Council Scorecard grades each division against. Keep the shipped defaults or set your council&rsquo;s own bar — the live scorecard re-derives against these on its next load. {custom ? 'Custom targets are in effect.' : 'Using the shipped defaults.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {SCORECARD_TARGET_FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{f.hint}</span>
            </span>
            <input
              type="number"
              aria-label={f.label}
              min={f.unit === 'days' ? 1 : 0}
              max={f.unit === '%' ? 100 : undefined}
              value={targets[f.key]}
              disabled={busy}
              onChange={(e) => setTarget(f.key, e.target.value === '' ? 0 : Number(e.target.value))}
              style={{ width: 72, textAlign: 'right', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}
            />
            <span style={{ width: 34, fontSize: 12, color: 'var(--color-text-muted)' }}>{f.unit === '%' ? '%' : f.unit === 'days' ? 'days' : ''}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={!activeOrgId || busy || !dirty}
          style={{ padding: '0.5rem 1.25rem', background: (!dirty || busy) ? 'var(--color-border)' : 'var(--color-primary)', color: (!dirty || busy) ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: (!activeOrgId || busy || !dirty) ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Saving…' : 'Save targets'}
        </button>
        <SecondaryButton onClick={reset} disabled={!activeOrgId || busy || !custom}>Reset to defaults</SecondaryButton>
      </div>
    </div>
  );
}
