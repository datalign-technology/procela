// Generic Phase 3 Discover surface — the visual shell and shared
// fetch/accept/dismiss machinery for ranked-suggestion panels
// (assets, systems, people). The kind-specific wrappers
// (AssetSuggestionsPanel, SystemSuggestionsPanel,
// PeopleSuggestionsPanel) provide endpoint paths, labels, and a
// normaliser that flattens each kind's backend row shape into the
// common `Suggestion` contract this shell renders.
//
// Dismissals POST to the backend learning-loop endpoint so a hidden
// row stays hidden across refreshes; until the POST resolves we hide
// it optimistically.

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';

export type SuggestionKind = 'asset' | 'system' | 'person';

export interface Suggestion {
  /** Stable id of the suggested entity (asset/system/person id). */
  targetId: string;
  /** Display name. */
  targetName: string;
  /** Optional second-line subtitle (system name, vendor, job title). */
  subtitle?: string;
  /** 0..1 — bucketed into High / Medium / Low by confidenceBucket(). */
  score: number;
  /** Why this row was suggested. Rendered verbatim as a bullet list. */
  rationale: string[];
}

export interface SuggestionsPanelProps {
  /** Activity (or higher) node the suggestions are for. */
  nodeId: string;
  /** Drives both the GET path suffix and the dismissal kind payload. */
  kind: SuggestionKind;
  /** GET path under /api/v1 — e.g. `/process-catalog/nodes/:id/asset-suggestions`. */
  endpoint: string;
  /** Heading label, e.g. "Suggested data assets". */
  title: string;
  /** Tooltip / "?" content explaining what this panel is. */
  helpText: string;
  /** Accept-button label. Defaults to "Accept". */
  acceptLabel?: string;
  /** Caller's accept handler — wires the click to the right mapping /
   *  assignment flow. The shell flashes a busy state on the row until
   *  this promise resolves, then refetches. */
  onAccept: (targetId: string) => Promise<void>;
  /** Flatten the kind-specific backend row into a `Suggestion`. */
  normalize: (row: any) => Suggestion;
  /** Locked / readonly node hides Accept + Dismiss. */
  disabled?: boolean;
  /** Bumped by the parent to force a refetch (e.g. after a sibling
   *  mapping created elsewhere on the card). */
  refreshKey?: number;
}

function confidenceBucket(score: number): { label: string; bg: string; fg: string } {
  if (score >= 0.7) return { label: 'High', bg: '#d1fae5', fg: '#065f46' };
  if (score >= 0.4) return { label: 'Medium', bg: '#fef3c7', fg: '#92400e' };
  return { label: 'Low', bg: '#f1f5f9', fg: '#475569' };
}

export default function SuggestionsPanel({
  nodeId,
  kind,
  endpoint,
  title,
  helpText,
  acceptLabel,
  onAccept,
  normalize,
  disabled,
  refreshKey,
}: SuggestionsPanelProps) {
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic dismissal — hide the row immediately while the POST is
  // in flight; on failure we restore. Server is the source of truth
  // across page loads.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; data: any[] }>(endpoint);
      setRows((res.data || []).map(normalize));
    } catch (e: any) {
      setError(e?.message || 'Failed to load suggestions');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint, normalize]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const visible = (rows || []).filter((r) => !dismissed.has(r.targetId));

  if (!loading && !error && visible.length === 0) return null;

  const handleAccept = async (targetId: string) => {
    if (disabled || accepting.has(targetId)) return;
    setAccepting((prev) => new Set(prev).add(targetId));
    try {
      await onAccept(targetId);
      await load();
    } finally {
      setAccepting((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    }
  };

  const handleDismiss = async (targetId: string) => {
    if (disabled) return;
    // Optimistic — hide immediately. If the POST fails we restore.
    setDismissed((prev) => new Set(prev).add(targetId));
    try {
      await apiClient.post(`/process-catalog/nodes/${nodeId}/suggestions/dismiss`, {
        kind,
        targetId,
      });
    } catch {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
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
        <span>{title}</span>
        <span title={helpText} style={{ cursor: 'help', color: 'var(--color-text-muted)' }}>?</span>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading suggestions…</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>
      )}

      {!loading && !error && visible.map((s) => {
        const bucket = confidenceBucket(s.score);
        const isAdding = accepting.has(s.targetId);
        return (
          <div
            key={s.targetId}
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
                <span style={{ fontWeight: 500, fontSize: 13 }}>{s.targetName}</span>
                {s.subtitle && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{s.subtitle}</span>
                )}
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
              {s.rationale.length > 0 && (
                <ul style={{
                  margin: '4px 0 0',
                  padding: '0 0 0 16px',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  lineHeight: 1.4,
                }}>
                  {s.rationale.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
              <button
                type="button"
                disabled={disabled || isAdding}
                onClick={() => handleAccept(s.targetId)}
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
                {isAdding ? 'Adding…' : (acceptLabel || 'Accept')}
              </button>
              <button
                type="button"
                disabled={disabled || isAdding}
                onClick={() => handleDismiss(s.targetId)}
                aria-label="Dismiss suggestion"
                title="Dismiss — won't be suggested again"
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
