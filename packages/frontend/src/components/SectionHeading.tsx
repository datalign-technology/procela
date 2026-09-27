import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { activateOnKey } from '../lib/a11y';

// ──────────────────────────────────────────────────────────────────────────
// SectionHeading — the one section title used across dashboards and reports.
//
// Replaces the two drifting systems: the Dashboard's bare `<h2 16/600>` and
// a formal report's teal-underlined `<h2 18/700>`. One title treatment
// (18/700, ink), with the accent moved to an optional `underline` rule and an
// optional `eyebrow` — so teal never competes with the title text itself.
//
//   <SectionHeading title="Governance Gaps" />
//   <SectionHeading title="Overview" right={<LensToggle />} />
//   <SectionHeading eyebrow="Section 01" title="Organization Overview" underline />
//
// For the tiny uppercase labels *inside* a card, use <SectionLabel> instead.
// ──────────────────────────────────────────────────────────────────────────

interface SectionHeadingProps {
  title: ReactNode;
  /** Small uppercase brand label above the title (e.g. a section number). */
  eyebrow?: ReactNode;
  /** Teal bottom rule — the formal document treatment. */
  underline?: boolean;
  /** Trailing slot on the same baseline — a toggle, a "View all" link, etc. */
  right?: ReactNode;
  as?: 'h2' | 'h3';
  marginBottom?: number | string;
  /** Turn the heading into a disclosure toggle: a chevron precedes the title
   *  and the title row becomes a keyboard-operable button. Requires `open`
   *  and `onToggle`. Omit for a plain heading (unchanged behaviour). */
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

export default function SectionHeading({
  title,
  eyebrow,
  underline,
  right,
  as: Tag = 'h2',
  marginBottom = 12,
  collapsible,
  open,
  onToggle,
}: SectionHeadingProps) {
  const titleGroup = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {collapsible && (
        <span aria-hidden style={{ color: 'var(--color-text-muted)', display: 'inline-flex', flexShrink: 0 }}>
          {open ? <ChevronDown size={16} strokeWidth={2.2} /> : <ChevronRight size={16} strokeWidth={2.2} />}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        {eyebrow != null && (
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: 3 }}>
            {eyebrow}
          </div>
        )}
        <Tag style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--color-text)', lineHeight: 1.2 }}>
          {title}
        </Tag>
      </div>
    </div>
  );
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom,
        ...(underline ? { borderBottom: '2px solid var(--color-primary)', paddingBottom: 6 } : null),
      }}
    >
      {collapsible ? (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={onToggle}
          onKeyDown={onToggle ? activateOnKey(onToggle) : undefined}
          style={{ cursor: 'pointer', minWidth: 0 }}
        >
          {titleGroup}
        </div>
      ) : titleGroup}
      {right != null && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}
