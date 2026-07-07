import { renderNavIcon } from './navIcons';

interface SetupPhaseDiagramProps {
  /**
   * Per-phase progress (0..100). When supplied, each phase's badge
   * shows the live percent. Falls back to just the phase name when
   * omitted.
   */
  progress?: { capture: number; assign: number; govern: number };
  /**
   * Optional current phase (1|2|3) — highlighted with a heavier
   * border. When omitted, inferred as the first incomplete phase
   * from `progress`, defaulting to 1.
   */
  activePhase?: 1 | 2 | 3;
}

// Phase palette mirrors SetupHubPage's own accordion so the
// diagram and the phase list below it read as the same three
// things. `color` matches the numbered circle in the accordion
// (blue-500 / violet-500 / green-500) and is used for borders,
// badges, and phase labels. `bg` uses the -100 tint so the box
// carries visible weight — pale -50 tints made the diagram look
// washed out against the numbered dots below.
const PHASE_COLORS = {
  capture: { color: '#3b82f6', bg: '#dbeafe' }, // blue-500 / blue-100
  assign:  { color: '#8b5cf6', bg: '#ede9fe' }, // violet-500 / violet-100
  govern:  { color: '#22c55e', bg: '#dcfce7' }, // green-500 / green-100
};

// The four entities inside Capture. Icon comes from the sidebar
// so the mental link between "this box" and "that rail entry" is
// automatic — Procela's icon set is one system.
const ENTITIES: Array<{ label: string; route: string }> = [
  { label: 'Processes', route: '/processes' },
  { label: 'Data',      route: '/data-assets' },
  { label: 'Systems',   route: '/systems' },
  { label: 'People',    route: '/people' },
];

/** Small percent badge shown in the top-right corner of each nested
 *  box. Matches the phase's colour when 100%; muted otherwise. */
function PhaseBadge({ label, num, pct, color }: { label: string; num: number; pct: number | null; color: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 999,
      background: 'var(--color-surface)',
      border: `1.5px solid ${color}`,
      fontSize: 11, fontWeight: 700,
      color,
      lineHeight: 1,
    }}>
      <span
        aria-hidden="true"
        style={{
          width: 16, height: 16, borderRadius: '50%',
          background: color, color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700,
        }}
      >
        {num}
      </span>
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {pct !== null && (
        <span style={{ color: pct === 100 ? color : 'var(--color-text-secondary)', fontSize: 11 }}>
          {pct}%
        </span>
      )}
    </div>
  );
}

/**
 * SetupPhaseDiagram — the "three phases of Procela" hero used on
 * the Get Started page.
 *
 * Nested-rectangle model: **Capture** holds the four entities
 * (Processes / Data / Systems / People); **Assign** wraps Capture
 * (ownership is applied to the captured entities); **Govern**
 * wraps Assign (governance is applied to owned entities). The
 * physical nesting communicates the DAMA-style layering — each
 * phase is a layer of accountability applied to the underlying
 * catalog — in a way a row of arrows never could.
 *
 * Purely visual: doesn't drive the accordion state and doesn't
 * navigate on click. The page's existing accordion is the
 * interactive surface. This diagram just answers "what is the
 * shape of this?" at a glance.
 *
 * Per-phase badges in the top-right of each box show live progress
 * when provided. The active phase (first incomplete) gets a
 * heavier border so the eye lands on where the user is.
 */
export default function SetupPhaseDiagram({ progress, activePhase }: SetupPhaseDiagramProps) {
  const inferredActive: 1 | 2 | 3 = activePhase ?? (() => {
    if (!progress) return 1;
    if (progress.capture < 100) return 1;
    if (progress.assign < 100) return 2;
    return 3;
  })();

  const pct = (phase: 'capture' | 'assign' | 'govern'): number | null => {
    if (!progress) return null;
    return progress[phase];
  };

  // Border weights: 1.5 baseline, 2.5 for the active phase.
  const borderFor = (phase: 1 | 2 | 3) => `${inferredActive === phase ? 2.5 : 1.5}px solid ${
    phase === 1 ? PHASE_COLORS.capture.color
    : phase === 2 ? PHASE_COLORS.assign.color
    : PHASE_COLORS.govern.color
  }`;

  return (
    <div
      aria-label="The three phases of setting up Procela — Capture, Assign, Govern — as nested layers"
      style={{
        marginBottom: 24,
        // Outer: Govern wraps everything.
        background: PHASE_COLORS.govern.bg,
        border: borderFor(3),
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        position: 'relative',
      }}
    >
      {/* Govern badge, top-right of the outer box */}
      <div style={{ position: 'absolute', top: -12, right: 16 }}>
        <PhaseBadge label="Govern" num={3} pct={pct('govern')} color={PHASE_COLORS.govern.color} />
      </div>
      <div style={{ fontSize: 11, color: PHASE_COLORS.govern.color, fontWeight: 600, marginBottom: 10, marginTop: 4 }}>
        Wrap governance around it — tier, grade, connect, and operate.
      </div>

      {/* Middle: Assign wraps Capture. */}
      <div style={{
        background: PHASE_COLORS.assign.bg,
        border: borderFor(2),
        borderRadius: 'var(--radius-md)',
        padding: 16,
        position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: -12, right: 16 }}>
          <PhaseBadge label="Assign" num={2} pct={pct('assign')} color={PHASE_COLORS.assign.color} />
        </div>
        <div style={{ fontSize: 11, color: PHASE_COLORS.assign.color, fontWeight: 600, marginBottom: 10, marginTop: 4 }}>
          Give every entity a clear owner and steward.
        </div>

        {/* Inner: Capture holds the four entities. */}
        <div style={{
          background: PHASE_COLORS.capture.bg,
          border: borderFor(1),
          borderRadius: 'var(--radius-md)',
          padding: 16,
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: -12, right: 16 }}>
            <PhaseBadge label="Capture" num={1} pct={pct('capture')} color={PHASE_COLORS.capture.color} />
          </div>
          <div style={{ fontSize: 11, color: PHASE_COLORS.capture.color, fontWeight: 600, marginBottom: 12, marginTop: 4 }}>
            Tell Procela what you have.
          </div>

          {/* The four captured entities. Sidebar icons keep the
              visual mapping between diagram and rail identical. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8,
          }}>
            {ENTITIES.map((e) => (
              <div
                key={e.label}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span style={{ color: PHASE_COLORS.capture.color, display: 'inline-flex' }}>
                  {renderNavIcon(e.route, { size: 22, strokeWidth: 1.8 })}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
                  {e.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
