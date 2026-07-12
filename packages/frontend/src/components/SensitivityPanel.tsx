import { useState } from 'react';
import { apiClient } from '../api/client';
import { successToast, errorToast } from '../lib/errorToast';

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
  | 'CONFIDENTIAL' | 'PUBLIC';

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
};

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

  return (
    <div style={{
      marginBottom: 20, padding: 14,
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      background: 'var(--color-surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Sensitivity
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
            {committed.length === 0 && !suggestions
              ? 'Not classified. Ask the AI to suggest tags, then Accept the ones that fit.'
              : committed.length === 0
                ? 'Choose from the suggestions below.'
                : 'Accepted tags. Remove with × or add more via Suggest.'}
          </div>
        </div>
        {!disabled && (
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
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Suggestions from the classifier
            </div>
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
