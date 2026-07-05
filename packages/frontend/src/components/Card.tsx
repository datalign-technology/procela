import React from 'react';

interface CardProps {
  children: React.ReactNode;
  /**
   * Interior padding. Defaults to 16px which matches most existing
   * cards in the app; longer-form content (Settings sections, wizard
   * steps) commonly uses 24. Pass 0 to opt out of built-in padding
   * (e.g. when the card wraps a table that supplies its own).
   */
  padding?: number | string;
  /**
   * Bottom margin. Cards stacked in a column want a gap between them;
   * cards in a grid handled by their parent's `gap` want 0.
   */
  marginBottom?: number | string;
  /**
   * Border-radius token. Defaults to --radius-md (6px). Use "lg"
   * (10px) for large modal-adjacent panels; "sm" (3px) for compact
   * inline card-lets. Custom pixel values discouraged — extend the
   * token set instead if a new radius is genuinely needed.
   */
  radius?: 'sm' | 'md' | 'lg';
  /**
   * Elevation. Defaults to --shadow-sm — the baseline card look.
   * "md" is for cards that need to lift on hover; "lg" for modal
   * overlays. `none` renders a flat card (border only).
   */
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * Optional interactive affordance. When set, the card gets a
   * pointer cursor, keyboard-focusable outline, and role="button".
   * The caller supplies the click handler.
   */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /**
   * Border colour override. Defaults to var(--color-border). Some
   * destructive cards (Reset everything) use a red border to
   * signal intent — pass '#fecaca' for that variant.
   */
  borderColor?: string;
  /**
   * Escape hatch for one-off overrides — grid-column, minHeight,
   * background variants, etc. Prefer using the props above; this is
   * for genuinely unique cases.
   */
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  role?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

const RADIUS_MAP: Record<NonNullable<CardProps['radius']>, string> = {
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
};

const SHADOW_MAP: Record<NonNullable<CardProps['shadow']>, string | undefined> = {
  none: 'none',
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
};

/**
 * Card — the standard content container.
 *
 * The design audit found every page reinvented the same card
 * pattern inline:
 *   background: var(--color-surface); border: 1px solid
 *   var(--color-border); border-radius: var(--radius-md);
 *   box-shadow: var(--shadow-sm); padding: 16px;
 * with ad-hoc variations that had no semantic reason. One
 * component with a small set of props (radius / shadow /
 * borderColor / padding) covers every legitimate variant and
 * kills the drift.
 *
 * If a card needs a header (title + subtitle + actions), compose
 * with PageHeader inside; if it needs a section label, drop a
 * <SectionLabel> in as the first child.
 */
export default function Card({
  children,
  padding = 16,
  marginBottom,
  radius = 'md',
  shadow = 'sm',
  onClick,
  borderColor = 'var(--color-border)',
  style,
  className,
  id,
  role,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: CardProps) {
  const interactive = !!onClick;
  return (
    <div
      id={id}
      className={className}
      role={role ?? (interactive ? 'button' : undefined)}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>); }
      } : undefined}
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${borderColor}`,
        borderRadius: RADIUS_MAP[radius],
        boxShadow: SHADOW_MAP[shadow],
        padding,
        ...(marginBottom !== undefined ? { marginBottom } : null),
        ...(interactive ? { cursor: 'pointer' } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
