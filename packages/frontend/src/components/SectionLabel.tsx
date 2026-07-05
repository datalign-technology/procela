import React from 'react';

interface SectionLabelProps {
  children: React.ReactNode;
  /**
   * Optional bottom margin. Most callers want a small gap between the
   * label and the content it introduces; `8` is the default that
   * matches the historical hand-rolled style. Set to `0` for
   * side-by-side layouts.
   */
  marginBottom?: number | string;
  /**
   * Optional style overrides (rare). Prefer using the standard style;
   * this exists so a one-off spot can tweak a specific property (e.g.
   * a coloured variant for the People page's "Governance
   * Responsibilities" section) without forking the component.
   */
  style?: React.CSSProperties;
  /** Passthrough for `id` — screen readers can hop between sections. */
  id?: string;
}

/**
 * SectionLabel — the standard uppercase section header used inside
 * cards and detail panels ("Governance & Ownership", "Advanced
 * Fields", "Status Transitions", etc.).
 *
 * The design audit found this pattern rendered ~130 times across
 * pages with wildly inconsistent sizes (9/10/11/12/13) and weights
 * (600/700), plus common omissions (missing letterSpacing, missing
 * `color: var(--color-text-muted)`). One component ends that whole
 * category.
 *
 * The style is deliberately not customisable — the point is
 * consistency. If a section needs to look different, it's probably
 * not really a section label; use an h2/h3 instead.
 */
export default function SectionLabel({ children, marginBottom = 8, style, id }: SectionLabelProps) {
  return (
    <div
      id={id}
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--color-text-muted)',
        marginBottom,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
