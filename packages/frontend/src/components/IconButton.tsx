import React from 'react';

// ──────────────────────────────────────────────────────────────────────────
// IconButton — square icon-only button with a CSS hover tooltip showing
// the action label. Standardises the look of page-header action buttons
// so every page reads the same way: a row of icons, hover for the verb.
//
// Tooltip mechanism mirrors what the sidebar uses for its NavLinks: an
// absolutely-positioned label kept out of layout flow until hover, with
// a small arrow pointing back at the icon.
// ──────────────────────────────────────────────────────────────────────────

export type IconButtonVariant = 'primary' | 'secondary' | 'danger';

// Two sizes: 'md' is the default page-header variant (34x34); 'sm' is for
// per-row table actions (24x24) where vertical real estate is tight.
export type IconButtonSize = 'sm' | 'md';

export type IconName =
  | 'plus'
  | 'upload'
  | 'download'
  | 'trash'
  | 'edit'
  | 'eye'
  | 'refresh'
  | 'play'
  | 'settings'
  | 'check'
  | 'search'
  | 'link'
  | 'unlink'
  | 'users';

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

const variantStyles: Record<IconButtonVariant, React.CSSProperties> = {
  primary: {
    background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)',
  },
  secondary: {
    background: 'var(--color-bg)', color: 'var(--color-text)', borderColor: 'var(--color-border)',
  },
  danger: {
    background: 'var(--color-bg)', color: 'var(--color-error)', borderColor: 'var(--color-error)',
  },
};

export default function IconButton({ icon, label, onClick, variant = 'secondary', size = 'md', disabled, type = 'button' }: IconButtonProps) {
  const v = variantStyles[variant];
  const dims = size === 'sm' ? 24 : 34;
  const iconSize = size === 'sm' ? 14 : 18;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // The wrapper is `position: relative` so the absolutely-positioned
      // tooltip below has an anchor.
      style={{
        position: 'relative',
        width: dims, height: dims, padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${v.borderColor}`, borderRadius: 'var(--radius-md)',
        background: v.background, color: v.color,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.12s, border-color 0.12s, transform 0.05s',
        verticalAlign: 'middle',
      }}
      // Tiny press feedback so the click feels real even without the verb.
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.96)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = ''; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; }}
      // Reveal the floating label as a sibling element via a child class
      // toggled by the wrapper's :hover. We can't use CSS modules here
      // (component is self-contained), so use inline styles + a data
      // attribute the tooltip element listens to.
      onMouseEnter={(e) => {
        const tip = e.currentTarget.querySelector<HTMLElement>('[data-tooltip]');
        if (tip) { tip.style.opacity = '1'; tip.style.visibility = 'visible'; }
      }}
      onPointerLeave={(e) => {
        const tip = e.currentTarget.querySelector<HTMLElement>('[data-tooltip]');
        if (tip) { tip.style.opacity = '0'; tip.style.visibility = 'hidden'; }
      }}
    >
      <Icon name={icon} size={iconSize} />
      <span
        data-tooltip
        style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e293b', color: '#fff',
          padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          opacity: 0, visibility: 'hidden',
          transition: 'opacity 0.12s, visibility 0.12s',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 900,
        }}
      >
        {label}
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Inline SVG set. Outline style matches the bell icon in the header.
// ──────────────────────────────────────────────────────────────────────────

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true, focusable: false,
  };
  switch (name) {
    case 'plus':
      return <svg {...common}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
    case 'upload':
      return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>;
    case 'download':
      return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
    case 'trash':
      return <svg {...common}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>;
    case 'edit':
      return <svg {...common}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
    case 'eye':
      return <svg {...common}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'refresh':
      return <svg {...common}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>;
    case 'play':
      return <svg {...common}><polygon points="5 3 19 12 5 21 5 3" /></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
    case 'check':
      return <svg {...common}><polyline points="20 6 9 17 4 12" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
    case 'link':
      return <svg {...common}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
    case 'unlink':
      return <svg {...common}><path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" /><line x1="8" y1="2" x2="8" y2="5" /><line x1="2" y1="8" x2="5" y2="8" /><line x1="16" y1="19" x2="16" y2="22" /><line x1="19" y1="16" x2="22" y2="16" /></svg>;
    case 'users':
      return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    default:
      return null;
  }
}
