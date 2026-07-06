import React from 'react';

interface SetupPhaseDiagramProps {
  /**
   * Per-phase progress (0..100). When supplied, each phase renders
   * a small percent under its label so the diagram doubles as a
   * live status view. Falls back to the muted "step N of 3"
   * placeholder when omitted.
   */
  progress?: { capture: number; assign: number; govern: number };
  /** Optional current phase (1|2|3) — highlighted with a stronger
   *  outline. Falls back to the first incomplete phase, then to
   *  phase 1 when nothing has started. */
  activePhase?: 1 | 2 | 3;
}

// Phase palette lifted from SetupHubPage's own Phase entries so
// the diagram and the accordion below it read as the same three
// things. If the phase colours change on the page, mirror them
// here.
const PHASES: Array<{
  num: 1 | 2 | 3;
  title: string;
  tag: string;
  color: string;
  bg: string;
  points: string[];
}> = [
  {
    num: 1, title: 'Capture', tag: 'Tell Procela what you have',
    color: '#3b82f6', bg: '#dbeafe',
    points: ['Org tree & people', 'Processes & systems', 'Data assets'],
  },
  {
    num: 2, title: 'Assign', tag: 'Give everything an owner',
    color: '#8b5cf6', bg: '#ede9fe',
    points: ['Process owners', 'Domain owners', 'Data stewards'],
  },
  {
    num: 3, title: 'Govern', tag: 'Wrap governance around it',
    color: '#22c55e', bg: '#dcfce7',
    points: ['Connect data to processes', 'Tier & grade assets', 'Operating model'],
  },
];

/**
 * SetupPhaseDiagram — the "three phases of Procela" hero used on
 * the Get Started page.
 *
 * Renders three connected step cards (Capture → Assign → Govern)
 * with an inline SVG arrow between each. Purely visual: it doesn't
 * navigate on click or drive the accordion state below it — the
 * page's existing accordion is the interactive surface. The
 * diagram exists so a first-time user can grok the shape of the
 * onboarding journey at a glance without expanding sections.
 *
 * Deliberately theme-aware: card backgrounds use the phase-tinted
 * light hex (matches the operational palette elsewhere) but
 * borders, arrows, and body text pull from CSS variables so the
 * component reads well against light or dark surfaces.
 */
export default function SetupPhaseDiagram({ progress, activePhase }: SetupPhaseDiagramProps) {
  // Figure out which phase to highlight: explicit prop wins, else
  // the first incomplete phase (per progress), else phase 1.
  const inferredActive: 1 | 2 | 3 = activePhase ?? (() => {
    if (!progress) return 1;
    if (progress.capture < 100) return 1;
    if (progress.assign < 100) return 2;
    return 3;
  })();

  const percentFor = (num: 1 | 2 | 3): number | null => {
    if (!progress) return null;
    return num === 1 ? progress.capture : num === 2 ? progress.assign : progress.govern;
  };

  return (
    <div
      aria-label="The three phases of setting up Procela: Capture, Assign, Govern"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 24px 1fr 24px 1fr',
        gap: 0,
        alignItems: 'stretch',
        marginBottom: 24,
      }}
    >
      {PHASES.map((ph, i) => {
        const isActive = ph.num === inferredActive;
        const pct = percentFor(ph.num);
        return (
          <React.Fragment key={ph.num}>
            <div
              style={{
                background: ph.bg,
                border: `${isActive ? 2 : 1}px solid ${ph.color}`,
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: ph.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {ph.num}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: ph.color, lineHeight: 1.15 }}>
                  {ph.title}
                </div>
                {pct !== null && (
                  <div
                    aria-label={`${pct}% complete`}
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      fontWeight: 600,
                      color: pct === 100 ? ph.color : 'var(--color-text-secondary)',
                    }}
                  >
                    {pct}%
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                {ph.tag}
              </div>
              <ul
                style={{
                  margin: '4px 0 0', paddingLeft: 16,
                  fontSize: 11, color: 'var(--color-text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                {ph.points.map((pt) => <li key={pt}>{pt}</li>)}
              </ul>
            </div>
            {/* Arrow separator between cards. Rendered inline as SVG so it
                inherits the theme colour and doesn't need an asset file. */}
            {i < PHASES.length - 1 && (
              <div
                aria-hidden="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="20" height="16" viewBox="0 0 20 16"
                  fill="none" stroke="var(--color-text-muted)"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M2 8 L18 8" />
                  <path d="M12 3 L18 8 L12 13" />
                </svg>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
