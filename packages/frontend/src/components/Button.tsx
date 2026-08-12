import React from 'react';

// ──────────────────────────────────────────────────────────────────────────
// Button — single source of truth for the text buttons that used to be
// inline `style={{ padding: '8px 16px', ... }}` on every page.
//
// Variants:
//   primary   — solid primary colour, white text. Main page action.
//   secondary — outlined neutral. Most everything else.
//   danger    — solid red, white text. Destructive confirms.
//   ghost     — no border, no background; for inline "Cancel" links.
//
// Sizes:
//   sm — table-row actions (28h)
//   md — default page-level buttons (34h)
//
// IconButton is the icon-only sibling. Use Button when there's visible
// text; use IconButton when you only have an icon.
// ──────────────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

// Extends the native button attributes, so `title`, `id`, `name`,
// `onMouseEnter`, `aria-*`, etc. pass straight through to the element —
// which is what lets it be a drop-in for the hand-rolled `<button
// style={btnPrimary} …>` call sites (many carry a `title` tooltip).
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  // Inline left/right adornment — keep it small; for a true icon-only
  // button use IconButton.
  leadingIcon?: React.ReactNode;
}

const variantStyle: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: 'var(--color-primary)',
    color: '#fff',
    border: '1px solid var(--color-primary)',
  },
  secondary: {
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
  },
  danger: {
    background: 'var(--color-error, #dc2626)',
    color: '#fff',
    border: '1px solid var(--color-error, #dc2626)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid transparent',
  },
};

const sizeStyle: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '4px 12px', fontSize: 12, height: 28 },
  md: { padding: '8px 16px', fontSize: 13, height: 34 },
};

export default function Button({
  children, type = 'button', variant = 'secondary', size = 'md',
  disabled, loading, fullWidth, style, leadingIcon,
  onMouseDown, onMouseUp, onMouseLeave, ...rest
}: ButtonProps) {
  const v = variantStyle[variant];
  const s = sizeStyle[size];
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
      style={{
        ...v,
        ...s,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: leadingIcon ? 6 : 0,
        fontWeight: 500,
        borderRadius: 'var(--radius-md)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        width: fullWidth ? '100%' : undefined,
        transition: 'background-color 0.12s, border-color 0.12s, transform 0.05s',
        ...style,
      }}
      onMouseDown={(e) => { if (!isDisabled) e.currentTarget.style.transform = 'scale(0.98)'; onMouseDown?.(e); }}
      onMouseUp={(e) => { e.currentTarget.style.transform = ''; onMouseUp?.(e); }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; onMouseLeave?.(e); }}
    >
      {leadingIcon && <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center' }}>{leadingIcon}</span>}
      <span>{loading ? 'Saving…' : children}</span>
    </button>
  );
}
