import { useTerminologyStore } from '@/stores/terminologyStore';

// ──────────────────────────────────────────────────────────────────────────
// TerminologyToggle — two-state segmented control switching between
// plain English (default) and DAMA jargon. Plain is the default so
// new business users aren't met with unfamiliar terminology; data
// professionals who prefer the formal DAMA vocabulary can flip the
// toggle and have their preference persisted.
//
// Mounted in the Layout header next to DensityToggle.
// ──────────────────────────────────────────────────────────────────────────

export default function TerminologyToggle() {
  const { mode, setMode } = useTerminologyStore();

  const btn = (value: 'plain' | 'dama', label: string, tooltip: string) => (
    <button
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      title={tooltip}
      style={{
        padding: '4px 10px',
        fontSize: 11, fontWeight: 500,
        background: mode === value ? 'var(--color-surface)' : 'transparent',
        color: mode === value ? 'var(--color-text)' : 'var(--color-text-muted)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        boxShadow: mode === value ? 'var(--shadow-sm)' : 'none',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Terminology"
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 6, padding: 2,
      }}
    >
      {btn('plain', 'Plain', 'Plain English labels (default)')}
      {btn('dama',  'DAMA',  'Formal DAMA-DMBOK terminology')}
    </div>
  );
}
