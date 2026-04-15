import { useDensityStore } from '@/stores/densityStore';

// ──────────────────────────────────────────────────────────────────────────
// DensityToggle — two-state segmented control switching row density
// between cozy (default) and compact (power users). Lives in the header.
// ──────────────────────────────────────────────────────────────────────────

export default function DensityToggle() {
  const { density, setDensity } = useDensityStore();

  const btn = (value: 'cozy' | 'compact', label: string, icon: string) => (
    <button
      onClick={() => setDensity(value)}
      aria-pressed={density === value}
      title={`${label} density`}
      style={{
        padding: '4px 10px',
        fontSize: 11, fontWeight: 500,
        background: density === value ? 'var(--color-surface)' : 'transparent',
        color: density === value ? 'var(--color-text)' : 'var(--color-text-muted)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        boxShadow: density === value ? 'var(--shadow-sm)' : 'none',
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div
      role="group"
      aria-label="Row density"
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 6, padding: 2,
      }}
    >
      {btn('cozy',    'Cozy',    '\u2261')}
      {btn('compact', 'Compact', '\u2630')}
    </div>
  );
}
