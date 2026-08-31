import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { successToast, errorToast } from '../lib/errorToast';
import SectionLabel from './SectionLabel';
import { useAiEnabled } from '../stores/aiConfigStore';
import { useRegimeStore, useActiveRegimes } from '../stores/regimeStore';
import { useOrgContext } from '../stores/orgContext';

// ──────────────────────────────────────────────────────────────────────────
// SensitivityPanel — the Suggest & Review flow for AI-generated data
// sensitivity classifications. Sits on the Data Asset 360 detail view.
//
// Two states:
//   1. Committed  — the sensitivity tags a human has accepted. Shown as
//      solid chips with a small remove ×.
//   2. Suggested  — tags the AI classifier returned but a human hasn't
//      acted on yet. Shown as dashed-border chips with per-tag Accept /
//      Reject buttons. Accept commits the tag (calls PUT
//      /:id/sensitivity with the new list); Reject dismisses it
//      client-side without persisting anywhere — the audit trail
//      captures accepts, not rejects.
//
// Backend:
//   POST /data-assets/:id/suggest-sensitivity → transient Claude call
//   PUT  /data-assets/:id/sensitivity          → persist accepted tags
//
// ──────────────────────────────────────────────────────────────────────────

type SensitivityTag =
  | 'PII' | 'PHI' | 'PCI'
  | 'FINANCIAL' | 'CREDENTIAL'
  | 'CONFIDENTIAL' | 'PUBLIC'
  | 'CUI' | 'ITAR' | 'EXPORT_CONTROLLED';

interface Suggestion {
  tag: SensitivityTag;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

// Palette per-tag. Kept text-only + inline hex so a palette drift on
// the semantic tokens (which are for good/warning/error) doesn't
// silently redecorate the sensitivity chips.
const TAG_PALETTE: Record<SensitivityTag, { bg: string; color: string; label: string }> = {
  PII:          { bg: '#fee2e2', color: '#991b1b', label: 'PII' },
  PHI:          { bg: '#fecaca', color: '#7f1d1d', label: 'PHI' },
  PCI:          { bg: '#fee2e2', color: '#991b1b', label: 'PCI' },
  FINANCIAL:    { bg: '#fef3c7', color: '#92400e', label: 'Financial' },
  CREDENTIAL:   { bg: '#f5d0fe', color: '#701a75', label: 'Credential' },
  CONFIDENTIAL: { bg: '#e0e7ff', color: '#3730a3', label: 'Confidential' },
  PUBLIC:       { bg: '#dcfce7', color: '#166534', label: 'Public' },
  // Regulatory / export-control regimes — slate/indigo family to read as a
  // distinct group from the privacy/financial data-sensitivity chips.
  CUI:              { bg: '#e2e8f0', color: '#1e293b', label: 'CUI' },
  ITAR:             { bg: '#dbeafe', color: '#1e3a8a', label: 'ITAR' },
  EXPORT_CONTROLLED:{ bg: '#cffafe', color: '#155e75', label: 'Export-Controlled' },
};

// Regulatory / export-control tags render together, apart from the
// data-sensitivity categories, since they express a statutory handling
// regime rather than a data-content category.
const REGULATORY_TAGS: SensitivityTag[] = ['CUI', 'ITAR', 'EXPORT_CONTROLLED'];

const CONFIDENCE_STYLES: Record<Suggestion['confidence'], { color: string; label: string }> = {
  HIGH:   { color: '#065f46', label: 'HIGH' },
  MEDIUM: { color: '#a16207', label: 'MEDIUM' },
  LOW:    { color: '#6b7280', label: 'LOW' },
};

interface Props {
  assetId: string;
  initialTags: SensitivityTag[] | undefined;
  disabled?: boolean;
  /** Called after a successful PUT so the parent can update its
   *  in-memory copy of the asset row without re-fetching. */
  onCommittedChange?: (next: SensitivityTag[]) => void;
}

export default function SensitivityPanel({ assetId, initialTags, disabled, onCommittedChange }: Props) {
  const [committed, setCommitted] = useState<SensitivityTag[]>(initialTags || []);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const aiEnabled = useAiEnabled();
  const activeOrgId = useOrgContext((s) => s.activeOrgId);
  const activeRegimes = useActiveRegimes();
  // Resolve which regulatory regimes this tenant has turned on, so the manual
  // picker only offers CUI/ITAR/export where the org admin enabled them.
  useEffect(() => { void useRegimeStore.getState().fetch(activeOrgId); }, [activeOrgId]);

  // Classification can be set two ways: the AI classifier (Suggest → Accept)
  // and a manual picker. The manual picker matters most for regulatory tags
  // (CUI / ITAR / export) on AI-off deployments — exactly the FedRAMP / on-prem
  // customers who need them. When read-only (disabled) with nothing to show,
  // render nothing rather than an empty box that offers no action.
  if (disabled && committed.length === 0) return null;

  const runSuggest = async () => {
    setBusy(true);
    try {
      const res = await apiClient.post<{ success: boolean; data: Suggestion[] }>(
        `/data-assets/${assetId}/suggest-sensitivity`, {}
      );
      // Filter out any tag the human has already accepted so the two
      // rows don't step on each other.
      const already = new Set(committed);
      setSuggestions((res.data || []).filter((s) => !already.has(s.tag)));
    } catch (e) {
      errorToast(e, 'Sensitivity suggestion failed');
    } finally { setBusy(false); }
  };

  const persist = async (next: SensitivityTag[]) => {
    setSaving(true);
    try {
      await apiClient.put(`/data-assets/${assetId}/sensitivity`, { tags: next });
      setCommitted(next);
      onCommittedChange?.(next);
    } catch (e) {
      errorToast(e, 'Save failed');
      throw e;
    } finally { setSaving(false); }
  };

  const acceptOne = async (s: Suggestion) => {
    if (committed.includes(s.tag)) return;
    const next = [...committed, s.tag];
    try {
      await persist(next);
      setSuggestions((prev) => (prev || []).filter((x) => x.tag !== s.tag));
      successToast(`Accepted ${TAG_PALETTE[s.tag].label}`);
    } catch { /* toast handled */ }
  };

  const rejectOne = (s: Suggestion) => {
    // Local dismiss only — audit trail captures accepts, not rejects.
    setSuggestions((prev) => (prev || []).filter((x) => x.tag !== s.tag));
  };

  const removeCommitted = async (tag: SensitivityTag) => {
    const next = committed.filter((x) => x !== tag);
    try {
      await persist(next);
      successToast(`Cleared ${TAG_PALETTE[tag].label}`);
    } catch { /* toast handled */ }
  };

  const addManual = async (tag: SensitivityTag) => {
    if (!tag || committed.includes(tag)) return;
    const next = [...committed, tag];
    try {
      await persist(next);
      successToast(`Added ${TAG_PALETTE[tag].label}`);
    } catch { /* toast handled */ }
  };

  // Tags not yet applied, split into the two groups for the manual picker's
  // optgroups (data-sensitivity vs regulatory / export-control).
  const committedSet = new Set(committed);
  const dataSensitivityChoices = (['PII','PHI','PCI','FINANCIAL','CREDENTIAL','CONFIDENTIAL','PUBLIC'] as SensitivityTag[]).filter((t) => !committedSet.has(t));
  // Only offer regulatory regimes the tenant has active.
  const regulatoryChoices = REGULATORY_TAGS.filter((t) => !committedSet.has(t) && activeRegimes.includes(t));

  return (
    <div style={{
      marginBottom: 20, padding: 14,
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      background: 'var(--color-surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <SectionLabel marginBottom={0}>
            Sensitivity
          </SectionLabel>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
            {committed.length === 0 && !suggestions
              ? (aiEnabled
                  ? 'Not classified. Ask the AI to suggest tags, then Accept the ones that fit.'
                  : 'Not classified.')
              : committed.length === 0
                ? 'Choose from the suggestions below.'
                : aiEnabled
                  ? 'Accepted tags. Remove with × or add more via Suggest.'
                  : 'Accepted tags. Remove with ×.'}
          </div>
        </div>
        {!disabled && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(dataSensitivityChoices.length > 0 || regulatoryChoices.length > 0) && (
              <select
                aria-label="Add classification"
                value=""
                disabled={saving}
                onChange={(e) => { const v = e.target.value as SensitivityTag; if (v) void addManual(v); e.currentTarget.selectedIndex = 0; }}
                style={{
                  padding: '6px 8px', fontSize: 12,
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  background: 'var(--color-surface)', color: 'var(--color-text)',
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                <option value="">+ Add classification…</option>
                {dataSensitivityChoices.length > 0 && (
                  <optgroup label="Data sensitivity">
                    {dataSensitivityChoices.map((t) => <option key={t} value={t}>{TAG_PALETTE[t].label}</option>)}
                  </optgroup>
                )}
                {regulatoryChoices.length > 0 && (
                  <optgroup label="Regulatory / export control">
                    {regulatoryChoices.map((t) => <option key={t} value={t}>{TAG_PALETTE[t].label}</option>)}
                  </optgroup>
                )}
              </select>
            )}
            {aiEnabled && (
              <button
                onClick={runSuggest}
                disabled={busy || saving}
                style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: 500,
                  background: busy ? 'var(--color-bg)' : 'var(--color-primary)',
                  color: busy ? 'var(--color-text-muted)' : '#fff',
                  border: 'none', borderRadius: 4,
                  cursor: busy || saving ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {busy ? 'Asking Claude…' : suggestions ? 'Re-suggest' : 'Suggest sensitivity'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Committed chips */}
      {committed.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: suggestions && suggestions.length > 0 ? 12 : 0 }}>
          {committed.map((tag) => {
            const c = TAG_PALETTE[tag];
            return (
              <span key={tag} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 10px', borderRadius: 999,
                background: c.bg, color: c.color, fontSize: 12, fontWeight: 600,
              }}>
                {c.label}
                {!disabled && (
                  <button
                    onClick={() => removeCommitted(tag)}
                    disabled={saving}
                    title={`Remove ${c.label}`}
                    style={{ background: 'transparent', border: 'none', color: c.color, cursor: saving ? 'not-allowed' : 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                  >×</button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Pending suggestions — one row per tag with per-row Accept /
          Reject. Confidence + reason inline so the reviewer has the
          rationale in the same eye-line as the decision buttons. */}
      {suggestions !== null && (
        suggestions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            No further suggestions from the classifier.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SectionLabel marginBottom={0}>
              Suggestions from the classifier
            </SectionLabel>
            {suggestions.map((s) => {
              const c = TAG_PALETTE[s.tag];
              const conf = CONFIDENCE_STYLES[s.confidence];
              return (
                <div key={s.tag} style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 60px 1fr auto',
                  gap: 10, alignItems: 'center',
                  padding: '6px 8px',
                  border: `1px dashed ${c.color}55`,
                  borderRadius: 4,
                }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                    background: c.bg, color: c.color, fontSize: 11, fontWeight: 600,
                  }}>{c.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: conf.color, letterSpacing: '0.06em' }}>
                    {conf.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                    {s.reason}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => acceptOne(s)}
                      disabled={saving}
                      style={{
                        padding: '3px 10px', fontSize: 11, fontWeight: 600,
                        background: '#dcfce7', color: '#166534',
                        border: '1px solid #86efac', borderRadius: 4,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >Accept</button>
                    <button
                      onClick={() => rejectOne(s)}
                      disabled={saving}
                      style={{
                        padding: '3px 10px', fontSize: 11,
                        background: 'transparent', color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-border)', borderRadius: 4,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
