import React from 'react';

interface SecondaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Size preset. `sm` (default) matches the toolbar/dialog cancel
   *  button pattern used across ~18 pages; `md` is for prominent
   *  form-submit-adjacent cancels. */
  size?: 'sm' | 'md';
  /** Override the CSS variables when the button lives on an unusual
   *  background where the border wouldn't read. Rare — the default
   *  works for every card / dialog surface in the app. */
  style?: React.CSSProperties;
}

const SIZE_MAP: Record<NonNullable<SecondaryButtonProps['size']>, React.CSSProperties> = {
  sm: { padding: '5px 12px', fontSize: 12 },
  md: { padding: '8px 16px', fontSize: 13 },
};

/**
 * SecondaryButton — the neutral "Cancel / Close / Later" affordance.
 *
 * The audit found the exact same 8-property inline style copy-pasted
 * verbatim across ~18 pages:
 *   padding: '5px 12px', fontSize: 12, fontWeight: 500,
 *   background: 'transparent', color: '#6b7280',
 *   border: '1px solid #d1d5db',
 *   borderRadius: 'var(--radius-md)', cursor: 'pointer'
 *
 * Two of those properties (#6b7280, #d1d5db) don't match any CSS
 * variable, so a semantic-palette retune would leave them behind.
 * This component centralises the pattern and swaps the hex to
 * `var(--color-text-secondary)` + `var(--color-border)`, keeping the
 * visual identical today but tying it to the shared palette going
 * forward.
 */
export default function SecondaryButton({
  size = 'sm',
  style,
  children,
  ...rest
}: SecondaryButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        ...SIZE_MAP[size],
        fontWeight: 500,
        background: 'transparent',
        color: 'var(--color-text-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
