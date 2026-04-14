// ──────────────────────────────────────────────────────────────────────────
// SaveIndicator — small inline status pill for forms / autosaved fields.
// Three states: idle (renders nothing), saving (spinner-ish), saved (check).
// Pair with a state machine in the parent: state goes idle → saving on
// submit, then saving → saved on success, then `setTimeout` back to idle
// after ~1.5s to keep the indicator from sticking around forever.
// ──────────────────────────────────────────────────────────────────────────

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveIndicatorProps {
  state: SaveState;
  errorMessage?: string;
}

export default function SaveIndicator({ state, errorMessage }: SaveIndicatorProps) {
  if (state === 'idle') return null;

  const config = {
    saving: { color: '#64748b', label: 'Saving\u2026' },
    saved:  { color: '#16a34a', label: '\u2713 Saved' },
    error:  { color: '#dc2626', label: errorMessage || 'Save failed' },
  }[state];

  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        color: config.color,
        padding: '2px 8px',
        borderRadius: 4,
        background: config.color + '14',
      }}
    >
      {config.label}
    </span>
  );
}
