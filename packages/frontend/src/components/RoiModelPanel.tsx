import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useToastStore } from '../stores/toastStore';
import SecondaryButton from './SecondaryButton';

// ──────────────────────────────────────────────────────────────────────────
// RoiModelPanel — ROI Phase 2. The per-tenant dollar assumptions the Council
// Scorecard uses to monetize its governance value drivers. Procela ships NO
// figures: until a tenant sets a value here, the scorecard shows leading
// indicators only and no dollar estimate. The math is transparent — each
// figure below is the value/cost the tenant assigns to one unit, multiplied by
// the live driver counts on the scorecard.
//
// Self-contained (reads its own org context + toast) so it can be dropped in
// anywhere. It lives on Governance → Foundation ("Value model" tab); it renders
// its own heading/description and Save/Reset buttons and no outer Card, so the
// host provides the container.
// ──────────────────────────────────────────────────────────────────────────

type RoiModel = { currency: string; riskCostPerItem: number; resolutionValuePerIssue: number; ownershipValuePerEntity: number };
const ROI_MODEL_DEFAULTS: RoiModel = { currency: 'USD', riskCostPerItem: 0, resolutionValuePerIssue: 0, ownershipValuePerEntity: 0 };
const ROI_MODEL_FIELDS: Array<{ key: keyof Omit<RoiModel, 'currency'>; label: string; hint: string }> = [
  { key: 'ownershipValuePerEntity', label: 'Value per owned entity',    hint: 'Annual value of a domain or asset having a named owner — faster access, fewer "who owns this?" escalations.' },
  { key: 'resolutionValuePerIssue', label: 'Value per issue resolved',  hint: 'Cost your organization avoids each time a governance issue is remediated.' },
  { key: 'riskCostPerItem',         label: 'Exposure per open-risk item', hint: 'Estimated exposure carried by each open-risk item (past-expiry exception, unowned Tier-1 domain, unclassified asset).' },
];

export default function RoiModelPanel() {
  const { activeOrgId, activeOrgName } = useOrgContext();
  const { addToast } = useToastStore();

  const [model, setModel] = useState<RoiModel>(ROI_MODEL_DEFAULTS);
  const [saved, setSaved] = useState<RoiModel>(ROI_MODEL_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    if (!activeOrgId) return;
    let alive = true;
    apiClient
      .get<{ success: boolean; data: { roiModel?: Partial<RoiModel> | null } }>(`/organizations/${activeOrgId}`)
      .then((res) => {
        if (!alive) return;
        const m = res.data?.roiModel;
        const merged = { ...ROI_MODEL_DEFAULTS, ...(m && typeof m === 'object' ? m : {}) };
        setModel(merged);
        setSaved(merged);
        setCustom(!!m && typeof m === 'object');
      })
      .catch(() => { /* leave defaults in place */ });
    return () => { alive = false; };
  }, [activeOrgId]);

  const dirty =
    model.currency !== saved.currency ||
    ROI_MODEL_FIELDS.some((f) => model[f.key] !== saved[f.key]);
  const configured = ROI_MODEL_FIELDS.some((f) => model[f.key] > 0);
  const setField = (key: keyof Omit<RoiModel, 'currency'>, value: number) => setModel((p) => ({ ...p, [key]: value }));

  const save = async () => {
    if (!activeOrgId || busy) return;
    setBusy(true);
    try {
      const res = await apiClient.put<{ success: boolean; data: { roiModel?: RoiModel } }>(`/organizations/${activeOrgId}`, { roiModel: model });
      const next = res.data?.roiModel ?? model;
      setModel(next);
      setSaved(next);
      setCustom(true);
      addToast('success', 'Value model saved.');
    } catch {
      addToast('error', 'Failed to save value model.');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!activeOrgId || busy) return;
    setBusy(true);
    try {
      await apiClient.put(`/organizations/${activeOrgId}`, { roiModel: null });
      setModel(ROI_MODEL_DEFAULTS);
      setSaved(ROI_MODEL_DEFAULTS);
      setCustom(false);
      addToast('success', 'Value model cleared — the scorecard shows leading indicators only.');
    } catch {
      addToast('error', 'Failed to clear value model.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Governance value model</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
        Your own dollar assumptions for the <strong>{activeOrgName || 'this tenant'}</strong> Council Scorecard. Procela measures the governance value drivers; you supply what a unit is worth, and the scorecard turns the two into an estimated annual value. {custom ? (configured ? 'A value model is in effect.' : 'Set at least one figure above zero to show a dollar estimate.') : 'No value model set — the scorecard shows leading indicators only.'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginTop: 14 }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Currency</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>Display code for the figures below (e.g. USD, EUR, GBP).</span>
        </span>
        <input
          type="text"
          aria-label="Currency"
          maxLength={8}
          value={model.currency}
          disabled={busy}
          onChange={(e) => setModel((p) => ({ ...p, currency: e.target.value.toUpperCase() }))}
          style={{ width: 80, textAlign: 'center', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', textTransform: 'uppercase' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {ROI_MODEL_FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{f.hint}</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{model.currency}</span>
            <input
              type="number"
              aria-label={f.label}
              min={0}
              step={1000}
              value={model[f.key]}
              disabled={busy}
              onChange={(e) => setField(f.key, e.target.value === '' ? 0 : Number(e.target.value))}
              style={{ width: 110, textAlign: 'right', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}
            />
          </label>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
        Estimates are only as good as these assumptions — Procela never invents a figure. Annual value = (owned entities × value per owned entity) + (issues resolved in the last 30 days × value per issue resolved × 12). Value at risk = open-risk items × exposure per item, shown separately as exposure the program is working down.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={!activeOrgId || busy || !dirty}
          style={{ padding: '0.5rem 1.25rem', background: (!dirty || busy) ? 'var(--color-border)' : 'var(--color-primary)', color: (!dirty || busy) ? 'var(--color-text-muted)' : '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500, cursor: (!activeOrgId || busy || !dirty) ? 'not-allowed' : 'pointer' }}
        >
          {busy ? 'Saving…' : 'Save value model'}
        </button>
        <SecondaryButton onClick={reset} disabled={!activeOrgId || busy || !custom}>Clear model</SecondaryButton>
      </div>
    </div>
  );
}
