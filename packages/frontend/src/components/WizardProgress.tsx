interface WizardProgressProps {
  /**
   * Named steps in the flow, in order. Each becomes one pill in the
   * bar. Steps before `current` render as completed, the `current`
   * one as active, later ones as pending.
   */
  steps: readonly string[];
  /** Zero-based index of the active step. */
  current: number;
  /**
   * Optional continuous fill for the active pill (0..1). Ignored
   * unless supplied. Use for steps that have their own sub-progress
   * — e.g. the AI generation call streams a token-progress value the
   * wizard funnels into the "Generate" pill so it doesn't sit at
   * "1/3 complete" for the full 20-second wait.
   */
  activeFill?: number;
  /** Optional caption under the bar (e.g. "Generating value streams…"). */
  caption?: string;
  style?: React.CSSProperties;
}

/**
 * WizardProgress — shared step indicator for every wizard in the
 * app (ValueStream, Onboarding, GovernanceSetup, SyncConnection,
 * BatchMapping). Replaces the four ad-hoc versions that used to live
 * inline in each wizard so the visual language stays consistent.
 *
 * Design:
 *   [====][====][----][    ][    ]     <- filled / active / pending pills
 *    Industry  Review  Apply
 *
 * The pills stretch to fill the row and each carry a short label
 * underneath. A single active pill can carry a continuous fill so
 * the "Generate" step's ~20s AI wait doesn't feel like nothing is
 * happening — the fill lets a caller wire in real progress (token
 * stream) instead of faking it with a spinner.
 */
export default function WizardProgress({ steps, current, activeFill, caption, style }: WizardProgressProps) {
  return (
    <div style={{ marginBottom: 20, ...style }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {steps.map((_, i) => {
          const isCompleted = i < current;
          const isActive = i === current;
          const bg = isCompleted
            ? 'var(--color-primary)'
            : isActive
              ? 'var(--color-primary-light)'
              : 'var(--color-border)';
          return (
            <div key={i} style={{ flex: 1, position: 'relative', height: 6, borderRadius: 3, background: bg, overflow: 'hidden' }}>
              {isActive && typeof activeFill === 'number' && (
                <div
                  style={{
                    position: 'absolute', top: 0, left: 0, bottom: 0,
                    width: `${Math.max(0, Math.min(1, activeFill)) * 100}%`,
                    background: 'var(--color-primary)',
                    transition: 'width 0.2s ease-out',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {steps.map((label, i) => {
          const isCompleted = i < current;
          const isActive = i === current;
          return (
            <div
              key={i}
              style={{
                flex: 1, textAlign: 'center', fontSize: 11,
                fontWeight: isActive ? 600 : 400,
                color: isCompleted || isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
      {caption && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          {caption}
        </div>
      )}
    </div>
  );
}
