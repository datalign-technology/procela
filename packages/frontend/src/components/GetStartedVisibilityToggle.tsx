import { useSetupStore, type GetStartedVisibility } from '@/stores/setupStore';

// ──────────────────────────────────────────────────────────────────────────
// GetStartedVisibilityToggle — three-state segmented control for the
// "Get Started" sidebar entry: Auto (show while setup is incomplete, then
// step aside), Always (pin regardless of progress), or Hidden. A per-user
// display preference; lives in the user menu next to Terminology and Density.
// ──────────────────────────────────────────────────────────────────────────

const OPTIONS: Array<{ value: GetStartedVisibility; label: string; title: string }> = [
  { value: 'auto',   label: 'Auto',   title: 'Show while setup is incomplete, then hide once fully set up' },
  { value: 'shown',  label: 'Always', title: 'Always show the Get Started entry' },
  { value: 'hidden', label: 'Hidden', title: 'Hide the Get Started entry' },
];

export default function GetStartedVisibilityToggle() {
  const visibility = useSetupStore((s) => s.visibility);
  const setVisibility = useSetupStore((s) => s.setVisibility);

  return (
    <div
      role="group"
      aria-label="Get Started guide visibility"
      style={{
        display: 'inline-flex', alignItems: 'center',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 6, padding: 2,
      }}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => setVisibility(o.value)}
          aria-pressed={visibility === o.value}
          title={o.title}
          style={{
            padding: '4px 9px',
            fontSize: 11, fontWeight: 500,
            background: visibility === o.value ? 'var(--color-surface)' : 'transparent',
            color: visibility === o.value ? 'var(--color-text)' : 'var(--color-text-muted)',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            boxShadow: visibility === o.value ? 'var(--shadow-sm)' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
