import type { ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// StatusBadge — a single component for the small coloured pill that
// marks states throughout the app (REQUIRED, ACTIVE, DRAFT, PAUSED,
// AI Agent, etc.). Replaces dozens of bespoke
//   <span style={{ background: '#fee2e2', color: '#991b1b', padding: ... }}>REQUIRED</span>
// usages that drifted into slightly different colours and paddings,
// making the product feel "assembled" instead of "designed".
//
// Variants map to semantic meaning, not visual choice:
//   danger   — REQUIRED, FAILED, REJECTED, CRITICAL
//   warning  — DRAFT, PENDING, PAUSED, ATTENTION, UNFILLED
//   success  — DONE, ACTIVE, APPROVED, FILLED
//   info     — IN PROGRESS, PENDING REVIEW, MULTIPLE / SINGLE
//   agent    — AI agent markers (purple, paired with the <Bot /> icon)
//   neutral  — default / archived / generic state
//
//   <StatusBadge variant="danger">Required</StatusBadge>
//   <StatusBadge variant="success">Active</StatusBadge>
//   <StatusBadge variant="agent" icon={<Bot size={11} />}>{agent.name}</StatusBadge>
//
// `size='sm'` (default) is the uppercase tag-style typical for state
// markers; `size='md'` keeps sentence case for slightly longer labels.
// ──────────────────────────────────────────────────────────────────────────

export type StatusBadgeVariant = 'danger' | 'warning' | 'success' | 'info' | 'agent' | 'neutral';

interface StatusBadgeProps {
  variant?: StatusBadgeVariant;
  children: ReactNode;
  /** Optional leading icon — Lucide component, sized ~11px. */
  icon?: ReactNode;
  size?: 'sm' | 'md';
  outlined?: boolean;
  /** Use a dashed border (implies outlined). For "absence" states like
   *  NOT_CONNECTED where the chip is read as a placeholder rather than
   *  a positive status. */
  dashed?: boolean;
  title?: string;
  style?: React.CSSProperties;
  /** When set, the badge renders as a <button> so it can act as a
   *  click target (e.g. SystemsPage's "5 configured · 3 live" pill
   *  navigates to /connections). The badge keeps its visual styling
   *  and just adds cursor:pointer and reset button chrome. */
  onClick?: () => void;
}

const VARIANT_STYLES: Record<StatusBadgeVariant, { bg: string; fg: string; border: string }> = {
  danger:  { bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' },
  warning: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  success: { bg: '#d1fae5', fg: '#065f46', border: '#bbf7d0' },
  info:    { bg: '#dbeafe', fg: '#1e40af', border: '#bfdbfe' },
  agent:   { bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' },
  neutral: { bg: '#f1f5f9', fg: '#64748b', border: 'var(--color-border)' },
};

export default function StatusBadge({
  variant = 'neutral',
  children,
  icon,
  size = 'sm',
  outlined = false,
  dashed = false,
  title,
  style,
  onClick,
}: StatusBadgeProps) {
  const palette = VARIANT_STYLES[variant];
  const small = size === 'sm';
  const showBorder = outlined || dashed;
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: small ? '1px 6px' : '2px 8px',
    borderRadius: small ? 3 : 999,
    fontSize: small ? 9 : 11,
    fontWeight: small ? 700 : 600,
    letterSpacing: small ? '0.04em' : 'normal',
    textTransform: small ? 'uppercase' : 'none',
    background: palette.bg,
    color: palette.fg,
    border: showBorder ? `1px ${dashed ? 'dashed' : 'solid'} ${palette.border}` : 'none',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
    ...style,
  };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} style={{ ...baseStyle, cursor: 'pointer' }}>
        {icon}
        <span>{children}</span>
      </button>
    );
  }
  return (
    <span title={title} style={baseStyle}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
