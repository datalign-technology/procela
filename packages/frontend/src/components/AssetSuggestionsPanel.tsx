// Phase 3 Discover surface: suggests data assets to map to an
// activity-level process node, based on the backend's
// /process-catalog/nodes/:id/asset-suggestions endpoint.
//
// Loads suggestions on demand (only when the user expands the
// activity), shows the ranked list with scores and rationale, and
// lets the user accept a suggestion (creates a mapping) or dismiss
// one (hides it for this session only — there's no server-side
// "rejected" memory yet, that's the learning-loop follow-up).
//
// Hides itself entirely when there's nothing to suggest, so the
// activity card doesn't accumulate dead UI for steps where every
// asset is already mapped or no asset looks relevant.

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';

interface AssetSuggestion {
  assetId: string;
  assetName: string;
  systemId: string;
  score: number;
  rationale: string[];
}

interface AssetSuggestionsPanelProps {
  /** Activity node the suggestions are for. */
  nodeId: string;
  /** Asset id → friendly system name, so we can render a "Same
   *  system as the step (SAP Finance)" line instead of a UUID. */
  systemNames?: Record<string, string>;
  /** Accept handler — caller wires this to the same mapping-creation
   *  flow used by the IOPanel + Add picker. Returning a promise lets
   *  us flash the row's busy state until the POST settles. */
  onAccept: (assetId: string) => Promise<void>;
  /** Disabled when the surrounding node is locked (status forbids
   *  edits) or when the user lacks write permission. Stops both
   *  Accept and Dismiss. */
  disabled?: boolean;
  /** Bumped by the parent whenever the mappings list changes —
   *  causes us to refetch so accepted suggestions disappear and any
   *  newly-orphaned candidates show up. */
  refreshKey?: number;
}

// Score → human-readable confidence bucket. Lets the UI render a
// quick "High / Medium / Low" chip without dragging the user through
// raw decimals. Thresholds are conservative — even a "Low" result is
// above the backend's minScore default, so showing it means the
// scoring at least found a signal.
function confidenceBucket(score: number): { label: string; bg: string; fg: string } {
  if (score >= 0.7) return { label: 'High',   bg: '#d1fae5', fg: '#065f46' };
  if (score >= 0.4) return { label: 'Medium', bg: '#fef3c7', fg: '#92400e' };
  return { label: 'Low', bg: '#f1f5f9', fg: '#475569' };
}

export default function AssetSuggestionsPanel({
  nodeId,
  systemNames,
  onAccept,
  disabled,
  refreshKey,
}: AssetSuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<AssetSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Session-local "dismissed" set. The backend doesn't yet learn
  // from rejections (Phase 3 learning-loop follow-up), so dismissing
  // hides the row for this mount only. A page refresh brings it
  // back if the score still qualifies.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Per-asset accept-in-flight tracker so we can show "Adding…" on
  // the specific row the user clicked.
  const [accepting, setAccepting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: AssetSuggestion[] }>(
        `/process-catalog/nodes/${nodeId}/asset-suggestions`,
      );
      setSuggestions(res.data || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load suggestions');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const visible = (suggestions || []).filter((s) => !dismissed.has(s.assetId));

  // Suppress the entire panel when there's nothing to show. We
  // explicitly DON'T hide on loading (a brief skeleton beats a
  // flicker) but a confirmed empty result means the activity is
  // either fully mapped or has no candidates worth surfacing.
  if (!loading && !error && visible.length === 0) return null;

  const handleAccept = async (assetId: string) => {
    if (disabled || accepting.has(assetId)) return;
    setAccepting((prev) => new Set(prev).add(assetId));
    try {
      await onAccept(assetId);
      // After the mapping POST returns, refetch so the accepted
      // asset disappears and any newly-elevated candidates appear.
      await load();
    } finally {
      setAccepting((prev) => {
        const next = new Set(prev);
        next.delete(assetId);
        return next;
      });
    }
  };

  return (
    <div style={{
      marginTop: 8,
      border: '1px dashed var(--color-border)',
      borderRadius: 4,
      background: '#f8fafc',
      padding: '8px 10px',
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span>Suggested data assets</span>
        <span title="Procela ranks data assets that look like candidates for this step based on name + description overlap and shared system. Accept moves it into the Inputs/Outputs above; Dismiss hides it for this session." style={{ cursor: 'help', color: 'var(--color-text-muted)' }}>?</span>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading suggestions…</div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>
      )}

      {!loading && !error && visible.map((s) => {
        const bucket = confidenceBucket(s.score);
        const sysName = systemNames?.[s.systemId];
        // The backend's rationale lines are stable enough to render
        // verbatim. We just rewrite the "system id ..." line if we
        // know the friendly name — otherwise the user sees a UUID,
        // which is fine but unhelpful.
        const friendlyRationale = sysName
          ? s.rationale.map((line) => line.replace(/system id\s+\S+/i, sysName))
          : s.rationale;
        const isAdding = accepting.has(s.assetId);
        return (
          <div
            key={s.assetId}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '6px 4px',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{s.assetName}</span>
                <span
                  title={`Score ${Math.round(s.score * 100)}%`}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: bucket.bg,
                    color: bucket.fg,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {bucket.label}
                </span>
              </div>
              {friendlyRationale.length > 0 && (
                <ul style={{
                  margin: '4px 0 0',
                  padding: '0 0 0 16px',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  lineHeight: 1.4,
                }}>
                  {friendlyRationale.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
              <button
                type="button"
                disabled={disabled || isAdding}
                onClick={() => handleAccept(s.assetId)}
                style={{
                  background: disabled || isAdding ? 'var(--color-bg)' : '#059669',
                  color: disabled || isAdding ? 'var(--color-text-muted)' : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: disabled || isAdding ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {isAdding ? 'Adding…' : 'Accept'}
              </button>
              <button
                type="button"
                disabled={disabled || isAdding}
                onClick={() => setDismissed((prev) => new Set(prev).add(s.assetId))}
                aria-label="Dismiss suggestion"
                title="Dismiss for this session"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  cursor: disabled || isAdding ? 'not-allowed' : 'pointer',
                  opacity: disabled || isAdding ? 0.5 : 1,
                  lineHeight: 1.2,
                }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
